// Slatebox Business bought in the app: a team owner or admin pays for the whole team, per member,
// monthly or yearly. Pure apart from the injected Stripe client and store; the Meteor glue is
// server/methods/business.js.
//
// Nothing about the price is written here. The two Stripe prices are named in settings
// (settings.payments.business.monthly / .yearly, price ids made by the owner in Stripe), and the
// amount people see in the sheet is the one Stripe returns for them. Without both ids Business is
// not on sale in the app and people talk to us (business/catalog.mjs BUSINESS_CONTACT_URL).
//
// organizations.business is written from the subscription, read fresh from Stripe, the same way
// users.pro is (pro-billing.mjs): a webhook only records state, so a retried or late event never
// grants twice, and a write from an older read never replaces a newer one. A membership written by
// staff for a contract (no source, or source 'contract') is never overwritten while it runs.
//
// Payments run only on Slatebox Cloud by its signed Cloud key (server/cloud-lock.mjs): the Meteor
// glue never builds a Stripe client elsewhere, so nothing here runs on a self-hosted server.
import { randomUUID } from 'node:crypto'
import { HELD_STATUSES, PRO_GRACE_MS, chargePaidAnInvoice, refundTargetOfInvoice } from './pro-billing.mjs'
import { SHEET_INTEGRATION, attemptPart, checkUi, checkoutMinute, sessionAnswer, sessionUi } from './pay-attempt.mjs'
import { businessActive } from '../imports/api/business/membership.mjs'
import { BUSINESS_PRICES } from '../imports/api/business/catalog.mjs'

export const BUSINESS_INTERVALS = Object.freeze(['month', 'year'])
const SETTING_OF = Object.freeze({ month: 'monthly', year: 'yearly' })
const PRICE_ID = /^price_[A-Za-z0-9_]+$/
const LIVE_STATUSES = new Set(['active', 'trialing'])
export const BUSINESS_CHECKOUT_MINUTES = 30

export const BUSINESS_COPY = Object.freeze({
  notOnSale: 'Slatebox Business is not sold in the app on this server. Talk to us about Business.',
  unavailable: 'Slatebox Business is not available on this server.',
  noTeam: 'Make a team first, then get Slatebox Business for it.',
  notAdmin: 'Only an owner or admin of the team can get or change Slatebox Business.',
  already: 'Your team already has Slatebox Business. Manage it on the team page.',
  contract: 'Your team has Slatebox Business through an agreement with us. Write to us to change it.',
  none: 'Your team has no Slatebox Business to manage here.',
  notYours: 'This payment is not for your team.',
  invalid: 'This payment link is not valid.',
  priceProblem: 'Slatebox Business cannot be bought just now. Try again later.',
})

const idOf = value => (typeof value === 'string' ? value : value?.id ?? null)
const ms = seconds => (Number.isFinite(seconds) ? seconds * 1000 : null)

/** The configured price ids: { month, year } (each a price_ id or null). */
export function businessPriceIds(settings) {
  const named = settings?.payments?.business || {}
  return Object.fromEntries(BUSINESS_INTERVALS.map(interval => {
    const id = named[SETTING_OF[interval]]
    return [interval, typeof id === 'string' && PRICE_ID.test(id.trim()) ? id.trim() : null]
  }))
}

/** On sale in the app: both prices named in settings. Otherwise "Talk to us" as before. */
export function businessOnSale(settings) {
  const ids = businessPriceIds(settings)
  return Boolean(ids.month && ids.year)
}

/**
 * A Stripe price as read, checked against what it must be for Business: recurring at the interval,
 * per member (licensed, per unit, a unit amount), active. The amount itself is whatever Stripe
 * says: it is shown in the sheet as read. → problem string | null
 */
export function checkBusinessPrice(price, interval) {
  if (!price) return 'missing'
  if (price.active === false) return 'inactive'
  if (price.type && price.type !== 'recurring') return 'not recurring'
  if (price.recurring?.interval !== interval || (price.recurring?.interval_count ?? 1) !== 1) return 'interval'
  if (price.recurring?.usage_type && price.recurring.usage_type !== 'licensed') return 'usage'
  if (price.billing_scheme && price.billing_scheme !== 'per_unit') return 'scheme'
  if (!Number.isInteger(price.unit_amount) || price.unit_amount <= 0) return 'amount'
  if (typeof price.currency !== 'string' || !price.currency) return 'currency'
  return null
}

