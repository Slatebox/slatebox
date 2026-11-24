// AI control S2: who may read and change AI control, on every surface, and the audit trail of the
// writes that existed before it (ai.update, persona saves).
//   - every ai.control.* and ai.audit.* action needs an administrator of this server: a person or
//     a token that is not one gets 403, whatever scope it holds;
//   - ai:admin:read reads and cannot write; ai:admin holds ai:admin:read;
//   - the admin toolset is in the exec client and describe, never in the typed MCP tools or the
//     exec description (which stays byte-identical);
//   - ai.control.reset needs a reason, is held for the person when an agent sends it, records a
//     refused attempt, and returns choices to the settings file (use) or switches the DB layer off;
//   - ai.update writes an audit row with keys only as fingerprints;
//   - ai.surfaces.status says which surfaces are on, never a model.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { holdsScope } from '../web/app/server/actions/registry.mjs'
import { buildClientManifest, describeClient, renderExecTool } from '../web/app/server/actions/client-render.mjs'
import { buildOpenApi } from '../web/app/server/actions/openapi.mjs'
import { actorOf } from '../web/app/server/actions/ai-schemas.mjs'
import { API_TOKEN_SCOPES } from '../web/app/server/api-token-core.mjs'
import { DEFAULT_SCOPES as OAUTH_DEFAULTS } from '../web/app/server/oauth/core.mjs'
import { tokenPermissions } from '../web/app/imports/api/common/token-permissions.mjs'
import { SURFACES } from '../web/app/server/ai-control/catalogue.mjs'
import { COLLECTIONS, STATE_ID, createControlStore } from '../web/app/server/ai-control/store.mjs'
import { buildSnapshot, createSnapshotHolder } from '../web/app/server/ai-control/snapshot.mjs'
import { createAIControl } from '../web/app/server/ai-control/facade.mjs'
import { resolveBinding } from '../web/app/server/ai-control/resolve.mjs'
import { changedFields, createAdminOps, surfacesStatus } from '../web/app/server/ai-control/admin.mjs'
import { createAISettings, keyFingerprint } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { createGate } from '../web/app/server/exec/gate.mjs'
import { createExecStore } from '../web/app/server/exec/audit.mjs'
import { memoryCollection as driverCollection } from './exec-test-world.mjs'

// S3 added providers, connections and models (ai-providers/connections/models.mjs); their own
// rules are tested in ai-providers.test.mjs. Restated here: every admin action is listed.
const ADMIN_ACTIONS = ['ai.audit.list', 'ai.connections.list', 'ai.connections.remove', 'ai.connections.save', 'ai.control.effective', 'ai.control.get',
  'ai.control.health', 'ai.control.reset', 'ai.models.discover', 'ai.models.save', 'ai.providers.archive', 'ai.providers.save']
const READS = { 'ai.audit.list': {}, 'ai.control.effective': { surface: 'chat' }, 'ai.control.get': {}, 'ai.control.health': {} }
const RESET = { target: 'use', reason: 'back to the settings file' }
// inputs for the S3 actions in the "who may call" test
const S3_INPUTS = {
  'ai.connections.list': {},
  'ai.connections.save': { connections: [{ name: 'gem', type: 'openai-compatible', baseUrl: 'https://gem.example/v1', model: 'g1' }] },
  'ai.connections.remove': { names: ['gem'], reason: 'gone' },
  'ai.models.discover': { connection: 'gem' },
  'ai.models.save': { models: [{ connection: 'builtin:deepinfra', model: 'm1' }] },
  'ai.providers.archive': { id: 'gemini', reason: 'gone' },
  'ai.providers.save': { provider: { id: 'gemini', label: 'Gemini', protocol: 'openai-chat' } },
}
// a person only: a token is refused by the registry before the administrator check
const PERSON_ONLY = ['ai.connections.remove', 'ai.providers.archive']

