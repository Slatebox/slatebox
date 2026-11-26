// The decision table: off / notify / automatic, the window by the wall clock of its time zone (DST,
// across midnight), waiting after a release, majors only with approval, preview, "update now",
// leases, no automatic retry after a rollback, and when a rollback is offered.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_POLICY, EXISTING_INSTALL_POLICY, compareVersions, decide, decisionWords, inWindow, nextWindow, normalizePolicy, rollbackOffer,
} from '../src/updater/policy.mjs'
import { manifest } from './updater-kit.mjs'

const at = iso => Date.parse(iso)
const feed = (stable, extra = {}) => ({ stable: { version: stable }, ...extra })
const manifests = (...versions) => Object.fromEntries(versions.map(v => [v, manifest(v, { releasedAt: '2026-11-01T00:00:00.000Z' })]))
// Daily 04:00-06:00 UTC, automatic, two days of waiting.
const policy = { ...DEFAULT_POLICY }
const base = { policy, current: '2.0.0', feed: feed('2.1.0'), manifests: manifests('2.1.0'), now: at('2026-11-25T04:30:00Z') }

test('versions compare by SemVer: pre-releases before their release, numbers as numbers', () => {
  assert.equal(compareVersions('2.10.0', '2.9.1'), 1)
  assert.equal(compareVersions('2.1.0-rc.2', '2.1.0-rc.10'), -1)
  assert.equal(compareVersions('2.1.0-rc.1', '2.1.0'), -1)
  assert.equal(compareVersions('v2.1.0', '2.1.0+build.5'), 0)
  assert.equal(compareVersions('nonsense', '0.0.1'), -1)
})

test('defaults: a new install updates itself (minor and patch, stable, 04:00 for 2h, 2 days); an existing one only tells', () => {
  assert.equal(DEFAULT_POLICY.auto, true)
  assert.deepEqual(DEFAULT_POLICY.window, { days: [0, 1, 2, 3, 4, 5, 6], start: '04:00', hours: 2 })
  assert.equal(DEFAULT_POLICY.holdBackDays, 2)
  assert.equal(DEFAULT_POLICY.includeMajor, false)
  assert.equal(EXISTING_INSTALL_POLICY.auto, false)
})

test('in the window, past the wait, a minor release is applied; outside it waits and says when', () => {
  assert.deepEqual(decide(base), { action: 'apply', reason: 'window', target: { version: '2.1.0' }, notice: undefined })
  const later = decide({ ...base, now: at('2026-11-25T07:00:00Z') })
  assert.equal(later.reason, 'outside-window')
  assert.equal(later.until, at('2026-11-26T04:00:00Z'))
  assert.match(decisionWords(later), /next window/)
  // The time says its zone (the policy's), so it is never read as the browser's.
  assert.match(decisionWords(later), /\(Thu, Nov 26, 4:00 AM UTC\)/)
  assert.match(decisionWords(later, { timeZone: 'America/New_York' }), /11:00 PM EST/)
})

test('automatic off: notify only; SLATEBOX_UPDATES-style notify keeps it so', () => {
  assert.equal(decide({ ...base, policy: { ...policy, auto: false } }).reason, 'notify-only')
})

test('up to date, no feed, an image that does not say its version: nothing', () => {
  assert.equal(decide({ ...base, current: '2.1.0' }).reason, 'up-to-date')
  assert.equal(decide({ ...base, current: '2.2.0' }).reason, 'up-to-date')
  assert.equal(decide({ ...base, feed: null }).reason, 'no-feed')
  assert.equal(decide({ ...base, current: null }).reason, 'unknown-version')
})

test('the wait after a release (time for a withdrawal): not before releasedAt + holdBackDays', () => {
  const fresh = { '2.1.0': manifest('2.1.0', { releasedAt: '2026-11-24T12:00:00.000Z' }) }
  const held = decide({ ...base, manifests: fresh })
  assert.equal(held.reason, 'held-back')
  assert.equal(held.until, at('2026-11-26T12:00:00Z'))
  assert.equal(decide({ ...base, manifests: fresh, policy: { ...policy, holdBackDays: 0 } }).action, 'apply')
})

test('a major release needs an approval of that version; then it waits for Update now unless majors are included', () => {
  const major = { ...base, feed: feed('3.0.0'), manifests: manifests('3.0.0') }
  assert.equal(decide(major).reason, 'needs-approval')
  assert.equal(decide({ ...major, request: { kind: 'apply', version: '3.0.0' } }).reason, 'needs-approval', 'update now never skips approval')
  assert.equal(decide({ ...major, approvals: ['3.0.0'] }).reason, 'major-manual')
  assert.equal(decide({ ...major, approvals: ['3.0.0'], request: { kind: 'apply', version: '3.0.0' } }).action, 'apply')
  assert.equal(decide({ ...major, approvals: ['3.0.0'], policy: { ...policy, includeMajor: true } }).action, 'apply')
  assert.equal(decide({ ...major, approvals: ['3.0.1'], policy: { ...policy, includeMajor: true } }).reason, 'needs-approval', 'another version\'s approval does not count')
})

