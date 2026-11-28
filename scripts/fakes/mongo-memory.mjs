// An in-memory stand-in for the MongoDB driver's collection, with the subset of queries and
// updates the recipes runtime uses (MIT, test support). Two "pods" sharing one of these race the
// way two servers sharing one database do: every call is atomic, as each Mongo command is.
//   find(q, { sort, limit, projection }).toArray()  findOne  insertOne (11000 on a taken _id)
//   updateOne / updateMany (upsert)  findOneAndUpdate (sort, returnDocument)  deleteOne / deleteMany
//   countDocuments  createIndex (records the unique ones and enforces them)
// Queries: equality (null also matches missing), dotted paths, arrays contain, $eq $ne $gt $gte
// $lt $lte $in $nin $exists $or $and $not-free. Updates: $set $unset $inc $push ($each, $slice)
// $addToSet ($each) $pull $setOnInsert.

const clone = (value) => (value === undefined ? undefined : structuredClone(value))

function get(doc, path) {
  let value = doc
  for (const part of path.split('.')) {
    if (value === null || value === undefined) return undefined
    value = value[part]
  }
  return value
}
function set(doc, path, value) {
  const parts = path.split('.')
  let at = doc
  for (const part of parts.slice(0, -1)) {
    if (at[part] === null || typeof at[part] !== 'object') at[part] = {}
    at = at[part]
  }
  at[parts.at(-1)] = value
}
function unset(doc, path) {
  const parts = path.split('.')
  const parent = parts.length > 1 ? get(doc, parts.slice(0, -1).join('.')) : doc
  if (parent && typeof parent === 'object') delete parent[parts.at(-1)]
}

const comparable = (value) => (value instanceof Date ? value.getTime() : value)
const equal = (a, b) => {
  if (a instanceof Date || b instanceof Date) return comparable(a) === comparable(b)
  if (a && b && typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}
const isOperator = (value) => value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && Object.keys(value).some((key) => key.startsWith('$'))

function matchValue(actual, expected) {
  if (isOperator(expected)) {
    return Object.entries(expected).every(([op, arg]) => {
      const values = Array.isArray(actual) ? actual : [actual]
      switch (op) {
        case '$eq': return matchValue(actual, arg)
        case '$ne': return !matchValue(actual, arg)
        case '$gt': return values.some((v) => v !== undefined && v !== null && comparable(v) > comparable(arg))
        case '$gte': return values.some((v) => v !== undefined && v !== null && comparable(v) >= comparable(arg))
        case '$lt': return values.some((v) => v !== undefined && v !== null && comparable(v) < comparable(arg))
        case '$lte': return values.some((v) => v !== undefined && v !== null && comparable(v) <= comparable(arg))
        case '$in': return arg.some((item) => matchValue(actual, item))
        case '$nin': return !arg.some((item) => matchValue(actual, item))
        case '$exists': return (actual !== undefined) === Boolean(arg)
        default: throw new Error(`mongo-memory: ${op} is not supported`)
      }
    })
  }
  if (expected === null) return actual === null || actual === undefined
  if (Array.isArray(actual) && !Array.isArray(expected)) return actual.some((item) => equal(item, expected))
  return equal(actual, expected)
}

export function matches(doc, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some((q) => matches(doc, q))
    if (key === '$and') return expected.every((q) => matches(doc, q))
    return matchValue(get(doc, key), expected)
  })
}

function applyUpdate(doc, update, inserting) {
  for (const [op, fields] of Object.entries(update)) {
    for (const [path, value] of Object.entries(fields)) {
      switch (op) {
        case '$set': set(doc, path, clone(value)); break
        case '$setOnInsert': if (inserting) set(doc, path, clone(value)); break
        case '$unset': unset(doc, path); break
        case '$inc': set(doc, path, (get(doc, path) || 0) + value); break
        case '$push': {
          const list = Array.isArray(get(doc, path)) ? get(doc, path) : []
          const items = value && typeof value === 'object' && '$each' in value ? value.$each : [value]
          let next = [...list, ...clone(items)]
          if (value && typeof value === 'object' && '$slice' in value) next = value.$slice < 0 ? next.slice(value.$slice) : next.slice(0, value.$slice)
          set(doc, path, next)
          break
        }
        case '$addToSet': {
          const list = Array.isArray(get(doc, path)) ? [...get(doc, path)] : []
          const items = value && typeof value === 'object' && '$each' in value ? value.$each : [value]
          for (const item of items) if (!list.some((x) => equal(x, item))) list.push(clone(item))
          set(doc, path, list)
          break
        }
        case '$pull': {
          const list = Array.isArray(get(doc, path)) ? get(doc, path) : []
          set(doc, path, list.filter((item) => !(isOperator(value) || (value && typeof value === 'object' && !Array.isArray(value)) ? matches(item, value) : equal(item, value))))
          break
        }
        default: throw new Error(`mongo-memory: ${op} is not supported`)
      }
    }
  }
}

