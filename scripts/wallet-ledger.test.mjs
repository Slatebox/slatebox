import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyWallet, applyTopUp, debit, validateTopUp, cardFeeCents, spendableMicros, refundPlan, centsToMicros, microsToCents,
} from '../web/app/server/metering/ledger.mjs'
import { recordUsage } from '../web/app/server/metering/record.mjs'
import { DEFAULT_METERING } from '../web/app/server/metering/policy.mjs'

const NOW = Date.UTC(2026, 10, 19, 12)
const HOUR = 3600_000

test('money units', () => {
  assert.equal(centsToMicros(1000), 10_000_000)
  assert.equal(microsToCents(12_409_999), 1240)
})

test('a top-up adds balance that is fully refundable', () => {
  const w = applyTopUp(emptyWallet(), { amountMicros: 10_000_000, now: NOW })
  assert.deepEqual([w.balanceMicros, w.refundableMicros, w.firstTopUpAt], [10_000_000, 10_000_000, NOW])
  const again = applyTopUp(w, { amountMicros: 5_000_000, now: NOW + HOUR })
  assert.equal(again.firstTopUpAt, NOW)
})

test('the balance never goes below zero: the last action debits to zero and nothing is billed afterwards', () => {
  const w = { ...emptyWallet(), balanceMicros: 1000, refundableMicros: 1000 }
  const out = debit(w, 1500)
  assert.deepEqual([out.wallet.balanceMicros, out.debitedMicros, out.exhausted], [0, 1000, true])
  assert.equal(out.wallet.refundableMicros, 0)
  const none = debit(out.wallet, 10)
  assert.deepEqual([none.wallet.balanceMicros, none.debitedMicros], [0, 0])
})

test('spending lowers what can go back to a card by what was spent, never below zero', () => {
  const out = debit({ ...emptyWallet(), balanceMicros: 10_000_000, refundableMicros: 10_000_000 }, 1_000_000)
  assert.equal(out.wallet.balanceMicros, 9_000_000)
  assert.equal(out.wallet.refundableMicros, 9_000_000)
  assert.equal(out.refundableDeltaMicros, -1_000_000)
  const short = debit({ ...emptyWallet(), balanceMicros: 10_000_000, refundableMicros: 1_000_000 }, 3_000_000)
  assert.equal(short.wallet.refundableMicros, 0)
  assert.equal(short.refundableDeltaMicros, -1_000_000)
})

test('top-up limits: at least $10, a first top-up of at most $25, a balance of at most $500', () => {
  const t = DEFAULT_METERING.topUp
  assert.equal(validateTopUp({ wallet: emptyWallet(), amountCents: 999, settings: t }).code, 'minimum')
  assert.equal(validateTopUp({ wallet: emptyWallet(), amountCents: 2600, settings: t }).message, 'Your first top-up can be up to $25.')
  assert.equal(validateTopUp({ wallet: emptyWallet(), amountCents: 2500, settings: t }), null)
  const funded = { ...emptyWallet(), balanceMicros: centsToMicros(48000), firstTopUpAt: NOW }
  assert.equal(validateTopUp({ wallet: funded, amountCents: 2500, settings: t }).code, 'maximum')
  assert.equal(validateTopUp({ wallet: { ...funded, balanceMicros: 0 }, amountCents: 5000, settings: t }), null)
  assert.equal(validateTopUp({ wallet: emptyWallet(), amountCents: 10.5, settings: t }).code, 'amount')
  assert.equal(validateTopUp({ wallet: { ...emptyWallet(), frozen: true }, amountCents: 1000, settings: t }).code, 'frozen')
})

test('the card fee is a separate line, set so the money left after Stripe takes its fee equals the balance', () => {
  for (const amount of [1000, 2500, 10000, 50000]) {
    const fee = cardFeeCents(amount)
    const gross = amount + fee
    const stripeFee = Math.round(gross * 0.029) + 30
    assert.ok(gross - stripeFee >= amount, `${amount}: net ${gross - stripeFee}`)
    assert.ok(gross - stripeFee <= amount + 1, `${amount}: fee is not padded`)
  }
  assert.equal(cardFeeCents(1000), 61)
})

