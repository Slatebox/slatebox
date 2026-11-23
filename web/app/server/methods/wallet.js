// Balances: top-ups through Stripe Checkout (one-time payments), refunds of what is left,
// and the list of charges. Rules in ../wallet-stripe.mjs and ../metering/ledger.mjs.
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { check, Match } from 'meteor/check'
import Stripe from 'stripe'
import CONSTANTS from '../../imports/api/common/constants'
import { HuddleCalls, Permissions, WalletLedger, Wallets } from '../../imports/api/common/models'
import { assertUsableStripeKey, handleWalletEvent, refundBalanceOnce, startTopUp, topUpQuote } from '../wallet-stripe.mjs'
import { stripeClientOptions } from '../pay-settings.mjs'
import { idempotencyRefusal } from '../pay-attempt.mjs'
import { microsToCents } from '../metering/ledger.mjs'
import { cardFeeMode } from '../../imports/api/billing/top-up.mjs'
import { guardFilter } from '../metering/holds.mjs'
import { alert, meterOn, meterSettings } from '../metering/meteor'
import { BILLING_CONTACT_URL } from '../../imports/api/common/contact.mjs'

// Every Stripe call goes through this client, pinned to one API version (pay-settings.mjs
// STRIPE_API_VERSION, or settings.stripe.apiVersion), the same one the browser's SDK uses.
export function stripeClient() {
  const key = Meteor.settings.stripePrivateKey
  assertUsableStripeKey(key, Meteor.settings.public.env)
  return new Stripe(key, stripeClientOptions(Meteor.settings))
}

// Whether the pay sheet takes payments in the app (computed at startup, pay-settings-startup.js).
export const inAppOn = () => Meteor.settings.public.stripe?.inApp === true

// A pure module's refusal ({ error, reason }) as the method's error; Stripe's idempotency error (a
// known key with other parameters) as a refusal, never a 500; anything else is thrown as is.
export function asMethodError(error) {
  const keyed = idempotencyRefusal(error)
  if (keyed) return new Meteor.Error(keyed.error, keyed.reason)
  if (error?.error && error?.reason && !(error instanceof Meteor.Error)) return new Meteor.Error(error.error, error.reason)
  return error
}

// The payer's own Stripe customer, made once (users.pro.customerId, shared with Pro). Top-ups are
// always on the payer's customer, also for a team wallet: saved cards are the payer's, never the
// team's (design §3.1), and receipts go to the payer.
export async function payerCustomer(user) {
  if (user.pro?.customerId) return user.pro.customerId
  const customer = await stripeClient().customers.create(
    { email: user.emails?.[0]?.address, metadata: { userId: user._id } },
    { idempotencyKey: `customer:${user._id}` },
  )
  const users = Meteor.users.rawCollection()
  await users.updateOne({ _id: user._id, 'pro.customerId': null }, { $set: { 'pro.customerId': customer.id } })
  return (await users.findOne({ _id: user._id }, { projection: { 'pro.customerId': 1 } }))?.pro?.customerId || customer.id
}

// Checkout session ids are [A-Za-z0-9_] (checked in confirmTopUp, and Stripe makes them), so they are safe as field names.
const settledField = sessionId => 'settledTopUps.' + String(sessionId).replace(/[^A-Za-z0-9_]/g, '_')
const unsettled = sessionId => (sessionId ? { [settledField(sessionId)]: null } : {})
async function ensureWallet(walletId, now) {
  await Wallets.rawCollection().updateOne({ _id: walletId }, { $setOnInsert: { balanceMicros: 0, refundableMicros: 0, frozen: false, updated: now } }, { upsert: true })
    .catch(error => { if (error?.code !== 11000) throw error })
}

