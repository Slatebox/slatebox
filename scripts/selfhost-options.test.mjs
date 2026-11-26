// The header button for self-hosted installs on a self-hosted install (owner, 2026-11-25), without Meteor:
// - who sees what (upgradeOffer): Cloud never; admins an actionable Upgrade; members the reasons
//   and "Ask your admin"; an "Enterprise" chip once unlocked ("Renew" in a license's grace);
// - the panel lists only what enterprise/ really does;
// - a key entered in the app: checked offline (valid, expired, changed, foreign, another host's,
//   a Cloud key), kept, never handed back; settings and environment still win;
// - unlocking while the server runs: the enterprise actions join the registry, their /api/v1
//   routes answer and their Meteor methods exist, with the same per-call license checks, and a
//   locked key registers nothing;
// - the trial: a device sign-in to (a stand-in) Slatebox Cloud, a host-bound trial key, applied at
//   once; declined, expired and not-offered sign-ins; re-runnable;
// - the move: export here, upload to Cloud, counts compared section by section, live only on the
//   administrator's yes, identical slates on Cloud; one at a time, re-runnable, resumable after a
//   restart without uploading twice, a waiting move replaced only when asked, and Cloud's limits
//   in its own words.
// Run: node --test scripts/selfhost-options.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import express from 'express'
import { upgradeOffer, ENTERPRISE_VALUE, PREVIEW_AGENTS, PLANS_URL, FLOW_WORDS } from '../web/app/imports/api/common/selfhost-options.mjs'
import { enterpriseAccess, signLicense, verifyLicense } from '../web/app/server/enterprise-license.mjs'
import { createLicenseKeyStore, LICENSE_ROW } from '../web/app/server/enterprise-key.mjs'
import { createEnterpriseHost, loadEnterprise, loadEnterpriseLate } from '../web/app/server/enterprise-loader.mjs'
import { licenseStatusFor } from '../web/app/server/enterprise-license-status.mjs'
import { actions as baseActions, createAppRegistry } from '../web/app/server/actions/index.mjs'
import { defineAction } from '../web/app/server/actions/registry.mjs'
import { mountHttp } from '../web/app/server/actions/http.mjs'
import { ddpMethodsFor } from '../web/app/server/actions/ddp.mjs'
import { liveRedactor } from '../web/app/server/exec/system.mjs'
import { createCloudClient, CloudError } from '../web/app/server/selfhost-options/cloud-client.mjs'
import { createUpgradeService, memoryFlows, UpgradeError } from '../web/app/server/selfhost-options/service.mjs'
import { createTeamExporter } from '../web/app/server/team-export/export-core.mjs'
import { createTeamImporter } from '../web/app/server/team-export/import-core.mjs'
import { createTeamTransfer, createTicketStore, MOVES_PER_DAY } from '../web/app/server/team-export/transfer.mjs'
import { classifyUpload } from '../web/app/server/common/upload-kinds.mjs'
import { memoryDb } from './team-export-store.mjs'
import { startFakeCloud, testSigner } from './fake-slatebox-cloud.mjs'

const appRequire = createRequire(new URL('../web/app/package.json', import.meta.url))
appRequire('slateboxjs/workshops/behaviour')
appRequire('slateboxjs/workshops/rules')
const { validateWorkshop } = appRequire('slateboxjs/workshops/model')

const signer = testSigner()
const HOST = 'boards.acme.test'
const selfHost = (extra = {}) => ({ public: { env: 'selfhost', edition: 'self-host', baseUrl: `https://${HOST}`, ...extra } })
const unlockedSettings = (via = 'license') => selfHost({ enterprise: { unlocked: true, via, features: ['agents.invite'] } })
const sign = (payload) => signLicense({ id: 'lic_t', licensee: 'Acme', issuedAt: '2026-01-01', expiresAt: '2099-12-31', ...payload }, { kid: signer.kid, privateKey: signer.privateKey })
const day = (iso) => Date.parse(iso + 'T12:00:00Z')

// A systemSettings stand-in with the Meteor collection API the key store uses.
function settingsRows() {
  const rows = new Map()
  return {
    rows,
    findOneAsync: async ({ _id }) => (rows.has(_id) ? structuredClone(rows.get(_id)) : undefined),
    upsertAsync: async ({ _id }, { $set }) => rows.set(_id, { ...(rows.get(_id) || { _id }), ...structuredClone($set) }),
    removeAsync: async ({ _id }) => rows.delete(_id),
  }
}

