// Signing out (owner report 2026-11-24: "it should always kick me back to the login screen - not create a
// guest account"). Sign out called Meteor.logout() and navigated to "/" at once; "/" (My slates) is a
// private page, which sent a visitor with no account to /start, and /start (/new) makes a guest and an
// empty slate. Now Sign out, and a session ending while a page is open, end on the sign-in page; a
// guest is still made when someone opens /new on purpose, and shared links work signed out as before.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  afterLogout, clearSession, clearSignedOut, deliberateArrival, isSignedOut, markSignedOut, mayStartGuest, MEMBER_KEY,
  noAccountPath, rememberMember, SIGN_IN_PATH, SIGNED_OUT_KEY, signOutAndLeave, storedMember,
} from '../web/app/imports/api/common/sign-out.mjs'

const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const store = (entries = {}) => {
  const m = new Map(Object.entries(entries))
  return {
    get length() { return m.size },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    keys: () => [...m.keys()],
  }
}

test('the sign-in page is where a page that needs an account sends someone who signed out', () => {
  const storage = store()
  assert.equal(noAccountPath(storage), '/start', 'a first visit still starts as a guest')
  markSignedOut(storage)
  assert.equal(isSignedOut(storage), true)
  assert.equal(noAccountPath(storage), SIGN_IN_PATH)
  assert.equal(SIGN_IN_PATH, '/login')
  clearSignedOut(storage)
  assert.equal(noAccountPath(storage), '/start')
  // Storage that refuses (a private window) never throws.
  const refusing = { getItem() { throw new Error('no') }, setItem() { throw new Error('no') }, removeItem() { throw new Error('no') } }
  assert.doesNotThrow(() => { markSignedOut(refusing); clearSignedOut(refusing) })
  assert.equal(noAccountPath(refusing), '/start')
  assert.equal(noAccountPath(null), '/start')
})

test("the old session's keys go and preferences stay", () => {
  const storage = store({
    'Meteor.loginToken': 'tok', 'Meteor.loginTokenExpires': 'date', 'Meteor.userId': 'u1',
    'Meteor.loginToken:wss://x': 'tok2', meteor_token: 'old', [MEMBER_KEY]: 'u1',
    'slatebox:last-board:abc': 'main', 'sb-color-mode': 'dark',
  })
  const gone = clearSession(storage)
  assert.deepEqual(gone.sort(), ['Meteor.loginToken', 'Meteor.loginToken:wss://x', 'Meteor.loginTokenExpires', 'Meteor.userId', 'meteor_token'])
  assert.deepEqual(storage.keys().sort(), ['sb-color-mode', 'slatebox:last-board:abc'])
  assert.deepEqual(clearSession(null), [])
})

test('Back is not a choice; a click, a redirect it led to, or a page opened afresh is', () => {
  assert.equal(deliberateArrival({ navigationType: 'PUSH' }), true)
  assert.equal(deliberateArrival({ navigationType: 'REPLACE' }), true, '/start forwards to /new with a replace')
  assert.equal(deliberateArrival({ navigationType: 'POP', firstEntry: true, documentNavigation: 'navigate' }), true, 'a typed or pasted link')
  assert.equal(deliberateArrival({ navigationType: 'POP', firstEntry: true, documentNavigation: 'reload' }), true)
  assert.equal(deliberateArrival({ navigationType: 'POP', firstEntry: true, documentNavigation: 'back_forward' }), false, 'Back to an earlier page load')
  assert.equal(deliberateArrival({ navigationType: 'POP', firstEntry: false, documentNavigation: 'navigate' }), false, 'Back inside the app')
})

test('a guest is made by itself only when nobody signed out here, or the person chose to come', () => {
  const storage = store()
  const back = { navigationType: 'POP', firstEntry: true, documentNavigation: 'back_forward' }
  assert.equal(mayStartGuest({ storage, ...back }), true, 'no one signed out: today\'s behavior')
  markSignedOut(storage)
  assert.equal(mayStartGuest({ storage, ...back }), false, 'Back after Sign out makes no guest')
  assert.equal(mayStartGuest({ storage, navigationType: 'POP', firstEntry: false }), false)
  assert.equal(mayStartGuest({ storage, navigationType: 'PUSH' }), true, 'Start a slate on the sign-in page')
  assert.equal(mayStartGuest({ storage, navigationType: 'POP', firstEntry: true, documentNavigation: 'navigate' }), true, 'a /new link opened afresh')
})

