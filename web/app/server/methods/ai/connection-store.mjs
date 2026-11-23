// Where AI connections and choices are kept: providerKeys (one document per connection, the key
// sealed) and aiChoices (one document per owner). Takes the raw MongoDB collections, so the same
// code runs under Meteor (ai-settings.js) and against a real database in tests.
//
// providerKeys holds two kinds of documents: named connections (unique per owner and name) and the
// older unnamed own keys (unique per owner and provider; metering/migrations.mjs has the indexes).
import { randomUUID } from 'node:crypto'

// The names the older unnamed keys go by (ai-settings-core.mjs fromDoc).
const LEGACY_PROVIDER = { 'own-model': 'openai-compatible', deepinfra: 'deepinfra' }
const ownerFilter = (owner) => ({ ownerType: owner.type, ownerId: owner.id })

export function createConnectionStore({ keys, choices, newId = () => randomUUID().replaceAll('-', '').slice(0, 17) }) {
  return {
    // the ciphers are read here and never leave the server
    listConnections: (owner) => keys.find({ /* vault-read */ ...ownerFilter(owner) }).toArray(),
    async saveConnection(owner, doc) {
      await keys.updateOne(
        { ...ownerFilter(owner), name: doc.name },
        { $set: { ...ownerFilter(owner), ...doc }, $setOnInsert: { _id: newId() } },
        { upsert: true },
      )
    },
    async removeConnection(owner, name) {
      await keys.deleteMany({ ...ownerFilter(owner), $or: [{ name }, ...(LEGACY_PROVIDER[name] ? [{ name: { $exists: false }, provider: LEGACY_PROVIDER[name] }] : [])] })
    },
    getUse: (owner) => choices.findOne({ _id: `${owner.type}:${owner.id}` }),
    async setUse(owner, value) {
      const { _id: _ignored, ...rest } = value
      await choices.replaceOne({ _id: `${owner.type}:${owner.id}` }, { ...rest, updated: Date.now() }, { upsert: true })
    },
  }
}
