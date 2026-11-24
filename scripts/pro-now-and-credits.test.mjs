// Owner decisions of 2026-11-22 (final): Slatebox Pro is needed from now on Cloud (no notice
// period, no trial until a switch day), self-host never needs it; Pro credits are sized to about
// $4 of provider cost per person per month ($3.75, so yearly Pro covers full use in the worst
// likely fee case), as data, shown in plain words, and prorated in the month Pro starts or ends;
// Pro is taxed on top through Stripe Tax; Slatebox Business (per seat, inside Cloud) is sold by
// talking to us until its billing is built.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CREDIT_SHARES, DEFAULT_METERING, PRO_SWITCH, allowanceSummary, creditsForShare, fullUseMicros, monthShare, proNeeded, proSwitchValue,
  resolveMetering, route, sizeCredits,
} from '../web/app/server/metering/policy.mjs'
import { CALL_PRICES, ESTIMATES } from '../web/app/server/metering/prices.mjs'
import { PRO_CREDITS, PRO_PRODUCT, proCredits, proCreditsInWords } from '../web/app/imports/api/pro/catalog.mjs'
import { BUSINESS, BUSINESS_CONTACT_URL, BUSINESS_PRICES } from '../web/app/imports/api/business/catalog.mjs'
import { PRO_COPY, proCheckoutParams, proCreditShare, proExempt, proIncluded, proOnSale } from '../web/app/server/pro-billing.mjs'
import { FIGURES_FILE, figures, figuresJson } from './pro-figures.mjs'
import { readFileSync } from 'node:fs'

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)
const DAY = 86_400_000
const at = proRequiredFrom => ({ ...DEFAULT_METERING, free: { ...DEFAULT_METERING.free, proRequiredFrom } })

// ---------- the switch: 'now', 'never' or a moment ----------

test('the switch is "never" by default (self-host has no Pro), and "now" needs Pro at once', () => {
  assert.equal(DEFAULT_METERING.free.proRequiredFrom, PRO_SWITCH.never)
  assert.equal(PRO_SWITCH.never, 'never')
  assert.equal(PRO_SWITCH.now, 'now')
  assert.equal(proNeeded(DEFAULT_METERING, NOW), false)
  assert.equal(proNeeded(at('now'), NOW), true)
  assert.equal(proNeeded(at('now'), 0), true, '"now" is not a date that can lie in the future')
  // a moment still works, for a server that wants one
  assert.equal(proNeeded(at(NOW - 1), NOW), true)
  assert.equal(proNeeded(at(NOW + 1), NOW), false)
  // anything else is "never": a mistyped setting never takes the included amount away
  for (const odd of [null, undefined, 'soon', 'NOW', '', NaN, Infinity, {}, true]) assert.equal(proNeeded(at(odd), NOW), false, String(odd))
})

test('proSwitchValue reads a setting: "now", "never", a moment in ms or an ISO day; anything else is refused', () => {
  assert.equal(proSwitchValue('now'), 'now')
  assert.equal(proSwitchValue('never'), 'never')
  assert.equal(proSwitchValue(null), 'never')
  assert.equal(proSwitchValue(undefined), 'never')
  assert.equal(proSwitchValue(NOW), NOW)
  assert.equal(proSwitchValue('2026-11-22'), Date.UTC(2026, 10, 22))
  for (const bad of ['soon', 'yesterday', -5, NaN, {}, '2026-13-01']) assert.throws(() => proSwitchValue(bad), /"now", "never" or a date/, String(bad))
})

test('with "now", Pro is on sale, a person without Pro has no included amount, and Pro skips the shared budget', () => {
  const settings = at('now')
  const pro = { status: 'active', currentPeriodEnd: NOW + 20 * DAY, subscriptionId: 'sub_1' }
  assert.equal(proOnSale(settings), true)
  assert.equal(proOnSale(DEFAULT_METERING), false)
  assert.equal(proOnSale(at(NOW + DAY)), true, 'a set moment also puts Pro on sale')
  assert.equal(proIncluded(undefined, NOW, settings), false)
  assert.equal(proIncluded(pro, NOW, settings), true)
  assert.equal(proExempt(pro, NOW, settings), true)
  // self-host ("never"): the amount is everyone's and Pro is not sold
  assert.equal(proIncluded(undefined, NOW, DEFAULT_METERING), true)
  assert.equal(PRO_COPY.notYet, 'Slatebox Pro is not sold on this server.')
})

