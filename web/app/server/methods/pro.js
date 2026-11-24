// Slatebox Pro: checkout (a Stripe subscription), the customer portal, and the Mongo store the
// webhook writes through. Rules in ../pro-billing.mjs; prices in imports/api/pro/catalog.mjs.
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import { Accounts } from 'meteor/accounts-base'
import { Email } from 'meteor/email'
import { Random } from 'meteor/random'
import CONSTANTS from '../../imports/api/common/constants'
import { Audit, LoginLinks, Slates } from '../../imports/api/common/models'
import { verificationMailAvailable } from '../instance/meteor'
import { PRO_LOOKUP_KEYS, PRO_PRICES } from '../../imports/api/pro/catalog.mjs'
import { HELD_STATUSES, PRO_COPY, checkProPrice, handleBillingEvent, proOnSale, startProCheckout, syncSubscription } from '../pro-billing.mjs'
import { actionSecret, applyDefaultCard, cardOf, cardSessionKey, cardSessionParams, handleSetupEvent, invoiceRows, previewSwitch, setRenewal, switchInterval } from '../pro-manage.mjs'
import { sessionAnswer } from '../pay-attempt.mjs'
import { canSetFirstPassword, claimAnswer, claimGuestPurchase, mergeGuestPurchase, MERGE_LINK_DAYS } from '../pro-claim.mjs'
import { asMethodError, inAppOn, stripeClient } from './wallet'
import { alert, meterOn, meterSettings, setProCardReader } from '../metering/meteor'
import { BILLING_CONTACT_URL } from '../../imports/api/common/contact.mjs'
import { handleBusiness } from './business'
import { requireCloudLicense } from '../cloud-lock-meteor'

// Mongo store for pro-billing.mjs.
export const billingStore = {
  async findProUser({ userId, customerId, subscriptionId }) {
    const fields = { projection: { pro: 1 } }
    const users = Meteor.users.rawCollection()
    return (subscriptionId && await users.findOne({ 'pro.subscriptionId': subscriptionId }, fields))
      || (userId && await users.findOne({ _id: userId }, fields))
      || (customerId && await users.findOne({ 'pro.customerId': customerId }, fields))
      || null
  },
  // Every field from one fresh read of Stripe; a write from an older read is dropped.
  async writePro(userId, fields, fetchedAt) {
    const set = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`pro.${k}`, v]))
    const result = await Meteor.users.rawCollection().updateOne(
      { _id: userId, $or: [{ 'pro.fetchedAt': { $lt: fetchedAt } }, { 'pro.fetchedAt': null }] },
      { $set: set },
    )
    return result.modifiedCount === 1
  },
  async setProCustomer(userId, customerId) {
    const result = await Meteor.users.rawCollection().updateOne(
      { _id: userId, $or: [{ 'pro.customerId': null }, { 'pro.customerId': customerId }] },
      { $set: { 'pro.customerId': customerId } },
    )
    return result.modifiedCount === 1 || result.matchedCount === 1
  },
  setProHold: (userId, hold) => Meteor.users.rawCollection().updateOne({ _id: userId }, { $set: { 'pro.hold': hold } }),
  // fields that are not a read of the subscription: actionNeeded, switchExpiredAt (pro-manage.mjs)
  setProFields: (userId, fields) => Meteor.users.rawCollection().updateOne(
    { _id: userId }, { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`pro.${k}`, v])) },
  ),
  // only the recorded invoice's own payment clears it (null: whatever is recorded)
  clearProAction: (userId, invoiceId) => Meteor.users.rawCollection().updateOne(
    { _id: userId, ...(invoiceId != null && { 'pro.actionNeeded.invoiceId': invoiceId }) }, { $set: { 'pro.actionNeeded': null } },
  ),
  findUserByProCustomer: customerId => (customerId ? Meteor.users.rawCollection().findOne({ 'pro.customerId': customerId }, { projection: { pro: 1 } }) : null),
  audit: entry => Audit.insertAsync({ ...entry, created: Date.now() }),
}

export const billingDeps = () => ({ stripe: stripeClient(), store: billingStore, alert, now: () => Date.now() })

