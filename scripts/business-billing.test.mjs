import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BUSINESS_COPY, billableMembers, businessCheckoutKey, businessCheckoutParams, businessFromSubscription, businessOnSale, businessPriceIds,
  businessSource, businessSummary, checkBusinessPrice, handleBusinessEvent, isBusinessSubscription, matchBusinessMembers, mayManageBusiness,
  mayWriteBusiness, pricingPageDiffers, setBusinessRenewal, startBusinessCheckout, syncBusinessSubscription,
} from '../web/app/server/business-billing.mjs'
import { businessActive, invitesAgents } from '../web/app/imports/api/business/membership.mjs'
import { PRO_GRACE_MS } from '../web/app/server/pro-billing.mjs'
import { businessSheetPath, loginReturn, payRequestFromQuery } from '../web/app/imports/ui/components/billing/pay/pay-url.mjs'
import { SESSION_ACTIONS, initialSheet, sheetReducer } from '../web/app/imports/ui/components/billing/pay/sheet-machine.mjs'
import { businessChoice, businessFine, moneyIn, sheetHeader, welcomeCopy } from '../web/app/imports/ui/components/billing/pay/pay-copy.mjs'
import { PRICING_URL } from '../web/app/imports/api/common/contact.mjs'

// Slatebox Business bought in the app for a team: price ids from settings, the amount from Stripe,
// quantity = the team's members, organizations.business written from the subscription by the
// webhook. No network: Stripe and Mongo are in memory; nothing is created in a real Stripe account.
const NOW = Date.UTC(2026, 10, 24, 12)
const DAY = 86_400_000
const sec = ms => Math.floor(ms / 1000)
const IDS = { month: 'price_biz_month', year: 'price_biz_year' }
const SETTINGS = { payments: { business: { monthly: IDS.month, yearly: IDS.year } } }
const ATTEMPT = '1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b'

const bizPrice = (interval = 'month', more = {}) => ({
  id: IDS[interval], object: 'price', active: true, type: 'recurring', billing_scheme: 'per_unit', currency: 'usd',
  unit_amount: interval === 'year' ? 6000 : 600, recurring: { interval, interval_count: 1, usage_type: 'licensed' }, ...more,
})
const bizSub = (id, { orgId = 'org1', status = 'active', quantity = 3, interval = 'month', created = NOW, end = NOW + 30 * DAY, more = {} } = {}) => ({
  id, object: 'subscription', status, customer: 'cus_team', created: sec(created), cancel_at_period_end: false,
  metadata: { product: 'business', orgId, userId: 'u1' },
  items: { data: [{ id: 'si_' + id, quantity, price: bizPrice(interval), current_period_start: sec(created), current_period_end: sec(end) }] },
  latest_invoice: 'in_' + id,
  ...more,
})

