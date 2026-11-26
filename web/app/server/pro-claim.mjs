// Slatebox Pro bought by a guest (the site's "Get Slatebox Pro" opens the pay sheet at once, with no
// sign-up first). The guest pays in the sheet and gives an email there; the subscription lands on the
// guest account through the usual webhook (client_reference_id), so Pro is on even if the tab closes.
// What happens to the account after the payment is decided here. Pure apart from the injected deps;
// the Meteor glue is server/methods/pro.js.
//
// The safety rules:
//   - An email nobody uses becomes the guest account's own address, unconfirmed, and a confirmation
//     email goes to it. The guest account becomes a normal account (it can set a password later).
//   - An email that already belongs to an account is never attached and never signs anyone in. The
//     guest keeps Pro on this device, and a one-time link goes to that address. Only whoever opens it
//     (so, whoever reads that mailbox) moves the Pro, the guest's slates and their start page tiles
//     (with the library drafts those tiles built) into that account.
//     Typing someone else's email therefore gives the typist nothing: no sign-in, no access, no data.
//   - Every step is idempotent: the webhook and the sheet's confirm both run it, in any order, any
//     number of times, and one email is sent at most (the claim is written once, atomically).

export const MERGE_LINK_DAYS = 7
const PAID = new Set(['paid', 'no_payment_required'])
const idOf = value => (typeof value === 'string' ? value : value?.id ?? null)

/** A buyer's address, trimmed and lower-cased, or null when it is not one we can send to (guest placeholders included). */
export function buyerEmail(value) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  if (/\.invalid$/.test(email) || /\.local$/.test(email)) return null
  return email
}

/** The paid Pro purchase a Checkout session records, or null (not Pro, not complete, not paid). */
export function purchaseOfSession(session) {
  if (!session || session.metadata?.product !== 'pro' || session.mode !== 'subscription') return null
  if (session.status !== 'complete' || !PAID.has(session.payment_status)) return null
  const userId = session.client_reference_id
  if (!userId) return null
  return {
    userId,
    sessionId: session.id,
    subscriptionId: idOf(session.subscription),
    email: session.customer_details?.email ?? session.customer_email ?? null,
  }
}

/** What the buyer's own session may be told about the claim: never another account's id. */
export const claimAnswer = claim => (claim ? { kind: claim.kind, email: claim.email ?? null } : null)

/**
 * After a paid Pro checkout: attach the buyer's email to the guest account, or send the move link.
 * deps: { store, sendVerification(userId), sendMergeLink({ guestId, targetId, email, sessionId }), audit(entry), now() }
 * store: { findUser(id) → { _id, isAnonymous, checkoutClaim } | null,
 *          findUserByEmail(email) → { _id } | null (any case),
 *          attachEmail(userId, email, claim) → 'attached' | 'taken' | 'skipped' (only while still a guest with no claim;
 *            'taken' when the address became someone else's meanwhile),
 *          markClaim(userId, claim) → boolean (only while no claim is written) }
 * → { kind: 'none' | 'member' | 'no-email' | 'attached' | 'existing' | 'merged', email? }
 */
