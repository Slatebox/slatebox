// `slatebox updates` inside the container (self-host/rootfs/opt/slatebox/lib/updates.mjs), over an
// in-memory database: the host updater's view of the same record the app writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { fakeDb } from './updates-test-store.mjs'
import { FakeGitHub, testKey } from '../packages/slatebox/test/updater-kit.mjs'

process.env.SLATEBOX_INSTALLER_DIR = fileURLToPath(new URL('../packages/slatebox/', import.meta.url))
const { run, updateSettings, currentVersion } = await import('../self-host/rootfs/opt/slatebox/lib/updates.mjs')

const key = testKey()
const home = mkdtempSync(join(tmpdir(), 'sbx-home-'))
writeFileSync(join(home, 'identity.json'), JSON.stringify({ version: '2.0.0', app: 'abc' }))

async function cmd(db, args, { now = Date.parse('2026-11-25T04:30:00Z'), gh, env = {}, stdin } = {}) {
  const out = new PassThrough()
  let text = ''
  out.on('data', c => { text += c })
  await run(args, { db, now, env, out, home, stdin, ...(gh ? { get: gh.get } : {}) })
  return text.trim()
}

test('settings and identity: SLATEBOX_UPDATES (auto by default), the feed, the version from identity.json', () => {
  assert.deepEqual(updateSettings({}), { mode: 'auto', feedUrl: null })
  assert.deepEqual(updateSettings({ SLATEBOX_UPDATES: 'off', SLATEBOX_UPDATE_FEED: 'http://x/update-feed/channels.json' }), { mode: 'off', feedUrl: 'http://x/update-feed/channels.json' })
  assert.equal(currentVersion(home), '2.0.0')
  assert.equal(currentVersion('/nonexistent'), null)
})

test('policy: off makes no request; a stale check is done first, and a feed this copy cannot verify applies nothing', async () => {
  const db = fakeDb()
  const off = JSON.parse(await cmd(db, ['policy', '--json'], { env: { SLATEBOX_UPDATES: 'off' } }))
  assert.equal(off.reason, 'off')
  // A stale (missing) check makes the policy check the feed first: a feed this copy cannot verify is recorded, nothing applied.
  const gh = new FakeGitHub(key)
  gh.release('2.1.0')
  gh.publishFeed({ stable: '2.1.0' })
  const noKeys = JSON.parse(await cmd(db, ['policy', '--json'], { gh }))
  assert.equal(noKeys.action, 'none')
  const doc = await db.collection('systemSettings').findOne({ _id: 'selfHostUpdates' })
  assert.match(doc.feed.lastError.code, /signature-(no-keys|unknown-key)/)
})

test('heartbeat, report and request write the record the app reads', async () => {
  const db = fakeDb()
  assert.equal(JSON.parse(await cmd(db, ['heartbeat', '--updater', '1', '--scheduler', 'systemd', '--feed-url', 'http://host.docker.internal:9/update-feed/channels.json'])).ok, true)
  let doc = await db.collection('systemSettings').findOne({ _id: 'selfHostUpdates' })
  assert.equal(doc.updater.scheduler, 'systemd')
  assert.equal(doc.updater.feedUrl, 'http://host.docker.internal:9/update-feed/channels.json')
  assert.equal(doc.policy.auto, true, 'a server with no first admin yet is new: automatic updates')
  await cmd(db, ['request', 'apply', '--version', '2.1.0'])
  doc = await db.collection('systemSettings').findOne({ _id: 'selfHostUpdates' })
  assert.deepEqual({ kind: doc.request.kind, version: doc.request.version }, { kind: 'apply', version: '2.1.0' })
  await cmd(db, ['report', '--attempt', 'a1', '--phase', 'pulling'])
  await cmd(db, ['report', '--attempt', 'a1', '--phase', 'rolled-back', '--detail', 'not healthy'])
  doc = await db.collection('systemSettings').findOne({ _id: 'selfHostUpdates' })
  assert.equal(doc.attempts[0].outcome, 'rolled-back')
  const pending = new PassThrough()
  pending.end(JSON.stringify({ attemptId: 'a2', phase: 'failed', detail: 'the app was down' }))
  await cmd(db, ['report', '--pending'], { stdin: pending })
  doc = await db.collection('systemSettings').findOne({ _id: 'selfHostUpdates' })
  assert.equal(doc.attempts[0].id, 'a2')
  await assert.rejects(cmd(db, ['report', '--attempt', 'a3', '--phase', 'exploded']), /Unknown phase/)
  const status = JSON.parse(await cmd(db, ['status', '--json']))
  assert.equal(status.current, '2.0.0')
  assert.equal(status.lastAttempt.id, 'a2')
})

test('a server that already had its first admin gets notify only', async () => {
  const db = fakeDb({ users: [{ _id: 'u1' }] })
  await cmd(db, ['heartbeat', '--updater', '1', '--scheduler', 'cron'])
  const doc = await db.collection('systemSettings').findOne({ _id: 'selfHostUpdates' })
  assert.equal(doc.policy.auto, false)
  assert.equal(doc.policySource, 'existing')
  await cmd(db, ['auto', 'on'])
  assert.equal((await db.collection('systemSettings').findOne({ _id: 'selfHostUpdates' })).policy.auto, true)
})

test('the policy reads the feed itself when no good check is 7 hours old, and retries a failed one after 15 minutes', async () => {
  const { checkDue } = await import('../self-host/rootfs/opt/slatebox/lib/updates.mjs')
  const now = Date.parse('2026-11-25T12:00:00Z')
  const ago = minutes => new Date(now - minutes * 60000)
  assert.equal(checkDue(undefined, now), true)
  assert.equal(checkDue({ ok: true, lastError: null, checkedAt: ago(60) }, now), false)
  assert.equal(checkDue({ ok: true, lastError: null, checkedAt: ago(8 * 60) }, now), true)
  assert.equal(checkDue({ checkedAt: ago(5), lastError: { at: ago(5) } }, now), false)
  assert.equal(checkDue({ checkedAt: ago(20), lastError: { at: ago(20) } }, now), true)
  assert.equal(checkDue({ ok: true, checkedAt: ago(20), lastError: { at: ago(20) } }, now), true, 'a good feed whose last check failed is retried too')
})
