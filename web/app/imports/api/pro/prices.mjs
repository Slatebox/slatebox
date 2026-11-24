// Slatebox Pro's two prices: the one place in the app they are written down. Pure data with no
// imports, read by the catalogue (catalog.mjs), the checkout's price check (pro-billing.mjs
// checkProPrice: a Stripe price that differs is never sold), the meter's refusals (policy.mjs) and
// the pay sheet and profile. Every amount the app shows for Pro is said from here (proPriceWords),
// never typed into copy; the central pricing page is https://slatebox.com/plans/.
export const PRO_LOOKUP_KEYS = Object.freeze({ month: 'pro_monthly_usd_500', year: 'pro_yearly_usd_5000' })

export const PRO_PRICES = Object.freeze([
  Object.freeze({ lookupKey: PRO_LOOKUP_KEYS.month, nickname: 'Slatebox Pro, monthly', unitAmount: 500, interval: 'month', intervalCount: 1 }),
  // two months free against twelve monthly payments
  Object.freeze({ lookupKey: PRO_LOOKUP_KEYS.year, nickname: 'Slatebox Pro, yearly', unitAmount: 5000, interval: 'year', intervalCount: 1 }),
])

const dollars = cents => (cents % 100 ? `$${(cents / 100).toFixed(2)}` : `$${cents / 100}`)

/** One Pro price in words: { amount: '$5', label: '$5 a month', cents: 500 } (interval 'month' | 'year'). */
export function proPriceWords(interval) {
  const price = PRO_PRICES.find(p => p.interval === interval)
  if (!price) throw new Error(`no Slatebox Pro price for ${interval}`)
  const amount = dollars(price.unitAmount)
  return Object.freeze({ amount, label: `${amount} a ${interval}`, cents: price.unitAmount })
}

/** Both: "$5 a month or $50 a year". */
export const proPricesInWords = () => `${proPriceWords('month').label} or ${proPriceWords('year').label}`