export async function claimGuestPurchase(deps, session) {
  const { store, now } = deps
  const purchase = purchaseOfSession(session)
  if (!purchase) return { kind: 'none' }
  const user = await store.findUser(purchase.userId)
  if (!user) return { kind: 'none' }
  if (user.checkoutClaim) return claimAnswer(user.checkoutClaim)
  if (!user.isAnonymous) return { kind: 'member' }
  const email = buyerEmail(purchase.email)
  if (!email) return { kind: 'no-email' }
  const base = { email, sessionId: purchase.sessionId, at: now() }

  const toExisting = async target => {
    const claim = { ...base, kind: 'existing', targetId: target._id }
    if (await store.markClaim(user._id, claim)) {
      await deps.sendMergeLink({ guestId: user._id, targetId: target._id, email, sessionId: purchase.sessionId })
      await deps.audit({ type: 'pro-guest-existing-email', userId: user._id, targetId: target._id, sessionId: purchase.sessionId })
      return claimAnswer(claim)
    }
    return claimAnswer((await store.findUser(user._id))?.checkoutClaim) || { kind: 'none' }
  }

  const existing = await store.findUserByEmail(email)
  if (existing && existing._id !== user._id) return toExisting(existing)

  const result = await store.attachEmail(user._id, email, { ...base, kind: 'attached' })
  if (result === 'attached') {
    await deps.audit({ type: 'pro-guest-email-attached', userId: user._id, sessionId: purchase.sessionId })
    try {
      await deps.sendVerification(user._id)
    } catch (error) {
      // the account and Pro are in place; the confirmation can be asked for again from the profile
      await deps.audit({ type: 'pro-guest-verification-failed', userId: user._id, message: String(error?.message || error) })
    }
    return { kind: 'attached', email }
  }
  if (result === 'taken') {
    const owner = await store.findUserByEmail(email)
    if (owner && owner._id !== user._id) return toExisting(owner)
  }
  const fresh = await store.findUser(user._id)
  return claimAnswer(fresh?.checkoutClaim) || { kind: fresh?.isAnonymous === false ? 'member' : 'none' }
}

/** Whether a move link may still be used. */
export const mergeLinkLive = (link, now) => Boolean(link?.mergeFrom) && now < (link.expiresAt ?? 0)

/**
 * Opening the move link (sent only to the existing account's address): moves the guest's Pro,
 * slates and start page tiles into that account. Runs once per claim: a second open finds the claim already 'merged'.
 * deps: { stripe (subscriptions.update), store, sync(subscriptionId, userId), audit(entry), now() }
 * store: { findUser(id) → { _id, isAnonymous, checkoutClaim, pro } | null,
 *          clearGuestPro(guestId, subscriptionId) → boolean, moveSlates(fromId, toId) → number,
 *          moveTiles(fromId, toId) → number (the tiles, the library drafts they built, and the account's tile count),
 *          setClaim(guestId, claim) }
 * → { moved: boolean, reason?, subscriptionId?, slates?, tiles? }
 */
export async function mergeGuestPurchase(deps, { guestId, targetId }) {
  const { stripe, store, now } = deps
  if (!guestId || !targetId || guestId === targetId) return { moved: false, reason: 'invalid' }
  const guest = await store.findUser(guestId)
  const claim = guest?.checkoutClaim
  if (!guest || !guest.isAnonymous || claim?.kind !== 'existing' || claim.targetId !== targetId) return { moved: false, reason: 'not-pending' }
  const subscriptionId = guest.pro?.subscriptionId ?? null
  if (subscriptionId) {
    // future webhooks find the account by the subscription's metadata once the guest no longer holds it
    await stripe.subscriptions.update(subscriptionId, { metadata: { product: 'pro', userId: targetId } }, { idempotencyKey: `pro-merge:${subscriptionId}:${targetId}` })
    await store.clearGuestPro(guestId, subscriptionId)
    // a second subscription on an account that already holds Pro is cancelled and refunded (syncSubscription)
    await deps.sync(subscriptionId, targetId)
  }
  const slates = await store.moveSlates(guestId, targetId)
  // the start page's tiles are the guest's own work too, and "Make another" opens their kept drafts, so both move
  const tiles = await store.moveTiles(guestId, targetId)
  await store.setClaim(guestId, { ...claim, kind: 'merged', mergedAt: now() })
  await deps.audit({ type: 'pro-guest-merged', userId: targetId, guestId, subscriptionId, slates, tiles })
  return { moved: true, subscriptionId, slates, tiles }
}

/**
 * Whether the buyer may choose a first password from the Welcome (the optional "keep your slates on
 * every device" step): only on the account their own payment just named, and only once. (A guest is
 * made with a random password nobody knows, so "has no password" is not the signal: the claim's own
 * passwordSet is, written once, atomically, by pro.setPassword.) Later changes go through the profile.
 */
export function canSetFirstPassword(user) {
  if (!user || user.isAnonymous) return false
  if (user.checkoutClaim?.kind !== 'attached') return false
  return !user.checkoutClaim.passwordSet
}
