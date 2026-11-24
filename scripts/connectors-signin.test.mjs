// Outside agents that need sign-in (enterprise/, S2b): OAuth discovery and its checks (resource,
// issuer, PKCE S256, endpoints), single-use state tied to the browser, iss in the callback,
// registration order (pre-registered app, CIMD, DCR, pasted client id), the sealed vault, refresh
// under a lease, revocation on disconnect, no token passthrough, pasted keys, the "needs sign-in"
// and "Pro ended" states, the hostile server's sign-in cases, and the three web routes.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/connectors-signin.test.mjs
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import { KEY, PRE_CLIENT, startMcpTestServers } from './mcp-test-servers.mjs'
import { bindToken, createMcpFetch } from '../enterprise/server/mcp-fetch.mjs'
import { callTool, discover } from '../enterprise/server/mcp-session.mjs'
import {
  appFor, authorizationUrl, challengeOf, checkCallback, chooseRegistration, chooseScopes, clientDocument, discoverSignIn, parseChallenge, pkcePair,
  resourceMatches, resourceMetadataUrls, serverMetadataUrls, SignInProblem, tokenResult,
} from '../enterprise/server/oauth.mjs'
import { createVault, credentialId, SignInNeeded } from '../enterprise/server/credentials.mjs'
import { createSignIn, probe } from '../enterprise/server/signin.mjs'
import { COOKIE_PREFIX, readCookies, signInRoutes } from '../enterprise/server/routes.mjs'
import { connectorSettings } from '../enterprise/server/connector-settings.mjs'
import { createConnectorService } from '../enterprise/server/service.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { sanitizeClientName } from '../web/app/imports/api/common/agent-label.mjs'
import { connectorSuggestions } from './connector-suggestions-world.mjs'

let servers
let mcpFetch
let signInFetch
const requested = []
before(async () => {
  servers = await startMcpTestServers()
  mcpFetch = createMcpFetch({ devOrigins: [servers.origin], onRequest: (url) => requested.push(url) })
  signInFetch = createMcpFetch({ devOrigins: [servers.origin], methods: ['GET', 'POST'], maxRedirects: 0, maxBytes: 256 * 1024, onRequest: (url) => requested.push(url) })
})
after(() => servers.close())

const ORIGIN = 'http://localhost:3000'
const newMaster = () => loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })

const refusedWith = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${error.code}: ${error.message}`)
    return true
  })
}

// ---------- in-memory stores with the same atomic rules as the Mongo ones ----------

function credentialMemory() {
  const rows = new Map()
  return {
    rows,
    get: async (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null),
    put: async (doc) => void rows.set(doc._id, structuredClone(doc)),
    update: async (id, set) => void (rows.has(id) && Object.assign(rows.get(id), structuredClone(set))),
    async claim(id, leaseId, until, at) {
      const row = rows.get(id)
      if (!row || (row.lease && new Date(row.lease.until) > at)) return false
      row.lease = { id: leaseId, until }
      return true
    },
    release: async (id, leaseId) => void (rows.get(id)?.lease?.id === leaseId && (rows.get(id).lease = null)),
    remove: async (id) => void rows.delete(id),
  }
}

function flowMemory() {
  const rows = new Map()
  return {
    rows,
    insert: async (doc) => void rows.set(doc._id, structuredClone(doc)),
    get: async (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null),
    async claim(id, from, set) {
      const row = rows.get(id)
      if (!row || row.status !== from) return null
      Object.assign(row, set)
      return structuredClone(row)
    },
    async takeByState(stateHash) {
      const row = [...rows.values()].find((r) => r.stateHash === stateHash && r.status === 'opened')
      if (!row) return null
      row.status = 'used'
      return structuredClone(row)
    },
    update: async (id, set) => void (rows.has(id) && Object.assign(rows.get(id), set)),
  }
}

function clientMemory() {
  const rows = new Map()
  return { rows, get: async (id) => rows.get(id) || null, put: async (doc) => void rows.set(doc._id, doc) }
}

function makeSignIn({ apps = {}, origin = ORIGIN, master = newMaster(), now = Date.now } = {}) {
  const credentials = credentialMemory()
  const flows = flowMemory()
  const clients = clientMemory()
  const vault = createVault({ store: credentials, master, fetch: signInFetch, secretFor: (reg) => apps[reg.provider]?.clientSecret || null, now, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) })
  const signIn = createSignIn({ flows, clients, vault, master, fetch: signInFetch, apps: () => apps, origin: () => origin, devOrigins: [servers.origin], now })
  return { credentials, flows, clients, vault, signIn, master }
}

// The popup, end to end: the start route's claim, the server's page, Allow (or Deny), the callback.
async function popup(signIn, started, { choose = 'allow', binding: override, userId = 'ada' } = {}) {
  const { authorizeUrl, binding } = await signIn.begin({ flowId: started.flowId, userId })
  const page = await fetch(authorizeUrl)
  const html = await page.text()
  assert.equal(page.status, 200, html)
  const href = html.match(new RegExp(`id="${choose}" href="([^"]+)"`))[1].replace(/&amp;/g, '&')
  const query = Object.fromEntries(new URL(href).searchParams)
  const result = await signIn.finish({ query, bindingFor: (id) => (id === started.flowId ? (override === undefined ? binding : override) : null) })
  return { result, query, binding, authorizeUrl }
}

// ---------- oauth.mjs: the pure checks ----------

test('PKCE is S256 only, with the RFC 7636 test vector', () => {
  assert.equal(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  const pair = pkcePair()
  assert.equal(pair.method, 'S256')
  assert.equal(pair.verifier.length, 43)
  assert.equal(pair.challenge, challengeOf(pair.verifier))
  assert.notEqual(pkcePair().verifier, pair.verifier)
  const url = new URL(authorizationUrl({ server: { authorizationEndpoint: 'https://as.example/authorize' }, clientId: 'c', redirectUri: ORIGIN + '/connectors/oauth/callback', challenge: pair.challenge, state: 's1', resource: 'https://mcp.example/mcp', scopes: ['read'] }))
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('resource'), 'https://mcp.example/mcp')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/connectors/oauth/callback')
  assert.equal(url.searchParams.get('state'), 's1')
})