/**
 * Whether Stripe's price differs from the figure the pricing page states (catalog.mjs
 * BUSINESS_PRICES): the server alerts so the page is brought in line. It never changes what is
 * shown or charged: that is Stripe's amount.
 */
export function pricingPageDiffers(price, interval) {
  const stated = BUSINESS_PRICES.find(p => p.interval === interval)
  if (!stated || !price) return false
  return price.currency !== 'usd' || price.unit_amount !== stated.unitAmountPerSeat
}

/** What the sheet shows for a price: the amount per member, read from Stripe. */
export const offerOfPrice = (price, interval) => ({ interval, unitAmount: price.unit_amount, currency: price.currency })

/**
 * Whether a team member has joined: an invitation creates the account at once (team-invitations.mjs),
 * with no password, an unconfirmed address and no sign-in. A member who confirmed the address (the
 * enrollment link does), set a password or has signed in has accepted.
 */
export function acceptedMember(user) {
  if (!user || user.isAnonymous === true || !user.emails?.[0]?.address) return false
  if (user.emails[0].verified === true) return true
  if (user.services?.password?.bcrypt || user.services?.password?.argon2) return true
  return Array.isArray(user.services?.resume?.loginTokens) && user.services.resume.loginTokens.length > 0
}

/**
 * The people a team pays for: members who have joined, with an account of their own. Guests are
 * never counted, nor invitations not yet accepted (the team page says so); at least 1.
 */
export function billableMembers(users) {
  return Math.max(1, (users || []).filter(acceptedMember).length)
}

// The Mongo fields acceptedMember reads (methods/business.js countMembers).
export const MEMBER_FIELDS = Object.freeze({
  isAnonymous: 1, emails: 1, 'services.password.bcrypt': 1, 'services.password.argon2': 1, 'services.resume.loginTokens.when': 1,
})

/** Whether this person may buy or change Business for their team: its owner, or an admin of it. */
export const mayManageBusiness = ({ user, admin }) => Boolean(user?.orgId && (user.isOrgOwner === true || admin === true))

/** Where a team stands: 'none' | 'contract' (written by staff, running) | 'stripe' (bought here, held). */
export function businessSource(org, now = Date.now()) {
  const business = org?.business
  if (!business || typeof business !== 'object') return 'none'
  if (business.source === 'stripe') return HELD_STATUSES.has(business.stripeStatus) ? 'stripe' : 'none'
  return businessActive(org, now) ? 'contract' : 'none'
}

// The idempotency key: per team, interval, member count, mode and attempt (the sheet's UUID).
export const businessCheckoutKey = (orgId, interval, members, now, { ui = 'hosted', attemptId } = {}) =>
  `business:${orgId}:${interval}:${members}:${checkUi(ui)}:${attemptPart(attemptId, now)}`

/**
 * The Checkout Session for Business: the team's members at the price per member, paid from the
 * first day, tax added by Stripe Tax where applicable. The team (orgId) is in the metadata of the
 * session and of the subscription, so the webhook finds the team without the browser.
 */
export function businessCheckoutParams({ orgId, userId, email, customerId = null, priceId, members, baseUrl, ui = 'hosted', now = Date.now() }) {
  const metadata = { product: 'business', orgId, userId }
  const buyer = customerId ? { customer: customerId, customer_update: { address: 'auto', name: 'auto' } } : { customer_email: email }
  const back = `${baseUrl}/team?business={CHECKOUT_SESSION_ID}`
  return {
    ...(checkUi(ui) === 'elements' && { ui_mode: 'elements' }),
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: members }],
    ...buyer,
    client_reference_id: orgId,
    metadata,
    subscription_data: { metadata: { ...metadata } },
    payment_method_collection: 'always',
    automatic_tax: { enabled: true },
    billing_address_collection: 'auto',
    expires_at: checkoutMinute(now) * 60 + (BUSINESS_CHECKOUT_MINUTES + 1) * 60,
    ...(ui === 'elements'
      ? { return_url: back, integration_identifier: SHEET_INTEGRATION }
      : { success_url: back, cancel_url: `${baseUrl}/team` }),
  }
}

