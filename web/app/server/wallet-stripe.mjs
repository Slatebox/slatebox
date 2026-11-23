// Top-ups through Stripe Checkout (one-time payments only), Stripe webhook events turned
// into ledger entries, and refunds of what is left. Pure apart from the injected Stripe
// client and io; the Meteor glue is server/methods/wallet.js.
import { cardFeeCents, centsToMicros, creditLimits, emptyWallet, microsToCents, refundPlan, validateTopUp } from './metering/ledger.mjs'
import { TOP_UP_AMOUNTS, cardFeeMode } from '../imports/api/billing/top-up.mjs'
import { SHEET_INTEGRATION, attemptPart, checkUi, checkoutMinute, payError, sessionAnswer, sessionUi } from './pay-attempt.mjs'
import { BILLING_CONTACT_URL } from '../imports/api/common/contact.mjs'

const money = cents => '$' + (cents / 100).toFixed(2)

export const WALLET_COPY = Object.freeze({
  refundFailed: `We could not refund your balance. Nothing was removed. Try again or write to us at ${BILLING_CONTACT_URL}.`,
  refundRunning: 'A refund of this balance is already under way.',
  inUse: 'Your balance is paying for a call or an AI request right now. Try again when it has finished.',
  frozen: `Your balance is on hold. Write to us at ${BILLING_CONTACT_URL}.`,
})
const coded = (error, message) => Object.assign(new Error(message), { error, reason: message })

// A Checkout session is open for 30 minutes (Stripe's shortest), so a payment page left open
// cannot be paid hours later against limits checked when it was made.
export const CHECKOUT_MINUTES = 30

const wholeDollars = cents => `$${cents % 100 ? (cents / 100).toFixed(2) : cents / 100}`

// What a top-up costs under topUp.cardFee (top-up.mjs): 'included' folds card processing into
// the price (the amount that nets the balance after Stripe's fee), 'absorb' charges the balance.
export function topUpPrice(amountCents, cardFee) {
  const mode = cardFeeMode({ cardFee })
  const feeCents = mode === 'included' ? cardFeeCents(amountCents) : 0
  return { cardFee: mode, amountCents, feeCents, totalCents: amountCents + feeCents }
}

// The sentence and button shown before payment. There is never a separate card-fee line: where
// processing is included it is part of the price (surcharge rules, design §13.6).
export function topUpQuote(amountCents, marginPercent, cardFee) {
  const price = topUpPrice(amountCents, cardFee)
  const { totalCents } = price
  const included = price.cardFee === 'included'
  return {
    ...price,
    label: `Top up ${wholeDollars(amountCents)}`,
    note: included ? 'includes processing' : null,
    text: `You pay ${money(totalCents)} for ${money(amountCents)} of balance${included ? '; the price includes processing' : ''}. Balance is spent at the provider's price plus ${marginPercent}%. It never expires, and we refund what is left when you ask.`,
    button: `Pay ${money(totalCents)}`,
  }
}

// A live key never runs outside production.
export function assertUsableStripeKey(key, env) {
  if (typeof key !== 'string' || !key) throw new Error('Top-ups are not configured on this server.')
  if (/^(sk|rk)_live_/.test(key) && env !== 'prod') throw new Error('Refusing to use a live Stripe key outside production.')
}

// One line: the balance, at the price the card-fee setting gives. With an attempt (the pay sheet)
// the expiry counts from the minute's start, so a retried call sends the same parameters under the
// same idempotency key; without one, 30 minutes from now as before.
export function checkoutParams({ walletId, ledgerKey, amountCents, baseUrl, email, customerId = null, ui = 'hosted', attemptId, cardFee, now = Date.now() }) {
  const metadata = { walletId, ledgerKey, balanceCents: String(amountCents) }
  const price = topUpPrice(amountCents, cardFee)
  const back = `${baseUrl}/profile?tab=credits&topup={CHECKOUT_SESSION_ID}`
  return {
    ...(checkUi(ui) === 'elements' && { ui_mode: 'elements' }),
    mode: 'payment',
    expires_at: attemptId ? checkoutMinute(now) * 60 + (CHECKOUT_MINUTES + 1) * 60 : Math.floor(now / 1000) + CHECKOUT_MINUTES * 60,
    line_items: [{
      price_data: { currency: 'usd', unit_amount: price.totalCents, product_data: { name: 'Slatebox balance', ...(price.cardFee === 'included' && { description: 'Includes processing' }) } },
      quantity: 1,
    }],
    metadata,
    payment_intent_data: { metadata: { ...metadata } },
    ...(customerId ? { customer: customerId } : email && { customer_email: email }),
    ...(ui === 'elements'
      ? { return_url: back, integration_identifier: SHEET_INTEGRATION, ...(customerId && { saved_payment_method_options: { payment_method_save: 'enabled' } }) }
      : { success_url: back, cancel_url: `${baseUrl}/profile?tab=credits` }),
  }
}

