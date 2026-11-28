// The recipes scheduler and queue (enterprise/server/recipes/queue.mjs): exactly once across
// servers, debounced vendor events, per-owner concurrency, leases, retries and the pause after 3
// failures. Two "pods" share one in-memory database and race the way two servers sharing Mongo do.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRecipeQueue, createScheduler, mergeTrigger, nextDueFor, RECIPE_LIMITS, isRetryable } from '../enterprise/server/recipes/queue.mjs'
import { createRecipeStore } from '../enterprise/server/recipes/store.mjs'
import { createMemoryDb } from './fakes/mongo-memory.mjs'

function world(start = Date.UTC(2026, 10, 27, 2, 59)) {
  const db = createMemoryDb()
  const store = createRecipeStore((name) => db[name])
  let now = start
  const clock = () => now
  let k = 0
  const pod = (worker) => {
    const queue = createRecipeQueue({ store, clock, worker, randomId: () => `${worker}r${++k}` })
    return { queue, scheduler: createScheduler({ store, clock, queue }) }
  }
  return { store, clock, advance: (ms) => { now += ms }, set: (ms) => { now = ms }, pod, a: pod('a'), b: pod('b') }
}

const instance = (over = {}) => ({ _id: 'i1', recipeId: 'r', projectId: 'p', ownerId: 'u1', state: 'active', triggers: [{ kind: 'schedule', cron: '0 3 * * *', tz: 'UTC' }], rev: 0, lock: null, failures: 0, ...over })

test('a due schedule makes one run, however many servers tick at once', async () => {
  const w = world()
  await w.store.instances.insertOne(instance({ nextDueAt: new Date(Date.UTC(2026, 10, 27, 3, 0)) }))
  w.advance(60_000)
  const made = await Promise.all([w.a.scheduler.tick(), w.b.scheduler.tick(), w.a.scheduler.tick(), w.b.scheduler.tick()])
  assert.equal(made.reduce((x, y) => x + y, 0), 1)
  const runs = await w.store.runs.find({}).toArray()
  assert.equal(runs.length, 1)
  assert.equal(runs[0]._id, 'i1:2026-11-27T03:00:00.000Z')
  const after = await w.store.instances.findOne({ _id: 'i1' })
  assert.equal(after.nextDueAt.toISOString(), '2026-11-28T03:00:00.000Z')
})

test('occurrences missed while every server was down collapse into one run', async () => {
  const w = world()
  await w.store.instances.insertOne(instance({ triggers: [{ kind: 'schedule', cron: '0 * * * *', tz: 'UTC' }], nextDueAt: new Date(Date.UTC(2026, 10, 27, 3, 0)) }))
  w.advance(10 * 3600_000) // ten hours down
  await w.a.scheduler.tick()
  await w.b.scheduler.tick()
  assert.equal(await w.store.runs.countDocuments({}), 1)
  const after = await w.store.instances.findOne({ _id: 'i1' })
  assert.ok(after.nextDueAt.getTime() > w.clock())
})

test('ten pushes in two minutes are one run, with every sha', async () => {
  const w = world()
  await w.store.instances.insertOne(instance({ triggers: [{ kind: 'vendor', event: 'github.push', debounceMs: 120000 }], nextDueAt: null }))
  for (let k = 0; k < 10; k += 1) {
    await (k % 2 ? w.a : w.b).queue.trigger('i1', { event: 'github.push', shas: [`sha${k}`], before: k === 0 ? 'base' : `sha${k - 1}` }, { debounceMs: 120000 })
    w.advance(10_000)
    await w.a.scheduler.tick()
  }
  assert.equal(await w.store.runs.countDocuments({}), 0, 'nothing runs while pushes keep coming')
  w.advance(120_000)
  await Promise.all([w.a.scheduler.tick(), w.b.scheduler.tick()])
  const runs = await w.store.runs.find({}).toArray()
  assert.equal(runs.length, 1)
  assert.equal(runs[0].trigger.count, 10)
  assert.equal(runs[0].trigger.shas.length, 10)
  assert.equal(runs[0].trigger.before, 'base')
})

test('mergeTrigger unions lists and keeps the first before', () => {
  const m = mergeTrigger(mergeTrigger(null, { kind: 'vendor', numbers: [1], before: 'x' }), { kind: 'vendor', numbers: [2, 1], before: 'y' })
  assert.deepEqual(m.numbers, [1, 2])
  assert.equal(m.before, 'x')
  assert.equal(m.count, 2)
})

test('a run is claimed by one server; the instance runs one at a time', async () => {
  const w = world()
  await w.store.instances.insertOne(instance())
  const i = await w.store.instances.findOne({ _id: 'i1' })
  await w.a.queue.enqueue(i, { kind: 'manual' })
  await w.a.queue.enqueue(i, { kind: 'manual' })
  const [x, y] = await Promise.all([w.a.queue.claim(), w.b.queue.claim()])
  const claimed = [x, y].filter(Boolean)
  assert.equal(claimed.length, 1, 'the second run waits for the instance lock')
  const back = await w.store.runs.findOne({ state: 'queued' })
  assert.ok(back.dueAt.getTime() >= w.clock() + RECIPE_LIMITS.lockRetryMs - 1)
  await (x ? w.a : w.b).queue.finish(claimed[0].run._id, { state: 'done', stats: { added: 1 } })
  w.advance(RECIPE_LIMITS.lockRetryMs)
  assert.ok(await w.b.queue.claim(), 'free again after the first finished')
})

