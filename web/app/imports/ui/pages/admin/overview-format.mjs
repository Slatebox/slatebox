// How the admin Overview says its numbers. Pure, so the tests read the same words the page shows.

const SYMBOL = { usd: '$', eur: '€', gbp: '£', cad: 'CA$', aud: 'A$' }

/** 123456 (cents) in 'usd' → "$1,234.56". Whole amounts drop the cents: 500 → "$5". */
export function money(cents, currency = 'usd') {
  const value = Number.isFinite(cents) ? cents : 0
  const code = String(currency || 'usd').toLowerCase()
  const whole = value % 100 === 0
  const text = (Math.abs(value) / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
  const sign = value < 0 ? '-' : ''
  return SYMBOL[code] ? `${sign}${SYMBOL[code]}${text}` : `${sign}${text} ${code.toUpperCase()}`
}

/** { usd: 500, eur: 200 } → "$5 · €2"; nothing → "$0". */
export function moneyTotals(totals) {
  const entries = Object.entries(totals || {}).filter(([, v]) => Number.isFinite(v))
  if (!entries.length) return money(0)
  return entries.map(([code, cents]) => money(cents, code)).join(' · ')
}

/** Micro-dollars (the meter's unit) → "$0.94"; below a cent → "<$0.01". */
export function micros(value) {
  const n = Number.isFinite(value) ? value : 0
  if (n > 0 && n < 10_000) return '<$0.01'
  return money(Math.round(n / 10_000))
}

/** 12345 → "12,345"; a capped list → "2,000+". */
export function count(value, capped = false) {
  const n = Number.isFinite(value) ? value : 0
  return `${n.toLocaleString('en-US')}${capped ? '+' : ''}`
}

/** An ISO time → "Nov 24, 2026". */
export function day(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** The subscription table's rows, in order (the server's plan ids, server/admin/dashboard-core.mjs). */
export const PLAN_ROWS = Object.freeze([
  ['pro_monthly', 'Pro monthly'], ['pro_yearly', 'Pro yearly'], ['business_monthly', 'Business monthly'],
  ['business_yearly', 'Business yearly'], ['other', 'Other prices'],
])