test('no free trial: a checkout never carries trial_end, whatever the switch says', () => {
  for (const value of ['now', 'never', NOW + 60 * DAY, NOW - DAY]) {
    const params = proCheckoutParams({ userId: 'u1', email: 'a@b.test', priceId: 'price_m', baseUrl: 'https://app.test', settings: at(value), now: NOW })
    assert.equal(params.subscription_data.trial_end, undefined, String(value))
    assert.equal(params.subscription_data.trial_period_days, undefined)
  }
})

test('tax goes on top: Stripe Tax in Checkout, and prices are tax-exclusive in the catalogue', () => {
  const params = proCheckoutParams({ userId: 'u1', email: 'a@b.test', priceId: 'price_m', baseUrl: 'https://app.test', settings: at('now'), now: NOW })
  assert.deepEqual(params.automatic_tax, { enabled: true })
  // Stripe Tax needs an address: a new customer gives one at checkout, a returning one keeps theirs up to date
  assert.equal(params.billing_address_collection, 'auto')
  const returning = proCheckoutParams({ userId: 'u1', customerId: 'cus_1', priceId: 'price_m', baseUrl: 'https://app.test', settings: at('now'), now: NOW })
  assert.deepEqual(returning.customer_update, { address: 'auto', name: 'auto' })
  assert.equal(PRO_PRODUCT.taxBehavior, 'exclusive')
})

// ---------- Pro credits: about $4 of provider cost a month ($3.75) ----------

test('the default credits cost Slatebox at most $3.75 a person a month at full use, and close to it', () => {
  const free = DEFAULT_METERING.free
  assert.equal(free.creditCostMicrosPerMonth, 3_750_000)
  const full = fullUseMicros(free)
  assert.ok(full <= 3_750_000, `full use costs ${full}`)
  assert.ok(full >= 3_550_000, `full use costs ${full}, well under the $3.75 it is sized to`)
  // full use: the month's AI, every voice minute and every video minute (separate allowances)
  assert.equal(full, free.aiMicrosPerMonth + free.voiceMinutesPerMonth * CALL_PRICES.voiceMicros + free.videoMinutesPerMonth * CALL_PRICES.videoMicros)
  assert.deepEqual([free.aiMicrosPerMonth, free.voiceMinutesPerMonth, free.videoMinutesPerMonth], [937_500, 1380, 330])
  // the shares are data and add up to the whole
  assert.equal(Object.values(CREDIT_SHARES).reduce((a, b) => a + b, 0), 1)
  // the day's ceiling and the daily draft count are unchanged
  assert.equal(free.aiActionsPerDay, 30)
  assert.equal(free.perPersonMicrosPerDay, 500_000)
})

test('one number sizes the credits: a different monthly cost resizes AI, voice and video, never past it', () => {
  for (const dollars of [2, 4, 5.5, 10]) {
    const sized = sizeCredits(dollars * 1_000_000)
    assert.ok(fullUseMicros(sized) <= dollars * 1_000_000, `${dollars}: ${fullUseMicros(sized)}`)
    assert.ok(fullUseMicros(sized) >= dollars * 1_000_000 * 0.9, `${dollars}: ${fullUseMicros(sized)}`)
    // whole hours of four-person calls are shown, so minutes come in steps of 60 (or 30 for video)
    assert.equal(sized.voiceMinutesPerMonth % 60, 0)
    assert.equal(sized.videoMinutesPerMonth % 30, 0)
  }
})

