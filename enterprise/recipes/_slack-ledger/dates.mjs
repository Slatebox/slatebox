// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The dates people commit to in a channel ("by Friday", "Dec 12", "next Tuesday", "12/5", "in 3
// days", "end of month"), resolved against the day the message was sent, in the owner's time zone.
// Deterministic: no model. A vague date ("next sprint", "soon", "Q1") is reported as vague, so the
// commitment goes to the Commitments board without a due date rather than onto a guessed day.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WEEKDAY_SHORT = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 }
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_SHORT = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 }

const DAY = 86400000
const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => {
  const date = new Date(Date.UTC(y, m, d))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** The calendar day of an instant in a time zone, as { y, m (0-11), d, weekday (0 = Sunday) }. */
export function localDay(at, tz = 'UTC') {
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(at))
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(at))
  }
  const get = (type) => Number(parts.find((p) => p.type === type).value)
  const y = get('year')
  const m = get('month') - 1
  const d = get('day')
  return { y, m, d, weekday: new Date(Date.UTC(y, m, d)).getUTCDay() }
}

const addDays = ({ y, m, d }, n) => iso(y, m, d + n)
const monthIndex = (word) => {
  const w = word.toLowerCase().replace(/\.$/, '')
  const full = MONTHS.indexOf(w)
  return full >= 0 ? full : MONTH_SHORT[w] ?? -1
}
const weekdayIndex = (word) => {
  const w = word.toLowerCase()
  const full = WEEKDAYS.indexOf(w)
  return full >= 0 ? full : WEEKDAY_SHORT[w] ?? -1
}

// A month and day with no year: this year, unless that is more than 60 days before the message (then next year).
function dayInYear(anchor, month, day) {
  if (month < 0 || day < 1 || day > 31) return null
  let year = anchor.y
  const candidate = Date.UTC(year, month, day)
  if (candidate < Date.UTC(anchor.y, anchor.m, anchor.d) - 60 * DAY) year++
  const date = new Date(Date.UTC(year, month, day))
  if (date.getUTCMonth() !== month) return null
  return iso(year, month, day)
}

const VAGUE = /\b(next|this|following) (sprint|quarter|release|cycle|milestone)\b|\b(soon|asap|eventually|later this (year|quarter)|q[1-4]|h[12])\b/i

/**
 * The first date a text names, resolved against the message's instant: { due: 'YYYY-MM-DD', phrase }
 * or { vague: phrase } or null.
 */
export function resolveDue(text, at, { tz = 'UTC' } = {}) {
  const t = ` ${String(text || '')} `
  const anchor = localDay(at, tz)
  const found = []
  const add = (index, due, phrase) => due && found.push({ index, due, phrase: phrase.trim() })
  let m
  // ISO 2026-12-05
  for (m of t.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) add(m.index, iso(+m[1], +m[2] - 1, +m[3]), m[0])
  // US 12/5 or 12/5/2026 (month first), never a fraction like 1/2 inside a longer number
  for (m of t.matchAll(/(?<![\d/])(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])(?:\/(20\d{2}|\d{2}))?(?![\d/])/g)) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null
    add(m.index, year ? iso(year, +m[1] - 1, +m[2]) : dayInYear(anchor, +m[1] - 1, +m[2]), m[0])
  }
  // Dec 5, December 5th, Dec. 5
  for (m of t.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(20\d{2}))?/gi))
    add(m.index, m[3] ? iso(+m[3], monthIndex(m[1]), +m[2]) : dayInYear(anchor, monthIndex(m[1]), +m[2]), m[0])
  // 5 Dec, 5th of December
  for (m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi))
    add(m.index, dayInYear(anchor, monthIndex(m[2]), +m[1]), m[0])
  // today, tonight, EOD, tomorrow
  for (m of t.matchAll(/\b(today|tonight|eod|end of (the )?day)\b/gi)) add(m.index, addDays(anchor, 0), m[0])
  for (m of t.matchAll(/\b(tomorrow|tmrw)\b/gi)) add(m.index, addDays(anchor, 1), m[0])
  // in 3 days, in 2 weeks
  for (m of t.matchAll(/\bin (\d{1,2}|a|one|two|three|four) (day|days|week|weeks)\b/gi)) {
    const n = { a: 1, one: 1, two: 2, three: 3, four: 4 }[m[1].toLowerCase()] ?? +m[1]
    add(m.index, addDays(anchor, /week/i.test(m[2]) ? n * 7 : n), m[0])
  }
  // end of week (Friday), end of month, next week (its Monday)
  for (m of t.matchAll(/\b(end of (the )?week|eow)\b/gi)) add(m.index, addDays(anchor, (5 - anchor.weekday + 7) % 7), m[0])
  for (m of t.matchAll(/\b(end of (the )?month|eom)\b/gi)) add(m.index, iso(anchor.y, anchor.m + 1, 0), m[0])
  for (m of t.matchAll(/\bnext week\b/gi)) add(m.index, addDays(anchor, ((8 - anchor.weekday) % 7) || 7), m[0])
  // (next|this|by|on|until|before) Friday, or a bare weekday
  for (m of t.matchAll(/\b(?:(next|this|by|on|until|before|due)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/gi)) {
    const target = weekdayIndex(m[2])
    if (target < 0) continue
    if (!m[1] && m[2].length <= 3 && /^(sat|sun|mon|wed)$/i.test(m[2]) && !/[A-Z]/.test(m[2][0])) continue // "sat on it", lowercase short words
    let ahead = (target - anchor.weekday + 7) % 7 || 7
    if (m[1] && m[1].toLowerCase() === 'next' && anchor.weekday !== 0 && anchor.weekday + ahead <= 6) ahead += 7
    add(m.index, addDays(anchor, ahead), m[0])
  }
  if (found.length) {
    found.sort((a, b) => a.index - b.index)
    return { due: found[0].due, phrase: found[0].phrase }
  }
  const vague = t.match(VAGUE)
  return vague ? { vague: vague[0] } : null
}

/** Days from one ISO day to another (b - a). */
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY)

/** The ISO day of an instant in a time zone. */
export const isoDayIn = (at, tz = 'UTC') => {
  const d = localDay(at, tz)
  return iso(d.y, d.m, d.d)
}