// The payer is part of the key: two team admins topping up the same wallet never share a session.
export const topUpKey = ({ walletId, userId, amountCents, ui, attemptId, now }) =>
  `topup:${walletId}:${userId}:${amountCents}:${checkUi(ui)}:${attemptPart(attemptId, now)}`

/**
 * Makes a top-up session. → { ui:'elements', clientSecret, sessionId } | { ui:'hosted', url, sessionId }.
 * The amount must be one the sheet offers and within the limits. The customer is always the payer's
 * own (customerFor(user)), also for a team wallet: the credit is routed by metadata.walletId, and a
 * shared team customer would show every admin the cards other admins saved there.
 * deps: { stripe, customerFor(user) → customer id }
 */
export async function startTopUp({ stripe, customerFor }, { user, walletId, wallet, settings, amountCents, ui = 'hosted', attemptId, baseUrl, inApp, now = Date.now() }) {
  if (!TOP_UP_AMOUNTS.includes(amountCents)) throw payError('amount', 'Choose one of the amounts shown.')
  const mode = sessionUi(ui, inApp)
  const key = topUpKey({ walletId, userId: user._id, amountCents, ui: mode, attemptId, now })
  const problem = validateTopUp({ wallet: wallet || emptyWallet(), amountCents, settings, now })
  if (problem) throw payError(problem.code, problem.message)
  const customerId = await customerFor(user)
  const params = checkoutParams({
    walletId, ledgerKey: `topup-request:${attemptId || key}`, amountCents, baseUrl, email: user.emails?.[0]?.address,
    customerId, ui: mode, attemptId, cardFee: settings?.cardFee, now,
  })
  return sessionAnswer(mode, await stripe.checkout.sessions.create(params, { idempotencyKey: key }))
}

/**
 * io: { appendLedger(entry) → boolean (false when the idempotency key exists), readWallet(walletId) → wallet | null,
 *       creditWalletIf(walletId, { inc, guards, now, settle }) → boolean (the limits, and that session `settle`
 *         is not yet settled, are checked in the same write, which also sets settledTopUps[settle] = 'credited'),
 *       refuseTopUpIf(walletId, sessionId, now) → boolean (sets settledTopUps[sessionId] = 'refused' if unsettled),
 *       refundPayment({ paymentIntentId, idempotencyKey, metadata }), settings() → metering settings,
 *       debitWallet(walletId, amountMicros), freezeWallet(walletId), walletForCharge(chargeId), isSlateboxRefund(refundId),
 *       refundsOf(chargeId) → the charge's refunds (when the charge does not carry them),
 *       alert(text), now() }
 */