// A guest's Pro purchase (pro-claim.mjs): the account side of the payment, in Mongo.
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const claimStore = {
  findUser: id => Meteor.users.rawCollection().findOne({ _id: id }, { projection: { isAnonymous: 1, checkoutClaim: 1, pro: 1, emails: 1 } }),
  findUserByEmail: email => Meteor.users.rawCollection().findOne(
    { 'emails.address': { $regex: `^${escapeRegex(email)}$`, $options: 'i' } }, { projection: { _id: 1 } },
  ),
  async attachEmail(userId, email, claim) {
    try {
      const result = await Meteor.users.rawCollection().updateOne(
        { _id: userId, isAnonymous: true, checkoutClaim: null },
        { $set: { emails: [{ address: email, verified: false }], isAnonymous: false, checkoutClaim: claim } },
      )
      return result.modifiedCount === 1 ? 'attached' : 'skipped'
    } catch (error) {
      // the unique index on emails.address: someone took the address a moment ago
      if (error?.code === 11000) return 'taken'
      throw error
    }
  },
  async markClaim(userId, claim) {
    const result = await Meteor.users.rawCollection().updateOne({ _id: userId, isAnonymous: true, checkoutClaim: null }, { $set: { checkoutClaim: claim } })
    return result.modifiedCount === 1
  },
  setClaim: (userId, claim) => Meteor.users.rawCollection().updateOne({ _id: userId }, { $set: { checkoutClaim: claim } }),
  async clearGuestPro(guestId, subscriptionId) {
    const result = await Meteor.users.rawCollection().updateOne({ _id: guestId, 'pro.subscriptionId': subscriptionId }, { $set: { pro: null } })
    return result.modifiedCount === 1
  },
  async moveSlates(fromId, toId) {
    const result = await Slates.rawCollection().updateMany({ userId: fromId }, { $set: { userId: toId } })
    return result.modifiedCount
  },
}

async function sendClaimVerification(userId) {
  if (!verificationMailAvailable()) return false
  await Accounts.sendVerificationEmail(userId)
  return true
}

// The one-time link that moves a guest's Pro into the account that already owns the address. It goes
// to that address only; opening it is what proves the mailbox (users.attemptLoginWithLink).
async function sendMergeLink({ guestId, targetId, email, sessionId }) {
  const linkId = Random.secret(32)
  const createdAt = new Date()
  await LoginLinks.insertAsync({
    _id: linkId, userId: targetId, email, mergeFrom: guestId, sessionId, createdAt,
    expiresAt: createdAt.getTime() + MERGE_LINK_DAYS * 86_400_000,
  })
  await Email.sendAsync({
    from: 'no-reply@slatebox.com',
    to: email,
    subject: 'Slatebox - Move your Slatebox Pro into your account',
    text: [
      'Hi! Slatebox Pro was just bought with this email address, by someone who was not signed in.',
      '',
      'This address already has a Slatebox account. If it was you, open this link to move Slatebox Pro and the slates you made into your account:',
      '',
      `${Meteor.settings.public.baseUrl}/login-link/${linkId}`,
      '',
      `The link works once, for ${MERGE_LINK_DAYS} days. If it was not you, ignore this email: nothing changes in your account, and nobody was signed in to it.`,
    ].join('\n'),
  })
}

export const claimDeps = () => ({
  store: claimStore, sendVerification: sendClaimVerification, sendMergeLink,
  audit: entry => Audit.insertAsync({ ...entry, created: Date.now() }), now: () => Date.now(),
})

/** A paid Pro checkout's account side (pro-claim.mjs), from the webhook or the sheet's confirm. */
export const claimPurchase = session => claimGuestPurchase(claimDeps(), session)

/** Opening the move link: the guest's Pro and slates into the account the link was sent to. */
export const mergePurchase = ({ guestId, targetId }) => mergeGuestPurchase({
  stripe: stripeClient(), store: claimStore, now: () => Date.now(),
  sync: (subscriptionId, userId) => syncSubscription(billingDeps(), subscriptionId, { userId }),
  audit: entry => Audit.insertAsync({ ...entry, created: Date.now() }),
}, { guestId, targetId })

// The webhook's entry: Business first (a team's subscription, methods/business.js), then Pro, then
// top-ups (stripeHooks.js); card changes are handleSetup below.
// A paid Pro checkout then names the guest's account (even if the tab was closed mid-payment).
export async function handleBilling(event) {
  const business = await handleBusiness(event)
  if (business.handled) return business
  const out = await handleBillingEvent(event, billingDeps())
  if (out.handled && ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event?.type)) {
    await claimPurchase(event.data?.object)
  }
  return out
}

