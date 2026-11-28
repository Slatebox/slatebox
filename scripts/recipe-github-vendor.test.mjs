// The GitHub vendor for recipes: the webhook (signature over the raw body, each delivery once, the
// answer at once and the work after), the install callback (only an installation the person's own
// token sees is linked to them), the App's JWT and installation tokens, the REST client's gate and
// budget, the read-only session a recipe sees, the App credentials (sealed) and the manifest flow.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-github-vendor.test.mjs
import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync, randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { githubSignature, verifyGithubSignature } from '../enterprise/server/recipes/vendors/github/verify.mjs'
import { githubRoutes, openState, signState, triggerOf } from '../enterprise/server/recipes/vendors/github/routes.mjs'
import { appJwt, createInstallationTokens } from '../enterprise/server/recipes/vendors/github/app.mjs'
import { createGithubClient, createInstallationGate } from '../enterprise/server/recipes/vendors/github/client.mjs'
import { createGithubStores, memoryCollection } from '../enterprise/server/recipes/vendors/github/store.mjs'
import { createVendor, READ_CALLS } from '../enterprise/server/recipes/vendors/github/index.mjs'
import { appManifest } from '../enterprise/server/recipes/vendors/github/app-settings.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { createFakeGithub } from './fakes/github-api.mjs'

const SECRET = 'whsec_test_0123456789'
const NOW = Date.parse('2026-11-27T12:00:00Z')

// Recorded webhook payloads (GitHub's shapes, trimmed to the fields Slatebox reads).
const PUSH = {
  ref: 'refs/heads/main', before: 'a'.repeat(40), after: 'b'.repeat(40), deleted: false,
  repository: { full_name: 'acme/api', default_branch: 'main' }, installation: { id: 42 },
  commits: [{ id: 'b'.repeat(40), message: 'Add refunds', added: ['src/refunds.ts'], modified: ['src/index.ts'], removed: [] }],
  head_commit: { id: 'b'.repeat(40) },
}
const PULL = {
  action: 'synchronize', number: 482, repository: { full_name: 'acme/api', default_branch: 'main' }, installation: { id: 42 },
  pull_request: { number: 482, draft: false, merged: false, head: { sha: 'c'.repeat(40) }, base: { ref: 'main' }, labels: [{ name: 'backend' }] },
}

function request({ body, headers = {}, query } = {}) {
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  const req = Readable.from([raw])
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  req.query = query
  return req
}
function response() {
  const res = { statusCode: null, headers: {}, location: null }
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.end = () => res
  res.json = () => res
  res.setHeader = (k, v) => {
    res.headers[k] = v
  }
  res.redirect = (code, location) => {
    res.statusCode = code
    res.location = location
    return res
  }
  return res
}
const signed = (body, { event = 'push', delivery = 'd-1', secret = SECRET } = {}) => {
  const text = JSON.stringify(body)
  return request({ body: text, headers: { 'X-GitHub-Event': event, 'X-GitHub-Delivery': delivery, 'X-Hub-Signature-256': githubSignature(secret, text) } })
}

function routesWorld(extra = {}) {
  const stores = createGithubStores({ installations: memoryCollection(), deliveries: memoryCollection() })
  const triggered = []
  const paused = []
  const jobs = []
  const routes = githubRoutes({ stores, secret: () => SECRET, stateSecret: () => SECRET, later: (fn) => jobs.push(fn), now: () => NOW, ...extra })
  const hooks = { trigger: async (match, trigger) => triggered.push({ match, trigger }), pause: async (match, state) => paused.push({ match, state }) }
  const flush = async () => {
    while (jobs.length) await jobs.shift()()
  }
  return { stores, routes, triggered, paused, hooks, flush, events: routes.find((r) => r.path === '/integrations/github/events'), installed: routes.find((r) => r.path === '/integrations/github/installed') }
}

test('the signature is HMAC-SHA256 over the exact bytes; anything else is refused', () => {
  const raw = Buffer.from(JSON.stringify(PUSH))
  assert.ok(verifyGithubSignature({ secret: SECRET, signature: githubSignature(SECRET, raw), raw }))
  assert.ok(!verifyGithubSignature({ secret: SECRET, signature: githubSignature('other-secret-123', raw), raw }))
  assert.ok(!verifyGithubSignature({ secret: SECRET, signature: githubSignature(SECRET, raw), raw: Buffer.from(`${raw} `) }))
  assert.ok(!verifyGithubSignature({ secret: SECRET, signature: 'sha1=abc', raw }))
  assert.ok(!verifyGithubSignature({ secret: '', signature: githubSignature('', raw), raw }), 'no secret, no delivery')
})