// Mongo io for handleWalletEvent and refunds.
export const walletIo = {
  async appendLedger(entry) {
    try {
      await WalletLedger.rawCollection().insertOne({ _id: Random.id(), ...entry })
      return true
    } catch (error) {
      if (error?.code === 11000) return false
      throw error
    }
  },
  readWallet: walletId => Wallets.rawCollection().findOne({ _id: walletId }),
  // The credit, its limits and the session's settled mark in one write (ledger.mjs creditLimits;
  // wallet-stripe.mjs handleWalletEvent finishes a credit an earlier delivery left undone).
  async creditWalletIf(walletId, { inc, guards, now, settle }) {
    await ensureWallet(walletId, now)
    const result = await Wallets.rawCollection().updateOne(
      { _id: walletId, ...guardFilter(guards), ...unsettled(settle) },
      { $inc: inc, $min: { firstTopUpAt: now }, $set: { updated: now, ...(settle && { [settledField(settle)]: 'credited' }) } },
    )
    return result.modifiedCount === 1
  },
  async refuseTopUpIf(walletId, sessionId, now) {
    await ensureWallet(walletId, now)
    const result = await Wallets.rawCollection().updateOne({ _id: walletId, ...unsettled(sessionId) }, { $set: { [settledField(sessionId)]: 'refused', updated: now } })
    return result.modifiedCount === 1
  },
  async refundPayment({ paymentIntentId, idempotencyKey, metadata }) {
    await stripeClient().refunds.create({ payment_intent: paymentIntentId, metadata }, { idempotencyKey })
  },
  settings: () => meterSettings(),
  async debitWallet(walletId, amountMicros) {
    const wallet = await Wallets.findOneAsync({ _id: walletId })
    if (!wallet) return 0
    const take = Math.min(wallet.balanceMicros, amountMicros)
    await Wallets.rawCollection().updateOne({ _id: walletId }, { $inc: { balanceMicros: -take, refundableMicros: -Math.min(wallet.refundableMicros, take) }, $set: { updated: Date.now() } })
    return take
  },
  freezeWallet: walletId => Wallets.rawCollection().updateOne({ _id: walletId }, { $set: { frozen: true, updated: Date.now() } }, { upsert: true }),
  async walletForCharge(chargeId) {
    return chargeId ? (await WalletLedger.findOneAsync({ 'stripe.chargeId': chargeId, type: 'topup' }, { fields: { walletId: 1 } }))?.walletId ?? null : null
  },
  refundsOf: async chargeId => (await stripeClient().refunds.list({ charge: chargeId, limit: 100 }))?.data || [],
  isSlateboxRefund: async refundId => Boolean(await WalletLedger.findOneAsync({ 'stripe.refundId': refundId }, { fields: { _id: 1 } })),
  alert,
  now: () => Date.now(),
}

async function walletFor(which, write) {
  const user = await Meteor.userAsync()
  if (!user || user.isAnonymous) throw new Meteor.Error('sign-in', 'Sign in to use a balance.')
  if (which === 'team') {
    if (!user.orgId) throw new Meteor.Error('team', 'You are not in a team.')
    if (write && !await Permissions.findOneAsync({ userId: user._id, orgId: user.orgId, claimId: CONSTANTS.claims.admin._id })) {
      throw new Meteor.Error('team-admin', 'Only a team admin can top up or refund the team balance.')
    }
    return { user, walletId: 'org:' + user.orgId }
  }
  return { user, walletId: 'user:' + user._id }
}

function requireMeter() {
  if (!meterOn()) throw new Meteor.Error('unavailable', 'This server has no balances.')
}