// The catalogue's price for an interval, read from Stripe by lookup_key (10 minutes in memory).
const priceCache = new Map()
async function proPrice(stripe, interval) {
  const want = PRO_PRICES.find(p => p.interval === interval)
  const hit = priceCache.get(interval)
  if (hit && hit.until > Date.now()) return hit.price
  const listed = await stripe.prices.list({ lookup_keys: [PRO_LOOKUP_KEYS[interval]], active: true, expand: ['data.product'] })
  const price = listed?.data?.[0]
  const problem = checkProPrice(price, want)
  if (problem) {
    await alert(`Slatebox Pro checkout refused: the Stripe price for ${PRO_LOOKUP_KEYS[interval]} does not match the catalogue (${problem}).`)
    throw new Meteor.Error('pro-unavailable', PRO_COPY.priceChanged)
  }
  priceCache.set(interval, { price, until: Date.now() + 10 * 60_000 })
  return price
}

// The card Manage shows (meter.summary proCard): read on demand, 10 minutes in memory per person,
// forgotten when the card changes here.
const cardCache = new Map()
const forgetCard = userId => { cardCache.delete(userId) }
export async function proCardFor(user) {
  const customerId = user?.pro?.customerId
  if (!customerId || !user.pro.subscriptionId) return null
  const hit = cardCache.get(user._id)
  if (hit && hit.until > Date.now() && hit.customerId === customerId) return hit.card
  let card = null
  try {
    const stripe = stripeClient()
    const customer = await stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] })
    card = cardOf(customer?.invoice_settings?.default_payment_method)
    if (!card) {
      const sub = await stripe.subscriptions.retrieve(user.pro.subscriptionId, { expand: ['default_payment_method'] })
      card = cardOf(sub?.default_payment_method)
    }
  } catch (error) {
    console.error('Pro card read failed', user._id, error.message) // eslint-disable-line no-console
    return hit?.card ?? null
  }
  cardCache.set(user._id, { card, customerId, until: Date.now() + 10 * 60_000 })
  return card
}

setProCardReader(proCardFor)

// Card changes finishing in the webhook (stripeHooks.js, after Pro and top-ups).
export const handleSetup = event => handleSetupEvent(event, { ...billingDeps(), onCard: forgetCard })

// Both Pro prices (the switch needs the other one), checked against the catalogue.
const bothPrices = async stripe => ({ month: await proPrice(stripe, 'month'), year: await proPrice(stripe, 'year') })

// A pure module's refusal as the method's error.
const managed = async run => {
  try {
    return await run()
  } catch (error) {
    throw asMethodError(error)
  }
}

// A Checkout session by id; one Stripe does not know is an invalid link, not a server error.
const readSession = async (stripe, sessionId, params) => {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Meteor.Error('invalid', PRO_COPY.invalid)
  try {
    return await stripe.checkout.sessions.retrieve(sessionId, params)
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === 'resource_missing') throw new Meteor.Error('invalid', PRO_COPY.invalid)
    throw error
  }
}

// Whoever is here, a guest included: a guest pays for Pro with no sign-up first (pro-claim.mjs).
async function buyer() {
  const user = await Meteor.userAsync()
  if (!user) throw new Meteor.Error('sign-in', 'Open Slatebox to get Slatebox Pro.')
  return user
}

async function signedIn() {
  const user = await Meteor.userAsync()
  if (!user || user.isAnonymous) throw new Meteor.Error('sign-in', 'Sign in to manage Slatebox Pro.')
  return user
}

// Slatebox Cloud by its Cloud key first ('cloud_only' elsewhere, cloud-lock.mjs), then the meter and a Stripe key.
function requireCloud() {
  requireCloudLicense()
  if (!meterOn() || !Meteor.settings.stripePrivateKey) throw new Meteor.Error('unavailable', PRO_COPY.unavailable)
}

export const PRO_END_FAILED = `We could not end your Slatebox Pro, so your account was not removed. Try again or write to us at ${BILLING_CONTACT_URL}.`

// Ends Pro at once, without a refund of the current period, when an account is removed (terms:
// deleting your account ends Pro). Runs after the balance refund and before anything is removed
// (wallet-stripe.mjs removeAccountAfterRefund): a failed refund leaves Pro on. Throws if Stripe
// cannot be reached: nothing is removed.
export async function endProForRemoval(user) {
  const subscriptionId = user?.pro?.subscriptionId
  if (!subscriptionId || ['canceled', 'incomplete_expired'].includes(user.pro.status)) return false
  await stripeClient().subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false }, { idempotencyKey: `pro-account-removed:${subscriptionId}` })
  await Audit.insertAsync({ type: 'pro-ended-account-removed', userId: user._id, subscriptionId, created: Date.now() })
  return true
}

const recentRefresh = new Map()

