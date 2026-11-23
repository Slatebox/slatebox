// Slatebox Pro bought through Stripe: who has Pro, the checkout's terms, and Stripe webhook events
// turned into state. Pro is the one subscription Slatebox sells through Stripe (Slatebox Business
// is sold through the contact form until its billing is built). Pure apart from the injected Stripe client and store;
// the Meteor glue is server/methods/pro.js.
//
// Pro is a switch on the meter's monthly amount (policy.mjs), not money in a wallet: a webhook
// only records the subscription's state, read fresh from Stripe, so a retried or late event can
// never grant twice. A stale read never overwrites a newer one (store.writePro's fetchedAt guard).
import { PRO_SWITCH, monthShare, proNeeded } from './metering/policy.mjs'
import { PRO_PRODUCT, intervalOfLookupKey } from '../imports/api/pro/catalog.mjs'
import { SHEET_INTEGRATION, attemptPart, checkUi, checkoutMinute, sessionAnswer, sessionUi } from './pay-attempt.mjs'

// A renewal webhook can arrive a little after the period ends; credits stay on meanwhile.
export const PRO_GRACE_MS = 48 * 3600_000
export const CHECKOUT_MINUTES = 30
const LIVE_STATUSES = new Set(['active', 'trialing'])
// a status in which the person still holds a subscription they would pay for again. 'unpaid' is
// held too: if Stripe's failed-payment setting leaves a subscription unpaid instead of cancelling
// it, a second checkout must not start (pro.checkout) and a second subscription is still a duplicate.
export const HELD_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid'])

export const PRO_COPY = Object.freeze({
  already: 'You already have Slatebox Pro. Manage it in your profile.',
  unverified: 'Confirm your email address before you get Slatebox Pro.',
  unavailable: 'Slatebox Pro is not available on this server.',
  noCustomer: 'There is no Slatebox Pro to manage on this account.',
  notYours: 'This payment is not yours.',
  invalid: 'This payment link is not valid.',
  priceChanged: 'Slatebox Pro cannot be bought just now. Try again later.',
  notYet: 'Slatebox Pro is not sold on this server.',
})

// Pro is on sale where included AI and calls need it (settings.free.proRequiredFrom 'now' on
// Slatebox Cloud, or a set moment). With 'never' (self-host) the amount is everyone's and Pro is
// not sold. There is no free trial: Pro is paid from the first day.
export const proOnSale = settings => {
  const from = settings?.free?.proRequiredFrom
  return from === PRO_SWITCH.now || (typeof from === 'number' && Number.isFinite(from))
}

const ms = seconds => (Number.isFinite(seconds) ? seconds * 1000 : null)
const idOf = value => (typeof value === 'string' ? value : value?.id ?? null)

/** Real Pro, now: active or trialing, paid up to the period end (plus grace), no dispute hold. */
export function proActive(pro, now = Date.now()) {
  if (!pro || pro.hold) return false
  if (!LIVE_STATUSES.has(pro.status)) return false
  return now < (pro.currentPeriodEnd || 0) + PRO_GRACE_MS
}

/**
 * Whether this person skips the shared budget's stages (policy.mjs route's `pro`): live Pro.
 * Paying people are never paused by the shared budget. (A trial, if one is ever made in Stripe by
 * hand, counts once Pro is needed; before that it gets the amount like everyone else.)
 */
export function proExempt(pro, now, settings) {
  if (!proActive(pro, now)) return false
  return pro.status === 'active' || proNeeded(settings, now)
}

/** Whether the meter's monthly amount is this person's: everyone's where Pro is not needed (self-host), Pro's where it is (Cloud). */
export function proIncluded(pro, now, settings) {
  if (!proNeeded(settings, now)) return true
  return proActive(pro, now)
}

/**
 * The part of this calendar month (UTC) the person's Pro covers, for the meter's creditShare: from
 * the day the subscription was created, and up to the period end once it will not renew. 1 where
 * Pro is not needed (self-host) or there is no start to go by. Credits count per calendar month, so
 * without this a monthly Pro bought on the 30th would bring the rest of that month and all of the
 * next for one payment, and a year would bring thirteen months.
 */
