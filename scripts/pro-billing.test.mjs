import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PRO_GRACE_MS, checkProPrice, proCheckoutKey, entitlementFromSubscription, handleBillingEvent, proActive, proCheckoutParams, proExempt, proIncluded,
  proOnSale, proSummary, productOfSubscription, startProCheckout, syncSubscription,
} from '../web/app/server/pro-billing.mjs'
import { DEFAULT_METERING } from '../web/app/server/metering/policy.mjs'
import { PRO_PRICES } from '../web/app/imports/api/pro/catalog.mjs'

// Slatebox Pro is a switch on the meter's monthly amount: the webhook only records the
// subscription's state, read fresh from Stripe. No network: Stripe and Mongo are in memory.
const NOW = Date.UTC(2026, 10, 22, 12)
const DAY = 86_400_000
const sec = ms => Math.floor(ms / 1000)
const switchAt = at => ({ ...DEFAULT_METERING, free: { ...DEFAULT_METERING.free, proRequiredFrom: at } })

function proItem(lookupKey = 'pro_monthly_usd_500', start = NOW, end = NOW + 30 * DAY) {
  const interval = lookupKey.includes('yearly') ? 'year' : 'month'
  return { price: { id: 'price_' + lookupKey, product: 'slatebox_pro', lookup_key: lookupKey, recurring: { interval } }, current_period_start: sec(start), current_period_end: sec(end) }
}
// a product Slatebox no longer sells through Stripe (the old Private catalogue): never Pro
const otherItem = () => ({ price: { id: 'price_ps', product: { id: 'slatebox_private' }, lookup_key: 'private_small_yearly', recurring: { interval: 'year' } }, current_period_end: sec(NOW + 365 * DAY) })

// An in-memory Stripe: subscriptions (fresh reads), invoices, refunds, charges, customers.
function world({ users = [{ _id: 'u1' }] } = {}) {
  const subs = new Map(), invoices = new Map(), charges = new Map(), refunds = [], cancels = [], alerts = [], audits = []
  // Basil and later: invoice payments (an invoice's payments, and which invoice a payment intent paid)
  const invoicePayments = [], invoiceReads = []
  const people = new Map(users.map(u => [u._id, structuredClone(u)]))
  let clock = NOW
  const stripe = {
    subscriptions: {
      async retrieve(id) { if (!subs.has(id)) throw Object.assign(new Error('No such subscription'), { statusCode: 404 }); return structuredClone(subs.get(id)) },
      async cancel(id, params, opts) {
        cancels.push({ id, params, key: opts?.idempotencyKey })
        const sub = subs.get(id)
        if (sub) Object.assign(sub, { status: 'canceled', ended_at: sec(clock) })
        return structuredClone(sub)
      },
    },
    invoices: { async retrieve(id, params) { invoiceReads.push({ id, params }); return structuredClone(invoices.get(id)) } },
    invoicePayments: {
      async list(params) {
        const pi = params?.payment?.payment_intent
        const data = invoicePayments.filter(p => (!params?.invoice || p.invoice === params.invoice) && (!pi || p.payment?.payment_intent === pi))
        return { object: 'list', data: structuredClone(data), has_more: false }
      },
    },
    charges: { async retrieve(id) { return structuredClone(charges.get(id)) } },
    customers: { async retrieve(id) { return { id, email: id + '@example.test' } } },
    refunds: {
      async create(params, opts) {
        // Stripe's idempotency: the same key returns the first refund
        const again = refunds.find(r => r.key === opts?.idempotencyKey)
        if (again) return again
        const refund = { id: 're_' + (refunds.length + 1), params, key: opts?.idempotencyKey }
        refunds.push(refund)
        return refund
      },
    },
  }
  const store = {
    async findProUser({ userId, customerId, subscriptionId }) {
      const all = [...people.values()]
      return structuredClone(all.find(u => subscriptionId && u.pro?.subscriptionId === subscriptionId)
        || people.get(userId) || all.find(u => customerId && u.pro?.customerId === customerId) || null)
    },
    async writePro(userId, fields, fetchedAt) {
      const u = people.get(userId)
      if (!u) return false
      if (u.pro?.fetchedAt != null && !(u.pro.fetchedAt < fetchedAt)) return false
      u.pro = { ...u.pro, ...structuredClone(fields) }
      return true
    },
    async setProCustomer(userId, customerId) {
      const u = people.get(userId)
      if (!u || (u.pro?.customerId && u.pro.customerId !== customerId)) return false
      u.pro = { ...u.pro, customerId }
      return true
    },
    async setProHold(userId, hold) { const u = people.get(userId); u.pro = { ...u.pro, hold } },
    async findUserByProCustomer(customerId) { return structuredClone([...people.values()].find(u => u.pro?.customerId === customerId) || null) },
    async audit(entry) { audits.push(entry) },
    // fields that are not a read of the subscription (actionNeeded, switchExpiredAt)
    async setProFields(userId, fields) { const u = people.get(userId); if (u) u.pro = { ...u.pro, ...structuredClone(fields) } },
    async clearProAction(userId, invoiceId) {
      const u = people.get(userId)
      if (u?.pro?.actionNeeded && (invoiceId == null || u.pro.actionNeeded.invoiceId === invoiceId)) u.pro = { ...u.pro, actionNeeded: null }
    },
  }
  const deps = { stripe, store, alert: async text => { alerts.push(text) }, now: () => clock }
  const put = sub => { subs.set(sub.id, structuredClone(sub)); return sub }
  return { stripe, store, deps, subs, invoices, invoicePayments, invoiceReads, charges, refunds, cancels, alerts, audits, people, put, tick: ms => { clock += ms }, user: id => people.get(id) }
}

