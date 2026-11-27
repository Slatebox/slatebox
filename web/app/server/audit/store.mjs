/* eslint-disable no-underscore-dangle */
// The activity log's storage, over MongoDB driver collections passed in (server/audit/meteor.js
// passes the real ones; scripts/audit-store.test.mjs a throwaway mongod). Append-only: app code
// inserts entries and, once, sets an entry's chain; it never updates or deletes one otherwise.
// Old entries leave through the TTL index on expiresAt.
//
//   auditEvents       one row per entry (events.mjs buildEntry, plus seq, entryHash, chain)
//   auditChains       { _id: scope, seq, sealedSeq, head, touchedAt, checkpointDay }
//   auditCheckpoints  { scope, seq, chain, at }: the head once a day per scope
//   auditEditWindows  { _id, at }: one slate.edited per person per slate per hour (TTL 2 hours)
//   auditLeases       { _id, holder, until }: one sealer at a time across the app's processes
//   auditExports      { _id: sha256(ticket), scope, filter, format, userId, expiresAt }
import { createHash, randomBytes } from 'node:crypto'
import { buildEntry, expiryFor } from './events.mjs'
import { GENESIS, chainHash, entryHash, verifyChain } from './chain.mjs'

export const HOUR = 3_600_000
export const GAP_AFTER_MS = 120_000
export const LIST_MAX = 1000
export const EXPORT_MAX = 100_000
export const EXPORT_TICKET_MS = 10 * 60_000
const DUPLICATE = 11000

const isDuplicate = (error) => error?.code === DUPLICATE
const docOf = (result) => (result && typeof result === 'object' && 'value' in result && 'ok' in result ? result.value : result)

