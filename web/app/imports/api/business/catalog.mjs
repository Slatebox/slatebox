// Slatebox Business: a team inside the shared, fully managed Slatebox Cloud, paid per member.
// Pure data, the one place its terms are written down. A team owner or admin buys it in the app
// (server/business-billing.mjs) where settings.payments.business names its two Stripe prices;
// elsewhere, and on a server without them, Business is sold by talking to us (BUSINESS_CONTACT_URL).
// The app never states its amount: the pay sheet shows what Stripe has, and copy links the pricing
// page (PRICING_URL in common/contact.mjs). Nothing here is created in Stripe: the owner makes the
// product and prices (scripts/stripe-catalog.mjs is Pro only).
//
// On Slatebox Cloud, single sign-on, SCIM and the activity log come with Business too
// (common/team-security.mjs); a self-hosted server has them for every team, free.

// The one place the app links "Talk to us about Business": the site's contact form with the
// business topic, the same link the marketing site ("contact-form" in site/features.json) and the
// docs (slatebox-business.md, pricing.md) use.
export const BUSINESS_CONTACT_URL = 'https://slatebox.com/contact/?topic=business'

export const BUSINESS = Object.freeze({
  name: 'Slatebox Business',
  summary: 'A team on Slatebox Cloud, shared and fully managed, paid per member monthly or yearly, plus tax where applicable.',
  includes: Object.freeze([
    'A shared AI and call pool for the team: each member adds the same amount Slatebox Pro includes',
    'Hands-on help for large teams',
  ]),
  // what every member adds to the team's pool: Slatebox Pro's credits (pro/catalog.mjs)
  creditsPerMember: 'pro',
  // Whether it is sold in the app is not a code flag: it is on sale on Slatebox Cloud (its Cloud
  // key, server/cloud-lock.mjs) where settings.payments.business names both Stripe prices
  // (GET /api/v1/instance capabilities.businessCheckout; pro-figures businessCheckout).
  contactLabel: 'Talk to us about Business',
  contactUrl: BUSINESS_CONTACT_URL,
})

// Per member, before tax: $8 a month, or $80 a year (two months free, as with Pro). The figures the
// central pricing page (https://slatebox.com/plans/) states (scripts/pro-figures.mjs), never shown
// by the app itself. The prices sold are the Stripe prices settings name; when Stripe's amount
// differs from these, the server alerts (business-billing.mjs pricingPageDiffers) so the pricing
// page is brought in line, and the sheet still shows and charges Stripe's amount.
export const BUSINESS_PRICES = Object.freeze([
  Object.freeze({ interval: 'month', unitAmountPerSeat: 800 }),
  Object.freeze({ interval: 'year', unitAmountPerSeat: 8000 }),
])
