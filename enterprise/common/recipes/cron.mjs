// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Five-field cron (minute hour day-of-month month day-of-week) and its next time after a moment,
// in a time zone, with Intl alone (no dependency). Browser-safe: the recipe form shows the next run
// with the same code the scheduler uses.
//   *  a,b  a-b  */n  a-b/n  names (jan..dec, sun..sat), 7 is Sunday too.
// As in classic cron, when both day-of-month and day-of-week are restricted a day matches either.

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] },
  { name: 'weekday', min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
]

export class CronError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CronError'
    this.status = 400
    this.code = 'bad_cron'
  }
}

function valueOf(raw, field) {
  const text = String(raw).toLowerCase()
  if (field.names) {
    const at = field.names.indexOf(text)
    if (at >= 0) return at + (field.name === 'month' ? 1 : 0)
  }
  if (!/^\d{1,2}$/.test(text)) throw new CronError(`The ${field.name} field has "${raw}", which is not a number.`)
  const value = Number(text)
  if (value < field.min || value > field.max) throw new CronError(`The ${field.name} field goes from ${field.min} to ${field.max}.`)
  return value
}

function parseField(text, field) {
  const values = new Set()
  for (const part of text.split(',')) {
    if (!part) throw new CronError(`The ${field.name} field has an empty item.`)
    const [range, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1 || step > field.max) throw new CronError(`The ${field.name} field has a step that is not a whole number.`)
    let from
    let to
    if (range === '*') {
      from = field.min
      to = field.name === 'weekday' ? 6 : field.max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-')
      from = valueOf(a, field)
      to = valueOf(b, field)
      if (to < from) throw new CronError(`The ${field.name} field has a range that runs backward.`)
    } else {
      from = valueOf(range, field)
      to = stepText === undefined ? from : field.max
    }
    for (let v = from; v <= to; v += step) values.add(field.name === 'weekday' && v === 7 ? 0 : v)
  }
  return values
}

/** A parsed expression: { minute, hour, day, month, weekday: Set<number>, dayAny, weekdayAny, source }. */
export function parseCron(expression) {
  if (typeof expression !== 'string') throw new CronError('A schedule is five fields: minute hour day month weekday.')
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new CronError('A schedule is five fields: minute hour day month weekday.')
  const out = { source: parts.join(' ') }
  FIELDS.forEach((field, k) => {
    out[field.name] = parseField(parts[k], field)
  })
  out.dayAny = parts[2] === '*'
  out.weekdayAny = parts[4] === '*'
  return out
}

export const isValidCron = (expression) => {
  try {
    parseCron(expression)
    return true
  } catch {
    return false
  }
}

const formatters = new Map()
function formatterFor(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short',
    }))
  }
  return formatters.get(tz)
}
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** The wall-clock parts of an instant in a time zone. */
export function localParts(ms, tz = 'UTC') {
  const parts = {}
  for (const { type, value } of formatterFor(tz).formatToParts(new Date(ms))) parts[type] = value
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: WEEKDAYS[parts.weekday] }
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try {
    formatterFor(tz)
    return true
  } catch {
    return false
  }
}

const MINUTE = 60_000

function dayMatches(cron, p) {
  const byDay = cron.day.has(p.day)
  const byWeekday = cron.weekday.has(p.weekday)
  if (cron.dayAny && cron.weekdayAny) return true
  if (cron.dayAny) return byWeekday
  if (cron.weekdayAny) return byDay
  return byDay || byWeekday
}

/**
 * The first minute strictly after `from` that the expression names, in `tz`, as a Date; null when
 * none falls within about 4 years (a "31 feb" that never comes).
 */
export function nextAfter(expression, tz = 'UTC', from = Date.now()) {
  const cron = typeof expression === 'string' ? parseCron(expression) : expression
  if (!isValidTimeZone(tz)) throw new CronError('That time zone is not known.')
  let t = Math.floor((from instanceof Date ? from.getTime() : Number(from)) / MINUTE) * MINUTE + MINUTE
  const limit = t + 4 * 366 * 24 * 60 * MINUTE
  for (let guard = 0; t < limit && guard < 200000; guard += 1) {
    const p = localParts(t, tz)
    if (!cron.month.has(p.month) || !dayMatches(cron, p)) {
      // to the next local midnight (re-read after: a DST day is 23 or 25 hours)
      t += ((23 - p.hour) * 60 + (60 - p.minute)) * MINUTE
      continue
    }
    if (!cron.hour.has(p.hour)) {
      t += (60 - p.minute) * MINUTE
      continue
    }
    if (!cron.minute.has(p.minute)) {
      t += MINUTE
      continue
    }
    return new Date(t)
  }
  return null
}

/** The shortest gap between two runs, in minutes, over the next week: the 15-minute floor's check. */
export function shortestGapMinutes(expression, tz = 'UTC', from = Date.now()) {
  const cron = parseCron(expression)
  let at = nextAfter(cron, tz, from)
  let best = Infinity
  for (let k = 0; at && k < 200; k += 1) {
    const next = nextAfter(cron, tz, at)
    if (!next) break
    best = Math.min(best, (next - at) / MINUTE)
    if (next - from > 7 * 24 * 60 * MINUTE) break
    at = next
  }
  return best
}