test('preview releases only on the preview channel (which also sees stable)', () => {
  const both = { ...base, feed: feed('2.1.0', { preview: { version: '2.2.0-rc.1' } }), manifests: manifests('2.1.0', '2.2.0-rc.1') }
  assert.equal(decide(both).target.version, '2.1.0')
  assert.equal(decide({ ...both, policy: { ...policy, channel: 'preview' } }).target.version, '2.2.0-rc.1')
  const oldPreview = { ...both, feed: feed('2.3.0', { preview: { version: '2.2.0-rc.1' } }), manifests: manifests('2.3.0', '2.2.0-rc.1') }
  assert.equal(decide({ ...oldPreview, policy: { ...policy, channel: 'preview' } }).target.version, '2.3.0')
})

test('a withdrawn release is never applied, even with Update now; a server on a withdrawn version is told', () => {
  const yanked = { ...base, feed: feed('2.1.0', { yanked: [{ version: '2.1.0', reason: 'broke uploads' }] }) }
  assert.equal(decide(yanked).reason, 'yanked')
  assert.equal(decide({ ...yanked, request: { kind: 'apply', version: '2.1.0' } }).reason, 'yanked')
  const onYanked = decide({ ...base, current: '2.0.0', feed: feed('2.1.0', { yanked: [{ version: '2.0.0', reason: 'data loss' }] }) })
  assert.match(onYanked.notice, /2\.0\.0.*withdrawn: data loss/)
})

test('a release that has to go through a withdrawn version first is not applied, even with Update now', () => {
  const through = {
    ...base, feed: feed('2.2.0', { yanked: [{ version: '2.1.0', reason: 'broke uploads' }] }),
    manifests: { '2.2.0': manifest('2.2.0', { releasedAt: '2026-11-01T00:00:00.000Z', minUpgradeFrom: '2.1.0' }) },
  }
  const decision = decide(through)
  assert.equal(decision.reason, 'yanked-step')
  assert.equal(decision.step, '2.1.0')
  assert.equal(decide({ ...through, request: { kind: 'apply', version: '2.2.0' } }).reason, 'yanked-step')
  assert.match(decisionWords(decision), /through 2\.1\.0, which was withdrawn/)
  // From 2.1.0 or later the step is not needed.
  assert.equal(decide({ ...through, current: '2.1.0' }).action, 'apply')
})

test('Update now ignores the window and the wait; an expired feed stops every apply', () => {
  const outside = { ...base, now: at('2026-11-25T13:00:00Z'), manifests: { '2.1.0': manifest('2.1.0', { releasedAt: '2026-11-25T12:00:00.000Z' }) } }
  assert.equal(decide(outside).action, 'none')
  assert.equal(decide({ ...outside, request: { kind: 'apply', version: '2.1.0' } }).action, 'apply')
  assert.equal(decide({ ...outside, request: { kind: 'apply' } }).action, 'apply', 'no version: the newest')
  assert.equal(decide({ ...outside, request: { kind: 'apply', version: '2.0.9' } }).action, 'none', 'a request for another version is not this one')
  assert.equal(decide({ ...base, feedExpired: true }).reason, 'feed-expired')
  // The host updater refuses an expired feed (it may be an old one replayed), so Update now waits too.
  assert.equal(decide({ ...base, feedExpired: true, request: { kind: 'apply' } }).reason, 'feed-expired')
})

test('one attempt at a time: a live lease means nothing new; an expired one does not hold', () => {
  assert.equal(decide({ ...base, lease: { attemptId: 'a1', until: base.now + 1000 } }).reason, 'running')
  assert.equal(decide({ ...base, lease: { attemptId: 'a1', until: base.now - 1 } }).action, 'apply')
})

test('a version that rolled back is not tried again by itself: Try again or a newer release', () => {
  const history = [{ id: 'a1', target: '2.1.0', outcome: 'rolled-back', at: new Date() }]
  assert.equal(decide({ ...base, history }).reason, 'not-retried')
  assert.equal(decide({ ...base, history, request: { kind: 'retry', version: '2.1.0' } }).action, 'apply')
  assert.equal(decide({ ...base, history, feed: feed('2.1.1'), manifests: manifests('2.1.1') }).action, 'apply')
  assert.equal(decide({ ...base, history: [{ target: '2.1.0', outcome: 'verification-failed' }] }).reason, 'not-retried')
})

test('roll back: requested by an admin, it goes first; it is offered only while the host keeps the backup', () => {
  assert.equal(decide({ ...base, request: { kind: 'rollback' } }).action, 'rollback')
  const history = [{ id: 'a2', kind: 'apply', target: '2.1.0', from: '2.0.0', outcome: 'healthy', downgradeSafe: true }]
  assert.deepEqual(rollbackOffer({ history, host: { preUpgradeBackup: true, preUpgradeBackupAt: 'x' } }), { to: '2.0.0', from: '2.1.0', keepsData: true, backupAt: 'x' })
  assert.equal(rollbackOffer({ history, host: { preUpgradeBackup: false } }), null)
  assert.equal(rollbackOffer({ history: [], host: { preUpgradeBackup: true } }), null)
})