const sub = (over = {}) => ({
  id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { product: 'pro', userId: 'u1' }, created: sec(NOW),
  cancel_at_period_end: false, items: { data: [proItem()] }, ...over,
})
const event = (type, object, id = 'evt_' + type) => ({ id, type, data: { object } })

// ---------- who has Pro ----------

test('Pro is included for each status as the design says, with 48 hours of grace for a late renewal', () => {
  const at = switchAt(NOW - DAY)
  const base = { status: 'active', currentPeriodEnd: NOW + DAY, subscriptionId: 'sub_1' }
  assert.equal(proIncluded(base, NOW, at), true)
  assert.equal(proIncluded({ ...base, status: 'trialing' }, NOW, at), true)
  for (const status of ['past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.equal(proIncluded({ ...base, status }, NOW, at), false, status)
  }
  // a renewal webhook that is late: still on for 48 hours past the period end, not after
  assert.equal(proIncluded({ ...base, currentPeriodEnd: NOW - PRO_GRACE_MS + 1 }, NOW, at), true)
  assert.equal(proIncluded({ ...base, currentPeriodEnd: NOW - PRO_GRACE_MS }, NOW, at), false)
  // a disputed payment pauses credits
  assert.equal(proIncluded({ ...base, hold: 'dispute' }, NOW, at), false)
  assert.equal(proIncluded(null, NOW, at), false)
})

test('before a set Pro moment, and with "never" (self-host), the amount is everyone\'s; with "now", Pro\'s', () => {
  assert.equal(proIncluded(null, NOW, DEFAULT_METERING), true)
  assert.equal(proIncluded(null, NOW, switchAt('now')), false)
  assert.equal(proIncluded(null, NOW, switchAt(NOW + DAY)), true)
  assert.equal(proIncluded(null, NOW, switchAt(NOW)), false)
  // real Pro is still real Pro before the date (no budget stages for paying people)
  assert.equal(proActive({ status: 'active', currentPeriodEnd: NOW + DAY }, NOW), true)
})

test('the summary agents and the profile see: renews, ends, trial, past due; never ids', () => {
  const pro = entitlementFromSubscription(sub(), NOW)
  const s = proSummary(pro, NOW)
  assert.deepEqual(s, {
    active: true, status: 'active', interval: 'month', renewsOn: new Date(NOW + 30 * DAY).toISOString(), endsOn: null,
    cancelAtPeriodEnd: false, trialEndsOn: null, pastDue: false, onHold: false,
  })
  assert.doesNotMatch(JSON.stringify(s), /cus_|sub_|price_/)
  const ending = proSummary({ ...pro, cancelAtPeriodEnd: true }, NOW)
  assert.equal(ending.renewsOn, null)
  assert.equal(ending.endsOn, new Date(NOW + 30 * DAY).toISOString())
  assert.equal(proSummary({ ...pro, status: 'past_due' }, NOW).pastDue, true)
  assert.equal(proSummary({ ...pro, status: 'past_due' }, NOW).active, false)
  assert.equal(proSummary(null, NOW), null)
})

test('the entitlement reads the period from the subscription or its item, whichever the API version gives', () => {
  const older = entitlementFromSubscription({ ...sub(), current_period_start: sec(NOW), current_period_end: sec(NOW + 5 * DAY), items: { data: [{ price: proItem().price }] } }, 1)
  assert.equal(older.currentPeriodEnd, sec(NOW + 5 * DAY) * 1000)
  const newer = entitlementFromSubscription(sub(), 1)
  assert.equal(newer.currentPeriodEnd, sec(NOW + 30 * DAY) * 1000)
  assert.deepEqual([newer.lookupKey, newer.interval, newer.customerId, newer.subscriptionId, newer.fetchedAt], ['pro_monthly_usd_500', 'month', 'cus_1', 'sub_1', 1])
  assert.equal(productOfSubscription(sub()), 'pro')
  assert.equal(productOfSubscription({ items: { data: [otherItem()] } }), null)
  assert.equal(productOfSubscription({ items: { data: [{ price: { product: 'prod_old' } }] } }), null)
})

// ---------- checkout ----------

test('checkout: a subscription with the catalogue price, the account on it, tax on top, and no trial', () => {
  const p = proCheckoutParams({ userId: 'u1', email: 'a@example.test', priceId: 'price_m', baseUrl: 'https://app.slatebox.com', settings: DEFAULT_METERING, now: NOW })
  assert.equal(p.mode, 'subscription')
  assert.deepEqual(p.line_items, [{ price: 'price_m', quantity: 1 }])
  assert.equal(p.client_reference_id, 'u1')
  assert.deepEqual(p.metadata, { product: 'pro', userId: 'u1' })
  assert.deepEqual(p.subscription_data, { metadata: { product: 'pro', userId: 'u1' } })
  assert.equal(p.customer_email, 'a@example.test')
  assert.equal(p.customer, undefined)
  assert.deepEqual(p.automatic_tax, { enabled: true })
  assert.equal(p.payment_method_collection, 'always')
  // Stripe's 30-minute minimum is always met, and the same minute gives the same parameters and key
  assert.equal(p.expires_at, sec(NOW) + 31 * 60)
  const later = NOW + 59_000
  const again59 = proCheckoutParams({ userId: 'u1', email: 'a@example.test', priceId: 'price_m', baseUrl: 'https://app.slatebox.com', settings: DEFAULT_METERING, now: later })
  assert.deepEqual(again59, p)
  assert.ok(again59.expires_at - sec(later) >= 30 * 60)
  assert.equal(proCheckoutKey('u1', 'month', NOW), proCheckoutKey('u1', 'month', later))
  assert.notEqual(proCheckoutKey('u1', 'month', NOW), proCheckoutKey('u1', 'year', NOW))
  assert.equal(p.success_url, 'https://app.slatebox.com/profile?tab=credits&pro={CHECKOUT_SESSION_ID}')
  assert.equal(p.cancel_url, 'https://app.slatebox.com/profile?tab=credits')
  // a returning person keeps their customer
  const again = proCheckoutParams({ userId: 'u1', email: 'a@example.test', customerId: 'cus_1', priceId: 'price_m', baseUrl: 'x', settings: DEFAULT_METERING, now: NOW })
  assert.equal(again.customer, 'cus_1')
  assert.equal(again.customer_email, undefined)
  // Pro is paid from the first day: no trial, whatever the switch says (owner decision 2026-11-22)
  for (const at of ['now', NOW + 30 * DAY, NOW + PRO_GRACE_MS, NOW - DAY]) {
    assert.equal(proCheckoutParams({ userId: 'u1', priceId: 'p', baseUrl: 'x', settings: switchAt(at), now: NOW }).subscription_data.trial_end, undefined, String(at))
  }
})

test('Pro is on sale where Pro is needed ("now" on Cloud, or a set moment), never with "never" (self-host)', () => {
  assert.equal(proOnSale(DEFAULT_METERING), false)
  assert.equal(proOnSale(switchAt('now')), true)
  assert.equal(proOnSale(switchAt('never')), false)
  assert.equal(proOnSale(switchAt(NOW + 30 * DAY)), true)
  assert.equal(proOnSale(switchAt(NOW - DAY)), true)
})

test('a Stripe price is used only when its product, amount and interval match the catalogue', () => {
  const [monthly] = PRO_PRICES
  const good = { id: 'price_m', product: { id: 'slatebox_pro' }, unit_amount: 500, currency: 'usd', recurring: { interval: 'month' }, active: true }
  assert.equal(checkProPrice(good, monthly), null)
  assert.equal(checkProPrice({ ...good, product: 'prod_old_pro' }, monthly), 'product')
  assert.equal(checkProPrice({ ...good, unit_amount: 800 }, monthly), 'amount')
  assert.equal(checkProPrice({ ...good, recurring: { interval: 'year' } }, monthly), 'interval')
  assert.equal(checkProPrice(undefined, monthly), 'missing')
})

// ---------- the webhook ----------

test('a completed checkout puts the customer on the account and Pro from a fresh read of the subscription', async () => {
  const w = world()
  w.put(sub())
  const out = await handleBillingEvent(event('checkout.session.completed', { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', client_reference_id: 'u1', metadata: { product: 'pro', userId: 'u1' } }), w.deps)
  assert.equal(out.handled, true)
  const pro = w.user('u1').pro
  assert.deepEqual([pro.customerId, pro.subscriptionId, pro.status, pro.interval], ['cus_1', 'sub_1', 'active', 'month'])
  assert.equal(proActive(pro, NOW), true)
  // a top-up checkout is not Pro's
  assert.deepEqual(await handleBillingEvent(event('checkout.session.completed', { id: 'cs_2', mode: 'payment', metadata: { walletId: 'user:u1' } }), w.deps), { handled: false })
})

test('created, updated and deleted follow Stripe; a retry of the same event changes nothing', async () => {
  const w = world()
  w.put(sub())
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  const first = structuredClone(w.user('u1').pro)
  w.tick(1000)
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  const { fetchedAt: _a, ...before } = first
  const { fetchedAt: _b, ...after } = w.user('u1').pro
  assert.deepEqual(after, before, 'the same state again')
  // cancel at period end in the portal: still Pro until the end
  w.put(sub({ cancel_at_period_end: true }))
  w.tick(1000)
  await handleBillingEvent(event('customer.subscription.updated', sub({ cancel_at_period_end: true })), w.deps)
  assert.equal(w.user('u1').pro.cancelAtPeriodEnd, true)
  assert.equal(proActive(w.user('u1').pro, NOW), true)
  // the period ends: deleted
  w.put(sub({ status: 'canceled', ended_at: sec(NOW + 30 * DAY) }))
  w.tick(1000)
  await handleBillingEvent(event('customer.subscription.deleted', sub({ status: 'canceled' })), w.deps)
  assert.equal(w.user('u1').pro.status, 'canceled')
  assert.equal(proIncluded(w.user('u1').pro, NOW, switchAt(NOW - DAY)), false)
  // and the customer is kept for a return
  assert.equal(w.user('u1').pro.customerId, 'cus_1')
})

test('out of order: a read that started earlier but returned later never overwrites the newer one', async () => {
  const w = world()
  // Stripe reads that resolve out of order: each read sees Stripe as it is when it starts, and
  // the first one is held back until the second has been written.
  let calls = 0
  const deps = { ...w.deps, now: () => NOW + ++calls }
  let release
  const gate = new Promise(resolve => { release = resolve })
  const realRetrieve = w.stripe.subscriptions.retrieve
  let reads = 0
  w.stripe.subscriptions.retrieve = async id => {
    const seen = await realRetrieve(id)
    if (reads++ === 0) await gate
    return seen
  }
  w.put(sub({ status: 'past_due' }))
  const first = handleBillingEvent(event('invoice.payment_failed', { id: 'in_1', subscription: 'sub_1' }, 'evt_a'), deps)
  await new Promise(resolve => setImmediate(resolve))
  w.put(sub({ status: 'active' }))
  await handleBillingEvent(event('invoice.paid', { id: 'in_1', subscription: 'sub_1' }, 'evt_b'), deps)
  assert.equal(w.user('u1').pro.status, 'active')
  release()
  await first
  assert.equal(w.user('u1').pro.status, 'active', 'the older read (past due) is dropped')
  assert.equal(w.user('u1').pro.fetchedAt, NOW + 2, 'stamped when its read started')
  // a caller that read the subscription itself must say when that read started
  await assert.rejects(syncSubscription(w.deps, 'sub_1', { sub: sub() }), /fetchedAt/)
})

test('invoice.paid and invoice.payment_failed read the subscription again: past due pauses credits, paid brings them back', async () => {
  const w = world()
  w.put(sub({ status: 'past_due' }))
  await handleBillingEvent(event('invoice.payment_failed', { id: 'in_1', subscription: 'sub_1' }), w.deps)
  assert.equal(w.user('u1').pro.status, 'past_due')
  assert.equal(proIncluded(w.user('u1').pro, NOW, switchAt(NOW - DAY)), false)
  w.put(sub({ status: 'active' }))
  w.tick(1000)
  // the newer API puts the subscription under parent.subscription_details
  await handleBillingEvent(event('invoice.paid', { id: 'in_1', parent: { subscription_details: { subscription: 'sub_1' } } }), w.deps)
  assert.equal(w.user('u1').pro.status, 'active')
  // an invoice with no subscription is not Pro's
  assert.deepEqual(await handleBillingEvent(event('invoice.paid', { id: 'in_2' }), w.deps), { handled: false })
})

test('monthly to yearly keeps Pro continuous with the new period and interval', async () => {
  const w = world()
  w.put(sub())
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  const yearly = sub({ items: { data: [proItem('pro_yearly_usd_5000', NOW + DAY, NOW + 366 * DAY)] } })
  w.put(yearly)
  w.tick(DAY)
  await handleBillingEvent(event('customer.subscription.updated', yearly), w.deps)
  const pro = w.user('u1').pro
  assert.deepEqual([pro.interval, pro.lookupKey, pro.status], ['year', 'pro_yearly_usd_5000', 'active'])
  assert.equal(pro.currentPeriodEnd, sec(NOW + 366 * DAY) * 1000)
})

test('two Pro subscriptions paid in a race: the later one is cancelled and refunded in full, once', async () => {
  const w = world()
  w.put(sub())
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  const second = sub({ id: 'sub_2', created: sec(NOW + 60_000), latest_invoice: 'in_2' })
  w.invoices.set('in_2', { id: 'in_2', amount_paid: 500, payment_intent: 'pi_2' })
  w.put(second)
  w.tick(60_000)
  const out = await handleBillingEvent(event('customer.subscription.created', second, 'evt_2'), w.deps)
  assert.equal(out.handled, true)
  assert.deepEqual(w.cancels.map(c => [c.id, c.params, c.key]), [['sub_2', { invoice_now: false, prorate: false }, 'pro-duplicate:sub_2:cancel']])
  assert.deepEqual(w.refunds.map(r => [r.params.payment_intent, r.key]), [['pi_2', 'pro-duplicate:sub_2']])
  assert.equal(w.user('u1').pro.subscriptionId, 'sub_1', 'the first subscription stays')
  assert.match(w.alerts.at(-1), /second Slatebox Pro subscription was cancelled and refunded: sub_2/)
  // the cancelled duplicate's own events change nothing and refund nothing again
  w.tick(1000)
  await handleBillingEvent(event('customer.subscription.deleted', w.subs.get('sub_2'), 'evt_3'), w.deps)
  assert.equal(w.refunds.length, 1)
  assert.equal(w.user('u1').pro.subscriptionId, 'sub_1')
  assert.equal(w.user('u1').pro.status, 'active')
})

test('a dispute on a Pro payment pauses credits; won, they come back; lost, they stay paused', async () => {
  const w = world()
  w.put(sub())
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  w.charges.set('ch_1', { id: 'ch_1', customer: 'cus_1', invoice: 'in_1' })
  assert.equal((await handleBillingEvent(event('charge.dispute.created', { id: 'dp_1', charge: 'ch_1' }), w.deps)).handled, true)
  assert.equal(w.user('u1').pro.hold, 'dispute')
  assert.equal(proIncluded(w.user('u1').pro, NOW, switchAt(NOW - DAY)), false)
  await handleBillingEvent(event('charge.dispute.closed', { id: 'dp_1', charge: 'ch_1', status: 'won' }), w.deps)
  assert.equal(w.user('u1').pro.hold, null)
  assert.equal(proIncluded(w.user('u1').pro, NOW, switchAt(NOW - DAY)), true)
  await handleBillingEvent(event('charge.dispute.created', { id: 'dp_2', charge: 'ch_1' }), w.deps)
  await handleBillingEvent(event('charge.dispute.closed', { id: 'dp_2', charge: 'ch_1', status: 'lost' }), w.deps)
  assert.equal(w.user('u1').pro.hold, 'dispute')
  // a top-up charge (no invoice) goes on to the top-up handler
  w.charges.set('ch_t', { id: 'ch_t', customer: null, invoice: null })
  assert.deepEqual(await handleBillingEvent(event('charge.dispute.created', { id: 'dp_3', charge: 'ch_t' }), w.deps), { handled: false })
})

test('after a lost dispute and the subscription ending, buying Pro again turns Pro on', async () => {
  const w = world()
  w.put(sub())
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  w.charges.set('ch_1', { id: 'ch_1', customer: 'cus_1', invoice: 'in_1' })
  await handleBillingEvent(event('charge.dispute.created', { id: 'dp_1', charge: 'ch_1' }), w.deps)
  await handleBillingEvent(event('charge.dispute.closed', { id: 'dp_1', charge: 'ch_1', status: 'lost' }), w.deps)
  // the disputed subscription is cancelled
  w.put(sub({ status: 'canceled', ended_at: sec(NOW) }))
  w.tick(1000)
  await handleBillingEvent(event('customer.subscription.deleted', sub({ status: 'canceled' })), w.deps)
  assert.equal(w.user('u1').pro.hold, 'dispute')
  // the person buys Pro again: a new subscription on the same customer
  const again = sub({ id: 'sub_2', created: sec(NOW + DAY) })
  w.put(again)
  w.tick(1000)
  await handleBillingEvent(event('checkout.session.completed', { id: 'cs_2', mode: 'subscription', subscription: 'sub_2', customer: 'cus_1', client_reference_id: 'u1', metadata: { product: 'pro', userId: 'u1' } }), w.deps)
  const pro = w.user('u1').pro
  assert.deepEqual([pro.subscriptionId, pro.status, pro.hold], ['sub_2', 'active', null])
  assert.equal(proActive(pro, NOW), true)
  assert.equal(proIncluded(pro, NOW, switchAt(NOW - DAY)), true)
  assert.equal(w.cancels.length, 0, 'the new subscription is not treated as a duplicate')
})

test('a hold stays on the subscription it was raised on: the same subscription\'s events never clear it', async () => {
  const w = world()
  w.put(sub())
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  w.charges.set('ch_1', { id: 'ch_1', customer: 'cus_1', invoice: 'in_1' })
  await handleBillingEvent(event('charge.dispute.created', { id: 'dp_1', charge: 'ch_1' }), w.deps)
  w.tick(1000)
  await handleBillingEvent(event('invoice.paid', { id: 'in_2', subscription: 'sub_1' }), w.deps)
  assert.equal(w.user('u1').pro.hold, 'dispute')
})

test('an unpaid subscription is still held: a second one is a duplicate', async () => {
  const w = world()
  w.put(sub())
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  w.put(sub({ status: 'unpaid' }))
  w.tick(1000)
  await handleBillingEvent(event('customer.subscription.updated', sub({ status: 'unpaid' })), w.deps)
  const second = sub({ id: 'sub_2', created: sec(NOW + 60_000), latest_invoice: 'in_2' })
  w.invoices.set('in_2', { id: 'in_2', amount_paid: 500, payment_intent: 'pi_2' })
  w.put(second)
  w.tick(1000)
  const out = await handleBillingEvent(event('customer.subscription.created', second, 'evt_2'), w.deps)
  assert.deepEqual(w.cancels.map(c => c.id), ['sub_2'])
  assert.equal(w.user('u1').pro.subscriptionId, 'sub_1')
})

test('only paying people skip the shared budget: a trial made by hand before a Pro moment does not, an active subscription does', () => {
  const trial = { status: 'trialing', currentPeriodEnd: NOW + 30 * DAY, subscriptionId: 'sub_1' }
  const active = { ...trial, status: 'active' }
  // before the date (or with none set), a free trial gets the included amount but follows the stages
  assert.equal(proExempt(trial, NOW, DEFAULT_METERING), false)
  assert.equal(proExempt(trial, NOW, switchAt(NOW + 10 * DAY)), false)
  assert.equal(proIncluded(trial, NOW, switchAt(NOW + 10 * DAY)), true)
  assert.equal(proExempt(active, NOW, DEFAULT_METERING), true)
  // once Pro is needed, live Pro (trial or active) skips the stages
  assert.equal(proExempt(trial, NOW, switchAt(NOW - DAY)), true)
  assert.equal(proExempt(trial, NOW, switchAt('now')), true)
  assert.equal(proExempt({ ...active, hold: 'dispute' }, NOW, switchAt(NOW - DAY)), false)
  assert.equal(proExempt({ ...active, status: 'past_due' }, NOW, DEFAULT_METERING), false)
  assert.equal(proExempt(null, NOW, DEFAULT_METERING), false)
})

test('a refunded Pro charge is recorded and alerted, and Pro stays until it is cancelled; a top-up refund is not Pro\'s', async () => {
  const w = world()
  w.put(sub())
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  const out = await handleBillingEvent(event('charge.refunded', { id: 'ch_9', customer: 'cus_1', invoice: 'in_9', amount_refunded: 500 }), w.deps)
  assert.equal(out.handled, true)
  assert.equal(w.audits.at(-1).type, 'pro-refund')
  assert.equal(w.user('u1').pro.status, 'active')
  assert.deepEqual(await handleBillingEvent(event('charge.refunded', { id: 'ch_t', customer: null, invoice: null }), w.deps), { handled: false })
})

test('a subscription for a product Slatebox does not sell still alerts (the old safety net)', async () => {
  const w = world()
  w.put({ id: 'sub_old', customer: 'cus_x', status: 'active', items: { data: [{ price: { product: 'prod_old_pro_8' } }] } })
  const out = await handleBillingEvent(event('customer.subscription.updated', { id: 'sub_old' }), w.deps)
  assert.equal(out.handled, true)
  assert.deepEqual(w.alerts, ['A subscription for an unknown product: sub_old'])
  assert.equal(w.user('u1').pro, undefined)
})

test('a subscription on the old Private product is not Pro and is not handled as an order: it alerts like any unknown product', async () => {
  const w = world()
  const other = { id: 'sub_p', customer: 'cus_p', status: 'active', metadata: { product: 'private', size: 'small' }, items: { data: [otherItem()] } }
  w.put(other)
  const session = { id: 'cs_p', mode: 'subscription', subscription: 'sub_p', customer: 'cus_p', metadata: {} }
  await handleBillingEvent(event('checkout.session.completed', session), w.deps)
  await handleBillingEvent(event('customer.subscription.created', other), w.deps)
  assert.deepEqual(w.alerts, ['A subscription for an unknown product: sub_p', 'A subscription for an unknown product: sub_p'])
  assert.equal(w.user('u1').pro, undefined, 'never anyone\'s Pro')
  // a refund on its customer is not Pro's either: it goes on to the top-up handler
  assert.deepEqual(await handleBillingEvent(event('charge.refunded', { id: 'ch_p', customer: 'cus_p', invoice: 'in_p', amount_refunded: 600000 }), w.deps), { handled: false })
})

// ---------- the pinned API version (Basil and later) ----------
// Basil removed invoice.payment_intent, invoice.charge and charge.invoice. An invoice's payments
// are on invoice.payments (with expand), and the invoice a payment intent paid is found through
// invoicePayments.list. The legacy shapes above stay covered: events keep the API version they
// were made with.

const basilDuplicate = (w, payment) => {
  w.put(sub())
  const second = sub({ id: 'sub_2', created: sec(NOW + 60_000), latest_invoice: 'in_2' })
  w.invoices.set('in_2', {
    id: 'in_2', amount_paid: 500,
    payments: { object: 'list', data: [
      { id: 'inpay_0', invoice: 'in_2', status: 'canceled', amount_paid: null, payment: { type: 'payment_intent', payment_intent: { id: 'pi_failed', object: 'payment_intent' } } },
      { id: 'inpay_1', invoice: 'in_2', status: 'paid', amount_paid: 500, payment },
    ] },
  })
  w.put(second)
  return second
}

test('Basil: the duplicate\'s refund reads the invoice\'s payments and refunds the paid payment intent', async () => {
  const w = world()
  const second = basilDuplicate(w, { type: 'payment_intent', payment_intent: { id: 'pi_2', object: 'payment_intent', latest_charge: 'ch_2' } })
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  w.tick(60_000)
  await handleBillingEvent(event('customer.subscription.created', second, 'evt_2'), w.deps)
  assert.deepEqual(w.invoiceReads, [{ id: 'in_2', params: { expand: ['payments.data.payment.payment_intent'] } }])
  assert.deepEqual(w.refunds.map(r => [r.params.payment_intent, r.params.charge, r.key]), [['pi_2', undefined, 'pro-duplicate:sub_2']])
  assert.equal(w.user('u1').pro.subscriptionId, 'sub_1')
})

test('Basil: a duplicate paid by a bare charge is refunded by the charge', async () => {
  const w = world()
  const second = basilDuplicate(w, { type: 'charge', charge: 'ch_2' })
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  w.tick(60_000)
  await handleBillingEvent(event('customer.subscription.created', second, 'evt_2'), w.deps)
  assert.deepEqual(w.refunds.map(r => [r.params.payment_intent, r.params.charge, r.key]), [[undefined, 'ch_2', 'pro-duplicate:sub_2']])
})

test('Basil: a duplicate whose invoice has no paid payment is cancelled and nothing is refunded', async () => {
  const w = world()
  w.put(sub())
  const second = sub({ id: 'sub_2', created: sec(NOW + 60_000), latest_invoice: 'in_2' })
  w.invoices.set('in_2', { id: 'in_2', amount_paid: 0, payments: { object: 'list', data: [] } })
  w.put(second)
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  w.tick(60_000)
  await handleBillingEvent(event('customer.subscription.created', second, 'evt_2'), w.deps)
  assert.deepEqual(w.cancels.map(c => c.id), ['sub_2'])
  assert.equal(w.refunds.length, 0)
})

test('Basil: a dispute on a Pro payment is found through the invoice payment, not charge.invoice', async () => {
  const w = world()
  w.put(sub())
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  // the pinned API version's charge: no invoice field
  w.charges.set('ch_1', { id: 'ch_1', customer: 'cus_1', payment_intent: 'pi_1' })
  w.invoicePayments.push({ id: 'inpay_1', invoice: 'in_1', status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_1' } })
  assert.equal((await handleBillingEvent(event('charge.dispute.created', { id: 'dp_1', charge: 'ch_1' }), w.deps)).handled, true)
  assert.equal(w.user('u1').pro.hold, 'dispute')
  // a top-up on the same customer (a payment intent no invoice paid) goes on to the top-up handler
  w.charges.set('ch_t', { id: 'ch_t', customer: 'cus_1', payment_intent: 'pi_t' })
  assert.deepEqual(await handleBillingEvent(event('charge.dispute.created', { id: 'dp_t', charge: 'ch_t' }), w.deps), { handled: false })
})

test('Basil: a refunded Pro charge is found through the invoice payment; a top-up refund on the same customer is not Pro\'s', async () => {
  const w = world()
  w.put(sub())
  await handleBillingEvent(event('customer.subscription.created', sub()), w.deps)
  w.invoicePayments.push({ id: 'inpay_9', invoice: 'in_9', status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_9' } })
  const out = await handleBillingEvent(event('charge.refunded', { id: 'ch_9', customer: 'cus_1', payment_intent: 'pi_9', amount_refunded: 500 }), w.deps)
  assert.equal(out.handled, true)
  assert.equal(w.audits.at(-1).type, 'pro-refund')
  assert.deepEqual(await handleBillingEvent(event('charge.refunded', { id: 'ch_t', customer: 'cus_1', payment_intent: 'pi_t', amount_refunded: 1061 }), w.deps), { handled: false })
})

// ---------- in-app pay sheet (lane B): elements sessions, attempt keys, actionNeeded, schedules ----------

const ATTEMPT = '0b9e6a52-8f1d-4c3e-9a7b-2d4f6e8a1c3b'
const ATTEMPT2 = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'

test('elements Pro params: ui_mode elements, return_url with the session id, no success/cancel URLs, no payment_method_types', () => {
  const p = proCheckoutParams({ userId: 'u1', email: 'a@example.test', priceId: 'price_m', baseUrl: 'https://app.slatebox.com', ui: 'elements', now: NOW })
  assert.equal(p.ui_mode, 'elements')
  assert.equal(p.return_url, 'https://app.slatebox.com/profile?tab=credits&pro={CHECKOUT_SESSION_ID}')
  assert.match(p.return_url, /\{CHECKOUT_SESSION_ID\}/)
  assert.equal(p.success_url, undefined)
  assert.equal(p.cancel_url, undefined)
  assert.equal(p.payment_method_types, undefined)
  assert.equal(p.integration_identifier, 'slatebox_pay_sheet')
  assert.deepEqual(p.automatic_tax, { enabled: true })
  assert.equal(p.billing_address_collection, 'auto')
  // no customer yet: nothing to save a card on
  assert.equal(p.saved_payment_method_options, undefined)
  const known = proCheckoutParams({ userId: 'u1', customerId: 'cus_1', priceId: 'price_m', baseUrl: 'x', ui: 'elements', now: NOW })
  assert.deepEqual(known.customer_update, { address: 'auto', name: 'auto' }, 'automatic tax with an existing customer needs customer_update')
  assert.deepEqual(known.saved_payment_method_options, { payment_method_save: 'enabled' })
  // never widened to 'limited': a card saved only for renewals is not offered for other payments
  assert.equal(known.saved_payment_method_options.allow_redisplay_filters, undefined)
})

test('hosted Pro params are unchanged by the sheet', () => {
  const hosted = proCheckoutParams({ userId: 'u1', email: 'a@example.test', priceId: 'price_m', baseUrl: 'https://app.slatebox.com', ui: 'hosted', now: NOW })
  const today = proCheckoutParams({ userId: 'u1', email: 'a@example.test', priceId: 'price_m', baseUrl: 'https://app.slatebox.com', now: NOW })
  assert.deepEqual(hosted, today)
  assert.equal(hosted.ui_mode, undefined)
  assert.equal(hosted.return_url, undefined)
  assert.equal(hosted.integration_identifier, undefined)
})

test('the Pro idempotency key carries the mode and the attempt; a malformed attempt is refused', () => {
  const a = proCheckoutKey('u1', 'month', NOW, { ui: 'elements', attemptId: ATTEMPT })
  assert.equal(a, `pro:u1:month:elements:${ATTEMPT}`)
  assert.notEqual(a, proCheckoutKey('u1', 'month', NOW, { ui: 'hosted', attemptId: ATTEMPT }))
  assert.notEqual(a, proCheckoutKey('u1', 'month', NOW, { ui: 'elements', attemptId: ATTEMPT2 }))
  // the same attempt a minute later (a retried call) is the same key
  assert.equal(a, proCheckoutKey('u1', 'month', NOW + 90_000, { ui: 'elements', attemptId: ATTEMPT }))
  for (const bad of ['', 'x', '0b9e6a52-8f1d-1c3e-9a7b-2d4f6e8a1c3b', ATTEMPT + 'x', 42, {}]) {
    assert.throws(() => proCheckoutKey('u1', 'month', NOW, { ui: 'elements', attemptId: bad }), { error: 'attempt' }, String(bad))
  }
  assert.throws(() => proCheckoutKey('u1', 'month', NOW, { ui: 'sheet', attemptId: ATTEMPT }), { error: 'ui' })
})

test('startProCheckout: elements returns the client secret and session id; hosted returns the URL; inApp off falls back to hosted', async () => {
  const made = []
  const stripe = { checkout: { sessions: { async create(params, opts) {
    made.push({ params, key: opts?.idempotencyKey })
    return { id: 'cs_' + made.length, client_secret: params.ui_mode === 'elements' ? 'cs_secret_' + made.length : null, url: params.ui_mode ? null : 'https://checkout.example/' + made.length }
  } } } }
  const args = { userId: 'u1', email: 'a@example.test', customerId: 'cus_1', price: { id: 'price_m' }, interval: 'month', baseUrl: 'https://app', now: NOW }
  assert.deepEqual(await startProCheckout({ stripe }, { ...args, ui: 'elements', attemptId: ATTEMPT, inApp: true }), { ui: 'elements', clientSecret: 'cs_secret_1', sessionId: 'cs_1' })
  assert.equal(made[0].key, `pro:u1:month:elements:${ATTEMPT}`)
  assert.deepEqual(await startProCheckout({ stripe }, { ...args, ui: 'hosted', attemptId: ATTEMPT, inApp: true }), { ui: 'hosted', url: 'https://checkout.example/2', sessionId: 'cs_2' })
  // the kill switch (public.stripe.inApp false): the same call gets today's redirect
  const off = await startProCheckout({ stripe }, { ...args, ui: 'elements', attemptId: ATTEMPT2, inApp: false })
  assert.equal(off.ui, 'hosted')
  assert.equal(made[2].params.ui_mode, undefined)
  assert.equal(made[2].key, `pro:u1:month:hosted:${ATTEMPT2}`)
  await assert.rejects(startProCheckout({ stripe }, { ...args, ui: 'elements', attemptId: 'nope', inApp: true }), { error: 'attempt' })
  assert.equal(made.length, 3)
})

test('the subscription\'s schedule is part of the state written on every sync', async () => {
  const w = world()
  w.put(sub({ schedule: 'sub_sched_1' }))
  await handleBillingEvent(event('customer.subscription.updated', sub()), w.deps)
  assert.equal(w.user('u1').pro.scheduleId, 'sub_sched_1')
  w.put(sub({ schedule: null }))
  w.tick(1000)
  // a schedule released (or completed or cancelled): the subscription is read again
  const out = await handleBillingEvent(event('subscription_schedule.released', { id: 'sub_sched_1', subscription: null, released_subscription: 'sub_1' }), w.deps)
  assert.equal(out.handled, true)
  assert.equal(w.user('u1').pro.scheduleId, null)
  for (const type of ['subscription_schedule.completed', 'subscription_schedule.canceled']) {
    w.put(sub({ schedule: 'sub_sched_2' }))
    w.tick(1000)
    await handleBillingEvent(event(type, { id: 'sub_sched_2', subscription: 'sub_1' }), w.deps)
    assert.equal(w.user('u1').pro.scheduleId, 'sub_sched_2', type + ' writes what Stripe says now')
  }
  // a schedule for no subscription is not Pro's
  assert.deepEqual(await handleBillingEvent(event('subscription_schedule.canceled', { id: 'sub_sched_x', subscription: null }), w.deps), { handled: false })
})

test('invoice.payment_action_required records actionNeeded for an open invoice; invoice.paid clears it', async () => {
  const w = world()
  w.put(sub({ status: 'past_due' }))
  w.invoices.set('in_7', { id: 'in_7', status: 'open', customer: 'cus_1' })
  await handleBillingEvent(event('invoice.payment_action_required', { id: 'in_7', parent: { subscription_details: { subscription: 'sub_1' } } }), w.deps)
  assert.deepEqual(w.user('u1').pro.actionNeeded, { invoiceId: 'in_7', at: NOW })
  // another invoice's payment does not clear it
  w.tick(1000)
  await handleBillingEvent(event('invoice.paid', { id: 'in_6', subscription: 'sub_1' }), w.deps)
  assert.deepEqual(w.user('u1').pro.actionNeeded, { invoiceId: 'in_7', at: NOW })
  w.put(sub({ status: 'active' }))
  w.tick(1000)
  await handleBillingEvent(event('invoice.paid', { id: 'in_7', subscription: 'sub_1' }), w.deps)
  assert.equal(w.user('u1').pro.actionNeeded, null)
  assert.equal(w.user('u1').pro.status, 'active')
  // out of order: the action-required event arrives after the invoice was paid; the fresh read wins
  w.invoices.set('in_7', { id: 'in_7', status: 'paid', customer: 'cus_1' })
  await handleBillingEvent(event('invoice.payment_action_required', { id: 'in_7', subscription: 'sub_1' }, 'evt_late'), w.deps)
  assert.equal(w.user('u1').pro.actionNeeded, null)
})

test('a pending switch that expires clears actionNeeded and leaves a notice', async () => {
  const w = world()
  w.put(sub())
  w.people.get('u1').pro = { subscriptionId: 'sub_1', customerId: 'cus_1', actionNeeded: { invoiceId: 'in_8', at: NOW - DAY, kind: 'switch' } }
  await handleBillingEvent(event('customer.subscription.pending_update_expired', sub()), w.deps)
  const pro = w.user('u1').pro
  assert.equal(pro.actionNeeded, null)
  assert.equal(pro.switchExpiredAt, NOW)
  assert.equal(pro.interval, 'month', 'the subscription was read again and stays monthly')
})