/** Makes the Business session. → { ui:'elements', clientSecret, sessionId } | { ui:'hosted', url, sessionId } */
export async function startBusinessCheckout({ stripe }, { orgId, userId, email, customerId = null, price, interval, members, baseUrl, ui = 'hosted', attemptId, inApp, now = Date.now() }) {
  const mode = sessionUi(ui, inApp)
  const key = businessCheckoutKey(orgId, interval, members, now, { ui: mode, attemptId })
  const params = businessCheckoutParams({ orgId, userId, email, customerId, priceId: price.id, members, baseUrl, ui: mode, now })
  return sessionAnswer(mode, await stripe.checkout.sessions.create(params, { idempotencyKey: key }))
}

/** Whether a subscription is Business: its metadata says so, or one of its prices is a configured Business price. */
export function isBusinessSubscription(sub, priceIds = {}) {
  if (sub?.metadata?.product === 'business') return true
  const ids = new Set(Object.values(priceIds).filter(Boolean))
  return (sub?.items?.data || []).some(item => ids.has(idOf(item.price)))
}

/**
 * organizations.business, written from the subscription as just read. status 'active' while Stripe
 * says active or trialing, until the period end plus the same grace Pro has (a renewal webhook can
 * arrive a little late); 'past_due' while a payment is retried; 'ended' after.
 */
export function businessFromSubscription(sub, fetchedAt) {
  const item = sub.items?.data?.[0] || {}
  const currentPeriodEnd = ms(sub.current_period_end ?? item.current_period_end)
  let status = 'ended'
  if (LIVE_STATUSES.has(sub.status)) status = 'active'
  else if (sub.status === 'past_due' || sub.status === 'unpaid') status = 'past_due'
  return {
    status,
    source: 'stripe',
    until: status === 'active' && Number.isFinite(currentPeriodEnd) ? currentPeriodEnd + PRO_GRACE_MS : null,
    stripeStatus: sub.status,
    subscriptionId: sub.id,
    customerId: idOf(sub.customer),
    itemId: item.id ?? null,
    priceId: idOf(item.price),
    interval: item.price?.recurring?.interval ?? null,
    members: Number.isInteger(item.quantity) ? item.quantity : null,
    currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    endedAt: ms(sub.ended_at) ?? null,
    created: ms(sub.created),
    startedBy: sub.metadata?.userId ?? null,
    fetchedAt,
  }
}

/**
 * Whether a read of Stripe taken at fetchedAt may be written over what the team holds: never over a
 * running staff-written contract, never over a newer read. The Mongo store applies the same rule in
 * its update filter (methods/business.js writeBusiness).
 */
export function mayWriteBusiness(stored, fetchedAt, now = Date.now()) {
  if (!stored || typeof stored !== 'object') return true
  if (stored.source !== 'stripe') return !businessActive({ business: stored }, now)
  return !Number.isFinite(stored.fetchedAt) || stored.fetchedAt < fetchedAt
}

/**
 * The price-mismatch alert, at most once per price, amount and window (a day by default), so a
 * difference left for a while does not alert on every price read.
 * → (key: string) => boolean  true when this one may alert now
 */
export function alertOnce({ now = () => Date.now(), windowMs = 86_400_000 } = {}) {
  const sent = new Map()
  return key => {
    const at = now()
    const last = sent.get(key)
    if (last !== undefined && at - last < windowMs) return false
    sent.set(key, at)
    return true
  }
}

/** What the team page and its agents see about the team's Business, or null. */
export function businessSummary(org, now = Date.now()) {
  const business = org?.business
  const source = businessSource(org, now)
  if (source === 'none') return business?.source === 'stripe' ? { active: false, source: 'stripe', status: business.status } : null
  if (source === 'contract') return { active: true, source: 'contract', until: business.until ?? null }
  const iso = value => (Number.isFinite(value) ? new Date(value).toISOString() : null)
  const active = businessActive(org, now)
  return {
    active,
    source: 'stripe',
    status: business.status,
    interval: business.interval ?? null,
    members: business.members ?? null,
    renewsOn: active && !business.cancelAtPeriodEnd ? iso(business.currentPeriodEnd) : null,
    endsOn: active && business.cancelAtPeriodEnd ? iso(business.currentPeriodEnd) : null,
    cancelAtPeriodEnd: Boolean(business.cancelAtPeriodEnd),
    pastDue: business.status === 'past_due',
  }
}

/**
 * deps: { stripe, store, alert(text), now(), priceIds: { month, year }, changeId?() }
 * store: { findOrg({ orgId, subscriptionId, customerId }) → { _id, business } | null,
 *          writeBusiness(orgId, fields, fetchedAt, { over? }) → { written: boolean, previous: business | null }
 *            (mayWriteBusiness as one atomic update, or over the subscription named `over`, one just
 *            cancelled as a duplicate; previous: what the team held just before),
 *          countMembers(orgId) → number (billableMembers), audit(entry) }
 */
