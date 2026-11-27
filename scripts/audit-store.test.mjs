// The activity log's store against a real MongoDB: seq per team, one edit entry per person per
// slate per hour, sealing, the chain check catching an edited or deleted entry and a seq that
// was never written, paging for the page and for a SIEM, single-use export addresses, and one
// sealer at a time. A stub store cannot show these: they rest on the database's unique indexes,
// its atomic counter and its TTL index.
//
// Runs against SLATEBOX_TEST_MONGO_PORT when it is set; otherwise it starts a throwaway mongod
// (SLATEBOX_TEST_MONGOD, or the one in the Meteor dev bundle) on a free port and stops it after.
// Skips when neither a port nor a mongod binary is available.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createAuditStore, ensureAuditIndexes, GAP_AFTER_MS } from '../web/app/server/audit/store.mjs'

function findMongod() {
  if (process.env.SLATEBOX_TEST_MONGOD) return process.env.SLATEBOX_TEST_MONGOD
  const tools = join(homedir(), '.meteor/packages/meteor-tool')
  if (!existsSync(tools)) return null
  for (const version of readdirSync(tools).sort().reverse()) {
    const dir = join(tools, version)
    for (const arch of existsSync(dir) ? readdirSync(dir) : []) {
      const bin = join(dir, arch, 'dev_bundle/mongodb/bin/mongod')
      if (existsSync(bin)) return bin
    }
  }
  return null
}

function findDriver() {
  if (process.env.SLATEBOX_TEST_MONGODB_DRIVER) return process.env.SLATEBOX_TEST_MONGODB_DRIVER
  try {
    return createRequire(new URL('../web/app/package.json', import.meta.url)).resolve('mongodb')
  } catch {}
  const npm = join(homedir(), '.meteor/packages/npm-mongo')
  if (!existsSync(npm)) return null
  for (const version of readdirSync(npm).sort().reverse()) {
    const dir = join(npm, version, 'npm/node_modules/mongodb')
    if (existsSync(dir)) return dir
  }
  return null
}

const freePort = () => new Promise((ok, fail) => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => ok(port)) })
  server.on('error', fail)
})

const mongod = process.env.SLATEBOX_TEST_MONGO_PORT ? null : findMongod()
const driver = findDriver()
const skip = !driver || (!process.env.SLATEBOX_TEST_MONGO_PORT && !mongod) ? 'no MongoDB available' : false