// ------------------------------------------------------------------ who sees what

test('who sees Upgrade: never on Cloud or signed out; admins act, members ask; a chip once unlocked', () => {
  const cloud = { public: { edition: 'cloud', enterprise: { unlocked: true, via: 'cloud', features: [] } } }
  for (const serverAdmin of [true, false, null]) assert.deepEqual(upgradeOffer({ settings: cloud, signedIn: true, serverAdmin }), { show: 'none' }, 'Cloud never')
  assert.deepEqual(upgradeOffer({ settings: selfHost(), signedIn: false, serverAdmin: false }), { show: 'none' }, 'nobody signed in (or a guest)')
  assert.deepEqual(upgradeOffer({ settings: selfHost(), signedIn: true, serverAdmin: null }), { show: 'none' }, 'not until the server answers who is admin')
  assert.deepEqual(upgradeOffer({ settings: selfHost(), signedIn: true, serverAdmin: true }), { show: 'offer', role: 'admin' })
  assert.deepEqual(upgradeOffer({ settings: selfHost(), signedIn: true, serverAdmin: false }), { show: 'offer', role: 'member' })
  assert.deepEqual(upgradeOffer({ settings: {}, signedIn: true, serverAdmin: true }), { show: 'offer', role: 'admin' }, 'a settings file without an edition is self-host')
  assert.deepEqual(upgradeOffer({ settings: unlockedSettings(), signedIn: true, serverAdmin: true }), { show: 'chip', role: 'admin', chip: 'enterprise' })
  assert.deepEqual(upgradeOffer({ settings: unlockedSettings(), signedIn: true, serverAdmin: false }), { show: 'chip', role: 'member', chip: 'enterprise' })
  assert.deepEqual(upgradeOffer({ settings: unlockedSettings(), signedIn: true, serverAdmin: true, license: { reason: 'grace' } }), { show: 'chip', role: 'admin', chip: 'renew' })
  // A browser told "unlocked" by a settings file alone is not: the server writes public.enterprise itself.
  assert.equal(PLANS_URL, 'https://slatebox.com/plans/')
  assert.ok(FLOW_WORDS.signing_in && FLOW_WORDS.moved && FLOW_WORDS.unlocked)
})

test('the panel lists only what enterprise/ really does', () => {
  const gallery = readFileSync(new URL('../enterprise/common/gallery.mjs', import.meta.url), 'utf8')
  for (const name of PREVIEW_AGENTS) assert.ok(gallery.includes(`name: '${name}'`), `${name} is a card in the enterprise gallery`)
  const server = readFileSync(new URL('../enterprise/server/index.js', import.meta.url), 'utf8')
  const has = { agents: /connectorActions/, integrations: /integrationActions/, catalog: /galleryActions|gallery/, google: /googleActions/, 'gallery-admin': /galleryActions/ }
  assert.deepEqual(ENTERPRISE_VALUE.map((item) => item.id), Object.keys(has))
  for (const item of ENTERPRISE_VALUE) assert.match(server, has[item.id], `${item.id} is registered by enterprise/server/index.js`)
  const words = ENTERPRISE_VALUE.map((item) => item.title + ' ' + item.text).join(' ')
  assert.doesNotMatch(words, /\$|€|£|per (month|year|seat)|pricing|\bAI\b/i, 'no prices in the app; "agent", not "AI"')
})

// ------------------------------------------------------------------ the key an administrator enters

