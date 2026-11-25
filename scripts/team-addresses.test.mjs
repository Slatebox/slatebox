// Team addresses (https://<name>.slatebox.team, Slatebox Cloud only): names, limits, the
// idempotent create saga and its rollback at every step, the Cloudflare client's retries,
// connector tokens and install credentials, rename, release, takedown, the reconciler, the HTTP
// routes (404 off Cloud, auth) and the admin methods. Cloudflare is a fake behind fetch
// (scripts/fake-cloudflare.mjs); nothing here touches the network.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/team-addresses.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import express from 'express'
import { createFakeCloudflare, FAKE } from './fake-cloudflare.mjs'
import { checkName, fold, refusal, suggestionsFor, NAME_RULE } from '../enterprise/team-addresses/names.mjs'
import { createCloudflare, CloudflareError } from '../enterprise/team-addresses/cf.mjs'
import { createTeamAddressService, ingressFor, LIMITS, ORIGIN_SERVICE, SUSPENDED_INGRESS, TeamAddressError } from '../enterprise/team-addresses/claims.mjs'
import { memoryStore, mongoStore } from '../enterprise/team-addresses/store.mjs'
import { createReconciler, REAP } from '../enterprise/team-addresses/reconcile.mjs'
import { teamAddressRoutes, BASE } from '../enterprise/team-addresses/routes.mjs'
import { adminMethods, ADMIN_METHODS } from '../enterprise/team-addresses/admin.mjs'
import { registerTeamAddresses } from '../enterprise/team-addresses/index.mjs'
import { createEnterpriseHost } from '../web/app/server/enterprise-loader.mjs'

const DAY = 86_400_000

function world({ users: extraUsers = {}, config: extraConfig = {}, limits } = {}) {
  let clock = Date.parse('2026-11-24T12:00:00Z')
  const now = () => clock
  const fake = createFakeCloudflare({ now })
  const cf = createCloudflare({ ...FAKE, fetch: fake.fetch, sleep: async () => {}, random: () => 0, now })
  const store = memoryStore({ now })
  const users = {
    ada: { _id: 'ada', emails: [{ address: 'ada@example.com', verified: true }] },
    sam: { _id: 'sam', emails: [{ address: 'sam@example.com', verified: true }] },
    una: { _id: 'una', emails: [{ address: 'una@example.com', verified: false }] },
    ghost: { _id: 'ghost', isAnonymous: true },
    e2e: { _id: 'e2e', emails: [{ address: 'e2e@example.com', verified: true }] },
    ...extraUsers,
  }
  const config = { token: FAKE.token, accountId: FAKE.accountId, zoneId: FAKE.zoneId, zoneName: 'slatebox.team', e2eAccounts: ['e2e'], ...extraConfig }
  const notices = []
  const logs = []
  const service = createTeamAddressService({
    store,
    cf,
    config: () => config,
    findUser: async (id) => users[id] || null,
    notify: (message) => notices.push(message),
    log: (line) => logs.push(line),
    now,
    ...(limits && { limits: { ...LIMITS, ...limits } }),
  })
  return { fake, cf, store, service, users, config, notices, logs, now, tick: (ms) => (clock += ms) }
}

const user = (id) => ({ _id: id })
const rejectsWith = async (promise, code) =>
  assert.rejects(promise, (error) => {
    assert.ok(error instanceof TeamAddressError, `${error?.name}: ${error?.message}`)
    assert.equal(error.code, code, error.message)
    return true
  })

// ---- names ------------------------------------------------------------------------------------

test('a team address is one DNS label of 3 to 32 characters, never punycode', () => {
  for (const good of ['acme', 'a1b', 'acme-boards', 'x'.repeat(32), 'acme-2026']) assert.equal(checkName(good).ok, true, good)
  for (const bad of ['ab', 'x'.repeat(33), '1acme', '-acme', 'acme-', 'ac--me', 'xn--80ak6aa92e', 'Acme_1', 'ac me', 'acmé', '', null, 42]) {
    const checked = checkName(bad)
    assert.equal(checked.ok, false, String(bad))
    assert.equal(checked.code, 'invalid_name', String(bad))
  }
  assert.equal(checkName('  ACME ').name, 'acme')
  assert.match(NAME_RULE, /3–32 characters: a–z, 0–9 and hyphens, starting with a letter, not ending with a hyphen/)
})

test('reserved, brand and offensive names are refused, with look-alike digits folded', () => {
  for (const name of ['www', 'app', 'api', 'admin', 'mail', 'docs', 'slatebox', 'test', 'staging', 'login', 'support', 'status', 'auth', 'cdn', 'e2e', 'no-reply'])
    assert.equal(refusal(name), 'reserved', name)
  for (const name of ['paypal-login', 'pay-pal', 'paypa1', 'p4ypal', 'g00gle-docs', 'my-bank', 'secure-login-x', 'meta', 'meta-login', 'apple-id', 'cl0udflare'])
    assert.equal(refusal(name), 'brand', name)
  for (const name of ['metal-works', 'pineapple', 'purchase-team', 'laws-firm', 'document-hub', 'spice-co', 'peacock', 'crisis-desk', 'torpedo'])
    assert.equal(refusal(name), null, name)
  assert.equal(refusal('sh1t-team'), 'offensive')
  assert.equal(refusal('acme', [{ pattern: 'acme', kind: 'exact' }]), 'blocked')
  assert.equal(refusal('big-acme-co', [{ pattern: 'acme', kind: 'substring' }]), 'blocked')
  assert.equal(fold('p4y-pa1'), 'paypal')
  // e2e- names are the end-to-end test's, and only its accounts may claim them.
  assert.equal(refusal('e2e-1a2b3c4d'), 'reserved')
  assert.equal(refusal('e2e-1a2b3c4d', [], { e2e: true }), null)
  // Suggestions always pass the rules.
  for (const candidate of suggestionsFor('support')) assert.equal(checkName(candidate).ok, true, candidate)
})

// ---- the Cloudflare client ---------------------------------------------------------------------

