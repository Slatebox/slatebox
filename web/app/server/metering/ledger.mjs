// Wallet arithmetic. Pure: a wallet in, a wallet out. Money is in micro-dollars,
// Stripe amounts in cents. A balance never goes below zero and there is never a bill afterwards.
import { BILLING_CONTACT_URL } from '../../imports/api/common/contact.mjs'

export const centsToMicros = cents => Math.round(cents * 10_000)
export const microsToCents = micros => Math.floor(micros / 10_000)

export function emptyWallet() {
  return { balanceMicros: 0, refundableMicros: 0, frozen: false, firstTopUpAt: null }
}

export function applyTopUp(wallet, { amountMicros, now }) {
  return {
    ...wallet,
    balanceMicros: wallet.balanceMicros + amountMicros,
    refundableMicros: wallet.refundableMicros + amountMicros,
    firstTopUpAt: wallet.firstTopUpAt ?? now,
  }
}

// Spending lowers what can go back to a card by what was spent. When a charge is larger than
// the balance it takes the balance to zero.
export function debit(wallet, chargeMicros) {
  const debitedMicros = Math.max(0, Math.min(wallet.balanceMicros, chargeMicros))
  const refundableDrop = Math.min(wallet.refundableMicros, debitedMicros)
  return {
    wallet: { ...wallet, balanceMicros: wallet.balanceMicros - debitedMicros, refundableMicros: wallet.refundableMicros - refundableDrop },
    debitedMicros,
    refundableDeltaMicros: -refundableDrop,
    exhausted: debitedMicros < chargeMicros,
  }
}

const dollars = cents => '$' + (cents / 100).toFixed(cents % 100 ? 2 : 0)

// Limits on a top-up. The first-top-up cap covers every top-up in the 24 hours after the first
// one (wallet.firstDayMicros), so a stolen card adds at most that much on its first day. Checked
// when a Checkout session is made and again, with the same rule, when it is paid (creditLimits).
export function validateTopUp({ wallet, amountCents, settings, now }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { code: 'amount', message: 'Choose an amount in whole cents.' }
  if (wallet.frozen) return { code: 'frozen', message: `Your balance is on hold. Write to us at ${BILLING_CONTACT_URL}.` }
  if (amountCents < settings.minCents) return { code: 'minimum', message: `A top-up is at least ${dollars(settings.minCents)}.` }
  if (!wallet.firstTopUpAt && amountCents > settings.firstMaxCents) return { code: 'first', message: `Your first top-up can be up to ${dollars(settings.firstMaxCents)}.` }
  if (inFirstDay(wallet, settings, now) && microsToCents(wallet.firstDayMicros || 0) + amountCents > settings.firstMaxCents) {
    return { code: 'first', message: `In the first 24 hours, top-ups can add up to ${dollars(settings.firstMaxCents)} in all.` }
  }
  if (wallet.balanceMicros + centsToMicros(amountCents) > centsToMicros(settings.maxBalanceCents)) {
    return { code: 'maximum', message: `A balance can be up to ${dollars(settings.maxBalanceCents)}.` }
  }
  return null
}

const inFirstDay = (wallet, settings, now) => !wallet.firstTopUpAt || (now !== undefined && now < wallet.firstTopUpAt + settings.holdHours * 3600_000)

// The conditional credit for a paid top-up: the same limits as validateTopUp, as guards
// (holds.mjs) the database checks in the same write.
export function creditLimits({ wallet, amountMicros, settings, now }) {
  const firstDay = inFirstDay(wallet, settings, now)
  return {
    inc: { balanceMicros: amountMicros, refundableMicros: amountMicros, ...(firstDay && { firstDayMicros: amountMicros }) },
    guards: [
      { notTrue: 'frozen' },
      { sum: { balanceMicros: 1 }, max: centsToMicros(settings.maxBalanceCents) - amountMicros },
      ...(firstDay ? [{ sum: { firstDayMicros: 1 }, max: centsToMicros(settings.firstMaxCents) - amountMicros }] : []),
    ],
  }
}

// Stripe keeps 2.9% + 30 cents of a US card payment. The fee line is set so that what
// Slatebox receives equals the balance, and is shown before payment.
export const STRIPE_PERCENT = 2.9
export const STRIPE_FIXED_CENTS = 30
export function cardFeeCents(amountCents) {
  const gross = Math.ceil((amountCents + STRIPE_FIXED_CENTS) / (1 - STRIPE_PERCENT / 100))
  return gross - amountCents
}

// What a wallet may spend on this kind now. Video may not use money from a top-up
// younger than the hold. A frozen wallet spends nothing.
export function spendableMicros(wallet, { kind, topups = [], now, holdHours }) {
  if (wallet.frozen) return 0
  if (kind !== 'video') return wallet.balanceMicros
  const recent = topups.filter(t => t.created > now - holdHours * 3600_000).reduce((sum, t) => sum + t.amountMicros, 0)
  return Math.max(0, wallet.balanceMicros - recent)
}

// A refund of the refundable share, in whole cents, against the wallet's charges newest first.
export function refundPlan({ walletId, requestId, refundableMicros, charges }) {
  let left = microsToCents(refundableMicros)
  const plan = []
  for (const charge of [...charges].sort((a, b) => b.created - a.created)) {
    if (left <= 0) break
    const room = charge.amountCents - (charge.refundedCents || 0)
    const amountCents = Math.min(room, left)
    if (amountCents <= 0) continue
    plan.push({ chargeId: charge.chargeId, amountCents, idempotencyKey: `refund:${walletId}:${requestId}:${charge.chargeId}` })
    left -= amountCents
  }
  return plan
}
