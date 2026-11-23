import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DASHBOARD_CHECKS, DEFAULT_PARTS, PARTS, PRO_CATALOG, isEntryPoint, main, parseArgs, portalParams, stripeKeyMode, syncAll, syncCatalog,
} from './stripe-catalog.mjs'
import { PRO_CREDITS, PRO_LOOKUP_KEYS, PRO_PRODUCT, PRO_PRICES, proStripePrices } from '../web/app/imports/api/pro/catalog.mjs'
import { DEFAULT_METERING, fullUseMicros } from '../web/app/server/metering/policy.mjs'

// An in-memory Stripe with the parts of products and prices the sync uses, and Stripe's rules:
// a price's amount and interval cannot change, a lookup_key belongs to one price, and taking
// one over needs transfer_lookup_key.
function fakeStripe() {
  const products = new Map(), prices = new Map(), portals = new Map(), links = new Map(), calls = []
  let n = 0
  const missing = () => Object.assign(new Error('No such product'), { statusCode: 404, code: 'resource_missing' })
  // Stripe's paging: at most `limit` (default 10) per page, continued with starting_after.
  const page = (all, { limit = 10, starting_after } = {}) => {
    const from = starting_after ? all.findIndex(p => p.id === starting_after) + 1 : 0
    const data = all.slice(from, from + limit)
    return { data, has_more: from + limit < all.length }
  }
  return {
    calls,
    writes: () => calls.filter(c => !/\.(retrieve|list)$/.test(c)),
    products: {
      async retrieve(id) { calls.push('products.retrieve'); if (!products.has(id)) throw missing(); return structuredClone(products.get(id)) },
      async create(params) {
        calls.push('products.create')
        if (products.has(params.id)) throw new Error('product exists')
        products.set(params.id, { object: 'product', active: true, ...structuredClone(params) })
        return structuredClone(products.get(params.id))
      },
      async update(id, patch) {
        calls.push('products.update')
        const p = products.get(id)
        const metadata = { ...p.metadata }
        for (const [k, v] of Object.entries(patch.metadata || {})) { if (v === '') delete metadata[k]; else metadata[k] = v }
        products.set(id, { ...p, ...patch, metadata })
        return structuredClone(products.get(id))
      },
      store: products,
    },
    prices: {
      async list(params) {
        calls.push('prices.list')
        let all = [...prices.values()]
        if (params.lookup_keys) all = all.filter(p => params.lookup_keys.includes(p.lookup_key))
        if (params.product) all = all.filter(p => p.product === params.product)
        if (params.active !== undefined) all = all.filter(p => p.active === params.active)
        return page(structuredClone(all), params)
      },
      async create(params) {
        calls.push('prices.create')
        const { transfer_lookup_key, ...rest } = params
        const holder = params.lookup_key ? [...prices.values()].find(p => p.lookup_key === params.lookup_key) : undefined
        if (holder && !transfer_lookup_key) throw new Error('lookup_key already in use')
        if (holder) holder.lookup_key = null
        const id = `price_${++n}`
        prices.set(id, {
          id, object: 'price', active: true, type: 'recurring', ...structuredClone(rest),
          recurring: { usage_type: 'licensed', ...rest.recurring },
        })
        return structuredClone(prices.get(id))
      },
      async update(id, patch) {
        calls.push('prices.update')
        for (const field of ['unit_amount', 'currency', 'recurring', 'product']) if (field in patch) throw new Error(`cannot change ${field}`)
        const p = prices.get(id)
        const metadata = { ...p.metadata }
        for (const [k, v] of Object.entries(patch.metadata || {})) { if (v === '') delete metadata[k]; else metadata[k] = v }
        prices.set(id, { ...p, ...patch, metadata })
        return structuredClone(prices.get(id))
      },
      store: prices,
    },
    // the customer portal's configurations and payment links, with list paging and metadata
    billingPortal: {
      configurations: {
        async list(params) { calls.push('billingPortal.configurations.list'); return page(structuredClone([...portals.values()]), params) },
        async create(params) {
          calls.push('billingPortal.configurations.create')
          const id = `bpc_${++n}`
          portals.set(id, { id, object: 'billing_portal.configuration', active: true, ...structuredClone(params) })
          return structuredClone(portals.get(id))
        },
        async update(id, params) {
          calls.push('billingPortal.configurations.update')
          portals.set(id, { ...portals.get(id), ...structuredClone(params) })
          return structuredClone(portals.get(id))
        },
        store: portals,
      },
    },
    paymentLinks: {
      async list(params) {
        calls.push('paymentLinks.list')
        let all = [...links.values()]
        if (params.active !== undefined) all = all.filter(l => l.active === params.active)
        return page(structuredClone(all), params)
      },
      async create(params) {
        calls.push('paymentLinks.create')
        for (const item of params.line_items) if (!prices.has(item.price)) throw new Error('No such price: ' + item.price)
        const id = `plink_${++n}`
        links.set(id, { id, object: 'payment_link', active: true, url: `https://buy.stripe.com/test_${id}`, ...structuredClone(params) })
        return structuredClone(links.get(id))
      },
      async update(id, patch) {
        calls.push('paymentLinks.update')
        if ('line_items' in patch && patch.line_items.some(i => i.price)) throw new Error('cannot change a payment link price')
        links.set(id, { ...links.get(id), ...structuredClone(patch) })
        return structuredClone(links.get(id))
      },
      store: links,
    },
  }
}


