// Shared test kit for AI control: an in-memory MongoDB-shaped collection (the driver calls the AI
// control code makes, with unique indexes), and a whole AI control world (store, snapshot, key
// store, catalogue, bindings, AI settings) wired the way server/ai-control/index.mjs wires it, with
// a fake master key and fake provider keys. Nothing here reaches a network or a real database.
import { randomBytes } from 'node:crypto'
import { COLLECTIONS, createControlStore } from '../web/app/server/ai-control/store.mjs'
import { createSnapshotHolder } from '../web/app/server/ai-control/snapshot.mjs'
import { createKeyStore } from '../web/app/server/ai-control/keys.mjs'
import { createCatalogOps } from '../web/app/server/ai-control/models.mjs'
import { createBindingOps } from '../web/app/server/ai-control/bindings.mjs'
import { createAIControl } from '../web/app/server/ai-control/facade.mjs'
import { BUILTIN_PROVIDERS, mergeProviders } from '../web/app/server/ai-control/providers.mjs'
import { defaultRoute, resolveModel } from '../web/app/server/ai-control/resolve.mjs'
import { createConnectionStore } from '../web/app/server/methods/ai/connection-store.mjs'
import { createAISettings } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { setProviderSource } from '../web/app/server/methods/ai/connections.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { API_TOKEN_SCOPES } from '../web/app/server/api-token-core.mjs'

/** A fake 32-byte master key, never a real one. */
export const FAKE_MASTER_ENV = { SLATEBOX_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }
export const fakeMaster = () => loadMasterKey(FAKE_MASTER_ENV)

const get = (doc, path) => path.split('.').reduce((at, key) => (at == null ? undefined : at[key]), doc)
const same = (a, b) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : a === b)

export function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, want]) => {
    if (key === '$or') return want.some((part) => matches(doc, part))
    if (key === '$and') return want.every((part) => matches(doc, part))
    const value = get(doc, key)
    if (want instanceof RegExp) return typeof value === 'string' && want.test(value)
    if (want && typeof want === 'object' && !(want instanceof Date) && !Array.isArray(want) && Object.keys(want).some((k) => k.startsWith('$'))) {
      return Object.entries(want).every(([op, arg]) => {
        if (op === '$ne') return !same(value, arg) && !(arg === null && value === undefined)
        if (op === '$in') return arg.some((a) => same(value, a))
        if (op === '$nin') return !arg.some((a) => same(value, a))
        if (op === '$exists') return (value !== undefined) === arg
        if (op === '$type') return arg === 'string' ? typeof value === 'string' : true
        if (op === '$lt') return value != null && value < arg
        if (op === '$lte') return value != null && value <= arg
        if (op === '$gt') return value != null && value > arg
        if (op === '$gte') return value != null && value >= arg
        if (op === '$regex') return typeof value === 'string' && new RegExp(arg).test(value)
        throw new Error(`memory collection: ${op} is not supported`)
      })
    }
    if (want === null) return value === null || value === undefined
    return same(value, want)
  })
}

function project(doc, projection) {
  if (!projection) return structuredClone(doc)
  const out = structuredClone(doc)
  for (const [key, keep] of Object.entries(projection)) if (!keep) delete out[key]
  return out
}

function cursor(rows) {
  let list = rows
  const api = {
    sort(spec) {
      const [[key, dir]] = Object.entries(spec)
      list = [...list].sort((a, b) => (get(a, key) > get(b, key) ? dir : get(a, key) < get(b, key) ? -dir : 0))
      return api
    },
    limit(n) {
      list = list.slice(0, n)
      return api
    },
    toArray: async () => list,
  }
  return api
}

/**
 * An in-memory collection. indexes: [{ keys: [fields], partial?(doc) → boolean }] unique indexes
 * a write must not break (a duplicate throws { code: 11000 }, as the driver does).
 */