export async function ensureAuditIndexes({ events, checkpoints, windows, exports: exportTickets }) {
  await events.createIndex({ scope: 1, seq: 1 }, { unique: true })
  await events.createIndex({ scope: 1, at: -1 })
  await events.createIndex({ scope: 1, slateId: 1, at: -1 })
  await events.createIndex({ scope: 1, 'actor.userId': 1, at: -1 })
  await events.createIndex({ scope: 1, ipHash: 1, at: -1 }, { sparse: true })
  await events.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await checkpoints.createIndex({ scope: 1, seq: 1 }, { unique: true })
  await windows.createIndex({ at: 1 }, { expireAfterSeconds: 2 * 3600 })
  if (exportTickets) await exportTickets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

// One slate.edited (or one guest admission) per actor per slate per hour.
export function windowKey(entry, at) {
  const who = entry.actor.tokenId || entry.actor.userId || entry.actor.visitor || entry.actor.kind
  const what = entry.slateId || entry.target?.id || '-'
  return `${entry.scope}|${entry.action}|${what}|${who}|${Math.floor(at.getTime() / HOUR)}`
}

/**
 * Turns a list filter into a query. filter: { actions?: [id], userId?, slateId?, via?, ipHash?,
 * from?: Date, to?: Date }.
 */
export function eventQuery(scope, filter = {}) {
  const query = { scope }
  if (filter.actions?.length) query.action = { $in: [...filter.actions] }
  if (filter.userId) query['actor.userId'] = filter.userId
  if (filter.slateId) query.slateId = filter.slateId
  if (filter.via) query.via = filter.via
  if (filter.ipHash) query.ipHash = filter.ipHash
  if (filter.from || filter.to) {
    query.at = {}
    if (filter.from) query.at.$gte = filter.from
    if (filter.to) query.at.$lt = filter.to
  }
  return query
}

export function createAuditStore({ events, chains, checkpoints, windows, leases, exports: exportTickets, now = Date.now, retention = () => 365, gapAfterMs = GAP_AFTER_MS }) {
  /**
   * Appends one entry. options.coalesce: drop it when the same actor already has this action on
   * this slate this hour (canvas editing). → { seq } | { coalesced: true }
   */
  async function record(input, { coalesce = false } = {}) {
    const at = input.at ? new Date(input.at) : new Date(now())
    const entry = buildEntry({ ...input, at, expiresAt: expiryFor(at, retention()) })
    if (coalesce) {
      try {
        await windows.insertOne({ _id: windowKey(entry, at), at })
      } catch (error) {
        if (isDuplicate(error)) return { coalesced: true }
        throw error
      }
    }
    const counter = docOf(await chains.findOneAndUpdate(
      { _id: entry.scope },
      { $inc: { seq: 1 }, $set: { touchedAt: at }, $setOnInsert: { sealedSeq: 0, head: GENESIS } },
      { upsert: true, returnDocument: 'after' }
    ))
    const seq = counter.seq
    const row = { ...entry, seq }
    row.entryHash = entryHash(row)
    await events.insertOne(row)
    return { seq }
  }

  // The gap entry for a seq that was taken and never written.
  const gapRow = (scope, seq) => {
    const at = new Date(now())
    const entry = buildEntry({ scope, at, action: 'audit.gap', actor: { kind: 'system' }, via: 'system', expiresAt: expiryFor(at, retention()) })
    const row = { ...entry, seq }
    row.entryHash = entryHash(row)
    return row
  }

  async function writeGap(scope, seq) {
    const row = gapRow(scope, seq)
    try {
      await events.insertOne(row)
      return row
    } catch (error) {
      if (!isDuplicate(error)) throw error
      return events.findOne({ scope, seq })
    }
  }

  const dayOf = (time) => new Date(time).toISOString().slice(0, 10)

  // Seals one scope from where it stopped, at most `budget` entries. → entries sealed
  async function sealScope(counter, budget) {
    const scope = counter._id
    const startedAt = counter.sealedSeq ?? 0
    let sealed = startedAt
    let head = counter.head ?? GENESIS
    let done = 0
    const seal = async (row) => {
      const chain = chainHash(head, row.entryHash)
      if (row.chain === undefined || row.chain === null) {
        await events.updateOne({ _id: row._id, chain: { $exists: false } }, { $set: { chain } })
      } else if (row.chain !== chain) {
        // Sealed before, differently: an entry or the chain was changed. Stop here; verify says where.
        return false
      }
      head = chain
      sealed = row.seq
      done += 1
      return true
    }
    let stopped = false
    while (!stopped && done < budget) {
      const rows = await events.find({ scope, seq: { $gt: sealed } }).sort({ seq: 1 }).limit(Math.min(500, budget - done)).toArray()
      if (!rows.length) break
      for (const row of rows) {
        // A seq before this one was taken and never written: once this later entry is older than
        // gapAfterMs, the missing one is not coming.
        while (row.seq > sealed + 1) {
          if (now() - new Date(row.at).getTime() < gapAfterMs) {
            stopped = true
            break
          }
          const gap = await writeGap(scope, sealed + 1)
          if (!(await seal(gap))) {
            stopped = true
            break
          }
        }
        if (stopped) break
        if (!(await seal(row))) {
          stopped = true
          break
        }
        if (done >= budget) break
      }
    }
    // The newest seqs taken and never written, once the counter has been still for gapAfterMs.
    if (!stopped && done < budget && counter.seq > sealed && counter.touchedAt && now() - new Date(counter.touchedAt).getTime() >= gapAfterMs) {
      const later = await events.findOne({ scope, seq: { $gt: sealed } }, { projection: { _id: 1 } })
      if (!later) {
        while (sealed < counter.seq && done < budget) {
          const gap = await writeGap(scope, sealed + 1)
          if (!(await seal(gap))) break
        }
      }
    }
    if (sealed === startedAt) return 0
    const update = { sealedSeq: sealed, head, sealedAt: new Date(now()) }
    const today = dayOf(now())
    if (counter.checkpointDay !== today) {
      await checkpoints.insertOne({ scope, seq: sealed, chain: head, at: new Date(now()) }).catch((error) => {
        if (!isDuplicate(error)) throw error
      })
      update.checkpointDay = today
    }
    await chains.updateOne({ _id: scope, sealedSeq: startedAt }, { $set: update })
    return done
  }

  /** Seals every scope with unsealed entries. → { scopes, sealed } */
  async function sealAll({ budget = 5000 } = {}) {
    const pending = await chains.find({ $expr: { $gt: ['$seq', { $ifNull: ['$sealedSeq', 0] }] } }).limit(200).toArray()
    let sealed = 0
    for (const counter of pending) {
      if (sealed >= budget) break
      sealed += await sealScope(counter, budget - sealed)
    }
    return { scopes: pending.length, sealed }
  }

  /**
   * Checks a scope's sealed entries (chain.mjs verifyChain), from the oldest entry not about to
   * expire. → verifyChain's answer with sealedSeq and pending (entries not sealed yet).
   */
  async function verify(scope) {
    const counter = await chains.findOne({ _id: scope })
    if (!counter) return { ok: true, checked: 0, firstSeq: null, headSeq: null, head: null, since: null, problem: null, sealedSeq: 0, pending: 0 }
    const soon = new Date(now() + HOUR)
    const cursor = events
      .find({ scope, seq: { $lte: counter.sealedSeq ?? 0 }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: soon } }] })
      .sort({ seq: 1 })
      .project({ _id: 0 })
    const marks = await checkpoints.find({ scope }, { projection: { _id: 0, seq: 1, chain: 1 } }).toArray()
    const result = await verifyChain(cursor, marks)
    return { ...result, sealedSeq: counter.sealedSeq ?? 0, pending: Math.max(0, counter.seq - (counter.sealedSeq ?? 0)) }
  }

  /**
   * One page of a scope's entries. after: entries after this seq, oldest first (a SIEM's pull);
   * otherwise newest first, before this seq when given (the page). → { events, next }
   */
  async function list(scope, filter = {}, { after = null, before = null, limit = 100 } = {}) {
    const size = Math.max(1, Math.min(LIST_MAX, limit))
    const query = eventQuery(scope, filter)
    const ascending = after !== null && after !== undefined
    if (ascending) query.seq = { $gt: after }
    else if (before !== null && before !== undefined) query.seq = { $lt: before }
    const rows = await events.find(query, { projection: { _id: 0 } }).sort({ seq: ascending ? 1 : -1 }).limit(size + 1).toArray()
    const page = rows.slice(0, size)
    const more = rows.length > size
    const last = page[page.length - 1]
    // A pull always has a next (the last seq it saw), so it asks again from there later.
    let next = more && last ? last.seq : null
    if (ascending) next = last ? last.seq : after
    return { events: page, next, order: ascending ? 'oldest' : 'newest' }
  }

  /** The entries an export holds, oldest first, at most EXPORT_MAX. */
  function exportCursor(scope, filter = {}) {
    return events.find(eventQuery(scope, filter), { projection: { _id: 0 } }).sort({ seq: 1 }).limit(EXPORT_MAX)
  }

  /** Whether `holder` holds the lease `name` now (taking it when it is free or expired). */
  async function lease(name, holder, ms) {
    const time = now()
    try {
      const held = docOf(await leases.findOneAndUpdate(
        { _id: name, $or: [{ until: { $lt: new Date(time) } }, { holder }] },
        { $set: { holder, until: new Date(time + ms) } },
        { upsert: true, returnDocument: 'after' }
      ))
      return held?.holder === holder
    } catch (error) {
      if (isDuplicate(error)) return false
      throw error
    }
  }

  // An export's one-time address: the ticket in it is shown once and stored as its hash.
  async function createExport({ scope, filter, format, userId }) {
    const ticket = randomBytes(24).toString('base64url')
    const expiresAt = new Date(now() + EXPORT_TICKET_MS)
    await exportTickets.insertOne({ _id: createHash('sha256').update(ticket).digest('hex'), scope, filter, format, userId, expiresAt })
    return { ticket, expiresAt }
  }

  async function takeExport(ticket) {
    if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(ticket)) return null
    const row = docOf(await exportTickets.findOneAndDelete({ _id: createHash('sha256').update(ticket).digest('hex') }))
    if (!row || new Date(row.expiresAt).getTime() < now()) return null
    return row
  }

  return { record, sealAll, verify, list, exportCursor, lease, createExport, takeExport }
}