// fetchedAt is when the read of Stripe STARTED (as in pro-billing.mjs syncSubscription).
export async function syncBusinessSubscription(deps, subscriptionId, { orgId = null, sub: given = null, fetchedAt: givenAt = null } = {}) {
  const { stripe, store, alert, now } = deps
  if (given && givenAt == null) throw new Error('syncBusinessSubscription: pass fetchedAt (taken before the read) with sub')
  const fetchedAt = given ? givenAt : now()
  const sub = given || await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })
  if (!isBusinessSubscription(sub, deps.priceIds)) return { kind: null }
  const customerId = idOf(sub.customer)
  const org = await store.findOrg({ orgId: sub.metadata?.orgId || orgId, subscriptionId: sub.id, customerId })
  if (!org) {
    await alert(`A Slatebox Business subscription has no team: ${sub.id} (${customerId}).`)
    return { kind: 'business', handled: true, org: null }
  }
  const stored = org.business
  if (stored?.source === 'stripe' && stored.subscriptionId && stored.subscriptionId !== sub.id) {
    // an older subscription that has ended never replaces the one the team holds
    if (!HELD_STATUSES.has(sub.status)) return { kind: 'business', handled: true, ignored: 'ended' }
    // two held at once (two admins paid in a race): the later one is cancelled at once and refunded
    const duplicate = await settleDuplicate(deps, org._id, sub, stored.subscriptionId)
    if (duplicate) return { kind: 'business', handled: true, duplicate }
  }
  if (stored && stored.source !== 'stripe' && businessActive(org, now()) && HELD_STATUSES.has(sub.status)) {
    // staff wrote a contract for this team: it stays; the paid subscription is looked at by hand
    await alert(`A Slatebox Business subscription was paid for a team with a contract: ${sub.id} (team ${org._id}). The contract stays; refund or cancel the subscription by hand.`)
    return { kind: 'business', handled: true, ignored: 'contract' }
  }
  const { written, previous } = await store.writeBusiness(org._id, businessFromSubscription(sub, fetchedAt), fetchedAt)
  // The race the read above cannot see: two first webhooks for two subscriptions both found the
  // team empty. Whichever write comes second sees the other one (previous, or the team as it now
  // stands when its own write was refused) and settles it at once: the older stays, the newer is
  // cancelled and refunded.
  const other = written ? previous : (await store.findOrg({ orgId: org._id }))?.business
  if (other?.source === 'stripe' && other.subscriptionId && other.subscriptionId !== sub.id && HELD_STATUSES.has(sub.status) && HELD_STATUSES.has(other.stripeStatus)) {
    const duplicate = await settleDuplicate(deps, org._id, sub, other.subscriptionId)
    if (duplicate) return { kind: 'business', handled: true, duplicate }
  }
  if (!written) {
    // refused for a reason other than a newer read of this same subscription (a contract that is
    // still running, or a store that could not match the team): a paid team without Business must
    // never go unnoticed
    const newer = other?.source === 'stripe' && other.subscriptionId === sub.id && Number.isFinite(other.fetchedAt) && other.fetchedAt >= fetchedAt
    if (!newer && HELD_STATUSES.has(sub.status)) {
      await alert(`A paid Slatebox Business subscription could not be recorded on its team: ${sub.id} (team ${org._id}, team holds ${other?.source || 'nothing'}${other?.status ? ' ' + other.status : ''}). Look at it by hand: the team is charged without Business.`)
    }
  }
  return { kind: 'business', handled: true, org: org._id, written, sub }
}

// Two held subscriptions for one team: the older stays and is (re)written, the newer is cancelled
// and refunded. → the cancelled subscription's id, or null when the other one is not held.
async function settleDuplicate(deps, orgId, sub, otherId) {
  const { stripe, store, now } = deps
  const other = await stripe.subscriptions.retrieve(otherId, { expand: ['items.data.price'] }).catch(() => null)
  if (!other || !HELD_STATUSES.has(other.status)) return null
  const [keep, drop] = (other.created ?? 0) <= (sub.created ?? 0) ? [other, sub] : [sub, other]
  await cancelDuplicate(deps, drop, orgId)
  const at = now()
  const kept = await stripe.subscriptions.retrieve(keep.id, { expand: ['items.data.price'] })
  // over: the cancelled one may be replaced whatever its read time (two reads in the same ms tie)
  await store.writeBusiness(orgId, businessFromSubscription(kept, at), at, { over: drop.id })
  return drop.id
}

