#!/usr/bin/env node
// Creates or updates what Slatebox sells through Stripe, from the catalogue in the app: Slatebox
// Pro only (owner decision 2026-11-22).
// - "Slatebox Pro" (fixed product id slatebox_pro) and its prices pro_monthly_usd_500 and
//   pro_yearly_usd_5000, tax-exclusive (Stripe Tax adds tax at checkout), from
//   web/app/imports/api/pro/catalog.mjs,
// - the customer portal configuration for Pro (card, invoices, monthly/yearly, cancel at period end).
// Slatebox Business is sold by talking to us until its billing is built; its prices are
// added here with that billing. Nothing else is created.
// Safe to run again: a second run with no catalogue change creates nothing.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-catalog.mjs [--dry-run] [--live] [--only pro,portal]
//
// - Every run's output ends with dashboardChecks: Stripe settings this script cannot make, which
//   the terms rely on. Check each one in the dashboard (for the mode in use) before Pro goes on sale.
// - The key is read from STRIPE_SECRET_KEY only and is never printed. With no key, nothing runs,
//   not even a dry run.
// - A live key is refused unless --live is passed.
// - --dry-run reads Stripe (GET only) and prints every action it would take; it writes nothing.
// - Prices are found by lookup_key. A price whose amount, interval or tax behaviour changed
//   cannot be edited in Stripe, so a new price takes over the lookup_key and the old one is
//   archived (existing customers keep it until renewal). A changed nickname or metadata is
//   updated in place. Any other active price on the product is archived.
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  PRO_LOOKUP_KEYS, PRO_PORTAL, PRO_PRODUCT, proProductMetadata, proStripePrices,
} from '../web/app/imports/api/pro/catalog.mjs'

export const PRO_CATALOG = Object.freeze({ product: PRO_PRODUCT, productMetadata: proProductMetadata(), prices: proStripePrices() })
export const PARTS = Object.freeze(['pro', 'portal'])
// what a run with no --only covers: everything
export const DEFAULT_PARTS = PARTS

// Stripe Billing settings the terms (section 9) and pro-billing.mjs rely on, which the API cannot set.
export const DASHBOARD_CHECKS = Object.freeze([
  'Billing > Subscriptions and emails > Manage failed payments: after all retries fail, CANCEL the subscription (not "mark as unpaid" or "leave past due"). Terms: "If it is still unpaid after our retries, Slatebox Pro ends."',
  'Billing > Subscriptions and emails > Customer emails: turn on "Send emails about upcoming renewals" (at least 7 days ahead) so yearly Pro renewals are emailed. Terms: "We email you before a yearly renewal."',
  'Billing > Subscriptions and emails > Customer emails: turn on emails for failed payments and expiring cards, with the link to the customer portal.',
  'Settings > Tax: Stripe Tax is on with an origin address and the registrations where tax is collected (Checkout uses automatic_tax; Pro prices are tax-exclusive, "plus tax where applicable").',
  'Developers > Webhooks: app.slatebox.com/stripehooks receives customer.subscription.*, invoice.*, checkout.session.*, charge.refunded and charge.dispute.* events.',
])
export const APP_RETURN_URL = 'https://app.slatebox.com/profile?tab=credits'

export const KEY_ENV = 'STRIPE_SECRET_KEY'

// Returns 'test' or 'live'. Throws, without echoing the key, for anything else.
export function stripeKeyMode(key, { live = false } = {}) {
  if (typeof key !== 'string' || !key) throw new Error(`Set ${KEY_ENV} to a Stripe secret key.`)
  if (/^(sk|rk)_test_/.test(key)) return 'test'
  if (/^(sk|rk)_live_/.test(key)) {
    if (!live) throw new Error('Refusing to use a live Stripe key without --live.')
    return 'live'
  }
  throw new Error(`${KEY_ENV} is not a Stripe secret key (expected sk_test_, sk_live_, rk_test_ or rk_live_).`)
}