export function memoryCollection({ indexes = [] } = {}) {
  const rows = []
  let n = 0
  const duplicate = (doc, except = null) => indexes.some((index) => {
    if (index.partial && !index.partial(doc)) return false
    return rows.some((row) => row !== except && (!index.partial || index.partial(row)) && index.keys.every((k) => same(get(row, k), get(doc, k))))
  })
  const fail = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
  const apply = (doc, update) => {
    const next = structuredClone(doc)
    for (const [k, v] of Object.entries(update.$set || {})) next[k] = structuredClone(v)
    for (const k of Object.keys(update.$unset || {})) delete next[k]
    for (const [k, v] of Object.entries(update.$inc || {})) next[k] = (next[k] || 0) + v
    return next
  }
  return {
    rows,
    find: (filter = {}, options = {}) => cursor(rows.filter((doc) => matches(doc, filter)).map((doc) => project(doc, options.projection))),
    async findOne(filter = {}, options = {}) {
      const doc = rows.find((row) => matches(row, filter))
      return doc ? project(doc, options.projection) : null
    },
    async insertOne(doc) {
      const row = structuredClone({ _id: doc._id ?? `row${(n += 1)}`, ...doc })
      if (rows.some((r) => r._id === row._id) || duplicate(row)) throw fail()
      rows.push(row)
      return { insertedId: row._id }
    },
    async updateOne(filter, update, options = {}) {
      const at = rows.findIndex((row) => matches(row, filter))
      if (at < 0) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 }
        const base = Object.fromEntries(Object.entries(filter).filter(([, v]) => v === null || typeof v !== 'object'))
        const row = apply({ _id: `row${(n += 1)}`, ...base, ...(update.$setOnInsert || {}) }, update)
        if (duplicate(row)) throw fail()
        rows.push(row)
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
      }
      const next = apply(rows[at], update)
      if (duplicate(next, rows[at])) throw fail()
      rows[at] = next
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async updateMany(filter, update) {
      let modified = 0
      for (let i = 0; i < rows.length; i += 1) {
        if (!matches(rows[i], filter)) continue
        rows[i] = apply(rows[i], update)
        modified += 1
      }
      return { modifiedCount: modified }
    },
    async replaceOne(filter, doc, options = {}) {
      const at = rows.findIndex((row) => matches(row, filter))
      const row = structuredClone({ ...doc, _id: doc._id ?? filter._id })
      if (at < 0) {
        if (!options.upsert) return { matchedCount: 0 }
        if (duplicate(row)) throw fail()
        rows.push(row)
        return { matchedCount: 0, upsertedCount: 1 }
      }
      if (duplicate(row, rows[at])) throw fail()
      rows[at] = row
      return { matchedCount: 1 }
    },
    async deleteOne(filter) {
      const at = rows.findIndex((row) => matches(row, filter))
      if (at >= 0) rows.splice(at, 1)
      return { deletedCount: at >= 0 ? 1 : 0 }
    },
    async deleteMany(filter) {
      let count = 0
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i], filter)) {
          rows.splice(i, 1)
          count += 1
        }
      }
      return { deletedCount: count }
    },
    async findOneAndUpdate(filter, update, options = {}) {
      await this.updateOne(filter, update, options)
      return this.findOne(filter)
    },
    async createIndex() {},
    aggregate: () => ({ toArray: async () => [] }),
  }
}

/** providerKeys with the server key indexes of metering/migrations.mjs M5. */
export function providerKeysCollection() {
  return memoryCollection({
    indexes: [
      { keys: ['ownerType', 'ownerId', 'provider', 'keyFingerprint'], partial: (d) => d.kind === 'key' },
      { keys: ['ownerType', 'ownerId', 'provider', 'kind'], partial: (d) => d.kind === 'key' && d.status === 'active' },
      { keys: ['ownerType', 'ownerId', 'name'], partial: (d) => typeof d.name === 'string' },
    ],
  })
}

const ADMIN = { userId: 'admin1', principal: 'person', via: 'ddp' }

/**
 * A whole AI control world. options: { master (vault master or null), settings, hosted, check(connection),
 * checkAux(connection), listModels(connection), now() }
 */
