// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// When recipes run, on any number of servers, with no duplicate and no lost run.
//   schedule  scheduler.tick() moves each due instance's nextDueAt forward with a compare-and-set on
//             the value it read; only the server that wins inserts the run, and the run's _id is
//             instanceId:dueAt, so even two inserts make one run. Occurrences missed while every
//             server was down collapse into one.
//   vendor    queue.trigger() folds events into the instance's pendingTrigger and pushes
//             debounceUntil out; the tick turns a quiet instance into one run (ten pushes in two
//             minutes are one run).
//   saves     queue.slateSaved() keeps one due time per slate in the instance's slateSaves, each
//             pushed out by that slate's own saves (a person editing one slate all afternoon does
//             not hold back another's export); the tick turns the slates that went quiet into one
//             slate_saved run naming them.
//   manual, inbound, recipe_event   enqueued at once.
//   claim     a queued run is taken with one findOneAndUpdate (queued → running, with a lease), then
//             the instance's lock (one run at a time per instance); no lock puts it back for 30 s.
//             An owner with RECIPE_LIMITS.concurrentPerOwner runs going is skipped. With P servers
//             one owner may briefly overshoot by P-1 runs within one claim window (accepted).
//   lease     heartbeat() every 30 s extends the run's lease and the lock; a server that dies leaves
//             both to expire, and reclaim() puts its run back with one more attempt.
//   retry     a retryable failure is queued again at 1 m, 5 m, 15 m, 1 h, 6 h, 24 h, then fails;
//             3 failed runs in a row pause the instance.
// Pure apart from the injected store (store.mjs collections) and clock.
import { nextAfter } from '../../common/recipes/cron.mjs'
import { docOf, isDuplicate } from './store.mjs'

export const RECIPE_LIMITS = Object.freeze({
  concurrentPerOwner: 2, perProcess: 2, runMs: 600000, leaseMs: 120000, heartbeatMs: 30000,
  backoffMs: [60e3, 300e3, 900e3, 3600e3, 21600e3, 86400e3], failuresToPause: 3,
  instancesPerOwner: 20, runsPerDayPerInstance: 96, inboundPerHourPerInstance: 30, minScheduleMinutes: 15,
  manualPerHourPerInstance: 30, lockRetryMs: 30000, tickBatch: 50, claimScan: 20, logLines: 200, logChars: 200,
})

export const RUN_STATES = Object.freeze(['queued', 'running', 'done', 'partial', 'failed', 'skipped', 'cancelled'])
export const FINAL_STATES = Object.freeze(['done', 'partial', 'failed', 'skipped', 'cancelled'])
const LIVE_INSTANCE = 'active'
// Saves on a synced slate (slateSaved): the longest a slate under constant edits waits, and how close
// two slates' due times are for one run to take both.
export const SAVE_MAX_WAIT_MS = 3600e3
export const SAVE_COALESCE_MS = 120e3

const asDate = (ms) => new Date(ms)

/** The next due time over an instance's schedule triggers (null without one). The 15-minute floor is
 * checked when a schedule is set (service.mjs checkTriggers), not here. */
export function nextDueFor(triggers, from) {
  let best = null
  for (const t of triggers || []) {
    if (t.kind !== 'schedule' || !t.cron) continue
    const at = nextAfter(t.cron, t.tz || 'UTC', from)
    if (at && (!best || at < best)) best = at
  }
  return best
}

const union = (a = [], b = []) => [...new Set([...a, ...b])].slice(-500)

/**
 * Two vendor triggers folded into one: the newest event and delivery win; shas, paths and numbers
 * are unioned; the earliest "before" sha is kept, so the run sees the whole range.
 */
export function mergeTrigger(previous, next) {
  if (!previous) return { ...next, count: next.count || 1 }
  const out = { ...previous, ...next, count: (previous.count || 1) + (next.count || 1) }
  for (const key of ['shas', 'paths', 'numbers', 'channels', 'fileIds', 'events']) {
    if (previous[key] || next[key]) out[key] = union(previous[key], next[key])
  }
  if (previous.before) out.before = previous.before
  return out
}