test('Cloudflare calls retry network errors, 429 and 5xx with backoff, never another 4xx, and keep only error codes', async () => {
  const fake = createFakeCloudflare()
  const waits = []
  const cf = createCloudflare({ ...FAKE, fetch: fake.fetch, sleep: async (ms) => waits.push(ms), random: () => 0 })
  fake.fail('POST', /cfd_tunnel$/, { network: true })
  fake.fail('POST', /cfd_tunnel$/, { status: 429, headers: { 'retry-after': '3' } })
  fake.fail('POST', /cfd_tunnel$/, { status: 503 })
  const made = await cf.createTunnel('sbx-retry')
  assert.ok(made.id)
  assert.deepEqual(waits, [500, 3000, 2000])
  fake.fail('GET', /dns_records$/, { status: 400, code: 9999, message: 'bad request body here' })
  await assert.rejects(cf.findCname('x.slatebox.team'), (error) => {
    assert.ok(error instanceof CloudflareError)
    assert.equal(error.retryable, false)
    assert.deepEqual(error.errors, [{ code: 9999, message: 'bad request body here' }])
    return true
  })
  fake.fail('GET', /cfd_tunnel\/[^/]+$/, { status: 500, times: 4 })
  await assert.rejects(cf.getTunnel(made.id), (error) => error.retryable === true)
  // Deletes count a 404 as done; the token goes in the Authorization header only.
  assert.equal(await cf.deleteDns('nope'), false)
  for (const call of fake.calls) {
    assert.equal(call.headers.Authorization, `Bearer ${FAKE.token}`)
    assert.ok(!call.query.includes(FAKE.token) && !JSON.stringify(call.body || {}).includes(FAKE.token))
  }
})

// ---- create ------------------------------------------------------------------------------------

test('a claim makes the tunnel, its ingress, a proxied CNAME and a credential, and hands out the connector token once', async () => {
  const w = world()
  const { status, body } = await w.service.claim({ user: user('ada'), name: 'Acme', clientKey: 'k1', label: 'tims-mbp', ip: '198.51.100.4', ua: 'slatebox/0.2.0' })
  assert.equal(status, 201)
  assert.equal(body.claim.host, 'acme.slatebox.team')
  assert.equal(body.claim.status, 'active')
  assert.match(body.installCredential, /^sbxi_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/)
  const [tunnel] = w.fake.liveTunnels()
  assert.equal(tunnel.name, `sbx-${body.claim.id}`, 'the tunnel is named after our id, never the customer name')
  assert.equal(body.connectorToken, w.fake.tokenFor(tunnel))
  assert.deepEqual(tunnel.config, ingressFor(['acme.slatebox.team']))
  const [record] = w.fake.records.values()
  assert.equal(record.name, 'acme.slatebox.team')
  assert.equal(record.content, `${tunnel.id}.cfargotunnel.com`)
  assert.equal(record.proxied, true)
  assert.equal(record.comment, `slatebox-team-claim:${body.claim.id}`)
  // Stored: never the connector token, never the credential itself.
  const stored = JSON.stringify([...w.store.claims.docs.values()])
  assert.ok(!stored.includes(body.connectorToken))
  assert.ok(!stored.includes(body.installCredential))
  assert.equal(w.notices.length, 1, 'the owner is told about every claim')
})

test('the ingress never takes a request field: extra body fields change nothing', async () => {
  const w = world()
  const sneaky = { user: user('ada'), name: 'acme', clientKey: 'k', service: 'http://169.254.169.254', hostname: 'evil.example', originService: 'http://10.0.0.1:80', ingress: [{ service: 'http://internal' }] }
  await w.service.claim(sneaky)
  const [tunnel] = w.fake.liveTunnels()
  assert.equal(JSON.stringify(tunnel.config), JSON.stringify(ingressFor(['acme.slatebox.team'], ORIGIN_SERVICE)))
  assert.equal(tunnel.config['warp-routing'].enabled, false)
  // A settings value that is not this computer's origin is ignored too.
  const v = world({ config: { originService: 'http://169.254.169.254:80' } })
  await v.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  assert.equal(v.fake.liveTunnels()[0].config.ingress[0].service, ORIGIN_SERVICE)
})

test('create is idempotent: a replay returns the same claim with a fresh token and no second credential', async () => {
  const w = world()
  const first = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k1', idempotencyKey: 'idem-1' })
  const again = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k1', idempotencyKey: 'idem-1' })
  assert.equal(again.status, 200)
  assert.equal(again.body.claim.id, first.body.claim.id)
  assert.equal(again.body.installCredential, null)
  assert.ok(again.body.connectorToken)
  assert.match(again.body.hint, /install credential/)
  assert.equal(w.fake.liveTunnels().length, 1)
  assert.equal(w.fake.records.size, 1)
})

