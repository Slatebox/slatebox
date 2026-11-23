import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkoutParams, assertUsableStripeKey, handleWalletEvent, refundWallet, removeAccountAfterRefund, startTopUp, topUpKey, topUpQuote,
} from '../web/app/server/wallet-stripe.mjs'
import { TOP_UP_AMOUNTS, cardFeeMode } from '../web/app/imports/api/billing/top-up.mjs'
import { readFileSync } from 'node:fs'
import { emptyWallet } from '../web/app/server/metering/ledger.mjs'
import { guardsPass } from '../web/app/server/metering/holds.mjs'
import { DEFAULT_METERING } from '../web/app/server/metering/policy.mjs'

// Owner decision 2026-11-22 (design §13.6): the card fee is no longer a separate surcharge line. The
// setting topUp.cardFee is 'included' (default: one line, the price that nets the balance after
// fees, "includes processing") or 'absorb' (the balance's own amount). These two tests replaced
// the earlier "balance line + Card fee line" expectations, which described the surcharge.
test('checkout is a one-time payment with one balance line that includes processing, metadata and return URLs', () => {
  const p = checkoutParams({ walletId: 'user:p1', ledgerKey: 'topup:abc', amountCents: 1000, baseUrl: 'http://localhost:3471', email: 'p@example.test' })
  assert.equal(p.mode, 'payment')
  assert.deepEqual(p.line_items.map(l => [l.price_data.product_data.name, l.price_data.product_data.description, l.price_data.unit_amount, l.quantity]), [
    ['Slatebox balance', 'Includes processing', 1061, 1],
  ])
  assert.ok(p.line_items.every(l => l.price_data.currency === 'usd'))
  assert.ok(!JSON.stringify(p.line_items).match(/card fee/i), 'no surcharge line')
  assert.deepEqual(p.metadata, { walletId: 'user:p1', ledgerKey: 'topup:abc', balanceCents: '1000' })
  assert.deepEqual(p.payment_intent_data.metadata, p.metadata)
  // Profile → Credits (Slatebox Pro, balance, own keys)
  assert.equal(p.success_url, 'http://localhost:3471/profile?tab=credits&topup={CHECKOUT_SESSION_ID}')
  assert.equal(p.cancel_url, 'http://localhost:3471/profile?tab=credits')
  assert.equal(p.customer_email, 'p@example.test')
  assert.equal(p.subscription_data, undefined)
  assert.equal(p.automatic_tax, undefined, 'top-ups carry no tax (owner decision)')
  // absorb: the person pays the balance's own amount
  const absorbed = checkoutParams({ walletId: 'user:p1', ledgerKey: 'k', amountCents: 1000, baseUrl: 'x', cardFee: 'absorb' })
  assert.deepEqual(absorbed.line_items.map(l => [l.price_data.product_data.name, l.price_data.product_data.description, l.price_data.unit_amount]), [['Slatebox balance', undefined, 1000]])
  // an unknown setting value is the default, never a surcharge
  assert.equal(checkoutParams({ walletId: 'user:p1', ledgerKey: 'k', amountCents: 1000, baseUrl: 'x', cardFee: 'line' }).line_items[0].price_data.unit_amount, 1061)
})

test('the top-up quote is the exact sentence shown before payment', () => {
  const q = topUpQuote(1000, 5)
  assert.equal(q.totalCents, 1061)
  assert.equal(q.feeCents, 61)
  assert.equal(q.cardFee, 'included')
  assert.equal(q.label, 'Top up $10')
  assert.equal(q.note, 'includes processing')
  assert.equal(q.text, 'You pay $10.61 for $10.00 of balance; the price includes processing. Balance is spent at the provider\'s price plus 5%. It never expires, and we refund what is left when you ask.')
  assert.equal(q.button, 'Pay $10.61')
  const a = topUpQuote(1000, 5, 'absorb')
  assert.deepEqual([a.totalCents, a.feeCents, a.note, a.button], [1000, 0, null, 'Pay $10.00'])
  assert.equal(a.text, 'You pay $10.00 for $10.00 of balance. Balance is spent at the provider\'s price plus 5%. It never expires, and we refund what is left when you ask.')
  assert.doesNotMatch(q.text + a.text, /card fee/i)
})