test('challenges and well-known addresses, as the live servers send them', () => {
  assert.deepEqual(parseChallenge('Bearer realm="OAuth", resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp/readonly", scope="read write"'), {
    realm: 'OAuth', resource_metadata: 'https://mcp.linear.app/.well-known/oauth-protected-resource/mcp/readonly', scope: 'read write',
  })
  assert.equal(parseChallenge('Basic realm=x'), null)
  assert.deepEqual(resourceMetadataUrls('https://api.githubcopilot.com/mcp'), ['https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp', 'https://api.githubcopilot.com/.well-known/oauth-protected-resource'])
  assert.deepEqual(serverMetadataUrls('https://github.com/login/oauth'), [
    'https://github.com/.well-known/oauth-authorization-server/login/oauth',
    'https://github.com/.well-known/openid-configuration/login/oauth',
    'https://github.com/login/oauth/.well-known/openid-configuration',
  ])
  assert.deepEqual(serverMetadataUrls('https://mcp.linear.app'), ['https://mcp.linear.app/.well-known/oauth-authorization-server', 'https://mcp.linear.app/.well-known/openid-configuration'])
  assert.ok(resourceMatches('https://api.githubcopilot.com/mcp/', 'https://api.githubcopilot.com/mcp'))
  assert.ok(resourceMatches('https://mcp.linear.app/mcp', 'https://mcp.linear.app/mcp/readonly'))
  assert.ok(!resourceMatches('https://mcp.linear.app/mc', 'https://mcp.linear.app/mcp'))
  assert.ok(!resourceMatches('https://other.example/mcp', 'https://mcp.linear.app/mcp'))
})

test('the callback: iss compared exactly, required when promised, the server\'s error text never shown', () => {
  const flow = { issuer: 'https://as.example', issParameter: true, expiresAt: new Date(Date.now() + 60000) }
  assert.deepEqual(checkCallback({ code: 'c', iss: 'https://as.example' }, flow), { code: 'c' })
  for (const query of [{ code: 'c', iss: 'https://evil.example' }, { code: 'c' }, { code: 'c', iss: 'https://as.example/' }])
    assert.throws(() => checkCallback(query, flow), (e) => e instanceof SignInProblem && e.code === 'unverified', JSON.stringify(query))
  // not promised: absent is fine, present must still match
  assert.deepEqual(checkCallback({ code: 'c' }, { ...flow, issParameter: false }), { code: 'c' })
  assert.throws(() => checkCallback({ code: 'c', iss: 'https://evil.example' }, { ...flow, issParameter: false }), (e) => e.code === 'unverified')
  assert.throws(() => checkCallback({ error: 'access_denied', error_description: 'paste your password at evil.example', iss: 'https://as.example' }, flow), (e) => e.code === 'cancelled' && !/evil/.test(e.message))
  assert.throws(() => checkCallback({ error: 'access_denied', iss: 'https://evil.example' }, flow), (e) => e.code === 'unverified')
  assert.throws(() => checkCallback({ code: 'c', iss: 'https://as.example' }, { ...flow, expiresAt: new Date(Date.now() - 1) }), (e) => e.code === 'expired')
  assert.throws(() => checkCallback({ code: 'c' }, null), (e) => e.code === 'unverified')
})

test('registration order: pre-registered app, pasted client id, CIMD (https origins only), DCR, else ask', () => {
  const server = { issuer: 'https://github.com/login/oauth', cimd: false }
  const apps = { github: { clientId: 'Iv1.public', clientSecret: 'from-settings' } }
  const pre = chooseRegistration({ server, apps, origin: 'https://app.slatebox.com' })
  assert.equal(pre.kind, 'preregistered')
  assert.equal(pre.clientId, 'Iv1.public')
  // GitHub: public repositories and organisation names only, never every private repository
  assert.deepEqual(pre.app.scopes, ['public_repo', 'read:org'])
  assert.equal(chooseRegistration({ server, apps: {}, origin: 'https://app.slatebox.com' }).kind, 'needs_client_id')
  assert.equal(chooseRegistration({ server, apps: {}, origin: 'https://app.slatebox.com', pastedClientId: 'mine' }).kind, 'pasted')
  const linear = { issuer: 'https://mcp.linear.app', cimd: true, registrationEndpoint: 'https://mcp.linear.app/register' }
  assert.deepEqual(chooseRegistration({ server: linear, apps, origin: 'https://app.slatebox.com' }), { kind: 'cimd', clientId: 'https://app.slatebox.com/oauth/mcp-client.json' })
  assert.equal(chooseRegistration({ server: linear, apps, origin: 'http://localhost:3000' }).kind, 'dcr')
  // an app for another issuer never applies
  assert.equal(appFor('https://mcp.linear.app', apps), null)
  const doc = clientDocument('https://app.slatebox.com')
  assert.equal(doc.client_id, 'https://app.slatebox.com/oauth/mcp-client.json')
  assert.deepEqual(doc.redirect_uris, ['https://app.slatebox.com/connectors/oauth/callback'])
  assert.equal(doc.token_endpoint_auth_method, 'none')
})

