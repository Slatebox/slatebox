import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MERGE_LINK_DAYS, buyerEmail, canSetFirstPassword, claimAnswer, claimGuestPurchase, mergeGuestPurchase, mergeLinkLive, purchaseOfSession,
} from '../web/app/server/pro-claim.mjs'
import { proCheckoutParams } from '../web/app/server/pro-billing.mjs'
import { DEFAULT_METERING, route } from '../web/app/server/metering/policy.mjs'
import { oldProLink, planInterval, proSheetPath } from '../web/app/imports/ui/components/billing/pay/pay-url.mjs'
import { BUYER_EMAIL, buyerEmailValid, claimCopy } from '../web/app/imports/ui/components/billing/pay/pay-copy.mjs'

// Slatebox Pro bought with no sign-up first (the site's "Get Slatebox Pro" → /pro → the pay sheet as a
// guest). The account side of the payment: an unused email names the guest's account; an email that
// already has an account is never attached and never signs anyone in, and only a link sent to that
// address moves the Pro. No network: Mongo and Stripe are in memory.

const NOW = Date.UTC(2026, 10, 23, 12)
const read = file => readFileSync(new URL('../web/app/' + file, import.meta.url), 'utf8')

const paid = (over = {}) => ({
  id: 'cs_test_1', object: 'checkout.session', mode: 'subscription', status: 'complete', payment_status: 'paid',
  client_reference_id: 'guest1', subscription: 'sub_1', metadata: { product: 'pro', userId: 'guest1', guest: '1' },
  customer_details: { email: 'New.Person@Example.com' }, ...over,
})

// In-memory users with the same atomic rules as server/methods/pro.js claimStore.
function world(users = []) {
  const people = new Map(users.map(u => [u._id, structuredClone(u)]))
  const sent = { verifications: [], mergeLinks: [] }
  const audits = []
  const slates = [{ _id: 's1', userId: 'guest1' }, { _id: 's2', userId: 'guest1' }, { _id: 's3', userId: 'other' }]
  const tiles = [{ _id: 't1', userId: 'guest1' }, { _id: 't2', userId: 'other' }]
  const hooks = { beforeAttach: null }
  const emailOwner = email => [...people.values()].find(u => (u.emails || []).some(e => e.address.toLowerCase() === email.toLowerCase())) || null
  const store = {
    async findUser(id) { const u = people.get(id); return u ? structuredClone(u) : null },
    async findUserByEmail(email) { const u = emailOwner(email); return u ? { _id: u._id } : null },
    async attachEmail(userId, email, claim) {
      if (hooks.beforeAttach) await hooks.beforeAttach()
      const u = people.get(userId)
      if (!u || u.isAnonymous !== true || u.checkoutClaim) return 'skipped'
      const owner = emailOwner(email)
      if (owner && owner._id !== userId) return 'taken' // the unique index on emails.address
      Object.assign(u, { emails: [{ address: email, verified: false }], isAnonymous: false, checkoutClaim: claim })
      return 'attached'
    },
    async markClaim(userId, claim) {
      const u = people.get(userId)
      if (!u || u.isAnonymous !== true || u.checkoutClaim) return false
      u.checkoutClaim = claim
      return true
    },
    async setClaim(userId, claim) { people.get(userId).checkoutClaim = claim },
    async clearGuestPro(guestId, subscriptionId) {
      const u = people.get(guestId)
      if (u?.pro?.subscriptionId !== subscriptionId) return false
      u.pro = null
      return true
    },
    async moveSlates(from, to) { let n = 0; for (const s of slates) if (s.userId === from) { s.userId = to; n += 1 } return n },
    async moveTiles(from, to) { let n = 0; for (const t of tiles) if (t.userId === from) { t.userId = to; n += 1 } return n },
  }
  const deps = {
    store,
    sendVerification: async userId => { sent.verifications.push(userId) },
    sendMergeLink: async link => { sent.mergeLinks.push(link) },
    audit: async entry => { audits.push(entry) },
    now: () => NOW,
  }
  const stripeCalls = []
  const syncs = []
  const mergeDeps = {
    store, now: () => NOW, audit: deps.audit,
    stripe: { subscriptions: { async update(id, params, opts) { stripeCalls.push({ id, params, key: opts?.idempotencyKey }); return { id } } } },
    sync: async (subscriptionId, userId) => { syncs.push({ subscriptionId, userId }); people.get(userId).pro = { subscriptionId, status: 'active' } },
  }
  return { people, sent, audits, slates, tiles, deps, mergeDeps, stripeCalls, syncs, hooks }
}