test('a live key is refused outside production', () => {
  assert.throws(() => assertUsableStripeKey('sk_live_x', 'dev'), /live Stripe key/)
  assert.throws(() => assertUsableStripeKey('rk_live_x', 'test'), /live Stripe key/)
  assert.doesNotThrow(() => assertUsableStripeKey('sk_live_x', 'prod'))
  assert.doesNotThrow(() => assertUsableStripeKey('sk_test_x', 'dev'))
  assert.throws(() => assertUsableStripeKey('', 'dev'), /not configured/)
})

function io() {
  const ledger = [], wallets = new Map([['user:p1', { ...emptyWallet() }]]), alerts = [], refundsBySlatebox = new Set()
  return {
    ledger, wallets, alerts, refundsBySlatebox,
    async hasLedger(key) { return ledger.some(e => e.idempotencyKey === key) },
    async appendLedger(entry) { if (await this.hasLedger(entry.idempotencyKey)) return false; ledger.push(entry); return true },
    async readWallet(walletId) { return wallets.get(walletId) || null },
    // the same write as wallet.js: limits, and the session not yet settled, then credited and marked
    async creditWalletIf(walletId, { inc, guards, now, settle }) {
      const w = wallets.get(walletId) || emptyWallet()
      if (!guardsPass(w, guards) || w.settledTopUps?.[settle]) return false
      const next = { ...w, firstTopUpAt: w.firstTopUpAt ?? now, settledTopUps: { ...w.settledTopUps, [settle]: 'credited' } }
      for (const [k, v] of Object.entries(inc)) next[k] = (next[k] || 0) + v
      wallets.set(walletId, next)
      return true
    },
    async refuseTopUpIf(walletId, id) {
      const w = wallets.get(walletId) || emptyWallet()
      if (w.settledTopUps?.[id]) return false
      wallets.set(walletId, { ...w, settledTopUps: { ...w.settledTopUps, [id]: 'refused' } })
      return true
    },
    async refundPayment() { throw new Error('no refund expected') },
    settings: async () => DEFAULT_METERING,
    async debitWallet(walletId, amountMicros) {
      const w = wallets.get(walletId)
      const d = Math.min(w.balanceMicros, amountMicros)
      wallets.set(walletId, { ...w, balanceMicros: w.balanceMicros - d, refundableMicros: Math.max(0, w.refundableMicros - d) })
      return d
    },
    async freezeWallet(walletId) { wallets.set(walletId, { ...wallets.get(walletId), frozen: true }) },
    async walletForCharge(chargeId) { return ledger.find(e => e.stripe?.chargeId === chargeId)?.walletId || null },
    async isSlateboxRefund(refundId) { return refundsBySlatebox.has(refundId) },
    async alert(text) { alerts.push(text) },
    now: () => 1000,
  }
}
const completed = (id = 'cs_1') => ({ id: 'evt_' + id, type: 'checkout.session.completed', data: { object: {
  id, mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', metadata: { walletId: 'user:p1', ledgerKey: 'topup:abc', balanceCents: '1000' },
} } })

test('a paid checkout credits the wallet once, keyed on the session id', async () => {
  const x = io()
  await handleWalletEvent(completed(), x)
  await handleWalletEvent(completed(), x)
  assert.equal(x.ledger.length, 1)
  assert.equal(x.ledger[0].type, 'topup')
  assert.equal(x.ledger[0].idempotencyKey, 'topup:cs_1')
  assert.equal(x.wallets.get('user:p1').balanceMicros, 10_000_000)
  assert.equal(x.wallets.get('user:p1').refundableMicros, 10_000_000)
  const unpaid = completed('cs_2'); unpaid.data.object.payment_status = 'unpaid'
  await handleWalletEvent(unpaid, x)
  const sub = completed('cs_3'); sub.data.object.mode = 'subscription'
  await handleWalletEvent(sub, x)
  assert.equal(x.ledger.length, 1)
})

test('a refund made outside Slatebox debits the wallet; a dispute freezes it and alerts', async () => {
  const x = io()
  await handleWalletEvent(completed(), x)
  x.ledger[0].stripe.chargeId = 'ch_1'
  const refunded = { id: 'evt_r', type: 'charge.refunded', data: { object: { id: 'ch_1', refunds: { data: [{ id: 're_ext', amount: 400 }] } } } }
  await handleWalletEvent(refunded, x)
  assert.equal(x.wallets.get('user:p1').balanceMicros, 6_000_000)
  x.refundsBySlatebox.add('re_own')
  await handleWalletEvent({ id: 'evt_o', type: 'charge.refunded', data: { object: { id: 'ch_1', refunds: { data: [{ id: 're_own', amount: 100 }] } } } }, x)
  assert.equal(x.wallets.get('user:p1').balanceMicros, 6_000_000, 'our own refund is already in the ledger')
  await handleWalletEvent({ id: 'evt_d', type: 'charge.dispute.created', data: { object: { charge: 'ch_1', id: 'dp_1' } } }, x)
  assert.equal(x.wallets.get('user:p1').frozen, true)
  assert.match(x.alerts.at(-1), /dispute/i)
})