let shared = null
async function server(t) {
  if (shared) return shared
  let port = Number(process.env.SLATEBOX_TEST_MONGO_PORT)
  let child = null
  let dir = null
  if (!port) {
    port = await freePort()
    dir = mkdtempSync(join(tmpdir(), 'slatebox-audit-mongo-'))
    child = spawn(mongod, ['--dbpath', dir, '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { stdio: 'ignore' })
  }
  const { MongoClient } = createRequire(import.meta.url)(driver)
  const client = new MongoClient(`mongodb://127.0.0.1:${port}`, { serverSelectionTimeoutMS: 20000 })
  await client.connect()
  shared = { client, stop: async () => { await client.close(); child?.kill('SIGTERM'); if (dir) rmSync(dir, { recursive: true, force: true }) } }
  return shared
}
test.after(async () => { if (shared) await shared.stop() })

async function storeOn(t, options = {}) {
  const { client } = await server(t)
  const db = client.db('slatebox_audit_' + randomUUID().replaceAll('-', ''))
  t.after(() => db.dropDatabase().catch(() => {}))
  const collections = {
    events: db.collection('auditEvents'),
    chains: db.collection('auditChains'),
    checkpoints: db.collection('auditCheckpoints'),
    windows: db.collection('auditEditWindows'),
    leases: db.collection('auditLeases'),
    exports: db.collection('auditExports'),
  }
  await ensureAuditIndexes(collections)
  let clock = Date.parse('2026-11-27T10:00:00Z')
  const now = () => clock
  const store = createAuditStore({ ...collections, now, ...options })
  return { store, ...collections, tick: (ms) => { clock += ms }, now }
}

const entry = (over = {}) => ({ scope: 'team1', action: 'slate.renamed', actor: { kind: 'person', userId: 'ana', label: 'Ana' }, via: 'app', target: { type: 'slate', id: 's1', name: 'Plan' }, slateId: 's1', details: { from: 'A', to: 'B' }, ...over })

test('entries take seq 1, 2, 3 per team; each holds its hash and an expiry', { skip }, async (t) => {
  const { store, events } = await storeOn(t)
  assert.deepEqual(await store.record(entry()), { seq: 1 })
  assert.deepEqual(await store.record(entry()), { seq: 2 })
  assert.deepEqual(await store.record(entry({ scope: 'team2' })), { seq: 1 })
  const row = await events.findOne({ scope: 'team1', seq: 2 })
  assert.match(row.entryHash, /^[a-f0-9]{64}$/)
  assert.equal(row.chain, undefined, 'not sealed yet')
  assert.equal(row.expiresAt.toISOString(), '2027-11-27T10:00:00.000Z')
  await assert.rejects(events.insertOne({ ...row, _id: undefined }), /duplicate key/, 'one entry per seq')
  // many writers at once: every seq once
  await Promise.all(Array.from({ length: 30 }, () => store.record(entry({ scope: 'busy' }))))
  const seqs = (await events.find({ scope: 'busy' }).toArray()).map((r) => r.seq).sort((a, b) => a - b)
  assert.deepEqual(seqs, Array.from({ length: 30 }, (_, i) => i + 1))
})

test('self-host keeping entries for ever writes no expiry', { skip }, async (t) => {
  const { store, events } = await storeOn(t, { retention: () => null })
  await store.record(entry())
  assert.equal((await events.findOne({})).expiresAt, undefined)
})

test('editing a slate is one entry per person per slate per hour', { skip }, async (t) => {
  const { store, events, tick } = await storeOn(t)
  const edit = entry({ action: 'slate.edited', details: undefined })
  assert.deepEqual(await store.record(edit, { coalesce: true }), { seq: 1 })
  assert.deepEqual(await store.record(edit, { coalesce: true }), { coalesced: true })
  assert.deepEqual(await store.record({ ...edit, actor: { kind: 'person', userId: 'bob' } }, { coalesce: true }), { seq: 2 }, 'another person')
  assert.deepEqual(await store.record({ ...edit, slateId: 's2', target: { type: 'slate', id: 's2' } }, { coalesce: true }), { seq: 3 }, 'another slate')
  tick(3_600_000)
  assert.deepEqual(await store.record(edit, { coalesce: true }), { seq: 4 }, 'the next hour')
  assert.equal(await events.countDocuments({}), 4)
})

test('sealing links every entry; verify finds the log unbroken and keeps a daily checkpoint', { skip }, async (t) => {
  const { store, events, checkpoints } = await storeOn(t)
  for (let i = 0; i < 12; i += 1) await store.record(entry({ details: { from: `v${i}`, to: `v${i + 1}` } }))
  const sealed = await store.sealAll()
  assert.deepEqual(sealed, { scopes: 1, sealed: 12 })
  assert.equal(await events.countDocuments({ chain: { $exists: false } }), 0)
  const result = await store.verify('team1')
  assert.equal(result.ok, true)
  assert.equal(result.checked, 12)
  assert.equal(result.headSeq, 12)
  assert.equal(result.pending, 0)
  assert.equal(await checkpoints.countDocuments({ scope: 'team1' }), 1)
  // nothing new: nothing sealed, still one checkpoint
  assert.deepEqual(await store.sealAll(), { scopes: 0, sealed: 0 })
  await store.record(entry())
  assert.equal((await store.verify('team1')).pending, 1, 'a new entry waits for the sealer')
  await store.sealAll()
  assert.equal((await store.verify('team1')).headSeq, 13)
})

test('verify catches an entry edited or deleted in the database', { skip }, async (t) => {
  const { store, events } = await storeOn(t)
  for (let i = 0; i < 6; i += 1) await store.record(entry({ details: { from: `v${i}`, to: `v${i + 1}` } }))
  await store.sealAll()
  await events.updateOne({ scope: 'team1', seq: 3 }, { $set: { 'details.to': 'forged' } })
  assert.deepEqual((await store.verify('team1')).problem, { seq: 3, kind: 'edited' })
  await events.updateOne({ scope: 'team1', seq: 3 }, { $set: { 'details.to': 'v3' } })
  assert.equal((await store.verify('team1')).ok, true, 'put back, it checks out again')
  await events.deleteOne({ scope: 'team1', seq: 4 })
  assert.deepEqual((await store.verify('team1')).problem, { seq: 4, kind: 'missing' })
})

test('a seq taken and never written is sealed as an explicit gap, once the writers have moved on', { skip }, async (t) => {
  const { store, events, chains, tick, now } = await storeOn(t)
  // a writer takes its seq as record() does, then stops before inserting the entry
  const takeAndStop = () => chains.updateOne({ _id: 'team1' }, { $inc: { seq: 1 }, $set: { touchedAt: new Date(now()) } })
  await store.record(entry())
  await takeAndStop()
  await store.record(entry())
  await store.sealAll()
  assert.equal((await store.verify('team1')).sealedSeq, 1, 'seq 2 may still be on its way')
  tick(GAP_AFTER_MS)
  await store.sealAll()
  const gap = await events.findOne({ scope: 'team1', seq: 2 })
  assert.equal(gap.action, 'audit.gap')
  const result = await store.verify('team1')
  assert.equal(result.ok, true)
  assert.equal(result.headSeq, 3)
  // the newest seq taken and never written
  await takeAndStop()
  await store.sealAll()
  assert.equal((await store.verify('team1')).sealedSeq, 3)
  tick(GAP_AFTER_MS)
  await store.sealAll()
  assert.equal((await events.findOne({ scope: 'team1', seq: 4 })).action, 'audit.gap')
  assert.equal((await store.verify('team1')).ok, true)
})

test('the page reads newest first; a SIEM reads oldest first from its last seq', { skip }, async (t) => {
  const { store } = await storeOn(t)
  for (let i = 0; i < 7; i += 1) await store.record(entry({ action: i % 2 ? 'slate.edited' : 'slate.renamed', actor: { kind: 'person', userId: i < 4 ? 'ana' : 'bob' } }))
  await store.record(entry({ scope: 'team2' }))
  const first = await store.list('team1', {}, { limit: 3 })
  assert.deepEqual(first.events.map((e) => e.seq), [7, 6, 5])
  assert.equal(first.next, 5)
  const second = await store.list('team1', {}, { before: first.next, limit: 3 })
  assert.deepEqual(second.events.map((e) => e.seq), [4, 3, 2])
  const last = await store.list('team1', {}, { before: second.next, limit: 3 })
  assert.deepEqual(last.events.map((e) => e.seq), [1])
  assert.equal(last.next, null)
  const pull = await store.list('team1', {}, { after: 0, limit: 4 })
  assert.deepEqual(pull.events.map((e) => e.seq), [1, 2, 3, 4])
  assert.equal(pull.next, 4)
  const rest = await store.list('team1', {}, { after: 4, limit: 10 })
  assert.deepEqual(rest.events.map((e) => e.seq), [5, 6, 7])
  const caughtUp = await store.list('team1', {}, { after: 7 })
  assert.deepEqual(caughtUp, { events: [], next: 7, order: 'oldest' }, 'caught up: ask again from the same seq')
  const bob = await store.list('team1', { userId: 'bob', actions: ['slate.edited'] }, {})
  assert.deepEqual(bob.events.map((e) => e.seq), [6])
  assert.ok(first.events.every((e) => e._id === undefined), 'no database ids')
})

test('an export address works once and expires', { skip }, async (t) => {
  const { store, tick } = await storeOn(t)
  const made = await store.createExport({ scope: 'team1', filter: {}, format: 'csv', userId: 'ana' })
  assert.match(made.ticket, /^[A-Za-z0-9_-]{32}$/)
  const taken = await store.takeExport(made.ticket)
  assert.equal(taken.scope, 'team1')
  assert.equal(await store.takeExport(made.ticket), null, 'once')
  const late = await store.createExport({ scope: 'team1', filter: {}, format: 'json', userId: 'ana' })
  tick(11 * 60_000)
  assert.equal(await store.takeExport(late.ticket), null, 'expired')
  assert.equal(await store.takeExport('../../etc'), null)
})

test('one sealer at a time: the lease is held until it expires', { skip }, async (t) => {
  const { store, tick } = await storeOn(t)
  assert.equal(await store.lease('audit-sealer', 'pod-a', 60_000), true)
  assert.equal(await store.lease('audit-sealer', 'pod-b', 60_000), false)
  assert.equal(await store.lease('audit-sealer', 'pod-a', 60_000), true, 'renewed by its holder')
  tick(61_000)
  assert.equal(await store.lease('audit-sealer', 'pod-b', 60_000), true, 'taken over once it lapsed')
  assert.equal(await store.lease('audit-sealer', 'pod-a', 60_000), false)
})