// ---------- in-memory stores ----------
const get = (doc, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc)
const time = (value) => (value instanceof Date ? value.getTime() : value)
function matches(doc, selector) {
  return Object.entries(selector).every(([path, want]) => {
    if (path === '$or') return want.some((part) => matches(doc, part))
    const have = get(doc, path)
    if (want && typeof want === 'object' && !(want instanceof Date)) {
      return Object.entries(want).every(([op, arg]) => {
        if (op === '$lt') return time(have) < time(arg)
        if (op === '$gte') return time(have) >= time(arg)
        if (op === '$regex') return new RegExp(arg).test(have)
        throw new Error(`unsupported ${op}`)
      })
    }
    return time(have) === time(want)
  })
}
// a MongoDB driver collection as the control store and the audit list use it
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
    find(selector = {}) {
      let rows = [...docs.values()].filter((doc) => matches(doc, selector)).map((doc) => structuredClone(doc))
      const cursor = {
        sort(spec) {
          const keys = Object.entries(spec)
          rows.sort((a, b) => {
            for (const [key, dir] of keys) {
              const x = time(get(a, key)); const y = time(get(b, key))
              if (x !== y) return x > y ? dir : -dir
            }
            return 0
          })
          return cursor
        },
        limit(n) { rows = rows.slice(0, n); return cursor },
        async toArray() { return rows },
      }
      return cursor
    },
    toArray: async () => [...docs.values()],
  }
}
function settingsStore() {
  const keys = []
  const uses = new Map()
  const match = (owner) => (doc) => doc.ownerType === owner.type && doc.ownerId === owner.id
  return {
    async listConnections(owner) { return keys.filter(match(owner)).map((doc) => ({ ...doc })) },
    async saveConnection(owner, doc) {
      const i = keys.findIndex((k) => match(owner)(k) && k.name === doc.name)
      if (i >= 0) keys[i] = { ...doc, ownerType: owner.type, ownerId: owner.id }
      else keys.push({ ...doc, ownerType: owner.type, ownerId: owner.id })
    },
    async removeConnection(owner, name) { const i = keys.findIndex((k) => match(owner)(k) && k.name === name); if (i >= 0) keys.splice(i, 1) },
    async getUse(owner) { return uses.get(`${owner.type}:${owner.id}`) ?? null },
    async setUse(owner, value) { uses.set(`${owner.type}:${owner.id}`, value) },
  }
}

function world({ settings = {} } = {}) {
  const collections = Object.fromEntries(Object.keys(COLLECTIONS).map((key) => [key, memoryCollection()]))
  let id = 0
  let clock = Date.parse('2026-11-24T10:00:00Z')
  const holder = createSnapshotHolder({
    read: {
      generation: async () => (await collections.state.findOne({ _id: STATE_ID }))?.generation ?? 0,
      all: async () => ({
        state: await collections.state.findOne({ _id: STATE_ID }), providers: [], connections: [], models: [],
        bindings: [...collections.bindings.docs.values()], prompts: [], promptVersions: [], agents: [],
      }),
    },
    settings,
    log: { warn() {} },
  })
  const store = createControlStore({ collections, newId: () => `row${String(++id).padStart(3, '0')}`, now: () => new Date(clock), onWrite: () => holder.refresh({ force: true }) })
  const ai = createAISettings({
    store: settingsStore(),
    // a key made for this test run only, never the server's key-encryption key
    master: loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }),
    settings, hosted: false,
    loadUser: async (userId) => ({ root: { _id: 'root' }, ana: { _id: 'ana', orgId: 'team1' } })[userId] || null,
    isAdmin: async (userId) => userId === 'root',
    isTeamAdmin: async () => false,
    check: async () => ({ ok: true }),
    audit: (entry) => store.record(entry),
  })
  const aiControl = createAIControl({ holder, choiceHolders: (userId) => ai.choiceHolders(userId), settings })
  const aiAudit = { aggregate: () => ({ toArray: async () => [] }) }
  const ops = createAdminOps({ store, audit: collections.audit, aiAudit, aiSettings: ai, now: () => clock })
  const deps = { ai, aiControl, aiControlAdmin: async (userId) => userId === 'root', aiControlOps: ops, aiControlStore: store }
  const registry = createAppRegistry({ deps })
  const auditRows = () => [...collections.audit.docs.values()]
  return { collections, store, holder, ai, aiControl, ops, registry, deps, auditRows, tick: (ms) => { clock += ms } }
}

const person = (userId, kind = 'person') => ({ kind, userId, tokenId: null, tokenName: null, scopes: [...API_TOKEN_SCOPES] })
const token = (userId, scopes) => ({ kind: 'agent', userId, tokenId: `t-${userId}`, tokenName: 'Agent', scopes })
const body = (result) => {
  const { mode: _mode, ...rest } = result.body ?? result
  return rest
}

