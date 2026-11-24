// AI control S3: providers, connections, models and prices as data (spec 1.1-1.3, 3.2-3.3, 6.2-6.3).
//   - a provider an administrator adds is a connection type at once (no deploy): its key style and
//     extra headers go on the wire; the four built-in types stay as they were;
//   - a server connection's key is sealed with the server's key, rotated with a grace period, read
//     from an allowed environment variable, or absent; no response, audit row or view carries it;
//   - only a person sets a key, an environment variable, an address or a provider (an agent gets 403);
//   - models carry capabilities and prices; the meter charges the DB price; an unpriced model is
//     charged at the dearest row and flagged;
//   - the services beside the models (Stability, Google picture search, Noun Project, Deepgram)
//     take sealed keys that a request reads at once;
//   - a provider redirect is never followed, error text loses keys and query strings.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { buildClientManifest, renderExecTool } from '../web/app/server/actions/client-render.mjs'
import { readFileSync } from 'node:fs'
import {
  BUILTIN_PROVIDERS, CHAT_PROTOCOLS, chatConnectionTypes, mergeProviders, normalizeProvider,
} from '../web/app/server/ai-control/providers.mjs'
import {
  CONNECTION_TYPES, connectionType, connectionTypes, normalizeConnection, setProviderSource,
} from '../web/app/server/methods/ai/connections.mjs'
import { connectionRequest, authFor } from '../web/app/server/methods/ai/connection-request.mjs'
import { listModels, checkConnection } from '../web/app/server/methods/ai/connection-check.mjs'
import { connectionFetch, endpointRules } from '../web/app/server/methods/ai/endpoint-policy.mjs'
import { createAISettings, keyFingerprint } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { createConnectionStore } from '../web/app/server/methods/ai/connection-store.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { aiCostMicros, aiPrice, isPriced, setDbPriceSource, AI_PRICES } from '../web/app/server/metering/prices.mjs'
import { COLLECTIONS, STATE_ID, createControlStore } from '../web/app/server/ai-control/store.mjs'
import { createSnapshotHolder } from '../web/app/server/ai-control/snapshot.mjs'
import { createAIControl, warningsOf } from '../web/app/server/ai-control/facade.mjs'
import { bindingsUsing, createCatalogOps, createWriteLimit, dbPriceFor, modelId, providersView } from '../web/app/server/ai-control/models.mjs'
import { checkAuxConnection, oauth1Header } from '../web/app/server/ai-control/aux-check.mjs'

// ---------- in-memory stores ----------
function memoryCollection() {
  const docs = new Map()
  return {
    docs,
    async findOne(query) { const doc = docs.get(query._id); return doc ? structuredClone(doc) : null },
    async replaceOne(query, doc) { docs.set(query._id, structuredClone(doc)); return { matchedCount: 1 } },
    async deleteOne(query) { return { deletedCount: docs.delete(query._id) ? 1 : 0 } },
    async insertOne(doc) { docs.set(doc._id, structuredClone(doc)); return { insertedId: doc._id } },
    async findOneAndUpdate(query, update, options = {}) {
      let doc = docs.get(query._id)
      if (!doc) {
        if (!options.upsert) return null
        doc = { _id: query._id, ...(update.$setOnInsert || {}) }
      }
      for (const [key, by] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + by
      Object.assign(doc, update.$set || {})
      docs.set(query._id, doc)
      return structuredClone(doc)
    },
  }
}
// providerKeys and aiChoices as the connection store reads them (MongoDB driver shape)
function keyCollections() {
  const rows = []
  const match = (filter) => (doc) => Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return v.some((part) => match(part)(doc))
    if (v && typeof v === 'object' && '$exists' in v) return (doc[k] !== undefined) === v.$exists
    if (k === 'previousCipher.until') return doc.previousCipher?.until && new Date(doc.previousCipher.until) < v.$lt
    return doc[k] === v
  })
  const keys = {
    rows,
    find: (filter) => ({ toArray: async () => rows.filter(match(filter)).map((d) => structuredClone(d)) }),
    async updateOne(filter, update, options = {}) {
      let doc = rows.find(match(filter))
      if (!doc && options.upsert) { doc = { ...(update.$setOnInsert || {}) }; rows.push(doc) }
      if (doc) Object.assign(doc, structuredClone(update.$set || {}))
    },
    async updateMany(filter, update) {
      const hit = rows.filter(match(filter))
      for (const doc of hit) Object.assign(doc, update.$set)
      return { modifiedCount: hit.length }
    },
    async deleteMany(filter) { for (let i = rows.length - 1; i >= 0; i -= 1) if (match(filter)(rows[i])) rows.splice(i, 1) },
  }
  const choiceDocs = new Map()
  const choices = {
    findOne: async (q) => structuredClone(choiceDocs.get(q._id) ?? null),
    replaceOne: async (q, doc) => { choiceDocs.set(q._id, structuredClone(doc)) },
  }
  return { keys, choices }
}

const GEMINI = { id: 'gemini', label: 'Google Gemini (OpenAI-compatible)', protocol: 'openai-chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', auth: { style: 'header', name: 'x-goog-api-key' }, extraHeaders: { 'x-goog-api-client': 'slatebox' }, defaultCapabilities: { tools: true, vision: true } }

function world({ settings = { public: { env: 'selfhost' } }, env = {}, check = async () => ({ ok: true, message: 'Connected.' }) } = {}) {
  const collections = Object.fromEntries(Object.keys(COLLECTIONS).map((key) => [key, memoryCollection()]))
  const { keys, choices } = keyCollections()
  const keyStore = createConnectionStore({ keys, choices, newId: () => randomBytes(6).toString('hex') })
  let id = 0
  let clock = Date.parse('2026-11-24T10:00:00Z')
  const holder = createSnapshotHolder({
    read: {
      generation: async () => (await collections.state.findOne({ _id: STATE_ID }))?.generation ?? 0,
      all: async () => ({
        state: await collections.state.findOne({ _id: STATE_ID }),
        providers: [...collections.providers.docs.values()].filter((p) => p.status !== 'archived'),
        connections: keys.rows.filter((d) => d.ownerType === 'server' && d.name).map(({ cipher: _c, previousCipher: _p, ...doc }) => ({ ...doc, hasKey: Boolean(doc.last4) })),
        models: [...collections.models.docs.values()], bindings: [...collections.bindings.docs.values()], prompts: [], promptVersions: [], agents: [],
      }),
    },
    settings,
    log: { warn() {} },
  })
  const store = createControlStore({ collections, newId: () => `row${String(++id).padStart(3, '0')}`, now: () => new Date(clock), onWrite: () => holder.refresh({ force: true }) })
  const ai = createAISettings({
    store: keyStore,
    // a key made for this test run only, never the server's key-encryption key
    master: loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }),
    settings, hosted: false, env, now: () => clock,
    loadUser: async (userId) => ({ root: { _id: 'root' }, ana: { _id: 'ana', orgId: 'team1' } })[userId] || null,
    isAdmin: async (userId) => userId === 'root',
    isTeamAdmin: async () => false,
    check,
    listModels: (connection, rules) => listModels(connection, { fetch: (url, init) => connectionFetch(String(url), rules)(url, init) }),
    checkAux: async (connection) => ({ ok: true, message: `aux ${connection.type} ok` }),
    audit: (entry) => store.record(entry),
  })
  const catalog = createCatalogOps({ store, snapshot: () => holder.current(), aiSettings: ai, checkUrl: (url) => url.replace(/\/+$/, ''), readProvider: async (pid) => collections.providers.findOne({ _id: pid }) })
  const aiControl = createAIControl({ holder, choiceHolders: (userId) => ai.choiceHolders(userId), settings, isPriced, providerView: (snap) => providersView(snap) })
  setProviderSource(() => holder.current().providers)
  setDbPriceSource((model) => dbPriceFor(holder.current(), model))
  const deps = { ai, aiControl, aiControlAdmin: async (userId) => userId === 'root', aiControlStore: store, aiCatalog: catalog, aiControlWriteLimit: createWriteLimit({ now: () => clock }) }
  const registry = createAppRegistry({ deps })
  const auditRows = () => [...collections.audit.docs.values()]
  return { collections, keys, keyStore, store, holder, ai, aiControl, registry, deps, auditRows, tick: (ms) => { clock += ms }, now: () => clock }
}

