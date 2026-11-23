// Slatebox Pro: the one place its product, prices and credits are written down. Stripe
// (scripts/stripe-catalog.mjs), the checkout (server/methods/pro.js) and the profile read from
// here. Pure data: no Meteor, no Stripe.
//
// Slatebox is free and open source. Pro is one optional personal purchase on Slatebox Cloud:
// it includes a monthly amount of AI and calls on Slatebox's own providers ("Pro credits"),
// sized to about $3.75 of provider cost a month (policy.mjs sizeCredits) so that full use never
// costs more than Pro brings in, even yearly, on an international card, with tax on top. Own keys are a self-hosted feature (own-keys.mjs), never part of Cloud; top-ups work with or without Pro.
// For a team, Slatebox Business (business/catalog.mjs) adds a shared pool per person.
import { DEFAULT_METERING, proCreditsInWords } from '../../../server/metering/policy.mjs'

export { proCreditsInWords }

export const PRO_PRODUCT = Object.freeze({
  // A fixed Stripe product id, so the sync and the webhook find the same product every time.
  id: 'slatebox_pro',
  name: 'Slatebox Pro',
  description: 'Included AI and calls on Slatebox Cloud each month. Cancel any time.',
  // Stripe Tax: software as a service, personal use.
  taxCode: 'txcd_10103000',
  currency: 'usd',
  // Prices are shown before tax ("plus tax where applicable"); Stripe Tax adds it at checkout.
  taxBehavior: 'exclusive',
  catalogVersion: '1',
})

export const PRO_LOOKUP_KEYS = Object.freeze({ month: 'pro_monthly_usd_500', year: 'pro_yearly_usd_5000' })

export const PRO_PRICES = Object.freeze([
  Object.freeze({ lookupKey: PRO_LOOKUP_KEYS.month, nickname: 'Slatebox Pro, monthly', unitAmount: 500, interval: 'month', intervalCount: 1 }),
  // two months free against twelve monthly payments
  Object.freeze({ lookupKey: PRO_LOOKUP_KEYS.year, nickname: 'Slatebox Pro, yearly', unitAmount: 5000, interval: 'year', intervalCount: 1 }),
])

export const intervalOfLookupKey = lookupKey => PRO_PRICES.find(p => p.lookupKey === lookupKey)?.interval ?? null

// What Pro includes each calendar month (UTC): the meter's own numbers, so there is one source.
export function proCredits(free = DEFAULT_METERING.free) {
  return Object.freeze({
    creditCostMicrosPerMonth: free.creditCostMicrosPerMonth,
    aiDraftsPerDay: free.aiActionsPerDay,
    aiMicrosPerMonth: free.aiMicrosPerMonth,
    voiceMinutesPerMonth: free.voiceMinutesPerMonth,
    videoMinutesPerMonth: free.videoMinutesPerMonth,
    perPersonMicrosPerDay: free.perPersonMicrosPerDay,
  })
}
export const PRO_CREDITS = proCredits()

export function proStripePrices() {
  return PRO_PRICES.map(p => ({
    lookupKey: p.lookupKey,
    nickname: p.nickname,
    active: true,
    unitAmount: p.unitAmount,
    interval: p.interval,
    intervalCount: p.intervalCount,
    metadata: { product: 'pro', interval: p.interval },
  }))
}

export function proProductMetadata() {
  return {
    catalog: 'slatebox-pro',
    catalog_version: PRO_PRODUCT.catalogVersion,
    credit_cost_micros_month: String(PRO_CREDITS.creditCostMicrosPerMonth),
    ai_drafts_per_day: String(PRO_CREDITS.aiDraftsPerDay),
    voice_minutes_month: String(PRO_CREDITS.voiceMinutesPerMonth),
    video_minutes_month: String(PRO_CREDITS.videoMinutesPerMonth),
  }
}

// The customer portal Slatebox configures for Pro (the one product Slatebox sells through Stripe).
export const PRO_PORTAL = Object.freeze({
  metadataKey: 'slatebox_portal',
  metadataValue: 'pro-1',
  headline: 'Manage Slatebox Pro',
  termsUrl: 'https://slatebox.com/terms/',
  privacyUrl: 'https://slatebox.com/privacy/',
})