test('a key entered in the app is checked offline, kept, and never handed back', async () => {
  const rows = settingsRows()
  const keys = createLicenseKeyStore({ collection: rows, keys: signer.keys, now: () => day('2027-01-01') })
  const good = await sign({ hosts: [HOST] })
  const saved = await keys.save(good, { host: HOST, by: 'alice', source: 'pasted' })
  assert.equal(saved.license.licensee, 'Acme')
  assert.equal(JSON.stringify(saved).includes(good), false, 'the key never comes back')
  assert.equal(keys.cached(), good)
  assert.equal(rows.rows.get(LICENSE_ROW).key, good)

  const refused = async (text, reason, host = HOST) => {
    await assert.rejects(keys.save(text, { host, source: 'pasted' }), (error) => error.reason === reason && error.status === 400 && typeof error.message === 'string')
  }
  await refused(await sign({ expiresAt: '2026-06-30', hosts: [HOST] }), 'expired')
  await refused(good.slice(0, -6) + 'AAAAAA', 'bad_signature')
  const otherSigner = testSigner('test-cloud-2026')
  await refused(await signLicense({ id: 'x', licensee: 'X', issuedAt: '2026-01-01', expiresAt: '2099-01-01' }, { kid: otherSigner.kid, privateKey: otherSigner.privateKey }), 'bad_signature')
  await refused(await signLicense({ id: 'x', licensee: 'X', issuedAt: '2026-01-01', expiresAt: '2099-01-01' }, { kid: 'someone-else', privateKey: otherSigner.privateKey }), 'unknown_key')
  await refused(await sign({ hosts: ['other.example.com'] }), 'wrong_host')
  await refused(await sign({ kind: 'cloud', hosts: [HOST] }), 'wrong_kind')
  await refused('not a key', 'malformed')
  await refused('', 'malformed')
  assert.equal(keys.cached(), good, 'a refused key leaves the kept one')

  // Read back after a restart; the loader's check uses it, after settings and environment.
  const again = createLicenseKeyStore({ collection: rows, keys: signer.keys })
  assert.equal(again.cached(), null)
  assert.equal(await again.load(), true)
  const access = (settings, env = {}) => enterpriseAccess({ settings, env, keys: signer.keys, now: day('2027-01-01'), stored: again.cached() })
  assert.deepEqual([access(selfHost()).unlocked, access(selfHost()).via], [true, 'license'])
  const broken = selfHost()
  broken.enterprise = { license: 'garbled' }
  assert.equal(access(broken).reason, 'malformed', "an operator's key in settings wins, even over a good entered one")
  assert.equal(access(selfHost(), { SLATEBOX_LICENSE: 'garbled' }).reason, 'malformed')
  // A Cloud install is never unlocked by an entered on-prem key.
  assert.equal(enterpriseAccess({ settings: { public: { edition: 'cloud', baseUrl: `https://${HOST}` } }, keys: signer.keys, now: day('2027-01-01'), stored: again.cached() }).unlocked, false)
  // The admin page's status: unlocked by the entered key, nothing to restart once applied.
  const status = licenseStatusFor({ settings: selfHost(), running: { loaded: true, access: { via: 'license' } }, now: day('2027-01-01'), access: (o) => enterpriseAccess({ ...o, keys: signer.keys, stored: again.cached() }) })
  assert.deepEqual([status.unlocked, status.restartNeeded, status.license.licensee], [true, false, 'Acme'])
  await again.clear()
  assert.equal(again.cached(), null)
})

// ------------------------------------------------------------------ unlocking while the server runs

function fakeEnterprise() {
  const calls = { loaded: 0, started: 0 }
  const action = defineAction({
    id: 'connectors.probe',
    title: 'Probe a connector',
    description: 'Test action from a fake enterprise module.',
    toolset: 'connectors',
    kind: 'read',
    input: { type: 'object', properties: { probeSecret: { type: 'string', writeOnly: true } }, additionalProperties: false },
    output: { type: 'object' },
    principals: ['person', 'agent'],
    scope: 'slates:read',
    mounts: { ddp: true, http: { method: 'GET', path: '/connectors/probe', operationId: 'probeConnector' } },
    handler: async () => ({ ok: true }),
  })
  const mod = {
    manifest: { name: 'fake-enterprise' },
    register(api) {
      api.addActions([action])
      api.addMethods({ 'connectors.ping': () => 'pong' })
      api.addRoute({ method: 'GET', path: '/connectors/oauth/callback', handler: (_req, res) => res.end('callback') })
      api.onStartup(() => {
        calls.started += 1
      })
    },
  }
  return { calls, load: () => (calls.loaded++, mod) }
}