const guest = (over = {}) => ({ _id: 'guest1', isAnonymous: true, emails: [{ address: 'guest-x@anonymous.slatebox.invalid', verified: false }], pro: { subscriptionId: 'sub_1', status: 'active' }, ...over })
const member = (over = {}) => ({ _id: 'm1', isAnonymous: false, emails: [{ address: 'Owner@Example.com', verified: true }], ...over })

test('the buyer\'s email: trimmed, lower-cased, and never a guest placeholder or junk', () => {
  assert.equal(buyerEmail('  New.Person@Example.COM '), 'new.person@example.com')
  assert.equal(buyerEmail('guest-abc@anonymous.slatebox.invalid'), null)
  assert.equal(buyerEmail('me@laptop.local'), null)
  assert.equal(buyerEmail('not an email'), null)
  assert.equal(buyerEmail(null), null)
  assert.equal(buyerEmail(`${'a'.repeat(250)}@x.co`), null)
})

test('only a complete, paid Pro checkout is a purchase', () => {
  assert.deepEqual(purchaseOfSession(paid()), { userId: 'guest1', sessionId: 'cs_test_1', subscriptionId: 'sub_1', email: 'New.Person@Example.com' })
  assert.equal(purchaseOfSession(paid({ payment_status: 'unpaid' })), null) // an async method still clearing
  assert.equal(purchaseOfSession(paid({ status: 'open' })), null)
  assert.equal(purchaseOfSession(paid({ metadata: { product: 'topup' } })), null)
  assert.equal(purchaseOfSession(paid({ mode: 'payment' })), null)
  assert.equal(purchaseOfSession(paid({ client_reference_id: null })), null)
  assert.equal(purchaseOfSession(paid({ payment_status: 'no_payment_required' })).userId, 'guest1')
})

test('an unused email becomes the guest account\'s own address, unconfirmed, with one confirmation email', async () => {
  const w = world([guest()])
  const out = await claimGuestPurchase(w.deps, paid())
  assert.deepEqual(out, { kind: 'attached', email: 'new.person@example.com' })
  const u = w.people.get('guest1')
  assert.equal(u.isAnonymous, false)
  assert.deepEqual(u.emails, [{ address: 'new.person@example.com', verified: false }])
  assert.equal(u.checkoutClaim.kind, 'attached')
  assert.deepEqual(w.sent.verifications, ['guest1'])
  assert.equal(w.sent.mergeLinks.length, 0)
  // the webhook and the sheet's confirm both run it: the second run sends nothing more
  assert.deepEqual(await claimGuestPurchase(w.deps, paid()), { kind: 'attached', email: 'new.person@example.com' })
  assert.deepEqual(w.sent.verifications, ['guest1'])
})

test('a failed confirmation email never undoes the account or the Pro', async () => {
  const w = world([guest()])
  w.deps.sendVerification = async () => { throw new Error('mail down') }
  assert.equal((await claimGuestPurchase(w.deps, paid())).kind, 'attached')
  assert.equal(w.people.get('guest1').isAnonymous, false)
  assert.ok(w.audits.some(a => a.type === 'pro-guest-verification-failed'))
})

test('an email that already has an account is never attached and never signs anyone in: a link goes to that address', async () => {
  const w = world([guest(), member()])
  const out = await claimGuestPurchase(w.deps, paid({ customer_details: { email: 'owner@example.COM' } }))
  // the buyer is told where the link went, never the other account's id
  assert.deepEqual(out, { kind: 'existing', email: 'owner@example.com' })
  assert.equal(JSON.stringify(out).includes('m1'), false)
  const g = w.people.get('guest1')
  assert.equal(g.isAnonymous, true, 'the guest stays a guest')
  assert.equal(g.emails[0].address, 'guest-x@anonymous.slatebox.invalid', 'the address is not copied onto the guest')
  assert.deepEqual(g.pro, { subscriptionId: 'sub_1', status: 'active' }, 'Pro stays on where it was paid')
  const m = w.people.get('m1')
  assert.deepEqual(m.emails, [{ address: 'Owner@Example.com', verified: true }], 'the existing account is untouched')
  assert.equal(m.pro, undefined)
  assert.deepEqual(w.sent.mergeLinks, [{ guestId: 'guest1', targetId: 'm1', email: 'owner@example.com', sessionId: 'cs_test_1' }])
  assert.equal(w.sent.verifications.length, 0)
  // again (webhook + confirm, retries): one link only
  await claimGuestPurchase(w.deps, paid({ customer_details: { email: 'owner@example.com' } }))
  assert.equal(w.sent.mergeLinks.length, 1)
})