// ---------- the sync's rules, on the Pro catalogue ----------

const MONTH = PRO_LOOKUP_KEYS.month
const YEAR = PRO_LOOKUP_KEYS.year
const withMonthly = change => proStripePrices().map(p => (p.lookupKey === MONTH ? change(p) : p))

test('the first run creates one product and both prices, tax-exclusive with Stripe Tax\'s code', async () => {
  const stripe = fakeStripe()
  const result = await syncCatalog(stripe, PRO_CATALOG)
  assert.equal(stripe.products.store.size, 1)
  const product = stripe.products.store.get('slatebox_pro')
  assert.equal(product.name, 'Slatebox Pro')
  assert.equal(product.tax_code, 'txcd_10103000')
  assert.equal(product.metadata.catalog, 'slatebox-pro')
  assert.equal(product.metadata.credit_cost_micros_month, '3750000')
  const prices = [...stripe.prices.store.values()]
  assert.equal(prices.length, 2)
  assert.ok(prices.every(p => p.tax_behavior === 'exclusive' && p.currency === 'usd' && p.product === 'slatebox_pro' && p.active))
  assert.equal(result.actions.filter(a => a.do === 'create-price').length, 2)
})

test('a second run with no change creates and changes nothing', async () => {
  const stripe = fakeStripe()
  const first = await syncCatalog(stripe, PRO_CATALOG)
  const before = stripe.writes().length
  const second = await syncCatalog(stripe, PRO_CATALOG)
  assert.deepEqual(second.actions, [])
  assert.equal(stripe.writes().length, before)
  assert.deepEqual(second.prices, first.prices)
})

test('a changed price creates a new price under the same lookup_key and archives the old one', async () => {
  const stripe = fakeStripe()
  const first = await syncCatalog(stripe, PRO_CATALOG)
  const prices = withMonthly(p => ({ ...p, unitAmount: 600 }))
  const second = await syncCatalog(stripe, { ...PRO_CATALOG, prices })
  const oldId = first.prices[MONTH]
  const newId = second.prices[MONTH]
  assert.notEqual(newId, oldId)
  const old = stripe.prices.store.get(oldId)
  assert.equal(old.active, false)
  assert.equal(old.lookup_key, null)
  const fresh = stripe.prices.store.get(newId)
  assert.deepEqual([fresh.unit_amount, fresh.lookup_key, fresh.active], [600, MONTH, true])
  assert.deepEqual(second.actions.map(a => a.do), ['create-price', 'archive-price'])
  // and it settles: a third run does nothing
  assert.deepEqual((await syncCatalog(stripe, { ...PRO_CATALOG, prices })).actions, [])
})