// Slatebox Pro and Private take their subscription events first (pro-billing.mjs handleBillingEvent,
// tested in pro-billing.test.mjs); a subscription event that reaches the top-up handler is for a
// product Slatebox does not sell, so it only alerts and never touches a balance.
test('a subscription event for an unknown product only alerts', async () => {
  const x = io()
  for (const type of ['invoice.paid', 'customer.subscription.updated']) {
    await handleWalletEvent({ id: 'e', type, data: { object: { id: 'in_1', subscription: 'sub_9' } } }, x)
  }
  assert.equal(x.ledger.length, 0)
  assert.equal(x.alerts.length, 2)
  assert.equal(x.alerts[0], 'A subscription for an unknown product: sub_9')
})

test('a refund request refunds newest charges first with idempotency keys and removes the non-refundable rest', async () => {
  const created = []
  const stripe = { refunds: { async create(params, options) { created.push({ params, options }); return { id: 're_' + created.length } } } }
  const entries = []
  const result = await refundWallet({
    stripe, walletId: 'user:p1', requestId: 'r1',
    wallet: { ...emptyWallet(), balanceMicros: 15_000_000, refundableMicros: 10_000_000 },
    charges: [{ chargeId: 'ch_a', amountCents: 2500, refundedCents: 0, created: 1 }, { chargeId: 'ch_b', amountCents: 500, refundedCents: 0, created: 2 }],
    append: async e => entries.push(e),
  })
  assert.deepEqual(created.map(c => [c.params.charge, c.params.amount, c.options.idempotencyKey]), [
    ['ch_b', 500, 'refund:user:p1:r1:ch_b'], ['ch_a', 500, 'refund:user:p1:r1:ch_a'],
  ])
  assert.equal(result.refundedCents, 1000)
  assert.deepEqual(entries.map(e => [e.type, e.amountMicros]), [['refund', -5_000_000], ['refund', -5_000_000], ['adjustment', -5_000_000]])
})

test('removing an account refunds first and stops when the refund fails', async () => {
  const removed = []
  await removeAccountAfterRefund({ refund: async () => ({ refundedCents: 500 }), remove: async () => removed.push(1) })
  assert.equal(removed.length, 1)
  await assert.rejects(
    removeAccountAfterRefund({ refund: async () => { throw new Error('card gone') }, remove: async () => removed.push(2) }),
    { message: 'We could not refund your balance. Nothing was removed. Try again or write to us at https://slatebox.com/contact/?topic=billing.' },
  )
  assert.equal(removed.length, 1)
})

test('removing an account: refund, then end Pro, then remove; a failed refund never ends Pro', async () => {
  const steps = []
  await removeAccountAfterRefund({
    refund: async () => { steps.push('refund') }, endPro: async () => { steps.push('end-pro') }, remove: async () => { steps.push('remove') },
  })
  assert.deepEqual(steps, ['refund', 'end-pro', 'remove'])
  steps.length = 0
  await assert.rejects(removeAccountAfterRefund({
    refund: async () => { throw new Error('card gone') }, endPro: async () => { steps.push('end-pro') }, remove: async () => { steps.push('remove') },
  }), { error: 'refund-failed' })
  assert.deepEqual(steps, [], 'Pro is still on and nothing is removed')
  // ending Pro fails: its own error, and the account is kept
  await assert.rejects(removeAccountAfterRefund({
    refund: async () => { steps.push('refund') }, endPro: async () => { throw Object.assign(new Error('pro'), { error: 'pro-end-failed' }) }, remove: async () => { steps.push('remove') },
  }), { error: 'pro-end-failed' })
  assert.deepEqual(steps, ['refund'])
})

// ---------- in-app pay sheet (lane B) ----------

const ATTEMPT = '0b9e6a52-8f1d-4c3e-9a7b-2d4f6e8a1c3b'
const ATTEMPT2 = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const NOW = Date.UTC(2026, 10, 22, 12, 0, 20)

