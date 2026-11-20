// Sign in with SSO (OpenID Connect, authorization code + PKCE): the callback, how an SSO
// identity finds its Slatebox account, and what "SSO only" refuses. The modules under test are
// plain ES modules with no Meteor import, so these run with `node --test` alone. The whole flow
// against a real Keycloak is proven by self-host/tests/sso.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = (path) => readFileSync(app + path, 'utf8')
const oidc = await import(app + 'server/sso/oidc.mjs')
const accounts = await import(app + 'server/sso/accounts.mjs')
const policy = await import(app + 'server/sso/policy.mjs')

const KEY = 'k'.repeat(64)
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0)
const config = {
  issuer: 'https://boards.example.com/auth/realms/slatebox',
  authorizationEndpoint: 'https://boards.example.com/auth/realms/slatebox/protocol/openid-connect/auth',
  tokenEndpoint: 'http://127.0.0.1:8080/auth/realms/slatebox/protocol/openid-connect/token',
  clientId: 'slatebox',
  clientSecret: 'client-secret-for-tests',
  redirectUri: 'https://boards.example.com/sso/callback',
}

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const idToken = (claims) => `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(claims)}.signature-not-checked-on-the-back-channel`
const goodClaims = (nonce, extra = {}) => ({
  iss: config.issuer, aud: 'slatebox', azp: 'slatebox', sub: 'kc-user-1', nonce,
  exp: NOW / 1000 + 300, iat: NOW / 1000 - 5,
  email: 'Ada@Example.com', email_verified: true, given_name: 'Ada', family_name: 'Lovelace', ...extra,
})

/** A token endpoint that records what it was sent. */
function tokenEndpoint(reply) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(init.body), headers: init.headers, method: init.method })
    const { status = 200, body } = typeof reply === 'function' ? reply(calls.at(-1)) : reply
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  return { fetch, calls }
}

/** Start a sign-in the way /sso/login does and return what the browser carries back. */
function begin(next = '/') {
  const started = oidc.beginSignIn({ config, key: KEY, now: NOW, next })
  const url = new URL(started.url)
  return { started, url, state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce') }
}

test('the sign-in request uses PKCE with S256, a state and a nonce, and asks for an offline session', () => {
  const { started, url, state, nonce } = begin('/canvas/abc')
  assert.equal(url.origin + url.pathname, config.authorizationEndpoint)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('client_id'), 'slatebox')
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.deepEqual(url.searchParams.get('scope').split(' ').sort(), ['email', 'offline_access', 'openid', 'profile'])
  assert.ok(state.length >= 32 && nonce.length >= 32 && state !== nonce)
  // The verifier never leaves the server except inside the sealed cookie; the challenge is its hash.
  const opened = oidc.openState(KEY, started.cookie, NOW)
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(opened.verifier).digest('base64url'))
  assert.ok(!started.url.includes(opened.verifier))
  assert.equal(opened.next, '/canvas/abc')
})

