// A self-hosted Slatebox: nobody signs up until its first admin exists. The setup link's rules
// (web/app/server/self-host-setup/core.mjs), the container's link maker
// (self-host/rootfs/opt/slatebox/lib/setup-link.mjs) held to the same hash and record, and the
// wiring that makes the gate hold on the server (validateNewUser, users.identify, the SSO callback).
// Plain modules: node --test alone. The image test self-host/tests/setup.test.mjs proves the whole
// flow in a real container.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(root + path, 'utf8')
const core = await import(root + 'web/app/server/self-host-setup/core.mjs')
const image = await import(root + 'self-host/rootfs/opt/slatebox/lib/setup-link.mjs')

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0)
const SELF = { public: { env: 'selfhost', edition: 'self-host' } }

test('only a self-hosted Slatebox has a setup step; Slatebox Cloud never does', () => {
  assert.equal(core.setupApplies(SELF), true)
  assert.equal(core.setupApplies({ public: { env: 'production', edition: 'cloud' } }), false)
  assert.equal(core.setupApplies({ public: { env: 'production' } }), false)
  assert.equal(core.setupApplies({ public: { env: 'selfhost', edition: 'cloud' } }), false, 'a Cloud edition is never gated, whatever env says')
  assert.equal(core.setupApplies({}), false)
  assert.equal(core.setupApplies(undefined), false)
  // The image renders exactly the settings the gate looks for.
  assert.match(read('self-host/rootfs/opt/slatebox/lib/configure.mjs'), /env: 'selfhost', edition: 'self-host'/)
})

test('a link is 32 random bytes; only its SHA-256 is kept, for 24 hours', () => {
  const token = core.newSetupToken()
  assert.equal(core.tokenShape(token), true)
  assert.equal(Buffer.from(token, 'base64url').length, 32)
  assert.notEqual(core.newSetupToken(), token)
  const record = core.newLinkRecord(token, NOW)
  assert.deepEqual(Object.keys(record).sort(), ['createdAt', 'expiresAt', 'tokenHash'])
  assert.equal(record.tokenHash, createHash('sha256').update(token).digest('hex'))
  assert.ok(!JSON.stringify(record).includes(token), 'the token itself is never stored')
  assert.equal(record.expiresAt.getTime() - NOW, 24 * 3600_000)
})

test('the container makes the link the app accepts: one hash, one record, one id, one collection', () => {
  const { token, record } = image.newLink(NOW)
  assert.equal(core.tokenShape(token), true)
  assert.deepEqual(record, core.newLinkRecord(token, NOW))
  assert.equal(image.hashSetupToken(token), core.hashSetupToken(token))
  assert.equal(image.SETUP_ID, core.SETUP_ID)
  assert.equal(image.SETUP_TTL_MS, core.SETUP_TTL_MS)
  assert.equal(image.COLLECTION, 'systemSettings')
  assert.match(read('web/app/imports/api/common/models.js'), /SystemSettings = new Mongo\.Collection\('systemSettings'\)/)
  assert.equal(core.linkState({ _id: core.SETUP_ID, ...record }, token, NOW + 1000), 'ok')
})

test('a link opens once, until it expires or a newer one replaces it', () => {
  const token = core.newSetupToken()
  const doc = { _id: core.SETUP_ID, ...core.newLinkRecord(token, NOW) }
  assert.equal(core.linkState(doc, token, NOW + 60_000), 'ok')
  assert.equal(core.linkState(doc, token, NOW + 24 * 3600_000), 'expired')
  assert.equal(core.linkState(doc, core.newSetupToken(), NOW), 'invalid', 'another token')
  assert.equal(core.linkState(doc, token.slice(0, -1), NOW), 'invalid', 'a token copied incompletely')
  assert.equal(core.linkState(doc, `${token}x`, NOW), 'invalid')
  assert.equal(core.linkState({ ...doc, claimedAt: new Date(NOW) }, token, NOW), 'invalid', 'being used right now')
  const replaced = { _id: core.SETUP_ID, ...core.newLinkRecord(core.newSetupToken(), NOW + 1) }
  assert.equal(core.linkState(replaced, token, NOW + 2), 'invalid', 'a new link ends the old one')
  assert.equal(core.linkState(null, token, NOW), 'invalid')
  assert.equal(core.linkState(undefined, undefined, NOW), 'invalid')
  // Done: the hash is removed with the same update that records the admin.
  const done = core.completedModifier('u1', { via: 'password', now: NOW })
  assert.deepEqual(done.$set, { completedAt: new Date(NOW), adminUserId: 'u1', via: 'password' })
  assert.ok('tokenHash' in done.$unset && 'expiresAt' in done.$unset && 'claimedAt' in done.$unset)
  assert.equal(core.linkState({ _id: core.SETUP_ID, completedAt: new Date(NOW) }, token, NOW), 'set-up')
})

