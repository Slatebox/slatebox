// Polish slice 1, "No dead ends" (work-polish/audit.md #2, #8, #9, #13, #18, #19): an unknown
// address gets a page with a way on, a visitor can create an account from the sign-in page, an
// empty list says what to do next, the phone's cookie notice stays a slim strip, a guest can use
// Mermaid without being sent to a full-page form, and the copy is in sentence case.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  SIGNED_IN_BEFORE_KEY, loginWelcome, rememberSignedIn, signedInBefore, registrationCopy, mermaidNewSlateRoom, mermaidNewSlateNote,
} from '../web/app/imports/ui/common/accountCopy.mjs'
import { emptySlatesCopy, slateListView, SLATES_FAILED_COPY } from '../web/app/imports/ui/common/emptySlates.mjs'

const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const ui = (path) => app('imports/ui/' + path)
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) } }
const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }

test('#2 an unknown address matches the catch-all route and gets a designed page with a way on', () => {
  const routes = ui('SBRoutes.jsx')
  assert.match(routes, /<Route path="\*" element=\{<NotFound \/>\} \/>/)
  assert.doesNotMatch(routes, /<Route element=\{<NotFound \/>\} \/>/, 'a route without a path never matches in React Router 6')
  const page = ui('pages/NotFound.jsx')
  assert.match(page, /This page isn’t here/)
  assert.match(page, /to="\/"[^>]*>[\s\S]{0,80}Open My slates/)
  assert.match(page, /to="\/new"[^>]*>[\s\S]{0,80}Start a new slate/)
  // Theme tokens only: the old page was white on white in light mode.
  assert.doesNotMatch(page, /rgba\(255, ?255, ?255|color: '#fff'|Return Home|got erased/)
  assert.match(page, /text\.secondary/)
})

test('#8 the sign-in page greets a first visit and a return differently, and remembers a sign-in', () => {
  assert.deepEqual(loginWelcome(false), { heading: 'Sign in to Slatebox', lede: 'New here? Create an account, or start a slate with no account at all.' })
  assert.deepEqual(loginWelcome(true), { heading: 'Welcome back.', lede: 'Sign in to pick up where you left off.' })
  const storage = memory()
  assert.equal(signedInBefore(storage), false)
  rememberSignedIn(storage)
  assert.equal(storage.getItem(SIGNED_IN_BEFORE_KEY), '1')
  assert.equal(signedInBefore(storage), true)
  // Storage that throws (a private window, blocked site data) reads as a first visit and never breaks the page.
  assert.equal(signedInBefore(broken), false)
  assert.doesNotThrow(() => rememberSignedIn(broken))
  assert.equal(signedInBefore(undefined), false)
})

test('#8 the sign-in page has one primary button, a real Create an account, and sentence case', () => {
  const login = ui('pages/Login.jsx')
  assert.equal(login.match(/variant="contained"/g)?.length, 1, 'Sign in is the one filled button')
  assert.match(login, /loginWelcome\(signedInBefore\(/)
  assert.match(login, /to="\/signup"[\s\S]{0,200}Create an account/)
  assert.match(login, /to="\/start"[\s\S]{0,200}Start a slate, no account needed/)
  assert.match(login, /label="Email address"/)
  assert.match(login, />\s*Sign in\s*</)
  assert.doesNotMatch(login, /Sign In|Email Address|No Registration|By registering/)
  assert.match(ui('pages/RecoverPassword.jsx'), /label="Email address"/)
  // Every signed-in visit is remembered, so the next sign-in page says Welcome back.
  assert.match(ui('Main.jsx'), /rememberSignedIn\(/)
})

test('#8 /signup makes a guest if needed and opens the account form as a sign-up, over My slates', () => {
  const routes = ui('SBRoutes.jsx')
  assert.match(routes, /<Route path="\/signup" element=\{<SignUp \/>\} \/>/)
  const page = ui('pages/SignUp.jsx')
  assert.match(page, /createAnonymousUser\(\)/)
  assert.match(page, /intent: 'signup'/)
  assert.match(page, /<Navigate replace to="\/" \/>/)
  assert.match(ui('common/Register.jsx'), /registrationCopy\(\{/)
})

test('#8 the account form says sign up to a new visitor and save your work to a guest', () => {
  assert.deepEqual(registrationCopy({ guest: true, intent: 'signup' }), {
    heading: 'Create your account',
    lede: 'Add your email and a password. Your slates stay with you on every device.',
    action: 'Create account',
    dismiss: 'Not now',
    emailHelper: 'We’ll send a link to confirm it’s you.',
  })
  assert.deepEqual(registrationCopy({ guest: true }), {
    heading: 'Save your work',
    lede: 'You’re working as a guest, no account needed. Add an email and a password to keep your slates on every device.',
    action: 'Save my Slatebox',
    dismiss: 'Continue as guest',
    emailHelper: 'We’ll send a verification link. Your slate remains available while you verify.',
  })
  assert.equal(registrationCopy({ guest: false }).heading, 'Verify your email')
  assert.equal(registrationCopy({ guest: false, emailSent: true }).action, 'Resend verification email')
  // The line under the email field comes from the copy, so a sign-up never hears about a slate it doesn't have.
  const form = ui('common/Register.jsx')
  assert.match(form, /copy\.emailHelper/)
  assert.doesNotMatch(form, /Your slate remains available while you verify/)
})

test('#9 an empty list is a designed state with a next step, never an alert', () => {
  // Community slates are retired (the shared library replaced them): no list has that copy any more.
  assert.deepEqual(emptySlatesCopy({ type: 'team', signedIn: true, filter: ' retro ' }), {
    title: 'No team slates match “retro”',
    body: 'Try another word, or clear the filter.',
    clear: true,
  })
  assert.deepEqual(emptySlatesCopy({ type: 'mine', signedIn: true, filter: ' retro ' }), {
    title: 'No slates match “retro”',
    body: 'Try another word, or clear the filter.',
    clear: true,
  })
  assert.deepEqual(emptySlatesCopy({ type: 'mine', signedIn: true }), {
    title: 'No slates yet',
    body: 'Start with a blank slate, a board or a diagram. Ask Slatebox can draw the first one with you.',
    action: { label: 'Start a slate', to: '/new' },
  })
  assert.equal(emptySlatesCopy({ type: 'mine', signedIn: true, privateOnly: true }).title, 'No private slates')
  assert.equal(emptySlatesCopy({ type: 'team', signedIn: true }).title, 'No team slates yet')
  const list = ui('components/DisplaySlates.jsx')
  assert.doesNotMatch(list, /<Alert|import \{ Alert/)
  assert.match(list, /emptySlatesCopy\(\{/)
  assert.match(list, /<EmptyState/)
})

test('#9 the empty state waits for a reply saying none; a failed fetch says so and offers Try again', () => {
  // Before the first reply the list is loading, never empty (no flash of "No slates yet").
  assert.equal(slateListView({ signedIn: true, loading: false, answer: null }), 'loading')
  assert.equal(slateListView({ signedIn: true, loading: true, answer: { ok: true, total: 0 } }), 'loading')
  assert.equal(slateListView({ signedIn: true, loading: false, answer: { ok: true, total: 0 } }), 'empty')
  assert.equal(slateListView({ signedIn: true, loading: false, answer: { ok: true, total: 3 } }), 'list')
  // A failed fetch never says "No slates yet" to someone who has slates.
  assert.equal(slateListView({ signedIn: true, loading: false, answer: { ok: false } }), 'error')
  assert.equal(slateListView({ signedIn: false, loading: false, answer: null }), 'empty')
  assert.deepEqual(SLATES_FAILED_COPY, { line: 'We couldn’t load your slates just now.', retry: 'Try again' })
  const list = ui('components/DisplaySlates.jsx')
  assert.match(list, /slateListView\(\{/)
  assert.match(list, /view === 'empty' \?/)
  assert.doesNotMatch(list, /slateFilter\.totalSlates === 0 \?/)
  assert.match(list, /view === 'error'[\s\S]{0,400}SLATES_FAILED_COPY\.retry/)
})

test('#9 the filter searches from an icon in the field, and the title does not wrap on a phone', () => {
  const title = ui('components/Title.jsx')
  assert.doesNotMatch(title, />\s*go\s*</)
  assert.doesNotMatch(title, />\s*clear\s*</)
  assert.match(title, /aria-label="Search"/)
  assert.match(title, /aria-label="Clear the filter"/)
  assert.match(title, /<SearchIcon/)
  assert.doesNotMatch(title, /marginLeft: '50px'/, 'no indent for an empty subheading')
  assert.match(title, /noWrap/)
  // Below md the title and + New share one row: the title grows (and ellipsizes), New keeps its width,
  // and the filter's cell is not there at all (an empty cell pushed New to a second row).
  assert.match(title, /size=\{\{ xs: 'grow', md:/, 'the heading takes what is left of the row on a phone')
  assert.match(title, /size=\{\{ xs: 'auto', md: 2 \}\}[\s\S]{0,400}>\s*New\s*</, '+ New sits at the end of the same row')
  assert.match(title, /\{mdmq && \(\s*<Grid size=\{showPaging \? 3 : 4\}>/, 'the filter cell itself is gone on a phone')
})

test('#13 the cookie notice is one slim line on a phone and the canvas keeps room for exactly that', () => {
  const main = ui('Main.jsx')
  // The notice is its own component (components/CookieNotice.jsx); Main lays it out.
  const notice = ui('components/CookieNotice.jsx')
  assert.match(main, /<CookieNotice sx=/)
  assert.match(notice, /Cookies keep you signed in\./)
  assert.match(notice, />\s*Got it\s*<\/button>/, 'the accept button keeps its name')
  assert.match(main, /\[theme\.breakpoints\.down\('sm'\)\]: \{[^}]*height: 40/)
  assert.match(main, /whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'/)
  const css = ui('common/main.css')
  assert.match(css, /body:has\(\.sb-cookie\)\{--sb-cookie-strip:68px;--sb-cookie-room:80px\}/)
  assert.match(css, /@media\(max-width:599\.95px\)\{body:has\(\.sb-cookie\)\{--sb-cookie-strip:48px;--sb-cookie-room:56px\}\}/)
  assert.match(css, /body:has\(\.sb-cookie\) \.sb-canvas-page\{[^}]*padding-bottom:calc\(max\(8px,env\(safe-area-inset-bottom\)\) \+ var\(--sb-cookie-strip\)\)/)
  assert.doesNotMatch(css, /\+ 68px\)/, 'one source for the room the notice takes')
})

test('#18 a guest opens Mermaid itself: export is free to read, and a new slate asks to save gently', () => {
  const toolbar = ui('components/CanvasToolbar.jsx')
  assert.doesNotMatch(toolbar, /isAnonymous \? onOutput\('export'\)/, 'the menu item never opens the full-page form')
  assert.match(toolbar, /key: 'mermaid'[^\n]*run: \(\) => openMermaid\('export'\)/)
  assert.equal(mermaidNewSlateRoom(null), 'sign-in')
  assert.equal(mermaidNewSlateRoom({ _id: 'g', isAnonymous: true }), 'save')
  assert.equal(mermaidNewSlateRoom({ _id: 'u', isAnonymous: false }), 'open')
  const dialog = ui('components/slate/MermaidDialog.jsx')
  assert.match(dialog, /mermaidNewSlateRoom\(/)
  assert.match(dialog, /newSlateRoom === 'open' &&[\s\S]{0,200}Open as a new slate/)
  assert.match(dialog, /mermaidNewSlateNote\(newSlateRoom, canEdit\)/)
  // The note names Add to this slate only when that button is shown (canEdit); a guest reader hears only the way on.
  assert.equal(mermaidNewSlateNote('save', true), 'Save your work to open a diagram as a slate of its own. Adding it to this slate works as you are.')
  assert.equal(mermaidNewSlateNote('save', false), 'Save your work to open this diagram as a slate of its own.')
  assert.equal(mermaidNewSlateNote('sign-in', false), 'Sign in to open a diagram as a slate of its own.')
  assert.equal(mermaidNewSlateNote('open', true), null)
  assert.match(dialog, /saveYourWork\(\)/)
})

test('#19 sentence case and real ellipses in the copy people read', () => {
  const slates = JSON.parse(app('client/i18n/en/slates.i18n.json'))
  assert.equal(slates.mySlates, 'My slates')
  assert.equal(slates.communitySlates, undefined, 'Community slates are retired: the library replaced them')
  assert.equal(slates.teamSlates, 'Team slates')
  assert.equal(slates.defaultNewSlateName, 'Untitled slate')
  for (const [key, value] of Object.entries(slates)) assert.doesNotMatch(value, /!|buttton/, key)
  assert.match(ui('Main.jsx'), /title: 'My slates'/)
  assert.match(ui('pages/Canvas.jsx'), /name: 'Untitled slate'/)
  assert.match(app('imports/api/client/createSlate.js'), /\|\| 'Untitled slate'/)
  for (const file of ['pages/LoginLink.jsx', 'pages/VerifyEmail.jsx',
    'components/teams/CreateOrganization.jsx', 'components/slate/SlateSettings.jsx', 'components/slate/SlateStyle.jsx']) {
    assert.doesNotMatch(ui(file), /[A-Za-z]\.\.\.['"`<]/, `${file} uses the ellipsis character`)
  }
  const menu = ui('components/SlateMenu.jsx')
  assert.doesNotMatch(menu, /<\/>\} Slate</)
})
