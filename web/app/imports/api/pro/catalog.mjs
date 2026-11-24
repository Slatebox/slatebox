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

import { PRO_PRICES } from './prices.mjs'

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

// The prices themselves, and the words the app says them in, live in prices.mjs (no imports, so the
// meter's copy in policy.mjs can say them too); the server refuses to sell a Stripe price that
// differs (pro-billing.mjs checkProPrice), so what the app says is what Stripe charges.
export { PRO_LOOKUP_KEYS, PRO_PRICES, proPriceWords, proPricesInWords } from './prices.mjs'

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
