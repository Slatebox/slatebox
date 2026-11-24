// AI control S4: bindings (spec 1.4, 2.1-2.4, 3.4, 4, 5.6). Which model chain, parameters, tools,
// limits and on/off each part of Slatebox uses, versioned:
//   - publish is checked against what exists now; plan, team and person scopes wait for S11;
//   - versions only move forward: a rollback publishes an earlier version as a new number, and is
//     refused with the reason when what it names is gone;
//   - limits only tighten (resolver and meter); a surface turned off answers with the admin's
//     message, the global switch with its own;
//   - the request path follows a published chain by failure class (scripts/ai-req-chain.mjs runs
//     the real req.js), and a primary that keeps failing trips this pod's breaker;
//   - agent.slatebox bound on its own while Ask Slatebox keeps the chat model;
//   - ai-control-001 moves the server's AI choices to bindings without changing any answer, and
//     ai.update keeps both in step;
//   - only a person publishes, rolls back or flips the global switch; an agent saves drafts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { SURFACES } from '../web/app/server/ai-control/catalogue.mjs'
import { primaryOf, resolveBinding } from '../web/app/server/ai-control/resolve.mjs'
import { createSnapshotHolder } from '../web/app/server/ai-control/snapshot.mjs'
import { COLLECTIONS, STATE_ID, createControlStore } from '../web/app/server/ai-control/store.mjs'
import { createAIControl } from '../web/app/server/ai-control/facade.mjs'
import { createAdminOps, surfacesStatus } from '../web/app/server/ai-control/admin.mjs'
import { BINDABLE_SURFACES, createBindingOps, limitsFor, normalizeBinding } from '../web/app/server/ai-control/bindings.mjs'
import { applyBreaker, createBreaker } from '../web/app/server/ai-control/breaker.mjs'
import { createWriteLimit } from '../web/app/server/ai-control/models.mjs'
import { AI_CONTROL_001, runAIControl001 } from '../web/app/server/migrations/ai-control-001.mjs'
import { createAISettings } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { codeFallbackOn, keepsFallbackAfterShapeExhaustion } from '../web/app/server/methods/ai/provider.mjs'
import { actionCeilingMicros, actionEstimateMicros, setLimitSource } from '../web/app/server/metering/prices.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'