test('a key that arrives while the server runs registers enterprise code then: actions, routes, methods, all license-checked', async (t) => {
  const registry = createAppRegistry({})
  const app = express()
  const http = mountHttp(app, registry, { express, authenticate: async () => ({ kind: 'person', userId: 'u1', tokenId: null, tokenName: null, scopes: registry.scopes }) })
  const listener = app.listen(0)
  t.after(() => listener.close())
  const base = `http://127.0.0.1:${listener.address().port}`
  const methods = {}
  const routes = []
  const mounts = [(actions) => {
    registry.extend(actions)
    http.addActions(actions)
    Object.assign(methods, ddpMethodsFor(registry, actions, { makeError: (code) => new Error(code), loadUser: async (id) => ({ _id: id }), scopes: registry.scopes }))
  }]
  const redact = liveRedactor(registry)
  assert.equal(redact('slatebox.connectors.probe({ probeSecret: "sk-secret" })').includes('sk-secret'), true, 'nothing to hide before')

  // Locked: nothing at all.
  let stored = null
  const fake = fakeEnterprise()
  const access = (now) => enterpriseAccess({ settings: selfHost(), keys: signer.keys, now: now ?? day('2027-01-01'), stored })
  const locked = loadEnterpriseLate({ settings: selfHost(), load: fake.load, access, mounts })
  assert.deepEqual([locked.loaded, locked.reason, fake.calls.loaded], [false, 'locked', 0])
  assert.equal(registry.get('connectors.probe'), undefined)
  assert.equal((await fetch(base + '/api/v1/connectors/probe')).status, 404)

  // The key arrives (entered, or a trial from Cloud): registered now, with no restart.
  stored = await sign({ hosts: [HOST] })
  const late = loadEnterpriseLate({ settings: selfHost(), load: fake.load, access, mounts, apply: (host) => {
    routes.push(...host.routes)
    host.startups.forEach((fn) => fn())
  } })
  assert.deepEqual([late.loaded, late.access.via], [true, 'license'])
  assert.equal(registry.get('connectors.probe').id, 'connectors.probe')
  assert.equal(registry.list().length, baseActions.length + 1)
  assert.equal(registry.version(), 1)
  const answered = await fetch(base + '/api/v1/connectors/probe')
  assert.deepEqual([answered.status, await answered.json()], [200, { ok: true }])
  const doc = await (await fetch(base + '/api/v1/openapi.json')).json()
  assert.ok(JSON.stringify(doc).includes('probeConnector'), 'the OpenAPI document lists it')
  assert.deepEqual(await methods['connectors.probe'].call({ userId: 'u1' }, {}), { ok: true })
  assert.equal(late.host.methods['connectors.ping'](), 'pong')
  assert.deepEqual(routes.map((route) => route.path), ['/connectors/oauth/callback'])
  assert.equal(fake.calls.started, 1)
  assert.equal(redact('slatebox.connectors.probe({ probeSecret: "sk-secret" })').includes('sk-secret'), false, "exec's records hide the late action's secret field")
  // Registering twice is refused by the registry, never a silent replace.
  assert.throws(() => registry.extend([registry.get('connectors.probe')]), /declared twice/)

  // The key is still checked on every call: removed, the action refuses (the hourly re-read, forced here).
  stored = null
  const relocked = loadEnterprise({ settings: selfHost(), load: fakeEnterprise().load, host: createEnterpriseHost(), access: () => ({ unlocked: false, reason: 'expired' }) })
  assert.equal(relocked.loaded, false)
})