test('an address taken between the check and the write goes the existing-account way, not a duplicate', async () => {
  const w = world([guest()])
  w.hooks.beforeAttach = async () => { w.people.set('late', { _id: 'late', isAnonymous: false, emails: [{ address: 'new.person@example.com', verified: false }] }) }
  const out = await claimGuestPurchase(w.deps, paid())
  assert.deepEqual(out, { kind: 'existing', email: 'new.person@example.com' })
  assert.equal(w.people.get('guest1').isAnonymous, true)
  assert.equal(w.sent.mergeLinks[0].targetId, 'late')
})

test('a member\'s purchase, a missing email, an unpaid session, or an unknown account changes no account', async () => {
  const w = world([member({ _id: 'guest1' })])
  assert.deepEqual(await claimGuestPurchase(w.deps, paid()), { kind: 'member' })
  const v = world([guest()])
  assert.deepEqual(await claimGuestPurchase(v.deps, paid({ customer_details: { email: 'guest-y@anonymous.slatebox.invalid' } })), { kind: 'no-email' })
  assert.deepEqual(await claimGuestPurchase(v.deps, paid({ payment_status: 'unpaid' })), { kind: 'none' })
  assert.deepEqual(await claimGuestPurchase(v.deps, paid({ client_reference_id: 'nobody' })), { kind: 'none' })
  assert.equal(v.people.get('guest1').isAnonymous, true)
  assert.equal(v.sent.verifications.length + v.sent.mergeLinks.length + w.sent.verifications.length, 0)
})

test('opening the move link moves the guest\'s Pro and slates into the account it was sent to, once', async () => {
  const w = world([guest(), member()])
  await claimGuestPurchase(w.deps, paid({ customer_details: { email: 'owner@example.com' } }))
  const out = await mergeGuestPurchase(w.mergeDeps, { guestId: 'guest1', targetId: 'm1' })
  assert.deepEqual(out, { moved: true, subscriptionId: 'sub_1', slates: 2, tiles: 1 })
  // webhooks find the account by the subscription's metadata from now on
  assert.deepEqual(w.stripeCalls, [{ id: 'sub_1', params: { metadata: { product: 'pro', userId: 'm1' } }, key: 'pro-merge:sub_1:m1' }])
  assert.equal(w.people.get('guest1').pro, null)
  assert.deepEqual(w.syncs, [{ subscriptionId: 'sub_1', userId: 'm1' }])
  assert.equal(w.people.get('m1').pro.subscriptionId, 'sub_1')
  assert.deepEqual(w.slates.map(s => s.userId), ['m1', 'm1', 'other'])
  // the start page's tiles move with them (the store moves the drafts those tiles built and the tile count too)
  assert.deepEqual(w.tiles.map(t => t.userId), ['m1', 'other'])
  assert.equal(w.people.get('guest1').checkoutClaim.kind, 'merged')
  // a second open moves nothing
  assert.deepEqual(await mergeGuestPurchase(w.mergeDeps, { guestId: 'guest1', targetId: 'm1' }), { moved: false, reason: 'not-pending' })
  assert.equal(w.stripeCalls.length, 1)
})

test('nothing moves to an account the claim does not name, or without a pending claim', async () => {
  const w = world([guest(), member(), member({ _id: 'm2', emails: [{ address: 'x@example.com', verified: true }] })])
  assert.equal((await mergeGuestPurchase(w.mergeDeps, { guestId: 'guest1', targetId: 'm1' })).reason, 'not-pending') // no claim yet
  await claimGuestPurchase(w.deps, paid({ customer_details: { email: 'owner@example.com' } }))
  assert.equal((await mergeGuestPurchase(w.mergeDeps, { guestId: 'guest1', targetId: 'm2' })).reason, 'not-pending')
  assert.equal((await mergeGuestPurchase(w.mergeDeps, { guestId: 'guest1', targetId: 'guest1' })).reason, 'invalid')
  assert.equal((await mergeGuestPurchase(w.mergeDeps, { guestId: 'm1', targetId: 'm1' })).reason, 'invalid')
  assert.equal(w.stripeCalls.length, 0)
  assert.equal(w.people.get('guest1').pro.subscriptionId, 'sub_1')
})