test('hostile: a server that names a pre-registered provider (GitHub) as its sign-in never gets that provider\'s token', async () => {
  const github = { issuer: 'https://github.com/login/oauth', cimd: false }
  const apps = { github: { clientId: 'Iv1.public', clientSecret: 'from-settings' } }
  // GitHub's own MCP server: the Slatebox GitHub app is used
  assert.equal(chooseRegistration({ server: github, apps, origin: 'https://app.slatebox.com', resource: 'https://api.githubcopilot.com/mcp/' }).kind, 'preregistered')
  // anyone else's server naming github.com as its sign-in server: refused before any popup, in plain words
  assert.throws(() => chooseRegistration({ server: github, apps, origin: 'https://app.slatebox.com', resource: 'https://evil.example/mcp' }),
    (e) => e.code === 'sign_in_unsafe' && /only sends GitHub sign-ins to GitHub's own server/.test(e.message))
  assert.deepEqual(appFor(github.issuer, apps, 'https://evil.example/mcp'), { refused: 'GitHub' })
  // a custom app reaches only the servers settings name for it (none named: never used)
  const custom = { fake: { clientId: 'c', issuer: 'https://as.example', resources: ['https://mcp.example'] } }
  assert.equal(appFor('https://as.example', custom, 'https://mcp.example/mcp').clientId, 'c')
  assert.deepEqual(appFor('https://as.example', custom, 'https://other.example/mcp'), { refused: 'fake' })
  assert.deepEqual(appFor('https://as.example', { fake: { clientId: 'c', issuer: 'https://as.example' } }, 'https://mcp.example/mcp'), { refused: 'fake' })
  // settings may add servers for a known provider; only https origins (or local test origins) count
  const parsed = connectorSettings({ public: { env: 'prod' }, connectors: { oauthApps: { github: { clientId: 'Iv1.abc', resources: ['https://ghe.example.com/mcp', 'http://evil.example', 'nope'] } } } })
  assert.deepEqual(parsed.oauthApps.github.resources, ['https://ghe.example.com/mcp'])
})

test('the consent screen says what a sign-in reaches, in plain words', async () => {
  const { reachOf } = await import('../enterprise/server/oauth.mjs')
  assert.equal(reachOf(['public_repo', 'read:org']), 'It lets Slatebox read and change your public repositories (code, issues and pull requests) and see which organisations you belong to.')
  assert.match(reachOf(['repo']), /private ones too/)
  assert.equal(reachOf(['read', 'offline_access']), 'It asks for: read.')
  assert.equal(reachOf([]), '')
})

test('scopes: the app\'s own (GitHub: public_repo and read:org); else the challenge narrowed to what the resource lists', () => {
  const server = { offlineAccess: true }
  assert.deepEqual(chooseScopes({ app: { scopes: ['repo'] }, scopes: { challenge: [], resource: ['repo', 'gist', 'notifications'] }, server }), ['repo'])
  assert.deepEqual(chooseScopes({ app: null, scopes: { challenge: ['read', 'write'], resource: ['read'] }, server: { offlineAccess: false } }), ['read'])
  assert.deepEqual(chooseScopes({ app: null, scopes: { challenge: [], resource: ['read'] }, server }), ['read', 'offline_access'])
})

test('token answers are checked: bearer only, no whitespace, lifetimes capped, invalid_grant named', () => {
  const now = 1000
  assert.deepEqual(tokenResult({ access_token: 'at', token_type: 'bearer', expires_in: 60, refresh_token: 'rt', scope: 'repo' }, now), { accessToken: 'at', refreshToken: 'rt', expiresAt: 61000, scopes: ['repo'] })
  assert.equal(tokenResult({ access_token: 'at', token_type: 'mac' }), null)
  assert.equal(tokenResult({ access_token: 'a b' }), null)
  assert.deepEqual(tokenResult({ error: 'invalid_grant', error_description: 'x' }), { error: 'invalid_grant' })
  assert.deepEqual(tokenResult({ error: 'bad_verification_code' }), { error: 'token_error' })
})

test('settings: oauthApps per provider, known providers bring their issuer, others need an https issuer', () => {
  const parsed = connectorSettings({
    public: { env: 'prod' },
    connectors: { oauthApps: { github: { clientId: 'Iv1.abc', clientSecret: 's3cret' }, slack: { clientId: 'x' }, custom: { clientId: 'y', issuer: 'https://auth.example.com' }, local: { clientId: 'z', issuer: 'http://127.0.0.1:9' }, 'Bad Name': { clientId: 'q' } } },
  })
  assert.deepEqual(parsed.oauthApps, { github: { clientId: 'Iv1.abc', clientSecret: 's3cret' }, custom: { clientId: 'y', issuer: 'https://auth.example.com' } })
})

// ---------- discovery against the fake servers, and the hostile cases ----------

test('discovery: protected resource, then the authorization server, every check passing', async () => {
  const challenge = (await probe(servers.url('/oauth/mcp'), mcpFetch)).challenge
  assert.match(challenge.resource_metadata, /oauth-protected-resource\/oauth\/mcp$/)
  const found = await discoverSignIn({ address: servers.url('/oauth/mcp'), challenge, fetch: signInFetch, devOrigins: [servers.origin] })
  assert.equal(found.issuer, servers.origin + '/as')
  assert.equal(found.resource, servers.url('/oauth/mcp'))
  assert.equal(found.server.issParameter, true)
  assert.deepEqual(found.scopes.challenge, ['read', 'write'])
  assert.deepEqual(found.scopes.resource, ['read'])
})

test('hostile sign-in: every planted address or weak setting is refused, and nothing private is requested', async () => {
  for (const [kind, code] of [['issuer', 'sign_in_unsafe'], ['nopkce', 'no_pkce'], ['authjs', 'sign_in_unsafe'], ['resource', 'sign_in_unsafe'], ['asprivate', 'sign_in_unsafe']]) {
    requested.length = 0
    const challenge = (await probe(servers.url(`/hostile/${kind}/mcp`), mcpFetch)).challenge
    await refusedWith(discoverSignIn({ address: servers.url(`/hostile/${kind}/mcp`), challenge, fetch: signInFetch, devOrigins: [servers.origin] }), code)
    assert.ok(requested.every((url) => url.startsWith(servers.origin)), `${kind}: ${requested.join(' ')}`)
  }
  // resource_metadata pointing at the cloud metadata address: refused before any request
  requested.length = 0
  const challenge = (await probe(servers.url('/hostile/metadata/mcp'), mcpFetch)).challenge
  assert.equal(challenge.resource_metadata, 'http://169.254.169.254/latest/meta-data/iam')
  await refusedWith(discoverSignIn({ address: servers.url('/hostile/metadata/mcp'), challenge, fetch: signInFetch, devOrigins: [servers.origin] }), 'sign_in_unsafe')
  assert.ok(!requested.some((url) => url.includes('169.254')), requested.join(' '))
})

// ---------- signin.mjs: the popup flow ----------

test('a sign-in, end to end: DCR (web), single-use state tied to the browser, iss checked, code for tokens with the verifier and resource', async () => {
  const { signIn, credentials, clients } = makeSignIn()
  const started = await signIn.start({ userId: 'ada', address: servers.url('/oauth/mcp'), challenge: null })
  // a flow id only: no address a token holder could forward to someone else
  assert.match(started.flowId, /^f[A-Za-z0-9_-]{20,}$/)
  assert.equal(started.startUrl, undefined)
  assert.equal(servers.oauth.registrations.at(-1).application_type, 'web')
  assert.deepEqual(servers.oauth.registrations.at(-1).redirect_uris, ['http://localhost:3000/connectors/oauth/callback'])
  assert.equal(clients.rows.size, 1)
  const before = servers.oauth.tokenRequests.length
  const { result, query, binding } = await popup(signIn, started)
  assert.equal(result.ok, true, JSON.stringify(result))
  const req = servers.oauth.authorizeRequests.at(-1)
  assert.equal(req.code_challenge_method, 'S256')
  assert.equal(req.resource, servers.url('/oauth/mcp'))
  assert.equal(req.scope, 'read offline_access')
  assert.equal(servers.oauth.tokenRequests.length, before + 1)
  assert.equal(servers.oauth.tokenRequests.at(-1).resource, servers.url('/oauth/mcp'))
  // sealed: no token in the stored row
  const row = credentials.rows.get(credentialId('ada', servers.url('/oauth/mcp')))
  assert.ok(row && row.access?.data && row.refresh?.data)
  assert.ok(!/at-|rt-/.test(JSON.stringify(row)))
  assert.deepEqual(await signIn.status({ userId: 'ada', flowId: started.flowId }), { status: 'done' })
  assert.equal((await signIn.status({ userId: 'sam', flowId: started.flowId })).status, 'unknown')
  // the same callback again: the state was used
  const again = await signIn.finish({ query, bindingFor: () => binding })
  assert.equal(again.code, 'unverified')
  // a second registration is not needed: DCR is kept per issuer and redirect address
  await signIn.start({ userId: 'sam', address: servers.url('/oauth/mcp'), challenge: null })
  assert.equal(clients.rows.size, 1)
})

test('a callback from another browser (no binding cookie) is refused and its flow is spent', async () => {
  const { signIn, credentials } = makeSignIn()
  const started = await signIn.start({ userId: 'ada', address: servers.url('/oauth/mcp'), challenge: null })
  const { result } = await popup(signIn, started, { binding: 'someone-elses-cookie' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unverified')
  assert.equal(credentials.rows.size, 0)
  assert.equal((await signIn.status({ userId: 'ada', flowId: started.flowId })).status, 'failed')
  // and the start link works once only
  await refusedWith(signIn.begin({ flowId: started.flowId, userId: 'ada' }), 'unverified')
  await refusedWith(signIn.begin({ flowId: 'not-a-flow', userId: 'ada' }), 'unverified')
})

test('hostile: a flow sent to someone else cannot be opened; only its owner, signed in, may start it', async () => {
  const { signIn, credentials, flows } = makeSignIn()
  // Mallory starts a flow for her own vault and sends its id to Ada
  const started = await signIn.start({ userId: 'mallory', address: servers.url('/oauth/mcp'), challenge: null })
  const authorizeBefore = servers.oauth.authorizeRequests.length
  // Ada's browser: signed out, then signed in as Ada. Neither may claim Mallory's flow.
  await refusedWith(signIn.begin({ flowId: started.flowId, userId: null }), 'signed_out')
  await refusedWith(signIn.begin({ flowId: started.flowId, userId: 'ada' }), 'unverified')
  // nothing was claimed: no cookie, no redirect to the sign-in server, the flow still waits for its owner
  assert.equal(flows.rows.get(started.flowId).status, 'created')
  assert.equal(servers.oauth.authorizeRequests.length, authorizeBefore)
  // a flow opened by anyone but its owner never finishes, even with the right cookie
  const row = flows.rows.get(started.flowId)
  const { authorizeUrl, binding } = await signIn.begin({ flowId: started.flowId, userId: 'mallory' })
  row.openedBy = 'ada'
  const html = await (await fetch(authorizeUrl)).text()
  const query = Object.fromEntries(new URL(html.match(/id="allow" href="([^"]+)"/)[1].replace(/&amp;/g, '&')).searchParams)
  const result = await signIn.finish({ query, bindingFor: () => binding })
  assert.equal(result.code, 'unverified')
  assert.equal(credentials.rows.size, 0)
})

test('hostile: an iss mismatch in the callback is refused, nothing is stored, the state is discarded', async () => {
  const { signIn, credentials } = makeSignIn()
  const started = await signIn.start({ userId: 'ada', address: servers.url('/hostile/iss/mcp'), challenge: null })
  const tokenRequests = servers.oauth.tokenRequests.length
  const { result, query } = await popup(signIn, started)
  assert.equal(query.iss, 'https://evil.example/as')
  assert.equal(result.code, 'unverified')
  assert.equal(servers.oauth.tokenRequests.length, tokenRequests, 'the code was never exchanged')
  assert.equal(credentials.rows.size, 0)
})

test('Deny: "Sign-in was cancelled", in Slatebox\'s words only', async () => {
  const { signIn, credentials } = makeSignIn()
  const started = await signIn.start({ userId: 'ada', address: servers.url('/oauth/mcp'), challenge: null })
  const { result } = await popup(signIn, started, { choose: 'deny' })
  assert.equal(result.code, 'cancelled')
  assert.equal(result.message, 'Sign-in was cancelled.')
  assert.equal(credentials.rows.size, 0)
})

test('a sign-in left open past 10 minutes expires', async () => {
  let clock = Date.now()
  const { signIn } = makeSignIn({ now: () => clock })
  const started = await signIn.start({ userId: 'ada', address: servers.url('/oauth/mcp'), challenge: null })
  clock += 11 * 60000
  await refusedWith(signIn.begin({ flowId: started.flowId, userId: 'ada' }), 'expired')
})

test('a pre-registered app (settings.connectors.oauthApps): its client id, its secret at the token endpoint, its scopes, no registration', async () => {
  const apps = { fake: { clientId: PRE_CLIENT.clientId, clientSecret: PRE_CLIENT.clientSecret, issuer: servers.origin + '/as', scopes: ['read'], resources: [servers.origin] } }
  const { signIn, vault } = makeSignIn({ apps })
  const registrations = servers.oauth.registrations.length
  assert.equal((await signIn.plan({ address: servers.url('/oauth/mcp'), challenge: null })).registration, 'preregistered')
  const started = await signIn.start({ userId: 'ada', address: servers.url('/oauth/mcp'), challenge: null })
  const { result } = await popup(signIn, started)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(servers.oauth.registrations.length, registrations)
  assert.equal(servers.oauth.authorizeRequests.at(-1).client_id, PRE_CLIENT.clientId)
  assert.equal(servers.oauth.authorizeRequests.at(-1).scope, 'read')
  assert.match(await vault.tokenFor('ada', servers.url('/oauth/mcp')), /^at-/)
})

test('CIMD on an https origin: the client id is Slatebox\'s published document address', async () => {
  const { signIn } = makeSignIn({ origin: 'https://app.example' })
  const started = await signIn.start({ userId: 'ada', address: servers.url('/oauth/mcp'), challenge: null })
  const { authorizeUrl } = await signIn.begin({ flowId: started.flowId, userId: 'ada' })
  const url = new URL(authorizeUrl)
  assert.equal(url.searchParams.get('client_id'), 'https://app.example/oauth/mcp-client.json')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example/connectors/oauth/callback')
})

test('no vault master key: sign-in servers are not offered (the key is never generated)', async () => {
  const { signIn } = makeSignIn({ master: null })
  await refusedWith(signIn.plan({ address: servers.url('/oauth/mcp'), challenge: null }), 'vault_off')
})

// ---------- credentials.mjs: the vault ----------

test('vault: sealed per person, address, issuer and field; a copied cipher or another master key does not open', async () => {
  const master = newMaster()
  const store = credentialMemory()
  const vault = createVault({ store, master, fetch: signInFetch })
  await vault.save({ userId: 'ada', address: 'https://mcp.example/mcp', resource: 'https://mcp.example/mcp', issuer: 'https://as.example', kind: 'oauth', server: { issuer: 'https://as.example', tokenEndpoint: 'https://as.example/token' }, registration: { kind: 'dcr', clientId: 'c' }, tokens: { accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: Date.now() + 3600000 } })
  assert.equal(await vault.tokenFor('ada', 'https://mcp.example/mcp'), 'secret-access')
  assert.ok(!JSON.stringify([...store.rows.values()]).includes('secret-'))
  // Ada's sealed access token pasted into Sam's row does not open
  await vault.save({ userId: 'sam', address: 'https://mcp.example/mcp', resource: 'https://mcp.example/mcp', issuer: 'https://as.example', kind: 'oauth', tokens: { accessToken: 'sams' } })
  store.rows.get(credentialId('sam', 'https://mcp.example/mcp')).access = store.rows.get(credentialId('ada', 'https://mcp.example/mcp')).access
  await refusedWith(vault.tokenFor('sam', 'https://mcp.example/mcp'), 'needs_sign_in')
  // the access cipher moved into the refresh field does not open as a refresh token either
  const other = createVault({ store, master: newMaster(), fetch: signInFetch })
  await refusedWith(other.tokenFor('ada', 'https://mcp.example/mcp'), 'needs_sign_in')
  assert.equal(await vault.tokenFor('vic', 'https://mcp.example/mcp'), null)
})

async function signedIn({ expiresIn = 3600 } = {}) {
  const made = makeSignIn()
  servers.oauth.expiresIn = expiresIn
  const started = await made.signIn.start({ userId: 'ada', address: servers.url('/oauth/mcp'), challenge: null })
  const { result } = await popup(made.signIn, started)
  servers.oauth.expiresIn = 3600
  assert.equal(result.ok, true)
  return made
}

test('refresh under a lease: two processes asking at once spend the rotating refresh token once', async () => {
  const { credentials, master } = await signedIn({ expiresIn: 1 })
  // two app processes: separate vaults over the same rows
  const one = createVault({ store: credentials, master, fetch: signInFetch, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) })
  const two = createVault({ store: credentials, master, fetch: signInFetch, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) })
  const calls = servers.oauth.refreshCalls
  const reuse = servers.oauth.refreshReuse
  const [a, b] = await Promise.all([one.tokenFor('ada', servers.url('/oauth/mcp')), two.tokenFor('ada', servers.url('/oauth/mcp'))])
  assert.equal(servers.oauth.refreshCalls, calls + 1)
  assert.equal(servers.oauth.refreshReuse, reuse)
  assert.equal(a, b)
  assert.match(a, /^at-/)
  assert.equal(credentials.rows.values().next().value.lease, null)
})

test('a refused refresh (invalid_grant) marks "needs sign-in" once, with no retry loop', async () => {
  const { credentials, vault } = await signedIn({ expiresIn: 1 })
  servers.oauth.refresh.clear()
  const calls = servers.oauth.refreshCalls
  await refusedWith(vault.tokenFor('ada', servers.url('/oauth/mcp')), 'needs_sign_in')
  await refusedWith(vault.tokenFor('ada', servers.url('/oauth/mcp')), 'needs_sign_in')
  assert.equal(servers.oauth.refreshCalls, calls + 1)
  const row = credentials.rows.values().next().value
  assert.equal(row.status, 'needs_sign_in')
  assert.equal(row.access, null)
  assert.equal(row.refresh, null)
})

test('forgetting a sign-in revokes both tokens at the server', async () => {
  const { vault, credentials } = await signedIn()
  const revoked = servers.oauth.revoked.length
  const result = await vault.remove('ada', servers.url('/oauth/mcp'))
  assert.deepEqual(result, { removed: true, revoked: true })
  assert.equal(servers.oauth.revoked.length, revoked + 2)
  assert.equal(credentials.rows.size, 0)
})

// ---------- no token passthrough ----------

test('no token passthrough: a server\'s token goes to that server\'s origin only', async () => {
  const seen = []
  const inner = async (input, init) => seen.push([String(input), init.headers]) && new Response('{}')
  const bound = bindToken(inner, 'https://mcp.linear.app')
  await bound('https://mcp.linear.app/mcp', { method: 'POST', headers: { authorization: 'Bearer lin' } })
  await bound('https://evil.example/collect', { method: 'POST', headers: { authorization: 'Bearer lin', 'content-type': 'x' } })
  assert.equal(seen[0][1].authorization, 'Bearer lin')
  assert.equal(seen[1][1].authorization, undefined)
  assert.equal(seen[1][1]['content-type'], 'x')
})

// ---------- the service: sign-in in the walkthrough, keys, needs sign-in, Pro ended, disconnect ----------

function memoryStore() {
  const rows = []
  const match = (r, q) => Object.entries(q).every(([k, v]) => (v && typeof v === 'object' && '$ne' in v ? r[k] !== v.$ne : r[k] === v))
  return {
    rows,
    insert: async (doc) => rows.push(structuredClone(doc)),
    findOne: async (q) => rows.find((r) => match(r, q)) || null,
    find: async (q) => rows.filter((r) => match(r, q)),
    update: async (id, set) => Object.assign(rows.find((r) => r._id === id) || {}, set),
  }
}

function makeWorld({ pro = ['ada'] } = {}) {
  const made = makeSignIn()
  const slate = { _id: 'slate1', shareId: 'share1', userId: 'ada', revision: 1, nodes: [{ options: { id: 'n0', text: 'Checkout', xPos: 0, yPos: 0, width: 200, height: 80 }, relationships: { associations: [] } }] }
  const roles = { ada: 'edit', sam: 'edit', vic: 'read' }
  const connections = memoryStore()
  // The app's real suggestion path: the agent's saves become live suggestions.
  const live = connectorSuggestions(slate)
  const audits = []
  const proList = [...pro]
  let planned = 0
  const service = createConnectorService({
    connections,
    suggestions: live.suggestions,
    fetch: mcpFetch,
    session: { discover, callTool },
    model: async ({ tool }) => {
      if (tool.name === 'plan_calls') return planned++ % 2 === 0 ? { calls: [{ tool: 'list_issues', arguments: { query: 'open' } }] } : { calls: [], done: true }
      return { groups: [{ label: 'Issues', notes: [{ key: 'a', text: 'ENG-12 Retry declined cards' }] }] }
    },
    applyOperations: live.applyOperations,
    access: { forUser: async (shareId, userId) => (shareId === 'share1' && roles[userId] ? { slate, canRead: true, canEdit: roles[userId] === 'edit' } : null), reload: async () => slate },
    pro: async (userId) => proList.includes(userId),
    firstName: async (userId) => userId[0].toUpperCase() + userId.slice(1),
    sanitizeName: sanitizeClientName,
    presence: { plan: async () => {}, step: async () => {}, saved: async () => {}, end: async () => {} },
    vault: made.vault,
    signIn: made.signIn,
    probe,
    devOrigins: [servers.origin],
    sleep: async () => {},
    audit: (entry) => audits.push(entry),
  })
  const person = (userId) => ({ kind: 'person', userId, scopes: ['slates:read', 'slates:write'] })
  return { ...made, service, connections, live, audits, proList, slate, ada: person('ada'), sam: person('sam') }
}

async function signInThroughService(world, path = '/oauth/mcp') {
  const started = await world.service.startSignIn(world.ada, { shareId: 'share1', address: servers.url(path) })
  const { result } = await popup(world.signIn, started)
  assert.equal(result.ok, true, JSON.stringify(result))
  return started
}

async function inviteSignedIn(world, path = '/oauth/mcp') {
  const found = await world.service.discover(world.ada, { shareId: 'share1', address: servers.url(path) })
  return world.service.connect(world.ada, { shareId: 'share1', address: found.address, name: 'Issues', tools: found.tools.map(({ name, hash, policy }) => ({ name, hash, policy })), contextLevel: 'request' })
}

test('the walkthrough: "sign-in needed" with how, then the popup, then the tools; calls carry the token, nothing else ever holds it', async () => {
  const world = makeWorld()
  const first = await world.service.discover(world.ada, { shareId: 'share1', address: servers.url('/oauth/mcp') })
  assert.equal(first.tools.length, 0)
  assert.equal(first.signIn.method, 'oauth')
  assert.equal(first.signIn.registration, 'dcr')
  assert.equal(first.signIn.authHost, new URL(servers.origin).host)
  assert.equal(first.signIn.keyAllowed, true)
  await refusedWith(world.service.connect(world.ada, { shareId: 'share1', address: first.address, name: 'Issues', tools: [] }), 'needs_sign_in')
  await signInThroughService(world)
  const conn = await inviteSignedIn(world)
  assert.equal(conn.signedIn, true)
  const callsBefore = servers.calls.length
  const asked = await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'What is open?' })
  assert.equal(asked.items, 1)
  const made = servers.calls.slice(callsBefore).filter((c) => c.kind === 'oauth')
  assert.ok(made.some((c) => c.method === 'tools/call' && c.name === 'list_issues'))
  assert.ok(made.every((c) => /^Bearer at-/.test(c.auth)))
  // the token is in no connection, suggestion, audit line or public answer
  const token = made[0].auth.slice(7)
  for (const blob of [world.connections.rows, await world.live.store.list(world.slate._id), world.live.applied, world.audits, await world.service.list(world.ada, { shareId: 'share1' })])
    assert.ok(!JSON.stringify(blob).includes(token))
  // and the open server never sees it
  await world.service.discover(world.ada, { shareId: 'share1', address: servers.url('/open/mcp') })
  assert.ok(servers.calls.filter((c) => c.kind === 'open').every((c) => c.auth === null))
})