export const backoffFor = (attempts, limits = RECIPE_LIMITS) => (attempts < limits.backoffMs.length ? limits.backoffMs[attempts] : null)

// Failures worth trying again: the network, a vendor's 5xx or 429, a slate that changed mid-run.
export function isRetryable(error) {
  if (!error) return false
  if (['SignInNeeded', 'AccessLost', 'ConfigInvalid', 'GrantRevoked', 'BudgetExceeded'].includes(error.name)) return false
  if (error.code === 'timeout') return true
  if (error.code === 'slate_changed') return true
  if (Number.isInteger(error.status)) return error.status >= 500 || error.status === 429
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'network'].includes(error.code)
}

/** A run's log line, as kept: never content or tokens, 200 characters. */
export const logLine = (at, level, code, msg) => ({
  at: asDate(at), level: ['info', 'warn', 'error'].includes(level) ? level : 'info',
  code: String(code || 'note').replace(/[^a-z0-9_.-]/gi, '').slice(0, 40) || 'note',
  msg: String(msg || '').replace(/\s+/g, ' ').slice(0, RECIPE_LIMITS.logChars),
})

/**
 * @param {{ store, clock: () => number, worker: string, limits?: object, random?: () => string }} deps
 */
export function createRecipeQueue({ store, clock = Date.now, worker = 'w', limits = RECIPE_LIMITS, randomId }) {
  const { instances, runs } = store
  const running = new Set() // this process's runs (perProcess)
  const newId = randomId || (() => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12))

  function runDoc(instance, trigger, { mode = 'run', id, dueAt }) {
    const at = clock()
    return {
      _id: id || newId(),
      instanceId: instance._id, ownerId: instance.ownerId, recipeId: instance.recipeId, projectId: instance.projectId,
      trigger: { kind: trigger?.kind || 'manual', ...trigger },
      mode, state: 'queued', dueAt: asDate(dueAt ?? at), attempts: 0, leaseUntil: null, worker: null,
      created: asDate(at), startedAt: null, finishedAt: null, durationMs: null,
      stats: null, changes: [], writes: [], log: [], error: null, skippedReason: null,
    }
  }

  async function runsToday(instanceId) {
    return runs.countDocuments({ instanceId, mode: 'run', created: { $gt: asDate(clock() - 86400000) } })
  }

  /** A run, queued now (manual, inbound, preview, a fold). Over the daily limit it is recorded skipped. */
  async function enqueue(instance, trigger, { mode = 'run', id, dueAt } = {}) {
    const doc = runDoc(instance, trigger, { mode, id, dueAt })
    if (mode === 'run' && (await runsToday(instance._id)) >= limits.runsPerDayPerInstance) {
      Object.assign(doc, { state: 'skipped', skippedReason: 'budget', finishedAt: asDate(clock()), log: [logLine(clock(), 'warn', 'budget', `Over ${limits.runsPerDayPerInstance} runs today.`)] })
    }
    try {
      await runs.insertOne(doc)
    } catch (error) {
      if (!isDuplicate(error)) throw error
      return runs.findOne({ _id: doc._id })
    }
    return doc
  }

  /** A vendor event for an instance: folded into one run after the trigger's quiet time. */
  async function trigger(instanceId, event, { debounceMs = 0 } = {}) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const instance = await instances.findOne({ _id: instanceId })
      if (!instance || instance.state !== LIVE_INSTANCE) return false
      const merged = mergeTrigger(instance.pendingTrigger, { kind: 'vendor', ...event })
      const until = asDate(clock() + debounceMs)
      const changed = await instances.updateOne(
        { _id: instanceId, rev: instance.rev ?? 0 },
        { $set: { pendingTrigger: merged, debounceUntil: until }, $inc: { rev: 1 } }
      )
      if (changed.modifiedCount) return true
    }
    return false
  }

  /**
   * A person saved a slate in the instance's sync map: that slate's run is due debounceMs after its
   * last save. One compare-and-set on the instance; false when it is not on.
   */
  async function slateSaved(instanceId, shareId, { debounceMs = 0, onlyIfMissing = false } = {}) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const instance = await instances.findOne({ _id: instanceId })
      if (!instance || instance.state !== LIVE_INSTANCE) return false
      const known = (instance.slateSaves || []).find((s) => s.shareId === shareId)
      // a throttled save only makes sure the slate has a due time (one taken by a tick a moment ago)
      if (onlyIfMissing && known) return false
      const now = clock()
      // A slate people never stop editing still goes out: at most SAVE_MAX_WAIT_MS after its first
      // waiting save (one commit an hour, not none all day).
      const first = known?.first ? new Date(known.first).getTime() : now
      const until = Math.min(now + debounceMs, first + Math.max(debounceMs, SAVE_MAX_WAIT_MS))
      const saves = [...(instance.slateSaves || []).filter((s) => s.shareId !== shareId), { shareId, until: asDate(until), first: asDate(first), count: (known?.count || 0) + 1 }].slice(-100)
      const changed = await instances.updateOne(
        { _id: instanceId, rev: instance.rev ?? 0 },
        { $set: { slateSaves: saves, savesDueAt: asDate(Math.min(...saves.map((s) => new Date(s.until).getTime()))) }, $inc: { rev: 1 } }
      )
      if (changed.modifiedCount) return true
    }
    return false
  }

  /** The saves waiting on these slates are dropped (a run that exports them now is queued instead). */
  async function clearSaves(instanceId, shareIds) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const instance = await instances.findOne({ _id: instanceId })
      if (!instance) return false
      const saves = (instance.slateSaves || []).filter((s) => !shareIds.includes(s.shareId))
      if (saves.length === (instance.slateSaves || []).length) return true
      const changed = await instances.updateOne(
        { _id: instanceId, rev: instance.rev ?? 0 },
        { $set: { slateSaves: saves, savesDueAt: saves.length ? asDate(Math.min(...saves.map((s) => new Date(s.until).getTime()))) : null }, $inc: { rev: 1 } }
      )
      if (changed.modifiedCount) return true
    }
    return false
  }

  async function lockInstance(instanceId, runId) {
    const now = clock()
    const won = docOf(await instances.findOneAndUpdate(
      { _id: instanceId, $or: [{ lock: null }, { 'lock.until': { $lt: asDate(now) } }] },
      { $set: { lock: { runId, until: asDate(now + limits.leaseMs) } } },
      { returnDocument: 'after' }
    ))
    return won
  }

  /** The next run this process may start, taken with its instance lock; null when none is ready. */
  async function claim() {
    if (running.size >= limits.perProcess) return null
    const now = clock()
    const candidates = await runs.find({ state: 'queued', dueAt: { $lte: asDate(now) } }, { sort: { dueAt: 1 }, limit: limits.claimScan }).toArray()
    const busy = new Map()
    for (const candidate of candidates) {
      if (!busy.has(candidate.ownerId)) busy.set(candidate.ownerId, await runs.countDocuments({ ownerId: candidate.ownerId, state: 'running' }))
      if (busy.get(candidate.ownerId) >= limits.concurrentPerOwner) continue
      const run = docOf(await runs.findOneAndUpdate(
        { _id: candidate._id, state: 'queued' },
        { $set: { state: 'running', leaseUntil: asDate(now + limits.leaseMs), worker, startedAt: asDate(now) } },
        { returnDocument: 'after' }
      ))
      if (!run) continue // another server took it
      const instance = await lockInstance(run.instanceId, run._id)
      if (!instance) {
        await runs.updateOne({ _id: run._id, worker }, { $set: { state: 'queued', worker: null, leaseUntil: null, startedAt: null, dueAt: asDate(now + limits.lockRetryMs) } })
        continue
      }
      busy.set(run.ownerId, busy.get(run.ownerId) + 1)
      running.add(run._id)
      return { run, instance }
    }
    return null
  }

  /** Keeps a run's lease and its instance lock; false when the run is no longer this process's. */
  async function heartbeat(runId) {
    const now = clock()
    const kept = await runs.updateOne({ _id: runId, state: 'running', worker }, { $set: { leaseUntil: asDate(now + limits.leaseMs) } })
    if (!kept.modifiedCount) return false
    const run = await runs.findOne({ _id: runId })
    await instances.updateOne({ _id: run.instanceId, 'lock.runId': runId }, { $set: { 'lock.until': asDate(now + limits.leaseMs) } })
    return !run.cancelRequested
  }

  /**
   * Ends a run. A retryable failure with attempts left is queued again instead (the answer says
   * so: { requeued: true }); a final failure counts toward the pause.
   * → { state, requeued, paused }
   */
  async function finish(runId, { state, stats = null, changes = [], writes = [], log = [], error = null, skippedReason = null, retryable = false, revisionBySlate = null, cursor } = {}) {
    if (!FINAL_STATES.includes(state)) throw new Error(`finish: ${state} is not a final state`)
    const now = clock()
    const run = await runs.findOne({ _id: runId })
    if (!run) return { state: null }
    running.delete(runId)
    const cleanError = error ? { name: String(error.name || 'Error').slice(0, 60), status: Number.isInteger(error.status) ? error.status : null, code: String(error.code || 'failed').slice(0, 60) } : null
    const lines = [...(run.log || []), ...log].slice(-limits.logLines)
    const delay = state === 'failed' && retryable ? backoffFor(run.attempts || 0, limits) : null
    const unlock = () => instances.updateOne({ _id: run.instanceId, 'lock.runId': runId }, { $set: { lock: null } })
    if (delay !== null && !run.cancelRequested) {
      await runs.updateOne({ _id: runId }, {
        $set: { state: 'queued', worker: null, leaseUntil: null, startedAt: null, dueAt: asDate(now + delay), error: cleanError, log: [...lines, logLine(now, 'warn', 'retry', `Trying again in ${Math.round(delay / 60000)} min.`)].slice(-limits.logLines) },
        $inc: { attempts: 1 },
      })
      await unlock()
      return { state: 'queued', requeued: true, paused: false }
    }
    const finalState = run.cancelRequested && state !== 'done' ? 'cancelled' : state
    const started = run.startedAt ? new Date(run.startedAt).getTime() : now
    await runs.updateOne({ _id: runId }, {
      $set: { state: finalState, stats, changes, writes, log: lines, error: cleanError, skippedReason, finishedAt: asDate(now), durationMs: Math.max(0, now - started), leaseUntil: null },
    })
    await unlock()
    if (run.mode === 'preview') return { state: finalState, requeued: false, paused: false }
    const instance = await instances.findOne({ _id: run.instanceId })
    if (!instance) return { state: finalState, requeued: false, paused: false }
    const changed = (stats?.added || 0) + (stats?.updated || 0) + (stats?.removed || 0)
    const set = {
      lastRun: { at: asDate(now), runId, outcome: finalState, changed, revisionBySlate: revisionBySlate || instance.lastRun?.revisionBySlate || {} },
      updated: asDate(now),
    }
    if (cursor !== undefined) set.cursor = cursor
    let paused = false
    if (finalState === 'failed') {
      const failures = (instance.failures || 0) + 1
      set.failures = failures
      if (failures >= limits.failuresToPause && instance.state === LIVE_INSTANCE) {
        Object.assign(set, { state: 'paused', pausedBy: null, pausedReason: 'failures', nextDueAt: null })
        paused = true
      }
    } else if (finalState === 'done' || finalState === 'partial') set.failures = 0
    await instances.updateOne({ _id: run.instanceId }, { $set: set, $inc: { rev: 1 } })
    return { state: finalState, requeued: false, paused }
  }

  /** Cancels a queued run at once, or asks a running one to stop (its signal aborts at the next heartbeat). */
  async function cancel(runId, byUserId) {
    const now = clock()
    const queued = await runs.updateOne({ _id: runId, state: 'queued' }, { $set: { state: 'cancelled', finishedAt: asDate(now), cancelledBy: byUserId, durationMs: 0 } })
    if (queued.modifiedCount) return 'cancelled'
    const asked = await runs.updateOne({ _id: runId, state: 'running' }, { $set: { cancelRequested: true, cancelledBy: byUserId } })
    return asked.modifiedCount ? 'stopping' : 'finished'
  }

  /** Runs whose server stopped heartbeating: back in the queue with one more attempt (or failed). */
  async function reclaim() {
    const now = clock()
    const stale = await runs.find({ state: 'running', leaseUntil: { $lt: asDate(now) } }, { limit: 100 }).toArray()
    let back = 0
    for (const run of stale) {
      const attempts = (run.attempts || 0) + 1
      const exhausted = attempts > limits.backoffMs.length
      const changed = await runs.updateOne({ _id: run._id, state: 'running', leaseUntil: run.leaseUntil }, {
        $set: exhausted
          ? { state: 'failed', finishedAt: asDate(now), error: { name: 'Error', status: null, code: 'lost_worker' }, leaseUntil: null }
          : { state: 'queued', worker: null, leaseUntil: null, startedAt: null, dueAt: asDate(now), attempts, log: [...(run.log || []), logLine(now, 'warn', 'reclaimed', 'The server running it stopped; it runs again.')].slice(-limits.logLines) },
      })
      if (changed.modifiedCount) back += 1
    }
    return back
  }

  return { enqueue, trigger, slateSaved, clearSaves, claim, heartbeat, finish, cancel, reclaim, runningHere: () => running.size }
}