test('the window by the wall clock: days, a window across midnight, and both daylight-saving changes', () => {
  const ny = { days: [0, 1, 2, 3, 4, 5, 6], start: '02:00', hours: 2 }
  // 2026-03-08: New York springs forward at 02:00 (to 03:00). 07:30Z is 03:30 EDT: inside 02:00-04:00.
  assert.equal(inWindow(ny, 'America/New_York', at('2026-03-08T07:30:00Z')), true)
  // 06:59Z is 01:59 EST: not yet.
  assert.equal(inWindow(ny, 'America/New_York', at('2026-03-08T06:59:00Z')), false)
  // The night loses an hour, so the window gets it back: two real hours from 03:00 EDT (07:00Z).
  assert.equal(inWindow(ny, 'America/New_York', at('2026-03-08T08:30:00Z')), true)
  // 09:00Z is 05:00 EDT: the window has closed.
  assert.equal(inWindow(ny, 'America/New_York', at('2026-03-08T09:00:00Z')), false)
  // A one-hour window at 02:00 on that night still opens (03:00-04:00 EDT): a weekly window skips no week.
  const sunday = { days: [0], start: '02:00', hours: 1 }
  let open = 0
  for (let t = at('2026-03-08T05:00:00Z'); t < at('2026-03-08T11:00:00Z'); t += 60_000) if (inWindow(sunday, 'America/New_York', t)) open++
  assert.equal(open, 60)
  assert.equal(inWindow(sunday, 'America/New_York', at('2026-03-08T07:00:00Z')), true)
  assert.equal(inWindow(sunday, 'America/New_York', at('2026-03-08T08:00:00Z')), false)
  // A start that exists, with its hour cut short by the change (01:30 for an hour): still a full hour.
  open = 0
  for (let t = at('2026-03-08T05:00:00Z'); t < at('2026-03-08T11:00:00Z'); t += 60_000) if (inWindow({ days: [0], start: '01:30', hours: 1 }, 'America/New_York', t)) open++
  assert.equal(open, 60)
  // Any other Sunday: the same hour.
  open = 0
  for (let t = at('2026-03-15T05:00:00Z'); t < at('2026-03-15T11:00:00Z'); t += 60_000) if (inWindow(sunday, 'America/New_York', t)) open++
  assert.equal(open, 60)
  // 2026-10-25: London falls back at 02:00 BST to 01:00 GMT. 01:30 happens twice; both count for 01:00-02:00.
  const london = { days: [0], start: '01:00', hours: 1 }
  assert.equal(inWindow(london, 'Europe/London', at('2026-10-25T00:30:00Z')), true) // 01:30 BST
  assert.equal(inWindow(london, 'Europe/London', at('2026-10-25T01:30:00Z')), true) // 01:30 GMT
  assert.equal(inWindow(london, 'Europe/London', at('2026-10-25T02:30:00Z')), false)
  // Saturday 23:00 for 3 hours runs into Sunday.
  const night = { days: [6], start: '23:00', hours: 3 }
  assert.equal(inWindow(night, 'UTC', at('2026-11-29T01:30:00Z')), true) // Sunday 01:30
  assert.equal(inWindow(night, 'UTC', at('2026-11-29T02:00:00Z')), false)
  assert.equal(inWindow(night, 'UTC', at('2026-11-28T22:59:00Z')), false)
  // Only the chosen days.
  const weekdays = { days: [1, 2, 3, 4, 5], start: '04:00', hours: 2 }
  assert.equal(inWindow(weekdays, 'UTC', at('2026-11-29T04:30:00Z')), false) // Sunday
  assert.equal(nextWindow(weekdays, 'UTC', at('2026-11-29T04:30:00Z')), at('2026-11-30T04:00:00Z'))
  // Tokyo has no daylight saving: 04:00 JST is 19:00Z the day before.
  assert.equal(inWindow({ days: [3], start: '04:00', hours: 1 }, 'Asia/Tokyo', at('2026-11-24T19:15:00Z')), true)
})

test('an admin\'s policy is checked: time zone, days, start, length, waiting, channel; unknown fields dropped', () => {
  const { policy: good, errors } = normalizePolicy({ auto: true, channel: 'preview', timeZone: 'America/Chicago', window: { days: [5, 1, 1], start: '22:30', hours: 4 }, holdBackDays: 0, evil: 1 })
  assert.deepEqual(errors, [])
  assert.deepEqual(good.window, { days: [1, 5], start: '22:30', hours: 4 })
  assert.equal('evil' in good, false)
  const bad = normalizePolicy({ channel: 'nightly', timeZone: 'Mars/Olympus', window: { days: [], start: '25:00', hours: 0 }, holdBackDays: 99 })
  assert.deepEqual(bad.errors.map(e => e.field).sort(), ['channel', 'holdBackDays', 'timeZone', 'window.days', 'window.hours', 'window.start'])
})