test('Cloudflare down mid-create keeps the claim pending; the replay resumes it without a second tunnel', async () => {
  const w = world()
  w.fake.fail('POST', /dns_records$/, { status: 503, times: 4 })
  await rejectsWith(w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k1' }), 'upstream_unavailable')
  const [pending] = w.store.claims.docs.values()
  assert.equal(pending.status, 'pending')
  assert.ok(pending.cf.tunnelId)
  assert.equal(pending.installCredential, null, 'no credential is minted before the claim can hand out its token')
  const resumed = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k1' })
  assert.equal(resumed.status, 201)
  assert.equal(resumed.body.claim.id, pending._id)
  assert.ok(resumed.body.installCredential)
  assert.equal(w.fake.liveTunnels().length, 1)
  // A crash after the tunnel was made but before its id was stored: the tunnel is found by name.
  const v = world()
  v.fake.fail('PUT', /configurations$/, { status: 502, times: 4 })
  await rejectsWith(v.service.claim({ user: user('ada'), name: 'beta-co', clientKey: 'k' }), 'upstream_unavailable')
  const [doc] = v.store.claims.docs.values()
  doc.cf = {}
  await v.service.claim({ user: user('ada'), name: 'beta-co', clientKey: 'k' })
  assert.equal(v.fake.liveTunnels().length, 1)
})

test('a hard failure at any step rolls back in reverse, frees the name, and hands out nothing', async () => {
  for (const [method, path] of [['POST', /cfd_tunnel$/], ['PUT', /configurations$/], ['POST', /dns_records$/], ['GET', /\/token$/]]) {
    const w = world()
    w.fake.fail(method, path, { status: 400 })
    await rejectsWith(w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' }), 'upstream_unavailable')
    const [doc] = w.store.claims.docs.values()
    assert.equal(doc.status, 'failed', `${method} ${path}`)
    assert.equal(doc.needsCleanup, false)
    assert.equal(w.fake.liveTunnels().length, 0, `no tunnel left after ${method} ${path}`)
    assert.equal(w.fake.records.size, 0, `no record left after ${method} ${path}`)
    assert.equal(doc.installCredential, null)
    // The name is free again.
    const retry = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
    assert.equal(retry.status, 201)
  }
})

test('a failure while undoing leaves needsCleanup for the reconciler, which finishes it', async () => {
  const w = world()
  w.fake.fail('GET', /\/token$/, { status: 400 })
  w.fake.fail('DELETE', /cfd_tunnel\/[^/]+$/, { status: 400 })
  await rejectsWith(w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' }), 'upstream_unavailable')
  const [doc] = w.store.claims.docs.values()
  assert.equal(doc.status, 'failed')
  assert.equal(doc.needsCleanup, true)
  assert.equal(w.fake.liveTunnels().length, 1)
  const report = await createReconciler({ store: w.store, cf: w.cf, service: w.service, now: w.now }).run()
  assert.equal(w.fake.liveTunnels().length, 0)
  assert.ok(report.fixed.some((line) => line.includes('cleaned_up')))
})

test('a DNS record for the name that points elsewhere is a conflict: rolled back, never reused', async () => {
  const w = world()
  w.fake.records.set('foreign', { id: 'foreign', type: 'CNAME', name: 'acme.slatebox.team', content: 'other.cfargotunnel.com' })
  await rejectsWith(w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' }), 'conflict')
  assert.equal(w.fake.liveTunnels().length, 0)
  assert.equal(w.fake.records.get('foreign').content, 'other.cfargotunnel.com')
})

// ---- availability and limits --------------------------------------------------------------------

test('reserved, blocked, taken and held names all answer the same "unavailable"', async () => {
  const w = world()
  await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  for (const name of ['acme', 'support', 'paypal-login']) {
    const answer = await w.service.availability({ name, ip: '198.51.100.9' })
    assert.deepEqual(answer, { name, available: false }, 'no suggestions without sign-in')
    await rejectsWith(w.service.claim({ user: user('sam'), name, clientKey: 'k' }), 'unavailable')
  }
  const signedIn = await w.service.availability({ name: 'acme', user: user('sam'), ip: '198.51.100.9' })
  assert.equal(signedIn.available, false)
  assert.equal(signedIn.suggestions.length, 3)
  await rejectsWith(w.service.availability({ name: 'Acme_1', ip: '198.51.100.9' }), 'invalid_name')
  assert.deepEqual(await w.service.availability({ name: 'fresh-co', ip: '198.51.100.9' }), { name: 'fresh-co', available: true })
  // Availability never calls Cloudflare.
  const before = w.fake.calls.length
  await w.service.availability({ name: 'another-co', ip: '198.51.100.9' })
  assert.equal(w.fake.calls.length, before)
})

test('three addresses per account, new-claim limits, a verified email, and the per-IP check limit', async () => {
  const w = world()
  for (const name of ['one-co', 'two-co', 'three-co']) await w.service.claim({ user: user('ada'), name, clientKey: name })
  await rejectsWith(w.service.claim({ user: user('ada'), name: 'four-co', clientKey: 'x' }), 'limit_reached')
  await rejectsWith(w.service.claim({ user: user('una'), name: 'una-co', clientKey: 'x' }), 'unverified')
  await rejectsWith(w.service.claim({ user: user('ghost'), name: 'ghost-co', clientKey: 'x' }), 'unauthorized')
  await rejectsWith(w.service.claim({ user: null, name: 'none-co', clientKey: 'x' }), 'unauthorized')
  // Claim and release churn: five new claims a day.
  const v = world()
  for (let i = 0; i < 5; i += 1) {
    const { body } = await v.service.claim({ user: user('sam'), name: `churn-${i}x`, clientKey: `c${i}` })
    await v.service.releaseByOwner({ user: user('sam'), id: body.claim.id })
  }
  await rejectsWith(v.service.claim({ user: user('sam'), name: 'churn-6x', clientKey: 'c6' }), 'rate_limited')
  for (let i = 0; i < 30; i += 1) await w.service.availability({ name: `n-${i}xx`, ip: '203.0.113.1' })
  await rejectsWith(w.service.availability({ name: 'n-last', ip: '203.0.113.1' }), 'rate_limited')
})

test('the e2e- prefix is only for the accounts the settings name', async () => {
  const w = world()
  await rejectsWith(w.service.claim({ user: user('ada'), name: 'e2e-1a2b3c4d', clientKey: 'k' }), 'unavailable')
  const ok = await w.service.claim({ user: user('e2e'), name: 'e2e-1a2b3c4d', clientKey: 'k' })
  assert.equal(ok.status, 201)
})

test('paused (settings or the admin switch), the tunnel cap, and the circuit breaker stop new claims only', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'live-co', clientKey: 'k' })
  w.config.paused = true
  await rejectsWith(w.service.claim({ user: user('sam'), name: 'sam-co', clientKey: 'k' }), 'paused')
  w.config.paused = false
  await w.service.setPaused({ admin: 'root', paused: true })
  await rejectsWith(w.service.claim({ user: user('sam'), name: 'sam-co', clientKey: 'k' }), 'paused')
  // Live claims keep working while paused.
  const claim = await w.service.authenticateInstall(body.installCredential)
  assert.ok((await w.service.connectorToken({ claim })).connectorToken)
  await w.service.setPaused({ admin: 'root', paused: false })
  w.config.maxTunnels = 1
  await rejectsWith(w.service.claim({ user: user('sam'), name: 'sam-co', clientKey: 'k' }), 'paused')
  const v = world({ limits: { claimsPerHourEverywhere: 2 } })
  await v.service.claim({ user: user('ada'), name: 'a-one', clientKey: 'k' })
  await v.service.claim({ user: user('sam'), name: 's-one', clientKey: 'k' })
  await rejectsWith(v.service.claim({ user: user('e2e'), name: 'e-one', clientKey: 'k' }), 'paused')
  assert.equal(await v.store.flags.get('paused'), true, 'the breaker leaves new claims paused')
  assert.ok(v.notices.some((notice) => notice.userId === null && /circuit breaker/.test(notice.subject)))
})

// ---- install credential and connector tokens ------------------------------------------------------

test('the install credential reaches its own claim only; token fetches are limited and rotation drops connectors', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  const other = await w.service.claim({ user: user('sam'), name: 'other-co', clientKey: 'k' })
  const claim = await w.service.authenticateInstall(body.installCredential)
  assert.equal(claim._id, body.claim.id)
  assert.equal(await w.service.authenticateInstall(body.installCredential.slice(0, -1) + (body.installCredential.endsWith('A') ? 'B' : 'A')), null)
  assert.equal(await w.service.authenticateInstall('sbx_abc_def'), null)
  assert.equal((await w.service.authenticateInstall(other.body.installCredential))._id, other.body.claim.id)
  const tunnel = w.fake.liveTunnels().find((t) => t.name === `sbx-${claim._id}`)
  w.fake.connect(tunnel.id, 'install-1')
  w.fake.connect(tunnel.id, 'thief-1')
  const oldToken = w.fake.tokenFor(tunnel)
  const rotated = await w.service.connectorToken({ claim, rotate: true })
  assert.notEqual(rotated.connectorToken, oldToken)
  assert.equal(tunnel.connections.length, 0, 'rotation drops every connector, a stolen copy too')
  for (let i = 1; i < LIMITS.tokenFetchesPerHour; i += 1) await w.service.connectorToken({ claim })
  await rejectsWith(w.service.connectorToken({ claim }), 'rate_limited')
  w.tick(3_600_001)
  assert.ok((await w.service.connectorToken({ claim })).connectorToken)
})