test('settings: deploy settings and the admin page set the switch and the credit size; defaults fill the rest', () => {
  // Cloud's deploy settings say "now"; self-host leaves it out
  const cloud = resolveMetering({ deploy: { proRequiredFrom: 'now' } })
  assert.equal(cloud.free.proRequiredFrom, 'now')
  assert.equal(resolveMetering({}).free.proRequiredFrom, 'never')
  // the admin page's stored value wins over the deploy settings
  assert.equal(resolveMetering({ deploy: { proRequiredFrom: 'now' }, stored: { free: { proRequiredFrom: 'never' } } }).free.proRequiredFrom, 'never')
  // a mistyped deploy value stops the start (no silent "never")
  assert.throws(() => resolveMetering({ deploy: { proRequiredFrom: 'tomorrow' } }), /proRequiredFrom/)
  // one number resizes every allowance
  const bigger = resolveMetering({ deploy: { creditCostMicrosPerMonth: 8_000_000 } })
  assert.equal(bigger.free.creditCostMicrosPerMonth, 8_000_000)
  assert.ok(bigger.free.voiceMinutesPerMonth > DEFAULT_METERING.free.voiceMinutesPerMonth)
  assert.ok(fullUseMicros(bigger.free) <= 8_000_000)
  // an allowance set on its own still wins (an operator's own choice), the others follow the size
  const own = resolveMetering({ stored: { free: { voiceMinutesPerMonth: 600 } } })
  assert.equal(own.free.voiceMinutesPerMonth, 600)
  assert.equal(own.free.videoMinutesPerMonth, DEFAULT_METERING.free.videoMinutesPerMonth)
  // the budget and the rest merge as before
  assert.equal(resolveMetering({ stored: { budget: { hold: 'pause-ai' } } }).budget.hold, 'pause-ai')
  assert.equal(resolveMetering({}).budget.monthlyMicros, DEFAULT_METERING.budget.monthlyMicros)
  assert.throws(() => resolveMetering({ deploy: { creditCostMicrosPerMonth: -1 } }), /creditCostMicrosPerMonth/)
})

test('Pro credits in plain words, from the same numbers the meter uses', () => {
  assert.deepEqual(PRO_CREDITS, proCredits(DEFAULT_METERING.free))
  const words = proCreditsInWords(DEFAULT_METERING.free)
  assert.equal(words.costDollars, 3.75)
  assert.equal(words.draftsPerDay, 30)
  // a round "about", down to tens, never more than the month's AI gives (187 drafts → 180)
  assert.equal(words.draftsPerMonth, Math.floor(DEFAULT_METERING.free.aiMicrosPerMonth / ESTIMATES.workshop / 10) * 10)
  assert.equal(words.draftsPerMonth, 180)
  assert.equal(words.voiceHours, 5.5)
  assert.equal(words.videoHours, 1)
  assert.equal(words.sentence, 'Each month: about 180 AI drafts (up to 30 a day), about 5½ hours of four-person voice calls and about 1 hour of four-person video calls.')
  // a resized amount reads the same way
  assert.match(proCreditsInWords({ ...DEFAULT_METERING.free, ...sizeCredits(8_000_000) }).sentence, /about 400 AI drafts \(up to 30 a day\), about 12½ hours .* about 3 hours/)
})

// ---------- Slatebox Business: per seat, inside Cloud, sold through the contact form ----------

test('Business: per person, inside the shared Cloud, bought in the app where its prices are set, else by talking to us', () => {
  assert.equal(BUSINESS.name, 'Slatebox Business')
  // the figures the central pricing page states (pro-figures); the app itself never shows them
  // Restated (owner decision 2026-11-24): $8 per member a month, $80 a year (two months free, as Pro)
  assert.deepEqual(BUSINESS_PRICES.map(p => [p.interval, p.unitAmountPerSeat]), [['month', 800], ['year', 8000]])
  assert.equal(BUSINESS_PRICES[1].unitAmountPerSeat, BUSINESS_PRICES[0].unitAmountPerSeat * 10, 'yearly is ten months, like Pro')
  // Restated: whether Business is sold in the app is a settings fact (both Stripe prices named, on
  // Cloud), never a code flag: the catalogue has no billingBuilt (pro-figures businessCheckout)
  assert.equal(BUSINESS.billingBuilt, undefined)
  // no amount in the words the app shows: the pricing page and the sheet (Stripe's amount) say it
  assert.doesNotMatch(BUSINESS.summary, /\$\d/)
  // the site's contact form with the business topic, the same link the marketing site and the docs use
  assert.equal(BUSINESS_CONTACT_URL, 'https://slatebox.com/contact/?topic=business')
  assert.equal(BUSINESS.contactUrl, BUSINESS_CONTACT_URL)
  // single sign-on and the audit log are not on Cloud yet: nothing here says they are included
  assert.doesNotMatch(JSON.stringify(BUSINESS), /sign-on|single sign|SSO|audit log/i)
  assert.equal(BUSINESS.contactLabel, 'Talk to us about Business')
  // what it is, and what it is not
  assert.match(BUSINESS.summary, /fully managed/)
  // Restated (round-2 review nit 12): Business is priced per member everywhere (site, docs, terms)
  assert.match(BUSINESS.summary, /per member/)
  assert.doesNotMatch(BUSINESS.summary, /per person/)
  assert.doesNotMatch(readFileSync(new URL('../web/app/imports/ui/components/billing/ProPanel.jsx', import.meta.url), 'utf8'), /paid per person/)
  assert.doesNotMatch(JSON.stringify(BUSINESS), /dedicated|server of its own|\bSmall\b|\bMedium\b|6,000|by size|no seat/i)
  assert.equal(BUSINESS.sizes, undefined)
  // each member's share of the team's pool is Pro's credits
  assert.equal(BUSINESS.creditsPerMember, 'pro')
})