// The refund: the refundable share back to the cards it came from, newest first. One at a
// time per wallet; spending from the wallet stops while it runs (wallet-stripe.mjs).
const refundIo = {
  async lockWallet(walletId, requestId, now) {
    const result = await Wallets.rawCollection().findOneAndUpdate(
      { _id: walletId, $or: [{ refunding: null }, { refundingAt: { $lt: now - 10 * 60_000 } }] },
      { $set: { refunding: requestId, refundingAt: now } },
      { returnDocument: 'after', includeResultMetadata: false },
    )
    // older drivers wrap the document in { value }
    return result && Object.hasOwn(result, 'ok') && Object.hasOwn(result, 'value') ? result.value : result
  },
  async unlockWallet(walletId, requestId) {
    await Wallets.rawCollection().updateOne({ _id: walletId, refunding: requestId }, { $unset: { refunding: '', refundingAt: '' } })
  },
  async balanceInUse(walletId) {
    const [type, id] = walletId.split(':')
    return Boolean(await HuddleCalls.findOneAsync({ state: 'open', route: 'balance', 'payer.type': type, 'payer.id': id }, { fields: { _id: 1 } }))
  },
  async charges(walletId) {
    const entries = await WalletLedger.find({ walletId }).fetchAsync()
    const refused = new Set(entries.filter(e => e.type === 'topup-refused').map(e => e.stripe?.checkoutSessionId))
    const refundedCents = chargeId => entries.filter(e => e.type === 'refund' && e.stripe?.chargeId === chargeId).reduce((sum, e) => sum + microsToCents(-e.amountMicros), 0)
    return entries.filter(e => e.type === 'topup' && e.stripe?.chargeId && !refused.has(e.stripe?.checkoutSessionId)).map(e => ({
      chargeId: e.stripe.chargeId,
      amountCents: microsToCents(e.amountMicros),
      refundedCents: refundedCents(e.stripe.chargeId),
      created: e.created,
    }))
  },
  readWallet: walletId => Wallets.rawCollection().findOne({ _id: walletId }),
  // written before Stripe is asked, removed after the ledger row (wallet-stripe.mjs settlePendingRefunds)
  async markPending(walletId, part) {
    await Wallets.rawCollection().updateOne({ _id: walletId }, { $push: { pendingRefunds: { idempotencyKey: part.idempotencyKey, chargeId: part.chargeId, amountCents: part.amountCents, created: part.created } } })
  },
  async clearPending(walletId, idempotencyKey) {
    await Wallets.rawCollection().updateOne({ _id: walletId }, { $pull: { pendingRefunds: { idempotencyKey } } })
  },
  async append(entry) {
    if (await walletIo.appendLedger(entry)) {
      await Wallets.rawCollection().updateOne({ _id: entry.walletId }, { $inc: { balanceMicros: entry.amountMicros, refundableMicros: entry.refundableDeltaMicros }, $set: { updated: Date.now() } })
      // never below zero, whatever happened while the refund ran
      await Wallets.rawCollection().updateOne({ _id: entry.walletId, balanceMicros: { $lt: 0 } }, { $set: { balanceMicros: 0, refundableMicros: 0 } })
    }
  },
}

export async function refundBalance(walletId, requestId = Random.id()) {
  if (!await Wallets.findOneAsync({ _id: walletId }, { fields: { _id: 1 } })) return { refundedCents: 0 }
  try {
    return await refundBalanceOnce({ stripe: stripeClient(), io: refundIo, walletId, requestId, now: Date.now() })
  } catch (error) {
    if (['refund-running', 'in-use', 'frozen'].includes(error.error)) throw new Meteor.Error(error.error, error.reason)
    throw error
  }
}

const LABELS = { topup: 'Top-up', 'topup-refused': 'Top-up over the limit, refunded', refund: 'Refund to card', dispute: 'Card dispute', adjustment: 'Balance closed' }