test('a new install credential stops the old one and rotates the tunnel', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  const tunnel = w.fake.liveTunnels()[0]
  const before = w.fake.tokenFor(tunnel)
  await rejectsWith(w.service.mintInstallCredential({ user: user('sam'), id: body.claim.id }), 'not_found')
  const minted = await w.service.mintInstallCredential({ user: user('ada'), id: body.claim.id })
  assert.notEqual(minted.installCredential, body.installCredential)
  assert.notEqual(minted.connectorToken, before)
  assert.equal(await w.service.authenticateInstall(body.installCredential), null)
  assert.ok(await w.service.authenticateInstall(minted.installCredential))
})

// ---- rename and release -------------------------------------------------------------------------------

test('rename serves both names until the install confirms, then the old one goes and is held for its owner', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  await rejectsWith(w.service.rename({ user: user('sam'), id: body.claim.id, name: 'zeta-co' }), 'not_found')
  const renamed = await w.service.rename({ user: user('ada'), id: body.claim.id, name: 'acme-new' })
  assert.equal(renamed.claim.host, 'acme-new.slatebox.team')
  const tunnel = w.fake.liveTunnels()[0]
  assert.deepEqual(tunnel.config.ingress.map((rule) => rule.hostname || rule.service), ['acme-new.slatebox.team', 'acme.slatebox.team', 'http_status:404'])
  assert.deepEqual([...w.fake.records.values()].map((r) => r.name).sort(), ['acme-new.slatebox.team', 'acme.slatebox.team'])
  const claim = await w.service.authenticateInstall(body.installCredential)
  await w.service.renameComplete({ claim })
  assert.deepEqual(w.fake.liveTunnels()[0].config, ingressFor(['acme-new.slatebox.team']))
  assert.deepEqual([...w.fake.records.values()].map((r) => r.name), ['acme-new.slatebox.team'])
  await rejectsWith(w.service.claim({ user: user('sam'), name: 'acme', clientKey: 'k' }), 'unavailable')
  // A failed rename puts everything back.
  w.fake.fail('POST', /dns_records$/, { status: 400 })
  await rejectsWith(w.service.rename({ user: user('ada'), id: body.claim.id, name: 'acme-third' }), 'upstream_unavailable')
  const doc = await w.store.claims.get(body.claim.id)
  assert.equal(doc.name, 'acme-new')
  assert.deepEqual(w.fake.liveTunnels()[0].config, ingressFor(['acme-new.slatebox.team']))
})

test('release removes the record and the tunnel, revokes the credential, and holds the name for its owner for 30 days', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  const claim = await w.service.authenticateInstall(body.installCredential)
  const released = await w.service.releaseSelf({ claim })
  assert.deepEqual(released, { status: 200, body: { id: claim._id, status: 'released' } })
  assert.equal(w.fake.liveTunnels().length, 0)
  assert.equal(w.fake.records.size, 0)
  assert.equal(await w.service.authenticateInstall(body.installCredential), null)
  await rejectsWith(w.service.claim({ user: user('sam'), name: 'acme', clientKey: 'k' }), 'unavailable')
  const again = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k2' })
  assert.equal(again.status, 201, 'the owner may claim it back within 30 days')
  await w.service.releaseByOwner({ user: user('ada'), id: again.body.claim.id })
  w.tick(31 * DAY)
  assert.equal((await w.service.claim({ user: user('sam'), name: 'acme', clientKey: 'k' })).status, 201)
})

test('a release Cloudflare cannot finish stays "releasing" and the reconciler completes it', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  w.fake.fail('DELETE', /dns_records/, { status: 503, times: 4 })
  const answer = await w.service.releaseByOwner({ user: user('ada'), id: body.claim.id })
  assert.equal(answer.status, 202)
  assert.equal((await w.store.claims.get(body.claim.id)).status, 'releasing')
  await createReconciler({ store: w.store, cf: w.cf, service: w.service, now: w.now }).run()
  assert.equal((await w.store.claims.get(body.claim.id)).status, 'released')
  assert.equal(w.fake.records.size, 0)
})

// ---- takedown -------------------------------------------------------------------------------------------