test('the webhook: 401 unsigned (and a body already parsed is unsigned), 202 at once, each delivery once, work after the answer', async () => {
  const w = routesWorld()
  const bad = response()
  await w.events.handler(signed(PUSH, { secret: 'wrong-secret-xyz' }), bad, w.hooks)
  assert.equal(bad.statusCode, 401)
  const parsed = request({ body: '', headers: { 'x-github-event': 'push', 'x-github-delivery': 'd-9', 'x-hub-signature-256': githubSignature(SECRET, JSON.stringify(PUSH)) } })
  parsed.body = PUSH
  const refused = response()
  await w.events.handler(parsed, refused, w.hooks)
  assert.equal(refused.statusCode, 401)

  const ok = response()
  await w.events.handler(signed(PUSH), ok, w.hooks)
  assert.equal(ok.statusCode, 202)
  assert.equal(w.triggered.length, 0, 'nothing runs before the answer')
  await w.flush()
  assert.deepEqual(w.triggered, [{
    match: { vendor: 'github', event: 'github.push', installationId: '42', repo: 'acme/api' },
    trigger: { kind: 'vendor', event: 'github.push', repo: 'acme/api', before: 'a'.repeat(40), after: 'b'.repeat(40), branch: 'main', commits: [{ sha: 'b'.repeat(40), message: 'Add refunds' }], paths: ['src/index.ts', 'src/refunds.ts'] },
  }])
  const again = response()
  await w.events.handler(signed(PUSH), again, w.hooks)
  await w.flush()
  assert.equal(again.statusCode, 202)
  assert.equal(w.triggered.length, 1, 'a redelivery is answered and dropped')
})

test('only default-branch pushes and the five pull request actions become triggers', () => {
  assert.equal(triggerOf('push', { ...PUSH, ref: 'refs/heads/feature' }), null)
  assert.equal(triggerOf('push', { ...PUSH, deleted: true }), null)
  assert.equal(triggerOf('push', { ...PUSH, ref: 'refs/tags/v1' }), null)
  assert.equal(triggerOf('pull_request', { ...PULL, action: 'labeled' }), null)
  assert.deepEqual(triggerOf('pull_request', PULL).trigger, { kind: 'vendor', event: 'github.pull_request', repo: 'acme/api', action: 'synchronize', number: 482, headSha: 'c'.repeat(40), baseRef: 'main', draft: false, merged: false, labels: ['backend'] })
  assert.equal(triggerOf('issues', PULL), null)
})

test('installation events keep the installation current; an uninstall or removed repository pauses its recipes', async () => {
  const w = routesWorld()
  const res = response()
  await w.events.handler(signed({ action: 'created', installation: { id: 42, account: { login: 'acme', type: 'Organization' }, repository_selection: 'selected' }, repositories: [{ full_name: 'acme/api' }, { full_name: 'acme/web' }] }, { event: 'installation', delivery: 'i-1' }), res, w.hooks)
  await w.flush()
  assert.deepEqual((await w.stores.installations.get('42')).repos, ['acme/api', 'acme/web'])
  await w.events.handler(signed({ action: 'removed', installation: { id: 42 }, repositories_added: [], repositories_removed: [{ full_name: 'acme/web' }] }, { event: 'installation_repositories', delivery: 'i-2' }), response(), w.hooks)
  await w.flush()
  assert.deepEqual((await w.stores.installations.get('42')).repos, ['acme/api'])
  assert.deepEqual(w.paused.at(-1), { match: { vendor: 'github', installationId: '42', repo: 'acme/web' }, state: 'blocked_access' })
  await w.events.handler(signed({ action: 'deleted', installation: { id: 42 } }, { event: 'installation', delivery: 'i-3' }), response(), w.hooks)
  await w.flush()
  assert.equal(await w.stores.installations.get('42'), null)
  assert.deepEqual(w.paused.at(-1), { match: { vendor: 'github', installationId: '42' }, state: 'needs_sign_in' })
})

