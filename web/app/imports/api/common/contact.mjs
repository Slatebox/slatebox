// Where people reach Slatebox: the site's contact form, one topic per kind of question.
// Billing and metering messages (balance on hold, a refund or payment that did not go
// through, included use turned off) point here; the UI shows the URL as a link.
export const BILLING_CONTACT_URL = 'https://slatebox.com/contact/?topic=billing'
// The one pricing page (the site's /plans/; /pricing redirects there). Copy that would name an
// amount links here instead: amounts change, and the page and the sheet (read from Stripe) are
// the only places they are shown.
export const PRICING_URL = 'https://slatebox.com/plans/'