test('elements top-up params: ui_mode, return_url, the payer\'s customer, the save checkbox, no success/cancel, no payment_method_types', () => {
  const p = checkoutParams({ walletId: 'org:t1', ledgerKey: 'topup-request:' + ATTEMPT, amountCents: 2500, baseUrl: 'https://app.slatebox.com', email: 'p@example.test', customerId: 'cus_payer', ui: 'elements', attemptId: ATTEMPT, now: NOW })
  assert.equal(p.ui_mode, 'elements')
  assert.equal(p.return_url, 'https://app.slatebox.com/profile?tab=credits&topup={CHECKOUT_SESSION_ID}')
  assert.equal(p.success_url, undefined)
  assert.equal(p.cancel_url, undefined)
  assert.equal(p.payment_method_types, undefined)
  assert.equal(p.customer, 'cus_payer')
  assert.equal(p.customer_email, undefined)
  assert.deepEqual(p.saved_payment_method_options, { payment_method_save: 'enabled' })
  assert.equal(p.integration_identifier, 'slatebox_pay_sheet')
  assert.equal(p.metadata.walletId, 'org:t1', 'the team credit is routed by metadata, not by the customer')
  // with an attempt the parameters are the same for the whole minute (a retried call makes the same request)
  const again = checkoutParams({ walletId: 'org:t1', ledgerKey: 'topup-request:' + ATTEMPT, amountCents: 2500, baseUrl: 'https://app.slatebox.com', email: 'p@example.test', customerId: 'cus_payer', ui: 'elements', attemptId: ATTEMPT, now: NOW + 30_000 })
  assert.deepEqual(again, p)
  assert.ok(p.expires_at - Math.floor(NOW / 1000) >= 30 * 60)
})

test('the top-up idempotency key carries the wallet, payer, amount, mode and attempt; a malformed attempt is refused', () => {
  const k = topUpKey({ walletId: 'user:p1', userId: 'p1', amountCents: 1000, ui: 'elements', attemptId: ATTEMPT, now: NOW })
  assert.equal(k, `topup:user:p1:p1:1000:elements:${ATTEMPT}`)
  assert.notEqual(k, topUpKey({ walletId: 'user:p1', userId: 'p1', amountCents: 1000, ui: 'hosted', attemptId: ATTEMPT, now: NOW }))
  assert.notEqual(k, topUpKey({ walletId: 'user:p1', userId: 'p1', amountCents: 1000, ui: 'elements', attemptId: ATTEMPT2, now: NOW }))
  assert.throws(() => topUpKey({ walletId: 'user:p1', userId: 'p1', amountCents: 1000, ui: 'elements', attemptId: 'abc', now: NOW }), { error: 'attempt' })
})

function topUpWorld() {
  const made = [], customersFor = []
  const sessions = new Map()
  const stripe = { checkout: { sessions: { async create(params, opts) {
    // Stripe's idempotency: the same key gives the first session back
    if (sessions.has(opts?.idempotencyKey)) return sessions.get(opts.idempotencyKey)
    made.push({ params, key: opts?.idempotencyKey })
    const s = { id: 'cs_' + made.length, client_secret: params.ui_mode === 'elements' ? 'secret_' + made.length : null, url: params.ui_mode ? null : 'https://checkout.example/' + made.length }
    sessions.set(opts?.idempotencyKey, s)
    return s
  } } } }
  const customerFor = async user => { customersFor.push(user._id); return 'cus_' + user._id }
  return { stripe, customerFor, made, customersFor }
}
const payer = { _id: 'p1', emails: [{ address: 'p@example.test', verified: true }] }
const base = { user: payer, walletId: 'user:p1', wallet: emptyWallet(), settings: DEFAULT_METERING.topUp, baseUrl: 'https://app', inApp: true, now: NOW }

test('startTopUp: two top-ups of the same amount with different attempts make two sessions; a double click makes one', async () => {
  const w = topUpWorld()
  const first = await startTopUp(w, { ...base, amountCents: 1000, ui: 'elements', attemptId: ATTEMPT })
  assert.deepEqual(first, { ui: 'elements', clientSecret: 'secret_1', sessionId: 'cs_1' })
  const doubleClick = await startTopUp(w, { ...base, amountCents: 1000, ui: 'elements', attemptId: ATTEMPT, now: NOW + 2000 })
  assert.equal(doubleClick.sessionId, 'cs_1')
  const second = await startTopUp(w, { ...base, amountCents: 1000, ui: 'elements', attemptId: ATTEMPT2, now: NOW + 5000 })
  assert.equal(second.sessionId, 'cs_2', 'a deliberate second top-up within the minute can be paid')
  assert.equal(w.made.length, 2)
  // the ledger key is fixed per attempt, so a retried call sends the same parameters
  assert.equal(w.made[0].params.metadata.ledgerKey, 'topup-request:' + ATTEMPT)
})