export function proCreditShare(pro, now, settings) {
  if (!proNeeded(settings, now) || !pro) return 1
  const from = Number.isFinite(pro.created) ? pro.created : null
  const ending = pro.cancelAtPeriodEnd || !LIVE_STATUSES.has(pro.status)
  const until = ending && Number.isFinite(pro.currentPeriodEnd) ? pro.currentPeriodEnd : null
  if (from === null && until === null) return 1
  return monthShare({ from, until }, now)
}

export const proPastDue = pro => Boolean(pro && (pro.status === 'past_due' || pro.status === 'unpaid'))

const iso = value => (value ? new Date(value).toISOString() : null)

/** What a person and their agents see about their Pro (GET /api/v1/me ai.pro), or null. */
export function proSummary(pro, now = Date.now()) {
  if (!pro?.subscriptionId) return null
  const active = proActive(pro, now)
  return {
    active,
    status: pro.status,
    interval: pro.interval ?? null,
    renewsOn: active && !pro.cancelAtPeriodEnd ? iso(pro.currentPeriodEnd) : null,
    endsOn: pro.cancelAtPeriodEnd && active ? iso(pro.currentPeriodEnd) : null,
    cancelAtPeriodEnd: Boolean(pro.cancelAtPeriodEnd),
    trialEndsOn: pro.status === 'trialing' ? iso(pro.trialEnd) : null,
    pastDue: proPastDue(pro),
    onHold: Boolean(pro.hold),
  }
}

/** The product a subscription is for: 'pro' or null (a product Slatebox does not sell through Stripe). */
export function productOfSubscription(sub) {
  const products = (sub?.items?.data || []).map(item => idOf(item.price?.product))
  return products.includes(PRO_PRODUCT.id) ? 'pro' : null
}

/** users.pro, written from the Stripe subscription as just read. Period fields sit on the subscription in older
 *  API versions and on its items in newer ones. */
export function entitlementFromSubscription(sub, fetchedAt) {
  const item = sub.items?.data?.[0] || {}
  const lookupKey = item.price?.lookup_key ?? null
  return {
    customerId: idOf(sub.customer),
    subscriptionId: sub.id,
    status: sub.status,
    lookupKey,
    interval: item.price?.recurring?.interval ?? intervalOfLookupKey(lookupKey),
    currentPeriodStart: ms(sub.current_period_start ?? item.current_period_start),
    currentPeriodEnd: ms(sub.current_period_end ?? item.current_period_end),
    trialEnd: ms(sub.trial_end) ?? null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    canceledAt: ms(sub.canceled_at) ?? null,
    endedAt: ms(sub.ended_at) ?? null,
    created: ms(sub.created),
    // a pending change at renewal (year → month, pro-manage.mjs); every read writes what Stripe says now
    scheduleId: idOf(sub.schedule) ?? null,
    fetchedAt,
  }
}

// Checkout sessions are made with an idempotency key per person, interval, mode and attempt (the
// pay sheet's UUID, pay-attempt.mjs): a double click makes one session, a second purchase another.
// A caller without an attempt is keyed on the minute, as before. Stripe refuses a reused key with
// different parameters, so everything in them is fixed for that minute: the expiry counts from the
// minute's start, 31 minutes on, which is always past Stripe's 30-minute minimum.
export { checkoutMinute }
export const proCheckoutKey = (userId, interval, now, { ui = 'hosted', attemptId } = {}) =>
  `pro:${userId}:${interval}:${checkUi(ui)}:${attemptPart(attemptId, now)}`

/**
 * The Checkout Session for Pro: paid from the first day (no trial). Prices are tax-exclusive and
 * Stripe Tax adds tax where applicable (automatic_tax, with the address it needs). ui 'elements' is
 * the in-app pay sheet (Payment Element; return_url for methods that leave the page), 'hosted' the
 * redirect to Stripe's page. With a customer, the sheet offers to save the card (redisplayed only
 * with that consent: allow_redisplay 'always'; never widened to 'limited').
 */