test('changed metadata or nickname is updated in place, not a new price', async () => {
  const stripe = fakeStripe()
  const first = await syncCatalog(stripe, PRO_CATALOG)
  const prices = withMonthly(p => ({ ...p, nickname: 'Slatebox Pro, each month', metadata: { ...p.metadata, note: 'renamed' } }))
  const second = await syncCatalog(stripe, { ...PRO_CATALOG, prices })
  assert.deepEqual(second.actions.map(a => [a.do, a.lookupKey]), [['update-price', MONTH]])
  assert.equal(second.prices[MONTH], first.prices[MONTH])
  assert.equal(stripe.prices.store.get(first.prices[MONTH]).metadata.note, 'renamed')
})

test('a price on the product that the catalogue does not list is archived', async () => {
  const stripe = fakeStripe()
  await syncCatalog(stripe, PRO_CATALOG)
  const stray = await stripe.prices.create({ product: 'slatebox_pro', currency: 'usd', unit_amount: 100, recurring: { interval: 'month', interval_count: 1 }, tax_behavior: 'exclusive', lookup_key: 'pro_old_thing' })
  const second = await syncCatalog(stripe, PRO_CATALOG)
  assert.deepEqual(second.actions.map(a => [a.do, a.id]), [['archive-price', stray.id]])
  assert.equal(stripe.prices.store.get(stray.id).active, false)
})

test('a dry run reports the plan and writes nothing', async () => {
  const stripe = fakeStripe()
  const result = await syncCatalog(stripe, { ...PRO_CATALOG, dryRun: true })
  assert.equal(stripe.writes().length, 0)
  assert.deepEqual(result.actions.map(a => a.do), ['create-product', 'create-price', 'create-price'])
})

test('a dry run that would replace a price reports no id for it, not the old one', async () => {
  const stripe = fakeStripe()
  const first = await syncCatalog(stripe, PRO_CATALOG)
  const prices = withMonthly(p => ({ ...p, unitAmount: 600 }))
  const plan = await syncCatalog(stripe, { ...PRO_CATALOG, prices, dryRun: true })
  assert.equal(plan.prices[MONTH], null)
  assert.equal(plan.prices[YEAR], first.prices[YEAR])
  assert.equal(plan.actions.find(a => a.do === 'create-price').replaces, first.prices[MONTH])
})

test('more stray prices than one page holds are all archived', async () => {
  const stripe = fakeStripe()
  await syncCatalog(stripe, PRO_CATALOG)
  const strays = []
  for (let i = 0; i < 230; i++) {
    strays.push((await stripe.prices.create({ product: 'slatebox_pro', currency: 'usd', unit_amount: 100 + i, recurring: { interval: 'month', interval_count: 1 }, tax_behavior: 'exclusive' })).id)
  }
  const second = await syncCatalog(stripe, PRO_CATALOG)
  assert.equal(second.actions.filter(a => a.do === 'archive-price').length, 230)
  assert.ok(strays.every(id => stripe.prices.store.get(id).active === false))
  assert.deepEqual((await syncCatalog(stripe, PRO_CATALOG)).actions, [])
})

