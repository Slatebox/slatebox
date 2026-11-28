// In-memory stand-ins for the MongoDB driver collections the projects code reads and writes
// (server/projects): findOne, find().toArray() with sort and limit, insertOne, updateOne (upsert),
// updateMany, deleteOne, deleteMany and countDocuments, over selectors with dotted paths, null for a
// missing field, $in, $ne, $exists, $regex, $or and $and. And a world: the projects core on them.
import { createProjectAccess } from '../web/app/server/projects/project-access.mjs'
import { createProjectsCore } from '../web/app/server/projects/core.mjs'

const get = (doc, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc)
function put(doc, path, value) {
  const keys = path.split('.')
  const parent = keys.slice(0, -1).reduce((record, key) => {
    if (record[key] == null || typeof record[key] !== 'object') record[key] = {}
    return record[key]
  }, doc)
  if (value === undefined) delete parent[keys.at(-1)]
  else parent[keys.at(-1)] = value
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const one = (have, want) => (Array.isArray(have) && !Array.isArray(want) ? have.some((item) => same(item, want)) : same(have, want))

export function matches(doc, selector = {}) {
  return Object.entries(selector).every(([path, want]) => {
    if (path === '$or') return want.some((branch) => matches(doc, branch))
    if (path === '$and') return want.every((branch) => matches(doc, branch))
    const have = path.includes('.') && path.split('.')[0] === 'emails' && Array.isArray(doc.emails)
      ? doc.emails.map((item) => get(item, path.split('.').slice(1).join('.')))
      : get(doc, path)
    if (want && typeof want === 'object' && !Array.isArray(want) && !(want instanceof Date)) {
      const ops = Object.keys(want)
      if (ops.some((op) => op.startsWith('$'))) {
        return ops.every((op) => {
          const arg = want[op]
          if (op === '$in') return arg.some((item) => one(have, item))
          if (op === '$ne') return !one(have, arg)
          if (op === '$exists') return (have !== undefined) === arg
          if (op === '$regex') {
            const re = new RegExp(arg, want.$options || '')
            return (Array.isArray(have) ? have : [have]).some((item) => typeof item === 'string' && re.test(item))
          }
          if (op === '$options') return true
          if (op === '$lt') return have != null && have < arg
          if (op === '$gt') return have != null && have > arg
          throw new Error(`fake mongo: ${op} is not supported`)
        })
      }
    }
    if (want === null) return have === null || have === undefined
    return one(have, want)
  })
}

function apply(doc, update) {
  for (const [path, value] of Object.entries(update.$set || {})) put(doc, path, structuredClone(value))
  for (const path of Object.keys(update.$unset || {})) put(doc, path, undefined)
  for (const [path, value] of Object.entries(update.$inc || {})) put(doc, path, (get(doc, path) || 0) + value)
}

export function fakeCollection(initial = []) {
  const rows = new Map(initial.map((doc) => [doc._id, structuredClone(doc)]))
  const all = (selector) => [...rows.values()].filter((doc) => matches(doc, selector))
  return {
    rows,
    docs: () => [...rows.values()].map((doc) => structuredClone(doc)),
    async findOne(selector = {}) {
      const found = all(selector)[0]
      return found ? structuredClone(found) : null
    },
    find(selector = {}, { sort, limit } = {}) {
      return {
        async toArray() {
          let out = all(selector).map((doc) => structuredClone(doc))
          if (sort) {
            const [[key, dir]] = Object.entries(sort)
            out.sort((a, b) => ((get(a, key) ?? 0) > (get(b, key) ?? 0) ? dir : (get(a, key) ?? 0) < (get(b, key) ?? 0) ? -dir : 0))
          }
          if (limit) out = out.slice(0, limit)
          return out
        },
      }
    },
    async insertOne(doc) {
      if (rows.has(doc._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
      rows.set(doc._id, structuredClone(doc))
      return { insertedId: doc._id }
    },
    async updateOne(selector, update, { upsert = false } = {}) {
      const found = all(selector)[0]
      if (!found) {
        if (!upsert) return { matchedCount: 0, modifiedCount: 0 }
        const doc = { _id: selector._id }
        apply(doc, update)
        rows.set(doc._id, doc)
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
      }
      apply(found, update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async updateMany(selector, update) {
      const found = all(selector)
      for (const doc of found) apply(doc, update)
      return { matchedCount: found.length, modifiedCount: found.length }
    },
    async deleteOne(selector) {
      const found = all(selector)[0]
      if (found) rows.delete(found._id)
      return { deletedCount: found ? 1 : 0 }
    },
    async deleteMany(selector) {
      const found = all(selector)
      for (const doc of found) rows.delete(doc._id)
      return { deletedCount: found.length }
    },
    async countDocuments(selector = {}) {
      return all(selector).length
    },
  }
}

/**
 * A world: people (ana owns things; ben and cy are teammates in team t1, where dee is its admin;
 * eve is in team t2; gus is a guest account), the collections, the access loader and the core.
 */
export function projectWorld({ users: extraUsers = [] } = {}) {
  const users = fakeCollection([
    { _id: 'ana', orgId: 't1', profile: { firstName: 'Ana', lastName: 'Lima' }, emails: [{ address: 'ana@example.com', verified: true }] },
    { _id: 'ben', orgId: 't1', profile: { firstName: 'Ben' }, emails: [{ address: 'ben@example.com', verified: true }] },
    { _id: 'cy', orgId: 't1', profile: { firstName: 'Cy' }, emails: [{ address: 'cy@example.com', verified: true }] },
    { _id: 'dee', orgId: 't1', profile: { firstName: 'Dee' }, emails: [{ address: 'dee@example.com', verified: true }] },
    { _id: 'eve', orgId: 't2', profile: { firstName: 'Eve' }, emails: [{ address: 'eve@example.com', verified: true }] },
    { _id: 'fay', profile: { firstName: 'Fay' }, emails: [{ address: 'fay@example.com', verified: true }] },
    { _id: 'gus', isAnonymous: true },
    ...extraUsers,
  ])
  const projects = fakeCollection()
  const projectAccess = fakeCollection()
  const slates = fakeCollection()
  const claims = new Set(['dee:admin', 'ben:canAddSlates'])
  const isTeamAdmin = async (userId) => claims.has(`${userId}:admin`)
  const access = createProjectAccess({ projects, projectAccess, users, isTeamAdmin })
  const recorded = []
  const deleted = []
  const hookCalls = { deleted: [], accessLost: [] }
  const hooks = { deleted: [(id) => hookCalls.deleted.push(id)], accessLost: [(event) => hookCalls.accessLost.push(event)] }
  let n = 0
  let k = 0
  const created = []
  const core = createProjectsCore({
    stores: { projects, projectAccess, slates, users },
    access,
    audit: { record: async (entry) => recorded.push(entry) },
    deleteOwnedSlate: async (slate) => {
      deleted.push(slate.shareId)
      await slates.deleteOne({ _id: slate._id })
    },
    saveCore: {
      async create({ row, actor, source }) {
        created.push({ row, actor, source })
        await slates.insertOne({ ...row, revision: 1 })
        return { created: true, revision: 1 }
      },
    },
    hooks,
    hasClaim: async (userId, claim) => claims.has(`${userId}:${claim}`),
    newId: () => `p${(n += 1)}`,
    generateKey: () => `key${String((k += 1)).padStart(21, '0')}`,
    generateShareId: async () => `sh${(n += 1)}`,
    now: () => new Date('2026-11-27T12:00:00Z'),
    appOrigin: () => 'https://app.example',
    teamName: async (orgId) => (orgId === 't1' ? 'Acme' : ''),
  })
  const person = (userId) => ({ kind: 'person', userId, tokenId: null, scopes: [] })
  const token = (userId) => ({ kind: 'agent', userId, tokenId: `tok-${userId}`, scopes: ['projects:read', 'projects:write', 'projects:share'] })
  async function slate(id, userId, projectId = null, extra = {}) {
    const doc = { _id: id, shareId: `s-${id}`, userId, orgId: (await users.findOne({ _id: userId }))?.orgId ?? null, projectId, options: { name: `Slate ${id}`, isPrivate: true }, lastSaved: 1, ...extra }
    await slates.insertOne(doc)
    return doc
  }
  return { users, projects, projectAccess, slates, claims, access, core, recorded, deleted, hookCalls, created, person, token, slate }
}