test('no Slatebox Private, dedicated-server or size-priced copy is left in the app', async () => {
  const { readdirSync, readFileSync, statSync, existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const root = new URL('../', import.meta.url).pathname
  const files = []
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.meteor', 'generated'].includes(name)) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(m?js|jsx|md|json)$/.test(name)) files.push(path)
    }
  }
  for (const dir of ['web/app/imports', 'web/app/server', 'web/app/client', 'packages/slatebox-mcp/src']) if (existsSync(join(root, dir))) walk(join(root, dir))
  files.push(join(root, 'README.md'), join(root, 'web/README.md'), join(root, 'scripts/stripe-catalog.mjs'))
  const banned = /Slatebox Private|dedicated server|server of its own|Small\/Medium|\$6,000|Billed yearly by size|No seat plans|private_small|\/buy\/private/i
  const hits = files.filter(f => banned.test(readFileSync(f, 'utf8'))).map(f => f.slice(root.length))
  assert.deepEqual(hits, [])
  assert.equal(existsSync(join(root, 'web/app/imports/api/private/catalog.mjs')), false)
  assert.equal(existsSync(join(root, 'web/app/server/private-checkout.js')), false)
})

// ---------- Pro credits per paid month: the month Pro starts or ends in gives its share ----------

const T = (m, d, h = 0) => Date.UTC(2026, m, d, h)
const proSince = (created, more = {}) => ({ subscriptionId: 'sub_1', status: 'active', created, currentPeriodStart: created, currentPeriodEnd: created + 30 * DAY, ...more })

test('monthShare: the part of the calendar month a paid span covers', () => {
  assert.equal(monthShare({ from: T(11, 1) }, T(11, 15)), 1)
  assert.equal(monthShare({ from: T(10, 1) }, T(11, 15)), 1, 'a month after the start month is whole')
  assert.equal(monthShare({ from: T(11, 30) }, T(11, 30, 12)), 2 / 31, 'bought on 30 December: two days of December')
  assert.equal(monthShare({ from: T(10, 10), until: T(11, 10) }, T(11, 5)), 9 / 31, 'ends on 10 December: nine days')
  assert.equal(monthShare({}, T(11, 5)), 1)
})