Meteor.methods({
  // ui 'elements' (the pay sheet) → { ui, clientSecret, sessionId }; 'hosted', or the sheet switched
  // off (public.stripe.inApp false) → { ui:'hosted', url, sessionId }. attemptId: the sheet's UUID v4.
  async [CONSTANTS.methods.pro.checkout]({ interval, ui = 'hosted', attemptId } = {}) {
    check(interval, Match.OneOf('month', 'year'))
    check(ui, Match.OneOf('elements', 'hosted'))
    check(attemptId, Match.Maybe(String))
    requireCloud()
    // anyone pays at once: a guest gives their email in the sheet, a member pays with the address
    // on the account (confirmed or not: a paid Pro counts as confirmed for the meter, policy.mjs)
    const user = await buyer()
    const guest = user.isAnonymous === true
    if (HELD_STATUSES.has(user.pro?.status)) throw new Meteor.Error('pro-already', PRO_COPY.already)
    const settings = await meterSettings()
    if (!proOnSale(settings)) throw new Meteor.Error('pro-not-yet', PRO_COPY.notYet)
    const stripe = stripeClient()
    const price = await proPrice(stripe, interval)
    return managed(() => startProCheckout({ stripe }, {
      userId: user._id, email: guest ? null : user.emails?.[0]?.address, customerId: user.pro?.customerId ?? null, price, interval,
      baseUrl: Meteor.settings.public.baseUrl, ui, attemptId, inApp: inAppOn(), guest, now: Date.now(),
    }))
  },

  // What switching to the other interval costs: { interval, atRenewal, todayCents, taxCents, nextAmountCents, nextDate }.
  async [CONSTANTS.methods.pro.preview]({ interval } = {}) {
    check(interval, Match.OneOf('month', 'year'))
    requireCloud()
    const user = await signedIn()
    const stripe = stripeClient()
    return managed(async () => previewSwitch({ stripe }, { pro: user.pro, prices: await bothPrices(stripe), interval }))
  },

  // Month → year now; year → month at renewal; the current interval again keeps it (releases a pending switch).
  // attemptId: the sheet's UUID v4, new on every tap (the switch's idempotency keys are per attempt).
  async [CONSTANTS.methods.pro.switchInterval]({ interval, attemptId } = {}) {
    check(interval, Match.OneOf('month', 'year'))
    check(attemptId, Match.Maybe(String))
    requireCloud()
    const user = await signedIn()
    const deps = billingDeps()
    return managed(async () => switchInterval(deps, { userId: user._id, pro: user.pro, prices: await bothPrices(deps.stripe), interval, attemptId }))
  },

  // "Stop renewing" (renew false) and "Keep Pro" (renew true). attemptId: the sheet's UUID v4, new on
  // every tap (keyed per attempt, like the switch).
  async [CONSTANTS.methods.pro.renewal]({ renew, attemptId } = {}) {
    check(renew, Boolean)
    check(attemptId, Match.Maybe(String))
    requireCloud()
    const user = await signedIn()
    return managed(() => setRenewal(billingDeps(), { userId: user._id, pro: user.pro, renew, attemptId }))
  },

  // A setup session for a new card: { ui, clientSecret, sessionId } in the sheet, { ui, url, sessionId } otherwise.
  // attemptId: the sheet's UUID v4 (a new one after a declined card).
  async [CONSTANTS.methods.pro.cardSession]({ attemptId } = {}) {
    check(attemptId, Match.Maybe(String))
    requireCloud()
    const user = await signedIn()
    if (!user.pro?.customerId || !user.pro?.subscriptionId) throw new Meteor.Error('pro-none', PRO_COPY.noCustomer)
    const ui = inAppOn() ? 'elements' : 'hosted'
    const now = Date.now()
    const params = cardSessionParams({ userId: user._id, customerId: user.pro.customerId, baseUrl: Meteor.settings.public.baseUrl, ui })
    const key = await managed(async () => cardSessionKey(user._id, now, attemptId))
    const session = await managed(() => stripeClient().checkout.sessions.create(params, { idempotencyKey: `${key}:${ui}` }))
    return sessionAnswer(ui, session)
  },

  // After the card setup (the webhook does the same): { status: 'pending' | 'updated' | 'needs-action' | 'declined' }.
  async [CONSTANTS.methods.pro.cardConfirm]({ sessionId } = {}) {
    check(sessionId, String)
    requireCloud()
    const user = await signedIn()
    const deps = billingDeps()
    const session = await readSession(deps.stripe, sessionId, { expand: ['setup_intent'] })
    const out = await managed(() => applyDefaultCard(deps, { userId: user._id, pro: user.pro, session }))
    if (out.status !== 'pending') forgetCard(user._id)
    return out
  },

  // The recorded payment that waits for the person: { clientSecret } for handleNextAction, or { status:'done' }.
  async [CONSTANTS.methods.pro.actionSecret]() {
    requireCloud()
    const user = await signedIn()
    return managed(() => actionSecret(billingDeps(), { userId: user._id, pro: user.pro }))
  },

  // Receipts: [{ number, created, totalCents, status, url, pdf }], newest first.
  async [CONSTANTS.methods.pro.invoices]() {
    requireCloud()
    const user = await signedIn()
    if (!user.pro?.customerId) return []
    return invoiceRows(await stripeClient().invoices.list({ customer: user.pro.customerId, limit: 12 }))
  },

  // The return page asks until the subscription is on the account (the webhook usually arrives first).
  // → { status, claim }: claim says what a guest's email did (pro-claim.mjs), for the Welcome's next step.
  async [CONSTANTS.methods.pro.confirm]({ sessionId } = {}) {
    check(sessionId, String)
    requireCloud()
    const user = await buyer()
    const stripe = stripeClient()
    const session = await readSession(stripe, sessionId)
    if (session.client_reference_id !== user._id || session.metadata?.product !== 'pro') throw new Meteor.Error('invalid', PRO_COPY.notYours)
    if (session.status !== 'complete' || !session.subscription) return { status: 'pending' }
    const deps = billingDeps()
    if (session.customer) await billingStore.setProCustomer(user._id, typeof session.customer === 'string' ? session.customer : session.customer.id)
    await syncSubscription(deps, typeof session.subscription === 'string' ? session.subscription : session.subscription.id, { userId: user._id })
    const claim = await claimPurchase(session)
    const fresh = await Meteor.users.findOneAsync(user._id, { fields: { pro: 1 } })
    return { status: fresh?.pro?.status === 'active' ? 'active' : 'pending', claim: ['attached', 'existing'].includes(claim?.kind) ? claimAnswer(claim) : null }
  },

  // The Welcome's optional next step for a guest who just paid: a password, so the slates are theirs on
  // every device. Only on the account their own payment named, and only while it has none.
  async [CONSTANTS.methods.pro.setPassword]({ password } = {}) {
    check(password, String)
    requireCloudLicense()
    const user = await Meteor.userAsync()
    if (!canSetFirstPassword(user)) throw new Meteor.Error('not-allowed', 'Set or change your password from your profile.')
    if (password.length < 8 || password.length > 256) throw new Meteor.Error('weak-password', 'Choose a password of at least 8 characters.')
    // once: the first caller marks it, a second (another tab, a replay) finds it marked
    const marked = await Meteor.users.rawCollection().updateOne(
      { _id: user._id, isAnonymous: false, 'checkoutClaim.kind': 'attached', 'checkoutClaim.passwordSet': { $ne: true } },
      { $set: { 'checkoutClaim.passwordSet': true } },
    )
    if (marked.modifiedCount !== 1) throw new Meteor.Error('not-allowed', 'Set or change your password from your profile.')
    await Accounts.setPasswordAsync(user._id, password, { logout: false })
    await Audit.insertAsync({ type: 'pro-guest-password-set', userId: user._id, created: Date.now() })
    return true
  },

  // Stripe's customer portal: change card, switch monthly and yearly, cancel, invoices.
  async [CONSTANTS.methods.pro.portal]() {
    requireCloud()
    const user = await signedIn()
    if (!user.pro?.customerId) throw new Meteor.Error('pro-none', PRO_COPY.noCustomer)
    const configuration = Meteor.settings.stripe?.proPortalConfiguration
    const session = await stripeClient().billingPortal.sessions.create({
      customer: user.pro.customerId, return_url: `${Meteor.settings.public.baseUrl}/profile?tab=credits`, ...(configuration && { configuration }),
    })
    return { url: session.url }
  },

  // Reads the subscription again when the account looks out of date (a missed webhook):
  // at most once every 10 minutes per person.
  async [CONSTANTS.methods.pro.refresh]() {
    requireCloud()
    const user = await signedIn()
    const subscriptionId = user.pro?.subscriptionId
    if (!subscriptionId) return false
    const last = recentRefresh.get(user._id) || 0
    if (Date.now() - last < 10 * 60_000) return false
    recentRefresh.set(user._id, Date.now())
    await syncSubscription(billingDeps(), subscriptionId, { userId: user._id })
    return true
  },
})