const isMissing = error => error?.statusCode === 404 || error?.code === 'resource_missing' || error?.raw?.code === 'resource_missing'

async function listAll(list, params) {
  const out = []
  let startingAfter
  for (;;) {
    const page = await list({ ...params, limit: 100, ...(startingAfter && { starting_after: startingAfter }) })
    out.push(...page.data)
    if (!page.has_more || !page.data.length) return out
    startingAfter = page.data[page.data.length - 1].id
  }
}

// Stripe stores metadata as strings; a key left out is removed by setting it to ''.
function metadataPatch(current = {}, desired) {
  const patch = {}
  for (const [k, v] of Object.entries(desired)) if (current[k] !== v) patch[k] = v
  for (const k of Object.keys(current)) if (!(k in desired)) patch[k] = ''
  return Object.keys(patch).length ? patch : null
}

// Fields Stripe will not change on an existing price.
const sameTerms = (price, want, product) =>
  price.product === product.id &&
  price.currency === product.currency &&
  price.unit_amount === want.unitAmount &&
  price.type === 'recurring' &&
  price.recurring?.interval === want.interval &&
  (price.recurring?.interval_count ?? 1) === want.intervalCount &&
  price.recurring?.usage_type !== 'metered' &&
  price.tax_behavior === product.taxBehavior

function priceParams(want, product) {
  return {
    product: product.id,
    currency: product.currency,
    unit_amount: want.unitAmount,
    active: want.active !== false,
    recurring: { interval: want.interval, interval_count: want.intervalCount },
    tax_behavior: product.taxBehavior,
    lookup_key: want.lookupKey,
    nickname: want.nickname,
    metadata: { ...want.metadata, lookup_key: want.lookupKey },
  }
}

/**
 * Brings one product and its prices in line with a catalogue (PRO_CATALOG).
 * Returns what it did (ids only, never the key).
 * stripe: a stripe-node client, or anything with the same products/prices methods.
 */