test('the install callback links an installation only when the person\'s own GitHub token sees it', async () => {
  const github = createFakeGithub()
  const seen = []
  const fetch = async (url, init) => {
    if (`${url}`.includes('/user/installations')) {
      seen.push(init.headers.authorization)
      return new Response(JSON.stringify({ installations: [{ id: 42, account: { login: 'acme' } }] }), { status: 200 })
    }
    return github.fetch(url, init)
  }
  const w = routesWorld({ fetch, apiBase: 'https://api.github.com', oauth: { exchange: async (code) => `ghu_${code}` }, installationInfo: async () => ({ account: 'acme', accountType: 'Organization', repos: ['acme/api'] }) })
  const state = signState(SECRET, { userId: 'ana', projectId: 'p1', at: NOW - 60000 })
  const res = response()
  await w.installed.handler(request({ body: '', query: { installation_id: '42', setup_action: 'install', state, code: 'abc' } }), res)
  assert.equal(res.statusCode, 302)
  assert.equal(res.location, '/projects/p1?github=installed')
  assert.deepEqual(seen, ['Bearer ghu_abc'])
  assert.ok(await w.stores.installations.userCanSee('ana', '42'))
  // Someone else's installation id, with the person's own state: refused, not linked.
  const other = response()
  await w.installed.handler(request({ body: '', query: { installation_id: '99', state, code: 'abc' } }), other)
  assert.equal(other.location, '/projects/p1?github=refused')
  assert.ok(!(await w.stores.installations.userCanSee('ana', '99')))
  // A forged or expired state, or no code: refused.
  for (const query of [{ installation_id: '42', state: `${state}x`, code: 'abc' }, { installation_id: '42', state: signState(SECRET, { userId: 'ana', at: NOW - 3600000 }), code: 'abc' }, { installation_id: '42', state }]) {
    const r = response()
    await w.installed.handler(request({ body: '', query }), r)
    assert.match(r.location, /github=refused$/)
  }
  assert.equal(openState('another-secret', state, NOW), null)
})

test('the App JWT is RS256, issued a minute back, nine minutes long; installation tokens are cached until five minutes before expiry', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' })
  const jwt = appJwt({ appId: 123, privateKey: pem, now: NOW })
  const [head, body, sig] = jwt.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'RS256', typ: 'JWT' })
  const claims = JSON.parse(Buffer.from(body, 'base64url'))
  assert.deepEqual(claims, { iat: NOW / 1000 - 60, exp: NOW / 1000 + 540, iss: '123' })
  assert.ok(createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, Buffer.from(sig, 'base64url')))
  const github = createFakeGithub({ now: () => NOW })
  let at = NOW
  const tokens = createInstallationTokens({ fetch: github.fetch, credentials: async () => ({ appId: 123, privateKey: pem }), now: () => at })
  const one = await tokens.token(42)
  assert.equal(await tokens.token(42), one)
  at = NOW + 54 * 60000
  assert.equal(await tokens.token(42), one)
  at = NOW + 56 * 60000
  assert.notEqual(await tokens.token(42), one)
  assert.equal(github.calls.filter((c) => c.path.endsWith('/access_tokens')).length, 2)
  assert.ok(github.calls.every((c) => c.auth.startsWith('Bearer ey')), 'the App\'s JWT, never a token, asks for tokens')
})

