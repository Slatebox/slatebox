import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { PRO_FIGURES, proBrings, sheetHeader, welcomeCopy, whyText, money } from '../web/app/imports/ui/components/billing/pay/pay-copy.mjs'
import { payRequestFromQuery, PAY_PARAMS } from '../web/app/imports/ui/components/billing/pay/pay-url.mjs'
import { stripeAppearance } from '../web/app/imports/ui/components/billing/pay/appearance.mjs'
import { PRO_PRICES } from '../web/app/imports/api/pro/catalog.mjs'
import { proCreditsInWords } from '../web/app/server/metering/policy.mjs'

// The pay sheet's pure parts and the wiring that keeps it lazy, styled and vendor-free (design §2, §5, §8).
const appDir = new URL('../web/app/', import.meta.url)
const read = path => readFileSync(new URL(path, appDir), 'utf8')
const PAY_DIR = 'imports/ui/components/billing/pay/'
const payFiles = () => readdirSync(new URL(PAY_DIR, appDir)).filter(f => /\.(jsx|js|mjs)$/.test(f)).map(f => PAY_DIR + f)

test('the Pro choices match the catalogue', () => {
  for (const price of PRO_PRICES) {
    assert.equal(PRO_FIGURES[price.interval].cents, price.unitAmount, price.interval)
  }
  assert.equal(PRO_FIGURES.month.label, '$5 a month')
  assert.equal(PRO_FIGURES.year.label, '$50 a year')
  assert.equal(PRO_FIGURES.year.tag, '2 months free')
})

test('what Pro brings comes from the meter\'s own words', () => {
  const credits = proCreditsInWords()
  const rows = proBrings(credits)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].text, `About ${credits.draftsPerMonth} AI drafts a month, up to ${credits.draftsPerDay} a day`)
  assert.equal(rows[1].text, 'Image search and image generation')
  assert.match(rows[2].text, /^About .* hours? of four-person voice calls and .* of video$/)
  assert.ok(rows.every(r => ['ai', 'picture', 'video'].includes(r.icon)))
  // halves as ½, like the summary's sentence
  assert.match(proBrings({ ...credits, voiceHours: 5.5, videoHours: 1 })[2].text, /About 5½ hours of four-person voice calls and 1 hour of video/)
  assert.deepEqual(proBrings(null), [])
})

test('the header names the person\'s goal', () => {
  assert.deepEqual(sheetHeader({ action: 'pro', from: 'draft' }), { eyebrow: 'Slatebox Pro', title: 'Keep drafting with Slatebox AI' })
  assert.equal(sheetHeader({ action: 'pro', from: 'call' }).title, 'Start your call')
  assert.equal(sheetHeader({ action: 'pro', from: 'profile' }).title, 'Get Slatebox Pro')
  assert.deepEqual(sheetHeader({ action: 'topup', wallet: 'me', balanceCents: 0 }), { eyebrow: 'Your balance · $0.00', title: 'Top up your balance' })
  assert.deepEqual(sheetHeader({ action: 'topup', wallet: 'team', balanceCents: 1250 }), { eyebrow: 'Team balance · $12.50', title: 'Top up the team balance' })
  assert.equal(sheetHeader({ action: 'manage' }).title, 'Your Pro')
})

test('the why note drops "in your profile"', () => {
  assert.equal(whyText("You have used this month's Pro credits for AI. Add your own AI or top up in your profile."), "You have used this month's Pro credits for AI. Add your own AI or top up.")
  assert.equal(whyText(''), '')
  assert.equal(money(1061), '$10.61')
})

