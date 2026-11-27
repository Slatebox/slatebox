// Admin › AI control › Integration apps (enterprise/server/integration-apps.mjs): an administrator
// enters each vendor's OAuth client id and secret instead of only settings.connectors.oauthApps.
// The secret is sealed with the vault and never returned (a fingerprint only); what admin holds
// wins over the settings file, which stays the fallback; the same checks as settings; only an
// administrator reads, only a person writes, every change audited; and the connectors ask for the
// apps on every use, so a pasted secret works without a restart.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/integration-apps.test.mjs
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { CACHE_MS, EDITABLE_PROVIDERS, createIntegrationApps, integrationAppActions } from '../enterprise/server/integration-apps.mjs'
import { connectorSettings } from '../enterprise/server/connector-settings.mjs'
import { chooseRegistration, KNOWN_PROVIDERS } from '../enterprise/server/oauth.mjs'
import { createVault } from '../enterprise/server/credentials.mjs'
import { createConnectorService } from '../enterprise/server/service.mjs'
import { COLLECTIONS, createControlStore } from '../web/app/server/ai-control/store.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'

const newMaster = () => loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
const ADMIN = { userId: 'root', principal: 'person', via: 'ddp' }
const SECRET = 'slack-secret-0123456789abcdef'

function rowMemory() {
  const docs = new Map()
  return {
    docs,
    get: async (provider) => (docs.has(provider) ? structuredClone(docs.get(provider)) : null),
    all: async () => [...docs.values()].map((doc) => structuredClone(doc)),
    put: async (provider, doc) => void docs.set(provider, structuredClone({ ...doc, _id: provider })),
    remove: async (provider) => void docs.delete(provider),
  }
}

function setup({ settings = {}, master = newMaster(), clock = { t: Date.parse('2026-11-26T10:00:00Z') } } = {}) {
  const rows = rowMemory()
  const audited = []
  const oauthApps = connectorSettings({ connectors: { oauthApps: settings } }).oauthApps
  const store = createIntegrationApps({
    rows, master, settingsApps: () => oauthApps, origin: () => 'https://slate.example.com/', now: () => clock.t,
    audit: async (entry) => void audited.push(entry), log: { warn() {} },
  })
  return { rows, store, audited, master, clock }
}

test('a secret is sealed and never returned: list and set show a fingerprint, the document holds a cipher', async () => {
  const { rows, store, audited } = setup()
  const row = await store.set({ actor: ADMIN, provider: 'slack', clientId: ' 123.456 ', clientSecret: SECRET })
  assert.equal(row.clientId, '123.456', 'trimmed')
  assert.equal(row.source, 'admin')
  assert.equal(row.hasSecret, true)
  assert.match(row.secretFingerprint, /^sha256:[0-9a-f]{8}…cdef$/)
  const doc = rows.docs.get('slack')
  assert.equal(doc.secret.v, 1)
  assert.ok(!JSON.stringify(doc).includes(SECRET), 'the database never holds the secret in clear')
  const listed = await store.list()
  assert.ok(!JSON.stringify(listed).includes(SECRET), 'the list never carries the secret')
  assert.ok(!JSON.stringify(audited).includes(SECRET), 'nor does the audit trail')
  assert.equal(listed.redirectUrl, 'https://slate.example.com/connectors/oauth/callback')
  assert.equal(listed.secretsAvailable, true)
  assert.deepEqual(listed.apps.map((a) => a.provider), Object.keys(KNOWN_PROVIDERS), 'one row per known provider')
  assert.equal(listed.apps.find((a) => a.provider === 'google').editable, false, 'Google is shown read-only')
  for (const app of listed.apps) assert.ok(app.console?.url?.startsWith('https://'), `${app.provider} links to its vendor console`)
  // the connectors get the opened secret
  assert.equal((await store.apps()).slack.clientSecret, SECRET)
  // audited, with who and what (fingerprint only)
  assert.equal(audited.length, 1)
  assert.equal(audited[0].action, 'connectors.apps.set')
  assert.deepEqual(audited[0].target, { kind: 'integration-app', id: 'slack' })
  assert.equal(audited[0].after.secretFingerprint, row.secretFingerprint)
  assert.equal(audited[0].before, null)
})

test('a secret sealed under another key-encryption key is not used and is flagged', async () => {
  const first = setup()
  await first.store.set({ actor: ADMIN, provider: 'asana', clientId: 'asana-app', clientSecret: 'asana-secret' })
  const moved = createIntegrationApps({ rows: first.rows, master: newMaster(), log: { warn() {} } })
  assert.equal((await moved.apps()).asana.clientSecret, undefined)
  const row = (await moved.list()).apps.find((a) => a.provider === 'asana')
  assert.equal(row.secretUnreadable, true)
  assert.equal(row.hasSecret, false)
})