test('the client: the installation gate, GitHub\'s own remaining count, a token refreshed once on 401, and the run budget', async () => {
  const gate = createInstallationGate({ now: () => NOW, limit: 105, reserve: 100 })
  const github = createFakeGithub()
  github.addRepo('acme/api', { files: { 'a.ts': '' } })
  const client = createGithubClient({ fetch: github.fetch, installationId: '42', token: async () => 't', gate })
  for (let k = 0; k < 2; k += 1) await client.repo('acme/api')
  await assert.rejects(client.head('acme/api').then(() => client.repo('acme/api')).then(() => client.repo('acme/api')).then(() => client.repo('acme/api')), (e) => e.code === 'rate_limited' && e.retryable === true)
  // GitHub says none are left.
  const empty = async () => new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 600) } })
  await assert.rejects(createGithubClient({ fetch: empty, installationId: '1', token: async () => 't' }).repo('acme/api'), (e) => e.code === 'rate_limited' && e.status === 429)
  // A 401 refreshes the token once.
  let calls = 0
  const flaky = async (url, init) => (calls++ === 0 ? new Response('{}', { status: 401 }) : github.fetch(url, init))
  let refreshed = 0
  const c2 = createGithubClient({ fetch: flaky, installationId: '1', token: async () => 'old', refresh: async () => `new${(refreshed += 1)}` })
  assert.equal((await c2.repo('acme/api')).full_name, 'acme/api')
  assert.equal(refreshed, 1)
  // The run's budget.
  let left = 1
  const c3 = createGithubClient({ fetch: github.fetch, installationId: '1', token: async () => 't', budget: { spend: () => left-- > 0 } })
  await c3.repo('acme/api')
  await assert.rejects(c3.repo('acme/api'), (e) => e.code === 'budget')
  await assert.rejects(client.repo('not a repo'), (e) => e.code === 'invalid_repo')
})

function vendorWorld({ master = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }) } = {}) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const github = createFakeGithub()
  github.addRepo('acme/api', { files: { 'a.ts': '' } })
  const collections = { installations: memoryCollection(), deliveries: memoryCollection(), appSettings: memoryCollection(), flows: memoryCollection() }
  const settings = { appId: '123', slug: 'slatebox', clientId: 'Iv1.abc', clientSecret: 'cs_test_secret', privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }), webhookSecret: SECRET }
  const vendor = createVendor({ collections, master, settings: () => settings, fetch: github.fetch, now: () => NOW, origin: () => 'https://slate.example.com' })
  vendorWorld.lastCollections = collections
  return { vendor, github, collections }
}

test('a recipe\'s session reads only, on an installation its owner was shown to see, with every repository still in it', async () => {
  const { vendor, github } = vendorWorld()
  const instance = { ownerId: 'ana', match: { github: { installationId: '42', repos: ['acme/api'] } } }
  await assert.rejects(vendor.session(instance), (e) => e.name === 'SignInNeeded')
  await vendor.stores.installations.upsert('42', { repos: ['acme/api'], suspended: false })
  await assert.rejects(vendor.session(instance), (e) => e.name === 'SignInNeeded', 'not linked to Ana')
  await vendor.stores.installations.linkUser('42', 'ana')
  const session = await vendor.session(instance)
  assert.deepEqual(Object.keys(session).filter((k) => typeof session[k] === 'function').sort(), [...READ_CALLS].sort())
  for (const write of ['createComment', 'updateComment', 'createPull', 'updateRef', 'createRef', 'createCheckRun', 'createTree', 'createCommit', 'call']) assert.equal(session[write], undefined, write)
  assert.equal((await session.repo('acme/api')).default_branch, 'main')
  assert.ok(github.calls.at(-1).auth.startsWith('Bearer ghs_test_42'), 'an installation token')
  await vendor.stores.installations.setRepos('42', { removed: ['acme/api'] })
  await assert.rejects(vendor.session(instance), (e) => e.name === 'AccessLost')
  assert.deepEqual(vendor.matchInstances({ installationId: 42, repo: 'acme/api' }), { 'match.github.installationId': '42', 'match.github.repos': 'acme/api' })
  assert.equal(vendor.checkHardLimits({ kind: 'github.pull_request', target: { repo: 'acme/api', branch: 'main' }, body: { files: [{ path: 'x.mmd', content: '' }] } }), 'refused')
  assert.match(await vendor.installUrl('ana', 'p1'), /^https:\/\/github\.com\/apps\/slatebox\/installations\/new\?state=/)
})