export function proCheckoutParams({ userId, email, customerId = null, priceId, baseUrl, ui = 'hosted', now = Date.now() }) {
  const metadata = { product: 'pro', userId }
  const back = `${baseUrl}/profile?tab=credits&pro={CHECKOUT_SESSION_ID}`
  return {
    ...(checkUi(ui) === 'elements' && { ui_mode: 'elements' }),
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    ...(customerId ? { customer: customerId, customer_update: { address: 'auto', name: 'auto' } } : { customer_email: email }),
    client_reference_id: userId,
    metadata,
    subscription_data: { metadata: { ...metadata } },
    payment_method_collection: 'always',
    automatic_tax: { enabled: true },
    billing_address_collection: 'auto',
    expires_at: checkoutMinute(now) * 60 + (CHECKOUT_MINUTES + 1) * 60,
    ...(ui === 'elements'
      ? { return_url: back, integration_identifier: SHEET_INTEGRATION, ...(customerId && { saved_payment_method_options: { payment_method_save: 'enabled' } }) }
      : { success_url: back, cancel_url: `${baseUrl}/profile?tab=credits` }),
  }
}

/**
 * Makes the Pro session. → { ui:'elements', clientSecret, sessionId } | { ui:'hosted', url, sessionId }.
 * The sheet's mode only where in-app payments are on (inApp); otherwise today's redirect.
 */
export async function startProCheckout({ stripe }, { userId, email, customerId = null, price, interval, baseUrl, ui = 'hosted', attemptId, inApp, now = Date.now() }) {
  const mode = sessionUi(ui, inApp)
  const key = proCheckoutKey(userId, interval, now, { ui: mode, attemptId })
  const params = proCheckoutParams({ userId, email, customerId, priceId: price.id, baseUrl, ui: mode, now })
  return sessionAnswer(mode, await stripe.checkout.sessions.create(params, { idempotencyKey: key }))
}

/** The catalogue price for an interval, checked against Stripe's: product and amount must match. */
export function checkProPrice(price, want) {
  if (!price) return 'missing'
  if (idOf(price.product) !== PRO_PRODUCT.id) return 'product'
  if (price.unit_amount !== want.unitAmount || price.currency !== PRO_PRODUCT.currency) return 'amount'
  if (price.recurring?.interval !== want.interval) return 'interval'
  if (price.active === false) return 'inactive'
  return null
}

/**
 * deps: { stripe (subscriptions.retrieve/cancel, invoices.retrieve, invoicePayments.list, refunds.create, charges.retrieve),
 *         store, alert(text), now() }
 * store: { findProUser({ userId, customerId, subscriptionId }) → { _id, pro } | null,
 *          writePro(userId, fields, fetchedAt) → boolean (only when no newer read was written),
 *          setProCustomer(userId, customerId) → boolean (only when unset or equal),
 *          setProHold(userId, hold) , findUserByProCustomer(customerId) → { _id, pro } | null,
 *          audit(entry) }
 */
// A dispute hold belongs to the subscription it was raised on: a new subscription (bought again
// after a lost dispute, or after the old one was cancelled) starts without it.
const clearsHold = (stored, sub) => (stored?.hold && stored.subscriptionId !== sub.id ? { hold: null } : {})

// fetchedAt is the moment the read of Stripe STARTED: a caller that has already read the
// subscription passes the time it started that read with it. Stamping after the read would let a
// read that started earlier but returned later look newer, and overwrite the fresher state.
export async function syncSubscription(deps, subscriptionId, { userId = null, sub: given = null, fetchedAt: givenAt = null } = {}) {
  const { stripe, store, alert, now } = deps
  if (given && givenAt == null) throw new Error('syncSubscription: pass fetchedAt (taken before the read) with sub')
  const fetchedAt = given ? givenAt : now()
  const sub = given || await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })
  const kind = productOfSubscription(sub)
  if (kind !== 'pro') return { kind: null }
  const customerId = idOf(sub.customer)
  const user = await store.findProUser({ userId: sub.metadata?.userId || userId, customerId, subscriptionId: sub.id })
  if (!user) {
    await alert(`A Slatebox Pro subscription has no account: ${sub.id} (${customerId}).`)
    return { kind, handled: true, user: null }
  }
  const stored = user.pro
  if (stored?.subscriptionId && stored.subscriptionId !== sub.id) {
    // An older subscription that has ended never replaces the one the account holds.
    if (!HELD_STATUSES.has(sub.status)) return { kind, handled: true, ignored: 'ended' }
    // Two subscriptions held at once (two checkouts paid in a race): the later one is cancelled at
    // once and its payment refunded in full; the first stays.
    const other = await stripe.subscriptions.retrieve(stored.subscriptionId, { expand: ['items.data.price'] }).catch(() => null)
    if (other && HELD_STATUSES.has(other.status)) {
      const [keep, drop] = (other.created ?? 0) <= (sub.created ?? 0) ? [other, sub] : [sub, other]
      await cancelDuplicate(deps, drop, user._id)
      if (keep.id !== stored.subscriptionId) await store.writePro(user._id, { ...entitlementFromSubscription(keep, fetchedAt), ...clearsHold(stored, keep) }, fetchedAt)
      return { kind, handled: true, duplicate: drop.id }
    }
  }
  const written = await store.writePro(user._id, { ...entitlementFromSubscription(sub, fetchedAt), ...clearsHold(stored, sub) }, fetchedAt)
  return { kind, handled: true, user: user._id, written }
}

