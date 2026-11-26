// The one record of a self-hosted server's updates, in its own database: what the admin chose, what
// the last check found, what the host updater is doing. Byte-identical in the installer (run inside
// the container by `slatebox updates`, self-host/rootfs/opt/slatebox/lib/updates.mjs) and the app
// (web/app/server/updates/store-core.mjs), so both read and write one shape.
//
// `cols` is { settings, events }: the systemSettings collection and selfHostUpdateEvents, as
// MongoDB driver collections (the app passes rawCollection()).
//
//   systemSettings { _id: 'selfHostUpdates',
//     policy, policySource: 'new'|'existing', approvals: [version], request: {kind, version, by, at}|null,
//     lease: {attemptId, until, kind, target}|null, attempt: {id, kind, target, from, phase, detail, startedAt, updatedAt}|null,
//     attempts: [{id, kind, target, from, outcome, detail, at, downgradeSafe}] (newest first, 50 kept),
//     feed: {checkedAt, ok, error, sequence, expired, expiresAt, stable, preview, yanked}, manifests: {[version]: manifest},
//     current: {version, at}, updater: {at, protocol, scheduler}, host: {preUpgradeBackup, preUpgradeBackupAt}, notified: [key] }
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_POLICY, EVENTS_KEEP, EXISTING_INSTALL_POLICY, FINAL_PHASES, LEASE_MS, PHASES, UPDATES_ID, decide, parseVersion,
} from './policy.mjs'

export const ATTEMPTS_KEEP = 50
export const NOTES_MAX = 8 * 1024

/** The record, made on first use: a new server gets automatic updates, one with data from before does not. */
export async function ensureDoc(cols, { setUp = false, now = Date.now() } = {}) {
  await cols.settings.updateOne({ _id: UPDATES_ID }, {
    $setOnInsert: {
      policy: setUp ? EXISTING_INSTALL_POLICY : DEFAULT_POLICY, policySource: setUp ? 'existing' : 'new',
      approvals: [], request: null, lease: null, attempt: null, attempts: [], notified: [], createdAt: new Date(now),
    },
  }, { upsert: true }).catch(error => { if (error?.code !== 11000) throw error })
  return cols.settings.findOne({ _id: UPDATES_ID })
}

export const readDoc = cols => cols.settings.findOne({ _id: UPDATES_ID })

/** One line of history (checks, attempts, phases, admin changes); the newest EVENTS_KEEP are kept. */
export async function addEvent(cols, event, { now = Date.now() } = {}) {
  await cols.events.insertOne({ _id: randomUUID(), at: new Date(now), ...event })
  const old = await cols.events.find({}, { projection: { _id: 1 }, sort: { at: -1 }, skip: EVENTS_KEEP }).toArray()
  if (old.length) await cols.events.deleteMany({ _id: { $in: old.map(row => row._id) } })
}

export const listEvents = (cols, limit = 100) => cols.events.find({}, { sort: { at: -1 }, limit }).toArray()

/** What the host updater should do now, from the record. */
export function decideFor(doc, { now = Date.now(), current = null, mode = 'auto' } = {}) {
  if (mode === 'off') return { action: 'none', reason: 'off', target: null }
  const policy = mode === 'notify' ? { ...(doc?.policy || DEFAULT_POLICY), auto: false } : (doc?.policy || DEFAULT_POLICY)
  return decide({
    policy, now, current,
    feed: doc?.feed?.ok ? doc.feed : null, feedExpired: Boolean(doc?.feed?.expired) || (doc?.feed?.expiresAt ? Date.parse(doc.feed.expiresAt) <= now : false),
    manifests: doc?.manifests || {}, approvals: doc?.approvals || [], request: doc?.request || null,
    history: doc?.attempts || [], lease: doc?.lease ? { ...doc.lease, until: new Date(doc.lease.until).getTime() } : null,
  })
}

/**
 * Take the one lease for an attempt (none may run beside it; a lease ends after LEASE_MS even if
 * its updater never reports). The admin's request is used up by it. → the attempt, or null.
 */
export async function takeLease(cols, { decision, now = Date.now(), current = null, attemptId = randomUUID() }) {
  const lease = { attemptId, until: new Date(now + LEASE_MS), kind: decision.action, target: decision.target?.version || null }
  const attempt = { id: attemptId, kind: decision.action, target: lease.target, from: current, phase: 'queued', detail: decision.reason, startedAt: new Date(now), updatedAt: new Date(now) }
  const taken = await cols.settings.updateOne(
    { _id: UPDATES_ID, $or: [{ lease: null }, { lease: { $exists: false } }, { 'lease.until': { $lte: new Date(now) } }] },
    { $set: { lease, attempt, request: null } },
  )
  if (!taken.matchedCount) return null
  await addEvent(cols, { kind: 'attempt', attemptId, phase: 'queued', target: lease.target, from: current, detail: decision.reason }, { now })
  return attempt
}

