// Admin › Updates' words (imports/ui/pages/admin/updates/updates-view.mjs) for each state the page shows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { STEPS, ago, attemptRows, eventRows, noteLines, primaryAction, stepIndex, timeZones, updaterLine, windowWords } from '../web/app/imports/ui/pages/admin/updates/updates-view.mjs'

const NOW = Date.parse('2026-11-25T12:00:00Z')
const base = { mode: 'auto', updater: { at: new Date(NOW - 3 * 60000), late: false }, available: null, attempt: null, decision: { reason: 'up-to-date' } }

test('the host updater line: connected, not set up (with the command), silent, off', () => {
  assert.equal(updaterLine(base, NOW).text, 'Host updater checked in 3 min ago')
  assert.equal(updaterLine({ ...base, updater: null }).command, 'npx slatebox updates enable')
  assert.match(updaterLine({ ...base, updater: { at: new Date(NOW - 4 * 86400000), late: true } }, NOW).text, /has not checked in since 4 days ago/)
  assert.match(updaterLine({ ...base, mode: 'off' }).text, /SLATEBOX_UPDATES=off/)
})

test('the main action: approve a major, update now, try again after a rollback, cancel a pending request, nothing while running', () => {
  const available = { version: '2.1.0', major: false, approved: false }
  assert.equal(primaryAction(base), null)
  assert.deepEqual(primaryAction({ ...base, available }), { kind: 'apply', label: 'Update now' })
  assert.deepEqual(primaryAction({ ...base, available: { ...available, version: '3.0.0', major: true } }), { kind: 'approve', label: 'Approve 3.0.0' })
  assert.equal(primaryAction({ ...base, available, decision: { reason: 'not-retried' } }).kind, 'retry')
  assert.equal(primaryAction({ ...base, available, requestPending: true }).kind, 'cancel')
  assert.equal(primaryAction({ ...base, available, attempt: { phase: 'pulling' } }), null)
  assert.equal(primaryAction({ ...base, available, mode: 'off' }), null)
})

test('live steps, history rows and events', () => {
  assert.deepEqual(STEPS.map(s => s.phase), ['verifying', 'pulling', 'backing-up', 'starting', 'healthy'])
  assert.equal(stepIndex('starting'), 3)
  const rows = attemptRows({ attempts: [{ id: 'a', kind: 'apply', from: '2.0.0', target: '2.1.0', outcome: 'rolled-back', detail: 'not healthy', at: new Date(NOW) }, { id: 'b', kind: 'rollback', from: '2.1.0', outcome: 'healthy' }] })
  assert.equal(rows[0].change, '2.0.0 → 2.1.0')
  assert.equal(rows[0].outcome.label, 'Rolled back')
  assert.equal(rows[1].change, '2.1.0 → previous version')
  const events = eventRows({ history: [{ kind: 'check', ok: true, detail: 'stable 2.1.0' }, { kind: 'admin', detail: 'approved 3.0.0' }, { kind: 'attempt', phase: 'pulling' }, { kind: 'check', ok: false, detail: 'offline' }] })
  assert.deepEqual(events.map(e => e.text), ['Checked GitHub: stable 2.1.0', 'An admin approved 3.0.0', 'The check failed: offline'])
})

test('the window in words, time zones (the admin\'s first), times ago, release notes as plain lines', () => {
  assert.equal(windowWords({ window: { days: [0, 1, 2, 3, 4, 5, 6], start: '04:00', hours: 2 }, timeZone: 'America/New_York' }), 'Every day, 04:00 to 06:00 (America/New_York)')
  assert.equal(windowWords({ window: { days: [6], start: '23:00', hours: 3 }, timeZone: 'UTC' }), 'Sat, 23:00 to 02:00 (UTC)')
  assert.equal(windowWords({ window: { days: [1, 2, 3, 4, 5], start: '01:30', hours: 1 }, timeZone: 'UTC' }), 'Weekdays, 01:30 to 02:30 (UTC)')
  assert.equal(timeZones('Europe/London')[0], 'Europe/London')
  assert.ok(timeZones().includes('UTC'))
  assert.equal(ago(new Date(NOW - 30_000), NOW), 'just now')
  assert.equal(ago(new Date(NOW - 3 * 3600_000), NOW), '3 hours ago')
  assert.deepEqual(noteLines('## 2.1.0\n- **Faster** boards\n\nplain <b>text</b>'), [{ kind: 'heading', text: '2.1.0' }, { kind: 'item', text: 'Faster boards' }, { kind: 'text', text: 'plain <b>text</b>' }])
})
