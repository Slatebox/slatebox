// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Where team addresses are kept. One interface, two stores: memoryStore for tests and tools, and
// mongoStore over the MongoDB driver collections Meteor gives (meteor.js). The database is the
// source of truth for which names are taken: one live claim per name (a unique index partial on
// the live statuses), so two people racing for a name get one claim and one "unavailable".
//
//   teamAddresses          the claims (claims.mjs documents the shape); never a connector token.
//                          liveName mirrors name while the claim is live and is absent otherwise:
//                          its unique index is what makes a name one claim's (a partial index on
//                          a string field works on every MongoDB version; one on $in does not)
//   teamAddressTombstones  names held after release or rename: { name, ownerId|null, until }
//   teamAddressAudit       append-only: { at, actor, action, claimId, name, ok, error?, ipHash, uaShort }
//   teamAddressBlocklist   administrators' extra names: { _id, pattern, kind, reason, by, at }
//   teamAddressFlags       { _id: 'paused', value, by, at }
import { createWindowCounter, memoryWindowCounter } from '/server/oauth/device.mjs'

export const LIVE = Object.freeze(['pending', 'active', 'suspended', 'releasing'])
const duplicate = () => Object.assign(new Error('duplicate key'), { code: 11000 })
const clone = (value) => (value === undefined || value === null ? value : structuredClone(value))

function applySet(doc, set = {}, unset = []) {
  for (const [path, value] of Object.entries(set)) {
    const keys = path.split('.')
    let at = doc
    for (const key of keys.slice(0, -1)) at = at[key] && typeof at[key] === 'object' ? at[key] : (at[key] = {})
    at[keys.at(-1)] = clone(value)
  }
  for (const path of unset) {
    const keys = path.split('.')
    let at = doc
    for (const key of keys.slice(0, -1)) at = at?.[key]
    if (at) delete at[keys.at(-1)]
  }
}

export function memoryStore({ now = Date.now } = {}) {
  const claims = new Map()
  const tombstones = []
  const audit = []
  const blocklist = new Map()
  const flags = new Map()
  let sequence = 0
  const liveWithName = (name, exceptId) => [...claims.values()].find((doc) => doc.name === name && LIVE.includes(doc.status) && doc._id !== exceptId)
  const statusOk = (doc, status) => status === undefined || (Array.isArray(status) ? status.includes(doc.status) : doc.status === status)
  return {
    claims: {
      docs: claims,
      async insert(doc) {
        if (LIVE.includes(doc.status) && liveWithName(doc.name)) throw duplicate()
        claims.set(doc._id, clone(doc))
      },
      get: async (id) => clone(claims.get(id) || null),
      byKey: async (ownerId, key) => clone([...claims.values()].find((doc) => doc.ownerId === ownerId && doc.idempotencyKey === key && ['pending', 'active'].includes(doc.status)) || null),
      byCredentialPrefix: async (prefix) => clone([...claims.values()].find((doc) => doc.installCredential?.prefix === prefix) || null),
      liveByName: async (name) => clone(liveWithName(name) || null),
      async update(id, set, { status, unset } = {}) {
        const doc = claims.get(id)
        if (!doc || !statusOk(doc, status)) return false
        if (set?.name && LIVE.includes(set.status || doc.status) && liveWithName(set.name, id)) throw duplicate()
        applySet(doc, set, unset)
        return true
      },
      byOwner: async (ownerId) => [...claims.values()].filter((doc) => doc.ownerId === ownerId && LIVE.includes(doc.status)).map(clone),
      countLive: async (ownerId) => [...claims.values()].filter((doc) => LIVE.includes(doc.status) && (ownerId === undefined || doc.ownerId === ownerId)).length,
      inStatuses: async (statuses) => [...claims.values()].filter((doc) => statuses.includes(doc.status)).map(clone),
      needingCleanup: async () => [...claims.values()].filter((doc) => doc.needsCleanup).map(clone),
      async search({ q, limit = 100 } = {}) {
        const text = `${q || ''}`.trim().toLowerCase()
        return [...claims.values()]
          .filter((doc) => !text || doc.name.includes(text) || doc._id === text || doc.ownerId === text)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limit)
          .map(clone)
      },
    },
    tombstones: {
      docs: tombstones,
      async put({ name, ownerId, until }) {
        tombstones.push({ _id: `tomb-${(sequence += 1)}`, name, ownerId: ownerId ?? null, until })
      },
      // The hold that still applies to a name, the longest first.
      async get(name) {
        const live = tombstones.filter((doc) => doc.name === name && doc.until > now()).sort((a, b) => b.until - a.until)
        return clone(live.find((doc) => doc.ownerId === null) || live[0] || null)
      },
    },
    audit: {
      docs: audit,
      append: async (entry) => {
        audit.push({ _id: `audit-${(sequence += 1)}`, ...clone(entry) })
      },
      list: async ({ claimId, limit = 100 } = {}) => audit.filter((doc) => !claimId || doc.claimId === claimId).slice(-limit).reverse().map(clone),
    },
    blocklist: {
      list: async () => [...blocklist.values()].map(clone),
      async add(entry) {
        const _id = `block-${(sequence += 1)}`
        blocklist.set(_id, { _id, ...entry })
        return _id
      },
      remove: async (id) => blocklist.delete(id),
    },
    flags: {
      get: async (key) => clone(flags.get(key)?.value ?? null),
      set: async (key, value, by) => {
        flags.set(key, { value, by, at: now() })
      },
    },
    counter: memoryWindowCounter({ now }),
  }
}