test('an owner has at most 2 runs at once; others are skipped, not lost', async () => {
  const w = world()
  for (const id of ['i1', 'i2', 'i3']) await w.store.instances.insertOne(instance({ _id: id }))
  await w.store.instances.insertOne(instance({ _id: 'j1', ownerId: 'u2' }))
  for (const id of ['i1', 'i2', 'i3', 'j1']) await w.a.queue.enqueue(await w.store.instances.findOne({ _id: id }), { kind: 'manual' })
  const p1 = await w.a.queue.claim()
  const p2 = await w.b.queue.claim()
  const p3 = await w.b.queue.claim()
  const p4 = await w.pod('c').queue.claim()
  const owners = [p1, p2, p3, p4].filter(Boolean).map((c) => c.run.ownerId)
  assert.equal(owners.filter((o) => o === 'u1').length, 2)
  assert.equal(owners.filter((o) => o === 'u2').length, 1)
  assert.equal(await w.store.runs.countDocuments({ state: 'queued', ownerId: 'u1' }), 1)
})

test('a server that dies leaves its run to be reclaimed after the lease', async () => {
  const w = world()
  await w.store.instances.insertOne(instance())
  await w.a.queue.enqueue(await w.store.instances.findOne({ _id: 'i1' }), { kind: 'manual' })
  const claimed = await w.a.queue.claim()
  assert.ok(claimed)
  w.advance(RECIPE_LIMITS.heartbeatMs)
  assert.equal(await w.a.queue.heartbeat(claimed.run._id), true)
  assert.equal(await w.b.queue.heartbeat(claimed.run._id), false, 'only its own server keeps it')
  w.advance(RECIPE_LIMITS.leaseMs + 1000) // pod a died
  assert.equal(await w.b.queue.reclaim(), 1)
  const again = await w.b.queue.claim()
  assert.ok(again, 'the lock expired with the lease')
  assert.equal(again.run.attempts, 1)
})

test('retryable failures back off, then fail; 3 failed runs in a row pause the instance', async () => {
  const w = world()
  await w.store.instances.insertOne(instance())
  const i = await w.store.instances.findOne({ _id: 'i1' })
  await w.a.queue.enqueue(i, { kind: 'manual' })
  let c = await w.a.queue.claim()
  let f = await w.a.queue.finish(c.run._id, { state: 'failed', error: { status: 503, code: 'vendor' }, retryable: true })
  assert.equal(f.requeued, true)
  const queued = await w.store.runs.findOne({ _id: c.run._id })
  assert.equal(queued.dueAt.getTime(), w.clock() + 60e3)
  // non-retryable failures count toward the pause
  for (let k = 0; k < 3; k += 1) {
    const run = await w.a.queue.enqueue(await w.store.instances.findOne({ _id: 'i1' }), { kind: 'manual' }, { dueAt: w.clock() })
    w.advance(1)
    await w.store.runs.updateOne({ _id: c.run._id, state: 'queued' }, { $set: { state: 'cancelled' } })
    c = await w.a.queue.claim()
    assert.equal(c.run._id, run._id)
    f = await w.a.queue.finish(c.run._id, { state: 'failed', error: { name: 'ConfigInvalid', code: 'config' } })
  }
  assert.equal(f.paused, true)
  const after = await w.store.instances.findOne({ _id: 'i1' })
  assert.equal(after.state, 'paused')
  assert.equal(after.pausedReason, 'failures')
  assert.equal(after.lock, null)
})

test('cancel: a queued run at once, a running one at its next heartbeat', async () => {
  const w = world()
  await w.store.instances.insertOne(instance())
  const i = await w.store.instances.findOne({ _id: 'i1' })
  const queued = await w.a.queue.enqueue(i, { kind: 'manual' })
  assert.equal(await w.a.queue.cancel(queued._id, 'u1'), 'cancelled')
  await w.a.queue.enqueue(i, { kind: 'manual' })
  const c = await w.a.queue.claim()
  assert.equal(await w.a.queue.cancel(c.run._id, 'u1'), 'stopping')
  assert.equal(await w.a.queue.heartbeat(c.run._id), false)
  const done = await w.a.queue.finish(c.run._id, { state: 'failed', error: { code: 'cancelled' } })
  assert.equal(done.state, 'cancelled')
})

test('an instance runs at most 96 times a day; past that runs are recorded as skipped', async () => {
  const w = world()
  await w.store.instances.insertOne(instance())
  const i = await w.store.instances.findOne({ _id: 'i1' })
  const limits = { ...RECIPE_LIMITS, runsPerDayPerInstance: 3 }
  const q = createRecipeQueue({ store: w.store, clock: w.clock, worker: 'x', limits })
  for (let k = 0; k < 3; k += 1) assert.equal((await q.enqueue(i, { kind: 'manual' })).state, 'queued')
  const over = await q.enqueue(i, { kind: 'manual' })
  assert.equal(over.state, 'skipped')
  assert.equal(over.skippedReason, 'budget')
})

test('nextDueFor picks the soonest schedule; isRetryable reads the failure', () => {
  const from = Date.UTC(2026, 10, 27, 12)
  assert.equal(nextDueFor([{ kind: 'schedule', cron: '0 18 * * *', tz: 'UTC' }, { kind: 'schedule', cron: '0 13 * * *', tz: 'UTC' }, { kind: 'manual' }], from).toISOString(), '2026-11-27T13:00:00.000Z')
  assert.equal(nextDueFor([{ kind: 'manual' }], from), null)
  assert.equal(isRetryable({ status: 503 }), true)
  assert.equal(isRetryable({ status: 429 }), true)
  assert.equal(isRetryable({ status: 404 }), false)
  assert.equal(isRetryable({ code: 'slate_changed' }), true)
  assert.equal(isRetryable({ name: 'SignInNeeded', status: 401 }), false)
})
