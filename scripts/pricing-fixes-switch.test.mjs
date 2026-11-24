// Fixes for the hostile review of the pricing switch on release/combined (attack.md #1-#10).
// Each test failed before its fix.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyWallet } from '../web/app/server/metering/ledger.mjs'
import { guardsPass } from '../web/app/server/metering/holds.mjs'
import { DEFAULT_METERING, allowanceSummary, meteringEnabled, refundableCents } from '../web/app/server/metering/policy.mjs'
import { handleWalletEvent, refundBalanceOnce } from '../web/app/server/wallet-stripe.mjs'
import { transcriptionAllowed, startCall } from '../web/app/server/metering/calls.mjs'
import { METER_RATE_LIMITS, ddpRule } from '../web/app/server/metering/limits.mjs'
import { isCloudflareAddress, resolveClientAddress } from '../web/app/server/metering/client-address.mjs'
import { mayPostRefusal } from '../web/app/server/metering/refusal-notice.mjs'
import { refundConfirmText } from '../web/app/imports/ui/components/billing/money.js'

const app = new URL('../web/app/', import.meta.url).pathname
const source = path => readFileSync(join(app, path), 'utf8')

// ---------- #1 a paid top-up is never lost ----------
// An in-memory io with wallet.js's writes: the credit and the settled mark in one write.
function topUpStore({ failCredits = 0, failRefuseMarks = 0, start } = {}) {
  const ledger = new Map(), wallets = new Map(), refunds = [], alerts = []
  if (start) wallets.set('user:u1', { ...emptyWallet(), ...start })
  let creditFailures = failCredits
  let refuseFailures = failRefuseMarks
  return {
    ledger, wallets, refunds, alerts,
    async appendLedger(e) { if (ledger.has(e.idempotencyKey)) return false; ledger.set(e.idempotencyKey, e); return true },
    async readWallet(id) { const w = wallets.get(id); return w ? structuredClone(w) : null },
    async creditWalletIf(id, { inc, guards, now, settle }) {
      if (creditFailures > 0) { creditFailures--; throw new Error('MongoNetworkError: connection reset') }
      const w = wallets.get(id) || emptyWallet()
      if (!guardsPass(w, guards) || w.settledTopUps?.[settle]) return false
      const next = { ...w, firstTopUpAt: w.firstTopUpAt ?? now, settledTopUps: { ...w.settledTopUps, [settle]: 'credited' } }
      for (const [k, v] of Object.entries(inc)) next[k] = (next[k] || 0) + v
      wallets.set(id, next)
      return true
    },
    async refuseTopUpIf(id, session) {
      const w = wallets.get(id) || emptyWallet()
      if (w.settledTopUps?.[session]) return false
      wallets.set(id, { ...w, settledTopUps: { ...w.settledTopUps, [session]: 'refused' } })
      return true
    },
    async refundPayment(p) {
      if (refuseFailures > 0) { refuseFailures--; throw new Error('Stripe timeout') }
      if (!refunds.some(r => r.idempotencyKey === p.idempotencyKey)) refunds.push(p)
    },
    settings: async () => DEFAULT_METERING,
    alert: async text => { alerts.push(text) },
    now: () => 10_000,
  }
}
const paid = (id, cents = 1000) => ({ type: 'checkout.session.completed', data: { object: {
  id, mode: 'payment', payment_status: 'paid', amount_total: cents + 61, metadata: { walletId: 'user:u1', balanceCents: String(cents) },
  payment_intent: { id: 'pi_' + id, latest_charge: 'ch_' + id },
} } })

test('#1: a credit that fails once after the ledger row is written is made by the retry, once', async () => {
  const io = topUpStore({ failCredits: 1 })
  await assert.rejects(handleWalletEvent(paid('cs_1'), io), /connection reset/)
  assert.ok(io.ledger.has('topup:cs_1'), 'the ledger row was written before the failure')
  const retry = await handleWalletEvent(paid('cs_1'), io)
  assert.equal(retry.credited, true)
  assert.equal(io.wallets.get('user:u1').balanceMicros, 10_000_000)
  assert.equal(io.wallets.get('user:u1').refundableMicros, 10_000_000)
  // more deliveries (Stripe retries, the return page) change nothing
  await handleWalletEvent(paid('cs_1'), io)
  await Promise.all([handleWalletEvent(paid('cs_1'), io), handleWalletEvent(paid('cs_1'), io)])
  assert.equal(io.wallets.get('user:u1').balanceMicros, 10_000_000)
  assert.equal(io.ledger.size, 1)
})