async function cancelDuplicate({ stripe, store, alert }, sub, orgId) {
  const key = 'business-duplicate:' + sub.id
  if (sub.status !== 'canceled') {
    await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false }, { idempotencyKey: key + ':cancel' })
  }
  const invoiceId = idOf(sub.latest_invoice)
  const invoice = invoiceId ? await stripe.invoices.retrieve(invoiceId, { expand: ['payments.data.payment.payment_intent'] }) : null
  const target = invoice?.amount_paid > 0 ? refundTargetOfInvoice(invoice) : null
  if (target) await stripe.refunds.create({ ...target, metadata: { requestId: key, product: 'business' } }, { idempotencyKey: key })
  await store.audit({ type: 'business-duplicate-cancelled', orgId, subscriptionId: sub.id })
  await alert(`A second Slatebox Business subscription was cancelled and refunded: ${sub.id} (team ${orgId}).`)
}

/**
 * How a quantity change is charged. Monthly: prorated on the next invoice (create_prorations).
 * Yearly: members added are invoiced at once for the rest of the year (always_invoice), so a team
 * does not add people in month two and pay for them only at the yearly renewal; members removed
 * become a prorated credit on the next invoice (create_prorations), never a refund.
 */
export const prorationFor = (interval, from, to) => (interval === 'year' && to > from ? 'always_invoice' : 'create_prorations')

/**
 * Keeps the subscription's quantity equal to the team's members: a member who joins or leaves
 * changes the quantity (prorationFor). Runs from the webhook (every Business event, and
 * invoice.upcoming before a renewal), after an invite is accepted, after a removal, and on the
 * server's periodic check. The quantity compared is the one Stripe has now (read here, or the
 * subscription the webhook just read), not the one last recorded, so a change made while a webhook
 * is on its way is never missed or doubled. Each change has its own id in the idempotency key: a
 * change back and forth (3 → 4 → 3 → 4) is never taken for a replay.
 * → { changed: boolean, from?, to? }
 */
// recordedFirst: compare with the recorded count first and read Stripe only when it differs (a
// sign-in, which happens often; the periodic check and the webhook always compare with Stripe).
export async function matchBusinessMembers(deps, orgId, { sub: given = null, recordedFirst = false } = {}) {
  const { stripe, store } = deps
  const org = await store.findOrg({ orgId })
  const business = org?.business
  if (!business || business.source !== 'stripe' || !business.subscriptionId || !business.itemId) return { changed: false }
  // an ended subscription is not changed; a cancelled one keeps its quantity to the end
  if (!LIVE_STATUSES.has(business.stripeStatus) && business.stripeStatus !== 'past_due') return { changed: false }
  const to = await store.countMembers(orgId)
  if (!Number.isInteger(to) || to < 1) return { changed: false }
  if (recordedFirst && to === business.members) return { changed: false }
  const sub = given?.id === business.subscriptionId ? given : await stripe.subscriptions.retrieve(business.subscriptionId, { expand: ['items.data.price'] })
  if (!LIVE_STATUSES.has(sub.status) && sub.status !== 'past_due') return { changed: false }
  const item = (sub.items?.data || []).find(i => i.id === business.itemId) || sub.items?.data?.[0]
  const from = Number.isInteger(item?.quantity) ? item.quantity : business.members
  if (!item?.id || to === from) return { changed: false }
  const interval = item.price?.recurring?.interval ?? business.interval
  const changeId = deps.changeId ? deps.changeId() : randomUUID()
  await stripe.subscriptions.update(business.subscriptionId, {
    items: [{ id: item.id, quantity: to }],
    proration_behavior: prorationFor(interval, from, to),
  }, { idempotencyKey: `business-members:${business.subscriptionId}:${from}:${to}:${changeId}` })
  await store.audit({ type: 'business-members-changed', orgId, subscriptionId: business.subscriptionId, from, to })
  return { changed: true, from, to }
}