test('the claim matches one unexpired, unused, unfinished link by its hash, so a second use matches nothing', () => {
  const token = core.newSetupToken()
  const filter = core.claimFilter(token, NOW)
  assert.deepEqual(filter, {
    _id: core.SETUP_ID, tokenHash: core.hashSetupToken(token), expiresAt: { $gt: new Date(NOW) },
    completedAt: { $exists: false }, claimedAt: { $exists: false },
  })
})

test('set up: a first admin from a link, or accounts from before setup links existed', () => {
  assert.equal(core.isSetUp(null), false)
  assert.equal(core.isSetUp({ tokenHash: 'x' }), false)
  assert.equal(core.isSetUp({ completedAt: new Date() }), true)
  assert.equal(core.isSetUp(null, { registeredAccount: true }), true)
})

test('before setup every page is the "isn\'t set up yet" page; health, files, live data, the API and sign-in round trips are not pages', () => {
  for (const url of ['/', '/login', '/signup', '/canvas/abc123', '/profile?tab=developer', '/team', '/start', '/embed/xyz', '/setup']) {
    assert.equal(core.gatedRequest('GET', url), url !== '/setup', url)
  }
  assert.equal(core.gatedRequest('HEAD', '/'), true)
  for (const url of ['/readyz', '/setup/abc', '/sockjs/info', '/websocket', '/api/v1/slates/x', '/sso/login', '/sso/callback?code=1',
    '/oauth/token', '/.well-known/oauth-authorization-server', '/__meteor__/dynamic-import/fetch', '/live/', '/fonts/inter.woff2',
    '/packages/x.js', '/app.js?hash=1', '/favicon.ico', '/merged-stylesheets.css']) {
    assert.equal(core.gatedRequest('GET', url), false, url)
  }
  assert.equal(core.gatedRequest('POST', '/'), false, 'only page loads are answered by the gate; methods are refused on the server')
})

test('setup paths', () => {
  assert.deepEqual(core.parseSetupPath('/setup/abc'), { token: 'abc', sso: false })
  assert.deepEqual(core.parseSetupPath('/setup/abc/'), { token: 'abc', sso: false })
  assert.deepEqual(core.parseSetupPath('/setup/abc/sso'), { token: 'abc', sso: true })
  assert.deepEqual(core.parseSetupPath('/setup/abc?x=1'), { token: 'abc', sso: false })
  assert.equal(core.parseSetupPath('/setup/'), null)
  assert.equal(core.parseSetupPath('/setup/a/b'), null)
  assert.equal(core.parseSetupPath('/login'), null)
})