test('a takedown answers 451 at the edge, refuses tokens with the notice, keeps the name, and unsuspend restores it', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  await w.service.suspend({ admin: 'root', id: body.claim.id, reason: 'phishing report #12', notice: 'Suspended for phishing.' })
  const tunnel = w.fake.liveTunnels()[0]
  assert.deepEqual(tunnel.config, SUSPENDED_INGRESS)
  assert.equal(w.fake.records.size, 1, 'the record stays, so the name cannot be claimed again')
  const claim = await w.service.authenticateInstall(body.installCredential)
  await rejectsWith(w.service.connectorToken({ claim }), 'suspended')
  await rejectsWith(w.service.connectorToken({ claim, rotate: true }), 'suspended')
  assert.equal(w.service.self({ claim }).claim.suspension.notice, 'Suspended for phishing.')
  await rejectsWith(w.service.claim({ user: user('sam'), name: 'acme', clientKey: 'k' }), 'unavailable')
  await w.service.unsuspend({ admin: 'root', id: body.claim.id })
  assert.deepEqual(w.fake.liveTunnels()[0].config, ingressFor(['acme.slatebox.team']))
  // Force release holds the name from everyone, the owner too, for a year.
  await w.service.forceRelease({ admin: 'root', id: body.claim.id })
  await rejectsWith(w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k3' }), 'unavailable')
  assert.equal((await w.service.adminWhy('acme')).reason, 'taken_down')
  const actions = w.store.audit.docs.map((entry) => entry.action)
  for (const action of ['claim', 'activate', 'suspend', 'unsuspend', 'release']) assert.ok(actions.includes(action), action)
})