/**
 * What to refund for an invoice's payment: { payment_intent } or { charge }, or null. From Basil on
 * (the pinned API version) it is the paid entry of invoice.payments (read with
 * expand: ['payments.data.payment.payment_intent']); an invoice in an older version's shape
 * carries payment_intent / charge itself. A duplicate's first invoice is paid once, so the first
 * paid payment is the whole of it.
 */
export function refundTargetOfInvoice(invoice) {
  const paid = (invoice?.payments?.data || []).find(p => p?.status === 'paid')
  const paymentIntent = idOf(paid?.payment?.payment_intent) ?? (paid ? null : idOf(invoice?.payment_intent))
  const charge = idOf(paid?.payment?.charge) ?? (paid ? null : idOf(invoice?.charge))
  if (paymentIntent) return { payment_intent: paymentIntent }
  if (charge) return { charge }
  return null
}

/**
 * Whether a charge paid an invoice (a Pro payment) rather than a top-up. Older API versions put
 * the invoice on the charge; from Basil on it is found through the invoice payment for the
 * charge's payment intent.
 */
export async function chargePaidAnInvoice(stripe, charge) {
  if (!charge) return false
  if (charge.invoice) return true
  const paymentIntent = idOf(charge.payment_intent)
  if (!paymentIntent || !stripe?.invoicePayments?.list) return false
  const listed = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntent }, limit: 1 })
  return (listed?.data || []).length > 0
}

async function cancelDuplicate({ stripe, store, alert }, sub, userId) {
  const key = 'pro-duplicate:' + sub.id
  if (sub.status !== 'canceled') {
    await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false }, { idempotencyKey: key + ':cancel' })
  }
  const invoiceId = idOf(sub.latest_invoice)
  const invoice = invoiceId ? await stripe.invoices.retrieve(invoiceId, { expand: ['payments.data.payment.payment_intent'] }) : null
  const target = invoice?.amount_paid > 0 ? refundTargetOfInvoice(invoice) : null
  if (target) {
    await stripe.refunds.create({ ...target, metadata: { requestId: key, product: 'pro' } }, { idempotencyKey: key })
  }
  await store.audit({ type: 'pro-duplicate-cancelled', userId, subscriptionId: sub.id })
  await alert(`A second Slatebox Pro subscription was cancelled and refunded: ${sub.id} (account ${userId}).`)
}

/**
 * users.pro.actionNeeded: a Pro invoice whose payment waits for the person (3DS on a renewal, a
 * retried past-due payment or a switch). Set only while a fresh read of the invoice says it is still
 * open, so an event that arrives after the payment never sets it again; cleared by that invoice's
 * payment, and by an expired pending switch (which also leaves a notice: the switch did not happen).
 */