const person = (userId) => ({ kind: 'person', userId, tokenId: null, tokenName: null, scopes: ['ai:admin', 'ai:settings'] })
const agent = (userId, scopes = ['ai:admin', 'ai:settings']) => ({ kind: 'agent', userId, tokenId: `t-${userId}`, tokenName: 'Agent', scopes })
const body = (result) => {
  const { mode: _mode, ...rest } = result.body ?? result
  return rest
}
test.after(() => {
  setProviderSource(null)
  setDbPriceSource(null)
})

// ---------- providers ----------
test('the four connection types and the services beside the models are built-in provider rows; CONNECTION_TYPES is unchanged', () => {
  assert.deepEqual(Object.keys(CONNECTION_TYPES).sort(), ['anthropic', 'deepinfra', 'openai', 'openai-compatible'])
  assert.equal(CONNECTION_TYPES.openai.baseUrl, 'https://api.openai.com/v1')
  assert.equal(CONNECTION_TYPES.deepinfra.modelOptional, true)
  assert.equal(CONNECTION_TYPES['openai-compatible'].baseUrl, undefined)
  assert.equal(CONNECTION_TYPES.anthropic.protocol, 'anthropic-messages')
  assert.deepEqual(Object.keys(BUILTIN_PROVIDERS).filter((p) => BUILTIN_PROVIDERS[p].aux).sort(), ['deepgram', 'google-cse', 'nounproject', 'stability'])
  // the services are not model choices
  assert.deepEqual(Object.keys(chatConnectionTypes({})).sort(), ['anthropic', 'deepinfra', 'openai', 'openai-compatible'])
})

test('a provider is checked: built-in ids, protocols, key styles and secret-looking headers are refused', () => {
  const ok = normalizeProvider(GEMINI)
  assert.deepEqual([ok._id, ok.protocol, ok.baseUrlLocked, ok.auth, ok.keyRequired, ok.builtin], ['gemini', 'openai-chat', true, { style: 'header', name: 'x-goog-api-key' }, true, false])
  assert.throws(() => normalizeProvider({ ...GEMINI, id: 'openai' }), /built-in/)
  assert.throws(() => normalizeProvider({ ...GEMINI, protocol: 'grpc' }), /protocol is one of/)
  assert.throws(() => normalizeProvider({ ...GEMINI, protocol: 'google-cse' }), /protocol is one of/)
  assert.throws(() => normalizeProvider({ ...GEMINI, extraHeaders: { 'X-Api-Key': 'abc' } }), /looks like a credential/)
  assert.throws(() => normalizeProvider({ ...GEMINI, extraHeaders: { 'x-client': 'sk-abcdefghijklmnopqrstuv' } }), /looks like a key/)
  assert.throws(() => normalizeProvider({ ...GEMINI, extraHeaders: { Host: 'evil' } }), /sets Host itself/)
  assert.throws(() => normalizeProvider({ ...GEMINI, auth: { style: 'query' } }), /auth.name/)
  assert.throws(() => normalizeProvider({ ...GEMINI, protocol: 'anthropic-messages', auth: { style: 'bearer' } }), /x-api-key/)
  assert.equal(normalizeProvider({ id: 'local', label: 'Local', protocol: 'openai-chat', auth: { style: 'none' } }).keyRequired, false)
  assert.equal(normalizeProvider({ id: 'pics', label: 'Pics', protocol: 'openai-images', baseUrl: 'https://pics.example/v1' }).defaultCapabilities.images, true)
  // the address goes through the endpoint rules of the server
  assert.throws(() => normalizeProvider(GEMINI, { checkUrl: () => { throw Object.assign(new Error('Slatebox does not connect to cloud metadata addresses.'), { name: 'EndpointRefused' }) } }), /metadata/)
  // a stored row with a built-in id, or archived, is not offered
  const merged = mergeProviders({ openai: { _id: 'openai', label: 'Fake', protocol: 'openai-chat', baseUrl: 'https://evil.example/v1' }, old: { ...GEMINI, _id: 'old', status: 'archived' }, gemini: { ...GEMINI, _id: 'gemini' } })
  assert.equal(merged.openai.baseUrl, 'https://api.openai.com/v1')
  assert.equal(merged.old, undefined)
  assert.equal(merged.gemini.protocol, 'openai-chat')
  assert.ok(CHAT_PROTOCOLS.includes('openai-images'))
})