// ---------- who may call ----------
test('every AI control action is an administrator\'s: a non-admin with every scope gets 403, on the app and with a token', async () => {
  const { registry } = world()
  const listed = registry.list().filter((action) => action.toolset === 'admin').map((action) => action.id).sort()
  assert.deepEqual(listed, ADMIN_ACTIONS)
  for (const id of ADMIN_ACTIONS) {
    const input = READS[id] ?? S3_INPUTS[id] ?? RESET
    await assert.rejects(registry.run(person('ana'), id, input), { status: 403, code: 'forbidden' }, `${id} person`)
    await assert.rejects(registry.run(token('ana', [...API_TOKEN_SCOPES]), id, input), { status: 403, code: PERSON_ONLY.includes(id) ? 'session_required' : 'forbidden' }, `${id} token`)
    // a guest (an anonymous account) is refused by the registry before the handler
    await assert.rejects(registry.run(person('ana', 'guest'), id, input), { status: 403 }, `${id} guest`)
  }
})

test('ai:admin:read reads and cannot write; ai:admin holds it; ai:settings alone reads nothing', async () => {
  const { registry, auditRows } = world()
  for (const id of Object.keys(READS)) {
    assert.ok(body(await registry.run(token('root', ['ai:admin:read']), id, READS[id])), `${id} read scope`)
    assert.ok(body(await registry.run(token('root', ['ai:admin']), id, READS[id])), `${id} admin scope`)
    await assert.rejects(registry.run(token('root', ['ai:settings']), id, READS[id]),
      (error) => error.status === 403 && error.code === 'insufficient_scope' && error.details.requiredScope === 'ai:admin:read', id)
  }
  // the read scope cannot reset, even for an administrator, and nothing is written
  await assert.rejects(registry.run(token('root', ['ai:admin:read']), 'ai.control.reset', RESET),
    (error) => error.status === 403 && error.code === 'insufficient_scope' && error.details.requiredScope === 'ai:admin')
  assert.equal(auditRows().length, 0)
  // the rule: name:read is held by name; nothing else is widened
  assert.equal(holdsScope({ scopes: ['ai:admin'] }, 'ai:admin:read'), true)
  assert.equal(holdsScope({ scopes: ['ai:admin:read'] }, 'ai:admin'), false)
  assert.equal(holdsScope({ scopes: ['ai:settings'] }, 'ai:admin:read'), false)
  assert.equal(holdsScope({ scopes: ['slates:write'] }, 'slates:read'), false)
})

test('ai:admin:read is in the token vocabulary, the OAuth lists and the Developer tab, and agents may need it', () => {
  const registry = createAppRegistry()
  assert.ok(API_TOKEN_SCOPES.includes('ai:admin:read'))
  assert.equal(API_TOKEN_SCOPES.indexOf('ai:admin:read'), API_TOKEN_SCOPES.indexOf('ai:admin') + 1)
  assert.ok(registry.neededScopes().includes('ai:admin:read'))
  assert.ok(tokenPermissions.some((p) => p.scope === 'ai:admin:read' && /administrators only/.test(p.label) && /never sees a key/.test(p.explain)))
  // a new connection is never granted it by default
  assert.ok(!OAUTH_DEFAULTS.includes('ai:admin:read') && !OAUTH_DEFAULTS.includes('ai:admin'))
})