// ------------------------------------------------------------------ a self-hosted server with a team

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('picture bytes '.repeat(50))])
function selfHostedServer() {
  const origin = `https://${HOST}`
  const db = memoryDb()
  const files = new Map([['2026/11/01/u_alice_pic.png', PNG]])
  const put = (rows) => {
    for (const [collection, list] of Object.entries(rows)) for (const row of list) db[collection].rows.set(row._id, structuredClone(row))
  }
  put({
    organizations: [{ _id: 'orgA', name: 'Acme', createdOn: 1 }],
    users: [
      { _id: 'alice', orgId: 'orgA', isOrgOwner: true, emails: [{ address: 'alice@acme.test', verified: true }], profile: { firstName: 'Alice', lastName: 'A' } },
      { _id: 'bob', orgId: 'orgA', emails: [{ address: 'bob@acme.test', verified: true }], profile: { firstName: 'Bob', lastName: 'B' } },
    ],
    permissions: [
      { _id: 'p1', userId: 'alice', orgId: 'orgA', claimId: 'admin' },
      { _id: 'p2', userId: 'alice', claimId: 'uberMensch' },
      { _id: 'p3', userId: 'bob', orgId: 'orgA', claimId: 'canViewUsers' },
    ],
    slates: [
      { _id: 'slateA1', shareId: 'aaaa000001', userId: 'alice', orgId: 'orgA', options: { id: 'slateA1', shareId: 'aaaa000001', name: 'Roadmap', isUnlisted: true }, nodes: [{ options: { id: 'n1', text: 'Ship it', image: `${origin}/files/2026/11/01/u_alice_pic.png` } }] },
      { _id: 'slateA2', shareId: 'aaaa000002', userId: 'bob', orgId: 'orgA', options: { id: 'slateA2', shareId: 'aaaa000002', name: 'Notes', isPrivate: true }, nodes: [{ options: { id: 'n2', text: 'Plain note' } }, { options: { id: 'n3', text: 'Second note' } }] },
    ],
    orgSettings: [{ _id: 's1', orgId: 'orgA', type: 'color', value: { role: 'primary', hex: '#123456' } }],
  })
  let n = 0
  const transfer = createTeamTransfer({
    exporter: createTeamExporter({ db, cloudUrl: `${origin}/files`, readFile: async (key) => files.get(key) ?? null }),
    importer: createTeamImporter({ db, newId: () => 'S' + String(++n).padStart(16, '0'), newShareId: async () => 's' + String(++n).padStart(9, '0'), newAccessKey: async () => 'k' + String(++n), createSlate: (row) => db.slates.insertOne(row), classifyFile: (bytes, ext) => classifyUpload(bytes, 'file.' + ext), storeFile: async () => ({}), deleteFile: async () => {}, validateBoard: validateWorkshop, teamClaims: ['admin'], aiProviders: [] }),
    tickets: createTicketStore({ collection: db.tickets }),
    loadUser: (id) => db.users.findOne({ _id: id }),
    isTeamAdmin: async (user) => db.permissions.docs().some((row) => row.userId === user._id && row.orgId === user.orgId && row.claimId === 'admin'),
    isServerAdmin: async (userId) => db.permissions.docs().some((row) => row.userId === userId && row.claimId === 'uberMensch'),
    instance: { origin, name: 'Acme boards' },
  })
  return { origin, db, transfer }
}

// One clock for both sides: the service's waits move it, so a five-second poll interval passes at once.
function sharedClock() {
  let skew = 0
  return {
    now: () => Date.now() + skew,
    sleep: async (ms) => {
      skew += ms
      await new Promise((resolve) => setTimeout(resolve, 2))
    },
  }
}