test('a provider an administrator adds is a connection type at once; the wire protocol picks the request path', () => {
  setProviderSource(() => ({ gemini: { ...GEMINI, _id: 'gemini' } }))
  try {
    assert.ok(connectionTypes().gemini)
    const c = normalizeConnection({ name: 'gem', type: 'gemini', model: 'gemini-3.5-flash', apiKey: 'AIza-test' }, { hosted: true, level: 'server' })
    assert.deepEqual([c.baseUrl, c.capabilities], ['https://generativelanguage.googleapis.com/v1beta/openai', { tools: true, vision: true }])
    assert.throws(() => normalizeConnection({ name: 'gem', type: 'gemini', baseUrl: 'https://evil.example/v1', model: 'm', apiKey: 'k' }, { hosted: true, level: 'server' }), /has its own address/)
    assert.throws(() => normalizeConnection({ name: 'gem', type: 'gemini', model: 'm' }, { hosted: true, level: 'server' }), /needs a key/)
    // the key style and extra headers: a header, never the bearer form
    const wire = connectionRequest({ ...c, apiKey: 'AIza-test' })
    assert.deepEqual([wire.provider, wire.endpoint, wire.apiKey, wire.headers, wire.toolChoice], ['connection', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', undefined, { 'x-goog-api-client': 'slatebox', 'x-goog-api-key': 'AIza-test' }, 'auto'])
    assert.deepEqual(authFor({ ...c, apiKey: 'AIza-test' }).headers, { 'x-goog-api-client': 'slatebox', 'x-goog-api-key': 'AIza-test' })
    // the built-in types send exactly what they sent before
    assert.deepEqual(connectionRequest({ type: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-x', apiKey: 'sk-1' }), { provider: 'connection', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-x', apiKey: 'sk-1', toolChoice: 'named', maxTokens: 16384 })
    assert.deepEqual(connectionRequest({ type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'c', apiKey: 'sk-ant' }), { provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', model: 'c', apiKey: 'sk-ant', toolChoice: 'named', maxTokens: 8192 })
    // an administrator's Anthropic-protocol provider goes through the Anthropic path
    setProviderSource(() => ({ claude2: { _id: 'claude2', label: 'Claude proxy', protocol: 'anthropic-messages', baseUrl: 'https://proxy.example/v1' } }))
    assert.equal(connectionRequest({ type: 'claude2', baseUrl: 'https://proxy.example/v1', model: 'c', apiKey: 'k' }).provider, 'anthropic')
  } finally {
    setProviderSource(null)
  }
  assert.equal(connectionType('gemini'), null)
  assert.throws(() => normalizeConnection({ name: 'gem', type: 'gemini', model: 'm', apiKey: 'k' }, { hosted: true, level: 'server' }), /Choose a type: openai-compatible, deepinfra, openai, anthropic\./)
})

test('the real req(): a provider\'s header or query key goes on the wire, a rotated key falls back once, a redirect is never followed', () => {
  const out = JSON.parse(execFileSync(process.execPath, ['--no-deprecation', new URL('./ai-req-provider.mjs', import.meta.url).pathname],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 }))
  const { NEW_KEY, OLD_KEY } = out.keys
  assert.deepEqual([out.typeKnown, out.typeProtocol], [true, 'openai-chat'])
  assert.deepEqual(out.headerKey.seen, [{ path: '/v1beta/openai/chat/completions', query: {}, model: 'gemini-3.5-flash', authorization: null, googKey: NEW_KEY, client: 'slatebox' }])
  assert.deepEqual(out.headerKey.audits, [{ feature: 'shape', surface: 'shape', connection: 'server:gem', attempt: 0, model: 'gemini-3.5-flash', status: 'success' }])
  assert.deepEqual([out.queryKey.seen[0].query, out.queryKey.seen[0].authorization], [{ key: NEW_KEY }, null])
  // rotation: the new key refused, the previous key once, then an answer
  assert.deepEqual(out.rotation.seen.map((s) => s.googKey), [NEW_KEY, OLD_KEY])
  assert.equal(out.rotation.result.abort, false)
  // no grace: one refusal is the answer
  assert.deepEqual([out.rotationNoGrace.seen.length, out.rotationNoGrace.result.abort, out.rotationNoGrace.audits[0].status], [1, true, 'provider_error'])
  // a redirect to another host: refused there, nothing reaches the other host
  assert.deepEqual([out.redirect.other.length, out.redirect.result.abort], [0, true])
  // no audit row carries a key
  assert.ok(!JSON.stringify(Object.values(out).map((s) => s?.audits)).includes(NEW_KEY))
})

// ---------- connections ----------
test('a person adds a provider and a keyed connection: the key is sealed, fingerprinted and never returned, and every pod reloads', async () => {
  const { registry, collections, keys, holder, auditRows, ai } = world()
  const saved = body(await registry.run(person('root'), 'ai.providers.save', { provider: GEMINI, reason: 'add gemini' }))
  assert.deepEqual([saved.provider.id, saved.provider.protocol, saved.droppedKeys], ['gemini', 'openai-chat', []])
  assert.equal(holder.current().providers.gemini.version, 1)
  const key = `AIza${randomBytes(16).toString('hex')}`
  const generation = holder.current().generation
  const out = body(await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'gemini-3.5-flash', apiKey: key, capabilities: { tools: true } }] }))
  assert.deepEqual(out, { connections: ['gem'], fingerprints: { gem: keyFingerprint(key) } })
  // the generation moved, so other pods reload the snapshot; this one already has
  assert.ok(holder.current().generation > generation)
  assert.equal(holder.current().connections.gem.keyFingerprint, keyFingerprint(key))
  const doc = keys.rows.find((d) => d.name === 'gem')
  assert.deepEqual([doc.keyRef, doc.keyFingerprint, typeof doc.cipher.data], [{ kind: 'sealed' }, keyFingerprint(key), 'string'])
  assert.ok(!JSON.stringify(doc).includes(key))
  // nowhere to read it back: the list, the snapshot view, the AI settings, the audit trail
  const listed = body(await registry.run(person('root'), 'ai.connections.list', {}))
  const gem = listed.connections.find((c) => c.name === 'gem')
  assert.deepEqual([gem.provider, gem.hasKey, gem.keyRef, gem.keyFingerprint, gem.status, gem.editable], ['gemini', true, { kind: 'sealed' }, keyFingerprint(key), 'active', true])
  for (const view of [listed, body(await registry.run(person('root'), 'ai.control.get', {})), await ai.view('root'), auditRows(), [...collections.providers.docs.values()]]) {
    const text = JSON.stringify(view)
    assert.ok(!text.includes(key) && !text.includes(key.slice(0, 16)) && !text.includes(doc.cipher.data), 'a key or cipher leaked')
  }
  const row = auditRows().find((r) => r.action === 'ai.connections.save')
  assert.equal(row.after.connections.find((c) => c.name === 'gem').keyFingerprint, keyFingerprint(key))
  // the AI settings list it as a connection a choice may name
  assert.ok((await ai.view('root')).server.connections.some((c) => c.name === 'gem' && c.type === 'gemini'))
})