test('only the inviter can start a sign-in for their own vault; sign-in needs Pro too', async () => {
  const world = makeWorld({ pro: ['ada'] })
  await refusedWith(world.service.startSignIn(world.sam, { shareId: 'share1', address: servers.url('/oauth/mcp') }), 'pro_required')
  const started = await world.service.startSignIn(world.ada, { shareId: 'share1', address: servers.url('/oauth/mcp') })
  assert.equal((await world.service.signInStatus(world.sam, { flowId: started.flowId })).status, 'unknown')
  assert.equal((await world.service.signInStatus(world.ada, { flowId: started.flowId })).status, 'pending')
})

test('an expired access token is renewed once during an ask; a refused renewal shows "needs sign-in" on the agent', async () => {
  const world = makeWorld()
  servers.oauth.expiresIn = 1
  await signInThroughService(world)
  servers.oauth.expiresIn = 3600
  const calls = servers.oauth.refreshCalls
  // the first use after sign-in finds the token about to expire and renews it, once
  const conn = await inviteSignedIn(world)
  assert.equal(servers.oauth.refreshCalls, calls + 1)
  await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'again' })
  assert.equal(servers.oauth.refreshCalls, calls + 1)
  // the server forgets every token: the agent needs sign-in, no loop
  servers.oauth.access.clear()
  servers.oauth.refresh.clear()
  const before = servers.oauth.refreshCalls
  await refusedWith(world.service.call(world.ada, { connectionId: conn.connectionId, request: 'and again' }), 'needs_sign_in')
  assert.ok(servers.oauth.refreshCalls - before <= 1)
  assert.equal(world.connections.rows[0].status, 'needs_sign_in')
  // signing in again (the walkthrough's sign-in, then its discovery) brings it back
  await signInThroughService(world)
  await world.service.discover(world.ada, { shareId: 'share1', address: servers.url('/oauth/mcp') })
  assert.equal(world.connections.rows[0].status, 'active')
  await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'back' })
  assert.equal(world.connections.rows[0].status, 'active')
})

