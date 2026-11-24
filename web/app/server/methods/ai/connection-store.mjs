// Where AI connections and choices are kept: providerKeys (one document per connection, the key
// sealed) and aiChoices (one document per owner). Takes the raw MongoDB collections, so the same
// code runs under Meteor (ai-settings.js) and against a real database in tests.
//
// providerKeys holds two kinds of documents: named connections (unique per owner and name) and the
// older unnamed own keys (unique per owner and provider; metering/migrations.mjs has the indexes).
// A named connection also says where its key lives (keyRef: sealed in cipher, an environment
// variable, or none), which key it is (keyFingerprint), when it was rotated (keyRotatedAt) and the
// key it replaced while that keeps working (previousCipher { cipher, keyId, until }), whether it
// is turned off (status) and its last test (lastCheck { at, ok, latencyMs, error }).
import { randomUUID } from 'node:crypto'

// The names the older unnamed keys go by (ai-settings-core.mjs fromDoc).
const LEGACY_PROVIDER = { 'own-model': 'openai-compatible', deepinfra: 'deepinfra' }
const ownerFilter = (owner) => ({ ownerType: owner.type, ownerId: owner.id })

// A choice may name a part of a feature (chat.route, agent.slatebox: ai-control/catalogue.mjs).
// MongoDB field names do not take dots, so aiChoices keeps them as `__` (surface ids never hold
// an underscore) and reads them back as dots. Keys without a dot are stored as they are.
export const encodeUseKeys = (use) => (use && typeof use === 'object'
  ? Object.fromEntries(Object.entries(use).map(([key, ref]) => [key.replaceAll('.', '__'), ref]))
  : use)
export const decodeUseKeys = (use) => (use && typeof use === 'object'
  ? Object.fromEntries(Object.entries(use).map(([key, ref]) => [key.replaceAll('__', '.'), ref]))
  : use)

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
    // the outcome of the last Test connection of one connection (never a key: the error is redacted)
    async setLastCheck(owner, name, lastCheck) {
      await keys.updateOne({ ...ownerFilter(owner), name }, { $set: { lastCheck } })
    },
    // a rotated key's grace period is over: the key it replaced is dropped (spec 6.3)
    async clearExpiredGrace(at = new Date()) {
      const result = await keys.updateMany({ 'previousCipher.until': { $lt: at } }, { $set: { previousCipher: null } })
      return result?.modifiedCount ?? 0
    },
    async getUse(owner) {
      const doc = await choices.findOne({ _id: `${owner.type}:${owner.id}` })
      return doc?.use ? { ...doc, use: decodeUseKeys(doc.use) } : doc
    },
    async setUse(owner, value) {
      const { _id: _ignored, ...rest } = value
      await choices.replaceOne({ _id: `${owner.type}:${owner.id}` }, { ...rest, ...(rest.use && { use: encodeUseKeys(rest.use) }), updated: Date.now() }, { upsert: true })
    },
  }
}