test('acceptance: provider, keyed connection, model with prices, test, shape bound to it: the request uses it and the meter charges the DB price', async () => {
  const seen = []
  const { registry, ai, holder } = world({ check: async (connection) => { seen.push(connection.apiKey); return { ok: true, message: 'Connected.' } } })
  await registry.run(person('root'), 'ai.providers.save', { provider: GEMINI })
  const key = `AIza${randomBytes(16).toString('hex')}`
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'gemini-3.5-flash', apiKey: key, capabilities: { tools: true } }] })
  const models = body(await registry.run(person('root'), 'ai.models.save', { models: [{ connection: 'server:gem', model: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', capabilities: { tools: true, vision: true }, maxContext: 1000000, prices: { inputPerM: 0.5, outputPerM: 3 } }] }))
  assert.deepEqual(models.models.map((m) => [m.id, m.version, m.prices.inputPerM]), [['gem:gemini-3.5-flash', 1, 0.5]])
  assert.equal(holder.current().models['gem:gemini-3.5-flash'].prices.outputPerM, 3)
  // Test connection: the saved key, at the saved address only; the last test is kept
  const tested = body(await registry.run(person('root'), 'ai.check', { level: 'server', name: 'gem' }))
  assert.equal(tested.ok, true)
  assert.deepEqual(seen, [key])
  // bind shape to it through the AI settings (the S0 path)
  await ai.update('root', { level: 'server', use: { shape: 'server:gem' } })
  const chosen = await ai.resolveFor({ userId: 'ana', feature: 'shape', request: { tools: true } })
  assert.deepEqual([chosen.ref, chosen.connection.type, chosen.connection.model, chosen.connection.apiKey, chosen.error, chosen.gap], ['server:gem', 'gemini', 'gemini-3.5-flash', key, undefined, undefined])
  assert.equal(connectionRequest(chosen.connection).headers['x-goog-api-key'], key)
  // the meter: the DB price wins over the table's row for the same model name
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }
  assert.deepEqual(aiCostMicros({ model: 'gemini-3.5-flash', usage }), { costMicros: 3_500_000, source: 'db', priceModel: 'gemini-3.5-flash' })
  assert.deepEqual([aiPrice('gemini-3.5-flash').source, aiPrice('gemini-3.5-flash').id], ['db', 'gem:gemini-3.5-flash'])
  // the effective view names the connection the shape surface resolves to
  const effective = await registry.run(person('root'), 'ai.control.effective', { surface: 'shape' })
  assert.equal(body(effective).surfaces[0].binding.chain[0].connection, 'server:gem')
})

test('an agent with ai:admin cannot send a key, name an environment variable, or set an address or provider; refusals are recorded', async () => {
  const { registry, auditRows, keys } = world()
  await registry.run(person('root'), 'ai.providers.save', { provider: GEMINI })
  const bot = agent('root')
  const attempts = [
    [{ name: 'a', type: 'gemini', model: 'm', apiKey: 'AIza-agent-key' }, /Only a person can send a key/],
    [{ name: 'b', type: 'deepinfra', keyRef: { kind: 'env', name: 'SLATEBOX_AI_KEY_DEEPINFRA' } }, /keyRef/],
    [{ name: 'c', type: 'openai-compatible', baseUrl: 'https://evil.example/v1', model: 'm' }, /address can be chosen/],
    [{ name: 'd', type: 'gemini', model: 'm', rotate: { graceHours: 1 } }, /rotate/],
  ]
  for (const [connection, why] of attempts) {
    await assert.rejects(registry.run(bot, 'ai.connections.save', { connections: [connection] }), (error) => error.status === 403 && why.test(error.message), connection.name)
  }
  assert.equal(keys.rows.length, 0)
  assert.equal(auditRows().filter((r) => r.outcome === 'refused' && r.action === 'ai.connections.save').length, attempts.length)
  // an agent may not move a provider's address or key style either
  await assert.rejects(registry.run(bot, 'ai.providers.save', { provider: { ...GEMINI, baseUrl: 'https://evil.example/v1' } }), { status: 403 })
  await assert.rejects(registry.run(bot, 'ai.providers.save', { provider: { id: 'sneaky', label: 'S', protocol: 'openai-chat', baseUrl: 'https://evil.example/v1' } }), { status: 403 })
  // what an agent may do: change a provider's label, add models
  assert.equal(body(await registry.run(bot, 'ai.providers.save', { provider: { ...GEMINI, label: 'Gemini' } })).provider.label, 'Gemini')
  // a person's keyed connection: an agent may change its model, never its key or address
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'm1', apiKey: 'AIza-person-key-0123456789-1234' }] })
  await registry.run(bot, 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'm2' }] })
  const doc = keys.rows.find((d) => d.name === 'gem')
  assert.deepEqual([doc.model, doc.last4], ['m2', '1234'])
  await assert.rejects(registry.run(bot, 'ai.connections.save', { connections: [{ name: 'gem', type: 'deepinfra', model: 'm2' }] }), /provider/)
  // the person-only actions are refused to any token by the registry
  await assert.rejects(registry.run(bot, 'ai.connections.remove', { names: ['gem'], reason: 'x' }), { status: 403, code: 'session_required' })
})

test('a key from an environment variable: only allowed names, read for each request, and only to a fixed or freshly set address', async () => {
  const env = { SLATEBOX_AI_KEY_GEMINI: 'AIza-from-env-0123456789', SLATEBOX_KEY_ENCRYPTION_KEY: 'never', MONGO_URL: 'mongodb://secret' }
  const { registry, ai, keys } = world({ env })
  await registry.run(person('root'), 'ai.providers.save', { provider: GEMINI })
  for (const name of ['SLATEBOX_KEY_ENCRYPTION_KEY', 'MONGO_URL', 'PATH', 'DEEPGRAM_SECRET']) {
    await assert.rejects(registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'm', keyRef: { kind: 'env', name } }] }), { status: 400 }, name)
  }
  // an address a person did not set in this change: refused for a provider without a fixed one
  await assert.rejects(registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'own', type: 'openai-compatible', model: 'm', keyRef: { kind: 'env', name: 'SLATEBOX_AI_KEY_GEMINI' } }] }), /address in the same change|address/)
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'gemini-3.5-flash', keyRef: { kind: 'env', name: 'SLATEBOX_AI_KEY_GEMINI' }, capabilities: { tools: true } }] })
  const doc = keys.rows.find((d) => d.name === 'gem')
  assert.deepEqual([doc.keyRef, doc.cipher], [{ kind: 'env', name: 'SLATEBOX_AI_KEY_GEMINI' }, null])
  await ai.update('root', { level: 'server', use: { shape: 'server:gem' } })
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'shape' })).connection.apiKey, 'AIza-from-env-0123456789')
  // rotated in the environment: the next request reads it
  env.SLATEBOX_AI_KEY_GEMINI = 'AIza-rotated-env-0123456789-5678'
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'shape' })).connection.apiKey, 'AIza-rotated-env-0123456789-5678')
  delete env.SLATEBOX_AI_KEY_GEMINI
  assert.match((await ai.resolveFor({ userId: 'ana', feature: 'shape' })).error, /SLATEBOX_AI_KEY_GEMINI is empty or missing/)
  const listed = body(await registry.run(person('root'), 'ai.connections.list', {}))
  assert.deepEqual(listed.connections.find((c) => c.name === 'gem').keyRef, { kind: 'env', name: 'SLATEBOX_AI_KEY_GEMINI' })
})

test('rotation: the old key keeps working for the grace period, then is dropped; disabling a connection stops requests', async () => {
  const { registry, ai, keys, keyStore, tick, now } = world()
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'oa', type: 'openai', model: 'gpt-x', apiKey: 'sk-old-key-aaaaaaaaaaaaaaaa', capabilities: { tools: true } }] })
  await ai.update('root', { level: 'server', use: { chat: 'server:oa' } })
  await assert.rejects(registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'oa', type: 'openai', model: 'gpt-x', rotate: { graceHours: 1 } }] }), { status: 400 })
  const out = body(await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'oa', type: 'openai', model: 'gpt-x', apiKey: 'sk-new-key-bbbbbbbbbbbbbbbb', rotate: { graceHours: 1 } }], reason: 'rotate the OpenAI key' }))
  assert.equal(out.fingerprints.oa, keyFingerprint('sk-new-key-bbbbbbbbbbbbbbbb'))
  let chosen = await ai.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.deepEqual([chosen.connection.apiKey, chosen.connection.previousApiKey], ['sk-new-key-bbbbbbbbbbbbbbbb', 'sk-old-key-aaaaaaaaaaaaaaaa'])
  const listed = body(await registry.run(person('root'), 'ai.connections.list', {})).connections.find((c) => c.name === 'oa')
  assert.ok(listed.previousKeyUntil && listed.keyRotatedAt)
  tick(2 * 3600 * 1000)
  chosen = await ai.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.equal(chosen.connection.previousApiKey, undefined)
  assert.equal(await keyStore.clearExpiredGrace(new Date(now())), 1)
  assert.equal(keys.rows.find((d) => d.name === 'oa').previousCipher, null)
  // turned off: kept, but the request is refused with a plain message instead of going elsewhere
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'oa', type: 'openai', model: 'gpt-x', status: 'disabled' }] })
  chosen = await ai.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.match(chosen.error, /turned off by your administrator/)
  assert.equal(keys.rows.find((d) => d.name === 'oa').last4, 'bbbb')
})

