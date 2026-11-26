// Admin › Updates on the server (server/updates/service.mjs) with stand-ins for the database, the
// feed on GitHub, the clock, the notices and the audit log.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdatesService, nextCheckDelay, updateMode, CHECK_EVERY_MS, BACKOFF_MAX_MS } from '../web/app/server/updates/service.mjs'
import * as store from '../web/app/server/updates/store.mjs'
import { updateCols } from './updates-test-store.mjs'
import { FakeGitHub, testKey } from '../packages/slatebox/test/updater-kit.mjs'

const key = testKey()
const NOW = Date.parse('2026-11-25T04:30:00Z')

function world({ mode = 'auto', version = '2.0.0', setUp = false } = {}) {
  const cols = updateCols()
  const gh = new FakeGitHub(key)
  const notices = []
  const audits = []
  let now = NOW
  const service = createUpdatesService({
    cols, settings: { public: { env: 'selfhost' }, selfHosted: { updates: { mode } } }, get: gh.get, keys: key.keys,
    current: () => ({ version, revision: 'abc123' }), setUp: async () => setUp,
    notify: async notice => notices.push(notice), audit: async entry => audits.push(entry), now: () => now, random: () => 0.5, log: { warn() {} },
  })
  return { cols, gh, notices, audits, service, tick: ms => { now += ms } }
}

test('a new server gets automatic updates; one with data from before gets notify only', async () => {
  const fresh = world()
  assert.equal((await fresh.service.status()).policy.auto, true)
  const existing = world({ setUp: true })
  const status = await existing.service.status()
  assert.equal(status.policy.auto, false)
  assert.equal(status.policySource, 'existing')
})

test('check now: verified release on offer, one bell notice per version, history row', async () => {
  const w = world()
  w.gh.release('2.1.0')
  w.gh.publishFeed({ stable: '2.1.0' })
  const result = await w.service.checkNow({ by: 'tim' })
  assert.deepEqual(result, { ok: true, available: '2.1.0' })
  await w.service.checkNow()
  assert.equal(w.notices.filter(n => n.kind === 'available').length, 1, 'once per version')
  assert.match(w.notices[0].text, /Slatebox 2\.1\.0 is available/)
  const status = await w.service.status()
  assert.equal(status.available.version, '2.1.0')
  assert.equal(status.available.signed, true)
  assert.match(status.available.upgradeCommand, /^npx slatebox upgrade --to localhost:5055\/slatebox@sha256:[a-f0-9]{64}$/)
  assert.ok(status.history.some(row => row.kind === 'check' && row.ok))
})

test('a feed that does not verify: nothing on offer, a security alert, backoff', async () => {
  const w = world()
  w.gh.release('2.1.0')
  w.gh.publishFeed({ stable: '2.1.0' })
  w.gh.put('https://github.com/Slatebox/slatebox/releases/download/update-feed/channels.json.sig', `sbrel1.${key.id}.${'B'.repeat(86)}`)
  const result = await w.service.checkNow()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'signature-bad-signature')
  assert.equal(w.notices.at(-1).kind, 'verification-failed')
  assert.equal(w.notices.at(-1).security, true)
  assert.equal((await w.service.status()).available, null)
})

test('SLATEBOX_UPDATES=off makes zero requests: check now is refused, the tick checks nothing', async () => {
  const w = world({ mode: 'off' })
  await assert.rejects(w.service.checkNow(), err => err.code === 'off')
  await w.service.tick()
  assert.deepEqual(w.gh.requests, [])
  assert.equal((await w.service.status()).decision.reason, 'off')
})

test('the tick checks every 6 hours (half an hour either way) and backs off on failures, up to a day', async () => {
  assert.equal(nextCheckDelay({ random: () => 0.5 }), CHECK_EVERY_MS)
  assert.equal(nextCheckDelay({ random: () => 1 }), CHECK_EVERY_MS + 30 * 60 * 1000)
  assert.ok(nextCheckDelay({ failures: 1, random: () => 0.5 }) < 20 * 60 * 1000)
  assert.equal(nextCheckDelay({ failures: 20, random: () => 0.5 }), BACKOFF_MAX_MS)
  const w = world()
  w.gh.offline = true
  await w.service.tick()
  const first = w.gh.requests.length
  await w.service.tick()
  assert.equal(w.gh.requests.length, first, 'not again before the backoff')
  w.tick(16 * 60 * 1000)
  await w.service.tick()
  assert.ok(w.gh.requests.length > first, 'again after it')
})

