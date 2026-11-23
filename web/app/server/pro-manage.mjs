// Slatebox Pro managed in the pay sheet (design §3.2): switch monthly ↔ yearly, stop or keep
// renewing, change the card, confirm a payment that waits for the person, and receipts. The
// customer portal stays as the fallback link. Pure apart from the injected Stripe client and store;
// the Meteor glue is server/methods/pro.js.
//
// The subscription is always the one on users.pro (never a method argument) and must be on the
// stored customer. Every change ends with a fresh read of the subscription written through
// pro-billing.mjs syncSubscription, so the account shows what Stripe says now (the webhook does the
// same, in any order).
//
// deps: { stripe, store, alert(text), now() } — the same as pro-billing.mjs, with the store's
//   setProFields(userId, fields) and clearProAction(userId, invoiceId|null).
import { HELD_STATUSES, syncSubscription } from './pro-billing.mjs'
import { SHEET_INTEGRATION, attemptPart, checkUi, checkoutMinute, payError } from './pay-attempt.mjs'

export const MANAGE_COPY = Object.freeze({
  none: 'There is no Slatebox Pro to manage on this account.',
  notYours: 'This is not your Slatebox Pro.',
  same: 'Your Pro already renews that way.',
  noAction: 'There is nothing to confirm.',
  ended: 'This Slatebox Pro has ended. Get Pro again from your profile.',
  declined: 'Your card was declined. Nothing was charged. Try another card.',
  switchFailed: 'We could not set up the switch to monthly. Nothing changed. Try again.',
})

const idOf = value => (typeof value === 'string' ? value : value?.id ?? null)
const iso = seconds => (Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null)
const LIVE = new Set(['active', 'trialing'])
const ENDED_SCHEDULE = new Set(['released', 'canceled', 'completed'])

/** The subscription on users.pro, read fresh and checked against the stored customer. */
export async function readOwnSubscription(stripe, pro, { live = true } = {}) {
  if (!pro?.subscriptionId || !pro.customerId) throw payError('pro-none', MANAGE_COPY.none)
  const sub = await stripe.subscriptions.retrieve(pro.subscriptionId, { expand: ['items.data.price'] })
  if (!sub || idOf(sub.customer) !== pro.customerId) throw payError('not-yours', MANAGE_COPY.notYours)
  if (live && !HELD_STATUSES.has(sub.status)) throw payError('pro-ended', MANAGE_COPY.ended)
  return sub
}

const itemOf = sub => sub.items?.data?.[0] || {}
const intervalOf = sub => itemOf(sub).price?.recurring?.interval ?? null
const periodEnd = sub => sub.current_period_end ?? itemOf(sub).current_period_end

async function syncFresh(deps, userId, subscriptionId) {
  return syncSubscription(deps, subscriptionId, { userId })
}

// ---------- switch monthly ↔ yearly ----------

const taxOf = invoice => (invoice?.total_taxes || []).reduce((sum, t) => sum + (t.amount || 0), 0) || invoice?.tax || 0

/**
 * What a switch costs. Month → year is invoiced now with proration (Stripe's preview, tax included);
 * year → month starts at renewal, so nothing is paid today.
 * → { interval, atRenewal, todayCents, taxCents, nextAmountCents, nextDate }
 */
export async function previewSwitch({ stripe }, { pro, prices, interval }) {
  const sub = await readOwnSubscription(stripe, pro)
  const current = intervalOf(sub)
  if (interval === current) throw payError('same', MANAGE_COPY.same)
  if (interval === 'month') {
    return { interval, atRenewal: true, todayCents: 0, taxCents: 0, nextAmountCents: prices.month.unit_amount, nextDate: iso(periodEnd(sub)) }
  }
  const invoice = await stripe.invoices.createPreview({
    customer: pro.customerId, subscription: sub.id,
    subscription_details: { items: [{ id: itemOf(sub).id, price: prices.year.id }], proration_behavior: 'always_invoice' },
  })
  const ends = (invoice.lines?.data || []).map(l => l.period?.end).filter(Number.isFinite)
  return {
    interval, atRenewal: false, todayCents: invoice.amount_due ?? invoice.total ?? 0, taxCents: taxOf(invoice),
    nextAmountCents: prices.year.unit_amount, nextDate: iso(ends.length ? Math.max(...ends) : null),
  }
}

async function releaseSchedule(stripe, scheduleId) {
  await stripe.subscriptionSchedules.release(scheduleId, {}, { idempotencyKey: `release:${scheduleId}` })
}