function world({ orgs = [{ _id: 'org1' }], members = { org1: 3 } } = {}) {
  const subs = new Map(), sessions = [], updates = [], cancels = [], refunds = [], alerts = [], audits = []
  const teams = new Map(orgs.map(o => [o._id, structuredClone(o)]))
  let clock = NOW
  const stripe = {
    subscriptions: {
      async retrieve(id) { if (!subs.has(id)) throw Object.assign(new Error('No such subscription'), { statusCode: 404 }); return structuredClone(subs.get(id)) },
      async update(id, params, opts) {
        updates.push({ id, params, key: opts?.idempotencyKey })
        const sub = subs.get(id)
        if (params.items) sub.items.data[0].quantity = params.items[0].quantity
        if ('cancel_at_period_end' in params) sub.cancel_at_period_end = params.cancel_at_period_end
        return structuredClone(sub)
      },
      async cancel(id, params, opts) {
        cancels.push({ id, params, key: opts?.idempotencyKey })
        Object.assign(subs.get(id), { status: 'canceled', ended_at: sec(clock) })
        return structuredClone(subs.get(id))
      },
    },
    checkout: { sessions: { async create(params, opts) { sessions.push({ params, key: opts?.idempotencyKey }); return { id: 'cs_test_' + sessions.length, client_secret: 'cs_secret_' + sessions.length, url: 'https://pay.example/' + sessions.length } } } },
    invoices: { async retrieve(id) { return { id, amount_paid: 1800, payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_' + id } }] } } } },
    refunds: { async create(params, opts) { refunds.push({ params, key: opts?.idempotencyKey }); return { id: 're_' + refunds.length } } },
    charges: { async retrieve(id) { return { id, customer: 'cus_team', invoice: 'in_x' } } },
  }
  const store = {
    async findOrg({ orgId, subscriptionId, customerId }) {
      const all = [...teams.values()]
      const hit = (subscriptionId && all.find(o => o.business?.subscriptionId === subscriptionId))
        || (orgId && teams.get(orgId)) || (customerId && all.find(o => o.business?.customerId === customerId))
      return hit ? structuredClone(hit) : null
    },
    async writeBusiness(orgId, fields, fetchedAt) {
      const org = teams.get(orgId)
      if (!org || !mayWriteBusiness(org.business, fetchedAt, clock)) return false
      org.business = structuredClone(fields)
      return true
    },
    async countMembers(orgId) { return members[orgId] ?? 1 },
    async audit(entry) { audits.push(entry) },
  }
  const deps = { stripe, store, alert: async text => { alerts.push(text) }, now: () => clock, priceIds: IDS }
  return { deps, subs, sessions, updates, cancels, refunds, alerts, audits, teams, members, tick: ms => { clock += ms } }
}

// ---------- settings and prices ----------

test('on sale only where settings name both Stripe prices; otherwise "Talk to us" as before', () => {
  assert.deepEqual(businessPriceIds(SETTINGS), IDS)
  assert.equal(businessOnSale(SETTINGS), true)
  for (const settings of [{}, null, { payments: { business: { monthly: IDS.month } } }, { payments: { business: { monthly: 'prod_x', yearly: IDS.year } } }, { payments: { business: { monthly: '', yearly: '' } } }]) {
    assert.equal(businessOnSale(settings), false)
  }
})

test('a price must be recurring at its interval, per member and active; its amount is whatever Stripe says', () => {
  assert.equal(checkBusinessPrice(bizPrice('month'), 'month'), null)
  assert.equal(checkBusinessPrice(bizPrice('year', { unit_amount: 7200 }), 'year'), null, 'a new amount is sold as Stripe has it')
  assert.equal(checkBusinessPrice(null, 'month'), 'missing')
  assert.equal(checkBusinessPrice(bizPrice('month'), 'year'), 'interval')
  assert.equal(checkBusinessPrice(bizPrice('month', { active: false }), 'month'), 'inactive')
  assert.equal(checkBusinessPrice(bizPrice('month', { billing_scheme: 'tiered' }), 'month'), 'scheme')
  assert.equal(checkBusinessPrice(bizPrice('month', { recurring: { interval: 'month', usage_type: 'metered' } }), 'month'), 'usage')
  assert.equal(checkBusinessPrice(bizPrice('month', { type: 'one_time' }), 'month'), 'not recurring')
  assert.equal(checkBusinessPrice(bizPrice('month', { unit_amount: null }), 'month'), 'amount')
  // differing from the pricing page's figure alerts (to fix the page) but never refuses
  assert.equal(pricingPageDiffers(bizPrice('month'), 'month'), false)
  assert.equal(pricingPageDiffers(bizPrice('month', { unit_amount: 700 }), 'month'), true)
})

test('members billed: accounts of their own, never guests or imports not yet invited; at least one', () => {
  assert.equal(billableMembers([{ emails: [{ address: 'a@x.test' }] }, { emails: [{ address: 'b@x.test' }] }, { isAnonymous: true, emails: [{ address: 'g@x.test' }] }, { emails: [] }, {}]), 2)
  assert.equal(billableMembers([]), 1)
})

test('only the team owner or an admin buys or changes Business', () => {
  assert.equal(mayManageBusiness({ user: { orgId: 'o', isOrgOwner: true }, admin: false }), true)
  assert.equal(mayManageBusiness({ user: { orgId: 'o' }, admin: true }), true)
  assert.equal(mayManageBusiness({ user: { orgId: 'o' }, admin: false }), false)
  assert.equal(mayManageBusiness({ user: { isOrgOwner: true }, admin: true }), false, 'no team, nothing to buy')
})

// ---------- checkout ----------

test('the checkout is the team\'s members at the price per member, with the team in the metadata, tax by Stripe Tax', async () => {
  const w = world()
  const answer = await startBusinessCheckout(w.deps, {
    orgId: 'org1', userId: 'u1', email: 'owner@x.test', price: bizPrice('year'), interval: 'year', members: 3,
    baseUrl: 'https://app.example', ui: 'elements', attemptId: ATTEMPT, inApp: true, now: NOW,
  })
  assert.deepEqual(answer, { ui: 'elements', clientSecret: 'cs_secret_1', sessionId: 'cs_test_1' })
  const { params, key } = w.sessions[0]
  assert.deepEqual(params.line_items, [{ price: IDS.year, quantity: 3 }])
  assert.equal(params.mode, 'subscription')
  assert.equal(params.ui_mode, 'elements')
  assert.deepEqual(params.metadata, { product: 'business', orgId: 'org1', userId: 'u1' })
  assert.deepEqual(params.subscription_data.metadata, params.metadata)
  assert.equal(params.client_reference_id, 'org1')
  assert.equal(params.customer_email, 'owner@x.test')
  assert.deepEqual(params.automatic_tax, { enabled: true })
  assert.equal(params.return_url, 'https://app.example/team?business={CHECKOUT_SESSION_ID}')
  assert.equal(key, `business:org1:year:3:elements:${ATTEMPT}`)
  // in-app payments off: the hosted page, back to the team page
  await startBusinessCheckout(w.deps, { orgId: 'org1', userId: 'u1', email: 'o@x.test', customerId: 'cus_team', price: bizPrice('month'), interval: 'month', members: 2, baseUrl: 'https://app.example', ui: 'elements', attemptId: ATTEMPT, inApp: false, now: NOW })
  const hosted = w.sessions[1].params
  assert.equal(hosted.ui_mode, undefined)
  assert.equal(hosted.success_url, 'https://app.example/team?business={CHECKOUT_SESSION_ID}')
  assert.equal(hosted.cancel_url, 'https://app.example/team')
  assert.equal(hosted.customer, 'cus_team')
  assert.equal(hosted.customer_email, undefined)
  // the attempt and the member count are in the key: a changed team makes a new session
  assert.notEqual(businessCheckoutKey('org1', 'month', 3, NOW, { attemptId: ATTEMPT }), businessCheckoutKey('org1', 'month', 4, NOW, { attemptId: ATTEMPT }))
  assert.throws(() => businessCheckoutKey('org1', 'month', 3, NOW, { attemptId: 'nope' }))
})

// ---------- the webhook writes organizations.business ----------

test('a paid checkout turns Business on for the team, from the subscription as read, and the existing gates see it', async () => {
  const w = world()
  w.subs.set('sub_b1', bizSub('sub_b1'))
  const out = await handleBusinessEvent({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_b1', metadata: { product: 'business', orgId: 'org1' }, client_reference_id: 'org1' } } }, w.deps)
  assert.equal(out.handled, true)
  const org = w.teams.get('org1')
  assert.equal(org.business.status, 'active')
  assert.equal(org.business.source, 'stripe')
  assert.equal(org.business.members, 3)
  assert.equal(org.business.until, NOW + 30 * DAY + PRO_GRACE_MS)
  assert.equal(businessActive(org, NOW), true)
  assert.equal(invitesAgents({ pro: false, org }, NOW), true, 'Business counts as Pro for inviting outside agents')
  assert.equal(businessActive(org, NOW + 30 * DAY + PRO_GRACE_MS + 1), false, 'a missed renewal ends it after the grace')
  assert.deepEqual(w.updates, [], 'the quantity already matches the members')
})

test('Pro, top-ups and other products are left to their own handlers', async () => {
  const w = world()
  w.subs.set('sub_pro', { id: 'sub_pro', status: 'active', metadata: { product: 'pro' }, items: { data: [{ price: { id: 'price_pro', product: 'slatebox_pro' } }] } })
  assert.equal((await handleBusinessEvent({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_pro', metadata: { product: 'pro' } } } }, w.deps)).handled, false)
  assert.equal((await handleBusinessEvent({ type: 'checkout.session.completed', data: { object: { mode: 'payment', metadata: { product: 'topup' } } } }, w.deps)).handled, false)
  assert.equal((await handleBusinessEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_pro', metadata: { product: 'pro' }, items: { data: [] } } } }, w.deps)).handled, false)
  assert.equal((await handleBusinessEvent({ type: 'invoice.paid', data: { object: { subscription: 'sub_pro' } } }, w.deps)).handled, false)
  assert.equal((await handleBusinessEvent({ type: 'payment_intent.succeeded', data: { object: {} } }, w.deps)).handled, false)
  assert.equal(w.teams.get('org1').business, undefined)
  // a subscription with a configured Business price counts even without the metadata
  assert.equal(isBusinessSubscription({ metadata: {}, items: { data: [{ price: { id: IDS.month } }] } }, IDS), true)
})

test('renewal, past due and the end all follow Stripe; an older read never replaces a newer one', async () => {
  const w = world()
  w.subs.set('sub_b1', bizSub('sub_b1'))
  await syncBusinessSubscription(w.deps, 'sub_b1', { orgId: 'org1' })
  // a late read taken before the stored one is dropped
  const stale = businessFromSubscription(bizSub('sub_b1', { status: 'past_due' }), NOW - 1000)
  assert.equal(await w.deps.store.writeBusiness('org1', stale, NOW - 1000), false)
  assert.equal(w.teams.get('org1').business.status, 'active')
  w.tick(1000)
  w.subs.get('sub_b1').status = 'past_due'
  await handleBusinessEvent({ type: 'invoice.payment_failed', data: { object: { parent: { subscription_details: { subscription: 'sub_b1' } } } } }, w.deps)
  assert.equal(w.teams.get('org1').business.status, 'past_due')
  assert.equal(businessActive(w.teams.get('org1'), NOW), false)
  assert.equal(businessSummary(w.teams.get('org1'), NOW).pastDue, true)
  w.tick(1000)
  Object.assign(w.subs.get('sub_b1'), { status: 'canceled', ended_at: sec(NOW + 2000) })
  await handleBusinessEvent({ type: 'customer.subscription.deleted', data: { object: w.subs.get('sub_b1') } }, w.deps)
  assert.equal(w.teams.get('org1').business.status, 'ended')
  assert.equal(businessSource(w.teams.get('org1'), NOW), 'none', 'the team may buy again')
})

test('a staff-written contract is kept: never overwritten by a subscription, and checkout is refused for it', async () => {
  const contract = { status: 'active', until: NOW + 90 * DAY }
  const w = world({ orgs: [{ _id: 'org1', business: contract }] })
  assert.equal(businessSource(w.teams.get('org1'), NOW), 'contract')
  assert.deepEqual(businessSummary(w.teams.get('org1'), NOW), { active: true, source: 'contract', until: NOW + 90 * DAY })
  w.subs.set('sub_b1', bizSub('sub_b1'))
  const out = await syncBusinessSubscription(w.deps, 'sub_b1', { orgId: 'org1' })
  assert.equal(out.ignored, 'contract')
  assert.deepEqual(w.teams.get('org1').business, contract)
  assert.match(w.alerts.join('\n'), /contract stays/)
  // an ended contract may be replaced by a purchase
  assert.equal(mayWriteBusiness({ status: 'active', until: NOW - 1 }, NOW, NOW), true)
  assert.equal(mayWriteBusiness({ status: 'ended' }, NOW, NOW), true)
  assert.equal(mayWriteBusiness(contract, NOW, NOW), false)
  assert.equal(mayWriteBusiness(null, NOW, NOW), true)
})

test('two admins paying at once: the later subscription is cancelled and refunded, the first stays', async () => {
  const w = world()
  w.subs.set('sub_first', bizSub('sub_first', { created: NOW }))
  w.subs.set('sub_second', bizSub('sub_second', { created: NOW + 5000 }))
  await syncBusinessSubscription(w.deps, 'sub_first', { orgId: 'org1' })
  w.tick(10_000)
  const out = await syncBusinessSubscription(w.deps, 'sub_second', { orgId: 'org1' })
  assert.equal(out.duplicate, 'sub_second')
  assert.deepEqual(w.cancels.map(c => [c.id, c.params.prorate]), [['sub_second', false]])
  assert.deepEqual(w.refunds.map(r => r.params.payment_intent), ['pi_in_sub_second'])
  assert.equal(w.teams.get('org1').business.subscriptionId, 'sub_first')
})

// ---------- members change the quantity, prorated ----------

test('adding or removing a member changes the subscription\'s quantity, prorated, and the webhook records it', async () => {
  const w = world({ members: { org1: 3 } })
  w.subs.set('sub_b1', bizSub('sub_b1', { quantity: 3 }))
  await syncBusinessSubscription(w.deps, 'sub_b1', { orgId: 'org1' })
  assert.deepEqual(await matchBusinessMembers(w.deps, 'org1'), { changed: false })
  w.members.org1 = 5
  assert.deepEqual(await matchBusinessMembers(w.deps, 'org1'), { changed: true, from: 3, to: 5 })
  assert.deepEqual(w.updates[0].params, { items: [{ id: 'si_sub_b1', quantity: 5 }], proration_behavior: 'create_prorations' })
  assert.match(w.updates[0].key, /^business-members:sub_b1:3:5:/)
  // Stripe's update event: the new quantity is written, and nothing more is changed
  w.tick(1000)
  await handleBusinessEvent({ type: 'customer.subscription.updated', data: { object: w.subs.get('sub_b1') } }, w.deps)
  assert.equal(w.teams.get('org1').business.members, 5)
  assert.equal(w.updates.length, 1)
  // a removal brings it down; a member count that cannot be read changes nothing
  w.members.org1 = 4
  await handleBusinessEvent({ type: 'invoice.upcoming', data: { object: { subscription: 'sub_b1' } } }, w.deps)
  assert.equal(w.updates[1].params.items[0].quantity, 4)
  // an ended subscription is never changed
  w.tick(1000)
  Object.assign(w.subs.get('sub_b1'), { status: 'canceled' })
  await syncBusinessSubscription(w.deps, 'sub_b1')
  w.members.org1 = 9
  assert.deepEqual(await matchBusinessMembers(w.deps, 'org1'), { changed: false })
})

test('a team without Stripe billing (none, or a contract) is never touched by the member count', async () => {
  const w = world({ orgs: [{ _id: 'org1' }, { _id: 'org2', business: { status: 'active' } }], members: { org1: 4, org2: 7 } })
  assert.deepEqual(await matchBusinessMembers(w.deps, 'org1'), { changed: false })
  assert.deepEqual(await matchBusinessMembers(w.deps, 'org2'), { changed: false })
  assert.deepEqual(w.updates, [])
})

// ---------- managing it ----------

test('stop renewing and keep Business: the team keeps it to the period end', async () => {
  const w = world()
  w.subs.set('sub_b1', bizSub('sub_b1'))
  await syncBusinessSubscription(w.deps, 'sub_b1', { orgId: 'org1' })
  w.tick(1000)
  const org = await w.deps.store.findOrg({ orgId: 'org1' })
  assert.deepEqual(await setBusinessRenewal(w.deps, { org, renew: false, attemptId: ATTEMPT }), { cancelAtPeriodEnd: true })
  assert.equal(w.updates[0].key, `business-renewal:sub_b1:stop:${ATTEMPT}`)
  const summary = businessSummary(w.teams.get('org1'), NOW)
  assert.equal(summary.active, true)
  assert.equal(summary.endsOn, new Date(NOW + 30 * DAY).toISOString())
  assert.equal(summary.renewsOn, null)
  w.tick(1000)
  await setBusinessRenewal(w.deps, { org: await w.deps.store.findOrg({ orgId: 'org1' }), renew: true, attemptId: ATTEMPT })
  assert.equal(businessSummary(w.teams.get('org1'), NOW).renewsOn, new Date(NOW + 30 * DAY).toISOString())
  await assert.rejects(setBusinessRenewal(w.deps, { org: { _id: 'org9', business: { status: 'active' } }, renew: false }), { error: 'business-none' })
})

test('Business refunds and disputes alert the owner and are not taken by the top-up handler', async () => {
  const w = world({ orgs: [{ _id: 'org1', business: { source: 'stripe', customerId: 'cus_team', stripeStatus: 'active', status: 'active' } }] })
  const out = await handleBusinessEvent({ type: 'charge.refunded', data: { object: { id: 'ch_1', customer: 'cus_team', invoice: 'in_1' } } }, w.deps)
  assert.equal(out.handled, true)
  assert.match(w.alerts[0], /Slatebox Business payment had a refund/)
  assert.equal((await handleBusinessEvent({ type: 'charge.refunded', data: { object: { id: 'ch_2', customer: 'cus_other', invoice: 'in_2' } } }, w.deps)).handled, false)
})

// ---------- the sheet and its links ----------

test('the sheet opens Business from /business?plan= and ?pay=business, and comes back with ?business=cs_', () => {
  const q = s => new URLSearchParams(s)
  assert.equal(businessSheetPath(q('plan=yearly')), '/team?pay=business&plan=yearly')
  assert.equal(businessSheetPath(q('')), '/team?pay=business&plan=monthly')
  assert.deepEqual(payRequestFromQuery(q('pay=business&plan=yearly')), { open: { action: 'business', wallet: null, from: 'site', choice: { interval: 'year' } } })
  assert.deepEqual(payRequestFromQuery(q('pay=business')), { open: { action: 'business', wallet: null, from: 'profile' } })
  assert.deepEqual(payRequestFromQuery(q('business=cs_test_z9')), { back: { kind: 'business', sessionId: 'cs_test_z9' } })
  assert.equal(loginReturn(q('pay=business')), '/team?pay=business')
  assert.ok(SESSION_ACTIONS.includes('business'))
  const opened = sheetReducer(initialSheet, { type: 'open', request: { action: 'business' }, attemptId: ATTEMPT, choice: { interval: 'month' }, inApp: true })
  assert.equal(opened.stage, 'preparing')
})

test('the sheet\'s words show the amount the server read, never one written in the app, and link the pricing page', () => {
  const choice = businessChoice({ interval: 'month', unitAmount: 650, currency: 'usd' }, 4)
  assert.deepEqual(choice, { label: '$6.50 per person a month', sub: '$26 a month for 4 people', line: 'Slatebox Business, monthly × 4 people', totalCents: 2600 })
  assert.equal(businessChoice({ interval: 'year', unitAmount: 6000, currency: 'eur' }, 1).label, '€60 per person a year')
  assert.equal(moneyIn(600, 'usd'), '$6')
  assert.equal(sheetHeader({ action: 'business' }).title, 'Get Slatebox Business for your team')
  assert.equal(welcomeCopy({ kind: 'business', confirmed: true }).title, 'Welcome to Slatebox Business')
  assert.match(welcomeCopy({ kind: 'business', variant: 'pending' }).lead, /Business switches on/)
  assert.doesNotMatch(businessFine('year'), /\$|\d/)
  assert.equal(PRICING_URL, 'https://slatebox.com/plans/')
  // no Business amount in any file the app shows it from
  const app = new URL('../web/app/', import.meta.url).pathname
  for (const file of ['imports/ui/components/billing/pay/BusinessPane.jsx', 'imports/ui/components/teams/BusinessPanel.jsx', 'imports/ui/components/billing/ProPanel.jsx', 'imports/ui/components/billing/pay/pay-copy.mjs', 'server/methods/business.js', 'server/business-billing.mjs']) {
    const text = readFileSync(app + file, 'utf8')
    assert.doesNotMatch(text, /\$6\b|\$60\b|\$6 per|\$60 per/, file)
  }
  // the pricing page's figures are read only to alert when Stripe differs (pricingPageDiffers), never shown
  for (const file of ['imports/ui/components/billing/pay/BusinessPane.jsx', 'imports/ui/components/teams/BusinessPanel.jsx', 'imports/ui/components/billing/pay/pay-copy.mjs', 'server/methods/business.js']) {
    assert.doesNotMatch(readFileSync(app + file, 'utf8'), /BUSINESS_PRICES|unitAmountPerSeat/, file)
  }
  assert.match(readFileSync(app + 'imports/ui/components/teams/BusinessPanel.jsx', 'utf8'), /See pricing/)
  assert.match(readFileSync(app + 'imports/ui/components/billing/ProPanel.jsx', 'utf8'), /PRICING_URL/)
})

test('the refusals say what to do', () => {
  for (const text of Object.values(BUSINESS_COPY)) assert.match(text, /\.$/)
  assert.match(BUSINESS_COPY.notOnSale, /Talk to us/)
})
