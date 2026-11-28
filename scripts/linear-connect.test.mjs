// Linear for recipes: one-click connect through the public Linear OAuth app (enterprise/server/linear/).
// The token exchange, the scope checks, the viewer lookup and what is sealed, against a faked Linear.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLinearService, linearAuthorizeUrl, linearOnlyFetch, linearScopes, LINEAR_ADDRESS, LINEAR_SCOPES } from '../enterprise/server/linear/linear.mjs'
import { NATIVE_APPS } from '../enterprise/server/native-apps.mjs'
import { APP_PROVIDERS, VENDOR_CONSOLES } from '../enterprise/server/integration-apps.mjs'

const ORG = '2c5b8a4e-0000-4000-8000-00000000a001'
const VIEWER = '9d3c1f00-0000-4000-8000-00000000b001'
const json = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body), json: async () => body })

function rig({ token = { access_token: 'lin_oauth_abc', token_type: 'Bearer', expires_in: 86399, scope: 'read issues:create comments:create', refresh_token: 'lin_ref_1' }, viewer = { id: VIEWER, name: 'Ana', organization: { id: ORG, name: 'Acme', urlKey: 'acme' } }, app = { clientId: 'cid', clientSecret: 'secret', signingSecret: 'whsec' } } = {}) {
  const calls = []
  const saved = []
  const accounts = new Map()
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/oauth/token')) return json(200, token)
    if (url.endsWith('/oauth/revoke')) return json(200, {})
    if (url.endsWith('/graphql')) return json(200, { data: { viewer } })
    return json(404, {})
  }
  const vault = { available: () => true, save: async (doc) => saved.push(doc), remove: async () => ({ removed: true, revoked: true }) }
  const signIn = { startNative: async (args) => ({ flowId: 'f1', authHost: new URL(args.authorize('state1', 'https://app.example/connectors/oauth/callback')).host, args }) }
  const service = createLinearService({
    vault, signIn, fetch, apps: async () => ({ linear: app }),
    accounts: { get: async (id) => accounts.get(id) || null, put: async (doc) => accounts.set(doc._id, doc), remove: async (id) => accounts.delete(id), inOrganization: async (org) => [...accounts.values()].filter((a) => a.organizationId === org) },
    now: () => Date.UTC(2026, 10, 27),
  })
  return { service, calls, saved, accounts }
}

test('Linear is a native app an admin enters in Integration apps, with its webhook signing secret', () => {
  assert.equal(NATIVE_APPS.linear.signingSecret, true)
  assert.ok(APP_PROVIDERS.includes('linear'))
  assert.match(VENDOR_CONSOLES.linear.url, /^https:\/\/linear\.app\//)
})

test('Connect opens Linear\'s own page as the person (actor=user) with read, issues:create and comments:create only', async () => {
  const { service } = rig()
  const started = await service.connect({ kind: 'person', userId: 'u1' })
  assert.equal(started.authHost, 'linear.app')
  const url = new URL(linearAuthorizeUrl({ clientId: 'cid', state: 's', redirectUri: 'https://app.example/connectors/oauth/callback' }))
  assert.equal(url.searchParams.get('actor'), 'user')
  assert.equal(url.searchParams.get('scope'), 'read,issues:create,comments:create')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.deepEqual([...LINEAR_SCOPES], ['read', 'issues:create', 'comments:create'])
})

test('Connect is refused for a guest and when the app is not entered yet', async () => {
  await assert.rejects(rig().service.connect({ kind: 'guest', userId: 'g' }), { code: 'sign_in' })
  await assert.rejects(rig({ app: { clientId: 'cid' } }).service.connect({ kind: 'person', userId: 'u1' }), { code: 'not_configured' })
})

test('finishing the sign-in seals a rotating grant in the vault and records the workspace, never a token', async () => {
  const { service, saved, accounts, calls } = rig()
  const done = await service.finishInstall({ userId: 'u1', redirectUri: 'https://app.example/connectors/oauth/callback' }, 'code1')
  assert.equal(done.host, 'linear.app')
  const exchange = new URLSearchParams(calls[0].init.body)
  assert.equal(exchange.get('grant_type'), 'authorization_code')
  assert.equal(exchange.get('client_secret'), 'secret')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].address, LINEAR_ADDRESS)
  assert.equal(saved[0].kind, 'oauth')
  assert.equal(saved[0].registration.provider, 'linear')
  assert.equal(saved[0].server.tokenEndpoint, 'https://api.linear.app/oauth/token')
  assert.equal(saved[0].server.noResource, true)
  assert.equal(saved[0].tokens.refreshToken, 'lin_ref_1')
  assert.ok(saved[0].tokens.expiresAt > Date.UTC(2026, 10, 27))
  const row = accounts.get('u1')
  assert.equal(row.organizationId, ORG)
  assert.equal(row.urlKey, 'acme')
  assert.equal(row.status, 'active')
  assert.ok(!JSON.stringify(row).includes('lin_oauth_abc'))
})

test('a grant wider than asked (write or admin) is refused and revoked at Linear', async () => {
  const { service, saved, calls } = rig({ token: { access_token: 'tok', token_type: 'Bearer', expires_in: 100, scope: 'read,write', refresh_token: 'r' } })
  await assert.rejects(service.finishInstall({ userId: 'u1', redirectUri: 'x' }, 'c'), { code: 'scope_wrong' })
  assert.equal(saved.length, 0)
  assert.ok(calls.some((c) => c.url.endsWith('/oauth/revoke')))
})

test('a token with no workspace behind it is refused', async () => {
  const { service, saved } = rig({ viewer: null })
  await assert.rejects(service.finishInstall({ userId: 'u1', redirectUri: 'x' }, 'c'), { code: 'token_failed' })
  assert.equal(saved.length, 0)
})

test('Linear revoking the app for a workspace makes everyone there sign in again', async () => {
  const { service, accounts } = rig()
  await service.finishInstall({ userId: 'u1', redirectUri: 'x' }, 'c')
  assert.equal(await service.revokedFor(ORG), 1)
  assert.equal(accounts.get('u1').status, 'needs_sign_in')
  assert.equal(await service.revokedFor('not an id'), 0)
})

test('only Linear\'s own https hosts are fetched', async () => {
  const f = linearOnlyFetch(async (url) => url)
  assert.equal(await f('https://api.linear.app/graphql'), 'https://api.linear.app/graphql')
  assert.throws(() => f('https://evil.example/graphql'), { code: 'blocked' })
  assert.throws(() => f('http://api.linear.app/graphql'), { code: 'blocked' })
  assert.deepEqual(linearScopes('read issues:create,comments:create'), ['read', 'issues:create', 'comments:create'])
  assert.deepEqual(linearScopes(['read']), ['read'])
})