// The payment intent of the invoice a pending update made (Basil: through invoice.payments).
const intentOfInvoice = invoice => {
  const payments = invoice?.payments?.data || []
  const intent = payments.map(p => p.payment?.payment_intent).find(pi => pi && typeof pi === 'object')
  return intent ?? (typeof invoice?.payment_intent === 'object' ? invoice.payment_intent : null)
}

/**
 * Month → year: now, invoiced with proration; if the card needs 3DS the update waits (pending) and
 * the sheet confirms it (actionSecret + handleNextAction); an unconfirmed pending update expires.
 * Year → month: at renewal, through a subscription schedule (the year runs out; nobody is refunded
 * part of it). The same interval while a schedule is pending ("Keep yearly") releases the schedule.
 * → { status: 'switched' | 'needs-action' | 'declined' | 'scheduled' | 'kept', ... }
 *
 * attemptId: the sheet's UUID v4, new on every tap. Stripe keeps a key's first answer for 24 hours,
 * success or failure, so the writes are keyed per attempt: a switch declined on the old card, or a
 * schedule released by "Keep yearly", is never replayed to a later tap. A retried call of the same
 * tap still collapses. Without an attempt the key is the minute (attemptPart).
 */
export async function switchInterval(deps, { userId, pro, prices, interval, attemptId }) {
  const { stripe, store, now } = deps
  const attempt = attemptPart(attemptId, now())
  const sub = await readOwnSubscription(stripe, pro)
  if (!LIVE.has(sub.status)) throw payError('pro-past-due', 'Update your card before you change how Pro renews.')
  const current = intervalOf(sub)
  const scheduleId = idOf(sub.schedule)
  if (interval === current) {
    if (!scheduleId) throw payError('same', MANAGE_COPY.same)
    await releaseSchedule(stripe, scheduleId)
    await syncFresh(deps, userId, sub.id)
    return { status: 'kept', interval }
  }
  if (interval === 'year') {
    if (scheduleId) await releaseSchedule(stripe, scheduleId)
    const price = prices.year
    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: itemOf(sub).id, price: price.id }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
      expand: ['latest_invoice.payments.data.payment.payment_intent'],
    }, { idempotencyKey: `switch:${sub.id}:${price.id}:${attempt}` })
    if (updated.pending_update) {
      const invoice = updated.latest_invoice
      const intent = intentOfInvoice(invoice)
      if (intent?.status === 'requires_action' || intent?.status === 'requires_confirmation') {
        await store.setProFields(userId, { actionNeeded: { invoiceId: idOf(invoice), at: now(), kind: 'switch' } })
        return { status: 'needs-action', needsAction: true }
      }
      // declined: the pending update is left to expire, and Pro stays monthly
      return { status: 'declined', message: intent?.last_payment_error?.message || MANAGE_COPY.declined }
    }
    await syncFresh(deps, userId, sub.id)
    return { status: 'switched', interval: 'year' }
  }
  // year → month at renewal
  if (scheduleId) return { status: 'scheduled', interval: 'month', from: iso(periodEnd(sub)) }
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id }, { idempotencyKey: `schedule:${sub.id}:${attempt}` })
  const [phase] = schedule.phases || []
  const metadata = { ...sub.metadata }
  const updated = await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    phases: [
      {
        items: (phase.items || []).map(i => ({ price: idOf(i.price), quantity: i.quantity ?? 1 })),
        start_date: phase.start_date,
        end_date: phase.end_date,
        ...(phase.automatic_tax && { automatic_tax: { enabled: Boolean(phase.automatic_tax.enabled) } }),
        ...(idOf(phase.default_payment_method) && { default_payment_method: idOf(phase.default_payment_method) }),
        metadata,
      },
      {
        // no default_payment_method here: the phase follows the schedule's default, which a card change updates
        items: [{ price: prices.month.id, quantity: 1 }],
        duration: { interval: 'month', interval_count: 1 },
        proration_behavior: 'none',
        automatic_tax: { enabled: true },
        metadata,
      },
    ],
  }, { idempotencyKey: `schedule-update:${schedule.id}:${attempt}` })
  // 'scheduled' only when the subscription now carries this schedule, still live
  const after = await stripe.subscriptions.retrieve(sub.id)
  if (idOf(after?.schedule) !== schedule.id || ENDED_SCHEDULE.has(updated?.status)) {
    await syncFresh(deps, userId, sub.id)
    throw payError('switch-failed', MANAGE_COPY.switchFailed)
  }
  await syncFresh(deps, userId, sub.id)
  return { status: 'scheduled', interval: 'month', from: iso(periodEnd(sub)) }
}

// ---------- renewal ----------