Meteor.methods({
  async [CONSTANTS.methods.wallet.quote]({ amountCents } = {}) {
    check(amountCents, Match.Integer)
    const settings = await meterSettings()
    return topUpQuote(amountCents, settings.marginPercent, cardFeeMode(settings.topUp))
  },

  // ui 'elements' (the pay sheet) → { ui, clientSecret, sessionId }; 'hosted', or the sheet switched
  // off (public.stripe.inApp false) → { ui:'hosted', url, sessionId }. attemptId: the sheet's UUID v4.
  async [CONSTANTS.methods.wallet.createTopUp]({ amountCents, wallet = 'me', ui = 'hosted', attemptId } = {}) {
    check(amountCents, Match.Integer)
    check(wallet, Match.OneOf('me', 'team'))
    check(ui, Match.OneOf('elements', 'hosted'))
    check(attemptId, Match.Maybe(String))
    requireMeter()
    const { user, walletId } = await walletFor(wallet, true)
    if (!user.emails?.[0]?.verified) throw new Meteor.Error('unverified', 'Confirm your email address before you top up.')
    const settings = await meterSettings()
    try {
      return await startTopUp({ stripe: stripeClient(), customerFor: payerCustomer }, {
        user, walletId, wallet: await Wallets.findOneAsync({ _id: walletId }), settings: { ...settings.topUp, cardFee: cardFeeMode(settings.topUp) },
        amountCents, ui, attemptId, baseUrl: Meteor.settings.public.baseUrl, inApp: inAppOn(), now: Date.now(),
      })
    } catch (error) {
      throw asMethodError(error)
    }
  },

  // The return page asks until the payment is in the ledger (the webhook usually arrives first).
  async [CONSTANTS.methods.wallet.confirmTopUp]({ sessionId } = {}) {
    check(sessionId, String)
    requireMeter()
    const user = await Meteor.userAsync()
    if (!user) throw new Meteor.Error('sign-in', 'Sign in to see your balance.')
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Meteor.Error('invalid', 'This payment link is not valid.')
    const known = await WalletLedger.findOneAsync({ idempotencyKey: 'topup:' + sessionId })
    const settledOn = async walletId => (await Wallets.rawCollection().findOne({ _id: walletId }, { projection: { settledTopUps: 1 } }))?.settledTopUps?.[sessionId]
    // not in the ledger yet, or in it but not credited or refunded (a delivery stopped half way)
    if (!known || !await settledOn(known.walletId)) {
      const session = await stripeClient().checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] })
      const allowed = [`user:${user._id}`, ...(user.orgId ? [`org:${user.orgId}`] : [])]
      if (!allowed.includes(session.metadata?.walletId)) throw new Meteor.Error('invalid', 'This payment is not yours.')
      if (session.payment_status !== 'paid') return { status: 'pending' }
      await handleWalletEvent({ type: 'checkout.session.completed', data: { object: session } }, walletIo)
    }
    const entry = known || await WalletLedger.findOneAsync({ idempotencyKey: 'topup:' + sessionId })
    if (!entry) return { status: 'pending' }
    const settled = await settledOn(entry.walletId)
    if (settled === 'refused') return { status: 'refunded', amountCents: microsToCents(entry.amountMicros) }
    if (settled !== 'credited') return { status: 'pending' }
    const wallet = await Wallets.findOneAsync({ _id: entry.walletId })
    return { status: 'paid', amountCents: microsToCents(entry.amountMicros), balanceCents: microsToCents(wallet?.balanceMicros || 0) }
  },

  async [CONSTANTS.methods.wallet.refund]({ wallet = 'me' } = {}) {
    check(wallet, Match.OneOf('me', 'team'))
    requireMeter()
    const { walletId } = await walletFor(wallet, true)
    try {
      const result = await refundBalance(walletId)
      return { refundedCents: result.refundedCents }
    } catch (error) {
      if (error instanceof Meteor.Error) throw error
      console.error('refund failed', walletId, error.message)
      throw new Meteor.Error('refund-failed', `We could not refund your balance. Try again or write to us at ${BILLING_CONTACT_URL}.`)
    }
  },

  async [CONSTANTS.methods.wallet.charges]({ wallet = 'me' } = {}) {
    check(wallet, Match.OneOf('me', 'team'))
    const { walletId } = await walletFor(wallet, false)
    const entries = await WalletLedger.find({ walletId }, { sort: { created: -1 }, limit: 50, fields: { type: 1, amountMicros: 1, note: 1, created: 1 } }).fetchAsync()
    return entries.map(e => ({
      at: e.created, label: e.type === 'spend' ? `${e.note || 'Use'} (balance)` : LABELS[e.type] || 'Balance change',
      // spending is shown to a tenth of a cent; money in and out in cents
      amount: e.type === 'spend' ? -(Math.abs(e.amountMicros) / 1_000_000) : e.amountMicros / 1_000_000,
    }))
  },
})
