// Passkeys in the app's pages (2026-11-26): the sign-in page's button and autofill, the account
// form's "Use a passkey instead of a password" (sign-up and saving a guest), and Profile › Sign-in
// (add, name, last used, remove, never the last way in). Source guards and the pure copy; the
// prompts themselves need a real browser (see the report for what to prove there).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = (path) => readFileSync(new URL(`../web/app/imports/ui/${path}`, import.meta.url), 'utf8')
const repo = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const copy = await import('../web/app/imports/ui/passkeys/passkey-copy.mjs')
const request = await import('../web/app/imports/ui/passkeys/passkey-request.mjs')
const { registrationCopy } = await import('../web/app/imports/ui/common/accountCopy.mjs')
const { isClaimFormComplete, markClaimFieldsInvalid } = await import('../web/app/imports/ui/common/guestRegistration.mjs')

test('the sign-in page: the email field offers passkeys in autofill, and a "Sign in with a passkey" button; none under SSO only', () => {
  const login = ui('pages/Login.jsx')
  assert.match(login, /autoComplete="username webauthn"/)
  assert.match(login, /import PasskeySignIn from '\.\.\/passkeys\/PasskeySignIn'/)
  assert.match(login, /<PasskeySignIn onSignedIn=\{passkeySignedIn\} onError=\{passkeyFailed\} \/>/)
  // Inside the part of the page "SSO only" leaves out.
  assert.ok(login.indexOf('{sso.only ? null : <>') < login.indexOf('<PasskeySignIn'), 'hidden under SSO only')
  assert.match(login, /const passkeySignedIn = \(\) => \{\s*rememberSignedIn\(globalThis\.localStorage\)\s*history\(destination\)/)
  const signIn = ui('passkeys/PasskeySignIn.jsx')
  assert.match(signIn, /if \(!await passkeysAvailable\(\) \|\| !mounted\.current\) return/)
  assert.match(signIn, /if \(!await autofillAvailable\(\) \|\| !mounted\.current\) return/)
  assert.match(signIn, /signInWithPasskey\(\{ autofill: true \}\)/)
  assert.match(signIn, /if \(autofill\) cancelPasskeyPrompt\(\)/, 'leaving the page stops the waiting autofill request')
  assert.match(signIn, /PASSKEY_WORDS\.signIn/)
  assert.equal(copy.PASSKEY_WORDS.signIn, 'Sign in with a passkey')
})

test('the browser side asks the server for every challenge and signs in through the passkey login handler', () => {
  const client = ui('passkeys/passkeys.js')
  assert.match(client, /from '@simplewebauthn\/browser'/)
  assert.match(client, /Accounts\.callLoginMethod\(\{ methodArguments: \[\{ passkey: response \}\]/)
  assert.match(client, /startAuthentication\(authenticationRequest\(optionsJSON, \{ autofill, gesture \}\)\)/)
  assert.equal((client.match(/startAuthentication\(/g) || []).length, 1, 'one call, through authenticationRequest')
  assert.match(client, /Meteor\.callAsync\(M\.loginOptions\)/)
  assert.match(client, /Meteor\.callAsync\(M\.registerOptions\)/)
  assert.match(client, /Meteor\.callAsync\(M\.claimOptions, \{ email \}\)/)
  // The device's passkey list is kept in step: an unknown passkey, a removal, the account's details.
  assert.match(client, /signalName: 'unknownCredential'/)
  assert.match(client, /signalName: 'allAcceptedCredentials'/)
  assert.match(client, /signalName: 'currentUserDetails'/)
  assert.doesNotMatch(client, /challenge\s*[:=]\s*['"`]|crypto\.getRandomValues/, 'no challenge is made in the browser')
})

test('sign-up and saving a guest: a passkey instead of a password, with the same verification email', () => {
  const form = ui('common/Register.jsx')
  assert.match(form, /passkeysAvailable\(\)\.then/)
  assert.match(form, /\{isAnon && !passkeyChosen && \(\s*<TextField/, 'no password field once a passkey is chosen')
  assert.match(form, /passkeyChosen \? PASSKEY_WORDS\.usePassword : PASSKEY_WORDS\.useInstead/)
  assert.match(form, /saveAccountWithPasskey\(\{/)
  assert.match(form, /isClaimFormComplete\(formVals, \{ passkey \}\)/)
  assert.match(form, /registrationCopy\(\{ guest: isAnon, intent: getRegistrationDetails\.intent, emailSent, passkey: passkeyChosen \}\)/)
  // SignUp still starts a guest and opens this form: sign-up with a passkey is the same path.
  assert.match(ui('pages/SignUp.jsx'), /intent: 'signup'/)
  assert.deepEqual(registrationCopy({ guest: true, intent: 'signup', passkey: true }), {
    heading: 'Create your account',
    lede: 'Add your email, then create a passkey on this device. You sign in with your fingerprint, face, PIN or screen lock. No password to remember.',
    action: 'Create account with a passkey',
    dismiss: 'Not now',
    emailHelper: 'We’ll send a link to confirm it’s you.',
  })
  assert.equal(registrationCopy({ guest: true, passkey: true }).action, 'Save with a passkey')
  assert.equal(registrationCopy({ guest: false, passkey: true }).heading, 'Verify your email', 'a saved account verifies as before')
  // The form is complete with an email alone when a passkey is chosen.
  const form0 = { firstName: { value: '' }, lastName: { value: '' }, email: { value: 'a@b.co', valid: true }, password: { value: '', valid: null } }
  assert.equal(isClaimFormComplete(form0), false)
  assert.equal(isClaimFormComplete(form0, { passkey: true }), true)
  assert.deepEqual(markClaimFieldsInvalid(form0, { passkey: true }).password, form0.password)
  assert.equal(markClaimFieldsInvalid(form0).password.valid, false)
})

test('Profile › Sign-in: passkeys listed with last used, added, renamed, removed; the password beside them', () => {
  const profile = ui('pages/Profile.jsx')
  assert.match(profile, /<Tab label="Sign-in" value="sign-in"/)
  assert.match(profile, /TABS = \{[^}]*'sign-in': 'sign-in'/)
  assert.match(profile, /<TabPanel value=\{tabValue\} index="sign-in">\s*<AccountPanel>\s*<SignInSettings/)
  assert.match(profile, /passwordForm=\{\(/)
  const signIn = ui('components/profile/SignInSettings.jsx')
  for (const call of ['addPasskey()', 'renamePasskey(editing.id, editing.name)', 'removePasskey(passkey.id', 'listPasskeys()']) assert.ok(signIn.includes(call), call)
  assert.match(signIn, /secondary=\{passkeyDates\(passkey\)\}/)
  assert.match(signIn, /disabled=\{!removable\}/)
  assert.match(signIn, /const removable = mayRemove\(\{ passkeys, hasPassword: state\?\.hasPassword \}\)/)
  assert.match(signIn, /escapeHtml\(PASSKEY_WORDS\.removeMessage\(passkey\.name\)\)/, 'a passkey name is text in the confirm dialog')
  assert.match(signIn, /CONSTANTS\.methods\.users\.resetPassword/, 'a passkey-only account sets a password through the emailed link')
  assert.match(signIn, /PASSKEY_WORDS\.recovery/)
  // The notice email links here.
  assert.match(repo('web/app/server/passkeys/meteor.js'), /\/profile\?tab=sign-in/)
})

test('one way in always remains, and the dates read plainly', () => {
  assert.equal(copy.mayRemove({ passkeys: [{}], hasPassword: false }), false)
  assert.equal(copy.mayRemove({ passkeys: [{}, {}], hasPassword: false }), true)
  assert.equal(copy.mayRemove({ passkeys: [{}], hasPassword: true }), true)
  assert.equal(copy.mayRemove(), false)
  const now = new Date(2026, 10, 26, 15, 0).getTime()
  assert.equal(copy.passkeyDates({ createdAt: new Date(2026, 10, 3, 9), lastUsedAt: null }, now), 'Added Nov 3, 2026 · Never used')
  assert.equal(copy.passkeyDates({ createdAt: new Date(2026, 10, 3, 9), lastUsedAt: new Date(2026, 10, 26, 8) }, now), 'Added Nov 3, 2026 · Last used today')
  assert.equal(copy.passkeyDates({ createdAt: new Date(2026, 10, 3, 9), lastUsedAt: new Date(2026, 10, 25, 22) }, now), 'Added Nov 3, 2026 · Last used yesterday')
  assert.equal(copy.passkeyDates({ createdAt: new Date(2026, 10, 3, 9), lastUsedAt: new Date(2026, 9, 1) }, now), 'Added Nov 3, 2026 · Last used Oct 1, 2026')
  assert.equal(copy.nameProblem(''), 'Give the passkey a name.')
  assert.equal(copy.nameProblem('x'.repeat(61)), 'Use 60 characters or fewer.')
  assert.equal(copy.nameProblem(' Phone '), null)
})

test('a closed prompt says nothing; a real problem says what to do; a server refusal keeps its words', () => {
  assert.equal(copy.browserErrorText({ name: 'NotAllowedError' }), null)
  assert.equal(copy.browserErrorText({ name: 'AbortError' }), null)
  assert.equal(copy.browserErrorText({ code: 'ERROR_CEREMONY_ABORTED' }), null)
  assert.match(copy.browserErrorText({ code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' }), /already has a passkey/)
  assert.match(copy.browserErrorText({ name: 'SecurityError' }), /usual address/)
  assert.equal(copy.browserErrorText({ error: 'last-way-in', reason: 'This is your only way to sign in.' }), 'This is your only way to sign in.')
  assert.match(copy.browserErrorText(new Error('boom')), /did not work/)
})

test('the words: "passkey", plain, US spelling, no "AI", and the self-host README says how passkeys follow the address, never payments', () => {
  const words = [...Object.values(copy.PASSKEY_WORDS).filter((w) => typeof w === 'string'), copy.PASSKEY_WORDS.removeMessage('Phone')]
  for (const text of words) {
    assert.doesNotMatch(text, /WebAuthn|credential|FIDO|authenticator|\bAI\b|cancelled|colour|organis|recognis|licence/i, text)
  }
  assert.ok(words.some((text) => /passkey/.test(text)))
  const readme = repo('self-host/README.md')
  const section = readme.slice(readme.indexOf('## Passkeys'), readme.indexOf('## Move to Slatebox Cloud'))
  assert.match(section, /host of `SLATEBOX_URL`/)
  assert.match(section, /`https:\/\/` address, or `http:\/\/localhost`/)
  assert.match(section, /Email me a sign-in link/)
  assert.match(section, /SLATEBOX_SSO_ONLY=true`, passkeys are off/)
  assert.doesNotMatch(section, /\bPro\b|pay|price|stripe|balance|meter|\bAI\b/i)
})

// 2026-11-26 (mobile viewer proof): inside the app's system-browser sign-in sheet, iOS raised its passkey
// sheet ("Scan QR Code / Use Security Key") on the sign-in page uninvited.
test('autofill is conditional only, and the modal passkey prompt needs the person\'s own click', () => {
  const opts = { challenge: 'c', rpId: 'x.test' }
  assert.deepEqual(request.authenticationRequest(opts, { autofill: true }), { optionsJSON: opts, useBrowserAutofill: true })
  assert.deepEqual(request.authenticationRequest(opts, { autofill: true, gesture: false }), { optionsJSON: opts, useBrowserAutofill: true })
  assert.deepEqual(request.authenticationRequest(opts, { gesture: true }), { optionsJSON: opts, useBrowserAutofill: false })
  // No gesture, no prompt: nothing on load, nothing from a script, nothing from a truthy non-true value.
  for (const how of [undefined, {}, { autofill: false }, { gesture: false }, { gesture: 1 }, { gesture: 'yes' }, { autofill: 'true' }]) {
    assert.throws(() => request.authenticationRequest(opts, how), (error) => error.code === request.UNINVITED && error.name === 'NotAllowedError', JSON.stringify(how))
  }
  // The refusal is silent (no error message on the page).
  assert.equal(copy.browserErrorText(Object.assign(new Error('x'), { code: request.UNINVITED })), null)
  assert.equal(request.isGesture({ isTrusted: true }), true)
  for (const event of [undefined, null, {}, { isTrusted: false }, { isTrusted: 'true' }]) assert.equal(request.isGesture(event), false)
})

test('no sign-in field takes focus on load on a touch device', () => {
  const at = (coarse) => ({ matchMedia: (query) => ({ matches: query === '(pointer: coarse)' ? coarse : false }) })
  assert.equal(request.focusOnLoad(at(true)), false)
  assert.equal(request.focusOnLoad(at(false)), true)
  assert.equal(request.focusOnLoad({ matchMedia: () => { throw new Error('no') } }), false)
  const login = ui('pages/Login.jsx')
  assert.match(login, /const \[focusFirst\] = React\.useState\(\(\) => focusOnLoad\(\)\)/)
  assert.match(login, /autoFocus=\{focusFirst && !email\}/)
  assert.match(login, /autoFocus=\{focusFirst && !!email\}/)
  assert.doesNotMatch(login, /autoFocus=\{!!?email\}/)
})

test('the sign-in page never opens the passkey prompt by itself: only the button\'s trusted click does', () => {
  const signIn = ui('passkeys/PasskeySignIn.jsx')
  const client = ui('passkeys/passkeys.js')
  // The effect that runs on load only ever asks for autofill.
  const effect = signIn.slice(signIn.indexOf('useEffect('), signIn.indexOf('}, [])'))
  assert.equal((effect.match(/signInWithPasskey\(/g) || []).length, 1)
  assert.match(effect, /signInWithPasskey\(\{ autofill: true \}\)/)
  // The button: a trusted click, then gesture: true.
  assert.match(signIn, /const start = async \(event\) => \{\s*\/\/[^\n]*\n\s*if \(!isGesture\(event\)\) return/)
  assert.match(signIn, /signInWithPasskey\(\{ gesture: true \}\)/)
  assert.match(signIn, /onClick=\{start\}/)
  // The guard runs before the server is asked for a challenge.
  assert.ok(client.indexOf('authenticationRequest(null, { autofill, gesture })') < client.indexOf('Meteor.callAsync(M.loginOptions)'))
  // Nothing else in the app calls navigator.credentials.get or startAuthentication directly.
  assert.doesNotMatch(signIn + ui('pages/Login.jsx'), /navigator\.credentials|startAuthentication/)
})