test('Pro ended: the agent shows it, asking is refused with pro_required, and renewing brings it back', async () => {
  const world = makeWorld()
  await signInThroughService(world)
  const conn = await inviteSignedIn(world)
  world.proList.length = 0
  const listed = await world.service.list(world.ada, { shareId: 'share1' })
  assert.equal(listed.connections[0].status, 'pro_ended')
  await refusedWith(world.service.call(world.ada, { connectionId: conn.connectionId, request: 'x' }), 'pro_required')
  world.proList.push('ada')
  assert.equal((await world.service.list(world.ada, { shareId: 'share1' })).connections[0].status, 'active')
})

test('remove: the sign-in is revoked and forgotten when no other slate uses that server, kept while one does', async () => {
  const world = makeWorld()
  await signInThroughService(world)
  const one = await inviteSignedIn(world)
  const two = await inviteSignedIn(world)
  const revoked = servers.oauth.revoked.length
  await world.service.disconnect(world.ada, { connectionId: one.connectionId })
  assert.equal(world.credentials.rows.size, 1)
  assert.equal(servers.oauth.revoked.length, revoked)
  await world.service.disconnect(world.ada, { connectionId: two.connectionId })
  assert.equal(world.credentials.rows.size, 0)
  assert.equal(servers.oauth.revoked.length, revoked + 2)
})