test('the last test is kept on the connection with the key and query strings taken out, and shows as a warning', async () => {
  const key = 'sk-proj-abcdefghijklmnopqrstuvwx'
  const { registry, holder, aiControl } = world({ check: async () => ({ ok: false, message: `HTTP 401 from https://api.openai.com/v1/models?key=${key}: invalid key ${key}` }) })
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'oa', type: 'openai', model: 'gpt-x', apiKey: key }] })
  const tested = body(await registry.run(person('root'), 'ai.check', { level: 'server', name: 'oa' }))
  assert.ok(!tested.message.includes(key) && !tested.message.includes('?key='), tested.message)
  const listed = body(await registry.run(person('root'), 'ai.connections.list', {})).connections.find((c) => c.name === 'oa')
  assert.equal(listed.lastCheck.ok, false)
  assert.ok(!JSON.stringify(listed).includes(key))
  assert.match(listed.lastCheck.error, /HTTP 401 from https:\/\/api\.openai\.com\/v1\/models:? invalid key \[redacted\]/)
  await holder.refresh({ force: true })
  assert.ok(aiControl.warnings().some((w) => w.kind === 'connection' && w.id === 'oa'))
})

test('removing a connection a published binding uses is refused unless forced; its choices are cleared', async () => {
  const { registry, ai, collections, holder, auditRows } = world()
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'oa', type: 'openai', model: 'gpt-x', apiKey: 'sk-abcdefghijklmnopqrst', capabilities: { tools: true } }] })
  await registry.run(person('root'), 'ai.models.save', { models: [{ connection: 'server:oa', model: 'gpt-x', capabilities: { tools: true }, prices: { inputPerM: 1, outputPerM: 2 } }] })
  await ai.update('root', { level: 'server', use: { chat: 'server:oa' } })
  collections.bindings.docs.set('chat|server', { _id: 'chat|server', surface: 'chat', scope: { level: 'server' }, chain: [{ model: 'oa:gpt-x' }], status: 'published', version: 1 })
  await collections.state.findOneAndUpdate({ _id: STATE_ID }, { $inc: { generation: 1 } }, { upsert: true })
  await holder.refresh({ force: true })
  assert.deepEqual(bindingsUsing(holder.current(), ['oa']), ['chat|server'])
  await assert.rejects(registry.run(person('root'), 'ai.connections.remove', { names: ['oa'], reason: 'retire' }), (error) => error.status === 409 && error.details.bindings[0] === 'chat|server')
  const out = body(await registry.run(person('root'), 'ai.connections.remove', { names: ['oa'], force: ['chat|server'], reason: 'retire' }))
  assert.deepEqual(out, { removed: ['oa'], clearedChoices: ['chat'] })
  assert.equal((await ai.serverState()).use.chat, undefined)
  assert.equal(auditRows().find((r) => r.action === 'ai.connections.remove').reason, 'retire')
  // the binding now names a model of a connection that is gone: skipped with a health entry
  assert.ok(holder.current().health.some((h) => h.kind === 'model' && h.id === 'oa:gpt-x'))
})

test('a provider\'s address change removes its connections\' keys only after dropKeys; archive waits until nothing uses it', async () => {
  const { registry, keys } = world()
  await registry.run(person('root'), 'ai.providers.save', { provider: GEMINI })
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'm', apiKey: 'AIza-person-key-0123456789-9876' }] })
  const moved = { ...GEMINI, baseUrl: 'https://gemini-proxy.example/v1' }
  await assert.rejects(registry.run(person('root'), 'ai.providers.save', { provider: moved }), (error) => error.status === 409 && error.details.connections[0] === 'gem')
  assert.equal(keys.rows.find((d) => d.name === 'gem').last4, '9876')
  const out = body(await registry.run(person('root'), 'ai.providers.save', { provider: moved, dropKeys: true, reason: 'proxy' }))
  assert.deepEqual([out.droppedKeys, out.provider.version], [['gem'], 2])
  assert.deepEqual([keys.rows.find((d) => d.name === 'gem').cipher, keys.rows.find((d) => d.name === 'gem').last4], [null, ''])
  await assert.rejects(registry.run(person('root'), 'ai.providers.archive', { id: 'gemini', reason: 'gone' }), { status: 409 })
  await assert.rejects(registry.run(person('root'), 'ai.providers.archive', { id: 'openai', reason: 'gone' }), { status: 400 })
  await assert.rejects(registry.run(person('root'), 'ai.providers.save', { provider: { ...GEMINI, id: 'anthropic' } }), { status: 400 })
  await registry.run(person('root'), 'ai.connections.remove', { names: ['gem'], reason: 'gone' })
  assert.deepEqual(body(await registry.run(person('root'), 'ai.providers.archive', { id: 'gemini', reason: 'gone' })).status, 'archived')
  assert.equal(connectionType('gemini'), null)
})