test('the script runs when started through a symlinked path or one with spaces', () => {
  const real = new URL('./stripe-catalog.mjs', import.meta.url)
  const dir = mkdtempSync(join(tmpdir(), 'private catalog %20 '))
  try {
    const link = join(dir, 'link to script.mjs')
    symlinkSync(new URL(real).pathname, link)
    assert.equal(isEntryPoint(real.href, link), true)
    assert.equal(isEntryPoint(pathToFileURL(link).href, new URL(real).pathname), true)
    assert.equal(isEntryPoint(real.href, join(dir, 'missing.mjs')), false)
    assert.equal(isEntryPoint(real.href, undefined), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a live key is refused without --live, and the key is never echoed', async () => {
  const secret = 'sk_live_' + 'x'.repeat(24)
  assert.throws(() => stripeKeyMode(secret), /live Stripe key without --live/)
  assert.throws(() => stripeKeyMode('rk_live_abc'), /without --live/)
  assert.equal(stripeKeyMode('sk_test_abc'), 'test')
  assert.equal(stripeKeyMode('sk_live_abc', { live: true }), 'live')
  assert.throws(() => stripeKeyMode(''), /Set STRIPE_SECRET_KEY/)
  assert.throws(() => stripeKeyMode('pk_test_abc'), /not a Stripe secret key \(expected sk_test_, sk_live_, rk_test_ or rk_live_\)/)
  assert.equal(stripeKeyMode('rk_test_abc'), 'test')

  let made = false
  const logs = []
  await assert.rejects(
    main([], { STRIPE_SECRET_KEY: secret }, { makeStripe: () => { made = true }, log: l => logs.push(l) }),
    error => !error.message.includes(secret) && /without --live/.test(error.message),
  )
  assert.equal(made, false, 'no Stripe client is made for a refused key')
  assert.deepEqual(logs, [])
})

test('main runs against a test key and prints ids, never the key; it makes Pro and its portal only', async () => {
  const secret = 'sk_test_' + 'y'.repeat(24)
  const stripe = fakeStripe()
  const logs = []
  const result = await main([], { STRIPE_SECRET_KEY: secret }, { makeStripe: () => stripe, log: l => logs.push(l) })
  assert.equal(result.mode, 'test')
  assert.equal(logs.length, 1)
  assert.ok(!logs[0].includes(secret))
  assert.deepEqual(result.only, [...DEFAULT_PARTS])
  assert.deepEqual(result.only, ['pro', 'portal'])
  assert.match(logs[0], new RegExp(PRO_LOOKUP_KEYS.month))
  assert.match(logs[0], new RegExp(PRO_LOOKUP_KEYS.year))
  // Pro is the one product: no other product, no payment link, nothing for Private or Business
  assert.deepEqual([...stripe.products.store.keys()], ['slatebox_pro'])
  assert.ok(!stripe.calls.some(c => c.startsWith('paymentLinks')), 'no payment link is made or even looked up')
  assert.doesNotMatch(logs[0], /private|business/i)
  // the Stripe settings the terms rely on are listed on every run
  assert.deepEqual(result.dashboardChecks, DASHBOARD_CHECKS)
  assert.ok(DASHBOARD_CHECKS.some(c => /failed payments/.test(c) && /CANCEL the subscription/.test(c)))
  assert.ok(DASHBOARD_CHECKS.some(c => /upcoming renewals/.test(c)))
  assert.ok(DASHBOARD_CHECKS.some(c => /Stripe Tax/.test(c) && /tax-exclusive/.test(c)))
  await assert.rejects(main(['--force'], { STRIPE_SECRET_KEY: secret }, { makeStripe: () => stripe, log: () => {} }), /Unknown option --force/)
})


// ---------- Slatebox Pro and its portal ----------

test('Pro: one product, $5 a month and $50 a year by lookup_key, its credits are the meter\'s own numbers', async () => {
  assert.equal(PRO_PRODUCT.id, 'slatebox_pro')
  assert.equal(PRO_PRODUCT.name, 'Slatebox Pro')
  assert.deepEqual(PRO_PRICES.map(p => [p.lookupKey, p.unitAmount, p.interval]), [['pro_monthly_usd_500', 500, 'month'], ['pro_yearly_usd_5000', 5000, 'year']])
  // two months free: the year costs ten months
  assert.equal(PRO_PRICES[1].unitAmount, PRO_PRICES[0].unitAmount * 10)
  assert.deepEqual([PRO_CREDITS.aiDraftsPerDay, PRO_CREDITS.aiMicrosPerMonth, PRO_CREDITS.voiceMinutesPerMonth, PRO_CREDITS.videoMinutesPerMonth, PRO_CREDITS.creditCostMicrosPerMonth],
    [DEFAULT_METERING.free.aiActionsPerDay, DEFAULT_METERING.free.aiMicrosPerMonth, DEFAULT_METERING.free.voiceMinutesPerMonth, DEFAULT_METERING.free.videoMinutesPerMonth, 3_750_000])
  const stripe = fakeStripe()
  const result = await syncCatalog(stripe, PRO_CATALOG)
  const made = [...stripe.prices.store.values()]
  assert.deepEqual(made.map(p => [p.lookup_key, p.unit_amount, p.recurring.interval, p.tax_behavior, p.active, p.metadata.product]).sort(),
    [['pro_monthly_usd_500', 500, 'month', 'exclusive', true, 'pro'], ['pro_yearly_usd_5000', 5000, 'year', 'exclusive', true, 'pro']])
  assert.deepEqual(Object.keys(result.prices), Object.values(PRO_LOOKUP_KEYS))
  assert.deepEqual((await syncCatalog(stripe, PRO_CATALOG)).actions, [])
})

test('full use of Pro credits never costs more than Pro brings in, monthly or yearly, in the worst likely fee case', () => {
  // The worst likely case, not the most favourable one. Tax is added on top of the price (Stripe Tax,
  // tax-exclusive prices), up to 27% (the highest VAT rate in the EU), and every fee is charged on
  // the tax-inclusive total: card 2.9% + 30 cents, plus 1.5% for an international card and 1% for
  // currency conversion; Billing about 0.7% and Stripe Tax about 0.5% (estimates). Slatebox keeps
  // only the price before tax.
  const scenarios = {
    domestic: { tax: 0, card: 0.029 },
    'international card, currency conversion, 27% tax': { tax: 0.27, card: 0.029 + 0.015 + 0.01 },
  }
  const fullUseCents = fullUseMicros(DEFAULT_METERING.free) / 10_000
  assert.ok(fullUseCents <= DEFAULT_METERING.free.creditCostMicrosPerMonth / 10_000, `full use costs ${fullUseCents} cents`)
  for (const [name, { tax, card }] of Object.entries(scenarios)) {
    const netCents = cents => {
      const charged = cents * (1 + tax)
      return cents - (charged * card + 30) - charged * 0.007 - charged * 0.005
    }
    const monthly = netCents(PRO_PRICES[0].unitAmount)
    const yearlyPerMonth = netCents(PRO_PRICES[1].unitAmount) / 12
    assert.ok(fullUseCents < monthly, `${name}, monthly: ${fullUseCents} cents against ${monthly.toFixed(1)}`)
    // a real margin, not a rounding error: at least 10 cents a month on yearly Pro
    assert.ok(fullUseCents + 10 <= yearlyPerMonth, `${name}, yearly: ${fullUseCents} cents a month against ${yearlyPerMonth.toFixed(1)}`)
  }
  // The month Pro starts in gives only its share of credits (policy.mjs monthShare), so a year of
  // Pro brings at most twelve months of credits: the margin above is per paid month.
})

test('a dry run of everything lists exactly what it would create, and writes nothing', async () => {
  const stripe = fakeStripe()
  const plan = await syncAll(stripe, { dryRun: true })
  assert.equal(stripe.writes().length, 0)
  assert.deepEqual(plan.actions.map(a => [a.part, a.do, a.lookupKey ?? a.id]), [
    ['pro', 'create-product', 'slatebox_pro'],
    ['pro', 'create-price', 'pro_monthly_usd_500'],
    ['pro', 'create-price', 'pro_yearly_usd_5000'],
    ['portal', 'create-portal-configuration', undefined],
  ])
  assert.equal(plan.links, undefined)
})

test('a full run makes the portal for Pro; a second run changes nothing', async () => {
  const stripe = fakeStripe()
  const first = await syncAll(stripe)
  const [portal] = [...stripe.billingPortal.configurations.store.values()]
  const update = portal.features.subscription_update
  assert.deepEqual(update.products, [{ product: 'slatebox_pro', prices: [first.prices.pro_monthly_usd_500, first.prices.pro_yearly_usd_5000] }])
  assert.equal(update.proration_behavior, 'create_prorations')
  assert.deepEqual(update.schedule_at_period_end, { conditions: [{ type: 'shortening_interval' }] })
  assert.equal(portal.features.subscription_cancel.mode, 'at_period_end')
  assert.equal(portal.business_profile.terms_of_service_url, 'https://slatebox.com/terms/')
  assert.equal(first.portal, portal.id)
  assert.equal(stripe.paymentLinks.store.size, 0)

  const before = stripe.writes().length
  const second = await syncAll(stripe)
  assert.deepEqual(second.actions, [])
  assert.equal(stripe.writes().length, before)
  assert.equal(second.portal, first.portal)
})

test('a new Pro price updates the portal in place', async () => {
  const stripe = fakeStripe()
  const first = await syncAll(stripe)
  // someone archives and replaces the monthly price by hand: the portal follows the lookup_key
  const moved = await stripe.prices.create({ product: 'slatebox_pro', currency: 'usd', unit_amount: 500, recurring: { interval: 'month', interval_count: 1 }, tax_behavior: 'exclusive', lookup_key: 'pro_monthly_usd_500', transfer_lookup_key: true, metadata: { product: 'pro', interval: 'month', lookup_key: 'pro_monthly_usd_500' }, nickname: 'Slatebox Pro, monthly' })
  await stripe.prices.update(first.prices.pro_monthly_usd_500, { active: false })
  const second = await syncAll(stripe, { only: ['portal'] })
  assert.deepEqual(second.actions.map(a => a.do), ['update-portal-configuration'])
  assert.deepEqual([...stripe.billingPortal.configurations.store.values()][0].features.subscription_update.products[0].prices, [moved.id, first.prices.pro_yearly_usd_5000])
})

test('an old price holding a Pro lookup_key on another product is replaced and archived, never reused', async () => {
  const stripe = fakeStripe()
  const old = await stripe.prices.create({ product: 'prod_old_pro', currency: 'usd', unit_amount: 800, recurring: { interval: 'month', interval_count: 1 }, tax_behavior: 'unspecified', lookup_key: 'pro_monthly_usd_500' })
  const plan = await syncCatalog(stripe, { ...PRO_CATALOG, dryRun: true })
  assert.deepEqual(plan.actions.filter(a => a.lookupKey === 'pro_monthly_usd_500' || a.id === old.id).map(a => [a.do, a.replaces ?? a.id]), [['create-price', old.id], ['archive-price', old.id]])
  assert.equal(stripe.writes().length, 1, 'only the setup write')
  await syncCatalog(stripe, PRO_CATALOG)
  assert.equal(stripe.prices.store.get(old.id).active, false)
})

test('--only, --dry-run and --live are the only options; Pro and its portal are the only parts', () => {
  assert.deepEqual(PARTS, ['pro', 'portal'])
  assert.deepEqual(parseArgs([]), { dryRun: false, live: false, only: ['pro', 'portal'] })
  assert.deepEqual(parseArgs(['--dry-run', '--only', 'pro,portal']), { dryRun: true, live: false, only: ['pro', 'portal'] })
  assert.deepEqual(parseArgs(['--only=portal', '--live']).only, ['portal'])
  for (const gone of ['private', 'links', 'business', 'seats']) assert.throws(() => parseArgs(['--only', gone]), /--only takes pro, portal/, gone)
  assert.throws(() => parseArgs(['--only']), /--only takes/)
})

test('with no key at all nothing runs, not even a dry run', async () => {
  let made = false
  await assert.rejects(main(['--dry-run'], {}, { makeStripe: () => { made = true }, log: () => {} }), /Set STRIPE_SECRET_KEY to a Stripe secret key/)
  assert.equal(made, false)
})

test('the portal allows monthly and yearly Pro only', () => {
  const params = portalParams({ monthlyPriceId: 'price_m', yearlyPriceId: 'price_y' })
  assert.deepEqual(params.features.subscription_update.products, [{ product: 'slatebox_pro', prices: ['price_m', 'price_y'] }])
  assert.equal(params.default_return_url, 'https://app.slatebox.com/profile?tab=credits')
})