/** A phase the host updater reports. A final phase ends the lease and goes into the history. */
export async function report(cols, { attemptId, phase, detail = '', version = null, now = Date.now(), downgradeSafe = false, preUpgradeBackup = null }) {
  if (!PHASES.includes(phase)) throw new Error(`Unknown phase ${phase}. One of: ${PHASES.join(', ')}.`)
  const doc = await readDoc(cols)
  const attempt = doc?.attempt?.id === attemptId ? doc.attempt : { id: attemptId, kind: 'apply', target: version, from: doc?.current?.version || null, startedAt: new Date(now) }
  const text = String(detail || '').slice(0, 2000)
  const set = { attempt: { ...attempt, phase, detail: text, updatedAt: new Date(now) } }
  if (FINAL_PHASES.includes(phase)) {
    set.lease = null
    const entry = { id: attemptId, kind: attempt.kind, target: attempt.target, from: attempt.from, outcome: phase, detail: text, at: new Date(now), downgradeSafe: Boolean(downgradeSafe) }
    // After a rollback the version rolled back from is not applied again by itself (an admin's "Try again" or a newer release is).
    const back = attempt.kind === 'rollback' && phase === 'healthy' && attempt.from
      ? [{ id: `${attemptId}-from`, kind: 'apply', target: attempt.from, from: null, outcome: 'rolled-back', detail: 'rolled back by an administrator', at: new Date(now), downgradeSafe: false }]
      : []
    set.attempts = [entry, ...back, ...(doc?.attempts || []).filter(item => item.id !== attemptId)].slice(0, ATTEMPTS_KEEP)
    if (phase === 'healthy' && parseVersion(version)) set.current = { version: parseVersion(version).text, at: new Date(now) }
  }
  if (preUpgradeBackup !== null) set.host = { ...(doc?.host || {}), preUpgradeBackup: Boolean(preUpgradeBackup), preUpgradeBackupAt: preUpgradeBackup ? new Date(now) : null }
  await cols.settings.updateOne({ _id: UPDATES_ID }, { $set: set })
  await addEvent(cols, { kind: 'attempt', attemptId, phase, detail: text, target: attempt.target, from: attempt.from }, { now })
  return set.attempt
}

/** The host updater checked in (every five minutes while it is set up). */
export async function heartbeat(cols, { protocol = 1, scheduler = 'unknown', now = Date.now(), host = null, feedUrl = null }) {
  const set = { updater: { at: new Date(now), protocol: Number(protocol) || 1, scheduler: String(scheduler).slice(0, 40), ...(feedUrl && /^https?:\/\/[^\s]+\/update-feed\/channels\.json$/.test(feedUrl) ? { feedUrl } : {}) } }
  if (host) set.host = host
  await cols.settings.updateOne({ _id: UPDATES_ID }, { $set: set })
}

const trimManifest = manifest => ({ ...manifest, notes: typeof manifest.notes === 'string' ? manifest.notes.slice(0, NOTES_MAX) : '' })

/** The result of a feed check (feed.mjs readFeed), or why it failed. */
export async function recordCheck(cols, { result = null, error = null, now = Date.now() }) {
  if (error) {
    await cols.settings.updateOne({ _id: UPDATES_ID }, { $set: { 'feed.checkedAt': new Date(now), 'feed.lastError': { code: error.code || 'error', message: String(error.message || error).slice(0, 500), at: new Date(now) } } })
    await addEvent(cols, { kind: 'check', ok: false, detail: String(error.message || error).slice(0, 500), code: error.code || 'error' }, { now })
    return
  }
  const { feed, manifests, expired, sequence } = result
  const set = {
    feed: {
      checkedAt: new Date(now), ok: true, lastError: null, sequence, expired, expiresAt: feed.expiresAt, generatedAt: feed.generatedAt || null,
      stable: feed.stable ? { version: feed.stable.version } : null, preview: feed.preview ? { version: feed.preview.version } : null,
      yanked: (feed.yanked || []).map(item => ({ version: String(item.version), reason: String(item.reason || '').slice(0, 300) })),
    },
    manifests: Object.fromEntries(Object.entries(manifests).map(([version, manifest]) => [version, trimManifest(manifest)])),
  }
  await cols.settings.updateOne({ _id: UPDATES_ID }, { $set: set })
  await addEvent(cols, { kind: 'check', ok: true, detail: [feed.stable && `stable ${feed.stable.version}`, feed.preview && `preview ${feed.preview.version}`].filter(Boolean).join(', ') || 'no release', sequence }, { now })
}

export async function setPolicy(cols, policy) {
  await cols.settings.updateOne({ _id: UPDATES_ID }, { $set: { policy, policySource: 'admin' } })
}

export async function approve(cols, version, { by = null, now = Date.now() } = {}) {
  const doc = await readDoc(cols)
  const approvals = [...new Set([...(doc?.approvals || []), parseVersion(version).text])].slice(-20)
  await cols.settings.updateOne({ _id: UPDATES_ID }, { $set: { approvals } })
  await addEvent(cols, { kind: 'admin', detail: `approved ${parseVersion(version).text}`, by }, { now })
}

/** An admin's "update now", "try again" or "roll back". The host updater takes it on its next run. */
export async function request(cols, { kind, version = null, by = null, now = Date.now() }) {
  if (!['apply', 'retry', 'rollback'].includes(kind)) throw new Error(`Unknown request ${kind}.`)
  const value = { kind, version: version ? parseVersion(version)?.text || null : null, by, at: new Date(now) }
  await cols.settings.updateOne({ _id: UPDATES_ID }, { $set: { request: value } })
  await addEvent(cols, { kind: 'admin', detail: `${kind}${value.version ? ` ${value.version}` : ''}`, by }, { now })
  return value
}

export async function cancelRequest(cols, { by = null, now = Date.now() } = {}) {
  await cols.settings.updateOne({ _id: UPDATES_ID }, { $set: { request: null } })
  await addEvent(cols, { kind: 'admin', detail: 'cancelled the request', by }, { now })
}

/** Remember that a notice went out (one per version and kind), so it is sent once. → whether it is new. */
export async function markNotified(cols, key) {
  const result = await cols.settings.updateOne({ _id: UPDATES_ID, notified: { $ne: key } }, { $push: { notified: { $each: [key], $slice: -200 } } })
  return result.modifiedCount === 1
}