// ---------- models and prices ----------
test('models: checked rows, ids by connection, DB prices win, an unpriced model is charged at the dearest row and flagged', async () => {
  const { registry, holder, aiControl } = world()
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'oa', type: 'openai', model: 'gpt-x', apiKey: 'sk-abcdefghijklmnopqrst' }] })
  assert.equal(modelId('builtin:deepinfra', 'Qwen/Q'), 'builtin:deepinfra:Qwen/Q')
  for (const bad of [
    { connection: 'server:nope', model: 'm' }, { connection: 'builtin:mystery', model: 'm' },
    { connection: 'server:oa', model: 'm', prices: { inputPerM: 5000, outputPerM: 1 } }, { connection: 'server:oa', model: 'm', prices: { inputPerM: 1 } },
    { connection: 'server:oa', model: 'm', capabilities: { telepathy: true } },
  ]) {
    await assert.rejects(registry.run(person('root'), 'ai.models.save', { models: [bad] }), { status: 400 }, JSON.stringify(bad))
  }
  await registry.run(person('root'), 'ai.models.save', { models: [
    { connection: 'server:oa', model: 'brand-new-model', capabilities: { tools: true } },
    { connection: 'builtin:deepinfra', model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', prices: { inputPerM: 0.2, outputPerM: 0.8 } },
  ] })
  // the unpriced model: charged at the dearest row, and an amber warning says so
  const dearest = AI_PRICES.reduce((a, b) => (b.inPerMillion + b.outPerMillion > a.inPerMillion + a.outPerMillion ? b : a))
  assert.equal(aiPrice('brand-new-model').model, dearest.model)
  assert.equal(isPriced('brand-new-model'), false)
  assert.deepEqual(aiControl.warnings().map((w) => [w.kind, w.id]), [['unpriced', 'oa:brand-new-model']])
  assert.deepEqual(warningsOf(holder.current(), { isPriced: () => true }), [])
  // the DB price beats the table's row for the built-in model
  assert.deepEqual(aiCostMicros({ model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', usage: { inputTokens: 1000, outputTokens: 1000 } }), { costMicros: 1000, source: 'db', priceModel: 'Qwen/Qwen3-235B-A22B-Instruct-2507' })
  // two connections serving one model with different prices: the dearer is charged
  await registry.run(person('root'), 'ai.models.save', { models: [{ connection: 'server:oa', model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', prices: { inputPerM: 0.4, outputPerM: 1.2 } }] })
  assert.equal(dbPriceFor(holder.current(), 'Qwen/Qwen3-235B-A22B-Instruct-2507').id, 'oa:Qwen/Qwen3-235B-A22B-Instruct-2507')
  // disabled: its price no longer counts
  await registry.run(person('root'), 'ai.models.save', { models: [{ connection: 'server:oa', model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', prices: { inputPerM: 0.4, outputPerM: 1.2 }, status: 'disabled' }] })
  assert.equal(dbPriceFor(holder.current(), 'Qwen/Qwen3-235B-A22B-Instruct-2507').id, 'builtin:deepinfra:Qwen/Qwen3-235B-A22B-Instruct-2507')
  assert.equal(holder.current().models['oa:Qwen/Qwen3-235B-A22B-Instruct-2507'].version, 2)
})

test('find models: the connection\'s own /models through the guarded fetch, writing nothing', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/v1/models' && request.headers.authorization === 'Bearer sk-local-abcdefghijklmnop') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'gemini-3.5-flash', owned_by: 'google' }, { id: 'line\nbreak' }, { id: 'gemini-3.8-flash' }] }))
      return
    }
    response.writeHead(401).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { registry, collections } = world({ settings: { public: { env: 'selfhost' }, ai: { connections: { local: { type: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'x', apiKeyEnv: 'LOCAL_KEY' } } } }, env: { LOCAL_KEY: 'sk-local-abcdefghijklmnop' } })
    const found = body(await registry.run(person('root'), 'ai.models.discover', { connection: 'local' }))
    assert.deepEqual([found.ok, found.models], [true, [{ id: 'gemini-3.5-flash', ownedBy: 'google' }, { id: 'gemini-3.8-flash' }]])
    assert.equal(collections.models.docs.size, 0)
    await assert.rejects(registry.run(person('ana'), 'ai.models.discover', { connection: 'local' }), { status: 403 })
    assert.ok(body(await registry.run(agent('root', ['ai:admin:read']), 'ai.models.discover', { connection: 'local' })).ok)
  } finally {
    server.close()
  }
})

test('a provider that redirects is refused on every connection fetch: the key never reaches the other host', async () => {
  const hits = []
  const other = http.createServer((request, response) => { hits.push(request.headers.authorization ?? null); response.writeHead(200).end('{}') })
  await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve))
  const main = http.createServer((_request, response) => { response.writeHead(302, { location: `http://127.0.0.1:${other.address().port}/v1/models` }).end() })
  await new Promise((resolve) => main.listen(0, '127.0.0.1', resolve))
  try {
    const rules = endpointRules({ hosted: false, level: 'file' })
    const connection = { type: 'openai-compatible', baseUrl: `http://127.0.0.1:${main.address().port}/v1`, model: 'm', apiKey: 'sk-redirect-abcdefghijklmn' }
    const fetcher = (url, init) => connectionFetch(String(url), rules)(url, init)
    const checked = await checkConnection(connection, { fetch: fetcher, timeoutMs: 5000 })
    const listed = await listModels(connection, { fetch: fetcher, timeoutMs: 5000 })
    assert.equal(checked.ok, false)
    assert.equal(listed.ok, false)
    assert.deepEqual(hits, [])
  } finally {
    main.close()
    other.close()
  }
})

// ---------- the services beside the models ----------
test('picture search, icons, transcription and Stability keys: sealed, read at once, never model choices', async () => {
  const { registry, ai, keys } = world()
  await assert.rejects(registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'search', type: 'google-cse', apiKey: 'AIza-search-key-0000000000000' }] }), /search engine id/i)
  await assert.rejects(registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'icons', type: 'nounproject', apiKey: 'just-a-key' }] }), /key:secret/)
  await assert.rejects(registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'search', type: 'google-cse', model: 'cx1', baseUrl: 'https://evil.example', apiKey: 'k' }] }), /own address/)
  await registry.run(person('root'), 'ai.connections.save', { connections: [
    { name: 'search', type: 'google-cse', model: 'cx-engine-1', apiKey: 'AIza-search-key-1111111111111' },
    { name: 'icons', type: 'nounproject', apiKey: 'nounkey:nounsecret' },
    { name: 'voice', type: 'deepgram', apiKey: 'dg-0000000000000000' },
  ] })
  assert.deepEqual(await ai.auxCredential('google-cse'), { name: 'search', apiKey: 'AIza-search-key-1111111111111', model: 'cx-engine-1', baseUrl: 'https://customsearch.googleapis.com' })
  assert.equal((await ai.auxCredential('nounproject')).apiKey, 'nounkey:nounsecret')
  assert.equal(await ai.hasAuxKey('deepgram'), true)
  assert.equal(await ai.auxCredential('stability'), null)
  assert.equal(await ai.auxCredential('openai'), null)
  // rotated in the page: the next search uses the new key, no restart
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'search', type: 'google-cse', model: 'cx-engine-1', apiKey: 'AIza-search-key-2222222222222' }], reason: 'rotate search key' })
  assert.equal((await ai.auxCredential('google-cse')).apiKey, 'AIza-search-key-2222222222222')
  // not a model choice, and not a person's
  assert.ok(!(await ai.view('root')).server.connections.some((c) => c.name === 'search'))
  await assert.rejects(ai.update('root', { level: 'server', use: { images: 'server:search' } }), /no connection server:search/)
  await assert.rejects(ai.update('ana', { level: 'me', connections: [{ name: 'mine', type: 'deepgram', apiKey: 'dg-1' }] }), /only an administrator/)
  // tested by its own probe; listed with its fingerprint, never its key
  assert.match(body(await registry.run(person('root'), 'ai.check', { level: 'server', name: 'voice' })).message, /aux deepgram ok/)
  const listed = body(await registry.run(person('root'), 'ai.connections.list', {}))
  assert.deepEqual(listed.connections.filter((c) => c.aux).map((c) => c.name).sort(), ['icons', 'search', 'voice'])
  assert.ok(!JSON.stringify(listed).includes('nounsecret') && !JSON.stringify(listed).includes('AIza-search'))
  assert.ok(!JSON.stringify(keys.rows).includes('nounsecret'))
  // turned off: the settings file applies again
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'voice', type: 'deepgram', status: 'disabled' }] })
  assert.equal(await ai.auxCredential('deepgram'), null)
})