test('what admin holds wins over the settings file; settings stay the fallback and keep scopes', async () => {
  const { store } = setup({ settings: { slack: { clientId: 'settings-id', clientSecret: 'settings-secret', scopes: ['chat:write'] }, github: { clientId: 'gh-id', clientSecret: 'gh-secret' } } })
  let listed = await store.list()
  assert.deepEqual(['source', 'clientId', 'secretSource'].map((k) => listed.apps.find((a) => a.provider === 'slack')[k]), ['settings', 'settings-id', 'settings'])
  assert.equal(listed.apps.find((a) => a.provider === 'hubspot').source, 'none')
  // the same client id with no secret entered: the settings secret still serves
  await store.set({ actor: ADMIN, provider: 'slack', clientId: 'settings-id' })
  assert.equal((await store.apps()).slack.clientSecret, 'settings-secret')
  // a new secret for the same app wins
  await store.set({ actor: ADMIN, provider: 'slack', clientSecret: SECRET })
  let apps = await store.apps()
  assert.deepEqual(apps.slack, { clientId: 'settings-id', clientSecret: SECRET, scopes: ['chat:write'] })
  // another client id: the saved secret belonged to the old one and is dropped; the settings secret is another app's
  await store.set({ actor: ADMIN, provider: 'slack', clientId: 'admin-id' })
  apps = await store.apps()
  assert.deepEqual(apps.slack, { clientId: 'admin-id', scopes: ['chat:write'] })
  listed = await store.list()
  const slack = listed.apps.find((a) => a.provider === 'slack')
  assert.deepEqual([slack.source, slack.clientId, slack.settingsClientId, slack.hasSecret], ['admin', 'admin-id', 'settings-id', false])
  assert.deepEqual(apps.github, { clientId: 'gh-id', clientSecret: 'gh-secret' }, 'other providers come from settings untouched')
  // clearing goes back to the settings file
  const cleared = await store.clear({ actor: ADMIN, provider: 'slack' })
  assert.equal(cleared.source, 'settings')
  assert.deepEqual((await store.apps()).slack, { clientId: 'settings-id', clientSecret: 'settings-secret', scopes: ['chat:write'] })
})

test('the same checks as settings: one line of visible characters, known providers, Google stays in settings', async () => {
  const { store, rows } = setup()
  const refused = (promise, pattern, status) => assert.rejects(promise, (error) => {
    assert.match(error.message, pattern)
    if (status) assert.equal(error.status, status)
    return true
  })
  await refused(store.set({ actor: ADMIN, provider: 'slack', clientId: 'has space' }), /one line, with no spaces/, 400)
  await refused(store.set({ actor: ADMIN, provider: 'slack', clientId: 'ok', clientSecret: 'line\nbreak' }), /client secret on one line/, 400)
  await refused(store.set({ actor: ADMIN, provider: 'slack', clientId: 'x'.repeat(501) }), /at most 500/, 400)
  await refused(store.set({ actor: ADMIN, provider: 'slack', clientSecret: SECRET }), /client id too/, 400)
  await refused(store.set({ actor: ADMIN, provider: 'slack' }), /Enter a client id/, 400)
  await refused(store.set({ actor: ADMIN, provider: 'google', clientId: 'g' }), /settings file/, 400)
  await refused(store.set({ actor: ADMIN, provider: 'acme', clientId: 'a' }), /no integration app acme/, 404)
  assert.equal(rows.docs.size, 0, 'nothing refused was saved')
  assert.ok(!EDITABLE_PROVIDERS.includes('google'))
  // no key-encryption key: a client id may be saved, a secret may not
  const bare = createIntegrationApps({ rows: rowMemory(), master: null, log: { warn() {} } })
  await refused(bare.set({ actor: ADMIN, provider: 'box', clientId: 'box-id', clientSecret: 'box-secret' }), /SLATEBOX_KEY_ENCRYPTION_KEY/, 503)
  assert.equal((await bare.set({ actor: ADMIN, provider: 'box', clientId: 'box-id' })).clientId, 'box-id')
  // a document that fails the checks (written by hand) is never used
  rows.docs.set('zoom', { _id: 'zoom', clientId: 'bad id' })
  rows.docs.set('google', { _id: 'google', clientId: 'sneaky' })
  const apps = await store.apps()
  assert.equal(apps.zoom, undefined)
  assert.equal(apps.google, undefined)
})