async function recordAction({ stripe, store, now }, type, object, sub) {
  if (!['invoice.payment_action_required', 'invoice.paid', 'customer.subscription.pending_update_expired'].includes(type)) return
  const user = await store.findProUser({ subscriptionId: sub.id })
  if (!user || user.pro?.subscriptionId !== sub.id) return
  if (type === 'invoice.paid') {
    await store.clearProAction(user._id, object.id)
  } else if (type === 'customer.subscription.pending_update_expired') {
    await store.clearProAction(user._id, null)
    await store.setProFields(user._id, { switchExpiredAt: now() })
  } else {
    const invoice = await stripe.invoices.retrieve(object.id)
    if (invoice?.status === 'open') await store.setProFields(user._id, { actionNeeded: { invoiceId: invoice.id, at: now() } })
  }
}

const subscriptionOfInvoice = invoice => idOf(invoice?.subscription) ?? idOf(invoice?.parent?.subscription_details?.subscription)

/** One Stripe event. → { handled: boolean } (unhandled events go on to the top-up handler). */
export async function handleBillingEvent(event, deps) {
  const { stripe, store, alert } = deps
  const object = event?.data?.object || {}
  const type = event?.type || ''
  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (object.mode !== 'subscription' || !object.subscription) return { handled: false }
      const customerId = idOf(object.customer)
      if (object.metadata?.product === 'pro') {
        const userId = object.client_reference_id
        if (userId && customerId) await store.setProCustomer(userId, customerId)
        return { handled: true, ...await syncSubscription(deps, idOf(object.subscription), { userId }) }
      }
      const fetchedAt = deps.now()
      const sub = await stripe.subscriptions.retrieve(idOf(object.subscription), { expand: ['items.data.price'] })
      const kind = productOfSubscription(sub)
      if (kind === 'pro') return { handled: true, ...await syncSubscription(deps, sub.id, { sub, fetchedAt }) }
      await alert(`A subscription for an unknown product: ${sub.id}`)
      return { handled: true }
    }
    case 'charge.refunded': {
      const customerId = idOf(object.customer)
      const user = customerId ? await store.findUserByProCustomer(customerId) : null
      if (!user) return { handled: false }
      // a top-up refund on a Pro customer is the top-up handler's
      if (!await chargePaidAnInvoice(stripe, object)) return { handled: false }
      await store.audit({ type: 'pro-refund', userId: user._id, chargeId: object.id, amountRefunded: object.amount_refunded })
      await alert(`A Slatebox Pro payment was refunded in Stripe: ${object.id}. Pro stays on until it is cancelled.`)
      return { handled: true }
    }
    case 'charge.dispute.created':
    case 'charge.dispute.closed': {
      const charge = object.charge ? await stripe.charges.retrieve(idOf(object.charge)) : null
      const customerId = idOf(charge?.customer)
      const user = customerId ? await store.findUserByProCustomer(customerId) : null
      if (!user) return { handled: false }
      if (!await chargePaidAnInvoice(stripe, charge)) return { handled: false }
      if (type === 'charge.dispute.created') {
        await store.setProHold(user._id, 'dispute')
        await alert(`A card dispute was opened on a Slatebox Pro payment: ${charge.id} (account ${user._id}). Pro credits are paused.`)
      } else if (object.status === 'won') {
        await store.setProHold(user._id, null)
        await alert(`A card dispute on a Slatebox Pro payment was won: ${charge.id}. Pro credits are back on.`)
      } else {
        await alert(`A card dispute on a Slatebox Pro payment closed as ${object.status}: ${charge.id}. Pro credits stay paused; cancel the subscription if it should end.`)
      }
      return { handled: true }
    }
    default: {
      let subscriptionId = null
      if (/^customer\.subscription\./.test(type)) subscriptionId = object.id
      else if (/^invoice\./.test(type)) subscriptionId = subscriptionOfInvoice(object)
      else if (/^subscription_schedule\./.test(type)) subscriptionId = idOf(object.subscription) ?? idOf(object.released_subscription)
      else return { handled: false }
      if (!subscriptionId) return { handled: false }
      const fetchedAt = deps.now()
      const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })
      const out = await syncSubscription(deps, subscriptionId, { sub, fetchedAt })
      if (out.kind) {
        await recordAction(deps, type, object, sub)
        return { handled: true }
      }
      // Pro is the only subscription Slatebox sells through Stripe; anything else is looked at.
      await alert(`A subscription for an unknown product: ${subscriptionId}`)
      return { handled: true }
    }
  }
}