// ---------- the surfaces ----------
test('the admin toolset is in the exec client, describe and OpenAPI, but not the typed tools or the exec description', () => {
  const registry = createAppRegistry()
  const manifest = buildClientManifest(registry)
  const tools = renderExecTool(manifest)
  const generated = JSON.parse(readFileSync(new URL('../web/app/server/actions/generated/exec-tool.json', import.meta.url), 'utf8'))
  const openapi = buildOpenApi(registry)
  for (const id of ADMIN_ACTIONS) {
    const method = manifest.methods.find((m) => m.name === id)
    // a person-only action is the app's alone: no HTTP route, so no exec method or tool either
    if (PERSON_ONLY.includes(id)) {
      assert.equal(method, undefined, id)
      assert.ok(!registry.get(id).mounts.http, id)
      continue
    }
    assert.equal(method?.toolset, 'admin', id)
    assert.ok(!tools.exec.description.includes(method.index), id)
    assert.ok(!tools.typed.some((t) => t.method === id), id)
    const action = registry.get(id)
    assert.ok(openapi.paths[action.mounts.http.path][action.mounts.http.method.toLowerCase()], id)
    assert.ok(action.mounts.http.path.startsWith('/ai/control'), id)
  }
  // nobody else's tools changed: the description and typed tools are the generated file's bytes
  assert.equal(tools.exec.description, generated.exec.description)
  assert.equal(JSON.stringify(tools.typed), JSON.stringify(generated.typed))
  assert.ok(tools.exec.description.length <= 3500)
  // an administrator finds them in describe
  const found = describeClient(manifest, { query: 'AI control' })
  assert.ok(found.methods.some((m) => m.name === 'ai.control.get'))
  // the reset is the one write: confirmed, destructive, idempotent with an optional key
  const reset = registry.get('ai.control.reset')
  assert.deepEqual([reset.kind, reset.confirm, reset.destructive, reset.idempotency, reset.scope], ['write', true, true, 'optional', 'ai:admin'])
  for (const id of Object.keys(READS)) assert.equal(registry.get(id).scope, 'ai:admin:read', id)
})

// ---------- reset ----------
test('reset use: the server\'s choices made in the app are cleared, the settings file stays, and the audit row says who and why', async () => {
  const settings = { ai: { connections: { muse: { type: 'openai-compatible', baseUrl: 'https://muse.example.com/v1', model: 'muse-ember-1.0' } }, use: { chat: 'muse' } } }
  const { registry, ai, auditRows } = world({ settings })
  await ai.update('root', { level: 'server', connections: [{ name: 'gem', type: 'openai-compatible', baseUrl: 'https://gem.example/v1', model: 'g1', capabilities: { tools: true } }], use: { shape: 'server:gem', generation: 'server:gem' } })
  assert.equal((await ai.serverState()).use.shape, 'server:gem')
  // a reason is required
  await assert.rejects(registry.run(person('root'), 'ai.control.reset', { target: 'use' }), { status: 400 })
  await assert.rejects(registry.run(person('root'), 'ai.control.reset', { target: 'use', reason: '   ' }), { status: 400 })
  const some = body(await registry.run(person('root'), 'ai.control.reset', { target: 'use', keys: ['shape'], reason: 'shape back to built in' }))
  assert.deepEqual(some, { target: 'use', cleared: ['shape'], dbLayer: 'on' })
  const state = await ai.serverState()
  assert.equal(state.use.shape, undefined)
  assert.equal(state.use.generation, 'server:gem')
  assert.equal(state.use.chat, 'server:muse') // the settings file is untouched
  assert.ok(state.connections.some((c) => c.name === 'gem')) // connections stay
  const row = auditRows().find((r) => r.action === 'ai.control.reset')
  assert.deepEqual([row.actor.userId, row.actor.principal, row.actor.via, row.reason, row.target.id], ['root', 'person', 'ddp', 'shape back to built in', 'server'])
  assert.equal(row.before.use.shape, 'server:gem')
  assert.equal(row.after.use.shape, undefined)
  // nothing left to clear: no change, no row
  const before = auditRows().length
  assert.deepEqual(body(await registry.run(person('root'), 'ai.control.reset', { target: 'use', keys: ['shape'], reason: 'again' })).cleared, [])
  assert.equal(auditRows().length, before)
})