test('a suspended address released by its owner or its install stays held from everyone, the owner too', async () => {
  for (const how of ['owner', 'install']) {
    const w = world()
    const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
    await w.service.suspend({ admin: 'root', id: body.claim.id, reason: 'phishing', notice: 'Suspended.' })
    if (how === 'owner') await w.service.releaseByOwner({ user: user('ada'), id: body.claim.id })
    else await w.service.releaseSelf({ claim: await w.service.authenticateInstall(body.installCredential) })
    assert.equal((await w.store.claims.get(body.claim.id)).status, 'released', how)
    // The owner cannot take the name straight back on a fresh tunnel, and neither can anyone else.
    await rejectsWith(w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k2' }), 'unavailable')
    await rejectsWith(w.service.claim({ user: user('sam'), name: 'acme', clientKey: 'k' }), 'unavailable')
    assert.equal((await w.service.adminWhy('acme')).reason, 'taken_down', how)
    w.tick(31 * DAY)
    await rejectsWith(w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k3' }), 'unavailable')
  }
})

test('a suspended release Cloudflare cannot finish keeps the takedown hold when the reconciler completes it', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  await w.service.suspend({ admin: 'root', id: body.claim.id, reason: 'phishing', notice: 'Suspended.' })
  w.fake.fail('DELETE', /dns_records/, { status: 503, times: 4 })
  assert.equal((await w.service.releaseByOwner({ user: user('ada'), id: body.claim.id })).status, 202)
  await createReconciler({ store: w.store, cf: w.cf, service: w.service, now: w.now }).run()
  assert.equal((await w.store.claims.get(body.claim.id)).status, 'released')
  await rejectsWith(w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k2' }), 'unavailable')
})

test('renaming back to a name still in its grace period keeps that name\'s DNS record when the rename finishes', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  await w.service.rename({ user: user('ada'), id: body.claim.id, name: 'acme-new' })
  const back = await w.service.rename({ user: user('ada'), id: body.claim.id, name: 'acme' })
  assert.equal(back.claim.host, 'acme.slatebox.team')
  const doc = await w.store.claims.get(body.claim.id)
  assert.deepEqual(doc.previousNames.map((entry) => entry.name), ['acme-new'])
  assert.deepEqual(w.fake.liveTunnels()[0].config.ingress.map((rule) => rule.hostname || rule.service), ['acme.slatebox.team', 'acme-new.slatebox.team', 'http_status:404'])
  await w.service.renameComplete({ claim: await w.service.authenticateInstall(body.installCredential) })
  assert.deepEqual([...w.fake.records.values()].map((r) => r.name), ['acme.slatebox.team'])
  assert.equal((await w.store.claims.get(body.claim.id)).cf.dnsRecordId, [...w.fake.records.values()][0].id)
  assert.deepEqual(w.fake.liveTunnels()[0].config, ingressFor(['acme.slatebox.team']))
})

test('a replayed claim hands out the connector token under the same hourly limit', async () => {
  const w = world()
  const first = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k', idempotencyKey: 'i' })
  assert.equal(first.status, 201)
  for (let i = 1; i < LIMITS.tokenFetchesPerHour + 1; i += 1) assert.equal((await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k', idempotencyKey: 'i' })).status, 200)
  await rejectsWith(w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k', idempotencyKey: 'i' }), 'rate_limited')
})

test('claim attempts count against the daily check limit, so claiming cannot probe names without limit', async () => {
  const w = world({ limits: { checksPerDayPerAccount: 3 } })
  for (const name of ['admin', 'paypal-x', 'support']) await rejectsWith(w.service.claim({ user: user('ada'), name, clientKey: 'k' }), 'unavailable')
  await rejectsWith(w.service.claim({ user: user('ada'), name: 'www', clientKey: 'k' }), 'rate_limited')
  await rejectsWith(w.service.availability({ name: 'acme', user: user('ada'), ip: '198.51.100.9' }), 'rate_limited')
  // Another account is not affected.
  assert.equal((await w.service.claim({ user: user('sam'), name: 'acme', clientKey: 'k' })).status, 201)
})

test('a claim suspended before Cloudflare set it up can be unsuspended back to pending, and a replay finishes it', async () => {
  const w = world()
  w.fake.fail('POST', /cfd_tunnel$/, { status: 503, times: 4 })
  await rejectsWith(w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k', idempotencyKey: 'i' }), 'upstream_unavailable')
  const [pending] = [...w.store.claims.docs.values()]
  assert.equal(pending.status, 'pending')
  await w.service.suspend({ admin: 'root', id: pending._id, reason: 'check', notice: 'Held.' })
  assert.deepEqual(await w.service.unsuspend({ admin: 'root', id: pending._id }), { id: pending._id, status: 'pending' })
  const resumed = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k', idempotencyKey: 'i' })
  assert.equal(resumed.status, 201)
  assert.equal(resumed.body.claim.status, 'active')
  assert.ok(resumed.body.installCredential)
})

test('the MongoDB store removes a blocklist entry by the id it returned', async () => {
  // A collection that compares _id strictly, like MongoDB (an ObjectId never equals its string).
  const rows = []
  let n = 0
  const blocklist = {
    insertOne: async (doc) => {
      const row = { _id: doc._id ?? { oid: (n += 1) }, ...doc }
      rows.push(row)
      return { insertedId: row._id }
    },
    deleteOne: async ({ _id }) => {
      const at = rows.findIndex((row) => row._id === _id)
      if (at >= 0) rows.splice(at, 1)
      return { deletedCount: at >= 0 ? 1 : 0 }
    },
    find: () => ({ toArray: async () => rows }),
  }
  const store = mongoStore({ claims: {}, tombstones: {}, audit: {}, blocklist, flags: {}, counters: {} })
  const id = await store.blocklist.add({ pattern: 'evil', kind: 'exact' })
  assert.equal(typeof id, 'string')
  assert.equal(await store.blocklist.remove(id), true)
  assert.equal(rows.length, 0)
})

// ---- audit ------------------------------------------------------------------------------------------------

test('the audit never holds a token, a credential, an address or a Cloudflare body', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k', ip: '198.51.100.23', ua: 'slatebox/0.2.0' })
  const claim = await w.service.authenticateInstall(body.installCredential)
  const rotated = await w.service.connectorToken({ claim, rotate: true, ip: '198.51.100.23' })
  w.fake.fail('GET', /\/token$/, { status: 400, message: 'secret-looking body' })
  await rejectsWith(w.service.connectorToken({ claim }), 'upstream_unavailable')
  const text = JSON.stringify(w.store.audit.docs)
  for (const secret of [body.connectorToken, rotated.connectorToken, body.installCredential, FAKE.token, '198.51.100.23']) assert.ok(!text.includes(secret))
  const failed = w.store.audit.docs.find((entry) => entry.action === 'cf_error')
  assert.deepEqual(Object.keys(failed.error.cloudflare), ['status', 'errors'])
  assert.ok(w.store.audit.docs.every((entry) => entry.ipHash === null || /^[0-9a-f]{32}$/.test(entry.ipHash)))
  assert.ok(!JSON.stringify(w.logs).includes(body.connectorToken))
})

// ---- the reconciler ----------------------------------------------------------------------------------------

test('the reconciler deletes orphans, repairs drift, records status and reaps names that never connected', async () => {
  const w = world()
  const kept = await w.service.claim({ user: user('ada'), name: 'kept-co', clientKey: 'k' })
  const idle = await w.service.claim({ user: user('sam'), name: 'idle-co', clientKey: 'k' })
  const keptTunnel = w.fake.liveTunnels().find((t) => t.name === `sbx-${kept.body.claim.id}`)
  w.fake.connect(keptTunnel.id, 'install-1')
  // Orphans: a tunnel and a record with no live claim.
  const orphan = await w.cf.createTunnel('sbx-ta_00000000000000000000')
  await w.cf.createCname({ name: 'ghost.slatebox.team', content: `${orphan.id}.cfargotunnel.com`, comment: 'slatebox-team-claim:ta_00000000000000000000' })
  // Drift: someone edited the kept claim's ingress and removed its record.
  keptTunnel.config = { ingress: [{ hostname: 'kept-co.slatebox.team', service: 'http://10.0.0.5:22' }, { service: 'http_status:404' }] }
  for (const [id, record] of w.fake.records) if (record.name === 'kept-co.slatebox.team') w.fake.records.delete(id)
  w.tick(REAP.orphanAgeMs + 1000)
  const reconciler = createReconciler({ store: w.store, cf: w.cf, service: w.service, now: w.now })
  const report = await reconciler.run()
  assert.equal(w.fake.tunnels.get(orphan.id).deleted_at !== null, true, 'orphan tunnel deleted')
  assert.ok(![...w.fake.records.values()].some((r) => r.name === 'ghost.slatebox.team'), 'orphan record deleted')
  assert.deepEqual(keptTunnel.config, ingressFor(['kept-co.slatebox.team']), 'ingress reset')
  assert.ok([...w.fake.records.values()].some((r) => r.name === 'kept-co.slatebox.team'), 'record recreated')
  assert.equal((await w.store.claims.get(kept.body.claim.id)).lastSeen.connections, 1)
  assert.deepEqual(report.zone, [])
  // 24 hours with no connection ever: released. The connected one stays.
  w.tick(REAP.neverConnectedMs)
  w.fake.connect(keptTunnel.id, 'install-1')
  const later = await reconciler.run()
  assert.ok(later.reaped.includes(idle.body.claim.id))
  assert.equal((await w.store.claims.get(idle.body.claim.id)).status, 'released')
  assert.equal((await w.store.claims.get(kept.body.claim.id)).status, 'active')
  assert.ok(w.store.audit.docs.some((entry) => entry.action === 'reap'))
})

test('the reconciler tells the owner when two connector clients serve one address, and flags zone drift', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  const tunnel = w.fake.liveTunnels()[0]
  w.fake.connect(tunnel.id, 'install-1')
  w.fake.connect(tunnel.id, 'stranger-2')
  w.fake.settings.websockets = 'off'
  const report = await createReconciler({ store: w.store, cf: w.cf, service: w.service, now: w.now, notify: (message) => w.notices.push(message) }).run()
  assert.ok(w.notices.some((notice) => notice.userId === 'ada' && /More than one computer/.test(notice.subject)))
  assert.deepEqual(report.zone, ['websockets=off'])
  assert.ok((await w.store.claims.get(body.claim.id)).multiAlertAt)
})

test('idle 60 days: the owner is told; idle 90 days: released', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  const tunnel = w.fake.liveTunnels()[0]
  w.fake.connect(tunnel.id)
  const reconciler = createReconciler({ store: w.store, cf: w.cf, service: w.service, now: w.now, notify: (message) => w.notices.push(message) })
  await reconciler.run()
  tunnel.connections = []
  w.tick(61 * DAY)
  const noticed = await reconciler.run()
  assert.deepEqual(noticed.noticed, [body.claim.id])
  assert.ok(w.notices.some((notice) => notice.userId === 'ada' && /idle/.test(notice.subject)))
  w.tick(30 * DAY)
  const reaped = await reconciler.run()
  assert.deepEqual(reaped.reaped, [body.claim.id])
})

// ---- HTTP routes --------------------------------------------------------------------------------------------

async function serve(w, { gate = () => true, closed = undefined, tokens = { 'sbo_ada': 'ada', 'sbo_sam': 'sam' } } = {}) {
  const app = express()
  const routes = teamAddressRoutes({
    gate,
    ...(closed && { closed }),
    service: () => w.service,
    authenticateUser: async (req) => {
      const id = tokens[`${req.headers.authorization}`.replace(/^Bearer /, '')]
      return id ? { _id: id } : null
    },
  })
  for (const { method, path, handler } of routes) app[method.toLowerCase()](path, handler)
  app.use('/api/v1', (_req, res) => res.status(404).json({ error: { code: 'unknown_route', message: 'There is no such API route. See /api/v1/openapi.json.' } }))
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(origin + path, {
      method,
      headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    })
    return { status: res.status, body: await res.json(), headers: res.headers }
  }
  return { call, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('off Slatebox Cloud every route answers the same 404 as an unknown API route', async () => {
  const w = world()
  const http = await serve(w, { gate: () => false })
  try {
    const unknown = await http.call('GET', '/api/v1/not-a-route')
    for (const [method, path] of [['GET', `${BASE}/availability?name=acme`], ['POST', BASE], ['GET', BASE], ['GET', `${BASE}/self`], ['POST', `${BASE}/self/connector-token`], ['DELETE', `${BASE}/self`], ['DELETE', `${BASE}/ta_aaaaaaaaaaaaaaaaaaaa`]]) {
      const answer = await http.call(method, path, { token: 'sbo_ada', body: method === 'POST' ? { name: 'acme' } : undefined })
      assert.equal(answer.status, 404, `${method} ${path}`)
      assert.deepEqual(answer.body, unknown.body)
    }
    assert.equal(w.store.claims.docs.size, 0)
  } finally {
    await http.close()
  }
})

test('on Slatebox Cloud with the settings missing or paused, every route is closed with a plain 503 and nothing reaches Cloudflare', async () => {
  const w = world()
  const calls = []
  const service = w.service
  w.service = new Proxy(service, { get(target, key) { calls.push(key); return target[key] } })
  const before = w.fake.calls.length
  const http = await serve(w, { gate: () => true, closed: () => true })
  try {
    for (const [method, path] of [['GET', `${BASE}/availability?name=acme`], ['POST', BASE], ['GET', BASE], ['GET', `${BASE}/self`], ['POST', `${BASE}/self/connector-token`], ['POST', `${BASE}/self/rename-complete`], ['DELETE', `${BASE}/self`], ['POST', `${BASE}/ta_aaaaaaaaaaaaaaaaaaaa/rename`], ['DELETE', `${BASE}/ta_aaaaaaaaaaaaaaaaaaaa`], ['POST', `${BASE}/ta_aaaaaaaaaaaaaaaaaaaa/install-credential`]]) {
      const answer = await http.call(method, path, { token: 'sbo_ada', body: method === 'POST' ? { name: 'acme' } : undefined })
      assert.equal(answer.status, 503, `${method} ${path}`)
      assert.equal(answer.body.error.code, 'paused', 'the CLI already explains paused in plain words')
      assert.match(answer.body.error.message, /not open on Slatebox Cloud right now\. Nothing was changed\./)
      assert.equal(answer.headers.get('retry-after'), '3600')
      assert.equal(answer.headers.get('cache-control'), 'no-store')
    }
    assert.deepEqual(calls, [], 'the claim service is never reached while closed')
    assert.equal(w.fake.calls.length, before, 'nothing calls Cloudflare')
    assert.equal(w.store.claims.docs.size, 0)
  } finally {
    await http.close()
  }
})

test('the routes: sign-in for user routes, the install credential for its own claim, no-store everywhere', async () => {
  const w = world()
  const http = await serve(w)
  try {
    assert.equal((await http.call('POST', BASE, { body: { name: 'acme' } })).status, 401)
    assert.equal((await http.call('POST', BASE, { token: 'sbo_nobody', body: { name: 'acme' } })).status, 401)
    const made = await http.call('POST', BASE, { token: 'sbo_ada', body: { name: 'acme', clientKey: 'k', label: 'tims-mbp' }, headers: { 'Idempotency-Key': 'i-1' } })
    assert.equal(made.status, 201)
    assert.equal(made.headers.get('cache-control'), 'no-store')
    const { installCredential, connectorToken, claim } = made.body
    assert.ok(installCredential && connectorToken)
    const replay = await http.call('POST', BASE, { token: 'sbo_ada', body: { name: 'acme', clientKey: 'k' }, headers: { 'Idempotency-Key': 'i-1' } })
    assert.equal(replay.status, 200)
    assert.equal(replay.body.installCredential, null)
    assert.deepEqual((await http.call('GET', BASE, { token: 'sbo_ada' })).body.claims.map((c) => c.host), ['acme.slatebox.team'])
    assert.deepEqual((await http.call('GET', BASE, { token: 'sbo_sam' })).body.claims, [])
    // Install routes take the credential, never a user token.
    assert.equal((await http.call('GET', `${BASE}/self`, { token: 'sbo_ada' })).status, 401)
    const self = await http.call('GET', `${BASE}/self`, { token: installCredential })
    assert.equal(self.body.claim.id, claim.id)
    const token = await http.call('POST', `${BASE}/self/connector-token`, { token: installCredential, body: {} })
    assert.equal(token.status, 200)
    assert.equal(token.headers.get('cache-control'), 'no-store')
    assert.ok(token.body.connectorToken)
    // Another account cannot rename, release or re-mint it.
    assert.equal((await http.call('POST', `${BASE}/${claim.id}/rename`, { token: 'sbo_sam', body: { name: 'mine-now' } })).status, 404)
    assert.equal((await http.call('DELETE', `${BASE}/${claim.id}`, { token: 'sbo_sam' })).status, 404)
    assert.equal((await http.call('POST', `${BASE}/${claim.id}/install-credential`, { token: 'sbo_sam' })).status, 404)
    // Bad bodies and names answer in the /api/v1 error shape.
    assert.equal((await http.call('POST', BASE, { token: 'sbo_ada', body: '{not json' })).body.error.code, 'invalid_json')
    const invalid = await http.call('GET', `${BASE}/availability?name=Acme_1`)
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.error.code, 'invalid_name')
    assert.deepEqual((await http.call('GET', `${BASE}/availability?name=acme`)).body, { name: 'acme', available: false })
    const taken = await http.call('POST', BASE, { token: 'sbo_sam', body: { name: 'acme', clientKey: 'k' } })
    assert.equal(taken.status, 409)
    assert.equal(taken.body.error.code, 'unavailable')
    // Uninstall: the install releases its own claim.
    assert.equal((await http.call('DELETE', `${BASE}/self`, { token: installCredential })).body.status, 'released')
    assert.equal((await http.call('GET', `${BASE}/self`, { token: installCredential })).status, 401)
  } finally {
    await http.close()
  }
})

// ---- registration and the admin methods --------------------------------------------------------------------

test('registered everywhere enterprise runs, started only on Cloud; on-prem answers 404 and starts nothing', async () => {
  for (const via of ['license', 'cloud']) {
    const host = createEnterpriseHost()
    let loaded = 0
    registerTeamAddresses(host.api, { via, isUnlocked: () => true }, { load: async () => (loaded += 1, { startTeamAddresses: async () => ({ gate: () => true }) }), log: () => {} })
    assert.ok(host.routes.some((route) => route.path === BASE))
    assert.equal(host.actions.length, 0, 'never actions: never MCP tools or exec calls')
    assert.equal(host.startups.length, via === 'cloud' ? 1 : 0)
    const route = host.routes.find((entry) => entry.method === 'GET' && entry.path === `${BASE}/availability`)
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, end(body) { this.body = JSON.parse(body) } }
    await route.handler({ method: 'GET', headers: {}, query: { name: 'acme' } }, res)
    assert.equal(res.statusCode, 404, via)
    for (const fn of host.startups) await fn()
    assert.equal(loaded, via === 'cloud' ? 1 : 0)
  }
  // Cloud, started, but the settings are missing or paused: closed with a plain 503; on-prem stays 404.
  for (const via of ['license', 'cloud']) {
    const host = createEnterpriseHost()
    registerTeamAddresses(host.api, { via, isUnlocked: () => true }, { load: async () => ({ startTeamAddresses: async () => ({ gate: () => false, closed: () => true }) }), log: () => {} })
    for (const fn of host.startups) await fn()
    const route = host.routes.find((entry) => entry.method === 'POST' && entry.path === BASE)
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, end(body) { this.body = JSON.parse(body) } }
    await route.handler({ method: 'POST', headers: {}, query: {} }, res)
    assert.equal(res.statusCode, via === 'cloud' ? 503 : 404, via)
    assert.equal(res.body.error.code, via === 'cloud' ? 'paused' : 'unknown_route')
  }
})