test('the actions: administrators only read; only a person writes; refusals are audited', async () => {
  const { store } = setup()
  const actions = Object.fromEntries(integrationAppActions(() => store).map((a) => [a.id, a]))
  assert.deepEqual(Object.keys(actions).sort(), ['connectors.apps.clear', 'connectors.apps.list', 'connectors.apps.set'])
  for (const id of ['connectors.apps.set', 'connectors.apps.clear']) {
    assert.deepEqual(actions[id].principals, ['person'], id)
    assert.ok(actions[id].mounts.ddp && !actions[id].mounts.http, `${id}: the app's page only`)
    assert.equal(actions[id].toolset, 'admin')
    assert.equal(actions[id].confirm, true)
  }
  assert.equal(actions['connectors.apps.list'].toolset, 'admin')
  const collections = Object.fromEntries(Object.keys(COLLECTIONS).map((key) => [key, memoryCollection()]))
  const controlStore = createControlStore({ collections, newId: (() => { let n = 0; return () => `a${++n}` })(), now: () => new Date('2026-11-26T10:00:00Z') })
  const deps = { aiControlAdmin: async (userId) => userId === 'root', aiControlStore: controlStore }
  await assert.rejects(actions['connectors.apps.list'].handler({ kind: 'person', userId: 'ana' }, {}, { deps }), /Only an administrator of this server can read integration apps/)
  await assert.rejects(actions['connectors.apps.set'].handler({ kind: 'person', userId: 'ana' }, { provider: 'slack', clientId: 'x' }, { deps }), /Only an administrator/)
  await assert.rejects(actions['connectors.apps.set'].handler({ kind: 'agent', userId: 'root', tokenId: 't' }, { provider: 'slack', clientId: 'x' }, { deps }), /Only a person enters or clears an integration app/)
  await assert.rejects(actions['connectors.apps.clear'].handler({ kind: 'agent', userId: 'root', tokenId: 't' }, { provider: 'slack' }, { deps }), /Only a person/)
  const refusals = [...collections.audit.docs.values()].filter((r) => r.outcome === 'refused').map((r) => r.action)
  assert.ok(refusals.includes('connectors.apps.set') && refusals.includes('connectors.apps.clear'), 'refused writes are in the audit trail')
  const saved = await actions['connectors.apps.set'].handler({ kind: 'person', userId: 'root' }, { provider: 'slack', clientId: 'slack-id', clientSecret: SECRET }, { deps })
  assert.equal(saved.body.hasSecret, true)
  assert.ok(!JSON.stringify(saved).includes(SECRET))
  const listed = await actions['connectors.apps.list'].handler({ kind: 'agent', userId: 'root', tokenId: 't' }, {}, { deps })
  assert.equal(listed.body.apps.find((a) => a.provider === 'slack').clientId, 'slack-id', 'an administrator\'s token may read (fingerprints only)')
  const cleared = await actions['connectors.apps.clear'].handler({ kind: 'person', userId: 'root' }, { provider: 'slack' }, { deps })
  assert.equal(cleared.body.source, 'none')
})

test('the AI control audit trail takes these rows as they are, without the secret', async () => {
  const collections = Object.fromEntries(Object.keys(COLLECTIONS).map((key) => [key, memoryCollection()]))
  const controlStore = createControlStore({ collections, newId: (() => { let n = 0; return () => `r${++n}` })(), now: () => new Date('2026-11-26T10:00:00Z') })
  const store = createIntegrationApps({ rows: rowMemory(), master: newMaster(), audit: (entry) => controlStore.record(entry), log: { warn() {} } })
  await store.set({ actor: ADMIN, provider: 'zoom', clientId: 'zoom-id', clientSecret: 'zoom-secret' })
  await store.clear({ actor: ADMIN, provider: 'zoom' })
  const rows = [...collections.audit.docs.values()]
  assert.deepEqual(rows.map((r) => r.action), ['connectors.apps.set', 'connectors.apps.clear'])
  assert.ok(!JSON.stringify(rows).includes('zoom-secret'))
})

