// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What Slatebox keeps about GitHub App installations, over Mongo driver collections (deny-all in
// the browser, as every enterprise collection):
//   githubInstallations { _id: installationId (string), account, accountType, repos: ['owner/name'],
//                         allRepos, suspended, users: [userId], updated }
//   githubDeliveries    { _id: X-GitHub-Delivery, expiresAt }  (TTL: an hour; each delivery is handled once)
// users: the Slatebox people whose own GitHub sign-in was shown to see the installation (the install
// callback checks GET /user/installations), so a recipe runs only on installations its owner can see.

const asId = (id) => String(id)

export function createGithubStores({ installations, deliveries, now = () => Date.now() }) {
  return {
    installations: {
      get: (id) => installations.findOne({ _id: asId(id) }),
      async upsert(id, patch) {
        await installations.updateOne({ _id: asId(id) }, { $set: { ...patch, updated: new Date(now()) }, $setOnInsert: { users: [] } }, { upsert: true })
      },
      async setRepos(id, { added = [], removed = [] }) {
        if (added.length) await installations.updateOne({ _id: asId(id) }, { $addToSet: { repos: { $each: added } }, $set: { updated: new Date(now()) } }, { upsert: true })
        if (removed.length) await installations.updateOne({ _id: asId(id) }, { $pull: { repos: { $in: removed } }, $set: { updated: new Date(now()) } })
      },
      remove: (id) => installations.deleteOne({ _id: asId(id) }),
      async linkUser(id, userId) {
        await installations.updateOne({ _id: asId(id) }, { $addToSet: { users: String(userId) }, $set: { updated: new Date(now()) } }, { upsert: true })
      },
      async userCanSee(userId, id) {
        const doc = await installations.findOne({ _id: asId(id) })
        return Boolean(doc && !doc.suspended && (doc.users || []).includes(String(userId)))
      },
      /** The installations a person may pick from, with their repositories. */
      async forUser(userId) {
        const docs = await installations.find({ users: String(userId), suspended: { $ne: true } }).toArray()
        return docs.map((d) => ({ installationId: d._id, account: d.account ?? null, repos: [...(d.repos || [])].sort(), allRepos: Boolean(d.allRepos) }))
      },
    },
    deliveries: {
      /** true the first time a delivery id is seen in the hour. */
      async claim(id, expiresAt) {
        try {
          await deliveries.insertOne({ _id: String(id).slice(0, 80), expiresAt })
          return true
        } catch (error) {
          if (error?.code === 11000) return false
          throw error
        }
      },
    },
  }
}

/** The same stores in memory (tests, and a server with no database yet). */
export function memoryCollection() {
  const docs = new Map()
  const matches = (doc, q) =>
    Object.entries(q).every(([k, v]) => {
      if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne
      if (Array.isArray(doc[k])) return doc[k].includes(v)
      return doc[k] === v
    })
  const apply = (doc, update) => {
    for (const [k, v] of Object.entries(update.$set || {})) doc[k] = v
    for (const [k, v] of Object.entries(update.$addToSet || {})) {
      const list = doc[k] || (doc[k] = [])
      for (const item of v?.$each || [v]) if (!list.includes(item)) list.push(item)
    }
    for (const [k, v] of Object.entries(update.$pull || {})) doc[k] = (doc[k] || []).filter((x) => !(v.$in || [v]).includes(x))
  }
  return {
    docs,
    findOne: async (q) => [...docs.values()].find((d) => matches(d, q)) ?? null,
    find: (q) => ({ toArray: async () => [...docs.values()].filter((d) => matches(d, q)) }),
    async insertOne(doc) {
      if (docs.has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 })
      docs.set(doc._id, structuredClone(doc))
    },
    async updateOne(q, update, { upsert = false } = {}) {
      let doc = docs.get(q._id)
      if (!doc) {
        if (!upsert) return { matchedCount: 0 }
        doc = { _id: q._id, ...(update.$setOnInsert || {}) }
        docs.set(q._id, doc)
      }
      apply(doc, update)
      return { matchedCount: 1 }
    },
    deleteOne: async (q) => ({ deletedCount: docs.delete(q._id) ? 1 : 0 }),
  }
}