test('admin methods: administrators only, Cloud only, and each change is audited', async () => {
  const w = world()
  const { body } = await w.service.claim({ user: user('ada'), name: 'acme', clientKey: 'k' })
  let gate = true
  const methods = adminMethods(() => ({ gate: () => gate, isAdmin: async (id) => id === 'root', service: w.service, describeOwner: async (id) => `${id}@example.com` }))
  await assert.rejects(methods[ADMIN_METHODS.list].call({ userId: 'ada' }, {}), (error) => error.error === 'denied' && error.isClientSafe === true)
  await assert.rejects(methods[ADMIN_METHODS.list].call({ userId: null }, {}), (error) => error.error === 'denied')
  const list = await methods[ADMIN_METHODS.list].call({ userId: 'root' }, { q: 'acme' })
  assert.equal(list.claims[0].owner, 'ada@example.com')
  await methods[ADMIN_METHODS.suspend].call({ userId: 'root' }, { id: body.claim.id, reason: 'report', notice: 'Suspended.' })
  assert.equal((await w.store.claims.get(body.claim.id)).status, 'suspended')
  await assert.rejects(methods[ADMIN_METHODS.suspend].call({ userId: 'root' }, { id: body.claim.id }), (error) => error.error === 'not_found')
  await methods[ADMIN_METHODS.blockAdd].call({ userId: 'root' }, { pattern: 'evilcorp', kind: 'substring', reason: 'impersonation' })
  await rejectsWith(w.service.claim({ user: user('sam'), name: 'the-evilcorp-team', clientKey: 'k' }), 'unavailable')
  assert.equal((await methods[ADMIN_METHODS.why].call({ userId: 'root' }, { name: 'the-evilcorp-team' })).reason, 'blocked')
  const audit = await methods[ADMIN_METHODS.audit].call({ userId: 'root' }, { claimId: body.claim.id })
  assert.ok(audit.some((entry) => entry.action === 'suspend' && entry.actor.kind === 'admin' && entry.actor.id === 'root'))
  gate = false
  await assert.rejects(methods[ADMIN_METHODS.list].call({ userId: 'root' }, {}), (error) => error.error === 'not_found')
})