test('only a path on this site is kept as the place to return to', () => {
  for (const next of ['https://evil.example/', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', '']) {
    const opened = oidc.openState(KEY, begin(next).started.cookie, NOW)
    assert.equal(opened.next, '/', next)
  }
})

test('the callback exchanges the code with the verifier and the client secret, on the back channel', async () => {
  const { started, state, nonce } = begin('/canvas/abc')
  const endpoint = tokenEndpoint({ body: { id_token: idToken(goodClaims(nonce)), access_token: 'at', refresh_token: 'rt-1', token_type: 'Bearer' } })
  const result = await oidc.completeSignIn({ config, key: KEY, now: NOW, cookie: started.cookie, query: { code: 'the-code', state }, fetch: endpoint.fetch })
  assert.equal(endpoint.calls.length, 1)
  const [call] = endpoint.calls
  assert.equal(call.url, config.tokenEndpoint)
  assert.equal(call.method, 'POST')
  assert.equal(call.body.get('grant_type'), 'authorization_code')
  assert.equal(call.body.get('code'), 'the-code')
  assert.equal(call.body.get('redirect_uri'), config.redirectUri)
  assert.equal(call.body.get('code_verifier'), oidc.openState(KEY, started.cookie, NOW).verifier)
  assert.equal(call.body.get('client_id'), 'slatebox')
  assert.equal(call.body.get('client_secret'), config.clientSecret)
  assert.equal(result.claims.sub, 'kc-user-1')
  assert.equal(result.refreshToken, 'rt-1')
  assert.equal(result.next, '/canvas/abc')
})

test('the callback refuses a forged, replayed, stale or mismatched sign-in before calling the token endpoint', async () => {
  const { started, state } = begin()
  const endpoint = tokenEndpoint({ body: {} })
  const attempt = (overrides) => oidc.completeSignIn({
    config, key: KEY, now: NOW, cookie: started.cookie, query: { code: 'c', state }, fetch: endpoint.fetch, ...overrides,
  })
  await assert.rejects(attempt({ cookie: undefined }), { code: 'no-sign-in' })
  await assert.rejects(attempt({ cookie: started.cookie.slice(0, -2) + 'xx' }), { code: 'no-sign-in' })
  await assert.rejects(attempt({ key: 'another key'.repeat(8) }), { code: 'no-sign-in' })
  await assert.rejects(attempt({ now: NOW + 11 * 60_000 }), { code: 'no-sign-in' })
  await assert.rejects(attempt({ query: { code: 'c', state: 'not-the-state' } }), { code: 'state' })
  await assert.rejects(attempt({ query: { state } }), { code: 'no-code' })
  await assert.rejects(attempt({ query: { error: 'access_denied', state } }), { code: 'denied' })
  assert.equal(endpoint.calls.length, 0)
})

test('the ID token must be for this client, from this issuer, for this sign-in, and current', async () => {
  const { started, state, nonce } = begin()
  const cases = {
    issuer: goodClaims(nonce, { iss: 'https://elsewhere.example/realms/slatebox' }),
    audience: goodClaims(nonce, { aud: 'another-app', azp: 'another-app' }),
    nonce: goodClaims('another-nonce'),
    expired: goodClaims(nonce, { exp: NOW / 1000 - 120 }),
    subject: goodClaims(nonce, { sub: '' }),
  }
  for (const [what, claims] of Object.entries(cases)) {
    const endpoint = tokenEndpoint({ body: { id_token: idToken(claims), refresh_token: 'rt' } })
    await assert.rejects(
      oidc.completeSignIn({ config, key: KEY, now: NOW, cookie: started.cookie, query: { code: 'c', state }, fetch: endpoint.fetch }),
      { code: 'id-token' }, what)
  }
  // An audience list that includes this client is accepted.
  const listed = tokenEndpoint({ body: { id_token: idToken(goodClaims(nonce, { aud: ['slatebox', 'account'] })), refresh_token: 'rt' } })
  await oidc.completeSignIn({ config, key: KEY, now: NOW, cookie: started.cookie, query: { code: 'c', state }, fetch: listed.fetch })
})

test('a token endpoint that refuses the code is reported, not trusted', async () => {
  const { started, state } = begin()
  const endpoint = tokenEndpoint({ status: 400, body: { error: 'invalid_grant' } })
  await assert.rejects(
    oidc.completeSignIn({ config, key: KEY, now: NOW, cookie: started.cookie, query: { code: 'c', state }, fetch: endpoint.fetch }),
    { code: 'token' })
})

test('an SSO identity signs in to its own account, links to a password account only by verified email, or makes one', () => {
  const identity = accounts.ssoIdentity(goodClaims('n'), config.issuer)
  assert.equal(identity.email, 'ada@example.com')
  assert.equal(identity.firstName, 'Ada')
  assert.equal(identity.lastName, 'Lovelace')

  const linked = { _id: 'u1', services: { sso: { issuer: config.issuer, subject: 'kc-user-1' } } }
  assert.deepEqual(accounts.decideAccount(identity, { bySubject: linked }), { action: 'login', userId: 'u1' })

  const password = { _id: 'u2', emails: [{ address: 'ada@example.com', verified: false }], services: { password: {} } }
  assert.deepEqual(accounts.decideAccount(identity, { byEmail: password }), { action: 'link', userId: 'u2' })

  assert.deepEqual(accounts.decideAccount(identity, {}), { action: 'create' })

  const unverified = accounts.ssoIdentity(goodClaims('n', { email_verified: false }), config.issuer)
  assert.equal(accounts.decideAccount(unverified, { byEmail: password }).action, 'refuse')
  assert.equal(accounts.decideAccount(unverified, {}).action, 'refuse')

  const noEmail = accounts.ssoIdentity(goodClaims('n', { email: undefined }), config.issuer)
  assert.equal(accounts.decideAccount(noEmail, {}).action, 'refuse')

  // An account already linked to another SSO identity is not taken over by a second one with the same email.
  const other = { ...password, services: { sso: { issuer: config.issuer, subject: 'kc-user-2' } } }
  assert.equal(accounts.decideAccount(identity, { byEmail: other }).action, 'refuse')
  // Nor is a guest.
  assert.equal(accounts.decideAccount(identity, { byEmail: { ...password, isAnonymous: true } }).action, 'refuse')
  // A disabled Slatebox account stays disabled.
  assert.equal(accounts.decideAccount(identity, { bySubject: { ...linked, isDisabled: true } }).action, 'refuse')
})

test('a new account from SSO carries its identity, a verified email and the names the provider gave', () => {
  const identity = accounts.ssoIdentity(goodClaims('n'), config.issuer)
  const user = accounts.newUserDocument(identity, 'rt-1', NOW)
  assert.deepEqual(user.emails, [{ address: 'ada@example.com', verified: true }])
  assert.deepEqual(user.profile, { firstName: 'Ada', lastName: 'Lovelace' })
  assert.equal(user.services.sso.subject, 'kc-user-1')
  assert.equal(user.services.sso.issuer, config.issuer)
  assert.equal(user.services.sso.refreshToken, 'rt-1')
  assert.equal(user.services.password, undefined)
})

test('settings: SSO is off unless configured, and "only" needs SSO on', () => {
  assert.equal(policy.ssoSettings({}), null)
  assert.equal(policy.ssoSettings({ sso: { enabled: false } }), null)
  const on = policy.ssoSettings({ sso: { enabled: true, only: true, issuer: config.issuer, clientId: 'slatebox', clientSecret: 's',
    authorizationEndpoint: config.authorizationEndpoint, tokenEndpoint: config.tokenEndpoint, redirectUri: config.redirectUri, stateKey: KEY } })
  assert.equal(on.only, true)
  assert.equal(on.checkSeconds, 60)
  // Accounts are linked to a provider name that survives a change of address; by default the issuer.
  assert.equal(on.provider, config.issuer)
  assert.equal(policy.ssoSettings({ sso: { ...on, provider: 'bundled-keycloak' } }).provider, 'bundled-keycloak')
  assert.throws(() => policy.ssoSettings({ sso: { enabled: true } }), /sso\.issuer/)
})

test('SSO only: a password sign-in, reset or sign-up is refused; a saved session and an SSO sign-in are not', () => {
  const only = { only: true }
  const open = { only: false }
  const password = { type: 'password', methodName: 'login', allowed: true }
  const reset = { type: 'password', methodName: 'resetPassword', allowed: true }
  const signUp = { type: 'password', methodName: 'createUser', allowed: true }
  const resume = { type: 'resume', methodName: 'login', allowed: true }
  const sso = { type: 'sso', methodName: 'login', allowed: true }
  for (const attempt of [password, reset, signUp]) {
    assert.match(policy.loginRefusal(attempt, only), /single sign-on/i, attempt.methodName)
    assert.equal(policy.loginRefusal(attempt, open), null)
    assert.equal(policy.loginRefusal(attempt, null), null)
  }
  for (const attempt of [resume, sso]) assert.equal(policy.loginRefusal(attempt, only), null)
})

test('SSO only: no guest and no self-made account; SSO accounts and team invitations are made', () => {
  const only = { only: true }
  assert.equal(policy.mayCreateUser({ isAnonymous: true, services: { password: {} } }, only), false)
  assert.equal(policy.mayCreateUser({ services: { password: {} } }, only), false)
  assert.equal(policy.mayCreateUser({ services: { sso: { subject: 's' } } }, only), true)
  assert.equal(policy.mayCreateUser({ orgId: 'team', services: { password: {} } }, only), true)
  for (const user of [{ isAnonymous: true }, {}]) {
    assert.equal(policy.mayCreateUser(user, { only: false }), true)
    assert.equal(policy.mayCreateUser(user, null), true)
  }
  // The routes around passwords are closed too.
  for (const name of ['forgotPassword', 'users.generateSpecialUseLoginToken', 'users.createAnonymous', 'creativeSlates.createGuest', 'users.identify']) {
    assert.ok(policy.METHODS_CLOSED_UNDER_SSO_ONLY.includes(name), name)
  }
})

test('a session check: a refused refresh token means the account is gone or disabled; an outage is not', async () => {
  const outcome = async (reply) => oidc.refreshSession({ config, refreshToken: 'rt', fetch: tokenEndpoint(reply).fetch })
  assert.deepEqual(await outcome({ body: { refresh_token: 'rt-2', access_token: 'a' } }), { status: 'active', refreshToken: 'rt-2' })
  assert.deepEqual(await outcome({ status: 400, body: { error: 'invalid_grant', error_description: 'User disabled' } }), { status: 'revoked' })
  assert.equal((await outcome({ status: 503, body: {} })).status, 'unknown')
  assert.equal((await outcome({ status: 401, body: { error: 'invalid_client' } })).status, 'unknown')
  const down = await oidc.refreshSession({ config, refreshToken: 'rt', fetch: async () => { throw new Error('ECONNREFUSED') } })
  assert.equal(down.status, 'unknown')
  const { fetch, calls } = tokenEndpoint({ body: { refresh_token: 'rt-2' } })
  await oidc.refreshSession({ config, refreshToken: 'rt', fetch })
  assert.equal(calls[0].body.get('grant_type'), 'refresh_token')
  assert.equal(calls[0].body.get('refresh_token'), 'rt')
  assert.equal(calls[0].body.get('client_secret'), config.clientSecret)
})

test('the app wires SSO in through one server import and one sign-in hook', () => {
  assert.match(read('server/main.js'), /import '\.\/sso'/)
  const login = read('imports/ui/pages/Login.jsx')
  assert.match(login, /useSso\(\)/)
  assert.match(login, /<SsoSignIn/)
  const main = read('client/main.jsx')
  assert.match(main, /path="\/sso\/done"/)
  assert.match(main, /<SsoGate/)
  // Tokens stay on the server: nothing on the client reads a refresh token or the client secret.
  for (const file of ['imports/ui/sso/sso.jsx', 'imports/ui/pages/Login.jsx']) {
    assert.doesNotMatch(read(file), /refreshToken|clientSecret|stateKey/, file)
  }
})
