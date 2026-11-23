import { validateWorkshop } from 'slateboxjs/workshops/model'
import { dayFromWords, isoAt, offsetOf, scheduleLaunch } from 'slateboxjs/workshops/rules'

// The day a request names for launch (“Add a launch plan for our app launching in March”, “… for the
// 12 March launch”, “… going live by 2027-03-05”), and the library's launch plan dated to it. The
// library's plan otherwise launches on its third Friday, whatever the request said. Server only: it
// brings the plans' rules.

const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
// A month on its own is a date only after words that say when (“in May”, “launching March”), never “we may”.
const WHEN = 'in|by|on|for|until|before|around|launch(?:ing|es|ed)?|ship(?:ping|s)?|releas(?:e|es|ing)|due|live|the'
const ISO = /\b(\d{4}-\d{2}-\d{2})\b/
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH})\\b\\.?(?:,?\\s+(\\d{4}))?`, 'i')
const MONTH_DAY = new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?![:\\d])(?:,?\\s+(\\d{4}))?`, 'i')
const PART = new RegExp(`\\b(early|mid|late|(?:the\\s+)?(?:start|beginning|middle|end)\\s+of)[\\s-]+(${MONTH})\\b\\.?(?:\\s+(\\d{4}))?`, 'i')
const ALONE = new RegExp(`\\b(?:${WHEN})\\s+(${MONTH})\\b\\.?(?:\\s+(\\d{4}))?`, 'i')

const monthIndex = name => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(name.slice(0, 3).toLowerCase())
const pad = n => String(n).padStart(2, '0')
const lastDate = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

/**
 * The calendar offset from `origin` (YYYY-MM-DD) of the day `words` name, or null when they name none.
 * A month alone is its first day; “mid March” its 15th; “late March” or “end of March” its last. A date
 * before `origin` without a year is the next year's.
 */
export function namedDay(origin, words) {
  const text = String(words ?? '')
  const on = (year, month, date) => offsetOf(origin, `${year}-${pad(month + 1)}-${pad(date)}`)
  // The first day of a month as dayFromWords dates it (this year, or next when it has passed), and its year.
  const monthStart = (name, year) => {
    const month = monthIndex(name)
    if (year) return { offset: on(+year, month, 1), year: +year, month }
    const offset = dayFromWords(origin, name)
    return offset === null ? null : { offset, year: +isoAt(origin, offset).slice(0, 4), month }
  }
  let m
  if ((m = ISO.exec(text))) return offsetOf(origin, m[1])
  if ((m = DAY_MONTH.exec(text)) || (m = MONTH_DAY.exec(text))) {
    const [date, name] = /^\d/.test(m[1]) ? [+m[1], m[2]] : [+m[2], m[1]]
    const start = monthStart(name, m[3])
    if (!start || date < 1 || date > lastDate(start.year, start.month)) return null
    return m[3] ? on(start.year, start.month, date) : dayFromWords(origin, `${date} ${name}`)
  }
  if ((m = PART.exec(text))) {
    const start = monthStart(m[2], m[3])
    if (!start) return null
    const part = m[1].toLowerCase()
    if (/early|start|beginning/.test(part)) return start.offset
    if (/mid|middle/.test(part)) return start.offset + 14
    return start.offset + lastDate(start.year, start.month) - 1
  }
  if ((m = ALONE.exec(text))) return monthStart(m[1], m[2])?.offset ?? null
  return null
}

/**
 * A dated launch plan (the library's) launching on the day `words` name, its tasks as they were. Launch more
 * than 120 days out (the furthest a plan's line goes) starts the plan later, by whole weeks, so it still
 * starts on a Monday. A day too soon for the tasks (they would run past a hard line) is the first day they
 * fit by. The plan as it was when the words name no day, or a day already past.
 */
export function datedLaunchPlan(workshop, words) {
  if (workshop?.kind !== 'launch-plan' || !workshop.clock?.origin) return workshop
  const wanted = namedDay(workshop.clock.origin, words)
  if (wanted === null || !Number.isFinite(wanted) || wanted < 0) return workshop
  const later = wanted > 120 ? Math.ceil((wanted - 120) / 7) * 7 : 0
  const clock = { ...workshop.clock, origin: isoAt(workshop.clock.origin, later) }
  const dated = day => ({ ...workshop, clock, launch: { ...workshop.launch, day } })
  const day = Math.max(5, wanted - later)
  try {
    return validateWorkshop(dated(day))
  } catch {
    // Too soon for the tasks: the first day they all end by.
    const fits = Math.max(day, ...[...scheduleLaunch(dated(120)).values()].map(t => t.to))
    try { return validateWorkshop(dated(Math.min(120, fits))) } catch { return workshop }
  }
}