test('housekeeping: a sign-in no agent uses is forgotten after a day; one whose Pro ended 30 days ago too', async () => {
  const world = makeWorld()
  await signInThroughService(world)
  const rows = () => [...world.credentials.rows.values()].map(({ ownerId, address, createdAt }) => ({ ownerId, address, createdAt }))
  assert.deepEqual(await world.service.sweep(async () => rows()), { removed: 0 })
  world.credentials.rows.values().next().value.createdAt = new Date(Date.now() - 25 * 3600000)
  assert.deepEqual(await world.service.sweep(async () => rows()), { removed: 1 })
})

test('pasted keys: a server with no sign-in details takes a key; a wrong one is refused, the right one is sealed and used', async () => {
  const world = makeWorld()
  const first = await world.service.discover(world.ada, { shareId: 'share1', address: servers.url('/key/mcp') })
  assert.equal(first.signIn.method, 'key')
  await refusedWith(world.service.useKey(world.ada, { shareId: 'share1', address: servers.url('/key/mcp'), key: 'sk-wrong-key-000000' }), 'key_refused')
  await refusedWith(world.service.useKey(world.ada, { shareId: 'share1', address: servers.url('/key/mcp'), key: 'short' }), 'bad_key')
  assert.deepEqual(await world.service.useKey(world.ada, { shareId: 'share1', address: servers.url('/key/mcp'), key: 'Bearer ' + KEY }), { ok: true, host: new URL(servers.origin).host })
  assert.ok(!JSON.stringify([...world.credentials.rows.values()]).includes(KEY))
  const found = await world.service.discover(world.ada, { shareId: 'share1', address: servers.url('/key/mcp') })
  assert.equal(found.signedIn.kind, 'key')
  assert.deepEqual(found.tools.map((t) => t.name).sort(), ['create_issue', 'list_issues'])
})