test('dynamic: the connectors ask for the apps on each use, so a pasted secret works without a restart', async () => {
  const { store } = setup()
  // the sign-in's registration (signin.mjs passes `await apps()` to chooseRegistration)
  const slackServer = { issuer: KNOWN_PROVIDERS.slack.issuer }
  const resource = 'https://mcp.slack.com/mcp'
  assert.equal(chooseRegistration({ server: slackServer, apps: await store.apps(), origin: 'https://slate.example.com', resource }).kind, 'needs_client_id')
  await store.set({ actor: ADMIN, provider: 'slack', clientId: 'slack-id', clientSecret: SECRET })
  const registration = chooseRegistration({ server: slackServer, apps: await store.apps(), origin: 'https://slate.example.com', resource })
  assert.deepEqual([registration.kind, registration.clientId, registration.clientSecret], ['preregistered', 'slack-id', SECRET], 'this process sees its own write at once')

  // the gallery (service.mjs takes a getter): Slack shows once its app is set up, no new service
  const service = createConnectorService({ oauthApps: () => store.apps() })
  const person = { kind: 'person', userId: 'ada', scopes: [] }
  assert.ok((await service.gallery(person)).cards.some((c) => c.id === 'slack'))
  assert.ok((await service.gallery(person)).notSetUp.some((c) => c.id === 'asana'))

  // the vault's refresh and revocation (secretFor is asked each time): the secret goes with the revocation
  const sent = []
  const fetch = async (url, init) => {
    sent.push({ url, body: init.body })
    return { ok: true, body: null }
  }
  const credentials = new Map()
  const vault = createVault({
    store: { get: async (id) => credentials.get(id) || null, put: async (doc) => void credentials.set(doc._id, doc), update: async () => {}, claim: async () => true, release: async () => {}, remove: async (id) => void credentials.delete(id) },
    master: newMaster(), fetch, secretFor: async (reg) => (await store.apps())[reg.provider]?.clientSecret || null,
  })
  await vault.save({
    userId: 'ada', address: resource, resource, issuer: slackServer.issuer, kind: 'oauth', registration: { kind: 'preregistered', clientId: 'slack-id', provider: 'slack' },
    server: { issuer: slackServer.issuer, tokenEndpoint: 'https://slack.com/api/oauth.v2.access', revocationEndpoint: 'https://slack.com/api/auth.revoke' }, tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
  })
  // the administrator replaces the secret after the sign-in: the next revocation sends the new one
  await store.set({ actor: ADMIN, provider: 'slack', clientSecret: 'rotated-secret' })
  await vault.remove('ada', resource)
  assert.ok(sent.length >= 1)
  assert.ok(sent.every((s) => new URLSearchParams(s.body).get('client_secret') === 'rotated-secret'), 'the revocation used the secret in effect now')
})

test('another process sees a change once its short cache is out of date', async () => {
  const master = newMaster()
  const rows = rowMemory()
  const clock = { t: 0 }
  const podA = createIntegrationApps({ rows, master, now: () => clock.t, log: { warn() {} } })
  const podB = createIntegrationApps({ rows, master, now: () => clock.t, log: { warn() {} } })
  assert.equal((await podB.apps()).hubspot, undefined)
  await podA.set({ actor: ADMIN, provider: 'hubspot', clientId: 'hub-id', clientSecret: 'hub-secret' })
  assert.equal((await podB.apps()).hubspot, undefined, 'within the cache window')
  clock.t += CACHE_MS
  assert.deepEqual((await podB.apps()).hubspot, { clientId: 'hub-id', clientSecret: 'hub-secret' })
  // the database is down: the last apps read keep answering
  rows.all = async () => { throw new Error('down') }
  clock.t += CACHE_MS
  assert.deepEqual((await podB.apps()).hubspot, { clientId: 'hub-id', clientSecret: 'hub-secret' })
})

function memoryCollection() {
  const docs = new Map()
  return {
    docs,
    async findOne(query) { const doc = docs.get(query._id); return doc ? structuredClone(doc) : null },
    async replaceOne(query, doc, options = {}) { if (!docs.has(query._id) && !options.upsert) return { matchedCount: 0 }; docs.set(query._id, structuredClone(doc)); return { matchedCount: 1 } },
    async deleteOne(query) { return { deletedCount: docs.delete(query._id) ? 1 : 0 } },
    async insertOne(doc) { docs.set(doc._id, structuredClone(doc)); return { insertedId: doc._id } },
    async findOneAndUpdate(query, update, options = {}) {
      let doc = docs.get(query._id)
      if (!doc) { if (!options.upsert) return null; doc = { _id: query._id, ...(update.$setOnInsert || {}) } }
      for (const [key, by] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + by
      Object.assign(doc, update.$set || {})
      docs.set(query._id, doc)
      return structuredClone(doc)
    },
    async createIndex() {},
  }
}