test('a move link works for its days only, and only a move link is one', () => {
  const link = { mergeFrom: 'guest1', expiresAt: NOW + MERGE_LINK_DAYS * 86_400_000 }
  assert.equal(mergeLinkLive(link, NOW), true)
  assert.equal(mergeLinkLive(link, NOW + MERGE_LINK_DAYS * 86_400_000), false)
  assert.equal(mergeLinkLive({ expiresAt: NOW + 1000 }, NOW), false)
  assert.equal(mergeLinkLive(null, NOW), false)
})

test('the move link is checked, single-use and emailed only to that address (users.js, pro.js)', () => {
  const users = read('server/methods/users.js')
  assert.match(users, /if \(ll\?\.mergeFrom\)/)
  assert.match(users, /deleteOne\(\{ _id: ll\._id \}\)/)
  assert.match(users, /removed\.deletedCount !== 1 \|\| !mergeLinkLive\(ll, Date\.now\(\)\)\) return null/)
  const pro = read('server/methods/pro.js')
  assert.match(pro, /const linkId = Random\.secret\(32\)/)
  assert.match(pro, /to: email,/)
  // the guest's own confirm only ever sees its own session (client_reference_id), and the claim without ids
  assert.match(pro, /session\.client_reference_id !== user\._id/)
  assert.match(pro, /claimAnswer\(claim\)/)
  assert.deepEqual(claimAnswer({ kind: 'existing', email: 'a@b.co', targetId: 'm1', sessionId: 'cs' }), { kind: 'existing', email: 'a@b.co' })
})

test('the first password: only on the account the buyer\'s own payment named, only once', () => {
  // a guest is made with a random password nobody knows: that one does not count against the first password
  const named = { _id: 'g', isAnonymous: false, checkoutClaim: { kind: 'attached' }, services: { password: { bcrypt: 'random-at-guest-creation' } } }
  assert.equal(canSetFirstPassword(named), true)
  assert.equal(canSetFirstPassword({ ...named, checkoutClaim: { kind: 'attached', passwordSet: true } }), false, 'once only')
  assert.match(read('server/methods/pro.js'), /'checkoutClaim\.passwordSet': \{ \$ne: true \}/, 'marked atomically before the password is set')
  assert.equal(canSetFirstPassword({ ...named, checkoutClaim: { kind: 'existing' } }), false)
  assert.equal(canSetFirstPassword({ ...named, checkoutClaim: null }), false)
  assert.equal(canSetFirstPassword({ ...named, isAnonymous: true }), false)
  assert.equal(canSetFirstPassword(null), false)
})

test('a guest\'s checkout prefills no email (the sheet asks), keeps tax on top and marks the guest', () => {
  const p = proCheckoutParams({ userId: 'guest1', email: null, priceId: 'price_m', baseUrl: 'https://app.slatebox.com', ui: 'elements', guest: true, now: NOW })
  assert.equal(p.customer_email, undefined)
  assert.equal(p.customer, undefined)
  assert.equal(p.client_reference_id, 'guest1')
  assert.deepEqual(p.metadata, { product: 'pro', userId: 'guest1', guest: '1' })
  assert.deepEqual(p.automatic_tax, { enabled: true })
  assert.deepEqual(p.line_items, [{ price: 'price_m', quantity: 1 }])
  // a member's is as before
  const m = proCheckoutParams({ userId: 'm1', email: 'a@example.test', priceId: 'price_m', baseUrl: 'x', ui: 'elements', now: NOW })
  assert.equal(m.customer_email, 'a@example.test')
  assert.deepEqual(m.metadata, { product: 'pro', userId: 'm1' })
})

test('a guest may start a Pro checkout; members no longer wait on email confirmation to pay (pro.js)', () => {
  const pro = read('server/methods/pro.js')
  const checkout = pro.slice(pro.indexOf('[CONSTANTS.methods.pro.checkout]'), pro.indexOf('[CONSTANTS.methods.pro.preview]'))
  assert.match(checkout, /const user = await buyer\(\)/)
  assert.doesNotMatch(checkout, /signedIn\(\)/)
  assert.doesNotMatch(checkout, /PRO_COPY\.unverified/)
  assert.match(checkout, /HELD_STATUSES\.has\(user\.pro\?\.status\)/, 'never a second Pro')
  // the tab closed mid-payment: the webhook claims too
  assert.match(pro, /export async function handleBilling\(event\)[\s\S]*?claimPurchase\(event\.data\?\.object\)/)
})