test('reset dbLayer: the DB layer is switched off at runtime, the generation moves and every surface resolves without it', async () => {
  const { registry, collections, holder, aiControl, auditRows } = world()
  // a published binding turning shapes off
  collections.bindings.docs.set('shape|server', { _id: 'shape|server', surface: 'shape', scope: { level: 'server' }, enabled: false, disabledMessage: 'Shapes are paused.', status: 'published', version: 1 })
  await collections.state.findOneAndUpdate({ _id: STATE_ID }, { $inc: { generation: 1 }, $setOnInsert: { aiEnabled: true, dbLayer: 'on' } }, { upsert: true })
  await holder.refresh({ force: true })
  assert.equal((await aiControl.bind({ surface: 'shape' })).enabled, false)
  const out = body(await registry.run(person('root'), 'ai.control.reset', { target: 'dbLayer', reason: 'bad binding, incident 12' }))
  assert.deepEqual(out, { target: 'dbLayer', cleared: [], dbLayer: 'off' })
  assert.equal(collections.state.docs.get(STATE_ID).dbLayer, 'off')
  assert.equal(collections.state.docs.get(STATE_ID).generation, 2)
  assert.equal(holder.current().dbLayer, 'off')
  assert.equal((await aiControl.bind({ surface: 'shape' })).enabled, true)
  const row = auditRows().find((r) => r.target.id === 'dbLayer')
  assert.deepEqual([row.action, row.reason, row.before.dbLayer, row.after.dbLayer, row.generation], ['ai.control.reset', 'bad binding, incident 12', 'on', 'off', 2])
  assert.deepEqual(body(await registry.run(person('root'), 'ai.control.health', {})).dbLayer, 'off')
})

test('a refused reset is recorded; an agent\'s reset is held for the person, then saves once agreed', async () => {
  const { registry, auditRows, ai } = world()
  await assert.rejects(registry.run(token('ana', ['ai:admin']), 'ai.control.reset', RESET), { status: 403 })
  const refused = auditRows().find((r) => r.outcome === 'refused')
  assert.deepEqual([refused.action, refused.actor.userId, refused.actor.principal, refused.actor.via, refused.actor.tokenId], ['ai.control.reset', 'ana', 'agent', 'http', 't-ana'])
  // through the exec gate (a REST call or a script): held with its reasons, saved when confirmed
  await ai.update('root', { level: 'server', connections: [{ name: 'gem', type: 'openai-compatible', baseUrl: 'https://gem.example/v1', model: 'g1', capabilities: { tools: true } }], use: { shape: 'server:gem' } })
  const gate = createGate({
    registry, manifest: buildClientManifest(registry), readSlate: async () => null, audienceOf: () => 'private',
    isReplay: async () => false,
    store: createExecStore({ runs: driverCollection(), confirmations: driverCollection(), locks: driverCollection() }),
  })
  const agent = token('root', ['ai:admin'])
  let held
  await assert.rejects(gate.directCall(agent, 'ai.control.reset', RESET), (error) => {
    held = error
    return error.status === 409 && error.code === 'confirmation_required'
  })
  assert.ok(held.details.reasons.some((r) => r.rule === 'removes'))
  assert.equal((await ai.serverState()).use.shape, 'server:gem')
  const done = await gate.directCall(agent, 'ai.control.reset', RESET, { confirm: held.details.confirmationId })
  assert.deepEqual(body(done).cleared, ['shape'])
  const row = auditRows().filter((r) => r.action === 'ai.control.reset' && r.outcome === 'ok').at(-1)
  assert.deepEqual([row.actor.principal, row.actor.tokenId], ['agent', 't-root'])
})