/**
 * "Stop renewing" (renew false) / "Keep Pro" (renew true): cancel_at_period_end; Pro stays on until
 * the period ends. A subscription with a schedule is changed through the Schedule API, so the
 * pending switch is released first (the sheet's confirm says the switch is dropped).
 *
 * attemptId: the sheet's UUID v4, new on every tap, like the switch: Stripe keeps a key's first
 * answer for 24 hours, so "Stop renewing", "Keep Pro", "Stop renewing" inside one minute is never
 * answered from the first tap. Without an attempt the key is the minute, as before.
 */
export async function setRenewal(deps, { userId, pro, renew, attemptId }) {
  const { stripe, now } = deps
  const attempt = attemptId == null ? checkoutMinute(now()) : attemptPart(attemptId, now())
  const sub = await readOwnSubscription(stripe, pro)
  const scheduleId = idOf(sub.schedule)
  if (!renew && scheduleId) await releaseSchedule(stripe, scheduleId)
  if (Boolean(sub.cancel_at_period_end) !== !renew) {
    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: !renew }, { idempotencyKey: `renewal:${sub.id}:${renew}:${attempt}` })
  }
  await syncFresh(deps, userId, sub.id)
  return { status: renew ? 'renewing' : 'ending', until: renew ? null : iso(periodEnd(sub)) }
}

// ---------- card ----------

// Per attempt when the sheet sends one (a card declined on a past-due payment can try another at
// once); the minute otherwise, as before. A malformed attempt is refused.
export const cardSessionKey = (userId, now, attemptId) => (attemptId == null
  ? `card:${userId}:${checkoutMinute(now)}`
  : `card:${userId}:${attemptPart(attemptId, now)}`)

/** The setup session that changes Pro's card (in the sheet, or Stripe's page where the sheet is off). */
export function cardSessionParams({ userId, customerId, baseUrl, ui = 'elements' }) {
  const metadata = { userId, purpose: 'pro-card' }
  const back = `${baseUrl}/profile?tab=credits&card={CHECKOUT_SESSION_ID}`
  return {
    ...(checkUi(ui) === 'elements' && { ui_mode: 'elements' }),
    mode: 'setup',
    currency: 'usd',
    customer: customerId,
    metadata,
    setup_intent_data: { metadata: { ...metadata } },
    ...(ui === 'elements'
      ? { return_url: back, integration_identifier: SHEET_INTEGRATION }
      : { success_url: back, cancel_url: `${baseUrl}/profile?tab=credits` }),
  }
}

const cardError = error => error?.type === 'StripeCardError' || error?.rawType === 'card_error' || error?.statusCode === 402
const needsAction = error => error?.code === 'invoice_payment_intent_requires_action'
  || error?.raw?.payment_intent?.status === 'requires_action' || error?.payment_intent?.status === 'requires_action'

/**
 * A completed card setup (from pro.cardConfirm or the webhook): the new card becomes the customer's
 * and the subscription's default (and the schedule's, when one is attached: Stripe copies the
 * default into a schedule's phases). If Pro is past due, the open invoice is paid with it; that
 * charge can itself need 3DS (actionNeeded, needsAction). Checks the state first, so running it
 * twice changes nothing.
 * → { status: 'pending' | 'updated' | 'needs-action' | 'declined', paidInvoice?, message? }
 */