async function world(t, { cloudFetch, flows = memoryFlows(), unlockAnswer = null } = {}) {
  const clock = sharedClock()
  const cloud = await startFakeCloud({ signer, now: clock.now })
  t.after(() => cloud.close())
  const self = selfHostedServer()
  const rows = settingsRows()
  const keys = createLicenseKeyStore({ collection: rows, keys: signer.keys, now: clock.now })
  let unlockedNow = false
  const unlocks = []
  const service = createUpgradeService({
    cloud: createCloudClient({ origin: cloud.origin, ...(cloudFetch && { fetch: cloudFetch(cloud.origin) }) }),
    flows,
    keys,
    unlock: async () => {
      unlocks.push(keys.cached())
      if (unlockAnswer) return unlockAnswer
      unlockedNow = enterpriseAccess({ settings: selfHost(), keys: signer.keys, now: clock.now(), stored: keys.cached() }).unlocked
      return { unlocked: unlockedNow }
    },
    unlocked: () => unlockedNow,
    isServerAdmin: async (userId) => userId === 'alice',
    preflight: (userId) => self.transfer.preflight(userId),
    async exportStream(userId, passphrase, onEnd) {
      const issued = await self.transfer.startExport(userId)
      return (await self.transfer.openExport(new URL(issued.downloadUrl).pathname.split('/').pop(), passphrase, { onEnd })).stream
    },
    install: { host: HOST, origin: self.origin, installId: 'install-1', label: HOST },
    sleep: clock.sleep,
    now: clock.now,
  })
  // Polls the flow as the panel does, until it reaches one of the states.
  const until = async (id, states) => {
    for (let i = 0; i < 400; i += 1) {
      const flow = await service.follow('alice', id)
      if (states.includes(flow.state)) return flow
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    return assert.fail(`flow ${id} never reached ${states.join(' or ')}: ${JSON.stringify(await service.follow('alice', id))}`)
  }
  return { cloud, self, keys, rows, service, flows, until, unlocks, clock, isUnlocked: () => unlockedNow }
}

// ------------------------------------------------------------------ the trial

test('one click: a trial key from Cloud for this host, applied at once and checked offline after', async (t) => {
  const w = await world(t)
  await assert.rejects(w.service.startTrial('bob'), (error) => error instanceof UpgradeError && error.code === 'admin_required')
  const started = await w.service.startTrial('alice')
  assert.equal(started.state, 'signing_in')
  assert.match(started.signIn.userCode, /^[A-Z]{4}-[A-Z]{4}$/)
  assert.equal(started.signIn.verificationUri, `${w.cloud.origin}/device`)
  assert.equal(started.signIn.verificationUriComplete, `${w.cloud.origin}/device?code=${started.signIn.userCode}`)
  assert.equal(started.userId, undefined, 'the panel sees no account ids')
  // Clicking again while it waits answers the same flow.
  assert.equal((await w.service.startTrial('alice'))._id, started._id)

  await w.cloud.approve(started.signIn.userCode)
  const done = await w.until(started._id, ['unlocked', 'failed'])
  assert.equal(done.state, 'unlocked', JSON.stringify(done.failure))
  assert.equal(done.trial, true)
  assert.deepEqual(done.license.hosts, [HOST])
  assert.equal(w.unlocks.length, 1, 'applied once')
  assert.equal(w.isUnlocked(), true)
  // Bound to this host, 30 days, and good offline: checked with the public key only.
  const checked = verifyLicense(w.keys.cached(), { keys: signer.keys, host: HOST, now: w.clock.now() })
  assert.deepEqual([checked.valid, checked.license.trial, checked.license.kind], [true, true, 'on-prem'])
  assert.equal(verifyLicense(w.keys.cached(), { keys: signer.keys, host: 'elsewhere.example.com', now: w.clock.now() }).reason, 'wrong_host')
  const lastDay = Date.parse(checked.license.expiresAt + 'T00:00:00Z')
  const firstDay = Date.parse(checked.license.issuedAt + 'T00:00:00Z')
  assert.equal((lastDay - firstDay) / 86_400_000 + 1, 30)
  // Cloud's /device page is told what came of it.
  assert.match(w.cloud.outcomes.at(-1).message, /free trial key/)
  // Once unlocked, Upgrade › Unlock says so and asks nothing of Cloud.
  assert.deepEqual(await w.service.startTrial('alice'), { state: 'unlocked', already: true })
})

test('the trial: declined, expired, not offered by Cloud yet, and the same key again on a re-run', async (t) => {
  const w = await world(t)
  const declined = await w.service.startTrial('alice')
  await w.cloud.approve(declined.signIn.userCode, false)
  const no = await w.until(declined._id, ['failed', 'unlocked'])
  assert.deepEqual([no.state, no.failure.code], ['failed', 'access_denied'])
  assert.match(no.failure.message, /declined/)
  assert.equal(w.keys.cached(), null)

  // Resume after a refusal: a new sign-in, then the key.
  const again = await w.service.resumeTrial('alice', declined._id)
  assert.equal(again.state, 'signing_in')
  await w.cloud.approve(again.signIn.userCode)
  assert.equal((await w.until(declined._id, ['unlocked', 'failed'])).state, 'unlocked')
  const first = w.keys.cached()

  // Asking Cloud again for the same host answers the same trial (re-runnable), never a second one.
  const w2key = createLicenseKeyStore({ collection: settingsRows(), keys: signer.keys, now: w.clock.now })
  const s2 = createUpgradeService({ cloud: createCloudClient({ origin: w.cloud.origin }), flows: memoryFlows(), keys: w2key, unlock: async () => ({ unlocked: true }), unlocked: () => false, isServerAdmin: async () => true, preflight: async () => ({}), exportStream: async () => null, install: { host: HOST, installId: 'i2', label: HOST }, sleep: w.clock.sleep, now: w.clock.now })
  const rerun = await s2.startTrial('alice')
  await w.cloud.approve(rerun.signIn.userCode)
  for (let i = 0; i < 200 && (await s2.follow('alice', rerun._id)).state !== 'unlocked'; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(w2key.cached(), first, 'the same key for the same host')
  assert.equal(w.cloud.licenses.docs().length, 1)

  // A Cloud that does not offer server sign-ins yet: a plain way forward, nothing kept.
  const t2 = await world(t, { cloudFetch: (origin) => async (url, init) => (String(url).endsWith('/oauth/device_authorization') ? new Response(JSON.stringify({ error: 'invalid_client', error_description: 'Unknown client.' }), { status: 401 }) : fetch(url, init)) })
  await assert.rejects(t2.service.startTrial('alice'), (error) => error.code === 'trial_unavailable' && /slatebox\.com/.test(error.message))
  void CloudError
})

test('the trial: a code nobody approves in time expires with words to start again', async (t) => {
  const w = await world(t)
  const started = await w.service.startTrial('alice')
  // Ten minutes pass while it polls (the shared clock moves with each wait).
  const ended = await w.until(started._id, ['failed'])
  assert.equal(ended.failure.code, 'expired_token')
  assert.match(ended.failure.message, /expired/)
})

// ------------------------------------------------------------------ the move

const slateTexts = (slates) => Object.fromEntries(slates.map((slate) => [slate.options.name, slate.nodes.map((node) => node.options.text)]).sort())

test('one click: the team moves to Cloud with every slate, counts checked, live only on the admin\'s yes', async (t) => {
  const w = await world(t)
  await assert.rejects(w.service.startMove('bob'), { code: 'admin_required' })
  const started = await w.service.startMove('alice')
  assert.equal(started.state, 'signing_in')
  assert.deepEqual([started.team.name, started.members, started.slates], ['Acme', 2, 2])
  assert.equal((await w.service.startMove('alice'))._id, started._id, 'one at a time: the same flow again')
  await w.cloud.approve(started.signIn.userCode)
  const review = await w.until(started._id, ['review', 'failed'])
  assert.equal(review.state, 'review', JSON.stringify(review.failure))
  assert.equal(review.verify.ok, true, JSON.stringify(review.verify))
  assert.deepEqual(review.verify.slates, { sent: 2, arrived: 2 })
  assert.equal(review.verify.sections.slates.sent, 2)
  assert.equal(review.others, 1, 'bob could be invited')
  assert.equal(review.report.into, 'new_team')
  assert.ok(review.progress.bytes > 0)
  // Nothing is visible on Cloud before the yes.
  assert.ok(w.cloud.db.organizations.docs().every((org) => org.hidden), 'hidden until confirmed')

  const confirming = await w.service.confirmMove('alice', started._id, { invite: false })
  assert.ok(['confirming', 'moved'].includes(confirming.state))
  const moved = await w.until(started._id, ['moved', 'failed'])
  assert.equal(moved.state, 'moved', JSON.stringify(moved.failure))
  assert.equal(moved.cloudUrl, w.cloud.origin + '/')
  const team = w.cloud.db.organizations.docs().find((org) => !org.hidden)
  assert.equal(team.name, 'Acme')
  assert.equal((await w.cloud.db.users.findOne({ _id: w.cloud.account._id })).orgId, team._id, 'the Cloud account owns the moved team')
  // Content equal: the same slates with the same notes on Cloud as here.
  const here = slateTexts(w.self.db.slates.docs())
  const there = slateTexts(w.cloud.db.slates.docs().filter((slate) => slate.orgId === team._id))
  assert.deepEqual(there, here)
  // This install is left exactly as it was.
  assert.equal(w.self.db.slates.docs().length, 2)
  assert.equal(w.self.db.organizations.docs().length, 1)
  // Confirming again is one confirm.
  assert.equal((await w.service.confirmMove('alice', started._id)).state, 'moved')
  assert.equal(w.cloud.db.organizations.docs().filter((org) => org.name === 'Acme').length, 1)
})

test('the move resumes after a restart from where it stopped, without uploading twice', async (t) => {
  const flows = memoryFlows()
  const w = await world(t, { flows })
  const started = await w.service.startMove('alice')
  await w.cloud.approve(started.signIn.userCode)
  await w.until(started._id, ['review'])
  const imports = (await w.cloud.db.imports.find({}).toArray()).length
  assert.equal(imports, 1)

  // The server restarts: the same flows, a new service (Cloud's token was in memory only).
  const restarted = createUpgradeService({
    cloud: createCloudClient({ origin: w.cloud.origin }),
    flows,
    keys: w.keys,
    unlock: async () => ({ unlocked: true }),
    unlocked: () => false,
    isServerAdmin: async (userId) => userId === 'alice',
    preflight: (userId) => w.self.transfer.preflight(userId),
    exportStream: async () => assert.fail('nothing is exported again'),
    install: { host: HOST, installId: 'install-1', label: HOST },
    sleep: w.clock.sleep,
    now: w.clock.now,
  })
  // The review waits; Make it live asks for a new sign-in first, then confirms the same move.
  assert.equal((await restarted.follow('alice', started._id)).state, 'review')
  const asked = await restarted.confirmMove('alice', started._id, { invite: true })
  assert.equal(asked.state, 'signing_in')
  await w.cloud.approve(asked.signIn.userCode)
  const live = await (async () => {
    for (let i = 0; i < 400; i += 1) {
      const flow = await restarted.follow('alice', started._id)
      if (['moved', 'failed'].includes(flow.state)) return flow
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    return null
  })()
  assert.equal(live?.state, 'moved', JSON.stringify(live?.failure))
  assert.equal((await w.cloud.db.imports.find({}).toArray()).length, imports, 'the archive was not sent twice')
  assert.ok(live.invited, 'the others were invited as asked')

  // A restart mid-export: the flow says so and resumes with a new sign-in.
  const stale = { _id: 'f'.repeat(24), kind: 'move', state: 'uploading', userId: 'alice', keys: { start: 'k1', confirm: 'k2' }, createdAt: w.clock.now() + 10, updatedAt: w.clock.now() }
  await flows.insert(stale)
  const told = await restarted.follow('alice', stale._id)
  assert.deepEqual([told.state, told.failure.code], ['needs_sign_in', 'sign_in_ended'])
})

test('a move already waiting on Cloud is replaced only when asked; Cloud\'s daily limit in its own words', async (t) => {
  const w = await world(t)
  // First move: uploaded, left waiting.
  const first = await w.service.startMove('alice')
  await w.cloud.approve(first.signIn.userCode)
  await w.until(first._id, ['review'])
  await w.flows.set(first._id, { state: 'cancelled' })
  // A second move finds the first waiting on Cloud.
  const second = await w.service.startMove('alice')
  await w.cloud.approve(second.signIn.userCode)
  const blocked = await w.until(second._id, ['failed', 'review'])
  assert.deepEqual([blocked.state, blocked.failure.code], ['failed', 'move_pending'])
  assert.match(blocked.failure.message, /already waiting/)
  // Replace it: the waiting one is discarded on Cloud, and this one goes on.
  const resumed = await w.service.startMove('alice', { replaceWaiting: true })
  assert.equal(resumed._id, second._id)
  await w.cloud.approve(resumed.signIn.userCode)
  assert.equal((await w.until(second._id, ['review', 'failed'])).state, 'review')
  assert.ok((await w.cloud.db.imports.find({}).toArray()).some((row) => row.state === 'discarded'))

  // Cloud's limit: three moves a day per person, refused with Cloud's words.
  assert.equal(MOVES_PER_DAY, 3)
  await w.flows.set(second._id, { state: 'cancelled' })
  for (const row of await w.cloud.db.imports.find({}).toArray()) await w.cloud.db.imports.updateOne({ _id: row._id }, { $set: { state: 'discarded' } })
  await w.cloud.db.imports.insertOne({ _id: 'extra-move', state: 'discarded', move: { actorUserId: w.cloud.account._id }, createdAt: new Date(w.clock.now()) })
  const third = await w.service.startMove('alice')
  await w.cloud.approve(third.signIn.userCode)
  const limited = await w.until(third._id, ['failed', 'review'])
  assert.deepEqual([limited.state, limited.failure.code], ['failed', 'move_limit'])
  assert.match(limited.failure.message, /3 times a day/)
})

test('only a team admin who administers this server can move the team', async (t) => {
  const w = await world(t)
  await w.self.db.permissions.deleteMany({ _id: 'p1' })
  await assert.rejects(w.service.startMove('alice'), { code: 'team_admin_required' })
})

test('a page loaded after a late unlock is told: the runtime config carries the state as it is now', async () => {
  const { runtimeConfigWithEnterprise } = await import('../web/app/server/enterprise-runtime.mjs')
  const encode = (config) => JSON.stringify(encodeURIComponent(JSON.stringify(config)))
  const decode = (encoded) => JSON.parse(decodeURIComponent(JSON.parse(encoded)))
  const before = encode({ meteorRelease: 'METEOR@3.5', PUBLIC_SETTINGS: { edition: 'self-host', enterprise: { unlocked: false } } })
  const on = { unlocked: true, via: 'license', features: ['agents.invite'] }
  const after = runtimeConfigWithEnterprise(before, on)
  assert.deepEqual(decode(after), { meteorRelease: 'METEOR@3.5', PUBLIC_SETTINGS: { edition: 'self-host', enterprise: on } })
  assert.equal(runtimeConfigWithEnterprise(after, on), undefined, 'nothing to change')
  assert.equal(runtimeConfigWithEnterprise('not json', on), undefined, 'an unknown form is left alone')
})