export async function syncCatalog(stripe, { product, productMetadata, prices, dryRun = false }) {
  if (!product?.id || !Array.isArray(prices)) throw new Error('syncCatalog needs a catalogue: PRO_CATALOG.')
  const actions = []
  const act = async (action, run) => {
    actions.push(action)
    if (!dryRun) Object.assign(action, { id: (await run())?.id ?? action.id })
  }

  // The product, under its fixed id.
  const wantProduct = { name: product.name, description: product.description, tax_code: product.taxCode, metadata: productMetadata }
  let current = null
  try {
    current = await stripe.products.retrieve(product.id)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  if (!current) {
    await act({ do: 'create-product', id: product.id }, () => stripe.products.create({ id: product.id, ...wantProduct }))
  } else {
    const patch = {}
    if (current.name !== wantProduct.name) patch.name = wantProduct.name
    if (current.description !== wantProduct.description) patch.description = wantProduct.description
    const taxCode = typeof current.tax_code === 'object' ? current.tax_code?.id : current.tax_code
    if (taxCode !== wantProduct.tax_code) patch.tax_code = wantProduct.tax_code
    if (current.active === false) patch.active = true
    const meta = metadataPatch(current.metadata, productMetadata)
    if (meta) patch.metadata = meta
    if (Object.keys(patch).length) {
      await act({ do: 'update-product', id: product.id, fields: Object.keys(patch) }, () => stripe.products.update(product.id, patch))
    }
  }

  // The prices, by lookup_key.
  const keys = prices.map(p => p.lookupKey)
  if (new Set(keys).size !== keys.length) throw new Error('Two catalogue prices share a lookup_key.')
  const byKey = new Map()
  for (let i = 0; i < keys.length; i += 10) {
    for (const price of await listAll(params => stripe.prices.list(params), { lookup_keys: keys.slice(i, i + 10) })) {
      byKey.set(price.lookup_key, price)
    }
  }
  const keep = new Set()
  for (const want of prices) {
    const have = byKey.get(want.lookupKey)
    const params = priceParams(want, product)
    if (have && sameTerms(have, want, product)) {
      keep.add(have.id)
      const patch = {}
      if (have.nickname !== params.nickname) patch.nickname = params.nickname
      if (have.active !== params.active) patch.active = params.active
      const meta = metadataPatch(have.metadata, params.metadata)
      if (meta) patch.metadata = meta
      if (Object.keys(patch).length) {
        await act({ do: 'update-price', lookupKey: want.lookupKey, id: have.id, fields: Object.keys(patch) }, () => stripe.prices.update(have.id, patch))
      }
      continue
    }
    const create = { do: 'create-price', lookupKey: want.lookupKey, unitAmount: want.unitAmount, ...(have && { replaces: have.id }) }
    await act(create, () => stripe.prices.create({ ...params, ...(have && { transfer_lookup_key: true }) }))
    if (create.id) keep.add(create.id)
    if (have?.active) {
      await act({ do: 'archive-price', id: have.id, reason: `replaced for ${want.lookupKey}` }, () => stripe.prices.update(have.id, { active: false }))
    }
  }

  // Anything else still for sale on the product is archived: the catalogue is the whole list.
  if (current) {
    const archived = new Set(actions.filter(a => a.do === 'archive-price').map(a => a.id))
    for (const price of await listAll(params => stripe.prices.list(params), { product: product.id, active: true })) {
      if (keep.has(price.id) || archived.has(price.id)) continue
      await act({ do: 'archive-price', id: price.id, reason: `not in the catalogue${price.lookup_key ? ` (${price.lookup_key})` : ''}` }, () => stripe.prices.update(price.id, { active: false }))
    }
  }

  // A planned (dry-run) replacement has no id yet: report null, not the price it replaces.
  const idFor = lookupKey => {
    const created = actions.find(a => a.do === 'create-price' && a.lookupKey === lookupKey)
    return created ? (created.id ?? null) : (byKey.get(lookupKey)?.id ?? null)
  }
  return { productId: product.id, dryRun, actions, prices: Object.fromEntries(prices.map(p => [p.lookupKey, idFor(p.lookupKey)])) }
}

// A short fingerprint of what the portal configuration should be, kept in its
// metadata: a run changes it only when the catalogue's wish differs from what was made last time.
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)

/** The portal for Slatebox Pro only: card, invoices, monthly↔yearly, cancel at period end. */
export function portalParams({ monthlyPriceId, yearlyPriceId }) {
  return {
    business_profile: { headline: PRO_PORTAL.headline, privacy_policy_url: PRO_PORTAL.privacyUrl, terms_of_service_url: PRO_PORTAL.termsUrl },
    default_return_url: APP_RETURN_URL,
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true, mode: 'at_period_end',
        cancellation_reason: { enabled: true, options: ['too_expensive', 'unused', 'switched_service', 'other'] },
      },
      subscription_update: {
        enabled: true, default_allowed_updates: ['price'],
        products: [{ product: PRO_PRODUCT.id, prices: [monthlyPriceId, yearlyPriceId] }],
        // monthly → yearly at once (the unused month is credited); yearly → monthly at the end of the year
        proration_behavior: 'create_prorations',
        schedule_at_period_end: { conditions: [{ type: 'shortening_interval' }] },
      },
    },
  }
}

/** Finds the Pro portal configuration by its metadata; creates it, or updates it when the wish changed. */
export async function syncPortal(stripe, { monthlyPriceId, yearlyPriceId, dryRun = false }) {
  const actions = []
  const want = portalParams({ monthlyPriceId, yearlyPriceId })
  const hash = fingerprint(want)
  const metadata = { [PRO_PORTAL.metadataKey]: PRO_PORTAL.metadataValue, slatebox_hash: hash }
  const all = await listAll(params => stripe.billingPortal.configurations.list(params), {})
  const have = all.find(c => c.metadata?.[PRO_PORTAL.metadataKey] === PRO_PORTAL.metadataValue && c.active !== false)
  const pending = !monthlyPriceId || !yearlyPriceId
  if (!have) {
    const action = { do: 'create-portal-configuration', prices: [monthlyPriceId, yearlyPriceId], ...(pending && { note: 'price ids are made by the pro step first' }) }
    actions.push(action)
    if (!dryRun) action.id = (await stripe.billingPortal.configurations.create({ ...want, metadata })).id
    return { id: action.id ?? null, actions }
  }
  if (have.metadata?.slatebox_hash !== hash) {
    const action = { do: 'update-portal-configuration', id: have.id }
    actions.push(action)
    if (!dryRun) await stripe.billingPortal.configurations.update(have.id, { ...want, metadata })
  }
  return { id: have.id, actions }
}

