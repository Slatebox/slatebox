// An in-memory stand-in for the two MongoDB collections self-hosted updates use (systemSettings and
// selfHostUpdateEvents), with just the driver calls and operators store.mjs makes. Shared by the
// updates tests in scripts/.
const clone = value => (value === undefined ? undefined : structuredClone(value))
const get = (doc, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc)
function set(doc, path, value) {
  const keys = path.split('.')
  let at = doc
  for (const key of keys.slice(0, -1)) at = at[key] ??= {}
  at[keys.at(-1)] = value
}
const cmp = (a, b) => (a instanceof Date ? a.getTime() : a) - (b instanceof Date ? b.getTime() : b)

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([key, cond]) => {
    if (key === '$or') return cond.some(part => matches(doc, part))
    const value = get(doc, key)
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some(k => k.startsWith('$'))) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$exists') return (value !== undefined) === arg
        if (op === '$lte') return value != null && cmp(value, arg) <= 0
        if (op === '$lt') return value != null && cmp(value, arg) < 0
        if (op === '$gte') return value != null && cmp(value, arg) >= 0
        if (op === '$ne') return Array.isArray(value) ? !value.includes(arg) : value !== arg
        if (op === '$in') return arg.includes(value)
        throw new Error(`fake store: no ${op}`)
      })
    }
    if (cond === null) return value === null || value === undefined
    return JSON.stringify(value) === JSON.stringify(cond)
  })
}

export class FakeCollection {
  constructor(rows = []) { this.rows = rows.map(clone); this.calls = [] }

  async findOne(filter) { return clone(this.rows.find(row => matches(row, filter)) || null) }

  async updateOne(filter, update, { upsert = false } = {}) {
    this.calls.push({ op: 'updateOne', filter, update })
    let row = this.rows.find(r => matches(r, filter))
    let upserted = false
    if (!row) {
      if (!upsert) return { matchedCount: 0, modifiedCount: 0 }
      row = { _id: filter._id }
      this.rows.push(row)
      upserted = true
      for (const [k, v] of Object.entries(update.$setOnInsert || {})) set(row, k, clone(v))
    }
    for (const [k, v] of Object.entries(update.$set || {})) set(row, k, clone(v))
    for (const [k] of Object.entries(update.$unset || {})) set(row, k, undefined)
    for (const [k, v] of Object.entries(update.$push || {})) {
      const list = get(row, k) || []
      const items = v.$each ? v.$each : [v]
      let next = [...list, ...items]
      if (v.$slice !== undefined) next = v.$slice < 0 ? next.slice(v.$slice) : next.slice(0, v.$slice)
      set(row, k, next)
    }
    return { matchedCount: upserted ? 0 : 1, modifiedCount: upserted ? 0 : 1, upsertedCount: upserted ? 1 : 0 }
  }

  async insertOne(doc) { this.rows.push(clone(doc)); return { insertedId: doc._id } }

  find(filter = {}, { sort, skip = 0, limit, projection } = {}) {
    let rows = this.rows.filter(row => matches(row, filter))
    if (sort) {
      const [[key, dir]] = Object.entries(sort)
      rows = [...rows].sort((a, b) => dir * cmp(get(a, key), get(b, key)))
    }
    rows = rows.slice(skip, limit ? skip + limit : undefined)
    if (projection) rows = rows.map(row => Object.fromEntries(Object.keys(projection).map(k => [k, row[k]])))
    return { toArray: async () => rows.map(clone) }
  }

  async deleteMany(filter) {
    const before = this.rows.length
    this.rows = this.rows.filter(row => !matches(row, filter))
    return { deletedCount: before - this.rows.length }
  }
}

export const updateCols = () => ({ settings: new FakeCollection(), events: new FakeCollection() })

/** A db with .collection(name) for code that takes a database (self-host/rootfs/opt/slatebox/lib/updates.mjs). */
export function fakeDb({ users = [] } = {}) {
  const collections = new Map([['users', new FakeCollection(users)]])
  return { collection: name => { if (!collections.has(name)) collections.set(name, new FakeCollection()); return collections.get(name) } }
}
