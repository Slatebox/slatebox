// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Where Slack recipes keep what they need between runs (design B.3, with the shared channel ledger):
//   recipeInbox   messages Slack sent (Events API) waiting to be folded: ts, thread, author id,
//                 text (at most 4,000 characters), reactions; kept two days (TTL on expiresAt)
//   recipeLedger  a channel's rows (decisions, commitments, questions, concepts): extracts and
//                 permalinks, never message bodies; per (workspace, channel), each listing the
//                 instances that read it; kept 180 days by default (TTL on expiresAt)
//   recipeFolds   per channel: the last folded ts, when, the busy threads still to read, and the
//                 fold's lease (one fold per channel at a time across every server process)
// Two shapes: memory (tests) and Mongo (raw collections, enterprise/server/recipes/meteor.js).

export const INBOX_MS = 2 * 86400000
export const LEDGER_DAYS = 180
export const FOLD_LEASE_MS = 5 * 60000

export const inboxId = (teamId, channel, ts) => `slack:${teamId}:${channel}:${ts}`
export const ledgerId = (teamId, channel, key) => `slack:${teamId}:${channel}:${key}`
export const foldId = (teamId, channel) => `slack:${teamId}:${channel}`

const byTs = (a, b) => Number(a.ts) - Number(b.ts)
const strip = ({ _id, teamId, channel, instanceIds, expiresAt, ...row }) => row

/** In-memory stores (tests, a development server without Mongo). */
export function memorySlackStores() {
  const inbox = new Map()
  const ledger = new Map()
  const folds = new Map()
  return {
    inbox: {
      async put(row) {
        const before = inbox.get(row._id)
        inbox.set(row._id, { ...before, ...row, instanceIds: [...new Set([...(before?.instanceIds || []), ...(row.instanceIds || [])])] })
      },
      async patch(id, set) {
        const row = inbox.get(id)
        if (!row) return false
        inbox.set(id, { ...row, ...set })
        return true
      },
      get: async (id) => inbox.get(id) || null,
      // The channel's messages not yet folded (each message is folded once, whichever recipe folds).
      async list(teamId, channel) {
        return [...inbox.values()].filter((r) => r.teamId === teamId && r.channel === channel && !r.folded).sort(byTs).map(({ _id, teamId: _t, channel: _c, instanceIds, expiresAt, at, tsNum, folded, ...m }) => m)
      },
      async markFolded(teamId, channel, list) {
        for (const ts of list) {
          const row = inbox.get(inboxId(teamId, channel, ts))
          if (row) inbox.set(row._id, { ...row, folded: true })
        }
      },
      async dropInstance(instanceId) {
        for (const [id, row] of inbox) {
          const left = (row.instanceIds || []).filter((x) => x !== instanceId)
          if (!left.length) inbox.delete(id)
          else inbox.set(id, { ...row, instanceIds: left })
        }
      },
      _rows: inbox,
    },
    ledger: {
      all: async (teamId, channel) => [...ledger.values()].filter((r) => r.teamId === teamId && r.channel === channel).map(strip),
      async upsert(teamId, channel, instanceId, rows, expiresAt) {
        for (const row of rows) {
          const id = ledgerId(teamId, channel, row.key)
          const before = ledger.get(id)
          ledger.set(id, { ...row, _id: id, teamId, channel, instanceIds: [...new Set([...(before?.instanceIds || []), instanceId])], expiresAt })
        }
      },
      async remove(teamId, channel, keys) {
        for (const key of keys) ledger.delete(ledgerId(teamId, channel, key))
      },
      async dropInstance(instanceId) {
        for (const [id, row] of ledger) {
          const left = row.instanceIds.filter((x) => x !== instanceId)
          if (!left.length) ledger.delete(id)
          else ledger.set(id, { ...row, instanceIds: left })
        }
      },
      _rows: ledger,
    },
    folds: {
      get: async (teamId, channel) => {
        const row = folds.get(foldId(teamId, channel))
        return row && row.foldedTs !== undefined ? { foldedTs: row.foldedTs, lastFoldAt: row.lastFoldAt, backfilled: row.backfilled === true, pendingThreads: row.pendingThreads || [] } : null
      },
      async claim(teamId, channel, by, until, now) {
        const id = foldId(teamId, channel)
        const row = folds.get(id)
        if (row?.lease && row.lease.by !== by && Date.parse(row.lease.until) > now) return false
        folds.set(id, { ...row, lease: { by, until: new Date(until).toISOString() } })
        return true
      },
      async release(teamId, channel, by, patch) {
        const id = foldId(teamId, channel)
        const row = folds.get(id) || {}
        if (row.lease && row.lease.by !== by) return
        folds.set(id, { ...row, ...(patch || {}), lease: null })
      },
      _rows: folds,
    },
  }
}