test('hostile through the service: unsafe sign-in details are refused in plain words before any popup', async () => {
  const world = makeWorld()
  for (const [kind, code] of [['metadata', 'sign_in_unsafe'], ['nopkce', 'no_pkce'], ['issuer', 'sign_in_unsafe'], ['authjs', 'sign_in_unsafe']]) {
    await refusedWith(world.service.discover(world.ada, { shareId: 'share1', address: servers.url(`/hostile/${kind}/mcp`) }), code)
    await refusedWith(world.service.startSignIn(world.ada, { shareId: 'share1', address: servers.url(`/hostile/${kind}/mcp`) }), code)
  }
})

// ---------- routes.mjs: the three web addresses ----------

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: null }
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
  res.status = (code) => { res.statusCode = code; return res }
  res.send = (body) => { res.body = body; return res }
  res.json = (body) => { res.body = body; return res }
  res.redirect = (code, url) => { res.statusCode = code; res.headers.location = url; return res }
  return res
}

// The route's login-token lookup, as meteor.js does it against Meteor.users.
const userFromToken = async (req) => ({ 'ada-token': 'ada', 'sam-token': 'sam' })[req.headers?.['x-slatebox-login-token']] || null

test('routes: the client document, the start (HttpOnly cookie, then the server\'s page) and the callback (a safe page)', async () => {
  const { signIn } = makeSignIn()
  const routes = signInRoutes({ signIn: () => signIn, origin: () => 'https://app.example', userFor: userFromToken })
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]))
  assert.deepEqual(Object.keys(byPath).sort(), ['/connectors/oauth/callback', '/connectors/oauth/start', '/oauth/mcp-client.json'])
  const doc = fakeRes()
  byPath['/oauth/mcp-client.json'].handler({}, doc)
  assert.equal(doc.body.client_id, 'https://app.example/oauth/mcp-client.json')

  const started = await signIn.start({ userId: 'ada', address: servers.url('/oauth/mcp'), challenge: null })
  // a link to the start address does nothing: there is no GET start route
  assert.equal(routes.find((r) => r.path === '/connectors/oauth/start').method, 'POST')
  // someone signed out, or signed in as someone else, is refused (and nothing is claimed)
  const stranger0 = fakeRes()
  await byPath['/connectors/oauth/start'].handler({ body: { flow: started.flowId }, headers: {} }, stranger0)
  assert.equal(stranger0.statusCode, 401)
  assert.equal(stranger0.headers['set-cookie'], undefined)
  const start = fakeRes()
  await byPath['/connectors/oauth/start'].handler({ body: { flow: started.flowId }, headers: { 'x-slatebox-login-token': 'ada-token' } }, start)
  assert.equal(start.statusCode, 200)
  const location = start.body.authorizeUrl
  assert.ok(location.startsWith(servers.origin + '/as/authorize?'))
  const cookie = start.headers['set-cookie']
  assert.match(cookie, new RegExp(`^${COOKIE_PREFIX}${started.flowId}=[A-Za-z0-9_-]+; Path=/connectors/oauth; HttpOnly; SameSite=Lax; Max-Age=600; Secure$`))
  assert.equal(start.headers['referrer-policy'], 'no-referrer')

  // a callback without this browser's cookie: refused, in Slatebox's words, under a strict CSP
  const html = await (await fetch(location)).text()
  const query = Object.fromEntries(new URL(html.match(/id="allow" href="([^"]+)"/)[1].replace(/&amp;/g, '&')).searchParams)
  const stranger = fakeRes()
  await byPath['/connectors/oauth/callback'].handler({ query, headers: {} }, stranger)
  assert.equal(stranger.statusCode, 400)
  assert.match(stranger.body, /couldn&#39;t be verified/)
  assert.match(stranger.headers['content-security-policy'], /default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-/)
})