/** Every part, in order: the products and prices first, then what refers to their price ids. */
export async function syncAll(stripe, { only = PARTS, dryRun = false } = {}) {
  const out = { dryRun, actions: [], prices: {}, portal: null }
  const take = (part, result) => { out.actions.push(...result.actions.map(a => ({ part, ...a }))) }
  const priceIds = async keys => {
    const ids = {}
    for (const price of await listAll(params => stripe.prices.list(params), { lookup_keys: keys })) ids[price.lookup_key] = price.id
    return ids
  }
  if (only.includes('pro')) {
    const result = await syncCatalog(stripe, { ...PRO_CATALOG, dryRun })
    take('pro', result)
    Object.assign(out.prices, result.prices)
  }
  if (only.includes('portal')) {
    const ids = { ...await priceIds(Object.values(PRO_LOOKUP_KEYS)), ...out.prices }
    const result = await syncPortal(stripe, { monthlyPriceId: ids[PRO_LOOKUP_KEYS.month] ?? null, yearlyPriceId: ids[PRO_LOOKUP_KEYS.year] ?? null, dryRun })
    take('portal', result)
    out.portal = result.id
  }
  return out
}

async function loadStripe(key) {
  const require = createRequire(new URL('../web/app/package.json', import.meta.url))
  const { default: Stripe } = await import(require.resolve('stripe'))
  return new Stripe(key, { maxNetworkRetries: 2 })
}

const USAGE = `Usage: ${KEY_ENV}=sk_test_... node scripts/stripe-catalog.mjs [--dry-run] [--live] [--only ${PARTS.join(',')}]`

export function parseArgs(argv) {
  const opts = { dryRun: false, live: false, only: [...DEFAULT_PARTS] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--live') opts.live = true
    else if (arg === '--only' || arg.startsWith('--only=')) {
      const value = arg === '--only' ? argv[++i] : arg.slice('--only='.length)
      const parts = String(value || '').split(',').map(p => p.trim()).filter(Boolean)
      if (!parts.length || parts.some(p => !PARTS.includes(p))) throw new Error(`--only takes ${PARTS.join(', ')}. ${USAGE}`)
      opts.only = PARTS.filter(p => parts.includes(p))
    } else throw new Error(`Unknown option ${arg}. ${USAGE}`)
  }
  return opts
}

export async function main(argv = process.argv.slice(2), env = process.env, { makeStripe = loadStripe, log = console.log } = {}) {
  const opts = parseArgs(argv)
  const key = env[KEY_ENV]
  const mode = stripeKeyMode(key, { live: opts.live })
  const result = await syncAll(await makeStripe(key), { only: opts.only, dryRun: opts.dryRun })
  log(JSON.stringify({ mode, only: opts.only, ...result, dashboardChecks: DASHBOARD_CHECKS }, null, 2))
  return { mode, only: opts.only, ...result, dashboardChecks: DASHBOARD_CHECKS }
}

// Run as a script, however the path was typed (symlinked /tmp, spaces, %).
export function isEntryPoint(moduleUrl = import.meta.url, argv1 = process.argv[1]) {
  if (!argv1) return false
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1)
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main().catch(error => {
    // the message only: a Stripe error object can carry request headers
    console.error(error?.message || String(error))
    process.exit(1)
  })
}