export async function handleWalletEvent(event, io) {
  const object = event?.data?.object || {}
  const now = io.now()
  switch (event?.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (object.mode !== 'payment' || object.payment_status !== 'paid') return { handled: false }
      const walletId = object.metadata?.walletId
      const balanceCents = Number(object.metadata?.balanceCents)
      if (!/^(user|org):[A-Za-z0-9_-]+$/.test(walletId || '') || !Number.isInteger(balanceCents) || balanceCents <= 0) {
        await io.alert(`A paid checkout had no wallet: ${object.id}`)
        return { handled: false }
      }
      const amountMicros = centsToMicros(balanceCents)
      const chargeId = typeof object.payment_intent === 'object' ? object.payment_intent?.latest_charge : null
      const paymentIntentId = typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id
      const added = await io.appendLedger({
        walletId, type: 'topup', idempotencyKey: 'topup:' + object.id, amountMicros, refundableDeltaMicros: amountMicros,
        cardFeeCents: (object.amount_total ?? balanceCents) - balanceCents,
        stripe: { checkoutSessionId: object.id, paymentIntentId, chargeId },
        note: 'Top-up', created: now,
      })
      // The ledger row and the credit are two writes. Whether this session was settled is kept on
      // the wallet (settledTopUps[session] = 'credited' | 'refused', set in the same write as the
      // credit), so a delivery that finds the row already written finishes what an earlier one
      // left half done instead of stopping: a failed credit is never lost.
      let settled = (await io.readWallet(walletId))?.settledTopUps?.[object.id]
      if (!settled) {
        // The limits are checked again now that it is paid: several sessions made before any was
        // paid must not add up past the first-day cap or the maximum balance.
        const settings = (await io.settings()).topUp
        const wallet = await io.readWallet(walletId) || emptyWallet()
        if (await io.creditWalletIf(walletId, { ...creditLimits({ wallet, amountMicros, settings, now }), now, settle: object.id })) {
          return { handled: true, credited: true }
        }
        // over the limits, unless another delivery settled it first
        settled = await io.refuseTopUpIf(walletId, object.id, now) ? 'refused' : (await io.readWallet(walletId))?.settledTopUps?.[object.id]
      }
      if (settled !== 'refused') return { handled: true, credited: false, ...(added && { settled }) }
      const idempotencyKey = 'topup-refused:' + object.id
      // the whole payment, card fee included, goes back; the ledger nets the entry to zero.
      // Both steps are idempotent, so a retry after a failure here finishes the refund.
      await io.refundPayment({ paymentIntentId, idempotencyKey, metadata: { walletId, requestId: idempotencyKey } })
      const recorded = await io.appendLedger({
        walletId, type: 'topup-refused', idempotencyKey, amountMicros: -amountMicros, refundableDeltaMicros: -amountMicros,
        stripe: { checkoutSessionId: object.id, paymentIntentId, chargeId }, note: 'Top-up over the limit, refunded in full', created: now,
      })
      if (recorded) await io.alert(`A top-up over the limits was refunded in full: ${object.id} (${walletId}).`)
      return { handled: true, credited: false, refunded: true }
    }
    case 'charge.refunded': {
      const walletId = await io.walletForCharge(object.id)
      if (!walletId) return { handled: false }
      // charges have not carried their refunds since API 2022-11-15: they are listed then
      const refunds = object.refunds?.data ?? (io.refundsOf ? await io.refundsOf(object.id) : [])
      for (const refund of refunds || []) {
        // refunds Slatebox makes carry their request id and are already in the ledger
        if (refund.metadata?.requestId || await io.isSlateboxRefund(refund.id)) continue
        const amountMicros = centsToMicros(refund.amount)
        const added = await io.appendLedger({
          walletId, type: 'refund', idempotencyKey: 'refund-external:' + refund.id, amountMicros: -amountMicros, refundableDeltaMicros: -amountMicros,
          stripe: { chargeId: object.id, refundId: refund.id }, note: 'Refunded in Stripe', created: now,
        })
        if (added) await io.debitWallet(walletId, amountMicros)
      }
      return { handled: true }
    }
    case 'charge.dispute.created': {
      const walletId = await io.walletForCharge(object.charge)
      if (walletId) {
        await io.freezeWallet(walletId)
        await io.appendLedger({ walletId, type: 'dispute', idempotencyKey: 'dispute:' + object.id, amountMicros: 0, refundableDeltaMicros: 0, stripe: { chargeId: object.charge }, note: 'Card dispute opened', created: now })
      }
      await io.alert(`A card dispute was opened on ${object.charge}${walletId ? ` (wallet ${walletId}, now on hold)` : ''}.`)
      return { handled: true }
    }
    default:
      // Slatebox Pro is handled before this (pro-billing.mjs handleBillingEvent). A
      // subscription or invoice event still arriving here is for a product Slatebox does not sell.
      if (/^(invoice\.|customer\.subscription\.)/.test(event?.type || '')) {
        await io.alert(`A subscription for an unknown product: ${object.subscription || object.id}`)
        return { handled: true }
      }
      return { handled: false }
  }
}

/**
 * Refund the refundable share: newest charges first, idempotent per request and charge.
 * Whatever has no charge left to go back to (a fraction of a cent, a charge with no id) is
 * closed with an adjustment.
 * charges: [{ chargeId, amountCents (refundable on that charge), refundedCents, created }]
 */
const refundEntry = ({ walletId, idempotencyKey, chargeId, refundId, amountCents, now }) => ({
  walletId, type: 'refund', idempotencyKey, amountMicros: -centsToMicros(amountCents),
  refundableDeltaMicros: -centsToMicros(amountCents), stripe: { chargeId, refundId }, note: 'Refund to card', created: now,
})