test('routes: the real browser\'s callback signs in and tells the walkthrough; Deny never shows the server\'s text', async () => {
  const { signIn } = makeSignIn()
  const routes = Object.fromEntries(signInRoutes({ signIn: () => signIn, origin: () => ORIGIN, userFor: userFromToken }).map((r) => [r.path, r]))
  const finishWith = async (choose) => {
    const started = await signIn.start({ userId: 'ada', address: servers.url('/oauth/mcp'), challenge: null })
    const start = fakeRes()
    await routes['/connectors/oauth/start'].handler({ body: { flow: started.flowId }, headers: { 'x-slatebox-login-token': 'ada-token' } }, start)
    assert.ok(!/Secure/.test(start.headers['set-cookie']), 'no Secure flag on a plain-http local origin')
    const html = await (await fetch(start.body.authorizeUrl)).text()
    const query = Object.fromEntries(new URL(html.match(new RegExp(`id="${choose}" href="([^"]+)"`))[1].replace(/&amp;/g, '&')).searchParams)
    const res = fakeRes()
    await routes['/connectors/oauth/callback'].handler({ query, headers: { cookie: `other=1; ${start.headers['set-cookie'].split(';')[0]}` } }, res)
    return { res, started }
  }
  const ok = await finishWith('allow')
  assert.equal(ok.res.statusCode, 200)
  assert.match(ok.res.body, /data-agent-sign-in="done"/)
  assert.match(ok.res.body, /BroadcastChannel\("slatebox-agent-sign-in"\)/)
  assert.match(ok.res.headers['set-cookie'], /Max-Age=0/)
  const denied = await finishWith('deny')
  assert.equal(denied.res.statusCode, 400)
  assert.match(denied.res.body, /Sign-in was cancelled/)
  assert.ok(!/evil\.example|password/.test(denied.res.body))
  assert.deepEqual(readCookies('a=1; sb_agent_signin_fx=abc; bad name=2'), { a: '1', sb_agent_signin_fx: 'abc' })
})