test('the services\' probes: one request each, to their own address, no redirects, the key never in the answer', async () => {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url, init })
    if (url.includes('deepgram')) return new Response(JSON.stringify({ err_msg: 'Invalid credentials dg-secret-0123456789' }), { status: 401 })
    if (url.includes('customsearch')) return new Response(JSON.stringify({ error: { message: `Bad request for key AIza-secret-0000000000000000000` } }), { status: 400 })
    return new Response('{"projects":[]}', { status: 200 })
  }
  const dg = await checkAuxConnection({ type: 'deepgram', baseUrl: 'https://api.deepgram.com', apiKey: 'dg-secret-0123456789' }, { fetch: fetcher })
  assert.deepEqual([dg.ok, dg.message], [false, 'The service did not accept the key.'])
  assert.equal(calls[0].init.headers.Authorization, 'Token dg-secret-0123456789')
  assert.equal(calls[0].init.redirect, 'error')
  const cse = await checkAuxConnection({ type: 'google-cse', baseUrl: 'https://customsearch.googleapis.com', model: 'cx1', apiKey: 'AIza-secret-0000000000000000000' }, { fetch: fetcher })
  assert.equal(cse.ok, false)
  assert.ok(!cse.message.includes('AIza-secret'), cse.message)
  const st = await checkAuxConnection({ type: 'stability', baseUrl: 'https://api.stability.ai', apiKey: 'sk-stab' }, { fetch: fetcher })
  assert.deepEqual([st.ok, calls[2].url], [true, 'https://api.stability.ai/v1/user/account'])
  const np = await checkAuxConnection({ type: 'nounproject', baseUrl: 'https://api.thenounproject.com', apiKey: 'ck:cs' }, { fetch: fetcher })
  assert.equal(np.ok, true)
  assert.match(calls[3].init.headers.Authorization, /^OAuth oauth_consumer_key="ck", oauth_nonce="[0-9a-f]{32}", oauth_signature_method="HMAC-SHA1", oauth_timestamp="\d+", oauth_version="1.0", oauth_signature="[^"]+"$/)
  // the signature is deterministic for a given nonce and time, and covers the query
  const sign = (url) => oauth1Header({ url, key: 'ck', secret: 'cs', nonce: 'n', timestamp: 1 })
  assert.equal(sign('https://api.thenounproject.com/v2/icon?query=cat'), sign('https://api.thenounproject.com/v2/icon?query=cat'))
  assert.notEqual(sign('https://api.thenounproject.com/v2/icon?query=cat'), sign('https://api.thenounproject.com/v2/icon?query=dog'))
})

// ---------- surfaces and limits ----------
test('the new actions are admin-toolset exec methods; the exec description and typed tools match the generated file', () => {
  const registry = createAppRegistry()
  const manifest = buildClientManifest(registry)
  const tools = renderExecTool(manifest)
  const generated = JSON.parse(readFileSync(new URL('../web/app/server/actions/generated/exec-tool.json', import.meta.url), 'utf8'))
  for (const id of ['ai.providers.save', 'ai.connections.list', 'ai.connections.save', 'ai.models.save', 'ai.models.discover']) {
    const method = manifest.methods.find((m) => m.name === id)
    assert.equal(method?.toolset, 'admin', id)
    assert.ok(!tools.typed.some((t) => t.method === id), id)
  }
  assert.equal(tools.exec.description, generated.exec.description)
  assert.ok(tools.exec.description.length <= 3500)
  assert.equal(JSON.stringify(tools.typed), JSON.stringify(generated.typed))
  // ai.update and ai.check take any provider id now (checked against the providers in use)
  assert.equal(registry.get('ai.update').input.properties.connections.items.properties.type.enum, undefined)
  // the keys in these actions are secrets in a run's record
  assert.equal(registry.get('ai.connections.save').input.properties.connections.items.properties.apiKey.writeOnly, true)
})

test('AI control writes are limited per administrator', async () => {
  const { registry, deps } = world()
  deps.aiControlWriteLimit = createWriteLimit({ count: 2, windowMs: 60_000 })
  await registry.run(person('root'), 'ai.models.save', { models: [{ connection: 'builtin:deepinfra', model: 'a' }] })
  await registry.run(person('root'), 'ai.models.save', { models: [{ connection: 'builtin:deepinfra', model: 'b' }] })
  await assert.rejects(registry.run(person('root'), 'ai.models.save', { models: [{ connection: 'builtin:deepinfra', model: 'c' }] }), { status: 429 })
})

// ---------- the page's words ----------
test('the Providers and Models tabs say which key, never the key, and flag unpriced models', async () => {
  const { keyText, lastCheckText, checkResultText, priceText, parseHeaders, numberOrNull, unpricedIds } = await import('../web/app/imports/ui/pages/admin/ai/catalog-view.mjs')
  assert.equal(keyText({ hasKey: true, keyRef: { kind: 'sealed' }, keyFingerprint: 'sha256:abcd1234…a91f', keyRotatedAt: '2026-11-03T12:00:00Z' }), 'A key is saved (…a91f, added 3 Nov)')
  assert.equal(keyText({ hasKey: false, keyRef: { kind: 'none' } }), 'No key saved')
  assert.equal(keyText({ hasKey: true, keyRef: { kind: 'env', name: 'SLATEBOX_AI_KEY_GEMINI' } }), 'Key read from SLATEBOX_AI_KEY_GEMINI')
  assert.match(keyText({ hasKey: false, keyRef: { kind: 'env', name: 'SLATEBOX_AI_KEY_GEMINI' } }), /not set on this server/)
  assert.equal(keyText({ hasKey: true, keyRef: { kind: 'file' } }), 'Key in the settings file')
  assert.equal(lastCheckText({ lastCheck: { ok: true, latencyMs: 820, at: '2026-11-24T10:00:00Z' } }), 'Worked in 820 ms on 24 Nov')
  assert.equal(lastCheckText({}), 'Not tested yet')
  assert.equal(checkResultText({ ok: true, latencyMs: 820, tools: 'yes' }, { capabilities: { tools: true } }), 'Answered in 820 ms, tools work, pictures: not claimed')
  assert.equal(priceText({ prices: { inputPerM: 0.5, outputPerM: 3 } }), '$0.5 in · $3 out per million')
  assert.equal(priceText({ prices: null }), 'Unpriced')
  assert.deepEqual(parseHeaders('x-client: slatebox\n\n x-b : 2 '), { 'x-client': 'slatebox', 'x-b': '2' })
  assert.throws(() => parseHeaders('nonsense'), /name: value/)
  assert.deepEqual([numberOrNull(''), numberOrNull('12'), Number.isNaN(numberOrNull('x'))], [null, 12, true])
  assert.deepEqual([...unpricedIds([{ kind: 'unpriced', id: 'a' }, { kind: 'connection', id: 'b' }])], ['a'])
})

// ---------- review fixes (2026-11-24) ----------
test('an agent cannot change a provider\'s key style, headers, address or lock by leaving them out; a save keeps what it omits', async () => {
  const { registry, collections, auditRows } = world()
  await registry.run(person('root'), 'ai.providers.save', { provider: GEMINI })
  const bot = agent('root')
  // leaving out auth, extraHeaders and baseUrl keeps them (a relabel, which an agent may make)
  await registry.run(bot, 'ai.providers.save', { provider: { id: 'gemini', label: 'Gemini', protocol: 'openai-chat' } })
  const stored = await collections.providers.findOne({ _id: 'gemini' })
  assert.deepEqual([stored.label, stored.auth, stored.extraHeaders, stored.baseUrl, stored.baseUrlLocked], ['Gemini', GEMINI.auth, GEMINI.extraHeaders, GEMINI.baseUrl, true])
  // naming them differently is still refused, and so is unlocking the address
  await assert.rejects(registry.run(bot, 'ai.providers.save', { provider: { id: 'gemini', label: 'G', protocol: 'openai-chat', auth: { style: 'bearer' } } }), /auth/)
  await assert.rejects(registry.run(bot, 'ai.providers.save', { provider: { id: 'gemini', label: 'G', protocol: 'openai-chat', extraHeaders: {} } }), /headers/)
  await assert.rejects(registry.run(bot, 'ai.providers.save', { provider: { id: 'gemini', label: 'G', protocol: 'openai-chat', baseUrl: null } }), /baseUrl/)
  await assert.rejects(registry.run(bot, 'ai.providers.save', { provider: { id: 'gemini', label: 'G', protocol: 'openai-chat', baseUrlLocked: false } }), /baseUrlLocked/)
  assert.equal(auditRows().filter((r) => r.action === 'ai.providers.save' && r.outcome === 'refused').length, 4)
  // a person clears a field by sending it empty
  await registry.run(person('root'), 'ai.providers.save', { provider: { id: 'gemini', label: 'Gemini', protocol: 'openai-chat', extraHeaders: {} } })
  assert.deepEqual((await collections.providers.findOne({ _id: 'gemini' })).extraHeaders, {})
})