export async function applyDefaultCard(deps, { userId, pro, session }) {
  const { stripe, store, now } = deps
  if (session?.mode !== 'setup' || session.metadata?.purpose !== 'pro-card' || session.metadata?.userId !== userId) throw payError('not-yours', MANAGE_COPY.notYours)
  if (!pro?.customerId || idOf(session.customer) !== pro.customerId) throw payError('not-yours', MANAGE_COPY.notYours)
  if (session.status !== 'complete') return { status: 'pending' }
  const intent = typeof session.setup_intent === 'object' && session.setup_intent?.status ? session.setup_intent : await stripe.setupIntents.retrieve(idOf(session.setup_intent))
  if (intent?.status !== 'succeeded') return { status: 'pending' }
  const pm = idOf(intent.payment_method)
  const customer = await stripe.customers.retrieve(pro.customerId)
  if (idOf(customer?.invoice_settings?.default_payment_method) !== pm) {
    await stripe.customers.update(pro.customerId, { invoice_settings: { default_payment_method: pm } }, { idempotencyKey: `card-default:${pro.customerId}:${pm}` })
  }
  if (!pro.subscriptionId) return { status: 'updated' }
  const sub = await stripe.subscriptions.retrieve(pro.subscriptionId)
  if (!sub || idOf(sub.customer) !== pro.customerId || !HELD_STATUSES.has(sub.status)) return { status: 'updated' }
  if (idOf(sub.default_payment_method) !== pm) {
    await stripe.subscriptions.update(sub.id, { default_payment_method: pm }, { idempotencyKey: `card-sub:${sub.id}:${pm}` })
  }
  const scheduleId = idOf(sub.schedule)
  if (scheduleId) {
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
    if (schedule && idOf(schedule.default_settings?.default_payment_method) !== pm) {
      await stripe.subscriptionSchedules.update(scheduleId, { default_settings: { default_payment_method: pm } }, { idempotencyKey: `card-schedule:${scheduleId}:${pm}` })
    }
  }
  let paidInvoice = false
  if (sub.status === 'past_due' || sub.status === 'unpaid') {
    const invoiceId = idOf(sub.latest_invoice)
    const invoice = invoiceId ? await stripe.invoices.retrieve(invoiceId) : null
    if (invoice?.status === 'open' && idOf(invoice.customer) === pro.customerId) {
      try {
        await stripe.invoices.pay(invoice.id, { payment_method: pm, off_session: false }, { idempotencyKey: `card-pay:${invoice.id}:${pm}` })
        paidInvoice = true
      } catch (error) {
        if (needsAction(error)) {
          await store.setProFields(userId, { actionNeeded: { invoiceId: invoice.id, at: now(), kind: 'card' } })
          return { status: 'needs-action', needsAction: true }
        }
        if (cardError(error)) return { status: 'declined', message: error.message || MANAGE_COPY.declined }
        throw error
      }
    }
  }
  await syncFresh(deps, userId, sub.id)
  if (paidInvoice) await store.clearProAction(userId, idOf(sub.latest_invoice))
  return { status: 'updated', ...(paidInvoice && { paidInvoice }) }
}

/**
 * The confirmation secret of the recorded invoice that waits for the person (handleNextAction in
 * the sheet). An invoice that is no longer open clears the record and reads the subscription again.
 * → { clientSecret } | { status:'done' }
 */
export async function actionSecret(deps, { userId, pro }) {
  const { stripe, store } = deps
  const invoiceId = pro?.actionNeeded?.invoiceId
  if (!invoiceId) throw payError('no-action', MANAGE_COPY.noAction)
  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['confirmation_secret'] })
  if (!invoice || idOf(invoice.customer) !== pro.customerId) throw payError('not-yours', MANAGE_COPY.notYours)
  if (invoice.status !== 'open' || !invoice.confirmation_secret?.client_secret) {
    await store.clearProAction(userId, invoiceId)
    // the bank confirmed in the sheet (no webhook needed): Your Pro shows the switch or the card at once
    if (pro.subscriptionId && deps.now) await syncFresh(deps, userId, pro.subscriptionId)
    return { status: 'done' }
  }
  return { clientSecret: invoice.confirmation_secret.client_secret }
}

/** The card Manage shows: brand, last four, expiry. Nothing else leaves the server. */
export function cardOf(pm) {
  const card = pm && typeof pm === 'object' ? pm.card : null
  if (!card) return null
  return { brand: card.brand ?? null, last4: card.last4 ?? null, expMonth: card.exp_month ?? null, expYear: card.exp_year ?? null }
}

/** Receipts for Manage: the number, date, total, status and Stripe's own links. No ids, no customer. */
export function invoiceRows(list) {
  return (list?.data || []).filter(i => i.number && i.status !== 'draft').map(i => ({
    number: i.number, created: (i.created ?? 0) * 1000, totalCents: i.total ?? 0, status: i.status,
    url: i.hosted_invoice_url ?? null, pdf: i.invoice_pdf ?? null,
  }))
}

// ---------- webhook ----------

/**
 * Setup sessions (the card change), after Pro and top-ups (stripeHooks.js). Ours carry
 * metadata.purpose 'pro-card'; any other setup session is not handled. → { handled }
 */
export async function handleSetupEvent(event, deps) {
  const type = event?.type || ''
  const object = event?.data?.object || {}
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(type)) return { handled: false }
  if (object.mode !== 'setup' || object.metadata?.purpose !== 'pro-card') return { handled: false }
  const userId = object.metadata?.userId
  const user = userId ? await deps.store.findProUser({ userId }) : null
  if (!user) {
    await deps.alert(`A card change finished for no account: ${object.id}.`)
    return { handled: true }
  }
  try {
    const out = await applyDefaultCard(deps, { userId: user._id, pro: user.pro, session: object })
    if (out.status !== 'pending') deps.onCard?.(user._id)
    return { handled: true, ...out }
  } catch (error) {
    if (error.error !== 'not-yours') throw error
    await deps.alert(`A card change was for another customer and was not applied: ${object.id} (account ${user._id}).`)
    return { handled: true }
  }
}