// ---------- in-memory world ----------
const get = (doc, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc)
function memoryCollection() {
  const docs = new Map()
  const matches = (doc, query) => Object.entries(query).every(([path, want]) => get(doc, path) === want)
  return {
    docs,
    find: (query = {}) => ({ toArray: async () => [...docs.values()].filter((doc) => matches(doc, query)).map((doc) => structuredClone(doc)) }),
    async findOne(query) { const doc = docs.get(query._id); return doc ? structuredClone(doc) : null },
    async replaceOne(query, doc) { docs.set(query._id, structuredClone(doc)); return { matchedCount: 1 } },
    async deleteOne(query) { return { deletedCount: docs.delete(query._id) ? 1 : 0 } },
    async insertOne(doc) {
      if (docs.has(doc._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
      docs.set(doc._id, structuredClone(doc))
      return { insertedId: doc._id }
    },
    async updateOne(query, update) {
      const doc = docs.get(query._id)
      if (doc) Object.assign(doc, structuredClone(update.$set || {}))
      return { matchedCount: doc ? 1 : 0 }
    },
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
function memoryKeys() {
  const keys = []
  const uses = new Map()
  const match = (owner) => (doc) => doc.ownerType === owner.type && doc.ownerId === owner.id
  return {
    keys,
    async listConnections(owner) { return keys.filter(match(owner)).map((doc) => ({ ...doc })) },
    async saveConnection(owner, doc) {
      const i = keys.findIndex((k) => match(owner)(k) && k.name === doc.name)
      if (i >= 0) keys[i] = { ...doc, ownerType: owner.type, ownerId: owner.id }
      else keys.push({ ...doc, ownerType: owner.type, ownerId: owner.id })
    },
    async removeConnection(owner, name) {
      const i = keys.findIndex((k) => match(owner)(k) && k.name === name)
      if (i >= 0) keys.splice(i, 1)
    },
    async getUse(owner) { return structuredClone(uses.get(`${owner.type}:${owner.id}`) ?? null) },
    async setUse(owner, value) { uses.set(`${owner.type}:${owner.id}`, structuredClone(value)) },
  }
}

const PEOPLE = { root: { _id: 'root' }, ana: { _id: 'ana', orgId: 'team1' } }
const SELFHOST = { public: { env: 'selfhost' } }
const CONNECTIONS = [
  { name: 'chatbox', type: 'openai-compatible', baseUrl: 'https://chat.example.com/v1', model: 'chat-1' },
  { name: 'agentbox', type: 'openai-compatible', baseUrl: 'https://agent.example.com/v1', model: 'agent-9' },
  { name: 'blind', type: 'openai-compatible', baseUrl: 'https://blind.example.com/v1', model: 'b-1', capabilities: { vision: false, tools: true } },
]

function world({ settings = SELFHOST, hosted = false } = {}) {
  const collections = Object.fromEntries(Object.keys(COLLECTIONS).map((key) => [key, memoryCollection()]))
  const keyStore = memoryKeys()
  let id = 0
  let clock = Date.parse('2026-11-24T10:00:00Z')
  const holder = createSnapshotHolder({
    read: {
      generation: async () => (await collections.state.findOne({ _id: STATE_ID }))?.generation ?? 0,
      all: async () => ({
        state: await collections.state.findOne({ _id: STATE_ID }),
        providers: [],
        connections: keyStore.keys.filter((d) => d.ownerType === 'server' && d.name).map((doc) => ({ ...doc, hasKey: Boolean(doc.last4) })),
        models: [...collections.models.docs.values()], bindings: [...collections.bindings.docs.values()], prompts: [], promptVersions: [], agents: [],
      }),
    },
    settings,
    fileConnections: () => Object.keys(settings?.ai?.connections || {}),
    log: { warn() {} },
  })
  const store = createControlStore({ collections, newId: () => `row${String(++id).padStart(4, '0')}`, now: () => new Date(clock), onWrite: () => holder.refresh({ force: true }) })
  const ai = createAISettings({
    store: keyStore,
    // a key made for this test run only, never the server's key-encryption key
    master: loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }),
    settings, hosted, now: () => clock,
    loadUser: async (userId) => PEOPLE[userId] || null,
    isAdmin: async (userId) => userId === 'root',
    isTeamAdmin: async (user) => user?._id === 'ana',
    check: async () => ({ ok: true, message: 'ok' }),
    audit: (entry) => store.record(entry),
  })
  const breaker = createBreaker({ now: () => clock, log: { warn() {} } })
  const ops = createBindingOps({
    store, bindings: collections.bindings, versions: collections.bindingVersions, snapshot: () => holder.current(),
    connections: async () => (await ai.serverState()).connections.map((c) => ({ name: c.name, status: c.disabled ? 'disabled' : 'active', capabilities: c.capabilities || {} })),
    breaker, now: () => new Date(clock),
  })
  // the same wiring as ai-control/index.mjs
  ai.setBindingSource(async ({ surface, userId, orgId, holders }) => {
    const snapshot = await holder.ready()
    return applyBreaker(resolveBinding(snapshot, { surface, userId, orgId, holders, settings }), breaker)
  })
  ai.setServerUseSync(({ changes, actor, reason }) => ops.syncServerUse({ actor, changes, reason }))
  const adminOps = createAdminOps({ store, audit: { find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }, aiSettings: ai, bindings: ops })
  const aiControl = createAIControl({ holder, choiceHolders: (userId) => ai.choiceHolders(userId), settings, extraHealth: () => breaker.health() })
  const deps = { ai, aiControl, aiControlAdmin: async (userId) => userId === 'root', aiControlStore: store, aiControlOps: adminOps, aiBindings: ops, aiControlWriteLimit: createWriteLimit({ now: () => clock }) }
  const registry = createAppRegistry({ deps })
  const auditRows = () => [...collections.audit.docs.values()]
  return { collections, keyStore, store, holder, ai, ops, breaker, adminOps, aiControl, registry, auditRows, settings, tick: (ms) => { clock += ms } }
}

const person = (userId) => ({ kind: 'person', userId, tokenId: null, tokenName: null, scopes: ['ai:admin', 'ai:settings'] })
const agent = (userId, scopes = ['ai:admin', 'ai:settings']) => ({ kind: 'agent', userId, tokenId: `t-${userId}`, tokenName: 'Agent', scopes })
const ACTOR = { userId: 'root', principal: 'person', via: 'ddp' }
const body = (result) => {
  const { mode: _mode, ...rest } = result.body ?? result
  return rest
}
async function withConnections(w) {
  await w.ai.update('root', { level: 'server', connections: CONNECTIONS })
  await w.holder.refresh({ force: true })
}
const route = (w, feature, userId = null) => w.ai.resolveFor({ userId, feature, request: { tools: true } })

// ---------- the code default for fallbacks ----------
test('the shape-fallback rule is a code default `on` list: infra and shape for drafting and vision, infra elsewhere', async () => {
  assert.deepEqual(codeFallbackOn('generation'), ['infra', 'shape'])
  assert.deepEqual(codeFallbackOn('vision'), ['infra', 'shape'])
  assert.deepEqual(codeFallbackOn('welcome'), ['infra'])
  assert.deepEqual(codeFallbackOn('anything-new'), ['infra'])
  // the old rule, unchanged
  for (const feature of ['generation', 'vision']) assert.equal(keepsFallbackAfterShapeExhaustion(feature), true)
  for (const feature of ['welcome', 'welcome-route', 'shape', 'presentation', 'workshop', undefined]) assert.equal(keepsFallbackAfterShapeExhaustion(feature), false)
})

// ---------- publish validation ----------
test('publish is checked against what exists now: models, connections, capabilities, scopes, limits, tools', async () => {
  const w = world()
  await withConnections(w)
  const publish = (input) => w.ops.publish({ actor: ACTOR, input, reason: 'test' })
  await assert.rejects(publish({ surface: 'shape', chain: [{ model: 'chatbox:nope' }] }), /model chatbox:nope does not exist/)
  await assert.rejects(publish({ surface: 'shape', chain: [{ connection: 'server:ghost' }] }), /connection server:ghost does not exist/)
  await assert.rejects(publish({ surface: 'vision', chain: [{ connection: 'server:blind' }] }), /cannot do vision, which vision needs/)
  await assert.rejects(publish({ surface: 'shape', scope: { level: 'team', id: 'team1' } }), /not in this build yet/)
  // library has landed (release/library2): it is bound like every other surface
  assert.equal((await publish({ surface: 'library', chain: [{ connection: 'server:chatbox' }] })).binding.surface, 'library')
  await assert.rejects(publish({ surface: 'generation.notes' }), /not a part of Slatebox that can be bound/)
  await assert.rejects(publish({ surface: 'admin.test' }), /not a part of Slatebox that can be bound/)
  await assert.rejects(publish({ surface: 'shape', limits: { ceiling: 60001 } }), /can only lower the built-in 60000/)
  await assert.rejects(publish({ surface: 'shape', tools: { mode: 'none' } }), /needs tools/)
  await assert.rejects(publish({ surface: 'shape', params: { temperature: 3 } }), /from 0 to 2/)
  await assert.rejects(publish({ surface: 'shape', params: { topP: 1 } }), /not a parameter/)
  await assert.rejects(publish({ surface: 'shape', chain: [{ connection: 'server:chatbox' }, { connection: 'builtin', on: ['sometimes'] }] }), /on is a list of infra, shape, context, any/)
  await assert.rejects(publish({ surface: 'shape', chain: Array.from({ length: 6 }, (_v, i) => ({ connection: i ? 'builtin' : 'server:chatbox' })) }), /at most 5/)
  await assert.rejects(publish({ surface: 'shape', chain: [{ connection: 'server:chatbox' }, { connection: 'server:chatbox' }] }), /already in the chain/)
  await assert.rejects(w.ops.publish({ actor: ACTOR, input: { surface: 'shape' }, reason: ' ' }), /needs a reason/)
  // a connection turned off cannot be published
  await w.ai.saveServerConnections('root', [{ name: 'agentbox', type: 'openai-compatible', baseUrl: 'https://agent.example.com/v1', model: 'agent-9', status: 'disabled' }])
  await assert.rejects(publish({ surface: 'shape', chain: [{ connection: 'server:agentbox' }] }), /turned off/)
  // a good one: the fallback's `on` defaults to infra; the primary's is not stored
  const ok = await publish({ surface: 'shape', chain: [{ connection: 'server:chatbox', on: ['shape'] }, { connection: 'builtin' }], params: { timeoutMs: 20000 }, limits: { ceiling: 30000 } })
  assert.equal(ok.version, 1)
  assert.deepEqual(ok.binding.chain, [{ connection: 'server:chatbox' }, { connection: 'builtin', on: ['infra'] }])
  // the snapshot takes it as it was published
  assert.deepEqual(w.holder.current().health, [])
  assert.equal(w.holder.current().bindings['shape|server'].version, 1)
})

// ---------- versions ----------
test('versions only move forward: drafts, publish, rollback as a new number; statuses and the audit trail follow', async () => {
  const w = world()
  await withConnections(w)
  const v1 = await w.ops.publish({ actor: ACTOR, input: { surface: 'agent.slatebox', chain: [{ connection: 'server:agentbox' }] }, reason: 'agent on its own model' })
  const draft = await w.ops.saveDraft({ actor: ACTOR, input: { surface: 'agent.slatebox', chain: [{ connection: 'server:chatbox' }], params: { maxTokens: 2000 } }, note: 'try chat model' })
  assert.deepEqual([v1.version, draft.version, draft.status], [1, 2, 'draft'])
  // a draft changes nothing live
  assert.equal((await route(w, 'agent')).ref, 'server:agentbox')
  const v2 = await w.ops.publish({ actor: ACTOR, surface: 'agent.slatebox', version: 2, reason: 'chat model is better' })
  assert.equal(v2.version, 2)
  assert.equal((await route(w, 'agent')).ref, 'server:chatbox')
  const back = await w.ops.rollback({ actor: ACTOR, surface: 'agent.slatebox', toVersion: 1, reason: 'chat model too slow' })
  assert.equal(back.version, 3)
  assert.equal((await route(w, 'agent')).ref, 'server:agentbox')
  const versions = await w.ops.versionsOf('agent.slatebox|server')
  assert.deepEqual(versions.map((v) => [v.version, v.status, v.rollbackOf ?? null]), [[3, 'published', 1], [2, 'superseded', null], [1, 'superseded', null]])
  assert.equal(versions[0].note, 'Rollback to version 1')
  const head = w.holder.current().bindings['agent.slatebox|server']
  assert.equal(head.version, 3)
  assert.equal(resolveBinding(w.holder.current(), { surface: 'agent.slatebox', holders: await w.ai.choiceHolders(null), settings: w.settings }).provenance.chain, 'db:server@v3')
  // every step is in the audit trail with who and why
  const actions = w.auditRows().filter((r) => r.target?.id === 'agent.slatebox|server').map((r) => r.action)
  assert.deepEqual([...new Set(actions)], ['ai.bindings.publish', 'ai.bindings.saveDraft', 'ai.bindings.rollback'])
  assert.ok(w.auditRows().filter((r) => r.action === 'ai.bindings.rollback').every((r) => r.reason === 'chat model too slow'))
  // a rollback to a version whose connection is gone is refused and points at the built-in AI
  await w.ai.removeServerConnections('root', { names: ['chatbox'], force: [], reason: 'retired', inUse: async () => [] })
  await w.holder.refresh({ force: true })
  await assert.rejects(w.ops.rollback({ actor: ACTOR, surface: 'agent.slatebox', toVersion: 2, reason: 'again' }), (error) => {
    assert.match(error.message, /Version 2 cannot be published again: chain 1: connection server:chatbox does not exist/)
    assert.match(error.message, /built-in AI instead/)
    assert.deepEqual([error.status, error.details], [409, { builtinInstead: true }])
    return true
  })
})

// ---------- tighten-only and the meter ----------
test('limits only tighten: the resolver takes the lowest, the meter charges against the binding\'s ceiling from the next call', async () => {
  const w = world()
  await withConnections(w)
  assert.equal(actionCeilingMicros('shape'), 60000)
  assert.equal(actionEstimateMicros('shape'), 8000)
  setLimitSource((feature) => limitsFor(w.holder.current(), feature))
  try {
    await w.ops.publish({ actor: ACTOR, input: { surface: 'shape', limits: { ceiling: 20000, estimate: 5000 } }, reason: 'cheaper shapes' })
    assert.equal(actionCeilingMicros('shape'), 20000)
    assert.equal(actionEstimateMicros('shape'), 5000)
    // workshop drafting follows workshop: a parent's tighter ceiling applies to it too
    await w.ops.publish({ actor: ACTOR, input: { surface: 'workshop', limits: { ceiling: 10000 } }, reason: 'boards' })
    assert.equal(actionCeilingMicros('workshop'), 10000)
    assert.equal(actionCeilingMicros('lane-chat'), 10000)
    const b = resolveBinding(w.holder.current(), { surface: 'workshop.draft', holders: await w.ai.choiceHolders(null), settings: w.settings })
    assert.equal(b.limits.ceiling, 10000)
    assert.equal(b.provenance['limits.ceiling'], 'db:server@v1')
    // the meter's other features are untouched
    assert.equal(actionCeilingMicros('generation'), 200000)
  } finally {
    setLimitSource(null)
  }
  assert.equal(actionCeilingMicros('shape'), 60000)
})

// ---------- kill switches ----------
test('a surface turned off answers with the administrator\'s message; the global switch with its own; neither touches the others', async () => {
  const w = world()
  await withConnections(w)
  await w.ops.publish({ actor: ACTOR, input: { surface: 'shape', enabled: false, disabledMessage: 'Shapes are paused while we change models.' }, reason: 'pause' })
  const shape = await route(w, 'shape')
  assert.deepEqual([shape.disabled, shape.message], [true, 'Shapes are paused while we change models.'])
  // the parts that follow default are untouched
  assert.equal((await route(w, 'generation')).disabled, undefined)
  // the publication every page reads says the same
  const status = await surfacesStatus({ surfaces: SURFACES, snapshot: w.holder.current(), bind: (surface) => resolveBinding(w.holder.current(), { surface, holders: { ownProviders: false }, settings: w.settings }) })
  assert.deepEqual(status.surfaces.shape, { enabled: false, message: 'Shapes are paused while we change models.' })
  assert.equal(status.surfaces.chat.enabled, true)
  // a default message when the administrator wrote none
  await w.ops.publish({ actor: ACTOR, input: { surface: 'presentation', enabled: false }, reason: 'pause' })
  assert.equal((await route(w, 'presentation')).message, 'Presentation planning is turned off by your administrator.')

  // the global switch: a person only, with a reason and a message
  // a token is refused by the registry before anything runs (a person-only action has no token route)
  await assert.rejects(w.registry.run(agent('root'), 'ai.control.setGlobal', { aiEnabled: false, message: 'Paused.', reason: 'x' }), { status: 403, code: 'session_required' })
  await assert.rejects(w.registry.run(person('root'), 'ai.control.setGlobal', { aiEnabled: false, reason: 'incident' }), /Write the message people see/)
  const off = body(await w.registry.run(person('root'), 'ai.control.setGlobal', { aiEnabled: false, message: 'AI is paused for maintenance.', reason: 'provider incident' }))
  assert.deepEqual([off.aiEnabled, off.aiDisabledMessage, off.dbLayer], [false, 'AI is paused for maintenance.', 'on'])
  for (const feature of ['welcome', 'agent', 'generation']) assert.equal((await route(w, feature)).message, 'AI is paused for maintenance.')
  assert.equal(w.aiControl.get().global.aiEnabled, false)
  // admin reads never depend on it
  assert.ok(body(await w.registry.run(person('root'), 'ai.bindings.list', {})).surfaces.length)
  await w.registry.run(person('root'), 'ai.control.setGlobal', { aiEnabled: true, reason: 'resolved' })
  assert.equal((await route(w, 'welcome')).disabled, undefined)
  const rows = w.auditRows().filter((r) => r.action === 'ai.control.setGlobal')
  assert.deepEqual(rows.map((r) => [r.outcome, r.reason]), [['ok', 'provider incident'], ['ok', 'resolved']])
})

// ---------- the request path ----------
test('the request path follows the chain by failure class; an unreachable primary is answered on attempt 2 and the audit shows both', () => {
  const out = JSON.parse(execFileSync(process.execPath, ['--no-deprecation', new URL('./ai-req-chain.mjs', import.meta.url).pathname],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024, timeout: 120000 }))
  const attempts = (name) => out[name].audits.map((a) => [a.connection, a.attempt, a.status])
  // infra (5xx) → the fallback for infra; both attempts are audited with the binding version
  assert.deepEqual(attempts('fallbackInfra'), [['server:bad', 0, 'provider_error'], ['server:good', 1, 'success']])
  assert.ok(out.fallbackInfra.audits.every((a) => a.surface === 'shape' && a.bindingVersion === 'shape|server@v3'))
  assert.deepEqual([out.fallbackInfra.result.abort, out.fallbackInfra.result.model, out.fallbackInfra.result.fallbackFrom], [false, 'good-model', 'bad-model'])
  // a host nobody answers on: the fallback answers on attempt 2
  assert.deepEqual(attempts('unreachable'), [['server:gone', 0, 'network_error'], ['server:good', 1, 'success']])
  // a fallback only for shape is not tried after an infra failure
  assert.deepEqual(attempts('notForInfra'), [['server:bad', 0, 'provider_error']])
  assert.equal(out.notForInfra.result.failure, 'infra')
  // too long → the fallback for context (a bigger model)
  assert.deepEqual(attempts('context'), [['server:small', 0, 'provider_error'], ['server:big', 1, 'success']])
  // a refusal (401) is neither infra nor shape: only a fallback for any takes it
  assert.deepEqual(attempts('otherSkipsInfra'), [['server:keyless', 0, 'provider_error']])
  assert.deepEqual(attempts('otherAny'), [['server:keyless', 0, 'provider_error'], ['server:good', 1, 'success']])
  // a fallback that does not match is skipped; the next one that does is tried (its place in the chain recorded)
  assert.deepEqual(attempts('skipsToMatching'), [['server:bad', 0, 'provider_error'], ['server:good', 2, 'success']])
  // answers that are never JSON → shape, after the binding's shapeRetries (1): one call, then the fallback for shape
  assert.deepEqual(attempts('shape'), [['server:chatty', 0, 'invalid_json'], ['server:good', 1, 'success']])
  assert.equal(out.shape.seen.filter((s) => s.kind === 'text').length, 1)
  // turned off: nothing sent, nothing audited, the administrator's message
  assert.deepEqual([out.disabled.seen, out.disabled.audits, out.disabled.result.message, out.disabled.result.disabled], [[], [], 'Drawing shapes is paused by your administrator.', true])
  // parameters reach the wire: the binding's answer size (below the connection's own) and temperature
  assert.deepEqual([out.params.seen[0].maxTokens, out.params.seen[0].temperature], [123, 0.3])
  // allowed tools: only those are sent; none left → refused before anything is sent
  assert.deepEqual(out.toolsAllow.seen[0].tools, ['propose_shapes'])
  assert.deepEqual([out.toolsNone.seen, out.toolsNone.result.failure], [[], 'stop'])
  assert.match(out.toolsNone.result.message, /an administrator limited its tools/)
  // a primary that fails every call, for several people, trips the breaker for the surface on this
  // pod (restated, review fix: it needs failures from at least 3 people, and records what the
  // binding does on a trip); one person's failures alone never trip it
  assert.deepEqual(out.breaker, { open: true, health: [{ kind: 'breaker', id: 'shape', bindingVersion: 'shape|server@v3' }], onTrip: 'report' })
  assert.deepEqual(out.breakerOnePerson, { open: false })
})

test('the breaker: more than half of the last calls failing (at least 10) opens it for 10 minutes; the surface uses the settings file and built-in AI; a new version closes it', async () => {
  let now = 0
  const breaker = createBreaker({ now: () => now, log: { warn() {} } })
  // Restated (review fix): failures count only when they come from at least 3 people, and the
  // binding says what an open breaker does (onTrip)
  const who = (i) => `person-${i % 3}`
  for (let i = 0; i < 9; i += 1) breaker.record('shape', { failure: 'infra', bindingVersion: 'shape|server@v1', userId: who(i), onTrip: 'fallback' })
  assert.equal(breaker.isOpen('shape'), null, 'fewer than 10 calls never trip it')
  breaker.record('shape', { failure: null, bindingVersion: 'shape|server@v1', userId: 'x', onTrip: 'fallback' })
  assert.ok(breaker.isOpen('shape'), '9 of 10 failed')
  assert.match(breaker.health()[0].problem, /failed 9 of the last 10 calls: using the settings file and built-in AI on this server until 00:10 UTC/)
  now += 10 * 60 * 1000
  assert.equal(breaker.isOpen('shape'), null, 'closes after 10 minutes')
  // half failing is not more than half; context and other failures never count
  for (let i = 0; i < 10; i += 1) breaker.record('vision', { failure: i % 2 ? 'shape' : null, bindingVersion: 'v', userId: who(i) })
  for (let i = 0; i < 10; i += 1) breaker.record('chat', { failure: 'context', bindingVersion: 'c', userId: who(i) })
  // one or two people failing every call never trip it for everyone
  for (let i = 0; i < 50; i += 1) breaker.record('workshop', { failure: 'shape', bindingVersion: 'w', userId: i % 2 ? 'mallory' : 'eve' })
  assert.deepEqual([breaker.isOpen('vision'), breaker.isOpen('chat'), breaker.isOpen('workshop')], [null, null, null])
  // a binding that only reports keeps its chain; the health entry says so
  for (let i = 0; i < 10; i += 1) breaker.record('presentation', { failure: 'infra', bindingVersion: 'p', userId: who(i), onTrip: 'report' })
  assert.equal(breaker.isOpen('presentation').onTrip, 'report')
  assert.match(breaker.health().find((h) => h.id === 'presentation').problem, /keeps using its own models/)

  // the request path while it is open: the binding's chain is set aside for the settings file
  const w = world({ settings: { ...SELFHOST, ai: { connections: { filebox: { type: 'openai-compatible', baseUrl: 'https://file.example.com/v1', model: 'file-1' } }, use: { default: 'filebox' } } } })
  await withConnections(w)
  // Restated (review fix): a chain that already lists the built-in AI falls back on a trip (its
  // default onTrip); a one-entry binding is a choice and is never moved; a chain of the
  // administrator's own connections only reports
  await w.ops.publish({ actor: ACTOR, input: { surface: 'shape', chain: [{ connection: 'server:chatbox' }, { connection: 'builtin', on: ['infra'] }] }, reason: 'chat model draws' })
  assert.equal((await route(w, 'shape')).ref, 'server:chatbox')
  for (let i = 0; i < 10; i += 1) w.breaker.record('shape', { failure: 'infra', bindingVersion: 'shape|server@v1', userId: who(i), onTrip: 'fallback' })
  const tripped = await route(w, 'shape')
  assert.deepEqual([tripped.ref, tripped.chain], ['server:filebox', undefined])
  assert.equal(w.aiControl.get().health.find((h) => h.kind === 'breaker').id, 'shape')
  for (const [chain, version] of [[[{ connection: 'server:chatbox' }], 'shape|server@v2'], [[{ connection: 'server:chatbox' }, { connection: 'server:agentbox', on: ['infra'] }], 'shape|server@v3']]) {
    await w.ops.publish({ actor: ACTOR, input: { surface: 'shape', chain }, reason: 'own models only' })
    for (let i = 0; i < 10; i += 1) w.breaker.record('shape', { failure: 'infra', bindingVersion: version, userId: who(i), onTrip: 'report' })
    assert.equal((await route(w, 'shape')).ref, 'server:chatbox', `${chain.length} entries: the breaker never moves it`)
  }
  // a surface turned off is never served by the breaker's fallback
  await w.ops.publish({ actor: ACTOR, input: { surface: 'shape', enabled: false, chain: [{ connection: 'server:chatbox' }] }, reason: 'off' })
  assert.equal((await route(w, 'shape')).disabled, true)
  // publishing (any pod: a new version) closes it
  w.breaker.record('shape', { failure: null, bindingVersion: 'shape|server@v4' })
  await w.ops.publish({ actor: ACTOR, input: { surface: 'shape', chain: [{ connection: 'server:chatbox' }] }, reason: 'fixed' })
  assert.equal((await route(w, 'shape')).ref, 'server:chatbox')
  assert.equal(w.breaker.isOpen('shape'), null)
})

test('agent.slatebox bound on its own: agent requests use its model, Ask Slatebox keeps the chat model', async () => {
  const w = world()
  await withConnections(w)
  await w.ai.update('root', { level: 'server', use: { chat: 'server:chatbox' } })
  await w.ops.publish({ actor: ACTOR, input: { surface: 'agent.slatebox', chain: [{ connection: 'server:agentbox' }, { connection: 'server:chatbox', on: ['infra', 'shape'] }] }, reason: 'agent model' })
  const agentRoute = await route(w, 'agent')
  assert.deepEqual([agentRoute.ref, agentRoute.connection.model, agentRoute.chain.map((c) => [c.ref, c.on])], ['server:agentbox', 'agent-9', [['server:agentbox', ['any']], ['server:chatbox', ['infra', 'shape']]]])
  // every attempt's audit row and this pod's breaker read the surface and version from the route
  assert.deepEqual([agentRoute.control.surface, agentRoute.control.bindingVersion], ['agent.slatebox', 'agent.slatebox|server@v1'])
  for (const feature of ['welcome', 'welcome-route', 'chat']) assert.equal((await route(w, feature)).connection.model, 'chat-1')
  // canvas follows chat, not the agent; workshop too
  assert.equal((await route(w, 'canvas')).connection.model, 'chat-1')
  assert.equal((await route(w, 'lane-chat')).connection.model, 'chat-1')
  // the Overview says where it came from
  const eff = await w.aiControl.effective({ surface: 'agent.slatebox' })
  assert.equal(eff.surfaces[0].binding.provenance.chain, 'db:server@v1')
  // a person's own choice (self-host) is their layer: it outranks the server's binding
  await w.ai.update('ana', { level: 'me', connections: [{ name: 'mine', type: 'openai-compatible', baseUrl: 'https://mine.example.com/v1', model: 'm-1' }], use: { default: 'me:mine' } })
  assert.equal((await route(w, 'agent', 'ana')).ref, 'me:mine')
  assert.equal(resolveBinding(w.holder.current(), { surface: 'agent.slatebox', userId: 'ana', holders: await w.ai.choiceHolders('ana'), settings: w.settings }).provenance.chain, 'db:me:choice')
})

test('a built-in model in a chain: the call site\'s built-in model, or one the model list names', async () => {
  const w = world()
  await withConnections(w)
  await w.collections.models.replaceOne({ _id: 'builtin:deepinfra:other/model' }, { _id: 'builtin:deepinfra:other/model', connection: 'builtin:deepinfra', model: 'other/model', capabilities: { tools: true }, status: 'enabled' })
  await w.holder.refresh({ force: true })
  await w.ops.publish({ actor: ACTOR, input: { surface: 'generation', chain: [{ model: 'builtin:deepinfra:other/model' }, { connection: 'builtin', on: ['infra', 'shape'] }] }, reason: 'another built-in model' })
  const r = await route(w, 'generation')
  assert.deepEqual([r.ref, r.builtin, r.chain[1].ref, r.chain[1].builtin], ['builtin', { provider: 'deepinfra', engine: 'other/model' }, 'builtin', undefined])
})

// ---------- reset ----------
test('reset gains binding targets: one surface, every binding, and all; versions stay', async () => {
  const w = world()
  await withConnections(w)
  await w.ops.publish({ actor: ACTOR, input: { surface: 'shape', chain: [{ connection: 'server:chatbox' }] }, reason: 'a' })
  await w.ops.publish({ actor: ACTOR, input: { surface: 'vision', enabled: false }, reason: 'b' })
  await assert.rejects(w.registry.run(person('root'), 'ai.control.reset', { target: 'binding', reason: 'x' }), /surface goes with target binding/)
  const one = body(await w.registry.run(person('root'), 'ai.control.reset', { target: 'binding', surface: 'shape', reason: 'back to built in' }))
  assert.deepEqual(one.removed, ['shape|server'])
  assert.equal((await route(w, 'shape')).ref, 'builtin')
  assert.equal((await w.ops.versionsOf('shape|server')).length, 1)
  const all = body(await w.registry.run(person('root'), 'ai.control.reset', { target: 'bindings', reason: 'clean slate' }))
  assert.deepEqual(all.removed, ['vision|server'])
  assert.equal((await route(w, 'vision')).disabled, undefined)
  // the DB layer switched off, then on again with the global switch
  await w.registry.run(person('root'), 'ai.control.reset', { target: 'dbLayer', reason: 'incident' })
  assert.equal(w.holder.current().dbLayer, 'off')
  await w.registry.run(person('root'), 'ai.control.setGlobal', { dbLayer: 'on', reason: 'over' })
  assert.equal(w.holder.current().dbLayer, 'on')
})

// ---------- migration and ai.update ----------
test('ai-control-001 moves the server\'s AI choices to bindings without changing any answer, once', async () => {
  const settings = { ...SELFHOST, ai: { connections: { filebox: { type: 'openai-compatible', baseUrl: 'https://file.example.com/v1', model: 'file-1' } }, use: { workshop: 'filebox' } } }
  const w = world({ settings })
  await withConnections(w)
  // choices made in AI settings before AI control existed (written straight to aiChoices)
  await w.keyStore.setUse({ type: 'server', id: 'server' }, { use: { chat: 'server:chatbox', shape: 'builtin', presentation: 'server:agentbox' } })
  await w.ai.update('ana', { level: 'me', connections: [{ name: 'mine', type: 'openai-compatible', baseUrl: 'https://mine.example.com/v1', model: 'm-1' }], use: { presentation: 'me:mine' } })
  const answers = async () => {
    const out = {}
    for (const userId of [null, 'ana']) for (const surface of BINDABLE_SURFACES) {
      const r = await w.ai.resolveFor({ userId, feature: surface })
      out[`${userId}:${surface}`] = r.connection ? `${r.ref}:${r.connection.model}` : r.ref
    }
    return out
  }
  const before = await answers()
  const out = await runAIControl001({ state: w.collections.state, aiSettings: w.ai, ops: w.ops, snapshot: () => w.holder.current(), settings, log: { info() {} } })
  assert.equal(out.ran, true)
  // chat stays a choice: the settings file sets workshop (which follows chat) more specifically
  assert.deepEqual(out.moved.sort(), ['presentation', 'shape'])
  assert.deepEqual(out.kept.map((k) => k.surface), ['chat'])
  assert.deepEqual(await answers(), before)
  const head = w.holder.current().bindings['shape|server']
  assert.deepEqual([head.version, head.chain], [1, [{ connection: 'builtin' }]])
  assert.equal((await w.ops.versionsOf('shape|server'))[0].origin, 'ai-control-001')
  // aiChoices is kept as written
  assert.deepEqual((await w.keyStore.getUse({ type: 'server', id: 'server' })).use, { chat: 'server:chatbox', shape: 'builtin', presentation: 'server:agentbox' })
  // once per database
  assert.deepEqual(await runAIControl001({ state: w.collections.state, aiSettings: w.ai, ops: w.ops, snapshot: () => w.holder.current(), settings, log: { info() {} } }), { ran: false })
  assert.deepEqual((await w.collections.state.findOne({ _id: AI_CONTROL_001 })).moved.sort(), ['presentation', 'shape'])
  assert.ok(w.auditRows().some((r) => r.action === 'ai.bindings.migrate' && r.actor.principal === 'system'))
})

test('ai.update at the server level keeps the server\'s bindings in step; reset use clears both; other levels never touch bindings', async () => {
  const w = world()
  await withConnections(w)
  // a published binding with parameters, then a choice in AI settings for the same surface
  await w.ops.publish({ actor: ACTOR, input: { surface: 'shape', chain: [{ connection: 'server:agentbox' }], params: { timeoutMs: 15000 } }, reason: 'a' })
  await w.ai.update('root', { level: 'server', use: { shape: 'server:chatbox' } })
  const head = w.holder.current().bindings['shape|server']
  assert.deepEqual([head.version, head.chain, head.params], [2, [{ connection: 'server:chatbox' }], { timeoutMs: 15000 }])
  assert.equal((await route(w, 'shape')).ref, 'server:chatbox')
  // a new choice for a surface without a binding creates one
  await w.ai.update('root', { level: 'server', use: { vision: 'builtin' } })
  assert.deepEqual(w.holder.current().bindings['vision|server'].chain, [{ connection: 'builtin' }])
  // clearing the choice clears the chain; a binding left with nothing set is removed
  await w.ai.update('root', { level: 'server', use: { vision: null } })
  assert.equal(w.holder.current().bindings['vision|server'], undefined)
  // reset use: the choice and the chain go; the binding's own parameters stay
  await w.registry.run(person('root'), 'ai.control.reset', { target: 'use', reason: 'back' })
  const after = w.holder.current().bindings['shape|server']
  assert.deepEqual([after.chain, after.params], [undefined, { timeoutMs: 15000 }])
  assert.equal((await route(w, 'shape')).ref, 'builtin')
  // a person's choice is theirs: no binding is written
  const count = w.collections.bindings.docs.size
  await w.ai.update('ana', { level: 'me', connections: [{ name: 'mine', type: 'openai-compatible', baseUrl: 'https://mine.example.com/v1', model: 'm-1' }], use: { shape: 'me:mine' } })
  assert.equal(w.collections.bindings.docs.size, count)
})

// ---------- who ----------
test('only a person publishes, rolls back or flips the global switch; an agent saves drafts, marked as suggestions', async () => {
  const w = world()
  await withConnections(w)
  const saved = body(await w.registry.run(agent('root'), 'ai.bindings.saveDraft', { binding: { surface: 'shape', chain: [{ connection: 'server:chatbox' }] }, note: 'agent suggestion' }))
  assert.deepEqual([saved.version, saved.status], [1, 'draft'])
  assert.equal((await w.ops.versionsOf('shape|server'))[0].origin, 'ai-proposal')
  for (const [id, input] of [['ai.bindings.publish', { surface: 'shape', version: 1, reason: 'go' }], ['ai.bindings.rollback', { surface: 'shape', toVersion: 1, reason: 'back' }]]) {
    await assert.rejects(w.registry.run(agent('root'), id, input), { status: 403 }, id)
  }
  // a non-admin person gets 403 and the attempt is recorded
  await assert.rejects(w.registry.run(person('ana'), 'ai.bindings.publish', { surface: 'shape', version: 1, reason: 'go' }), { status: 403 })
  assert.ok(w.auditRows().some((r) => r.action === 'ai.bindings.publish' && r.outcome === 'refused' && r.actor.userId === 'ana'))
  // the administrator publishes the agent's draft
  const published = body(await w.registry.run(person('root'), 'ai.bindings.publish', { surface: 'shape', version: 1, reason: 'the suggestion is good' }))
  assert.deepEqual([published.bindingId, published.version], ['shape|server', 1])
  // the list shows it, its versions and its author
  const list = body(await w.registry.run(agent('root', ['ai:admin:read']), 'ai.bindings.list', {}))
  const shape = list.surfaces.find((s) => s.surface === 'shape')
  assert.deepEqual([shape.head.version, shape.versions[0].status, shape.versions[0].origin], [1, 'published', 'ai-proposal'])
  assert.deepEqual(list.surfaces.map((s) => s.surface), BINDABLE_SURFACES)
  // a read-only token cannot save a draft
  await assert.rejects(w.registry.run(agent('root', ['ai:admin:read']), 'ai.bindings.saveDraft', { binding: { surface: 'shape' } }), { status: 403 })
})

test('normalizeBinding keeps what it is given in a stable shape; a draft is checked for shape only', () => {
  const doc = normalizeBinding({ surface: 'chat', chain: [{ connection: 'server:x' }], tools: { allow: ['exec', 'exec'] }, params: { infraRetries: 0, temperature: null } }, { checkRefs: false })
  assert.deepEqual(doc, { surface: 'chat', scope: { level: 'server' }, enabled: true, chain: [{ connection: 'server:x' }], tools: { allow: ['exec'] }, params: { infraRetries: 0 } })
  assert.throws(() => normalizeBinding({ surface: 'chat', chain: [{ connection: 'server:x' }] }, { checkRefs: true }), /does not exist/)
})

// ---------- the Bindings and Effective tabs' words (bindings-view.mjs) ----------
test('the Bindings tab: a binding in words, the editor form round-trips to the action input, and every bindable part is in a group', async () => {
  const view = await import('../web/app/imports/ui/pages/admin/ai/bindings-view.mjs')
  const models = [{ _id: 'agentbox:agent-9', model: 'agent-9', label: 'Agent nine' }]
  assert.equal(view.chainText([{ model: 'agentbox:agent-9' }, { connection: 'server:chatbox', on: ['infra', 'shape'] }, { connection: 'builtin', on: ['any'] }], models),
    'Agent nine, then chatbox when the service fails or the answer is malformed, then Built-in AI when anything goes wrong')
  assert.equal(view.chainText([]), null)
  const head = { surface: 'shape', enabled: false, disabledMessage: 'Paused.', chain: [{ connection: 'server:chatbox' }, { connection: 'builtin', on: ['infra'] }], params: { timeoutMs: 20000, temperature: 0.4 }, tools: { allow: ['propose_shapes'] }, limits: { ceiling: 30000 } }
  const form = view.formFromBinding(head, 'shape')
  assert.deepEqual([form.params.timeoutMs, form.ceiling, form.allow], ['20', '0.03', 'propose_shapes'])
  const { binding } = view.bindingFromForm(form)
  assert.deepEqual(binding, { surface: 'shape', enabled: false, disabledMessage: 'Paused.', chain: head.chain, params: head.params, tools: head.tools, limits: head.limits })
  // what the server accepts is what the form sends
  assert.deepEqual(normalizeBinding(binding, { checkRefs: false }), { ...binding, scope: { level: 'server' } })
  assert.match(view.bindingFromForm({ ...form, disabledMessage: '' }).error, /message people see/)
  assert.match(view.bindingFromForm({ ...form, chain: [{ value: 'connection:builtin', on: [] }, { value: 'connection:server:x', on: [] }] }).error, /Say when line 2/)
  // reordering keeps the primary without `on` and gives a moved fallback infra
  assert.deepEqual(view.moveLine([{ value: 'a', on: [] }, { value: 'b', on: ['shape'] }], 1, -1), [{ value: 'b', on: [] }, { value: 'a', on: ['infra'] }])
  // every bindable part has a row
  assert.deepEqual(view.GROUPS.flatMap((g) => g.surfaces).sort(), [...BINDABLE_SURFACES].sort())
  // where a field came from, in words
  assert.deepEqual(['code', 'file', 'db:server@v3', 'db:server:choice', 'db:me:choice', 'db:global'].map(view.layerText),
    ['Built in', 'Settings file', 'Set here (version 3)', 'AI settings', 'Their own AI settings', 'AI for everyone switch'])
  // the options never offer a connection that is off or a service beside the models
  assert.deepEqual(view.chainOptions({ connections: [{ name: 'a' }, { name: 'off', status: 'disabled' }, { name: 'pics', aux: true }], models: [{ _id: 'a:m', model: 'm' }, { _id: 'a:x', model: 'x', status: 'disabled' }] }).map((o) => o.value),
    ['connection:builtin', 'connection:server:a', 'model:a:m'])
})

// ---------- review fixes (2026-11-24) ----------
// What a request takes from a route, for comparing a binding with the choice it replaced: the
// connection and model, the chain it walks (if any), and the fallback model the call site keeps.
const routeShape = (r) => ({ ref: r.ref, model: r.connection?.model ?? r.builtin?.engine ?? null, chain: r.chain ? r.chain.map((c) => c.ref) : null })

test('a one-entry binding is the choice it replaced: no chain walk (the call site keeps its fallback model), the built-in fallback shown, and the breaker never moves it', async () => {
  const w = world()
  await withConnections(w)
  // the same choices through AI settings before AI control: a built-in choice and a server connection
  await w.keyStore.setUse({ type: 'server', id: 'server' }, { use: { generation: 'builtin', vision: 'server:agentbox' } })
  const legacy = { generation: routeShape(await route(w, 'generation')), vision: routeShape(await route(w, 'vision')) }
  const legacyChain = resolveBinding(w.holder.current(), { surface: 'generation', holders: await w.ai.choiceHolders(null), settings: w.settings }).chain
  assert.ok(legacyChain.length === 2, 'the built-in AI has a fallback model for drafting')
  // published as one-entry bindings (what ai.update and ai-control-001 write)
  await w.ops.publish({ actor: ACTOR, input: { surface: 'generation', chain: [{ connection: 'builtin' }] }, reason: 'from settings' })
  await w.ops.publish({ actor: ACTOR, input: { surface: 'vision', chain: [{ connection: 'server:agentbox' }] }, reason: 'from settings' })
  for (const surface of ['generation', 'vision']) {
    const r = await route(w, surface)
    // no chain: req.js takes the path a choice takes, with the call site's own fallback model
    assert.deepEqual(routeShape(r), legacy[surface], surface)
    assert.equal(r.chain, undefined, `${surface}: no chain walk`)
    assert.equal(r.control.bindingVersion, `${surface}|server@v1`, `${surface}: the audit rows still name the binding`)
  }
  // the resolver shows the built-in fallback, as the choice had it
  const bound = resolveBinding(w.holder.current(), { surface: 'generation', holders: await w.ai.choiceHolders(null), settings: w.settings })
  assert.deepEqual(bound.chain.map((e) => [e.connection, e.provider, e.model, e.on]), legacyChain.map((e) => [e.connection, e.provider, e.model, e.on]))
  assert.deepEqual([bound.choiceLike, bound.onTrip], [true, 'report'])
  // a binding that keeps failing for everyone still never moves a one-entry binding
  for (let i = 0; i < 20; i += 1) w.breaker.record('vision', { failure: 'infra', bindingVersion: 'vision|server@v1', userId: `p${i % 4}`, onTrip: 'fallback' })
  assert.equal((await route(w, 'vision')).ref, 'server:agentbox')
  // two entries: the whole list, walked by failure class (the call site's fallback does not apply)
  await w.ops.publish({ actor: ACTOR, input: { surface: 'vision', chain: [{ connection: 'server:agentbox' }, { connection: 'builtin', on: ['infra'] }] }, reason: 'with a fallback' })
  const two = await route(w, 'vision')
  assert.deepEqual([two.chain.map((c) => c.ref), two.onTrip], [['server:agentbox', 'builtin'], 'fallback'])
  // onTrip is the binding's to set, and checked
  assert.equal(normalizeBinding({ surface: 'vision', onTrip: 'report' }, { checkRefs: false }).onTrip, 'report')
  assert.throws(() => normalizeBinding({ surface: 'vision', onTrip: 'never' }, { checkRefs: false }), /onTrip is fallback/)
})

test('ai-control-001 compares whole routes: a moved built-in choice keeps its fallback model', async () => {
  const w = world()
  await withConnections(w)
  await w.keyStore.setUse({ type: 'server', id: 'server' }, { use: { generation: 'builtin', vision: 'builtin' } })
  const chains = async () => {
    const holders = await w.ai.choiceHolders(null)
    return Object.fromEntries(BINDABLE_SURFACES.map((s) => [s, resolveBinding(w.holder.current(), { surface: s, holders, settings: w.settings }).chain.map((e) => [e.connection, e.model, e.on])]))
  }
  const routes = async () => Object.fromEntries(await Promise.all(BINDABLE_SURFACES.map(async (s) => [s, routeShape(await route(w, s))])))
  const [beforeChains, beforeRoutes] = [await chains(), await routes()]
  const out = await runAIControl001({ state: w.collections.state, aiSettings: w.ai, ops: w.ops, snapshot: () => w.holder.current(), settings: w.settings, log: { info() {} } })
  assert.deepEqual(out.moved.sort(), ['generation', 'vision'])
  assert.deepEqual(await chains(), beforeChains)
  assert.deepEqual(await routes(), beforeRoutes)
  assert.ok(beforeChains.generation.length === 2 && beforeChains.vision.length === 2)
})

test('two drafts saved at once get their own version numbers; neither replaces the other', async () => {
  const w = world()
  await withConnections(w)
  const [a, b] = await Promise.all([
    w.ops.saveDraft({ actor: ACTOR, input: { surface: 'shape', enabled: false, disabledMessage: 'Person draft.' } }),
    w.ops.saveDraft({ actor: { userId: 'root', principal: 'agent', via: 'http' }, input: { surface: 'shape', chain: [{ connection: 'server:chatbox' }] } }),
  ])
  assert.deepEqual([a.version, b.version].sort(), [1, 2])
  const versions = await w.ops.versionsOf('shape|server')
  assert.equal(versions.length, 2)
  const byVersion = Object.fromEntries(versions.map((v) => [v.version, v.doc]))
  assert.equal(byVersion[a.version].disabledMessage, 'Person draft.')
  assert.deepEqual(byVersion[b.version].chain, [{ connection: 'server:chatbox' }])
})
