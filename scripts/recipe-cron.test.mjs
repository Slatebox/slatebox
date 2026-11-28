// Five-field cron and its next time in a time zone (enterprise/common/recipes/cron.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextAfter, parseCron, isValidCron, shortestGapMinutes, CronError } from '../enterprise/common/recipes/cron.mjs'

const at = (iso) => new Date(iso).getTime()

test('daily at 03:00 UTC', () => {
  assert.equal(nextAfter('0 3 * * *', 'UTC', at('2026-11-27T02:59:00Z')).toISOString(), '2026-11-27T03:00:00.000Z')
  assert.equal(nextAfter('0 3 * * *', 'UTC', at('2026-11-27T03:00:00Z')).toISOString(), '2026-11-28T03:00:00.000Z')
})

test('weekdays at 18:00 in New York, across the DST change', () => {
  // Friday 2026-10-30 18:00 EDT = 22:00Z; next weekday is Monday 2026-11-02 18:00 EST = 23:00Z
  assert.equal(nextAfter('0 18 * * mon-fri', 'America/New_York', at('2026-10-30T22:00:00Z')).toISOString(), '2026-11-02T23:00:00.000Z')
})

test('Monday 07:30 in Berlin', () => {
  assert.equal(nextAfter('30 7 * * 1', 'Europe/Berlin', at('2026-11-27T12:00:00Z')).toISOString(), '2026-11-30T06:30:00.000Z')
})

test('steps, lists and ranges', () => {
  const c = parseCron('*/15 9-17 * * 1,3,5')
  assert.deepEqual([...c.minute], [0, 15, 30, 45])
  assert.deepEqual([...c.hour], [9, 10, 11, 12, 13, 14, 15, 16, 17])
  assert.deepEqual([...c.weekday].sort(), [1, 3, 5])
  assert.equal(nextAfter('*/15 * * * *', 'UTC', at('2026-11-27T10:07:30Z')).toISOString(), '2026-11-27T10:15:00.000Z')
})

test('day of month or day of week, as classic cron', () => {
  // the 1st, or any Sunday
  assert.equal(nextAfter('0 0 1 * 0', 'UTC', at('2026-11-27T00:00:00Z')).toISOString(), '2026-11-29T00:00:00.000Z')
})

test('7 is Sunday; names work', () => {
  assert.deepEqual([...parseCron('0 0 * * 7').weekday], [0])
  assert.deepEqual([...parseCron('0 0 * jan,dec *').month], [1, 12])
})

test('a date that never comes answers null', () => {
  assert.equal(nextAfter('0 0 31 2 *', 'UTC', at('2026-01-01T00:00:00Z')), null)
})

test('bad expressions are refused with a sentence', () => {
  for (const bad of ['', '* * * *', '60 * * * *', '* 24 * * *', '5-1 * * * *', 'x * * * *', '*/0 * * * *']) {
    assert.equal(isValidCron(bad), false, bad)
    assert.throws(() => parseCron(bad), CronError)
  }
  assert.throws(() => nextAfter('0 0 * * *', 'Mars/Olympus'), /time zone/)
})

test('the shortest gap tells a 15-minute floor apart', () => {
  assert.equal(shortestGapMinutes('*/15 * * * *', 'UTC', at('2026-01-05T00:00:00Z')), 15)
  assert.equal(shortestGapMinutes('*/5 * * * *', 'UTC', at('2026-01-05T00:00:00Z')), 5)
  assert.equal(shortestGapMinutes('0 3 * * *', 'UTC', at('2026-01-05T00:00:00Z')), 1440)
})