test('the Cloudflare settings are server-only and off in the example settings', async () => {
  const { readFileSync } = await import('node:fs')
  const { teamClaimsConfigured } = await import('../web/app/server/oauth/device.mjs')
  const example = JSON.parse(readFileSync(new URL('../web/app/settings.example.json', import.meta.url), 'utf8'))
  assert.equal(example.public.cloudflare, undefined, 'never under public: Meteor sends public to every browser')
  assert.equal(example.cloudflare.teamClaims.token, '')
  assert.equal(example.cloudflare.teamClaims.paused, true)
  assert.equal(teamClaimsConfigured(example), false)
})

test('the Meteor side: settings paused or missing closes the service, and the Cloudflare client and the reconciler check it first', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../enterprise/team-addresses/meteor.js', import.meta.url), 'utf8')
  assert.match(source, /const open = \(\) => gate\(\) && claimsSettings\(\)\.paused !== true/)
  assert.match(source, /const closed = \(\) => isUnlocked\(\) && cloudOn\(\) && !open\(\)/)
  // The lazy Cloudflare client refuses before it is made; the reconciler skips its pass.
  assert.match(source, /get\(_target, key\) \{\s*if \(!open\(\)\) throw new TeamAddressError\('paused'/)
  assert.match(source, /if \(running \|\| !open\(\)\) return/)
  assert.match(source, /return \{ gate, closed, /)
})
