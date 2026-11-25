// An in-memory stand-in for the MongoDB driver collections the team export and import use:
// find (selector, projection, sort, limit; a cursor with toArray and async iteration), findOne,
// insertOne (a duplicate _id answers code 11000), updateOne and updateMany ($set, $unset,
// $setOnInsert, upsert), deleteMany, countDocuments. Selectors: dotted paths (through arrays
// of documents too), equality (an array field matches an element), $ne, $in, $exists, $gt, $gte,
// $lt, $lte, $size, $regex with $options.
// A path through an array of documents (emails.address) gives each element's value, as MongoDB does.
const get = (doc, path) =>
  path.split('.').reduce((value, key) => {
    if (value == null) return undefined
    if (Array.isArray(value) && !/^\d+$/.test(key)) return value.flatMap((item) => (item == null ? [] : [item[key]])).filter((item) => item !== undefined)
    return value[key]
  }, doc)
const put = (doc, path, value) => {
  const keys = path.split('.')
  let at = doc
  for (const key of keys.slice(0, -1)) at = at[key] && typeof at[key] === 'object' ? at[key] : (at[key] = {})
  if (value === undefined) delete at[keys.at(-1)]
  else at[keys.at(-1)] = value
}
const plain = (value) => (value instanceof Date ? value.valueOf() : value)
const same = (a, b) => JSON.stringify(plain(a)) === JSON.stringify(plain(b))
const clone = (value) => structuredClone(value)

function test(have, want) {
  if (want && typeof want === 'object' && !Array.isArray(want) && !(want instanceof Date) && Object.keys(want).some((key) => key.startsWith('$'))) {
    return Object.entries(want).every(([op, arg]) => {
      if (op === '$ne') return Array.isArray(have) ? !have.some((item) => same(item, arg)) : !(same(have, arg) || (arg === null && have === undefined))
      if (op === '$in') return arg.some((item) => (Array.isArray(have) ? have.some((h) => same(h, item)) : same(have, item) || (item === null && have === undefined)))
      if (op === '$exists') return (have !== undefined) === Boolean(arg)
      if (op === '$size') return Array.isArray(have) && have.length === arg
      if (op === '$options') return true // read with $regex
      if (op === '$regex') {
        const re = new RegExp(arg, want.$options || '')
        return Array.isArray(have) ? have.some((item) => typeof item === 'string' && re.test(item)) : typeof have === 'string' && re.test(have)
      }
      if (have === undefined || have === null) return false
      if (op === '$gt') return plain(have) > plain(arg)
      if (op === '$gte') return plain(have) >= plain(arg)
      if (op === '$lt') return plain(have) < plain(arg)
      if (op === '$lte') return plain(have) <= plain(arg)
      throw new Error('memory store: unsupported operator ' + op)
    })
  }
  if (want === null) return have === null || have === undefined
  if (Array.isArray(have) && !Array.isArray(want)) return have.some((item) => same(item, want))
  return same(have, want)
}
const matches = (doc, selector = {}) => Object.entries(selector).every(([path, want]) => test(get(doc, path), want))

function project(doc, projection) {
  if (!projection || !Object.keys(projection).length) return clone(doc)
  const including = Object.entries(projection).some(([key, keep]) => keep && key !== '_id')
  if (including) {
    const out = { _id: doc._id }
    for (const [path, keep] of Object.entries(projection)) if (keep) {
      const value = get(doc, path)
      if (value !== undefined) put(out, path, clone(value))
    }
    if (projection._id === 0) delete out._id
    return out
  }
  const out = clone(doc)
  for (const [path, keep] of Object.entries(projection)) if (!keep) put(out, path, undefined)
  return out
}

function apply(doc, update, inserting) {
  for (const [op, fields] of Object.entries(update)) {
    for (const [path, value] of Object.entries(fields)) {
      if (op === '$set') put(doc, path, clone(value))
      else if (op === '$setOnInsert') { if (inserting) put(doc, path, clone(value)) }
      else if (op === '$unset') put(doc, path, undefined)
      else if (op === '$inc') put(doc, path, (get(doc, path) || 0) + value)
      else throw new Error('memory store: unsupported update ' + op)
    }
  }
}

export function memoryCollection(name = 'docs') {
  const rows = new Map()
  const select = (selector, options = {}) => {
    let found = [...rows.values()].filter((doc) => matches(doc, selector))
    const sort = Object.entries(options.sort || {})
    if (sort.length) found.sort((a, b) => {
      for (const [path, dir] of sort) {
        const x = plain(get(a, path)), y = plain(get(b, path))
        if (x !== y) return (x > y ? 1 : -1) * dir
      }
      return 0
    })
    if (options.limit) found = found.slice(0, options.limit)
    return found.map((doc) => project(doc, options.projection))
  }
  return {
    name,
    rows,
    docs: () => [...rows.values()].map(clone),
    find(selector, options) {
      const list = () => select(selector, options)
      return {
        toArray: async () => list(),
        async *[Symbol.asyncIterator]() {
          for (const doc of list()) yield doc
        },
      }
    },
    async findOne(selector, options) {
      return select(selector, { ...options, limit: 1 })[0] ?? null
    },
    async insertOne(doc) {
      const _id = doc._id ?? `${name}-${rows.size + 1}`
      if (rows.has(_id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
      rows.set(_id, clone({ ...doc, _id }))
      return { insertedId: _id }
    },
    async updateOne(selector, update, options = {}) {
      const found = [...rows.values()].find((doc) => matches(doc, selector))
      if (!found) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 }
        const doc = {}
        for (const [path, value] of Object.entries(selector)) if (!path.startsWith('$') && (value === null || typeof value !== 'object')) put(doc, path, value)
        apply(doc, update, true)
        if (doc._id === undefined) doc._id = `${name}-${rows.size + 1}`
        rows.set(doc._id, doc)
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
      }
      apply(found, update, false)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async updateMany(selector, update) {
      const found = [...rows.values()].filter((doc) => matches(doc, selector))
      for (const doc of found) apply(doc, update, false)
      return { matchedCount: found.length, modifiedCount: found.length }
    },
    async replaceOne(selector, replacement, options = {}) {
      const found = [...rows.values()].find((doc) => matches(doc, selector))
      const _id = found?._id ?? selector._id
      if (!found && !options.upsert) return { matchedCount: 0, modifiedCount: 0 }
      rows.set(_id, clone({ ...replacement, _id }))
      return { matchedCount: found ? 1 : 0, modifiedCount: found ? 1 : 0 }
    },
    async deleteMany(selector) {
      let deletedCount = 0
      for (const [id, doc] of rows) if (matches(doc, selector)) {
        rows.delete(id)
        deletedCount += 1
      }
      return { deletedCount }
    },
    async countDocuments(selector) {
      return select(selector).length
    },
  }
}

export const DB_NAMES = [
  'organizations', 'users', 'permissions', 'slates', 'events', 'snapshots', 'comments', 'presentations',
  'presentationChats', 'slateAccess', 'orgSettings', 'providerKeys', 'aiChoices', 'apiTokens', 'imports', 'importMap', 'tickets',
  'libraryItems', 'libraryVersions',
]
export const memoryDb = () => Object.fromEntries(DB_NAMES.map((name) => [name, memoryCollection(name)]))
