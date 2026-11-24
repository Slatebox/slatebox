// Slatebox Business bought in the app: what the team page and the sheet show (offer), checkout,
// the return page's confirm, renewal, receipts and card in Stripe's portal, and the Mongo store the
// webhook writes through. Rules in ../business-billing.mjs. Prices are Stripe's, named in
// settings.payments.business.monthly / .yearly; nothing here holds an amount.
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { check, Match } from 'meteor/check'
import CONSTANTS from '../../imports/api/common/constants'
import AuthManager from '../../imports/api/common/AuthManager'
import { Audit, Organizations } from '../../imports/api/common/models'
import { BUSINESS_CONTACT_URL } from '../../imports/api/business/catalog.mjs'
import { PRICING_URL } from '../../imports/api/common/contact.mjs'
import {
  BUSINESS_COPY, BUSINESS_INTERVALS, MEMBER_FIELDS, alertOnce, billableMembers, billedThroughStripe, signInRecounter, businessOnSale, businessPriceIds, businessSource, businessSummary, checkBusinessPrice,
  handleBusinessEvent, matchBusinessMembers, mayManageBusiness, offerOfPrice, pricingPageDiffers, setBusinessRenewal, startBusinessCheckout, syncBusinessSubscription,
} from '../business-billing.mjs'
import { asMethodError, inAppOn, stripeClient } from './wallet'
import { alert, meterOn } from '../metering/meteor'
import { paymentsOn, requireCloudLicense } from '../cloud-lock-meteor'

const orgs = () => Organizations.rawCollection()

// Mongo store for business-billing.mjs.
export const businessStore = {
  async findOrg({ orgId, subscriptionId, customerId }) {
    const fields = { projection: { business: 1 } }
    return (subscriptionId && await orgs().findOne({ 'business.subscriptionId': subscriptionId }, fields))
      || (orgId && await orgs().findOne({ _id: orgId }, fields))
      || (customerId && await orgs().findOne({ 'business.customerId': customerId }, fields))
      || null
  },
  // mayWriteBusiness as one atomic update filter: never over a running contract, never over a
  // newer read. A contract's `until` may be a Date or a time in ms (membership.mjs): Mongo never
  // compares a Date with a number, so both are matched. → { written, previous } (previous: the
  // business the team held just before this write, for the race in syncBusinessSubscription)
  async writeBusiness(orgId, fields, fetchedAt, { over = null } = {}) {
    const now = Date.now()
    const result = await orgs().findOneAndUpdate({
      _id: orgId,
      $or: [
        { business: null },
        // a subscription just cancelled as a duplicate (syncBusinessSubscription) gives way to the one kept
        ...(over ? [{ 'business.source': 'stripe', 'business.subscriptionId': over }] : []),
        { 'business.source': 'stripe', $or: [{ 'business.fetchedAt': { $lt: fetchedAt } }, { 'business.fetchedAt': null }] },
        { 'business.source': { $ne: 'stripe' }, $or: [{ 'business.status': { $ne: 'active' } }, { 'business.until': { $lte: now } }, { 'business.until': { $lte: new Date(now) } }] },
      ],
    }, { $set: { business: fields } }, { projection: { business: 1 }, returnDocument: 'before', includeResultMetadata: false })
    // older drivers wrap the document in { value }
    const before = result && Object.hasOwn(result, 'ok') && Object.hasOwn(result, 'value') ? result.value : result
    return { written: Boolean(before), previous: before?.business ?? null }
  },
  // members who have joined: invitations not yet accepted are not billed (acceptedMember)
  async countMembers(orgId) {
    const members = await Meteor.users.rawCollection().find({ orgId }, { projection: MEMBER_FIELDS }).toArray()
    return billableMembers(members)
  },
  audit: entry => Audit.insertAsync({ ...entry, created: Date.now() }),
}

export const businessDeps = () => ({
  stripe: stripeClient(), store: businessStore, alert, now: () => Date.now(), priceIds: businessPriceIds(Meteor.settings),
})

// Payments run only on Slatebox Cloud by its Cloud key, with a Stripe key (cloud-lock.mjs), and the meter on.
const cloudReady = () => paymentsOn() && meterOn()

// The webhook's first stop (stripeHooks.js, via methods/pro.js handleBilling): Business, else Pro.
export async function handleBusiness(event) {
  if (!cloudReady()) return { handled: false }
  return handleBusinessEvent(event, businessDeps())
}

/** After the team's members change (an invitation accepted, a removal): the subscription follows. Never throws. */
export function membersChanged(orgId, { delayMs = 0, recordedFirst = false } = {}) {
  if (!orgId || !cloudReady() || !businessOnSale(Meteor.settings)) return
  Meteor.setTimeout(() => {
    matchBusinessMembers(businessDeps(), orgId, { recordedFirst })
      .catch(error => console.error('Business member count update failed', orgId, error.message)) // eslint-disable-line no-console
  }, delayMs)
}

