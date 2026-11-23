// Fixes for the hostile review of feat/pricing (pricing-attack-app): money.
// H2 refunds, M1 top-up limits when paid. (M4, the subscriber conversion, is gone: every
// subscription was cancelled on 2026-11-20 with no conversion.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyWallet, debit } from '../web/app/server/metering/ledger.mjs'
import { DEFAULT_METERING } from '../web/app/server/metering/policy.mjs'

const app = new URL('../web/app/', import.meta.url).pathname
const source = path => readFileSync(join(app, path), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))

// A wallet store with the same conditional writes as wallet.js.
function walletStore(wallet) {
  const wallets = new Map([['user:u1', { ...emptyWallet(), ...wallet }]])
  const ledger = []
  const openCalls = new Set()
  return {
    wallets, ledger, openCalls,
    async lockWallet(walletId, requestId, now) {
      await tick()
      const w = wallets.get(walletId)
      if (!w || (w.refunding && w.refundingAt > now - 600_000)) return null
      wallets.set(walletId, { ...w, refunding: requestId, refundingAt: now })
      return { ...w, refunding: requestId }
    },
    async unlockWallet(walletId, requestId) {
      await tick()
      const w = wallets.get(walletId)
      if (w?.refunding === requestId) { const { refunding, refundingAt, ...rest } = w; wallets.set(walletId, rest) }
    },
    async balanceInUse(walletId) { await tick(); return openCalls.has(walletId) },
    async charges() {
      await tick()
      const refunded = id => ledger.filter(e => e.type === 'refund' && e.stripe?.chargeId === id).reduce((s, e) => s - e.amountMicros / 10_000, 0)
      return [{ chargeId: 'ch_1', amountCents: 2500, created: 1 }, { chargeId: 'ch_2', amountCents: 2500, created: 2 }].map(c => ({ ...c, refundedCents: refunded(c.chargeId) }))
    },
    async append(entry) {
      await tick()
      if (ledger.some(e => e.idempotencyKey === entry.idempotencyKey)) return
      ledger.push(entry)
      const w = wallets.get(entry.walletId)
      wallets.set(entry.walletId, { ...w, balanceMicros: w.balanceMicros + entry.amountMicros, refundableMicros: w.refundableMicros + entry.refundableDeltaMicros })
    },
  }
}
const fakeStripe = () => {
  const room = { ch_1: 2500, ch_2: 2500 }
  return { room, refunds: { async create({ charge, amount }) { await tick(); if (amount > room[charge]) throw new Error('exceeds'); room[charge] -= amount; return { id: 're_' + Math.random() } } } }
}

test('H2: two refunds at once pay the balance back once and leave it at zero', async () => {
  const { refundBalanceOnce } = await import('../web/app/server/wallet-stripe.mjs')
  const store = walletStore({ balanceMicros: 10_000_000, refundableMicros: 10_000_000, firstTopUpAt: 1 })
  const stripe = fakeStripe()
  const out = await Promise.allSettled([
    refundBalanceOnce({ stripe, io: store, walletId: 'user:u1', requestId: 'a', now: 5000 }),
    refundBalanceOnce({ stripe, io: store, walletId: 'user:u1', requestId: 'b', now: 5000 }),
  ])
  const refundedCents = 5000 - stripe.room.ch_1 - stripe.room.ch_2
  assert.equal(refundedCents, 1000)
  assert.equal(store.wallets.get('user:u1').balanceMicros, 0)
  const refused = out.find(o => o.status === 'rejected')
  assert.equal(refused.reason.error, 'refund-running')
  assert.equal(store.wallets.get('user:u1').refunding, undefined, 'the lock is released')
})

test('H2: a refund waits while the balance is paying for a request or a call', async () => {
  const { refundBalanceOnce } = await import('../web/app/server/wallet-stripe.mjs')
  const held = walletStore({ balanceMicros: 10_000_000, refundableMicros: 10_000_000, heldMicros: 52_500 })
  await assert.rejects(refundBalanceOnce({ stripe: fakeStripe(), io: held, walletId: 'user:u1', requestId: 'a', now: 1 }), { error: 'in-use' })
  const calling = walletStore({ balanceMicros: 10_000_000, refundableMicros: 10_000_000 })
  calling.openCalls.add('user:u1')
  await assert.rejects(refundBalanceOnce({ stripe: fakeStripe(), io: calling, walletId: 'user:u1', requestId: 'a', now: 1 }), { error: 'in-use' })
  assert.equal(calling.wallets.get('user:u1').refunding, undefined)
})