// Every refund part is written down on the wallet (pendingRefunds) before Stripe is asked, and
// removed once its ledger row is written. markPending(walletId, part) / clearPending(walletId, key);
// refundBalanceOnce always passes them.
const noPending = async () => {}
export async function refundWallet({ stripe, walletId, requestId, wallet, charges, append, markPending = noPending, clearPending = noPending, now = Date.now() }) {
  const plan = refundPlan({ walletId, requestId, refundableMicros: wallet.refundableMicros, charges })
  let refundedCents = 0
  for (const part of plan) {
    await markPending(walletId, { ...part, created: now })
    const refund = await stripe.refunds.create(
      { charge: part.chargeId, amount: part.amountCents, metadata: { walletId, requestId, ledgerKey: part.idempotencyKey } },
      { idempotencyKey: part.idempotencyKey },
    )
    refundedCents += part.amountCents
    await append(refundEntry({ walletId, idempotencyKey: part.idempotencyKey, chargeId: part.chargeId, refundId: refund.id, amountCents: part.amountCents, now }))
    await clearPending(walletId, part.idempotencyKey)
  }
  const rest = wallet.balanceMicros - centsToMicros(refundedCents)
  if (rest > 0) {
    await append({
      walletId, type: 'adjustment', idempotencyKey: `refund-rest:${walletId}:${requestId}`, amountMicros: -rest,
      refundableDeltaMicros: -(wallet.refundableMicros - centsToMicros(refundedCents)), note: 'Balance closed after refund', created: now,
    })
  }
  return { refundedCents, closedMicros: Math.max(0, rest), plan }
}

// For each part written down before an earlier request stopped: if Stripe made the refund
// (found by its ledgerKey), its ledger row is written now; if not, the part is dropped.
export async function settlePendingRefunds({ stripe, io, walletId, pending, now }) {
  for (const part of pending) {
    const listed = await stripe.refunds.list({ charge: part.chargeId, limit: 100 })
    const refund = (listed?.data || []).find(r => r.metadata?.ledgerKey === part.idempotencyKey && !['failed', 'canceled'].includes(r.status))
    if (refund) {
      await io.append(refundEntry({ walletId, idempotencyKey: part.idempotencyKey, chargeId: part.chargeId, refundId: refund.id, amountCents: refund.amount, now }))
    }
    await io.clearPending(walletId, part.idempotencyKey)
  }
}

/**
 * One refund at a time per wallet, and none while the balance is paying for something.
 * io: { lockWallet(walletId, requestId, now) → wallet | null (null while another refund runs),
 *       unlockWallet(walletId, requestId), balanceInUse(walletId) → boolean (an open call paid from it),
 *       charges(walletId) → [{ chargeId, amountCents, refundedCents, created }], append(entry),
 *       readWallet(walletId), markPending(walletId, part), clearPending(walletId, idempotencyKey) }
 * New holds and debits refuse a wallet while it is locked (holds.mjs, meteor.js).
 */
export async function refundBalanceOnce({ stripe, io, walletId, requestId, now = Date.now() }) {
  let wallet = await io.lockWallet(walletId, requestId, now)
  if (!wallet) throw coded('refund-running', WALLET_COPY.refundRunning)
  try {
    // A refund that stopped between Stripe and the ledger is settled first, from Stripe's own
    // record, so this request cannot pay the same money out a second time.
    if (wallet.pendingRefunds?.length) {
      await settlePendingRefunds({ stripe, io, walletId, pending: wallet.pendingRefunds, now })
      wallet = await io.readWallet(walletId)
    }
    if (wallet.frozen) throw coded('frozen', WALLET_COPY.frozen)
    if (!(wallet.balanceMicros > 0)) return { refundedCents: 0, closedMicros: 0, plan: [] }
    if ((wallet.heldMicros || 0) > 0 || await io.balanceInUse(walletId)) throw coded('in-use', WALLET_COPY.inUse)
    const charges = await io.charges(walletId)
    return await refundWallet({ stripe, walletId, requestId, wallet, charges, append: io.append, markPending: io.markPending, clearPending: io.clearPending, now })
  } finally {
    await io.unlockWallet(walletId, requestId)
  }
}

// Account removal, in this order: the balance is refunded, then Slatebox Pro is ended (endPro),
// then the account is removed. If the refund fails, nothing else happens (Pro stays on); if
// ending Pro fails, the account is kept (endPro's own error is thrown).
export async function removeAccountAfterRefund({ refund, endPro = async () => {}, remove }) {
  try {
    await refund()
  } catch {
    throw Object.assign(new Error(WALLET_COPY.refundFailed), { error: 'refund-failed' })
  }
  await endPro()
  return remove()
}

export { microsToCents }