// The periodic check: every team billed through Stripe, once an hour, catches any change the
// immediate calls missed (a member removed from another server, a failed update).
Meteor.startup(() => {
  if (!cloudReady() || !businessOnSale(Meteor.settings)) return
  Meteor.setInterval(async () => {
    const billed = await orgs().find({ 'business.source': 'stripe', 'business.stripeStatus': { $in: ['active', 'trialing', 'past_due'] } }, { projection: { _id: 1 } }).toArray()
    if (!cloudReady()) return
    for (const org of billed) {
      await matchBusinessMembers(businessDeps(), org._id)
        .catch(error => console.error('Business member count check failed', org._id, error.message)) // eslint-disable-line no-console
    }
  }, 60 * 60_000)
})

// A member who accepts an invitation joins the bill (invitations are not billed until then): a
// sign-in checks the team's quantity, only for a team billed through Stripe, and at most once per
// ten minutes per team (signInRecounter): never a read of every member on every sign-in.
// matchBusinessMembers changes nothing when it matches; the hourly check above catches the rest.
const recountAfterSignIn = signInRecounter({
  run: orgId => membersChanged(orgId, { recordedFirst: true }),
  setTimer: (fn, ms) => Meteor.setTimeout(fn, ms),
})
Accounts.onLogin(({ user }) => {
  if (!user?.orgId || user.isAnonymous || !cloudReady() || !businessOnSale(Meteor.settings)) return
  orgs().findOne({ _id: user.orgId }, { projection: { 'business.source': 1, 'business.stripeStatus': 1 } })
    .then(org => { if (billedThroughStripe(org)) recountAfterSignIn(user.orgId) })
    .catch(error => console.error('Business sign-in check failed', user.orgId, error.message)) // eslint-disable-line no-console
})

// Both prices read from Stripe by id (10 minutes in memory) and checked for shape; the amount is Stripe's.
const priceCache = new Map()
// the "differs from the pricing page" alert: once a day per price and amount, not on every read
const mismatchAlert = alertOnce()
async function businessPrice(stripe, interval) {
  const id = businessPriceIds(Meteor.settings)[interval]
  if (!id) throw new Meteor.Error('business-not-on-sale', BUSINESS_COPY.notOnSale)
  const hit = priceCache.get(id)
  if (hit && hit.until > Date.now()) return hit.price
  const price = await stripe.prices.retrieve(id).catch(() => null)
  const problem = checkBusinessPrice(price, interval)
  if (problem) {
    await alert(`Slatebox Business checkout refused: the Stripe price ${id} (settings.payments.business) is not usable (${problem}).`)
    throw new Meteor.Error('business-unavailable', BUSINESS_COPY.priceProblem)
  }
  if (pricingPageDiffers(price, interval) && mismatchAlert(`${id}:${price.unit_amount}:${price.currency}`)) {
    await alert(`The Stripe price ${id} for Slatebox Business (${interval}) is ${price.unit_amount} ${price.currency}, not what the pricing page states. The sheet shows and charges Stripe's amount; bring the pricing page in line (the figures in business/catalog.mjs, then pro-figures).`)
  }
  priceCache.set(id, { price, until: Date.now() + 10 * 60_000 })
  return price
}

const managed = async run => {
  try {
    return await run()
  } catch (error) {
    throw asMethodError(error)
  }
}

async function teamMember() {
  const user = await Meteor.userAsync()
  if (!user || user.isAnonymous) throw new Meteor.Error('sign-in', 'Sign in to get Slatebox Business for your team.')
  if (!user.orgId) throw new Meteor.Error('business-no-team', BUSINESS_COPY.noTeam)
  const org = await Organizations.findOneAsync({ _id: user.orgId }, { fields: { business: 1, name: 1 } })
  if (!org) throw new Meteor.Error('business-no-team', BUSINESS_COPY.noTeam)
  const admin = await AuthManager.userHasClaim(user._id, [CONSTANTS.claims.admin._id])
  return { user, org, manager: mayManageBusiness({ user, admin }) }
}

async function teamManager() {
  const who = await teamMember()
  if (!who.manager) throw new Meteor.Error('business-not-admin', BUSINESS_COPY.notAdmin)
  return who
}

const readSession = async (stripe, sessionId) => {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Meteor.Error('invalid', BUSINESS_COPY.invalid)
  try {
    return await stripe.checkout.sessions.retrieve(sessionId)
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === 'resource_missing') throw new Meteor.Error('invalid', BUSINESS_COPY.invalid)
    throw error
  }
}