/**
 * Turns due schedules and quiet debounced instances into runs. Safe on every server at once.
 * @param {{ store, clock, queue, limits? }} deps
 */
export function createScheduler({ store, clock = Date.now, queue, limits = RECIPE_LIMITS }) {
  const { instances } = store
  async function tick() {
    const now = clock()
    let made = 0
    const due = await instances.find({ state: LIVE_INSTANCE, nextDueAt: { $lte: asDate(now) } }, { sort: { nextDueAt: 1 }, limit: limits.tickBatch }).toArray()
    for (const instance of due) {
      const seen = instance.nextDueAt
      const next = nextDueFor(instance.triggers, now)
      const won = await instances.updateOne({ _id: instance._id, nextDueAt: seen }, { $set: { nextDueAt: next } })
      if (!won.modifiedCount) continue
      const dueAt = new Date(seen)
      const run = await queue.enqueue(instance, { kind: 'schedule', dueAt: dueAt.toISOString() }, { id: `${instance._id}:${dueAt.toISOString()}`, dueAt: now })
      if (run) made += 1
    }
    const quiet = await instances.find({ state: LIVE_INSTANCE, debounceUntil: { $lte: asDate(now) } }, { sort: { debounceUntil: 1 }, limit: limits.tickBatch }).toArray()
    for (const instance of quiet) {
      const taken = docOf(await instances.findOneAndUpdate(
        { _id: instance._id, debounceUntil: instance.debounceUntil },
        { $set: { debounceUntil: null, pendingTrigger: null }, $inc: { rev: 1 } },
        { returnDocument: 'before' }
      ))
      if (!taken?.pendingTrigger) continue
      const at = new Date(taken.debounceUntil).toISOString()
      await queue.enqueue(taken, taken.pendingTrigger, { id: `${instance._id}:v:${at}` })
      made += 1
    }
    // Slates in a sync map that went quiet: one run for all of them, the rest keep waiting.
    const saved = await instances.find({ state: LIVE_INSTANCE, savesDueAt: { $lte: asDate(now) } }, { sort: { savesDueAt: 1 }, limit: limits.tickBatch }).toArray()
    for (const instance of saved) {
      // the slates due within SAVE_COALESCE_MS go with them: one run and one commit, not several
      const saves = instance.slateSaves || []
      const due = saves.filter((s) => new Date(s.until).getTime() <= now + SAVE_COALESCE_MS)
      const rest = saves.filter((s) => new Date(s.until).getTime() > now + SAVE_COALESCE_MS)
      const won = await instances.updateOne(
        { _id: instance._id, rev: instance.rev ?? 0 },
        { $set: { slateSaves: rest, savesDueAt: rest.length ? asDate(Math.min(...rest.map((s) => new Date(s.until).getTime()))) : null }, $inc: { rev: 1 } }
      )
      if (!won.modifiedCount || !due.length) continue
      const at = new Date(instance.savesDueAt).toISOString()
      await queue.enqueue(instance, { kind: 'slate_saved', shareIds: due.map((s) => s.shareId), count: due.reduce((n, s) => n + (s.count || 1), 0) }, { id: `${instance._id}:s:${at}` })
      made += 1
    }
    return made
  }
  return { tick }
}