test('H2: wallet.js refunds through the lock, and spending stops while a refund runs', () => {
  const wallet = source('server/methods/wallet.js')
  assert.match(wallet, /refundBalanceOnce\(/)
  assert.match(wallet, /refunding: null/)
  const meteor = source('server/metering/meteor.js')
  // a debit never lands on a wallet that is being refunded
  assert.match(meteor, /refunding: null/)
})

// The Stripe-facing io for handleWalletEvent with the conditional credit.
async function topUpIo(start = {}) {
  const { guardsPass } = await import('../web/app/server/metering/holds.mjs')
  const ledger = [], refunds = [], alerts = []
  let wallet = start.balanceMicros !== undefined ? { ...emptyWallet(), ...start } : null
  return {
    ledger, refunds, alerts, wallet: () => wallet,
    async appendLedger(entry) { await tick(); if (ledger.some(e => e.idempotencyKey === entry.idempotencyKey)) return false; ledger.push(entry); return true },
    async readWallet() { await tick(); return wallet ? { ...wallet } : null },
    // the same write as wallet.js: limits, and the session not yet settled, then credited and marked
    async creditWalletIf(walletId, { inc, guards, now, settle }) {
      await tick()
      const w = wallet || { ...emptyWallet() }
      if (!guardsPass(w, guards) || w.settledTopUps?.[settle]) return false
      const next = { ...w, firstTopUpAt: w.firstTopUpAt ?? now, settledTopUps: { ...w.settledTopUps, [settle]: 'credited' } }
      for (const [k, v] of Object.entries(inc)) next[k] = (next[k] || 0) + v
      wallet = next
      return true
    },
    async refuseTopUpIf(walletId, id) {
      await tick()
      const w = wallet || { ...emptyWallet() }
      if (w.settledTopUps?.[id]) return false
      wallet = { ...w, settledTopUps: { ...w.settledTopUps, [id]: 'refused' } }
      return true
    },
    async refundPayment(params) { await tick(); refunds.push(params) },
    async alert(text) { alerts.push(text) },
    now: () => 10_000,
    settings: async () => DEFAULT_METERING,
  }
}
const session = (id, cents) => ({ type: 'checkout.session.completed', data: { object: {
  id, mode: 'payment', payment_status: 'paid', payment_intent: { id: 'pi_' + id, latest_charge: 'ch_' + id }, metadata: { walletId: 'user:u1', balanceCents: String(cents) }, amount_total: cents + 105,
} } })

test('M1: 30 first top-ups of $25 paid at once credit $25; the rest are refunded in full', async () => {
  const { handleWalletEvent } = await import('../web/app/server/wallet-stripe.mjs')
  const x = await topUpIo()
  await Promise.all(Array.from({ length: 30 }, (_, i) => handleWalletEvent(session('cs_' + i, 2500), x)))
  assert.equal(x.wallet().balanceMicros, 25_000_000)
  assert.equal(x.refunds.length, 29)
  assert.ok(x.refunds.every(r => r.idempotencyKey.startsWith('topup-refused:') && r.paymentIntentId.startsWith('pi_cs_')))
  assert.equal(x.ledger.filter(e => e.type === 'topup-refused').length, 29)
  // the ledger nets to the balance
  assert.equal(x.ledger.reduce((s, e) => s + e.amountMicros, 0), 25_000_000)
})

test('M1: a payment that would take a balance past $500 is refunded, not credited', async () => {
  const { handleWalletEvent } = await import('../web/app/server/wallet-stripe.mjs')
  const x = await topUpIo({ balanceMicros: 490_000_000, refundableMicros: 490_000_000, firstTopUpAt: 1 })
  await handleWalletEvent(session('cs_big', 2500), x)
  assert.equal(x.wallet().balanceMicros, 490_000_000)
  assert.equal(x.refunds.length, 1)
  await handleWalletEvent(session('cs_ok', 1000), x)
  assert.equal(x.wallet().balanceMicros, 500_000_000)
})

test('M1: Checkout sessions close after 30 minutes and wallet.js checks the limits again when paid', async () => {
  const { checkoutParams } = await import('../web/app/server/wallet-stripe.mjs')
  const p = checkoutParams({ walletId: 'user:u1', ledgerKey: 'k', amountCents: 1000, baseUrl: 'https://x', now: 1_000_000_000_000 })
  assert.equal(p.expires_at, 1_000_000_000 + 1800)
  assert.match(source('server/methods/wallet.js'), /creditWalletIf/)
  assert.match(source('server/methods/wallet.js'), /refundPayment/)
})

test('ledger debit is unchanged for callers without holds', () => {
  assert.equal(debit({ ...emptyWallet(), balanceMicros: 100, refundableMicros: 100 }, 50).wallet.balanceMicros, 50)
})