/** The same stores over Mongo's raw collections (unique _id; claims are single atomic updates). */
export function mongoSlackStores({ inbox, ledger, folds }) {
  return {
    inbox: {
      async put({ instanceIds = [], ...row }) {
        await inbox.updateOne({ _id: row._id }, { $set: row, $addToSet: { instanceIds: { $each: instanceIds } } }, { upsert: true })
      },
      async patch(id, set) {
        return (await inbox.updateOne({ _id: id }, { $set: set })).matchedCount > 0
      },
      get: (id) => inbox.findOne({ _id: id }),
      async list(teamId, channel) {
        const rows = await inbox.find({ teamId, channel, folded: { $ne: true } }, { projection: { _id: 0, teamId: 0, channel: 0, instanceIds: 0, expiresAt: 0, at: 0, folded: 0 } }).sort({ tsNum: 1 }).limit(5000).toArray()
        return rows.map(({ tsNum, ...m }) => m)
      },
      async markFolded(teamId, channel, list) {
        if (list.length) await inbox.updateMany({ _id: { $in: list.map((ts) => inboxId(teamId, channel, ts)) } }, { $set: { folded: true } })
      },
      async dropInstance(instanceId) {
        await inbox.updateMany({ instanceIds: instanceId }, { $pull: { instanceIds: instanceId } })
        await inbox.deleteMany({ instanceIds: { $size: 0 } })
      },
    },
    ledger: {
      all: async (teamId, channel) => (await ledger.find({ teamId, channel }).limit(20000).toArray()).map(strip),
      async upsert(teamId, channel, instanceId, rows, expiresAt) {
        if (!rows.length) return
        await ledger.bulkWrite(rows.map((row) => ({ updateOne: { filter: { _id: ledgerId(teamId, channel, row.key) }, update: { $set: { ...row, teamId, channel, expiresAt }, $addToSet: { instanceIds: instanceId } }, upsert: true } })), { ordered: false })
      },
      async remove(teamId, channel, keys) {
        if (keys.length) await ledger.deleteMany({ _id: { $in: keys.map((key) => ledgerId(teamId, channel, key)) } })
      },
      async dropInstance(instanceId) {
        await ledger.updateMany({ instanceIds: instanceId }, { $pull: { instanceIds: instanceId } })
        await ledger.deleteMany({ instanceIds: { $size: 0 } })
      },
    },
    folds: {
      async get(teamId, channel) {
        const row = await folds.findOne({ _id: foldId(teamId, channel) })
        return row && row.foldedTs !== undefined ? { foldedTs: row.foldedTs, lastFoldAt: row.lastFoldAt, backfilled: row.backfilled === true, pendingThreads: row.pendingThreads || [] } : null
      },
      async claim(teamId, channel, by, until, now) {
        const id = foldId(teamId, channel)
        const free = { $or: [{ lease: null }, { lease: { $exists: false } }, { 'lease.until': { $lte: new Date(now).toISOString() } }, { 'lease.by': by }] }
        const moved = await folds.updateOne({ _id: id, ...free }, { $set: { lease: { by, until: new Date(until).toISOString() } } })
        if (moved.matchedCount > 0) return true
        try {
          await folds.insertOne({ _id: id, lease: { by, until: new Date(until).toISOString() } })
          return true
        } catch (error) {
          if (error?.code === 11000) return false
          throw error
        }
      },
      async release(teamId, channel, by, patch) {
        await folds.updateOne({ _id: foldId(teamId, channel), 'lease.by': by }, { $set: { ...(patch || {}), lease: null } })
      },
    },
  }
}
