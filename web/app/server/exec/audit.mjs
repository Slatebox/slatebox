// What exec keeps: one record per script run (execRuns), the confirmations people are asked
// for (execConfirmations), and the per-account run lock (execLocks). All three take MongoDB
// driver collections, so they run on the real database and on the test doubles alike.
//
// execRuns: {_id: execId, subject, userId, tokenId, tokenName, surface, intent, codeSha256,
//   code? (sealed runs only; secret input fields replaced, exec/redact.mjs), mode, execKeySha256, confirmId?, status, error?, calls:[...],
//   counters:{calls, operations, notesCreated, rewrittenText}, minReadRank,
//   heldId?, pending?:{<n>: method} (calls still running when a sealed run ended), startedAt,
//   endedAt?, expiresAt}
// The raw execKey and results are never stored; results are content.
import { problem } from '../actions/errors.mjs'

const DAY = 86400000
const isDuplicate = (error) => error?.code === 11000

export function createExecStore({ runs, confirmations, locks, now = Date.now, auditDays = 30 }) {
  const expiry = () => new Date(now() + auditDays * DAY)
  return {
    // A sealed run is written once, when it ends.
    async writeRun(record) {
      await runs.insertOne({ ...record, expiresAt: expiry() })
    },

    // A local run is written call by call. The first call creates the record; a record with
    // this id that belongs to someone else answers 409.
    async claimLocalCall(execId, subject, base) {
      try {
        const record = await runs.findOneAndUpdate(
          { _id: execId, subject },
          {
            $setOnInsert: {
              ...base,
              status: 'running',
              calls: [],
              'counters.operations': 0,
              'counters.notesCreated': 0,
              'counters.rewrittenText': 0,
              minReadRank: null,
              heldId: null,
              startedAt: new Date(now()),
              expiresAt: expiry(),
            },
            $inc: { 'counters.calls': 1 },
          },
          { upsert: true, returnDocument: 'after', includeResultMetadata: false }
        )
        return record
      } catch (error) {
        if (isDuplicate(error))
          throw problem(409, 'exec_id_taken', 'That Slatebox-Exec-Id belongs to another run. Start a new run.')
        throw error
      }
    },

    // A sealed run's call that was still running when its record was written: its outcome
    // joins the record when it settles.
    async settleRunCall(execId, n, call) {
      await runs.updateOne(
        { _id: execId },
        { $unset: { [`pending.${n}`]: '' }, ...(call && { $push: { calls: call } }) }
      )
    },

    async recordLocalCall(execId, { call, operations = 0, notesCreated = 0, rewritten, readRank, confirmedUsed }) {
      const update = {
        $push: { calls: call, ...(confirmedUsed && { confirmedUsed }) },
        $inc: { 'counters.operations': operations, 'counters.notesCreated': notesCreated },
        $set: { endedAt: new Date(now()) },
      }
      if (rewritten) update.$inc['counters.rewrittenText'] = rewritten.count
      if (readRank !== undefined && readRank !== null) update.$min = { minReadRank: readRank }
      await runs.updateOne({ _id: execId }, update)
    },

    // One confirmation per run: the first hold names it, later holds join it.
    async heldIdFor(execId, candidate) {
      await runs.updateOne(
        { _id: execId, heldId: null },
        { $set: { heldId: candidate, status: 'confirmation_required' } }
      )
      const record = await runs.findOne({ _id: execId })
      return record?.heldId || candidate
    },

    getRun: (subject, execId) => runs.findOne({ _id: execId, subject }),

    // Confirmations -------------------------------------------------------------------
    async addHeld(id, { subject, codeSha256, expiresAt }, fingerprint, reasons) {
      await confirmations.findOneAndUpdate(
        { _id: id },
        {
          $setOnInsert: { subject, codeSha256, expiresAt, usedAt: null, usedBy: null, createdAt: new Date(now()) },
          $push: { fingerprints: fingerprint, reasons: { $each: reasons } },
        },
        { upsert: true, returnDocument: 'after', includeResultMetadata: false }
      )
    },

    // Single use: the first run that presents the id takes it. The same run may present it on
    // every call (a local run sends it as a header each time).
    async claimConfirmation({ id, subject, codeSha256, execId }) {
      const invalid = () =>
        problem(
          409,
          'confirmation_invalid',
          'That confirmation is expired, used, or for different code. Run the script again without confirm.'
        )
      const record = await confirmations.findOne({ _id: id })
      if (!record || record.subject !== subject || record.codeSha256 !== codeSha256) throw invalid()
      if (new Date(record.expiresAt).getTime() <= now()) throw invalid()
      if (record.usedAt) {
        if (record.usedBy === execId) return record
        throw invalid()
      }
      const taken = await confirmations.updateOne(
        { _id: id, usedAt: null },
        { $set: { usedAt: new Date(now()), usedBy: execId } }
      )
      if (!taken.matchedCount) throw invalid()
      return record
    },

    // Per-account run lock --------------------------------------------------------------
    async lock(userId, holder, ms) {
      const until = now() + ms
      try {
        await locks.insertOne({ _id: userId, until, holder, expiresAt: new Date(until + 60000) })
        return true
      } catch (error) {
        if (!isDuplicate(error)) throw error
      }
      const taken = await locks.updateOne(
        { _id: userId, until: { $lte: now() } },
        { $set: { until, holder, expiresAt: new Date(until + 60000) } }
      )
      return taken.matchedCount > 0
    },
    unlock: (userId, holder) => locks.deleteOne({ _id: userId, holder }),
  }
}

// Indexes the Meteor side creates at start.
export async function ensureExecIndexes({ runs, confirmations, locks }) {
  await runs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await runs.createIndex({ subject: 1, startedAt: -1 })
  await confirmations.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await locks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}