test('after a session ends: a member goes to sign in, a page load that failed to resume is only marked', () => {
  const none = { mark: false, clear: false, go: null }
  assert.deepEqual(afterLogout({ leaving: true, memberInPage: true, path: '/canvas/x' }), none, 'our own Sign out is already leaving')
  assert.deepEqual(afterLogout({ quiet: true, memberInPage: true, path: '/login-link/t' }), none, 'a page that logs out on purpose goes on by itself')
  assert.deepEqual(afterLogout({ path: '/canvas/x' }), none, 'a guest whose session ended')
  assert.deepEqual(afterLogout({ memberInPage: true, path: '/canvas/x' }), { mark: true, clear: true, go: '/login' }, 'signed out in another tab, or the token was revoked')
  assert.deepEqual(afterLogout({ memberInPage: true, memberStored: true, path: '/login' }), { mark: true, clear: true, go: null }, 'already on the sign-in page')
  assert.deepEqual(afterLogout({ memberStored: true, path: '/canvas/shared' }), { mark: true, clear: true, go: null }, 'an expired token on load: a shared link still opens')
})

test('Sign out marks the browser, ends the session, clears its keys and leaves for the sign-in page', async () => {
  const storage = store({ 'Meteor.loginToken': 'tok', 'Meteor.userId': 'u1', [MEMBER_KEY]: 'u1' })
  const calls = []
  const ended = await signOutAndLeave({
    logout: async () => { calls.push(['logout', isSignedOut(storage)]) },
    logoutHere: async () => calls.push(['here']),
    storage,
    leave: path => calls.push(['leave', path]),
  })
  assert.equal(ended, true)
  assert.deepEqual(calls, [['logout', true], ['leave', '/login']], 'marked before the session ends, so no page in between makes a guest')
  assert.deepEqual(storage.keys(), [SIGNED_OUT_KEY])
  assert.equal(storedMember(storage), null)
})

test('Sign out still leaves when the server refuses or cannot be reached', async () => {
  for (const logout of [async () => { throw new Error('offline') }, () => new Promise(() => {})]) {
    const storage = store({ 'Meteor.loginToken': 'tok' })
    const calls = []
    rememberMember(storage, 'u1')
    const ended = await signOutAndLeave({ logout, logoutHere: async () => calls.push('here'), storage, leave: path => calls.push(path), timeoutMs: 5 })
    assert.equal(ended, false)
    assert.deepEqual(calls, ['here', '/login'])
    assert.equal(storage.getItem('Meteor.loginToken'), null)
    assert.equal(isSignedOut(storage), true)
  }
})

test('the account menu signs out to the sign-in page, not to My slates', () => {
  const menu = app('imports/ui/components/AccountMenu.jsx')
  assert.match(menu, /import \{ signOut as signOutAndLeave \} from '..\/..\/api\/client\/signOut'/)
  assert.match(menu, /const signOut = \(\) => \{ setMainDrawerOpen\(false\); signOutAndLeave\(\) \}/)
  assert.doesNotMatch(menu, /Meteor\.logout\(/, 'every Sign out goes through the one helper')
  const client = app('imports/api/client/signOut.js')
  assert.match(client, /window\.location\.replace\(path\)/, 'a whole new page load: nothing of the session stays in memory')
  assert.match(client, /Accounts\.onLogout\(/)
  assert.match(client, /Accounts\.onLogin\(\(\) => clearSignedOut/)
  assert.match(app('client/main.jsx'), /import '..\/imports\/api\/client\/signOut'/, 'watching for a session ending starts with the app')
})

test('private pages send someone who signed out to sign in; guest-making pages are gated', () => {
  const routes = app('imports/ui/SBRoutes.jsx')
  assert.match(routes, /<Navigate to=\{signedOutPath\(\)\} replace \/>/)
  assert.doesNotMatch(routes, /function PrivateRoute[\s\S]{0,300}<Navigate to="\/start"/)
  assert.match(app('imports/ui/pages/SignUp.jsx'), /export default function SignUp\(\) \{\n  return <GuestStartGate><StartSignUp \/><\/GuestStartGate>/)
  const main = app('client/main.jsx')
  assert.match(main, /<GuestStartGate><GetStarted \/><\/GuestStartGate>/)
  assert.match(main, /<GuestStartGate><NewCreativeSlate fromBrief \/><\/GuestStartGate>/)
  assert.match(main, /path="\/new\/:creativeKind" element=\{<GuestStartGate><NewCreativeSlate \/><\/GuestStartGate>\}/)
  const gate = app('imports/ui/components/GuestStartGate.jsx')
  assert.match(gate, /if \(!userId && !loggingIn && !mayStart\) return <Navigate replace to=\{SIGN_IN_PATH\} \/>/)
  // The canvas makes no guest by itself: a shared link opened signed out is a visitor, as before.
  assert.doesNotMatch(app('imports/ui/pages/Canvas.jsx'), /createAnonymousUser/)
})
