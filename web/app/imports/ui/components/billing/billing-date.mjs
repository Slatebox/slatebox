// Every Pro and billing date a person reads (Profile → Credits, the pay sheet's Your Pro, its
// Welcome, receipts, the balance's rows) comes from here, in one format: the person's own calendar
// date of the timestamp. Stripe's timestamps are instants; the date they fall on depends on where
// the person is, so a date is never read in UTC in one place and locally in another. Pure.
// Tested in scripts/billing-date.test.mjs.

const FORMATS = Object.freeze({
  long: { day: 'numeric', month: 'long', year: 'numeric' }, // December 22, 2026
  dayMonth: { day: 'numeric', month: 'long' }, // December 22
  short: { day: 'numeric', month: 'short' }, // Dec 22
})

const asDate = (at) => {
  if (at === null || at === undefined || at === '') return null
  const d = at instanceof Date ? at : new Date(at)
  return Number.isNaN(d.getTime()) ? null : d
}

/** at: an ISO string, epoch ms or a Date → "December 22, 2026" (style 'long'), or '' when there is none. */
export function billingDate(at, style = 'long') {
  const d = asDate(at)
  return d ? d.toLocaleDateString('en-US', FORMATS[style] || FORMATS.long) : ''
}

const SUFFIX = { 1: 'st', 2: 'nd', 3: 'rd' }
/** "22nd": the day of the month the timestamp falls on, locally. */
export function dayOfMonth(at) {
  const d = asDate(at)
  if (!d) return ''
  const n = d.getDate()
  const r = n % 100
  return `${n}${(r < 11 || r > 13) && SUFFIX[n % 10] ? SUFFIX[n % 10] : 'th'}`
}

/** Profile → Credits: the sentence about the person's Pro (proState from meter.summary), or null. */
export function proStatusText(pro) {
  if (pro?.onHold) return 'Your Pro credits are paused while a card dispute on a Pro payment is open. Your balance still works.'
  if (pro?.pastDue) return "Your Pro payment didn't go through, so your credits are paused. Update your card to turn them back on."
  if (pro?.active && pro.endsOn) return `You have Slatebox Pro until ${billingDate(pro.endsOn)}. It will not renew.`
  if (pro?.active) return `You have Slatebox Pro (${pro.interval === 'year' ? 'yearly' : 'monthly'}). It renews on ${billingDate(pro.renewsOn)}.`
  return null
}