test('video waits 24 hours after a top-up; AI may use it at once; a frozen wallet spends nothing', () => {
  const w = { ...emptyWallet(), balanceMicros: 20_000_000 }
  const topups = [{ amountMicros: 15_000_000, created: NOW - 2 * HOUR }, { amountMicros: 5_000_000, created: NOW - 30 * HOUR }]
  assert.equal(spendableMicros(w, { kind: 'video', topups, now: NOW, holdHours: 24 }), 5_000_000)
  assert.equal(spendableMicros(w, { kind: 'ai', topups, now: NOW, holdHours: 24 }), 20_000_000)
  assert.equal(spendableMicros({ ...w, frozen: true }, { kind: 'ai', topups, now: NOW, holdHours: 24 }), 0)
})

test('a refund splits across charges newest first, in whole cents, with idempotency keys', () => {
  const charges = [
    { chargeId: 'ch_old', amountCents: 1000, refundedCents: 0, created: 1 },
    { chargeId: 'ch_new', amountCents: 2500, refundedCents: 500, created: 2 },
  ]
  const plan = refundPlan({ walletId: 'user:p1', requestId: 'req1', refundableMicros: 25_559_999, charges })
  assert.deepEqual(plan, [
    { chargeId: 'ch_new', amountCents: 2000, idempotencyKey: 'refund:user:p1:req1:ch_new' },
    { chargeId: 'ch_old', amountCents: 555, idempotencyKey: 'refund:user:p1:req1:ch_old' },
  ])
  assert.deepEqual(refundPlan({ walletId: 'w', requestId: 'r', refundableMicros: 9_999, charges }), [])
})

function fakeIo() {
  const events = [], incs = [], wallets = new Map()
  return {
    events, incs, wallets,
    async insertEvent(e) { if (events.some(x => x.ref === e.ref)) return false; events.push(e); return true },
    async inc(key, fields) { incs.push([key, fields]) },
    async debitWallet(walletId, chargeMicros) {
      const out = debit(wallets.get(walletId) || emptyWallet(), chargeMicros)
      wallets.set(walletId, out.wallet)
      return out
    },
  }
}

test('recording usage: free counts against the person and the global budget, balance debits with the margin, own key costs Slatebox nothing', async () => {
  const io = fakeIo()
  const base = { actorId: 'p1', feature: 'workshop', model: 'm', units: 1, now: NOW, settings: DEFAULT_METERING }
  await recordUsage(io, { ...base, ref: 'a1', payer: { type: 'user', id: 'p1' }, kind: 'ai', route: 'free', costMicros: 1200 })
  assert.deepEqual(io.incs, [
    ['user:p1:2026-11', { aiMicros: 1200 }],
    ['user:p1:2026-11-19', { freeMicros: 1200 }],
    ['global:2026-11', { freeMicros: 1200, 'freeByKind.ai': 1200 }],
    ['global:2026-11-19', { freeMicros: 1200 }],
  ])
  io.wallets.set('user:p1', { ...emptyWallet(), balanceMicros: 5_000_000, refundableMicros: 5_000_000 })
  const paid = await recordUsage(io, { ...base, ref: 'a2', payer: { type: 'user', id: 'p1' }, kind: 'video', route: 'balance', costMicros: 4000, units: 1 })
  assert.equal(paid.chargeMicros, 4200)
  assert.equal(io.wallets.get('user:p1').balanceMicros, 5_000_000 - 4200)
  assert.equal(io.events.at(-1).chargeMicros, 4200)
  const before = io.incs.length
  await recordUsage(io, { ...base, ref: 'a3', payer: { type: 'user', id: 'p1' }, kind: 'ai', route: 'byok', costMicros: 900 })
  assert.equal(io.incs.length, before, 'an own key touches no allowance or budget')
  assert.deepEqual([io.events.at(-1).costMicros, io.events.at(-1).providerMicros], [0, 900])
  const dup = await recordUsage(io, { ...base, ref: 'a1', payer: { type: 'user', id: 'p1' }, kind: 'ai', route: 'free', costMicros: 1200 })
  assert.equal(dup.duplicate, true)
  assert.equal(io.events.length, 3)
})

test('free call minutes count as minutes for the starter and as dollars for the budget', async () => {
  const io = fakeIo()
  await recordUsage(io, { ref: 'c:1', payer: { type: 'user', id: 'p1' }, actorId: 'p1', kind: 'voice', route: 'free', feature: 'call', units: 40, costMicros: 40 * 990, now: NOW, settings: DEFAULT_METERING })
  assert.deepEqual(io.incs[0], ['user:p1:2026-11', { voiceMinutes: 40 }])
  assert.deepEqual(io.incs[2], ['global:2026-11', { freeMicros: 39600, 'freeByKind.voice': 39600 }])
})
