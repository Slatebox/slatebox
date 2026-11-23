import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handleSetupEvent } from '../web/app/server/pro-manage.mjs'
import { handleBillingEvent } from '../web/app/server/pro-billing.mjs'
import { handleWalletEvent } from '../web/app/server/wallet-stripe.mjs'

// The card change finishes in the webhook too (design §3.3): a completed setup session with our
// metadata runs the same applyDefaultCard as pro.cardConfirm. Order: Pro, then top-ups, then setup.
const NOW = Date.UTC(2026, 10, 22, 12)
const sec = ms => Math.floor(ms / 1000)

function world({ status = 'active', invoiceStatus = 'open' } = {}) {
  const writes = [], alerts = []
  const sub = { id: 'sub_1', customer: 'cus_1', status, schedule: null, default_payment_method: 'pm_old', latest_invoice: 'in_due', metadata: { product: 'pro', userId: 'u1' }, created: sec(NOW),
    items: { data: [{ id: 'si_1', price: { id: 'price_m', product: 'slatebox_pro', lookup_key: 'pro_monthly_usd_500', recurring: { interval: 'month' } }, current_period_start: sec(NOW), current_period_end: sec(NOW) + 86400 * 30 }] } }
  const customer = { id: 'cus_1', invoice_settings: { default_payment_method: 'pm_old' } }
  const invoice = { id: 'in_due', customer: 'cus_1', status: invoiceStatus }
  const people = new Map([['u1', { _id: 'u1', pro: { subscriptionId: 'sub_1', customerId: 'cus_1', status } }]])
  const stripe = {
    subscriptions: {
      async retrieve() { return structuredClone(sub) },
      async update(id, params) { writes.push(['subscriptions.update', params]); Object.assign(sub, params); return structuredClone(sub) },
    },
    customers: {
      async retrieve() { return structuredClone(customer) },
      async update(id, params) { writes.push(['customers.update', params]); Object.assign(customer, params); return structuredClone(customer) },
    },
    setupIntents: { async retrieve() { return { id: 'seti_1', status: 'succeeded', payment_method: 'pm_new' } } },
    invoices: {
      async retrieve() { return structuredClone(invoice) },
      async pay(id, params) { writes.push(['invoices.pay', id, params]); invoice.status = 'paid'; sub.status = 'active'; return structuredClone(invoice) },
    },
    subscriptionSchedules: { async retrieve() { return null }, async update() { writes.push(['subscriptionSchedules.update']) } },
  }
  const store = {
    async findProUser({ userId, subscriptionId }) { const u = people.get(userId) || [...people.values()].find(p => p.pro.subscriptionId === subscriptionId); return u ? structuredClone(u) : null },
    async writePro(userId, fields) { const u = people.get(userId); u.pro = { ...u.pro, ...structuredClone(fields) }; return true },
    async setProFields(userId, fields) { const u = people.get(userId); u.pro = { ...u.pro, ...structuredClone(fields) } },
    async clearProAction(userId, invoiceId) { const u = people.get(userId); if (u.pro.actionNeeded && (invoiceId == null || u.pro.actionNeeded.invoiceId === invoiceId)) u.pro.actionNeeded = null },
    async setProCustomer() { return true }, async setProHold() {}, async findUserByProCustomer() { return null }, async audit() {},
  }
  const deps = { stripe, store, alert: async t => { alerts.push(t) }, now: () => NOW }
  return { deps, writes, alerts, sub, customer, people, pro: () => people.get('u1').pro }
}
const completed = (over = {}) => ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {
  id: 'cs_card', mode: 'setup', status: 'complete', customer: 'cus_1', setup_intent: 'seti_1', metadata: { userId: 'u1', purpose: 'pro-card' }, ...over,
} } })

test('a setup session completion sets the customer\'s and the subscription\'s default card', async () => {
  const w = world()
  const out = await handleSetupEvent(completed(), w.deps)
  assert.equal(out.handled, true)
  assert.equal(w.customer.invoice_settings.default_payment_method, 'pm_new')
  assert.equal(w.sub.default_payment_method, 'pm_new')
  assert.equal(w.writes.filter(x => x[0] === 'invoices.pay').length, 0, 'nothing is owed')
})

test('with past_due, the open invoice is paid with the new card', async () => {
  const w = world({ status: 'past_due' })
  await handleSetupEvent(completed(), w.deps)
  assert.deepEqual(w.writes.find(x => x[0] === 'invoices.pay'), ['invoices.pay', 'in_due', { payment_method: 'pm_new', off_session: false }])
  assert.equal(w.pro().status, 'active')
})

test('a foreign setup session is ignored, and the Pro and top-up handlers leave setup sessions alone', async () => {
  const w = world()
  assert.deepEqual(await handleSetupEvent(completed({ metadata: {} }), w.deps), { handled: false })
  assert.deepEqual(await handleSetupEvent(completed({ metadata: { purpose: 'something-else', userId: 'u1' } }), w.deps), { handled: false })
  assert.deepEqual(await handleSetupEvent(completed({ mode: 'payment' }), w.deps), { handled: false })
  assert.deepEqual(await handleSetupEvent({ type: 'invoice.paid', data: { object: {} } }, w.deps), { handled: false })
  assert.equal(w.writes.length, 0)
  // a session for a person we do not know (or another customer) changes nothing and alerts
  const lost = await handleSetupEvent(completed({ metadata: { userId: 'ghost', purpose: 'pro-card' } }), w.deps)
  assert.equal(lost.handled, true)
  assert.match(w.alerts.at(-1), /card change/i)
  const theirs = await handleSetupEvent(completed({ customer: 'cus_other' }), w.deps)
  assert.equal(theirs.handled, true)
  assert.equal(w.writes.length, 0)
  // the earlier handlers pass a setup session on
  assert.deepEqual(await handleBillingEvent(completed(), w.deps), { handled: false })
  const io = { now: () => NOW, alert: async () => {} }
  assert.deepEqual(await handleWalletEvent(completed(), io), { handled: false })
})

test('running it twice has no effect', async () => {
  const w = world({ status: 'past_due' })
  await handleSetupEvent(completed(), w.deps)
  const n = w.writes.length
  await handleSetupEvent(completed(), w.deps)
  assert.equal(w.writes.length, n)
})

test('payment_action_required sets actionNeeded and invoice.paid clears it (through the Pro handler)', async () => {
  const w = world({ status: 'past_due' })
  await handleBillingEvent({ type: 'invoice.payment_action_required', data: { object: { id: 'in_due', subscription: 'sub_1' } } }, w.deps)
  assert.deepEqual(w.pro().actionNeeded, { invoiceId: 'in_due', at: NOW })
  await handleBillingEvent({ type: 'invoice.paid', data: { object: { id: 'in_due', subscription: 'sub_1' } } }, w.deps)
  assert.equal(w.pro().actionNeeded, null)
})

test('the webhook dispatches Pro, then top-ups, then setup, and re-reads the setup intent with the session', () => {
  const hooks = readFileSync(new URL('../web/app/server/stripeHooks.js', import.meta.url), 'utf8')
  assert.match(hooks, /handleBilling\(stripeEvent\)[\s\S]*handleWalletEvent\(stripeEvent, walletIo\)[\s\S]*handleSetup\(stripeEvent\)/)
  assert.match(hooks, /expand: \['payment_intent', 'setup_intent'\]/)
})