Meteor.methods({
  // The team page and the sheet: whether Business is sold here, the amounts Stripe has for it, the
  // team's members and where the team stands. → { onSale, manager, members, prices, summary, contactUrl, pricingUrl }
  async [CONSTANTS.methods.business.offer]() {
    requireCloudLicense()
    const { org, manager } = await teamMember()
    const base = { onSale: false, manager, members: await businessStore.countMembers(org._id), prices: [], summary: businessSummary(org), contactUrl: BUSINESS_CONTACT_URL, pricingUrl: PRICING_URL }
    if (!cloudReady() || !businessOnSale(Meteor.settings)) return base
    const stripe = stripeClient()
    try {
      const prices = []
      for (const interval of BUSINESS_INTERVALS) prices.push(offerOfPrice(await businessPrice(stripe, interval), interval))
      return { ...base, onSale: true, prices }
    } catch (error) {
      // a price that cannot be used (alerted above): the team page offers "Talk to us" instead
      return base
    }
  },

  // ui 'elements' → { ui, clientSecret, sessionId }; 'hosted' → { ui, url, sessionId }. attemptId: the sheet's UUID v4.
  async [CONSTANTS.methods.business.checkout]({ interval, ui = 'hosted', attemptId } = {}) {
    check(interval, Match.OneOf('month', 'year'))
    check(ui, Match.OneOf('elements', 'hosted'))
    check(attemptId, Match.Maybe(String))
    requireCloudLicense()
    if (!cloudReady()) throw new Meteor.Error('business-unavailable', BUSINESS_COPY.unavailable)
    if (!businessOnSale(Meteor.settings)) throw new Meteor.Error('business-not-on-sale', BUSINESS_COPY.notOnSale)
    const { user, org } = await teamManager()
    const source = businessSource(org)
    if (source === 'stripe') throw new Meteor.Error('business-already', BUSINESS_COPY.already)
    if (source === 'contract') throw new Meteor.Error('business-contract', BUSINESS_COPY.contract)
    const stripe = stripeClient()
    const price = await businessPrice(stripe, interval)
    return managed(async () => startBusinessCheckout({ stripe }, {
      orgId: org._id, userId: user._id, email: user.emails?.[0]?.address, customerId: org.business?.customerId ?? null,
      price, interval, members: await businessStore.countMembers(org._id),
      baseUrl: Meteor.settings.public.baseUrl, ui, attemptId, inApp: inAppOn(), now: Date.now(),
    }))
  },

  // The return page asks until the subscription is on the team (the webhook usually arrives first). → { status }
  async [CONSTANTS.methods.business.confirm]({ sessionId } = {}) {
    check(sessionId, String)
    requireCloudLicense()
    if (!cloudReady()) throw new Meteor.Error('business-unavailable', BUSINESS_COPY.unavailable)
    const { org } = await teamMember()
    const deps = businessDeps()
    const session = await readSession(deps.stripe, sessionId)
    if (session.metadata?.product !== 'business' || session.metadata?.orgId !== org._id) throw new Meteor.Error('invalid', BUSINESS_COPY.notYours)
    if (session.status !== 'complete' || !session.subscription) return { status: 'pending' }
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id
    await syncBusinessSubscription(deps, subscriptionId, { orgId: org._id })
    const fresh = await Organizations.findOneAsync({ _id: org._id }, { fields: { business: 1 } })
    return { status: businessSummary(fresh)?.active && fresh.business.source === 'stripe' ? 'active' : 'pending' }
  },

  // "Stop renewing" (renew false) and "Keep Business" (renew true). attemptId: a UUID v4 per tap.
  async [CONSTANTS.methods.business.renewal]({ renew, attemptId } = {}) {
    check(renew, Boolean)
    check(attemptId, Match.Maybe(String))
    requireCloudLicense()
    if (!cloudReady()) throw new Meteor.Error('business-unavailable', BUSINESS_COPY.unavailable)
    const { org } = await teamManager()
    return managed(() => setBusinessRenewal(businessDeps(), { org, renew, attemptId }))
  },

  // Stripe's customer portal for the team's card and receipts (settings.stripe.businessPortalConfiguration, if set).
  async [CONSTANTS.methods.business.portal]() {
    requireCloudLicense()
    if (!cloudReady()) throw new Meteor.Error('business-unavailable', BUSINESS_COPY.unavailable)
    const { org } = await teamManager()
    if (org.business?.source !== 'stripe' || !org.business.customerId) throw new Meteor.Error('business-none', BUSINESS_COPY.none)
    const configuration = Meteor.settings.stripe?.businessPortalConfiguration
    const session = await stripeClient().billingPortal.sessions.create({
      customer: org.business.customerId, return_url: `${Meteor.settings.public.baseUrl}/team`, ...(configuration && { configuration }),
    })
    return { url: session.url }
  },
})

export const BUSINESS_END_FAILED = 'We could not end your team\'s Slatebox Business, so the team was not removed. Try again or write to us.'

// Ends the team's Business at once, without a refund of the current period, when the team is
// removed (organizations.delete), the way removing an account ends Pro. Throws if Stripe cannot be
// reached: nothing is removed.
export async function endBusinessForRemoval(orgId) {
  const org = await Organizations.findOneAsync({ _id: orgId }, { fields: { business: 1 } })
  const business = org?.business
  if (business?.source !== 'stripe' || !business.subscriptionId || ['canceled', 'incomplete_expired'].includes(business.stripeStatus)) return false
  await stripeClient().subscriptions.cancel(business.subscriptionId, { invoice_now: false, prorate: false }, { idempotencyKey: `business-team-removed:${business.subscriptionId}` })
  await Audit.insertAsync({ type: 'business-ended-team-removed', orgId, subscriptionId: business.subscriptionId, created: Date.now() })
  return true
}