test('monthly Pro bought on the 30th gets two days of that month\'s credits, not a whole extra month', () => {
  const settings = at('now')
  const pro = proSince(T(11, 30))
  const share = proCreditShare(pro, T(11, 30, 12), settings)
  assert.equal(share, 2 / 31)
  const person = { id: 'p', anonymous: false, emailVerified: true, included: true, pro: true, creditShare: share }
  const base = { kind: 'voice', person, usage: {}, wallets: {}, global: {}, settings, now: T(11, 30, 12) }
  const voiceShare = Math.floor(DEFAULT_METERING.free.voiceMinutesPerMonth * share)
  // the month's voice is cut to the share; past it, the person tops up or uses a Daily key
  assert.equal(route({ ...base, minutes: 10, usage: { voiceMinutesMonth: voiceShare - 10 } }).ok, true)
  assert.equal(route({ ...base, minutes: 10, usage: { voiceMinutesMonth: voiceShare } }).code, 'calls-month')
  // AI likewise, and an ok decision carries the share for the hold (meter-core.mjs)
  const ai = route({ ...base, kind: 'ai', estimateMicros: 5000, minutes: undefined })
  assert.deepEqual([ai.ok, ai.creditShare], [true, share])
  const aiShare = creditsForShare(settings, share).free.aiMicrosPerMonth
  assert.equal(aiShare, Math.floor(DEFAULT_METERING.free.aiMicrosPerMonth * share))
  assert.equal(route({ ...base, kind: 'ai', estimateMicros: 5000, usage: { aiMicrosMonth: aiShare - 4000 } }).code, 'ai-month')
  // the next month is whole
  assert.equal(proCreditShare(pro, T(11, 31) + 2 * DAY, settings), 1)
  // the profile shows what is left of the share, and the plan's whole month in words
  const summary = allowanceSummary({ person, usage: {}, wallets: {}, global: {}, settings, now: T(11, 30, 12) })
  assert.equal(summary.voiceHoursLeft, Math.floor(voiceShare / 4 / 60 * 2) / 2)
  assert.match(summary.credits.sentence, /about 180 AI drafts/)
})

test('a year of Pro brings at most twelve months of credits: the start month and, once it will not renew, the end month are shares', () => {
  const settings = at('now')
  const start = T(0, 15)
  const end = Date.UTC(2027, 0, 15)
  const renewing = proSince(start, { currentPeriodEnd: end })
  const cancelled = { ...renewing, cancelAtPeriodEnd: true }
  let months = 0
  for (let m = 0; m <= 12; m++) months += proCreditShare(cancelled, Date.UTC(2026, m, 20), settings)
  assert.ok(Math.abs(months - 12) < 0.05, `a cancelled year brings ${months.toFixed(3)} months of credits`)
  // renewing, the end month is whole (the next year has begun)
  assert.equal(proCreditShare(renewing, Date.UTC(2027, 0, 20), settings), 1)
})

test('the share applies only where Pro is needed: self-host and missing dates keep the whole month', () => {
  assert.equal(proCreditShare(proSince(T(11, 30)), T(11, 30, 12), DEFAULT_METERING), 1)
  assert.equal(proCreditShare({ status: 'active' }, T(11, 30, 12), at('now')), 1)
  assert.equal(proCreditShare(null, T(11, 30, 12), at('now')), 1)
  assert.equal(creditsForShare(DEFAULT_METERING, 1), DEFAULT_METERING)
  assert.equal(creditsForShare(DEFAULT_METERING, undefined), DEFAULT_METERING)
})

// ---------- the figures the site and the docs copy ----------

test('pro-figures.json is what the meter and the catalogues give (run node scripts/pro-figures.mjs --write after a change)', () => {
  assert.equal(readFileSync(FIGURES_FILE, 'utf8'), figuresJson())
  const f = figures()
  // Restated (owner decision 2026-11-24): Business is $8 / $80 per member
  assert.deepEqual([f.pro.monthCents, f.pro.yearCents, f.business.monthCentsPerSeat, f.business.yearCentsPerSeat], [500, 5000, 800, 8000])
  // businessCheckout (and its older name billingBuilt) is false until settings name both prices
  assert.equal(f.business.businessCheckout, false)
  assert.equal(f.business.billingBuilt, false)
  const cloud = { payments: { business: { monthly: 'price_biz_m', yearly: 'price_biz_y' } } }
  assert.equal(figures(undefined, { settings: cloud }).business.businessCheckout, true)
  assert.equal(figures(undefined, { settings: cloud }).business.billingBuilt, true)
  assert.equal(figures(undefined, { settings: { payments: { business: { monthly: 'price_biz_m' } } } }).business.businessCheckout, false)
  assert.deepEqual([f.pro.credits.draftsPerMonth, f.pro.credits.draftsPerDay, f.pro.credits.voiceHours, f.pro.credits.videoHours], [180, 30, 5.5, 1])
  assert.equal(f.business.contactUrl, BUSINESS_CONTACT_URL)
})
