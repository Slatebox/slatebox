// The idempotency record the registry keeps for every write that carries a key.
// One record per (caller, key): the action it was used for, a fingerprint of the request,
// and, once the first request finished, its answer. A repeat with the same request gets that
// answer; a repeat with a different request is refused. A record whose request died while
// running is taken over after `staleMs`.
//
// A record, and the answer it replays (which can hold slate and comment text), is kept 24 hours
// after it is written (IDEMPOTENCY_TTL_MS): MongoDB removes it by its expiresAt (a TTL index,
// ensureIdempotencyIndexes), and until it does, reads treat an expired record as absent. A key
// reused after that starts a new request; a canvas plan whose run receipt still names the key is
// refused (slates.applyOperations), never saved twice.
import { createHash } from 'node:crypto'

export const IDEMPOTENCY_TTL_MS = 24 * 3600_000

const recordId = (subject, key) =>
  createHash('sha256').update(JSON.stringify([subject, key])).digest('hex')

const live = (record, at) => record && !(record.expiresAt && new Date(record.expiresAt).getTime() <= at)

export async function ensureIdempotencyIndexes(collection) {
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

export function createIdempotencyStore({ collection, now = Date.now, staleMs = 60000, ttlMs = IDEMPOTENCY_TTL_MS }) {
  const fresh = (at, fields) => ({ ...fields, state: 'pending', lockedAt: at, createdAt: at, expiresAt: new Date(at + ttlMs) })
  return {
    async reserve({ subject, key, action, fingerprint }) {
      const _id = recordId(subject, key)
      const at = now()
      try {
        await collection.insertOne({ _id, ...fresh(at, { subject, action, fingerprint }) })
        return { state: 'reserved' }
      } catch (error) {
        if (error?.code !== 11000) throw error
      }
      const record = await collection.findOne({ _id })
      if (!record) return { state: 'existing', record: null }
      if (!live(record, at)) {
        // Expired but not yet swept: this request starts over, and the old answer is dropped.
        const taken = await collection.updateOne(
          { _id, createdAt: record.createdAt },
          { $set: fresh(at, { subject, action, fingerprint }), $unset: { response: '', completedAt: '' } }
        )
        if (taken.matchedCount) return { state: 'reserved' }
        return { state: 'existing', record: await collection.findOne({ _id }) }
      }
      if (
        record.state === 'pending' &&
        record.action === action &&
        record.fingerprint === fingerprint &&
        at - record.lockedAt > staleMs
      ) {
        const taken = await collection.updateOne(
          { _id, state: 'pending', lockedAt: record.lockedAt },
          { $set: { lockedAt: at } }
        )
        if (taken.matchedCount) return { state: 'reserved' }
      }
      return { state: 'existing', record }
    },
    async get(subject, key) {
      const record = await collection.findOne({ _id: recordId(subject, key) })
      return live(record, now()) ? record : null
    },
    async complete(subject, key, response) {
      await collection.updateOne(
        { _id: recordId(subject, key) },
        { $set: { state: 'done', response, completedAt: now() }, $unset: { lockedAt: '' } }
      )
    },
    async release(subject, key) {
      await collection.deleteOne({ _id: recordId(subject, key), state: 'pending' })
    },
  }
}