test('startTopUp: an amount outside the allow-list is refused before Stripe; the limits still apply', async () => {
  const w = topUpWorld()
  assert.deepEqual([...TOP_UP_AMOUNTS], [1000, 2500, 5000, 10000])
  for (const amountCents of [999, 1001, 1500, 3000, 20000, 0, -1000]) {
    await assert.rejects(startTopUp(w, { ...base, amountCents, ui: 'elements', attemptId: ATTEMPT }), { error: 'amount' }, String(amountCents))
  }
  // in the allow-list but over the first top-up cap
  await assert.rejects(startTopUp(w, { ...base, amountCents: 5000, ui: 'elements', attemptId: ATTEMPT }), { error: 'first' })
  await assert.rejects(startTopUp(w, { ...base, amountCents: 1000, ui: 'elements', attemptId: 'not-a-uuid' }), { error: 'attempt' })
  assert.equal(w.made.length, 0)
})

test('startTopUp: a team top-up is on the payer\'s own customer with metadata.walletId; the kill switch gives the hosted page', async () => {
  const w = topUpWorld()
  const out = await startTopUp(w, { ...base, walletId: 'org:t1', amountCents: 1000, ui: 'elements', attemptId: ATTEMPT })
  assert.equal(out.ui, 'elements')
  assert.deepEqual(w.customersFor, ['p1'])
  assert.equal(w.made[0].params.customer, 'cus_p1')
  assert.equal(w.made[0].params.metadata.walletId, 'org:t1')
  const off = await startTopUp(w, { ...base, amountCents: 1000, ui: 'elements', attemptId: ATTEMPT2, inApp: false })
  assert.deepEqual(off, { ui: 'hosted', url: 'https://checkout.example/2', sessionId: 'cs_2' })
  assert.equal(w.made[1].params.ui_mode, undefined)
  assert.ok(w.made[1].params.success_url)
  // the card fee setting reaches the session
  await startTopUp(w, { ...base, settings: { ...DEFAULT_METERING.topUp, cardFee: 'absorb' }, amountCents: 1000, ui: 'elements', attemptId: '11111111-2222-4333-8444-555555555555' })
  assert.equal(w.made[2].params.line_items[0].price_data.unit_amount, 1000)
})

test('the card fee setting: topUp.cardFee is included by default, absorb when set, and nothing else', () => {
  assert.equal(DEFAULT_METERING.topUp.cardFee, 'included')
  assert.equal(cardFeeMode(DEFAULT_METERING.topUp), 'included')
  assert.equal(cardFeeMode({ cardFee: 'absorb' }), 'absorb')
  assert.equal(cardFeeMode({ cardFee: 'surcharge' }), 'included')
  assert.equal(cardFeeMode(undefined), 'included')
})

test('wallet.js: the team top-up never uses the team\'s shared customer, and the quote and session read topUp.cardFee', () => {
  const src = readFileSync(new URL('../web/app/server/methods/wallet.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /Organizations/)
  assert.doesNotMatch(src, /org(anization)?\.customerId/i)
  assert.match(src, /startTopUp\(/)
  assert.match(src, /cardFeeMode\(settings\.topUp\)/)
})

test('a refund made outside Slatebox is recorded when the charge has no refunds list (API 2022-11-15 and later)', async () => {
  const x = io()
  await handleWalletEvent(completed(), x)
  x.ledger[0].stripe.chargeId = 'ch_1'
  const listed = []
  x.refundsOf = async chargeId => { listed.push(chargeId); return [{ id: 're_ext2', amount: 300 }] }
  await handleWalletEvent({ id: 'evt_r2', type: 'charge.refunded', data: { object: { id: 'ch_1', amount_refunded: 300 } } }, x)
  assert.deepEqual(listed, ['ch_1'])
  assert.equal(x.wallets.get('user:p1').balanceMicros, 7_000_000)
  // delivered again: nothing more
  await handleWalletEvent({ id: 'evt_r2', type: 'charge.refunded', data: { object: { id: 'ch_1', amount_refunded: 300 } } }, x)
  assert.equal(x.wallets.get('user:p1').balanceMicros, 7_000_000)
})