test('App credentials entered in Admin are sealed and never shown; the manifest flow is single use', async () => {
  const { vendor, github } = vendorWorld()
  const s = vendor.appSettings
  const before = await s.view()
  assert.equal(before.ready, true)
  assert.equal(before.source, 'settings')
  assert.ok(!JSON.stringify(before).includes('cs_test_secret') && !JSON.stringify(before).includes('PRIVATE KEY'))
  await assert.rejects(s.set({ actor: { userId: 'admin' }, values: { privateKey: 'not a key' } }), (e) => e.code === 'invalid_request')
  const after = await s.set({ actor: { userId: 'admin' }, values: { clientSecret: 'cs_new_secret' } })
  const doc = [...vendorWorld.lastCollections.appSettings.docs.values()][0]
  assert.ok(doc.clientSecret && !JSON.stringify(doc).includes('cs_new_secret'), 'stored sealed')
  assert.equal(after.source, 'admin')
  assert.match(after.fingerprints.clientSecret, /^sha256:/)
  assert.equal((await s.credentials()).clientSecret, 'cs_new_secret')
  const manifest = appManifest('https://slate.example.com')
  assert.deepEqual(manifest.default_permissions, { metadata: 'read', contents: 'write', pull_requests: 'write', checks: 'write' })
  assert.equal(manifest.hook_attributes.url, 'https://slate.example.com/integrations/github/events')
  assert.equal(manifest.request_oauth_on_install, true)
  const form = await s.manifestFor({ actor: { userId: 'admin' } })
  assert.match(form.action, /^https:\/\/github\.com\/settings\/apps\/new\?state=/)
  const conversions = async (url, init) => (`${url}`.includes('/app-manifests/') ? new Response(JSON.stringify({ id: 777, slug: 'acme-slatebox', client_id: 'Iv1.new', client_secret: 'cs_made', pem: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }), webhook_secret: 'whsec_made_123' }), { status: 201 }) : github.fetch(url, init))
  const v2 = createVendor({ collections: vendorWorld().collections, master: loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }), settings: () => ({}), fetch: conversions, now: () => NOW, origin: () => 'https://slate.example.com' })
  const f2 = await v2.appSettings.manifestFor({ actor: { userId: 'admin' } })
  const made = await v2.appSettings.finishManifest({ code: 'code123', state: f2.state })
  assert.equal(made.appId, '777')
  assert.equal(made.ready, true)
  await assert.rejects(v2.appSettings.finishManifest({ code: 'code123', state: f2.state }), (e) => e.code === 'invalid_request', 'the state is single use')
})

test('the GitHub App actions: one registry with the recipes scope, every write says what the log keeps, admins only', async () => {
  const { githubAppActions } = await import('../enterprise/server/recipes/vendors/github/actions.mjs')
  const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
  const { API_TOKEN_SCOPES } = await import('../web/app/server/api-token-core.mjs')
  const { vendor } = vendorWorld()
  const list = githubAppActions(() => vendor)
  // recipes:read is the runtime's scope (design B.13); without it the registry refuses the action.
  assert.throws(() => createAppRegistry({ extraActions: list }), /unknown scope recipes:read/)
  const registry = createAppRegistry({ extraActions: list, scopes: [...API_TOKEN_SCOPES, 'recipes:read'] })
  const ours = registry.list().filter((a) => a.id.includes('githubApp') || a.id.startsWith('recipes.github'))
  assert.deepEqual(ours.map((a) => a.id).sort(), ['connectors.githubApp.clear', 'connectors.githubApp.get', 'connectors.githubApp.manifest', 'connectors.githubApp.set', 'recipes.github.installations'])
  for (const a of ours.filter((x) => x.kind === 'write')) {
    assert.ok(a.audit, a.id)
    assert.deepEqual(a.principals, ['person'], `${a.id}: never a token`)
  }
  const get = list.find((a) => a.id === 'connectors.githubApp.get')
  await assert.rejects(get.handler({ kind: 'person', userId: 'ana' }, {}, { deps: { aiControlAdmin: async () => false } }), (e) => e.status === 403)
  const view = await get.handler({ kind: 'person', userId: 'root' }, {}, { deps: { aiControlAdmin: async () => true } })
  assert.equal(view.body.ready, true)
  await vendor.stores.installations.upsert('42', { account: 'acme', repos: ['acme/web', 'acme/api'] })
  await vendor.stores.installations.linkUser('42', 'ana')
  const mine = await list.find((a) => a.id === 'recipes.github.installations').handler({ kind: 'person', userId: 'ana' }, { projectId: 'p1' })
  assert.deepEqual(mine.body.installations, [{ installationId: '42', account: 'acme', repos: ['acme/api', 'acme/web'], allRepos: false }])
  assert.match(mine.body.installUrl, /installations\/new\?state=/)
  const nobody = await list.find((a) => a.id === 'recipes.github.installations').handler({ kind: 'person', userId: 'bo' }, {})
  assert.deepEqual(nobody.body.installations, [])
})