test('the form: a name, an email, a password of at least 8 characters, and the team\'s name', () => {
  const values = core.parseForm('firstName=+Ada+&lastName=Lovelace&email=ADA%40Example.test&password=correct+horse&team=Acme')
  assert.deepEqual(values, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', password: 'correct horse', team: 'Acme' })
  assert.deepEqual(core.formErrors(values), {})
  const bad = core.formErrors(core.parseForm('email=nope&password=short'))
  assert.deepEqual(Object.keys(bad).sort(), ['email', 'firstName', 'password', 'team'])
  assert.match(bad.password, /at least 8/)
  assert.deepEqual(core.formErrors({ ...values, password: 'x'.repeat(257) }).password, 'Choose a password of at most 256 characters.')
  // Single sign-on asks only for the team: the account comes from the identity provider.
  assert.deepEqual(core.formErrors({ team: 'Acme' }, { passwords: false }), {})
  assert.deepEqual(Object.keys(core.formErrors({ team: '' }, { passwords: false })), ['team'])
  assert.equal(core.parseForm('team=' + 'x'.repeat(500)).team.length, 120)
})

test('a team address suggests the team\'s name', () => {
  assert.equal(core.suggestedTeam('https://acme.slatebox.team/'), 'Acme')
  assert.equal(core.suggestedTeam('https://north-star.slatebox.team'), 'North Star')
  assert.equal(core.suggestedTeam('https://boards.example.com'), '')
  assert.equal(core.suggestedTeam('http://localhost:7070'), '')
  assert.equal(core.suggestedTeam('not a url'), '')
})

test('the "isn\'t set up yet" page: calm, no sign-up form, no guest start, says where the link comes from', () => {
  const html = core.notSetUpPage()
  assert.match(html, /This Slatebox isn't set up yet/)
  assert.match(html, /setup link from your install/)
  assert.match(html, /slatebox setup-link/)
  assert.doesNotMatch(html, /<form|<input|<script|Start now|sign up free/i)
  assert.doesNotMatch(html, /https?:\/\//, 'nothing from any other address')
  assert.doesNotMatch(html, /\bAI\b/)
})

test('the setup form posts back to its own link; single sign-on is offered beside it, or alone under SSO only', () => {
  const token = core.newSetupToken()
  const plain = core.setupFormPage({ token, values: { team: 'Acme' } })
  assert.match(plain, new RegExp(`<form method="post" action="/setup/${token}">`))
  for (const name of ['firstName', 'lastName', 'email', 'password', 'team']) assert.match(plain, new RegExp(`name="${name}"`))
  assert.match(plain, /value="Acme"/)
  assert.match(plain, /server's administrator and the owner of its first team/)
  assert.doesNotMatch(plain, /single sign-on/)
  const both = core.setupFormPage({ token, sso: { only: false } })
  assert.match(both, /name="password"/)
  assert.match(both, new RegExp(`action="/setup/${token}/sso"`))
  const only = core.setupFormPage({ token, sso: { only: true } })
  assert.doesNotMatch(only, /name="password"/)
  assert.match(only, /Continue with single sign-on/)
  // What a person typed comes back escaped, and the password never comes back.
  const again = core.setupFormPage({ token, values: { firstName: '<b>x</b>', email: 'a"b@c.d', password: 'hunter22' }, errors: { email: 'Enter your email address.' } })
  assert.match(again, /&lt;b&gt;x&lt;\/b&gt;/)
  assert.match(again, /a&quot;b@c\.d/)
  assert.doesNotMatch(again, /hunter22/)
  assert.match(again, /Enter your email address\./)
})

test('a link that does not work says why and how to get a new one, without a form', () => {
  for (const state of ['expired', 'invalid']) {
    const html = core.linkProblemPage(state)
    assert.match(html, /slatebox setup-link/)
    assert.doesNotMatch(html, /<form/)
  }
  assert.match(core.linkProblemPage('expired'), /24 hours/)
  assert.match(core.linkProblemPage('set-up'), /already set up/)
  assert.match(core.linkProblemPage('set-up'), /href="\/login"/)
})

test('the setup pages are never cached, framed or sent on as a referrer; only the signed-in page runs a script, by nonce', () => {
  const headers = core.pageHeaders()
  assert.equal(headers['Cache-Control'], 'no-store')
  assert.equal(headers['Referrer-Policy'], 'no-referrer')
  assert.equal(headers['X-Frame-Options'], 'DENY')
  assert.match(headers['Content-Security-Policy'], /default-src 'none'/)
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/)
  assert.doesNotMatch(headers['Content-Security-Policy'], /script-src/)
  assert.match(core.pageHeaders('n0nce')['Content-Security-Policy'], /script-src 'nonce-n0nce'/)
  const signed = core.signedInPage({ userId: 'u1', token: 'resume</script>', expires: NOW, nonce: 'n0nce' })
  assert.match(signed, /<script nonce="n0nce">/)
  assert.match(signed, /localStorage\.setItem\('Meteor\.loginToken'/)
  assert.match(signed, /localStorage\.setItem\('Meteor\.userId'/)
  assert.doesNotMatch(signed, /resume<\/script>/, 'a value cannot close the script')
  assert.match(signed, /location\.replace\('\/'\)/)
})

test('the setup cookie lives only for the single sign-on round trip, HttpOnly', () => {
  const cookie = core.setupCookie('tok', { secure: true })
  assert.match(cookie, /^slatebox_setup=tok; Path=\/; HttpOnly; SameSite=Lax; Max-Age=900; Secure$/)
  assert.match(core.setupCookie('', { secure: false, clear: true }), /^slatebox_setup=; .*Max-Age=0$/)
  assert.equal(core.cookieValue('a=1; slatebox_setup=tok; b=2', 'slatebox_setup'), 'tok')
  assert.equal(core.cookieValue('', 'slatebox_setup'), undefined)
})

test('the server holds the gate: no account of any kind before setup, on self-host only', () => {
  const meteor = read('web/app/server/self-host-setup/meteor.js')
  const state = read('web/app/server/self-host-setup/state.js')
  // Registered only where it applies.
  assert.match(state, /export const setupAppliesHere = setupApplies\(Meteor\.settings\)/)
  assert.match(meteor, /if \(applies\) \{\n {2}Accounts\.validateNewUser\(/)
  // Every account goes through validateNewUser: sign-up, guests, invitations and single sign-on.
  assert.match(meteor, /if \(making\.get\(\) === true\) return true\n {4}if \(await setupRequired\(\)\) throw new Meteor\.Error\(403, NOT_SET_UP_MESSAGE\)/)
  assert.match(read('web/app/server/common/accounts.js'), /Accounts\.createUserAsync/)
  assert.match(read('web/app/server/sso/index.js'), /Accounts\.insertUserDoc/)
  // A guest from before setup links cannot save itself into an account before setup either.
  assert.match(read('web/app/server/methods/users.js'), /if \(user\.isAnonymous && await setupRequired\(\)\) throw new Meteor\.Error\('not-set-up', NOT_SET_UP_MESSAGE\)/)
  // Loaded by the server.
  assert.match(read('web/app/server/main.js'), /import '\.\/self-host-setup\/meteor'/)
  // The first account: server administrator (uberMensch) and owner of the first team.
  assert.match(meteor, /Permissions\.insertAsync\(\{ userId, claimId: CONSTANTS\.claims\.uberMensch\._id \}\)/)
  assert.match(meteor, /createTeamFor\(user, teamName/)
  assert.match(read('web/app/server/methods/organizations.js'), /export async function createTeamFor\(user, teamName\)/)
  // Once: claimed atomically before the account is made, and released if it cannot be made.
  assert.ok(meteor.indexOf('claimFilter(token)') < meteor.indexOf('making.withValue(true'))
  // Installs that had accounts before setup links existed are set up.
  assert.match(meteor, /isAnonymous: \{ \$ne: true \}/)
})

test('the first single sign-on through the setup link makes the server administrator', () => {
  const sso = read('web/app/server/sso/index.js')
  assert.match(sso, /const setup = await pendingSsoSetup\(req\)/)
  assert.match(sso, /completeSetupWith\(setup\.token, \(\) => accountFor\(sso, result\.claims, result\.refreshToken\), \{ teamName: setup\.teamName, via: 'sso' \}\)/)
  assert.match(sso, /setup \? \[clear, clearSetupCookie\(\)\] : clear/)
})

test('a setup link or token is never logged', () => {
  for (const path of ['web/app/server/self-host-setup/meteor.js', 'web/app/server/self-host-setup/state.js', 'self-host/rootfs/opt/slatebox/lib/setup-link.mjs']) {
    const source = read(path)
    for (const call of source.match(/console\.(log|error|warn)\([^\n]*/g) || []) {
      assert.doesNotMatch(call, /token|req\.url|link\.url|\.url\b/i, `${path}: ${call}`)
    }
  }
  // The container prints the link on stdout for the person who asked, and nothing else carries it.
  const maker = read('self-host/rootfs/opt/slatebox/lib/setup-link.mjs')
  assert.equal((maker.match(/link\.url/g) || []).length, 1)
  assert.doesNotMatch(maker, /process\.stderr\.write\([^)]*(token|link\.url)/)
})

test('the container lists setup-link among its commands, so an installer knows it can ask', async () => {
  const { COMMANDS } = await import(root + 'self-host/rootfs/opt/slatebox/lib/settings.mjs')
  assert.ok(COMMANDS.includes('setup-link'))
  const bin = read('self-host/rootfs/opt/slatebox/bin/slatebox')
  assert.match(bin, /setup-link\) shift; setup_link "\$@" ;;/)
  assert.equal(image.ALREADY_SET_UP, 3)
})