test('a connection a person turned off is turned back on by a person, not an agent', async () => {
  const { registry, keys } = world()
  await registry.run(person('root'), 'ai.providers.save', { provider: GEMINI })
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'm1', apiKey: 'AIza-person-key-0123456789-1234', status: 'disabled' }] })
  await assert.rejects(registry.run(agent('root'), 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'm1', status: 'active' }] }), /turn a connection back on/)
  const gem = () => keys.rows.find((d) => d.name === 'gem')
  assert.equal(gem().status, 'disabled')
  // an agent's other changes leave it off
  await registry.run(agent('root'), 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'm2' }] })
  assert.deepEqual([gem().model, gem().status], ['m2', 'disabled'])
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'gem', type: 'gemini', model: 'm2', status: 'active' }] })
  assert.equal(gem().status, 'active')
})

test('ai.update and ai.check at the server level keep the person-only rule for a token: keys, addresses, choices and removals', async () => {
  const { registry, keys, auditRows } = world()
  const bot = agent('root')
  const refused = [
    [{ level: 'server', connections: [{ name: 'x', type: 'openai-compatible', baseUrl: 'https://attacker.example/v1', model: 'm', apiKey: 'k-0123456789' }] }, /send a key/],
    [{ level: 'server', connections: [{ name: 'x', type: 'openai-compatible', baseUrl: 'https://attacker.example/v1', model: 'm' }] }, /address can be chosen/],
    [{ level: 'server', use: { default: 'builtin' } }, /Only a person can choose/],
    [{ level: 'server', remove: ['x'] }, /remove the server's connections/],
  ]
  for (const [input, why] of refused) {
    await assert.rejects(registry.run(bot, 'ai.update', input), (error) => error.status === 403 && error.details?.personOnly && why.test(error.message), JSON.stringify(input))
  }
  assert.equal(keys.rows.length, 0)
  assert.equal(auditRows().filter((r) => r.action === 'ai.update' && r.outcome === 'refused').length, refused.length)
  assert.ok(!JSON.stringify(auditRows()).includes('k-0123456789'))
  // what a token may still do at the server level: change the model of a connection a person keyed
  await registry.run(person('root'), 'ai.update', { level: 'server', connections: [{ name: 'oa', type: 'openai', model: 'gpt-x', apiKey: 'sk-abcdefghijklmnopqrst' }] })
  await registry.run(bot, 'ai.update', { level: 'server', connections: [{ name: 'oa', type: 'openai', model: 'gpt-y' }] })
  assert.deepEqual([keys.rows.find((d) => d.name === 'oa').model, keys.rows.find((d) => d.name === 'oa').last4], ['gpt-y', 'qrst'])
  // a person may do all of it
  await registry.run(person('root'), 'ai.update', { level: 'server', connections: [{ name: 'x', type: 'openai-compatible', baseUrl: 'https://own.example/v1', model: 'm', apiKey: 'k-0123456789' }], use: { default: 'server:x' } })
  // ai.check: a token cannot test an address of its choosing (a private one, say), only a saved connection by name
  await assert.rejects(registry.run(bot, 'ai.check', { level: 'server', connection: { name: 'probe', type: 'openai-compatible', baseUrl: 'http://10.0.0.5:8080/v1', model: 'm' } }), (error) => error.status === 403 && /Test a saved connection by its name/.test(error.message))
  assert.equal(body(await registry.run(bot, 'ai.check', { level: 'server', name: 'x' })).ok, true)
  assert.equal(body(await registry.run(person('root'), 'ai.check', { level: 'server', connection: { name: 'probe', type: 'openai-compatible', baseUrl: 'http://10.0.0.5:8080/v1', model: 'm' } })).ok, true)
})

test('an administrator\'s price applies to the connection that served the call; the built-in AI\'s price is never lowered', async () => {
  const { registry, holder } = world()
  // production wiring (ai-control/index.mjs): the price source is told which connection served the call
  setDbPriceSource((model, where) => dbPriceFor(holder.current(), model, where))
  try {
    await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'oa', type: 'openai', model: 'gpt-x', apiKey: 'sk-abcdefghijklmnopqrst' }] })
    const QWEN = 'Qwen/Qwen3-235B-A22B-Instruct-2507'
    const table = AI_PRICES.find((row) => row.model === QWEN)
    assert.ok(table, 'the table prices the built-in model')
    await registry.run(person('root'), 'ai.models.save', { models: [
      { connection: 'server:oa', model: QWEN, prices: { inputPerM: 0, outputPerM: 0 } },
      { connection: 'builtin:deepinfra', model: QWEN, prices: { inputPerM: 0, outputPerM: 0 } },
    ] })
    const usage = { inputTokens: 1_000_000, outputTokens: 0 }
    // through the administrator's own connection: their price (free)
    assert.equal(aiCostMicros({ model: QWEN, usage, connection: 'server:oa', provider: 'openai' }).costMicros, 0)
    // through the built-in AI: the table's, whatever was saved for it
    assert.equal(aiCostMicros({ model: QWEN, usage, connection: 'builtin', provider: 'deepinfra' }).costMicros, Math.ceil(table.inPerMillion * 1e6))
    // through another connection with no row of its own: the table's
    assert.equal(aiCostMicros({ model: QWEN, usage, connection: 'server:other', provider: 'openai' }).costMicros, Math.ceil(table.inPerMillion * 1e6))
    // a built-in price above the table's does apply
    await registry.run(person('root'), 'ai.models.save', { models: [{ connection: 'builtin:deepinfra', model: QWEN, prices: { inputPerM: table.inPerMillion * 2, outputPerM: table.outPerMillion * 2 } }] })
    assert.equal(aiCostMicros({ model: QWEN, usage, connection: 'builtin', provider: 'deepinfra' }).costMicros, Math.ceil(table.inPerMillion * 2 * 1e6))
  } finally {
    setDbPriceSource((model) => dbPriceFor(holder.current(), model))
  }
})

test('with the DB layer switched off, the services\' keys saved in the app are not used (the settings file\'s are)', async () => {
  const { registry, ai } = world()
  await registry.run(person('root'), 'ai.connections.save', { connections: [{ name: 'voice', type: 'deepgram', apiKey: 'dg-0000000000000000' }] })
  assert.equal(await ai.hasAuxKey('deepgram'), true)
  let on = false
  ai.setAuxKeysOn(() => on)
  assert.equal(await ai.auxCredential('deepgram'), null)
  assert.equal(await ai.hasAuxKey('deepgram'), false)
  on = true
  assert.equal((await ai.auxCredential('deepgram')).name, 'voice')
})
