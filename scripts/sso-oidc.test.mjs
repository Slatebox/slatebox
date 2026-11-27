// OpenID Connect for a team's connection (web/app/server/sso/oidc.mjs, on openid-client): discovery,
// the ID token's signature against the provider's keys, PKCE and nonce, refresh, sign-out at the
// provider, back-channel logout, and Slatebox Cloud reaching providers only at public addresses.
// The fake provider (scripts/fixtures/sso/fake-idp.mjs) signs real tokens and answers through fetch.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { fakeIdp } from './fixtures/sso/fake-idp.mjs'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const oidc = await import(app + 'server/sso/oidc.mjs')
const { createPublicFetch } = await import(app + 'server/common/public-fetch.mjs')

const KEY = 's'.repeat(64)
const verifier = 'v'.repeat(43)

async function world() {
  const idp = await fakeIdp()
  const endpoints = await oidc.discover(idp.issuer, { fetch: idp.fetch })
  const config = { ...endpoints, clientId: idp.clientId, clientSecret: 'secret-for-tests', redirectUri: 'https://app.slatebox.test/sso/callback' }
  const begin = (extra = {}) => {
    const started = oidc.beginSignIn({ config, key: KEY, next: '/x', verifier, extra })
    const url = new URL(started.url)
    return { started, state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce'), url }
  }
  const finish = (started, state) => oidc.completeSignIn({ config, key: KEY, cookie: started.cookie, query: { code: 'the-code', state }, fetch: idp.fetch })
  return { idp, config, begin, finish }
}

test('discovery reads the provider\'s endpoints, and the issuer it names must be the one asked for', async () => {
  const { idp, config } = await world()
  assert.equal(config.issuer, idp.issuer)
  assert.equal(config.tokenEndpoint, idp.endpoints.tokenEndpoint)
  assert.equal(config.jwksUri, idp.endpoints.jwksUri)
  assert.equal(config.endSessionEndpoint, idp.endpoints.endSessionEndpoint)
  assert.equal(config.backchannelLogout, true)
  idp.state.discovery = { ...idp.discovery, issuer: 'https://evil.test' }
  await assert.rejects(oidc.discover(idp.issuer, { fetch: idp.fetch }), { code: 'discovery' })
  idp.state.discovery = { ...idp.discovery, jwks_uri: undefined }
  await assert.rejects(oidc.discover(idp.issuer, { fetch: idp.fetch }), { code: 'discovery' })
})

test('a signed ID token for this client and sign-in signs in, with PKCE, the secret and the extra state', async () => {
  const { idp, begin, finish } = await world()
  const { started, state, nonce, url } = begin({ c: 'conn1' })
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  idp.state.token = { body: { id_token: await idp.sign(idp.claims(nonce)), access_token: 'at', token_type: 'Bearer', refresh_token: 'rt' } }
  const result = await finish(started, state)
  assert.equal(result.claims.email, 'ada@acme.test')
  assert.equal(result.refreshToken, 'rt')
  assert.equal(result.started.c, 'conn1')
  const [call] = idp.state.calls
  assert.equal(call.body.get('code_verifier'), oidc.openState(KEY, started.cookie).verifier)
  assert.equal(call.body.get('client_secret'), 'secret-for-tests')
})

test('an unsigned token, one signed by another key, or one for another nonce, issuer or client is refused', async () => {
  const { idp, begin, finish } = await world()
  const cases = {
    unsigned: async (nonce) => idp.unsigned(idp.claims(nonce)),
    'another key': async (nonce) => idp.sign(idp.claims(nonce), { wrongKey: true }),
    nonce: async () => idp.sign(idp.claims('another-nonce')),
    issuer: async (nonce) => idp.sign(idp.claims(nonce, { iss: 'https://evil.test' })),
    audience: async (nonce) => idp.sign(idp.claims(nonce, { aud: 'another-client', azp: 'another-client' })),
    expired: async (nonce) => idp.sign(idp.claims(nonce, { exp: Math.floor(Date.now() / 1000) - 600, iat: Math.floor(Date.now() / 1000) - 900 })),
  }
  for (const [what, make] of Object.entries(cases)) {
    const { started, state, nonce } = begin()
    idp.state.token = { body: { id_token: await make(nonce), access_token: 'at', token_type: 'Bearer' } }
    await assert.rejects(finish(started, state), { code: 'id-token' }, what)
  }
  const { started, state } = begin()
  idp.state.token = { status: 400, body: { error: 'invalid_grant' } }
  await assert.rejects(finish(started, state), { code: 'token' })
})

test('a refused refresh token means signed out at the provider; an outage does not', async () => {
  const { idp, config } = await world()
  idp.state.token = { body: { access_token: 'at', token_type: 'Bearer', refresh_token: 'rt-2' } }
  assert.deepEqual(await oidc.refreshSession({ config, refreshToken: 'rt', fetch: idp.fetch }), { status: 'active', refreshToken: 'rt-2' })
  idp.state.token = { status: 400, body: { error: 'invalid_grant' } }
  assert.deepEqual(await oidc.refreshSession({ config, refreshToken: 'rt', fetch: idp.fetch }), { status: 'revoked' })
  idp.state.token = { status: 503, body: {} }
  assert.equal((await oidc.refreshSession({ config, refreshToken: 'rt', fetch: idp.fetch })).status, 'unknown')
})

test('signing out at the provider goes to its end-session page with the client and the way back', async () => {
  const { config } = await world()
  const url = new URL(oidc.endSessionUrl({ config, postLogoutRedirectUri: 'https://app.slatebox.test/login' }))
  assert.equal(url.origin + url.pathname, `${config.issuer}/logout`)
  assert.equal(url.searchParams.get('client_id'), config.clientId)
  assert.equal(url.searchParams.get('post_logout_redirect_uri'), 'https://app.slatebox.test/login')
  assert.equal(oidc.endSessionUrl({ config: { ...config, endSessionEndpoint: undefined } }), null)
})

test('back-channel logout: a signed logout token for this client names whose session ended', async () => {
  const { idp, config } = await world()
  const jwks = idp.state.jwks
  const now = Math.floor(Date.now() / 1000)
  const event = { 'http://schemas.openid.net/event/backchannel-logout': {} }
  const token = (extra = {}, options) => idp.sign({ iss: idp.issuer, aud: idp.clientId, iat: now, jti: 'j1', sub: 'user-1', events: event, ...extra }, { typ: 'logout+jwt', ...options })
  assert.equal((await oidc.verifyLogoutToken(await token(), { config, jwks })).subject, 'user-1')
  await assert.rejects(oidc.verifyLogoutToken(await token({ nonce: 'n' }), { config, jwks }), { code: 'logout-token' }, 'a nonce')
  await assert.rejects(oidc.verifyLogoutToken(await token({ events: {} }), { config, jwks }), { code: 'logout-token' }, 'no logout event')
  await assert.rejects(oidc.verifyLogoutToken(await token({ aud: 'another' }), { config, jwks }), { code: 'logout-token' }, 'another client')
  await assert.rejects(oidc.verifyLogoutToken(await token({}, { wrongKey: true }), { config, jwks }), { code: 'logout-token' }, 'another key')
  await assert.rejects(oidc.verifyLogoutToken(await token({ sub: undefined }), { config, jwks }), { code: 'logout-token' }, 'no sub or sid')
  await assert.rejects(oidc.verifyLogoutToken(idp.unsigned({ iss: idp.issuer, aud: idp.clientId, iat: now, jti: 'j', sub: 'u', events: event }), { config, jwks }), { code: 'logout-token' })
})

test('Slatebox Cloud reaches an identity provider only over https at a public address', async () => {
  const privately = (_host, _options, callback) => callback(null, [{ address: '10.0.0.5', family: 4 }])
  const lookup = (await import(app + 'server/common/safe-fetch.mjs')).publicLookup((host, options, callback) => privately(host, options, callback))
  const cloudFetch = createPublicFetch({ lookup })
  for (const issuer of ['http://idp.acme.test', 'https://localhost/x', 'https://10.1.2.3', 'https://[::1]/', 'https://metadata.internal']) {
    await assert.rejects(oidc.discover(issuer, { fetch: cloudFetch }), { code: 'discovery' }, issuer)
  }
  // a public name that resolves to a private address is refused at connect time
  await assert.rejects(oidc.discover('https://idp.acme.test', { fetch: cloudFetch }), { code: 'discovery' })
})

test('the configuration always checks signatures: a connection without keys cannot sign anyone in', async () => {
  const { config } = await world()
  assert.throws(() => oidc.configurationFor({ ...config, jwksUri: undefined }), { code: 'config' })
})
