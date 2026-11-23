// Slatebox Business: a team inside the shared, fully managed Slatebox Cloud, priced per person.
// Pure data, the one place its terms are written down. Its billing is not built yet: until it is,
// Business is sold by talking to us (BUSINESS_CONTACT_URL), never through a checkout, and
// nothing here is created in Stripe (scripts/stripe-catalog.mjs is Pro only).
//
// Single sign-on and the audit log are not on Slatebox Cloud yet. When they come to Cloud they will
// be free for every team; Business adds the team's shared AI and call pool and hands-on help.

// The one place the app links "Talk to us about Business": the site's contact form with the
// business topic, the same link the marketing site ("contact-form" in site/features.json) and the
// docs (slatebox-business.md, pricing.md) use.
export const BUSINESS_CONTACT_URL = 'https://slatebox.com/contact/?topic=business'

export const BUSINESS = Object.freeze({
  name: 'Slatebox Business',
  summary: 'A team on Slatebox Cloud, shared and fully managed, at $6 per person a month or $60 per person a year, plus tax where applicable.',
  includes: Object.freeze([
    'A shared AI and call pool for the team: each member adds the same amount Slatebox Pro includes',
    'Moving a self-hosted Slatebox across (coming)',
    'Hands-on help for large teams',
  ]),
  // what every member adds to the team's pool: Slatebox Pro's credits (pro/catalog.mjs)
  creditsPerMember: 'pro',
  // a Business checkout exists only once its billing ships; until then, talk to us (contactUrl)
  billingBuilt: false,
  contactLabel: 'Talk to us about Business',
  contactUrl: BUSINESS_CONTACT_URL,
})

// Per person (seat), before tax. Not in Stripe yet: added with Business billing.
export const BUSINESS_PRICES = Object.freeze([
  Object.freeze({ interval: 'month', unitAmountPerSeat: 600 }),
  Object.freeze({ interval: 'year', unitAmountPerSeat: 6000 }),
])