test('#1: a payment over the limits whose refund failed is refunded by the retry, never credited', async () => {
  const io = topUpStore({ failRefuseMarks: 1, start: { balanceMicros: 495_000_000, refundableMicros: 495_000_000, firstTopUpAt: 1 } })
  await assert.rejects(handleWalletEvent(paid('cs_big', 2500), io), /Stripe timeout/)
  // the balance went down in between: the limits would now pass, but the session is already refused
  io.wallets.set('user:u1', { ...io.wallets.get('user:u1'), balanceMicros: 1_000_000, refundableMicros: 1_000_000 })
  const retry = await handleWalletEvent(paid('cs_big', 2500), io)
  assert.equal(retry.refunded, true)
  assert.equal(io.wallets.get('user:u1').balanceMicros, 1_000_000)
  assert.equal(io.refunds.length, 1)
  assert.ok(io.ledger.has('topup-refused:cs_big'))
  await handleWalletEvent(paid('cs_big', 2500), io)
  assert.equal(io.alerts.length, 1, 'one alert for one refused top-up')
})

test('#1: wallet.js keeps the settled mark in the credit write and the return page finishes a half-done top-up', () => {
  const wallet = source('server/methods/wallet.js')
  assert.match(wallet, /async creditWalletIf\(walletId, \{ inc, guards, now, settle \}\)/)
  assert.match(wallet, /\.\.\.unsettled\(settle\)/)
  assert.match(wallet, /async refuseTopUpIf\(/)
  assert.match(wallet, /if \(!known \|\| !await settledOn\(known\.walletId\)\)/)
})

// ---------- #2 no Slatebox Deepgram secret in a customer's Daily room ----------
test('#2: transcription (and the Deepgram secret) only on unmetered operator calls', () => {
  const call = route => startCall({ callId: 'abcdefgh00000000', shareId: 's1', starterId: 'u1', now: 1, decision: { ok: true, route, kind: 'voice', payer: { type: 'user', id: 'u1' }, ...(route === 'byok' && { keyOwner: { type: 'user', id: 'u1' } }) } })
  assert.equal(call('byok').provider, 'own-key')
  assert.equal(transcriptionAllowed(call('byok')), false)
  assert.equal(transcriptionAllowed(call('free')), false)
  assert.equal(transcriptionAllowed(call('balance')), false)
  assert.equal(transcriptionAllowed(call('operator')), true)
  const meteor = source('server/metering/meteor.js')
  // Restated (AI control S3): a Deepgram key an administrator connected in AI control is read first,
  // then the settings file's; either way only behind transcriptionAllowed.
  assert.match(meteor, /const transcriptionKey = transcriptionAllowed\(call\) \? \(\(await auxCredential\('deepgram'\)\)\?\.apiKey \|\| Meteor\.settings\.deepgram\?\.secret\) : null/)
  assert.doesNotMatch(meteor, /dailyClient\(fetch, ownKey \|\| Meteor\.settings\.daily\?\.apiKey, Meteor\.settings\.deepgram/)
  const daily = source('server/methods/daily.js')
  assert.match(daily, /const canTranscribe = grant\.canTranscribe && transcriptionAllowed\(call\)/)
  assert.match(daily, /tokenRequest\(\{ call, grant: \{ \.\.\.grant, canTranscribe \}, now \}\)/)
})

// ---------- #3 a refund that stopped half way is not paid out twice ----------
function refundStore({ failAppends = 1 } = {}) {
  const wallets = new Map([['user:u1', { ...emptyWallet(), balanceMicros: 25_000_000, refundableMicros: 12_000_000 }]])
  const ledger = []
  const store = {
    wallets, ledger,
    async lockWallet(id, requestId, now) {
      const w = wallets.get(id)
      if (w.refunding && w.refundingAt > now - 600_000) return null
      wallets.set(id, { ...w, refunding: requestId, refundingAt: now })
      return structuredClone(wallets.get(id))
    },
    async unlockWallet(id, requestId) { const w = wallets.get(id); if (w.refunding === requestId) { const { refunding, refundingAt, ...rest } = w; wallets.set(id, rest) } },
    async readWallet(id) { return structuredClone(wallets.get(id)) },
    async balanceInUse() { return false },
    async charges() {
      const refunded = ledger.filter(e => e.type === 'refund' && e.stripe.chargeId === 'ch_25').reduce((s, e) => s - e.amountMicros / 10_000, 0)
      return [{ chargeId: 'ch_25', amountCents: 2500, refundedCents: refunded, created: 1 }]
    },
    async markPending(id, part) { const w = wallets.get(id); wallets.set(id, { ...w, pendingRefunds: [...(w.pendingRefunds || []), part] }) },
    async clearPending(id, key) { const w = wallets.get(id); wallets.set(id, { ...w, pendingRefunds: (w.pendingRefunds || []).filter(p => p.idempotencyKey !== key) }) },
    async append(entry) {
      // the server dies after Stripe refunded, before the ledger row
      if (entry.type === 'refund' && failAppends > 0) { failAppends--; throw new Error('server stopped') }
      if (ledger.some(e => e.idempotencyKey === entry.idempotencyKey)) return
      ledger.push(entry)
      const w = wallets.get(entry.walletId)
      wallets.set(entry.walletId, { ...w, balanceMicros: w.balanceMicros + entry.amountMicros, refundableMicros: w.refundableMicros + entry.refundableDeltaMicros })
    },
  }
  return store
}
function stripeDouble() {
  const made = []
  return {
    made,
    refunds: {
      async create(params, { idempotencyKey }) {
        const known = made.find(r => r.idempotencyKey === idempotencyKey)
        if (known) return known
        const room = 2500 - made.filter(r => r.charge === params.charge).reduce((s, r) => s + r.amount, 0)
        if (params.amount > room) throw new Error('exceeds')
        const refund = { id: 're_' + (made.length + 1), charge: params.charge, amount: params.amount, metadata: params.metadata, status: 'succeeded', idempotencyKey }
        made.push(refund)
        return refund
      },
      async list({ charge }) { return { data: made.filter(r => r.charge === charge) } },
    },
  }
}

test('#3: a second refund request after a stop between Stripe and the ledger pays nothing more', async () => {
  const store = refundStore(), stripe = stripeDouble()
  await assert.rejects(refundBalanceOnce({ stripe, io: store, walletId: 'user:u1', requestId: 'r1', now: 1000 }), /server stopped/)
  assert.equal(stripe.made.length, 1, 'Stripe refunded $12.00 once')
  const second = await refundBalanceOnce({ stripe, io: store, walletId: 'user:u1', requestId: 'r2', now: 2000 })
  assert.equal(stripe.made.reduce((s, r) => s + r.amount, 0), 1200, 'the card gets $12.00 in all, not $24.00')
  assert.equal(second.refundedCents, 0)
  assert.equal(store.ledger.filter(e => e.type === 'refund').length, 1)
  assert.equal(store.wallets.get('user:u1').balanceMicros, 0)
  assert.deepEqual(store.wallets.get('user:u1').pendingRefunds, [])
})

test('#3: a part written down but never sent to Stripe is dropped, and the refund then runs', async () => {
  const store = refundStore({ failAppends: 0 }), stripe = stripeDouble()
  await store.markPending('user:u1', { idempotencyKey: 'refund:user:u1:r0:ch_25', chargeId: 'ch_25', amountCents: 1200, created: 1 })
  const out = await refundBalanceOnce({ stripe, io: store, walletId: 'user:u1', requestId: 'r1', now: 1000 })
  assert.equal(out.refundedCents, 1200)
  assert.equal(stripe.made.length, 1)
  assert.deepEqual(store.wallets.get('user:u1').pendingRefunds, [])
})

test('#3: wallet.js writes each part down before Stripe and tags the refund with its ledger key', () => {
  const wallet = source('server/methods/wallet.js')
  assert.match(wallet, /async markPending\(walletId, part\)/)
  assert.match(wallet, /async clearPending\(walletId, idempotencyKey\)/)
  assert.match(source('server/wallet-stripe.mjs'), /metadata: \{ walletId, requestId, ledgerKey: part\.idempotencyKey \}/)
})

// ---------- #4 fail closed on any env but selfhost and dev ----------
test('#4: a missing or misspelled public.env does not run unmetered', () => {
  assert.throws(() => meteringEnabled({}), /metering\.enabled/)
  assert.throws(() => meteringEnabled({ public: {} }), /metering\.enabled/)
  assert.throws(() => meteringEnabled({ public: { env: 'production' } }), /metering\.enabled/)
  assert.throws(() => meteringEnabled({ public: { env: 'Prod' } }), /metering\.enabled/)
  // a deliberate setting is honoured
  assert.equal(meteringEnabled({ public: { env: 'production' }, metering: { enabled: true } }), true)
  assert.equal(meteringEnabled({ public: { env: 'staging' }, metering: { enabled: false } }), false)
  assert.equal(meteringEnabled({ public: { env: 'dev' } }), false)
  assert.equal(meteringEnabled({ public: { env: 'selfhost' } }), false)
  assert.throws(() => meteringEnabled({ public: { env: 'prod' }, metering: { enabled: false } }), /metering\.enabled/)
})

// ---------- #5 rate limits count real people and real addresses ----------
test('#5: the per-person rule leaves signed-out callers to the per-address rule', () => {
  const join = METER_RATE_LIMITS.find(r => r.method === 'daily.join' && r.per === 'user')
  const matcher = ddpRule(join)
  assert.equal(matcher.userId(null), false, 'signed-out callers do not share one bucket')
  assert.equal(matcher.userId(undefined), false)
  assert.equal(matcher.userId('u1'), true)
  assert.match(source('server/metering/meteor.js'), /DDPRateLimiter\.addRule\(ddpRule\(rule\), rule\.count, rule\.intervalMs\)/)
})

test('#5: the caller is found behind Cloudflare; an edge address is never counted as one caller', () => {
  assert.equal(isCloudflareAddress('162.158.1.2'), true)
  assert.equal(isCloudflareAddress('::ffff:104.16.0.9'), true)
  assert.equal(isCloudflareAddress('2606:4700::1'), true)
  assert.equal(isCloudflareAddress('203.0.113.9'), false)
  // the ingress wrote the edge, Cloudflare wrote the visitor before it
  assert.equal(resolveClientAddress({ forwardedFor: '203.0.113.9, 162.158.1.2', forwardedCount: '1', fallback: null }), '203.0.113.9')
  // a forged entry further left is never reached
  assert.equal(resolveClientAddress({ forwardedFor: '1.1.1.1, 198.51.100.7, 162.158.1.2', forwardedCount: '1' }), '198.51.100.7')
  assert.equal(resolveClientAddress({ forwardedFor: '104.16.0.1, 198.51.100.7, 162.158.1.2', forwardedCount: '1' }), '198.51.100.7')
  // straight to the ingress: that address, whatever the caller wrote
  assert.equal(resolveClientAddress({ forwardedFor: '162.158.1.2, 198.51.100.8', forwardedCount: '1' }), '198.51.100.8')
  // only the edge is known: the rule skips it
  const onlyEdge = resolveClientAddress({ forwardedFor: '162.158.1.2', forwardedCount: '1' })
  const address = ddpRule(METER_RATE_LIMITS.find(r => r.per === 'address'))
  assert.equal(address.clientAddress(onlyEdge), false)
  assert.equal(address.clientAddress('203.0.113.9'), true)
  assert.equal(address.clientAddress(null), false)
  // no proxy configured: Meteor's own address
  assert.equal(resolveClientAddress({ forwardedFor: '203.0.113.9', forwardedCount: undefined, fallback: '127.0.0.1' }), '127.0.0.1')
  assert.match(source('server/metering/meteor.js'), /Meteor\.onConnection\(connection => \{\n  const address = resolveClientAddress\(/)
})

// ---------- #6 no refusal in a chat the caller may not use ----------
test('#6: the meter\'s refusal goes into a slate\'s chat only for someone who may change that slate', async () => {
  const slates = { s1: { shareId: 's1', userId: 'owner' } }
  const findSlate = async ({ shareId }) => slates[shareId] || null
  const canEditSlate = async (userId, slate) => slate.userId === userId
  assert.equal(await mayPostRefusal({ userId: null, shareId: 's1', findSlate, canEditSlate }), false, 'signed out')
  assert.equal(await mayPostRefusal({ userId: 'stranger', shareId: 's1', findSlate, canEditSlate }), false)
  assert.equal(await mayPostRefusal({ userId: 'owner', shareId: { $ne: null }, findSlate, canEditSlate }), false, 'not a string')
  assert.equal(await mayPostRefusal({ userId: 'owner', shareId: 'nope', findSlate, canEditSlate }), false)
  assert.equal(await mayPostRefusal({ userId: 'owner', shareId: 's1', findSlate, canEditSlate }), true)
  const openai = source('server/methods/openai.js')
  const metered = openai.slice(openai.indexOf('function metered('), openai.indexOf('const method = {}'))
  assert.match(metered, /const post = await mayPostRefusal\(\{ userId: Meteor\.userId\(\), shareId: args\.shareId, findSlate, canEditSlate \}\)\n      if \(post\) \{/)
})

// #7 and #8 tested the subscriber conversion, which is gone: every subscription was cancelled
// on 2026-11-20 with no conversion.
const NOW = Date.UTC(2026, 10, 20, 12)

// ---------- #9 unconfirmed accounts are not stuck ----------
test('#9: an unconfirmed account is shown no free amount left, and can ask for the email again', () => {
  const settings = DEFAULT_METERING
  const base = { usage: {}, wallets: {}, global: {}, settings, now: NOW }
  const unconfirmed = allowanceSummary({ ...base, person: { id: 'u1', anonymous: false, emailVerified: false } })
  assert.equal(unconfirmed.aiLeftToday, 0)
  assert.equal(unconfirmed.voiceHoursLeft, 0)
  assert.equal(unconfirmed.videoHoursLeft, 0)
  const confirmed = allowanceSummary({ ...base, person: { id: 'u1', anonymous: false, emailVerified: true } })
  assert.equal(confirmed.aiLeftToday, 30)
  const free = source('imports/ui/components/billing/Credits.jsx')
  assert.match(free, /CONSTANTS\.methods\.users\.sendVerification/)
  assert.match(free, /Send the confirmation email again/)
  const users = source('server/methods/users.js')
  assert.match(users, /method\[CONSTANTS\.methods\.users\.sendVerification\] = async function resendVerification\(\)/)
  // opening an emailed login link confirms that address
  assert.match(users, /if \(ll\.email\) await Meteor\.users\.updateAsync\(\{ _id: ll\.userId, 'emails\.0\.address': ll\.email \}, \{ \$set: \{ 'emails\.0\.verified': true \} \}\)/)
  assert.ok(METER_RATE_LIMITS.some(r => r.method === 'users.sendVerification' && r.per === 'user'))
})

test('#9: Refund shows for a balance whether or not the address is confirmed', () => {
  const balance = source('imports/ui/components/billing/Balance.jsx')
  const refundButton = balance.indexOf("'Refund my balance'")
  const verifiedBranch = balance.indexOf('{verified')
  assert.ok(refundButton > 0 && verifiedBranch > 0)
  assert.doesNotMatch(balance, /\{canPay && \(verified \? \(/)
  // gated on the balance alone; the button's styling attributes are not part of the rule
  assert.match(balance, /\{cents > 0 && <Button [^>]*onClick=\{\(\) => setConfirming\(true\)\}[^>]*>/)
  // and it is still disabled while a request is in flight
  assert.match(balance, /\{cents > 0 && <Button [^>]*disabled=\{busy\}[^>]*onClick=\{\(\) => setConfirming\(true\)\}|\{cents > 0 && <Button [^>]*onClick=\{\(\) => setConfirming\(true\)\}[^>]*disabled=\{busy\}/)
})

// ---------- #10 a refund says what it does before it does it ----------
test('#10: Refund asks first and names both amounts; account removal says the same', () => {
  assert.equal(refundConfirmText({ balanceCents: 10335, refundableCents: 6890 }),
    '$68.90 goes back to the card it came from. The other $34.45 cannot go back to a card, so it is closed. Your balance is then $0.00.')
  assert.equal(refundConfirmText({ balanceCents: 1000, refundableCents: 1000 }), '$10.00 goes back to the card it came from, and your balance is closed at $0.00.')
  assert.match(refundConfirmText({ balanceCents: 500, refundableCents: 0 }), /None of your balance of \$5\.00 can go back to a card/)
  assert.equal(refundableCents({ balanceMicros: 103_350_000, refundableMicros: 68_900_000 }), 6890)
  assert.equal(refundableCents({ balanceMicros: 5_000_000, refundableMicros: 9_000_000 }), 500)
  assert.match(source('server/metering/meteor.js'), /refundableCents: refundableCents\(personal\),/)
  const balance = source('imports/ui/components/billing/Balance.jsx')
  assert.match(balance, /<Dialog open=\{confirming\}/)
  assert.doesNotMatch(balance, /onClick=\{refund\}>\{team \? 'Refund the team balance'/)
  const profile = source('imports/ui/pages/Profile.jsx')
  assert.doesNotMatch(profile, /refunds your balance of \$\$\{\(balanceCents/)
  assert.match(profile, /const back = Math\.min\(refundableCents, balanceCents\)/)
})