// ---------- the audit trail of existing writes ----------
test('ai.update writes an audit row at every level, with keys only as fingerprints', async () => {
  const { registry, auditRows } = world()
  const key = `sk-test-${randomBytes(12).toString('hex')}`
  await registry.run(person('root'), 'ai.update', { level: 'server', connections: [{ name: 'gem', type: 'openai', apiKey: key, model: 'gpt-x' }], use: { shape: 'server:gem' } })
  await registry.run(token('root', ['ai:settings', 'ai:admin']), 'ai.update', { level: 'server', use: { generation: 'server:gem' } })
  await registry.run(person('ana'), 'ai.update', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'https://desk.example/v1', model: 'd' }] })
  const rows = auditRows().filter((r) => r.action === 'ai.update')
  assert.equal(rows.length, 3)
  const [first, second, third] = rows
  assert.deepEqual([first.target, first.actor.via, first.actor.principal], [{ kind: 'aiSettings', id: 'server' }, 'ddp', 'person'])
  assert.deepEqual(first.before, { connections: [], use: {} })
  const saved = first.after.connections.find((c) => c.name === 'gem')
  assert.equal(saved.keyFingerprint, keyFingerprint(key))
  assert.match(saved.keyFingerprint, /^sha256:[0-9a-f]{8}…/)
  assert.equal(first.after.use.shape, 'server:gem')
  // the key that stays shows as the fingerprint it was saved with (S3 keeps keyFingerprint on the
  // connection, spec 1.2); the change is the choice
  assert.equal(second.before.connections[0].keyFingerprint, keyFingerprint(key))
  assert.deepEqual([second.actor.principal, second.actor.via, second.actor.tokenId, second.after.use.generation], ['agent', 'http', 't-root', 'server:gem'])
  assert.deepEqual(third.target, { kind: 'aiSettings', id: 'me:ana' })
  // the key appears nowhere in the trail
  assert.ok(!JSON.stringify(auditRows()).includes(key))
  assert.ok(!JSON.stringify(auditRows()).includes(key.slice(0, 20)))
  // the audit list reads it, newest first, filtered, a page at a time
  const listed = body(await registry.run(person('root'), 'ai.audit.list', { action: 'ai.update', limit: 2 }))
  assert.equal(listed.rows.length, 2)
  assert.equal(listed.rows[0].target.id, 'me:ana')
  assert.ok(listed.next)
  // the three rows share one millisecond: the next page goes on by row id, skipping none
  assert.match(listed.next, /^2026-11-24T10:00:00\.000Z\|row\d+$/)
  const page2 = body(await registry.run(person('root'), 'ai.audit.list', { action: 'ai.update', limit: 2, before: listed.next }))
  assert.deepEqual([page2.rows.map((r) => r.target.id), page2.next], [['server'], null])
  assert.equal(new Set([...listed.rows, ...page2.rows].map((r) => r._id)).size, 3)
  assert.equal(body(await registry.run(person('root'), 'ai.audit.list', { userId: 'ana' })).rows.length, 1)
  assert.equal(body(await registry.run(person('root'), 'ai.audit.list', { action: 'ai.' })).rows.length, 3)
  await assert.rejects(registry.run(person('root'), 'ai.audit.list', { before: 'yesterday' }), { status: 400 })
})

test('the audit list pages by time and filters by kind, id and outcome', async () => {
  const { ops, store, tick } = world()
  for (let i = 0; i < 5; i += 1) {
    await store.record({ action: 'chatIntentions.save', actor: { userId: 'ana', principal: 'person', via: 'ddp' }, target: { kind: 'intention', id: `p${i}` }, before: null, after: { name: `P${i}` } })
    tick(1000)
  }
  await store.refused({ action: 'ai.control.reset', actor: { userId: 'ana', principal: 'agent', via: 'http' }, error: 'no' })
  const first = await ops.listAudit({ limit: 2, kind: 'intention' })
  assert.deepEqual(first.rows.map((r) => r.target.id), ['p4', 'p3'])
  const second = await ops.listAudit({ limit: 2, kind: 'intention', before: first.next })
  assert.deepEqual(second.rows.map((r) => r.target.id), ['p2', 'p1'])
  const last = await ops.listAudit({ limit: 2, kind: 'intention', before: second.next })
  assert.deepEqual([last.rows.map((r) => r.target.id), last.next], [['p0'], null])
  assert.equal((await ops.listAudit({ outcome: 'refused' })).rows.length, 1)
  assert.equal((await ops.listAudit({ id: 'p2' })).rows.length, 1)
  assert.equal((await ops.listAudit({ limit: 1000 })).rows.length, 6) // capped at 200, here all 6
})