test('the welcome: copy per variant, burst for a first Pro only, the button follows where the person came from', () => {
  const first = welcomeCopy({ kind: 'pro', from: 'draft', firstPro: true, confirmed: true })
  assert.equal(first.title, 'Welcome to Slatebox Pro')
  assert.equal(first.lead, 'Thank you. Pro is on for your account, and your draft is ready to go again.')
  assert.equal(first.button, 'Back to your draft')
  assert.equal(first.burst, true)
  assert.equal(first.announce, 'Welcome to Slatebox Pro. Pro is on.')
  assert.equal(first.included, true)

  const finalizing = welcomeCopy({ kind: 'pro', from: 'draft', firstPro: true, confirmed: false })
  assert.equal(finalizing.lead, 'Thank you. Your payment went through. Switching Pro on for your account…')
  assert.equal(finalizing.button, 'Getting things ready…')
  assert.equal(finalizing.announce, 'Payment went through')

  assert.equal(welcomeCopy({ kind: 'pro', from: 'call', firstPro: false, confirmed: true }).burst, false)
  assert.equal(welcomeCopy({ kind: 'pro', from: 'call', confirmed: true }).button, 'Back to your call')
  assert.equal(welcomeCopy({ kind: 'pro', from: 'pictures', confirmed: true }).button, 'Back to your slate')
  assert.equal(welcomeCopy({ kind: 'pro', from: 'profile', confirmed: true }).button, 'Done')

  const topUp = welcomeCopy({ kind: 'topup', from: 'call', amountCents: 1000, confirmed: true })
  assert.equal(topUp.title, '$10 is in your balance')
  assert.equal(topUp.burst, false)
  assert.equal(topUp.countUp, 1000)
  assert.equal(topUp.included, false)

  const card = welcomeCopy({ kind: 'card', confirmed: true, pastDueCleared: true })
  assert.equal(card.title, 'Your card is updated')
  assert.match(card.lead, /Pro is back on/)
  assert.equal(card.burst, false)

  const switched = welcomeCopy({ kind: 'switch', interval: 'year', nextDate: '2027-11-22T00:00:00.000Z', confirmed: true })
  assert.equal(switched.title, "You're on yearly now")
  assert.equal(switched.burst, false)

  assert.equal(welcomeCopy({ kind: 'pro', variant: 'pending' }).lead, 'Payment received. Pro switches on in a moment.')
  assert.match(welcomeCopy({ kind: 'pro', variant: 'processing' }).lead, /We'll tell you when it clears/)
})

test('?pay= opens a pane; ?pro= / ?topup= / ?card= return into finalizing', () => {
  const q = s => new URLSearchParams(s)
  assert.deepEqual(payRequestFromQuery(q('tab=credits&pay=pro')), { open: { action: 'pro', wallet: null, from: 'profile' } })
  assert.deepEqual(payRequestFromQuery(q('pay=topup')), { open: { action: 'topup', wallet: 'me', from: 'profile' } })
  assert.deepEqual(payRequestFromQuery(q('pay=topup&wallet=team')), { open: { action: 'topup', wallet: 'team', from: 'profile' } })
  assert.deepEqual(payRequestFromQuery(q('pay=manage')), { open: { action: 'manage', wallet: null, from: 'profile' } })
  assert.deepEqual(payRequestFromQuery(q('pay=card')), { open: { action: 'card', wallet: null, from: 'profile' } })
  assert.equal(payRequestFromQuery(q('pay=nonsense')), null)
  assert.deepEqual(payRequestFromQuery(q('tab=credits&pro=cs_test_a1')), { back: { kind: 'pro', sessionId: 'cs_test_a1' } })
  assert.deepEqual(payRequestFromQuery(q('topup=cs_test_b2')), { back: { kind: 'topup', sessionId: 'cs_test_b2' } })
  assert.deepEqual(payRequestFromQuery(q('card=cs_test_c3')), { back: { kind: 'card', sessionId: 'cs_test_c3' } })
  // the literal template (a hosted page that was never paid) and junk are ignored
  assert.equal(payRequestFromQuery(q('pro={CHECKOUT_SESSION_ID}')), null)
  assert.equal(payRequestFromQuery(q('topup=../../x')), null)
  // ?business= is a team's Slatebox Business returning (scripts/business-billing.test.mjs)
  assert.deepEqual([...PAY_PARAMS].sort(), ['business', 'card', 'pay', 'plan', 'pro', 'topup', 'wallet'])
  // the site's plan picks the interval (/pro?plan=yearly → ?pay=pro&plan=yearly); junk plans fall back to the default
  assert.deepEqual(payRequestFromQuery(q('pay=pro&plan=yearly')), { open: { action: 'pro', wallet: null, from: 'site', choice: { interval: 'year' } } })
  assert.deepEqual(payRequestFromQuery(q('pay=pro&plan=monthly')), { open: { action: 'pro', wallet: null, from: 'site', choice: { interval: 'month' } } })
  assert.deepEqual(payRequestFromQuery(q('pay=pro&plan=weekly')), { open: { action: 'pro', wallet: null, from: 'profile' } })
  assert.deepEqual(payRequestFromQuery(q('pay=topup&plan=yearly')), { open: { action: 'topup', wallet: 'me', from: 'profile' } })
})

test('the processor\'s fields are drawn in Slatebox\'s colours and type, both modes', () => {
  const light = stripeAppearance({ mode: 'light', palette: { primary: { main: '#254b3b' }, background: { paper: '#fffef8' }, text: { primary: '#213d32', secondary: '#53685b' }, divider: '#d3d7c9' } })
  assert.equal(light.theme, 'stripe')
  assert.equal(light.variables.colorPrimary, '#254b3b')
  assert.equal(light.variables.colorBackground, '#fffef8')
  assert.equal(light.variables.colorDanger, '#a1352b')
  assert.equal(light.variables.fontFamily, 'Manrope, system-ui, sans-serif')
  assert.equal(light.variables.borderRadius, '10px')
  assert.equal(light.rules['.Input'].border, '1px solid #d3d7c9')
  assert.equal(light.rules['.Input:focus'].borderColor, '#254b3b')
  const dark = stripeAppearance({ mode: 'dark', palette: { primary: { main: '#f2ce8b' }, background: { paper: '#23362d' }, text: { primary: '#f5f3e9', secondary: '#bdcdbd' }, divider: '#475e50' } })
  assert.equal(dark.theme, 'night')
  assert.equal(dark.variables.colorDanger, '#ffb4a8')
})

test('one file imports the payment SDK, and the sheet is loaded only when opened', () => {
  const importers = payFiles().filter(f => /from '@stripe\//.test(read(f)))
  assert.deepEqual(importers, [PAY_DIR + 'StripeCheckout.jsx'])
  // nothing outside the lazy sheet imports it
  const host = read(PAY_DIR + 'PaySheetHost.jsx')
  assert.match(host, /lazy\(\(\) => import\('\.\/PaySheet'\)\)/)
  assert.doesNotMatch(host, /import .* from '\.\/(PaySheet|StripeCheckout|ProPane|TopUpPane|Welcome)'/)
  assert.doesNotMatch(host, /@stripe/)
  // the browser SDK is fetched once per page, from the pure entry (no script tag on import)
  const checkout = read(PAY_DIR + 'StripeCheckout.jsx')
  assert.match(checkout, /from '@stripe\/stripe-js\/pure'/)
  assert.match(checkout, /from '@stripe\/react-stripe-js\/checkout'/)
  assert.match(checkout, /CheckoutElementsProvider/)
  assert.match(checkout, /useCheckoutElements/)
  assert.match(checkout, /redirect: 'if_required'/)
  assert.doesNotMatch(checkout, /postalCode: 'never'/)
  // mounted once, at the app root
  assert.match(read('imports/ui/App.jsx'), /<PaySheetHost>/)
})

test('the sheet lets the processor\'s 3DS and Link overlays take focus, and is kept out of session replay', () => {
  const sheet = read(PAY_DIR + 'PaySheet.jsx')
  assert.match(sheet, /disableEnforceFocus/)
  assert.match(sheet, /ph-no-capture/)
  assert.match(sheet, /aria-live="polite"/)
  assert.match(sheet, /anchor="bottom"/)
})

test('the welcome honours reduced motion and puts focus where the design says', () => {
  const welcome = read(PAY_DIR + 'Welcome.jsx')
  assert.match(welcome, /prefers-reduced-motion: reduce/)
  assert.match(welcome, /tabIndex=\{-1\}/)
  assert.doesNotMatch(welcome, /autoFocus/)
  assert.match(welcome, /aria-hidden/)
  // 18 tiles in Slatebox colours
  for (const c of ['#f4c37d', '#e8a15a', '#f2ce8b', '#39604c', '#254b3b', '#dce9ce']) assert.ok(welcome.includes(c), c)
  assert.match(welcome, /TILES\.length === 18|TILES = \[[\s\S]*\]/)
})

test('no user-visible text in the sheet names the processor (imports and config literals allowed)', () => {
  const hits = []
  for (const file of payFiles()) {
    const text = read(file)
    // JSX text nodes and the visible string props
    const visible = [
      ...[...text.matchAll(/>([^<>{}]+)</g)].map(m => m[1]),
      ...[...text.matchAll(/(?:label|title|aria-label|placeholder|helperText|lead|button|eyebrow|message|reason|text)\s*[:=]\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2]),
    ]
    for (const v of visible) if (/stripe/i.test(v)) hits.push(`${file}: ${v.trim().slice(0, 80)}`)
  }
  assert.deepEqual(hits, [])
})

test('the return from a hosted or redirecting payment is handled once, by the sheet', () => {
  // the profile no longer polls the return itself (the sheet's Welcome does, in finalizing)
  assert.doesNotMatch(read('imports/ui/components/billing/ProPanel.jsx'), /query\.get\('pro'\)/)
  assert.doesNotMatch(read('imports/ui/components/billing/Credits.jsx'), /query\.get\('topup'\)/)
  assert.ok(existsSync(new URL(PAY_DIR + 'sheet-machine.mjs', appDir)))
})

test('the pay sheet points billing questions to the contact form, shown as a link (BILLING_CONTACT_URL)', async () => {
  const { BILLING_CONTACT_URL } = await import('../web/app/imports/api/common/contact.mjs')
  const dir = 'imports/ui/components/billing/pay/'
  for (const file of readdirSync(new URL(dir, appDir)).filter(f => /\.(m?js|jsx)$/.test(f))) {
    assert.doesNotMatch(read(dir + file), /help@slatebox\.com|mailto:/, file)
  }
  // nothing to pay here: the contact form, in a new tab
  const blocked = read(dir + 'BlockedPane.jsx')
  assert.match(blocked, /help: `Write to us at \$\{BILLING_CONTACT_URL\}, or ask a team admin to top up the team balance\.`/)
  assert.match(blocked, /href=\{BILLING_CONTACT_URL\} target="_blank" rel="noopener noreferrer">Write to us</)
  assert.match(blocked, /<ContactLinkText text=\{blocked\.reason \|\| TEXT\[blocked\.kind\] \|\| TEXT\.none\} \/>/)
  // a payment the server could not confirm
  assert.match(read(dir + 'PaySheetHost.jsx'), /If your card was charged, write to us at \$\{BILLING_CONTACT_URL\}\./)
  // wherever the sheet shows a message that may carry the URL (ours or the server's), it is a link
  assert.match(read(dir + 'SheetParts.jsx'), /typeof children === 'string' \? <ContactLinkText text=\{children\} \/> : children/)
  assert.match(read(dir + 'ManagePane.jsx'), /<ContactLinkText text=\{state\.notice\} \/>/)
  assert.match(read(dir + 'TopUpPane.jsx'), /<ContactLinkText text=\{why\} \/>/)
  // and ContactLinkText links exactly that URL
  assert.match(read('imports/ui/components/billing/ContactLinkText.jsx'), /split\(BILLING_CONTACT_URL\)/)
  assert.equal(BILLING_CONTACT_URL, 'https://slatebox.com/contact/?topic=billing')
})