test('the policy: checked, saved, audited with before and after', async () => {
  const w = world()
  await assert.rejects(w.service.setPolicy({ timeZone: 'Nowhere/Here' }, { by: 'tim' }), err => err.code === 'invalid')
  const saved = await w.service.setPolicy({ auto: false, timeZone: 'America/New_York', window: { days: [6], start: '23:00', hours: 3 } }, { by: 'tim' })
  assert.equal(saved.timeZone, 'America/New_York')
  assert.equal(w.audits.at(-1).by, 'tim')
  assert.equal(w.audits.at(-1).before.auto, true)
  assert.equal(w.audits.at(-1).after.auto, false)
})

test('update now, approve, cancel: recorded for the host updater, audited; unknown versions refused', async () => {
  const w = world()
  w.gh.release('3.0.0', { major: true })
  w.gh.publishFeed({ stable: '3.0.0' })
  await w.service.checkNow()
  await assert.rejects(w.service.applyNow('9.9.9', { by: 'tim' }), err => err.code === 'unknown-version')
  let status = await w.service.status()
  assert.equal(status.available.major, true)
  assert.equal(status.decision.reason, 'needs-approval')
  await w.service.approve('3.0.0', { by: 'tim' })
  status = await w.service.status()
  assert.equal(status.available.approved, true)
  const asked = await w.service.applyNow('3.0.0', { by: 'tim' })
  assert.equal(asked.requested.kind, 'apply')
  assert.equal(asked.updaterReady, false)
  status = await w.service.status()
  assert.equal(status.decision.action, 'apply')
  await w.service.cancel({ by: 'tim' })
  assert.equal((await w.service.status()).requestPending, false)
  assert.deepEqual(w.audits.map(a => a.action), ['approved 3.0.0', 'update now: 3.0.0', 'cancelled the update request'])
})

test('the host updater\'s reports become the history and notices; rollback needs the typed words unless data is kept', async () => {
  const w = world()
  w.gh.release('2.1.0')
  w.gh.publishFeed({ stable: '2.1.0' })
  await w.service.checkNow()
  await store.heartbeat(w.cols, { protocol: 1, scheduler: 'systemd', now: NOW })
  const decision = store.decideFor(await store.readDoc(w.cols), { now: NOW, current: '2.0.0' })
  assert.equal(decision.action, 'apply')
  const attempt = await store.takeLease(w.cols, { decision, now: NOW, current: '2.0.0' })
  assert.equal(await store.takeLease(w.cols, { decision, now: NOW, current: '2.0.0' }), null, 'one lease at a time')
  for (const phase of ['verifying', 'pulling', 'backing-up', 'starting']) await store.report(w.cols, { attemptId: attempt.id, phase, now: NOW })
  assert.equal((await w.service.status()).attempt.phase, 'starting')
  await store.report(w.cols, { attemptId: attempt.id, phase: 'healthy', version: '2.1.0', now: NOW, preUpgradeBackup: true })
  await w.service.tick()
  assert.equal(w.notices.at(-1).title, 'Slatebox updated to 2.1.0')
  const status = await w.service.status()
  assert.equal(status.attempt, null)
  assert.equal(status.attempts[0].outcome, 'healthy')
  assert.deepEqual({ to: status.rollback.to, keepsData: status.rollback.keepsData }, { to: '2.0.0', keepsData: false })
  await assert.rejects(w.service.rollback({}, { by: 'tim' }), err => err.code === 'confirm')
  const back = await w.service.rollback({ confirm: 'Roll back' }, { by: 'tim' })
  assert.equal(back.requested.kind, 'rollback')
  assert.equal(back.requested.version, '2.0.0')
})

test('a silent host updater while automatic updates are on: one notice', async () => {
  const w = world()
  await store.ensureDoc(w.cols, { now: NOW })
  await store.heartbeat(w.cols, { protocol: 1, scheduler: 'launchd', now: NOW })
  w.tick(4 * 24 * 60 * 60 * 1000)
  w.gh.offline = true
  await w.service.tick()
  await w.service.tick()
  assert.equal(w.notices.filter(n => n.kind === 'updater-late').length, 1)
  assert.equal((await w.service.status()).updater.late, true)
})

test('settings: SLATEBOX_UPDATES and SLATEBOX_UPDATE_FEED as configure.mjs writes them', () => {
  assert.deepEqual(updateMode({ selfHosted: { updates: { mode: 'notify', feedUrl: 'https://m.example/update-feed/channels.json' } } }), { mode: 'notify', feedUrl: 'https://m.example/update-feed/channels.json' })
  assert.deepEqual(updateMode({}), { mode: 'auto', feedUrl: null })
  assert.deepEqual(updateMode({ selfHosted: { updates: { mode: 'sometimes' } } }), { mode: 'auto', feedUrl: null })
})