export async function aiControlWorld({ master = fakeMaster(), settings = { public: { env: 'selfhost' } }, hosted = false, check = async () => ({ ok: true, reachable: true, tools: 'yes', message: 'Connected.' }), checkAux = async () => ({ ok: true, message: 'Connected. The key works.' }), listModels = async () => ({ ok: true, models: [{ id: 'm1' }], message: '1 model listed.' }), now = () => new Date('2026-11-24T10:00:00Z') } = {}) {
  const raw = Object.fromEntries(Object.keys(COLLECTIONS).map((key) => [key, memoryCollection()]))
  const keys = providerKeysCollection()
  const choices = memoryCollection()
  const users = new Map([['admin1', { _id: 'admin1' }], ['ana', { _id: 'ana' }]])
  let keyStore = null
  const holder = createSnapshotHolder({
    read: {
      generation: async () => (await raw.state.findOne({ _id: 'global' }))?.generation ?? 0,
      async all() {
        return {
          state: await raw.state.findOne({ _id: 'global' }),
          providers: (await raw.providers.find({}).toArray()).filter((p) => p.status !== 'archived' && p.preset),
          models: (await raw.models.find({}).toArray()).filter((m) => m.provider),
          bindings: (await raw.bindings.find({}).toArray()).filter((b) => !String(b._id).includes('|')),
          prompts: [], promptVersions: [], agents: [],
          keys: await keyStore.activeSummary(),
        }
      },
    },
    setTimer: () => null,
  })
  let id = 0
  const store = createControlStore({ collections: raw, newId: () => `a${(id += 1)}`, now, onWrite: () => holder.refresh({ force: true }) })
  const audited = []
  keyStore = createKeyStore({
    keys, master, now,
    providerOf: (pid) => BUILTIN_PROVIDERS[pid] || mergeProviders(holder.current().providers)[pid] || null,
    check, checkAux,
    modelFor: (provider) => Object.values(holder.current().models).find((m) => m.provider === provider)?.model ?? null,
    audit: async (entry) => { audited.push(entry); return store.record(entry) },
    bump: async (actor) => { await store.bump(actor); await holder.refresh({ force: true }) },
    newId: () => randomBytes(6).toString('hex'),
  })
  const catalog = createCatalogOps({ store, snapshot: () => holder.current(), keys: keyStore, checkUrl: (url) => url.replace(/\/+$/, ''), readProvider: (pid) => raw.providers.findOne({ _id: pid }), listModels, check })
  const bindings = createBindingOps({ store, snapshot: () => holder.current() })
  setProviderSource(() => holder.current().providers)
  const aiSettings = createAISettings({
    store: createConnectionStore({ keys, choices }),
    master, settings, hosted,
    loadUser: async (uid) => users.get(uid) || null,
    isAdmin: async (uid) => uid === 'admin1',
    isTeamAdmin: async () => false,
    check,
  })
  aiSettings.setRouteSource(async ({ surface, useDefault }) => {
    const snapshot = await holder.ready()
    if (useDefault) return { enabled: true, source: 'default', route: defaultRoute(snapshot) }
    return resolveModel(snapshot, { surface })
  })
  aiSettings.setKeySource(keyStore)
  const control = createAIControl({ holder, choiceHolders: (uid) => aiSettings.choiceHolders(uid), keyed: (p) => keyStore.fromSettings().includes(p) })
  await holder.refresh({ force: true })
  return { raw, keys, choices, users, holder, store, keyStore, catalog, bindings, aiSettings, control, audited, actor: ADMIN, snapshot: () => holder.current() }
}

/** Every string in a value, deep (to check that no key appears anywhere). */
export function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, out))
  else if (value && typeof value === 'object' && !(value instanceof Date)) Object.values(value).forEach((item) => allStrings(item, out))
  return out
}

/** The action registry over a world (the deps server/actions/mount.js gives it). */
export async function registryFor(w, extra = {}) {
  const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
  const { createAdminOps } = await import('../web/app/server/ai-control/admin.mjs')
  const { createWriteLimit } = await import('../web/app/server/ai-control/models.mjs')
  const ops = createAdminOps({ store: w.store, audit: w.raw.audit, bindings: w.bindings })
  const deps = {
    ai: w.aiSettings, aiControl: w.control, aiControlAdmin: async (userId) => userId === 'admin1', aiControlOps: ops, aiControlStore: w.store,
    aiCatalog: w.catalog, aiKeys: w.keyStore, aiBindings: w.bindings, aiControlWriteLimit: createWriteLimit(), ...extra,
  }
  return createAppRegistry({ deps })
}
export const asPerson = (userId = 'admin1') => ({ kind: 'person', userId, tokenId: null, tokenName: null, scopes: [...API_TOKEN_SCOPES] })
export const asAgent = (userId = 'admin1', scopes = ['ai:admin', 'ai:admin:read']) => ({ kind: 'agent', userId, tokenId: `t-${userId}`, tokenName: 'Agent', scopes })
export const bodyOf = (result) => {
  const { mode: _mode, ...rest } = result.body ?? result
  return rest
}