/** "Stop renewing" (renew false) and "Keep Business" (renew true), for the team's own subscription. */
export async function setBusinessRenewal(deps, { org, renew, attemptId = null }) {
  const { stripe } = deps
  const business = org?.business
  if (business?.source !== 'stripe' || !business.subscriptionId || !HELD_STATUSES.has(business.stripeStatus)) {
    throw Object.assign(new Error(BUSINESS_COPY.none), { error: 'business-none', reason: BUSINESS_COPY.none })
  }
  const fetchedAt = deps.now()
  const key = `business-renewal:${business.subscriptionId}:${renew ? 'keep' : 'stop'}:${attemptPart(attemptId, fetchedAt)}`
  const sub = await stripe.subscriptions.update(business.subscriptionId, { cancel_at_period_end: !renew }, { idempotencyKey: key })
  await deps.store.writeBusiness(org._id, businessFromSubscription(sub, fetchedAt), fetchedAt)
  await deps.store.audit({ type: renew ? 'business-renewal-kept' : 'business-renewal-stopped', orgId: org._id, subscriptionId: business.subscriptionId })
  return { cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) }
}

const subscriptionOfInvoice = invoice => idOf(invoice?.subscription) ?? idOf(invoice?.parent?.subscription_details?.subscription)

// Whether an invoice says by itself that it is Business: the subscription's metadata Stripe copies
// onto it, or a line at a configured Business price.
function invoiceSaysBusiness(invoice, priceIds = {}) {
  const meta = invoice?.parent?.subscription_details?.metadata || invoice?.subscription_details?.metadata
  if (meta?.product === 'business') return true
  const ids = new Set(Object.values(priceIds).filter(Boolean))
  return (invoice?.lines?.data || []).some(line => ids.has(idOf(line?.price)) || ids.has(idOf(line?.pricing?.price_details?.price)))
}

/**
 * One Stripe event, before Pro's handler: → { handled: true } for Business, { handled: false }
 * otherwise (Pro, top-ups and cards go on as before).
 */
export async function handleBusinessEvent(event, deps) {
  const { stripe, store, alert } = deps
  const object = event?.data?.object || {}
  const type = event?.type || ''
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    if (object.mode !== 'subscription' || !object.subscription || object.metadata?.product !== 'business') return { handled: false }
    const out = await syncBusinessSubscription(deps, idOf(object.subscription), { orgId: object.metadata?.orgId || object.client_reference_id })
    if (out.org) await matchBusinessMembers(deps, out.org, { sub: out.sub })
    return { handled: true }
  }
  if (type === 'charge.refunded' || type === 'charge.dispute.created' || type === 'charge.dispute.closed') {
    const charge = type === 'charge.refunded' ? object : (object.charge ? await stripe.charges.retrieve(idOf(object.charge)) : null)
    const customerId = idOf(charge?.customer)
    const org = customerId ? await store.findOrg({ customerId }) : null
    if (!org || org.business?.source !== 'stripe') return { handled: false }
    if (!await chargePaidAnInvoice(stripe, charge)) return { handled: false }
    await store.audit({ type: `business-${type.replace(/\./g, '-')}`, orgId: org._id, chargeId: charge.id })
    await alert(`A Slatebox Business payment had ${type === 'charge.refunded' ? 'a refund' : `a card dispute (${object.status || 'opened'})`} in Stripe: ${charge.id} (team ${org._id}). Business stays as it is until the subscription changes.`)
    return { handled: true }
  }
  let subscriptionId = null
  if (/^customer\.subscription\./.test(type)) subscriptionId = object.id
  else if (/^invoice\./.test(type)) subscriptionId = subscriptionOfInvoice(object)
  else return { handled: false }
  if (!subscriptionId) return { handled: false }
  // the metadata on the event's own object saves a read for anything that is clearly not Business
  if (/^customer\.subscription\./.test(type) && !isBusinessSubscription(object, deps.priceIds)) return { handled: false }
  const fetchedAt = deps.now()
  let sub
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })
  } catch (error) {
    // Business's lookup never holds up Pro: an invoice that does not say it is Business goes on
    // to Pro's handler, which reads the subscription itself. A Business event is retried by Stripe.
    if (/^invoice\./.test(type) && !invoiceSaysBusiness(object, deps.priceIds)) return { handled: false }
    throw error
  }
  if (!isBusinessSubscription(sub, deps.priceIds)) return { handled: false, sub, fetchedAt }
  const out = await syncBusinessSubscription(deps, subscriptionId, { sub, fetchedAt })
  if (out.org) await matchBusinessMembers(deps, out.org, { sub })
  return { handled: true }
}