test('a paid Pro counts as a confirmed address for the included amount; without Pro it still does not', () => {
  const settings = { ...DEFAULT_METERING, free: { ...DEFAULT_METERING.free, proRequiredFrom: 'now' } }
  const ask = person => route({
    kind: 'ai', person, teamId: null, keys: {}, usage: { aiActionsToday: 0, aiMicrosMonth: 0, freeMicrosToday: 0, voiceMinutesMonth: 0, videoMinutesMonth: 0 },
    wallets: {}, global: { monthFreeMicros: 0, todayFreeMicros: 0 }, estimateMicros: 5000, settings, now: NOW,
  })
  const base = { id: 'p', anonymous: false, emailVerified: false }
  assert.equal(ask({ ...base, included: true, pro: true }).ok, true)
  assert.equal(ask({ ...base, included: true, pro: true }).route, 'free')
  assert.equal(ask({ ...base, included: false, pro: false }).ok, false)
})

test('the site\'s links: /pro?plan= opens the sheet preselected; the old Credits link leads there for non-members', () => {
  const q = s => new URLSearchParams(s)
  assert.equal(planInterval('yearly'), 'year')
  assert.equal(planInterval('YEAR'), 'year')
  assert.equal(planInterval('monthly'), 'month')
  assert.equal(planInterval('weekly'), null)
  assert.equal(proSheetPath(q('plan=yearly')), '/?pay=pro&plan=yearly')
  assert.equal(proSheetPath(q('plan=monthly')), '/?pay=pro&plan=monthly')
  assert.equal(proSheetPath(q('plan=../x')), '/?pay=pro&plan=monthly')
  assert.equal(proSheetPath(q('')), '/?pay=pro&plan=monthly')
  assert.equal(oldProLink(q('tab=credits'), 'none'), '/pro')
  assert.equal(oldProLink(q('tab=credits'), 'guest'), '/pro')
  assert.equal(oldProLink(q('tab=free'), 'guest'), '/pro')
  assert.equal(oldProLink(q('tab=credits'), 'member'), null, 'a member keeps their Credits tab')
  assert.equal(oldProLink(q('tab=credits&buy=pro-yearly'), 'member'), '/pro?plan=yearly')
  assert.equal(oldProLink(q('tab=credits&buy=pro-monthly'), 'none'), '/pro?plan=monthly')
  assert.equal(oldProLink(q('tab=credits&buy=evil'), 'member'), null)
  assert.equal(oldProLink(q('tab=profile'), 'none'), null)
  const routes = read('imports/ui/SBRoutes.jsx')
  assert.match(routes, /<Route path="\/pro" element=\{<GetPro \/>\} \/>/)
  assert.match(routes, /<Route path="\/profile" element=\{<ProfileRoute \/>\} \/>/)
  // /pro is not behind PrivateRoute: a brand-new visitor is made a guest there, never sent to /start
  assert.match(read('imports/ui/pages/GetPro.jsx'), /createAnonymousUser\(\)/)
})

test('the sheet\'s words for a guest: an email field, then a gentle optional password, never the processor\'s name', () => {
  assert.equal(buyerEmailValid('a@b.co'), true)
  assert.equal(buyerEmailValid('guest-1@anonymous.slatebox.invalid'), false)
  assert.equal(buyerEmailValid('nope'), false)
  const attached = claimCopy({ kind: 'attached', email: 'a@b.co' })
  assert.equal(attached.skip, 'Not now')
  assert.match(attached.lead, /a@b\.co/)
  assert.match(attached.lead, /now or later/)
  const existing = claimCopy({ kind: 'existing', email: 'a@b.co' })
  assert.match(existing.lead, /already has a Slatebox account/)
  assert.match(existing.lead, /move Slatebox Pro and these slates into that account/)
  // a guest session does not get included AI (the meter serves members), so nothing promises Pro works here
  assert.doesNotMatch(existing.lead, /on here|works here/)
  assert.equal(existing.action, undefined, 'nothing to fill in: the link does the rest')
  assert.equal(claimCopy({ kind: 'member' }), null)
  assert.equal(claimCopy(null), null)
  for (const text of [BUYER_EMAIL.label, BUYER_EMAIL.help, BUYER_EMAIL.invalid, attached.title, attached.lead, attached.saved, existing.title, existing.lead]) {
    assert.doesNotMatch(text, /stripe|upgrade|sign up/i, text)
  }
})