/**
 * The same store over MongoDB driver collections (rawCollection()).
 * @param {{ claims, tombstones, audit, blocklist, flags, counters }} collections
 */
export function mongoStore(collections, { now = Date.now } = {}) {
  const { claims, tombstones, audit, blocklist, flags, counters } = collections
  const live = { $in: LIVE }
  const statusFilter = (status) => (status === undefined ? {} : { status: Array.isArray(status) ? { $in: status } : status })
  const rethrow = (error) => {
    if (error?.code === 11000) throw duplicate()
    throw error
  }
  return {
    claims: {
      insert: (doc) => claims.insertOne({ ...doc, ...(LIVE.includes(doc.status) && { liveName: doc.name }) }).then(() => undefined, rethrow),
      get: (id) => claims.findOne({ _id: id }),
      byKey: (ownerId, key) => claims.findOne({ ownerId, idempotencyKey: key, status: { $in: ['pending', 'active'] } }),
      byCredentialPrefix: (prefix) => claims.findOne({ 'installCredential.prefix': prefix }),
      liveByName: (name) => claims.findOne({ name, status: live }),
      async update(id, set, { status, unset } = {}) {
        const update = {}
        const fields = { ...(set || {}) }
        const remove = [...(unset || [])]
        const filter = { _id: id, ...statusFilter(status) }
        if ('status' in fields || 'name' in fields) {
          const current = await claims.findOne(filter, { projection: { name: 1, status: 1 } })
          if (!current) return false
          filter.status = current.status
          const nextStatus = fields.status ?? current.status
          if (LIVE.includes(nextStatus)) fields.liveName = fields.name ?? current.name
          else remove.push('liveName')
        }
        if (Object.keys(fields).length) update.$set = fields
        if (remove.length) update.$unset = Object.fromEntries(remove.map((key) => [key, '']))
        const result = await claims.updateOne(filter, update).catch(rethrow)
        return result.matchedCount > 0
      },
      byOwner: (ownerId) => claims.find({ ownerId, status: live }).sort({ createdAt: 1 }).toArray(),
      countLive: (ownerId) => claims.countDocuments({ status: live, ...(ownerId !== undefined && { ownerId }) }),
      inStatuses: (statuses) => claims.find({ status: { $in: statuses } }).toArray(),
      needingCleanup: () => claims.find({ needsCleanup: true }).toArray(),
      search({ q, limit = 100 } = {}) {
        const text = `${q || ''}`.trim().toLowerCase()
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const filter = text ? { $or: [{ name: { $regex: escaped } }, { _id: text }, { ownerId: text }] } : {}
        return claims.find(filter).sort({ createdAt: -1 }).limit(limit).toArray()
      },
    },
    tombstones: {
      put: ({ name, ownerId, until }) => tombstones.insertOne({ name, ownerId: ownerId ?? null, until: new Date(until) }).then(() => undefined),
      async get(name) {
        const rows = await tombstones.find({ name, until: { $gt: new Date(now()) } }).sort({ until: -1 }).toArray()
        const pick = rows.find((doc) => doc.ownerId === null) || rows[0]
        return pick ? { ...pick, until: pick.until.getTime() } : null
      },
    },
    audit: {
      append: (entry) => audit.insertOne({ ...entry, purgeAt: new Date(entry.at + 400 * 86_400_000) }).then(() => undefined),
      list: ({ claimId, limit = 100 } = {}) => audit.find(claimId ? { claimId } : {}, { projection: { purgeAt: 0 } }).sort({ at: -1 }).limit(limit).toArray(),
    },
    blocklist: {
      list: () => blocklist.find({}).toArray(),
      async add(entry) {
        const { insertedId } = await blocklist.insertOne({ ...entry })
        return String(insertedId)
      },
      remove: async (id) => (await blocklist.deleteOne({ _id: id })).deletedCount > 0,
    },
    flags: {
      get: async (key) => (await flags.findOne({ _id: key }))?.value ?? null,
      set: (key, value, by) => flags.updateOne({ _id: key }, { $set: { value, by, at: now() } }, { upsert: true }).then(() => undefined),
    },
    counter: createWindowCounter({ collection: counters, now }),
  }
}

// The indexes mongoStore relies on (meteor.js creates them at start).
export async function ensureIndexes({ claims, tombstones, audit, counters }) {
  await Promise.all([
    claims.createIndex({ liveName: 1 }, { unique: true, partialFilterExpression: { liveName: { $type: 'string' } } }),
    claims.createIndex({ name: 1 }),
    claims.createIndex({ ownerId: 1, status: 1 }),
    claims.createIndex({ 'installCredential.prefix': 1 }, { partialFilterExpression: { 'installCredential.prefix': { $type: 'string' } } }),
    claims.createIndex({ status: 1 }),
    tombstones.createIndex({ until: 1 }, { expireAfterSeconds: 0 }),
    tombstones.createIndex({ name: 1 }),
    audit.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
    audit.createIndex({ claimId: 1, at: -1 }),
    counters.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ])
}
