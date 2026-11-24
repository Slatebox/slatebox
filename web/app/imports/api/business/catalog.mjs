// Slatebox Business: a team inside the shared, fully managed Slatebox Cloud, paid per member.
// Pure data, the one place its terms are written down. A team owner or admin buys it in the app
// (server/business-billing.mjs) where settings.payments.business names its two Stripe prices;
// elsewhere, and on a server without them, Business is sold by talking to us (BUSINESS_CONTACT_URL).
// The app never states its amount: the pay sheet shows what Stripe has, and copy links the pricing
// page (PRICING_URL in common/contact.mjs). Nothing here is created in Stripe: the owner makes the
// product and prices (scripts/stripe-catalog.mjs is Pro only).
//
// Single sign-on and the audit log are not on Slatebox Cloud yet. When they come to Cloud they will
// be free for every team; Business adds the team's shared AI and call pool and hands-on help.

// The one place the app links "Talk to us about Business": the site's contact form with the
// business topic, the same link the marketing site ("contact-form" in site/features.json) and the
// docs (slatebox-business.md, pricing.md) use.
export const BUSINESS_CONTACT_URL = 'https://slatebox.com/contact/?topic=business'

export const BUSINESS = Object.freeze({
  name: 'Slatebox Business',
  summary: 'A team on Slatebox Cloud, shared and fully managed, paid per person monthly or yearly, plus tax where applicable.',
  includes: Object.freeze([
    'A shared AI and call pool for the team: each member adds the same amount Slatebox Pro includes',
    'Inviting outside agents onto slates, for every member: Business counts as Slatebox Pro for this (membership.mjs)',
    'Moving a self-hosted Slatebox across (coming)',
    'Hands-on help for large teams',
  ]),
  // what every member adds to the team's pool: Slatebox Pro's credits (pro/catalog.mjs)
  creditsPerMember: 'pro',
  // the in-app checkout is built; it is on sale where settings.payments.business names both prices
  billingBuilt: true,
  contactLabel: 'Talk to us about Business',
  contactUrl: BUSINESS_CONTACT_URL,
})

// Per person, before tax: the figures the pricing page states (scripts/pro-figures.mjs), never
// shown by the app itself. The prices sold are the Stripe prices settings name; when Stripe's amount
// differs from these, the server alerts (business-billing.mjs pricingPageDiffers) so the pricing
// page is brought in line, and the sheet still shows and charges Stripe's amount.
export const BUSINESS_PRICES = Object.freeze([
  Object.freeze({ interval: 'month', unitAmountPerSeat: 600 }),
  Object.freeze({ interval: 'year', unitAmountPerSeat: 6000 }),
])