test('a persona save keeps only the fields that changed', () => {
  assert.deepEqual(changedFields({ _id: 'x', name: 'A', ai: { p: 1 }, icon: 'i' }, { _id: 'x', name: 'B', ai: { p: 1 }, color: 'red' }),
    { before: { name: 'A', icon: 'i' }, after: { name: 'B', color: 'red' } })
  assert.deepEqual(changedFields(null, { name: 'A' }), { before: null, after: { name: 'A' } })
  assert.deepEqual(changedFields({ name: 'A' }, null), { before: { name: 'A' }, after: null })
  // the method records through the store, and a failure to record never fails the save
  const source = readFileSync(new URL('../web/app/server/methods/chatIntentions.js', import.meta.url), 'utf8')
  assert.match(source, /recordIntention\('chatIntentions\.save', user, intention\._id, existing/)
  assert.match(source, /recordIntention\('chatIntentions\.save', user, saveIntention\._id, null, saveIntention\)/)
  assert.match(source, /recordIntention\('chatIntentions\.delete', user, id, intention, null\)/)
  assert.match(source, /catch \(error\) \{\n    console\.warn\(`chatIntentions: could not record/)
})

test('who made a change: person (ddp), agent (http), a script (exec)', () => {
  assert.deepEqual(actorOf({ kind: 'person', userId: 'a' }), { userId: 'a', principal: 'person', via: 'ddp' })
  assert.deepEqual(actorOf({ kind: 'agent', userId: 'a', tokenId: 't' }), { userId: 'a', principal: 'agent', tokenId: 't', via: 'http' })
  assert.deepEqual(actorOf({ kind: 'agent', userId: 'a', tokenId: 't', runId: 'r' }), { userId: 'a', principal: 'agent', tokenId: 't', via: 'exec' })
})

// ---------- the Overview's numbers and the public status ----------
test('usage per surface over the last day: calls, failures and spend, old rows by their request feature', async () => {
  const groups = [
    { _id: { surface: 'agent.slatebox', feature: 'agent', model: 'm1', status: 'success' }, calls: 3, inputTokens: 1_000_000, outputTokens: 0, providerCostUsd: 0 },
    { _id: { surface: 'agent.slatebox', feature: 'agent', model: 'm1', status: 'provider_error' }, calls: 1, inputTokens: 0, outputTokens: 0, providerCostUsd: 0 },
    { _id: { feature: 'map-chat', model: 'm1', status: 'success' }, calls: 2, inputTokens: 0, outputTokens: 0, providerCostUsd: 0 },
    { _id: { feature: 'shape', model: 'm1', status: 'unmetered' }, calls: 1, inputTokens: 0, outputTokens: 0, providerCostUsd: 0 },
  ]
  let pipeline
  const ops = createAdminOps({
    store: {}, audit: {}, now: () => Date.parse('2026-11-24T10:00:00Z'),
    aiAudit: { aggregate: (p, options) => { pipeline = [p, options]; return { toArray: async () => groups } } },
    costOf: ({ usage }) => ({ costMicros: usage.inputTokens / 1000 }),
  })
  const out = await ops.usage()
  assert.equal(out.since, '2026-11-23T10:00:00.000Z')
  assert.deepEqual(pipeline[0][0], { $match: { created: { $gte: Date.parse('2026-11-23T10:00:00Z') } } })
  assert.equal(pipeline[1].maxTimeMS, 5000)
  assert.deepEqual(out.surfaces, {
    'agent.slatebox': { calls: 4, errors: 1, costMicros: 1000 },
    workshop: { calls: 2, errors: 0, costMicros: 0 },
    shape: { calls: 1, errors: 0, costMicros: 0 },
  })
  // the Overview asks for it with the effective bindings
  const { registry } = world()
  const view = body(await registry.run(person('root'), 'ai.control.effective', { usage: true }))
  assert.deepEqual(view.usage.surfaces, {})
  assert.ok(!('usage' in body(await registry.run(person('root'), 'ai.control.effective', {}))))
})

test('ai.surfaces.status: every surface in this build on, and off with the administrator\'s message; never a model', async () => {
  const snap = (docs = {}) => buildSnapshot({ state: { _id: STATE_ID, generation: 3, aiEnabled: true, dbLayer: 'on' }, providers: [], connections: [], models: [], bindings: [], prompts: [], promptVersions: [], agents: [], ...docs }, { now: () => 0 })
  const run = (snapshot) => surfacesStatus({ surfaces: SURFACES, snapshot, bind: (surface) => resolveBinding(snapshot, { surface, userId: 'ana', holders: { ownProviders: false }, settings: {} }) })
  const on = await run(snap())
  const expected = SURFACES.filter((s) => s.inBuild && s.id !== 'default' && (s.useKey || s.builtinOnly)).map((s) => s.id)
  assert.deepEqual(Object.keys(on.surfaces), expected)
  assert.ok(!('admin.test' in on.surfaces))
  // library and connectors have landed (release/library2): their status is listed like every other surface's
  assert.ok('library' in on.surfaces && 'connectors' in on.surfaces)
  assert.ok(Object.values(on.surfaces).every((s) => s.enabled && s.message === null))
  assert.deepEqual(Object.keys(on.surfaces.chat), ['enabled', 'message'])
  const shapeOff = await run(snap({ bindings: [{ _id: 'shape|server', surface: 'shape', scope: { level: 'server' }, enabled: false, disabledMessage: 'Shapes are paused.', status: 'published', version: 1 }] }))
  assert.deepEqual(shapeOff.surfaces.shape, { enabled: false, message: 'Shapes are paused.' })
  assert.equal(shapeOff.surfaces.chat.enabled, true)
  const allOff = await run(snap({ state: { _id: STATE_ID, generation: 4, aiEnabled: false, aiDisabledMessage: 'AI is resting.', dbLayer: 'on' } }))
  assert.deepEqual([allOff.aiEnabled, allOff.message, allOff.surfaces['images.search'].enabled, allOff.surfaces.canvas.message], [false, 'AI is resting.', false, 'AI is resting.'])
})

test('the one administrator check: permissions.js isInstanceAdmin, the uberMensch claim, used by AI settings and the meter', () => {
  const read = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')
  const permissions = read('server/permissions.js')
  assert.match(permissions, /export async function isInstanceAdmin\(userOrId\)/)
  assert.match(permissions, /claimId: CONSTANTS\.claims\.uberMensch\._id/)
  assert.match(permissions, /isMasterUser \(personas and featuring\) does not grant/)
  assert.match(read('server/methods/ai/ai-settings.js'), /export const isServerAdmin = \(userId\) => isInstanceAdmin\(userId\)/)
  assert.match(read('server/metering/meteor.js'), /return isInstanceAdmin\(userId\)/)
  // AI control's actions all ask it, through deps.aiControlAdmin (ai-control/index.mjs isAIControlAdmin)
  assert.match(read('server/ai-control/index.mjs'), /export const isAIControlAdmin = isServerAdmin/)
})

// ---------- the Changes tab ----------
test('the Changes tab: what changed field by field, a key only as which key, and a CSV a spreadsheet cannot run', async () => {
  const { diffRows, auditCsv, actorText } = await import('../web/app/imports/ui/pages/admin/ai/audit-diff.mjs')
  const before = { connections: [{ name: 'gem', provider: 'openai', keyFingerprint: '…a91f' }], use: { shape: 'server:gem' } }
  const after = { connections: [{ name: 'gem', provider: 'openai', keyFingerprint: 'sha256:1a2b3c4d…07c2' }, { name: 'desk', provider: 'openai-compatible', keyFingerprint: null }], use: {} }
  assert.deepEqual(diffRows(before, after), [
    { path: 'connections[desk] key', before: '—', after: 'no key' },
    { path: 'connections[desk].name', before: '—', after: 'desk' },
    { path: 'connections[desk].provider', before: '—', after: 'openai-compatible' },
    { path: 'connections[gem] key', before: '…a91f', after: 'sha256:1a2b3c4d…07c2' },
    { path: 'use', before: '—', after: '{}' },
    { path: 'use.shape', before: 'server:gem', after: '—' },
  ])
  assert.deepEqual(diffRows({ apiKey: { redacted: true, fingerprint: '…a91f' } }, { apiKey: { redacted: true, fingerprint: '…07c2' } }),
    [{ path: 'apiKey', before: 'a key (…a91f)', after: 'a key (…07c2)' }])
  const csv = auditCsv([{ _id: 'r1', at: new Date('2026-11-24T10:00:00Z'), actor: { userId: 'root', principal: 'person', via: 'ddp' }, action: 'ai.update', target: { kind: 'aiSettings', id: 'server' }, reason: '=HYPERLINK("x"), "quoted"', before, after }])
  const [head, line] = csv.trim().split('\n')
  assert.equal(head, 'when,account,principal,via,token,action,kind,id,reason,outcome,changes')
  assert.match(line, /^2026-11-24T10:00:00.000Z,root,person,ddp,,ai.update,aiSettings,server,"'=HYPERLINK\(""x""\), ""quoted""",ok,/)
  assert.match(line, /connections\[gem\] key: …a91f -> sha256:1a2b3c4d…07c2/)
  assert.equal(actorText({ userId: 'root', principal: 'agent', via: 'exec' }), 'root (agent) from a script')
})