function sorter(sort) {
  const keys = Object.entries(sort || {})
  return (a, b) => {
    for (const [key, dir] of keys) {
      const x = comparable(get(a, key))
      const y = comparable(get(b, key))
      if (x === y) continue
      if (x === undefined || x === null) return -dir
      if (y === undefined || y === null) return dir
      return x < y ? -dir : dir
    }
    return 0
  }
}

let counter = 0
export function createMemoryCollection(name = 'c') {
  const docs = new Map()
  const uniques = []
  const duplicate = (key) => Object.assign(new Error(`E11000 duplicate key error collection: ${name} ${key}`), { code: 11000 })
  const checkUnique = (doc, selfId) => {
    for (const fields of uniques) {
      const values = fields.map((f) => get(doc, f))
      if (values.every((v) => v === undefined)) continue
      for (const other of docs.values()) if (other._id !== selfId && fields.every((f, k) => equal(get(other, f), values[k]))) throw duplicate(fields.join(','))
    }
  }
  const found = (query, sort) => [...docs.values()].filter((doc) => matches(doc, query)).sort(sorter(sort))
  const insert = (doc) => {
    const row = clone(doc)
    if (row._id === undefined) row._id = `${name}_${++counter}`
    if (docs.has(row._id)) throw duplicate('_id')
    checkUnique(row, row._id)
    docs.set(row._id, row)
    return row
  }
  const upsertFrom = (query, update) => {
    const base = {}
    for (const [key, value] of Object.entries(query)) if (!key.startsWith('$') && !isOperator(value)) set(base, key, clone(value))
    applyUpdate(base, update, true)
    return insert(base)
  }
  const updateDoc = (doc, update) => {
    const next = clone(doc)
    applyUpdate(next, update, false)
    checkUnique(next, doc._id)
    docs.set(doc._id, next)
    return next
  }
  return {
    name,
    docs,
    async createIndex(fields, options = {}) {
      if (options.unique) uniques.push(Object.keys(fields))
      return Object.keys(fields).join('_')
    },
    find(query = {}, { sort, limit, projection } = {}) {
      return {
        async toArray() {
          let rows = found(query, sort)
          if (limit) rows = rows.slice(0, limit)
          return rows.map((doc) => {
            const copy = clone(doc)
            if (projection) for (const key of Object.keys(copy)) if (key !== '_id' && !projection[key]) delete copy[key]
            return copy
          })
        },
      }
    },
    async findOne(query = {}, { sort } = {}) {
      return clone(found(query, sort)[0] ?? null)
    },
    async insertOne(doc) {
      const row = insert(doc)
      return { insertedId: row._id }
    },
    async insertMany(list) {
      for (const doc of list) insert(doc)
      return { insertedCount: list.length }
    },
    async updateOne(query, update, { upsert = false } = {}) {
      const doc = found(query)[0]
      if (!doc) {
        if (!upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
        const row = upsertFrom(query, update)
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: row._id }
      }
      updateDoc(doc, update)
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
    },
    async updateMany(query, update) {
      const rows = found(query)
      for (const doc of rows) updateDoc(doc, update)
      return { matchedCount: rows.length, modifiedCount: rows.length }
    },
    async findOneAndUpdate(query, update, { sort, returnDocument = 'before', upsert = false } = {}) {
      const doc = found(query, sort)[0]
      if (!doc) {
        if (!upsert) return null
        const row = upsertFrom(query, update)
        return returnDocument === 'after' ? clone(row) : null
      }
      const before = clone(doc)
      const after = updateDoc(doc, update)
      return clone(returnDocument === 'after' ? after : before)
    },
    async deleteOne(query) {
      const doc = found(query)[0]
      if (doc) docs.delete(doc._id)
      return { deletedCount: doc ? 1 : 0 }
    },
    async deleteMany(query) {
      const rows = found(query)
      for (const doc of rows) docs.delete(doc._id)
      return { deletedCount: rows.length }
    },
    async countDocuments(query = {}) {
      return found(query).length
    },
  }
}

/** A set of named collections, created on first use. */
export function createMemoryDb() {
  const collections = new Map()
  return new Proxy({}, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      if (!collections.has(key)) collections.set(key, createMemoryCollection(key))
      return collections.get(key)
    },
  })
}
