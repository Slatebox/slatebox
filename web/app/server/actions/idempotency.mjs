// The idempotency record the registry keeps for every write that carries a key.
// One record per (caller, key): the action it was used for, a fingerprint of the request,
// and, once the first request finished, its answer. A repeat with the same request gets that
// answer; a repeat with a different request is refused. A record whose request died while
// running is taken over after `staleMs`.
//
// Records do not expire yet: the operation-run receipts they sit beside are kept for ever
// under a unique (tokenId, idempotencyKey) index, so an expired record would let a reused
// key fail after its write. Expiry comes with the one save path (P05), which owns the runs.
import { createHash } from 'node:crypto'

const recordId = (subject, key) =>
  createHash('sha256').update(JSON.stringify([subject, key])).digest('hex')

export function createIdempotencyStore({ collection, now = Date.now, staleMs = 60000 }) {
  return {
    async reserve({ subject, key, action, fingerprint }) {
      const _id = recordId(subject, key)
      const at = now()
      try {
        await collection.insertOne({
          _id,
          subject,
          action,
          fingerprint,
          state: 'pending',
          lockedAt: at,
          createdAt: at,
        })
        return { state: 'reserved' }
      } catch (error) {
        if (error?.code !== 11000) throw error
      }
      const record = await collection.findOne({ _id })
      if (!record) return { state: 'existing', record: null }
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
    get: (subject, key) => collection.findOne({ _id: recordId(subject, key) }),
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
