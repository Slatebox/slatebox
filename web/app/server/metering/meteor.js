// Meteor glue for the meter: settings, counters, own keys, the call tick, alerts and the
// methods people and admins use. The rules live in the pure modules next to this file.
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { Email } from 'meteor/email'
import { check, Match } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { DDP } from 'meteor/ddp-client'
import fetch from 'node-fetch'
import CONSTANTS from '../../imports/api/common/constants'
import {
  AIAudit, Audit, HuddleCalls, MeterEvents, MeterTotals, Messages, Permissions, ProviderKeys, SystemSettings, WalletLedger, Wallets,
} from '../../imports/api/common/models'
import { currentAIAction, installMeter } from './context.mjs'
import { COPY, HOLDS, allowanceSummary, budgetLevel, creditsForShare, dayKey, fullUseMicros, meteringEnabled, monthKey, proNeeded, proSwitchValue, refundableCents, resolveMetering, route } from './policy.mjs'
import { proCreditShare, proExempt, proIncluded, proOnSale, proPastDue, proSummary } from '../pro-billing.mjs'
import { ESTIMATES, callCostMicros, configurePrices } from './prices.mjs'
import { recordUsage } from './record.mjs'
import { emptyWallet, spendableMicros } from './ledger.mjs'
import { createMeter } from './meter-core.mjs'
import { debitWithRelease, guardFilter } from './holds.mjs'
import { METER_RATE_LIMITS, ddpRule } from './limits.mjs'
import { isProxyAddress, resolveClientAddress } from './client-address.mjs'
import { assertPublicHost, checkOwnEndpoint, ownEndpointAgent } from './own-endpoint.mjs'
import { describeKey, keyDocument, loadMasterKey, open as openKey, PROVIDERS } from './vault.mjs'
import { minutesLeftFor, roomRequest, tick, transcriptionAllowed } from './calls.mjs'
import { runM1, runM2, runM4 } from './migrations.mjs'
import { aiSettings, auxCredential } from '../methods/ai/ai-settings'
import { dailyClient } from '../methods/huddle-provider.mjs'
import { TOP_UP_AMOUNTS, cardFeeMode } from '../../imports/api/billing/top-up.mjs'
import { payAlso, refusalPay } from './refusal-pay.mjs'
import { OWN_KEYS_CLOUD, ownKeysAllowed } from '../../imports/api/common/own-keys.mjs'
import { isInstanceAdmin } from '../permissions'
import { cloudOn, paymentsOn } from '../cloud-lock-meteor'

// Decided once at startup: a Cloud server without metering.enabled stops here (policy.mjs), and
// the meter runs only on Slatebox Cloud by its signed Cloud key (cloud-lock.mjs): a self-hosted
// server has none, whatever metering.enabled says.
const METERED = meteringEnabled(Meteor.settings, { cloud: cloudOn() })
// Own AI and call keys are a self-hosted feature (own-keys.mjs): on Slatebox Cloud none is saved,
// shown or used, and a key saved before stays stored but unused.
const OWN_KEYS = ownKeysAllowed(Meteor.settings)
// The operator's prices (settings.metering.prices) join the table once; a wrong entry stops the start.
configurePrices(Meteor.settings)
// The deploy settings' Pro switch and credit size (metering.proRequiredFrom: 'now' on Slatebox
// Cloud, left out on self-host; metering.creditCostMicrosPerMonth): a wrong value stops the start.
resolveMetering({ deploy: Meteor.settings.metering, ownKeys: OWN_KEYS })
export const meterOn = () => METERED
// The browser shows included amounts, Slatebox Pro, balances and own keys only where a meter runs.
Meteor.settings.public.metered = meterOn()
const master = loadMasterKey(process.env)
Meteor.settings.public.ownKeys = OWN_KEYS && Boolean(master)
export const ownKeysAvailable = () => OWN_KEYS && Boolean(master)

// The card Manage shows, read by methods/pro.js (registered there, so this file does not import it).
let proCardReader = null
export const setProCardReader = reader => { proCardReader = reader }

// ---------- settings ----------
let cached = null
export async function meterSettings() {
  if (cached && cached.until > Date.now()) return cached.value
  const stored = await SystemSettings.findOneAsync({ _id: 'metering' }) || {}
  const value = resolveMetering({ stored, deploy: Meteor.settings.metering, ownKeys: OWN_KEYS })
  cached = { value, until: Date.now() + 15000 }
  return value
}
const forgetSettings = () => { cached = null }

// ---------- reads ----------
export async function usageFor(userId, now) {
  const rows = await MeterTotals.find({ _id: { $in: [`user:${userId}:${monthKey(now)}`, `user:${userId}:${dayKey(now)}`] } }).fetchAsync()
  const month = rows.find(r => r._id.endsWith(monthKey(now))) || {}
  const day = rows.find(r => r._id.endsWith(dayKey(now))) || {}
  // amounts set aside by requests still running count as used
  return {
    aiActionsToday: day.aiActions || 0, freeMicrosToday: (day.freeMicros || 0) + (day.heldMicros || 0),
    aiMicrosMonth: (month.aiMicros || 0) + (month.heldAiMicros || 0), voiceMinutesMonth: month.voiceMinutes || 0, videoMinutesMonth: month.videoMinutes || 0,
  }
}

export async function globalTotals(now) {
  const rows = await MeterTotals.find({ _id: { $in: [`global:${monthKey(now)}`, `global:${dayKey(now)}`] } }).fetchAsync()
  return {
    monthFreeMicros: rows.find(r => r._id === `global:${monthKey(now)}`)?.freeMicros || 0,
    todayFreeMicros: rows.find(r => r._id === `global:${dayKey(now)}`)?.freeMicros || 0,
  }
}

export async function walletState(walletId, now, settings) {
  const wallet = await Wallets.findOneAsync({ _id: walletId }) || { ...emptyWallet(), _id: walletId }
  const since = now - settings.topUp.holdHours * 3600_000
  const topups = await WalletLedger.find({ walletId, type: 'topup', created: { $gt: since } }, { fields: { amountMicros: 1, created: 1 } }).fetchAsync()
  return { ...wallet, recentTopUpMicros: topups.reduce((s, t) => s + t.amountMicros, 0), topups }
}

// Daily keys by owner; for AI, the person's own choice for this feature (ai-settings-core.mjs): a
// connection of theirs or their team's is paid by them, anything else by Slatebox's meter.
async function keyAvailability(ownerType, ownerId, aiScope) {
  if (!ownerId || !OWN_KEYS) return {}
  const ai = aiScope === (ownerType === 'user' ? 'me' : 'team')
  if (!master) return { ai }
  const docs = await ProviderKeys.find({ ownerType, ownerId, provider: 'daily' }, { fields: { cipher: 0 } }).fetchAsync()
  return { ai, daily: docs.some(d => !d.lastError) }
}

async function ownAIScope(user, kind, feature) {
  if (!user || user.isAnonymous || kind !== 'ai') return null
  const choice = await aiSettings.resolveFor({ userId: user._id, feature }).catch(() => null)
  return choice?.own && !choice.error ? choice.scope : null
}

// The platform administrator claim, which belongs to no team.
function isUberMensch(userId) {
  return isInstanceAdmin(userId)
}

// Slatebox Pro for the admin page: people by status and interval.
async function proCounts() {
  const rows = await Meteor.users.rawCollection().aggregate([
    { $match: { 'pro.subscriptionId': { $type: 'string' } } },
    { $group: { _id: { status: '$pro.status', interval: '$pro.interval' }, count: { $sum: 1 } } },
  ]).toArray()
  const sum = test => rows.filter(r => test(r._id)).reduce((s, r) => s + r.count, 0)
  return {
    activeMonthly: sum(k => k.status === 'active' && k.interval === 'month'),
    activeYearly: sum(k => k.status === 'active' && k.interval === 'year'),
    pastDue: sum(k => k.status === 'past_due' || k.status === 'unpaid'),
  }
}

async function isTeamAdmin(user) {
  if (!user?.orgId) return false
  return Boolean(await Permissions.findOneAsync({ userId: user._id, orgId: user.orgId, claimId: CONSTANTS.claims.admin._id }))
}

// ---------- refusals carry the pay sheet's action (design §3.4) ----------
// What pay-route reads about this person, from the same facts meter.summary uses. teamAdmin is read
// only when a team balance was the payer.
async function refusalFlags(user, details = {}) {
  // payments run only on Slatebox Cloud by its Cloud key, with a Stripe key (cloud-lock.mjs)
  const sold = paymentsOn()
  const settings = await meterSettings()
  return {
    proState: user && !user.isAnonymous ? proSummary(user.pro, Date.now()) : null,
    proAvailable: sold && proOnSale(settings),
    topUpsAvailable: sold,
    ownKeysAvailable: OWN_KEYS && Boolean(master),
    ...(details.wallet === 'team' && { teamAdmin: await isTeamAdmin(user) }),
  }
}

/** The pay sheet's action for a refusal of this person: { action, wallet } (refusal-pay.mjs). */
export async function payFor(user, code, details = {}) {
  const flags = await refusalFlags(user, details).catch(() => ({}))
  const pay = refusalPay({ code, details, user, flags })
  // A guest signs in first: nothing is offered beside it.
  const also = user && !user.isAnonymous ? payAlso(pay, flags) : null
  return also ? { ...pay, also } : pay
}

/** A meter refusal as the error a method throws: Meteor.Error(code, message, { pay }). */
export async function refusalError(user, code, message, details = {}) {
  const pay = await payFor(user, code, details)
  return new Meteor.Error(code, message, { pay })
}

// included: the month's amount is theirs (Slatebox Pro where Pro is needed, everyone where it is
// not: self-host); pro: live Pro, so the shared budget's stages do not apply (policy.mjs route).
const personOf = (user, settings, now = Date.now()) => user ? {
  id: user._id, anonymous: Boolean(user.isAnonymous), emailVerified: Boolean(user.emails?.[0]?.verified),
  freeStopped: user.freeStopped === true,
  included: proIncluded(user.pro, now, settings),
  pro: proExempt(user.pro, now, settings),
  proPastDue: proPastDue(user.pro),
  // the month Pro starts in (or ends in, once it will not renew) gives only its share of credits
  creditShare: proCreditShare(user.pro, now, settings),
} : null
/** The meter's settings with this person's allowances for this month (their creditShare). */
export const settingsForUser = (user, settings, now = Date.now()) => creditsForShare(settings, user ? proCreditShare(user.pro, now, settings) : 1)
export const userFields = { fields: { isAnonymous: 1, emails: 1, orgId: 1, profile: 1, freeStopped: 1, pro: 1 } }

// Everything route() needs for one person and one kind of use.
export async function routeFor({ user, kind, feature, estimateMicros, minutes, running, countsAsDraft, now = Date.now() }) {
  const settings = await meterSettings()
  const aiScope = await ownAIScope(user, kind, feature)
  const [usage, global, personalKeys, teamKeys, personal, team] = await Promise.all([
    user ? usageFor(user._id, now) : {},
    globalTotals(now),
    user ? keyAvailability('user', user._id, aiScope) : {},
    user?.orgId ? keyAvailability('org', user.orgId, aiScope) : {},
    user ? walletState('user:' + user._id, now, settings) : null,
    user?.orgId ? walletState('org:' + user.orgId, now, settings) : null,
  ])
  const decision = route({
    kind, person: personOf(user, settings, now), teamId: user?.orgId || null, keys: { personal: personalKeys, team: teamKeys },
    usage, wallets: { personal, team }, global, estimateMicros, minutes, running, countsAsDraft, feature, settings, now,
  })
  return { decision, settings, usage, global, wallets: { personal, team } }
}

// The decrypted key for a byok action. Kept in memory for the request only. For AI it is the
// person's chosen connection for the feature (req.js resolves it again per request, per feature).
export async function credentialsFor(keyOwner, family, feature, userId) {
  if (family === 'ai') {
    if (!OWN_KEYS) throw new Meteor.Error('own-key', OWN_KEYS_CLOUD)
    const choice = await aiSettings.resolveFor({ userId, feature })
    if (choice?.own && !choice.error) return { provider: 'connection', ref: choice.ref }
    throw new Meteor.Error('own-key', choice?.error || 'Your own AI could not be used. Check your AI settings.')
  }
  for (const provider of ['daily']) {
    // the cipher is needed here and never leaves the server
    const doc = await ProviderKeys.findOneAsync({ /* vault-read */ ownerType: keyOwner.type, ownerId: keyOwner.id, provider })
    if (!doc) continue
    try {
      const secret = openKey({ master, owner: { ownerType: doc.ownerType, ownerId: doc.ownerId, provider }, cipher: doc.cipher })
      ProviderKeys.updateAsync({ _id: doc._id }, { $set: { lastUsedAt: Date.now() } }).catch(() => {})
      return { provider, apiKey: secret }
    } catch (error) {
      await ProviderKeys.updateAsync({ _id: doc._id }, { $set: { lastError: 'This key could not be read. Add it again.' } })
    }
  }
  throw new Meteor.Error('own-key', 'Your own key could not be used. Add it again in your profile.')
}

// ---------- writes ----------
const usageIo = {
  async insertEvent(event) {
    try {
      await MeterEvents.rawCollection().insertOne({ _id: Random.id(), ...event })
      return true
    } catch (error) {
      if (error?.code === 11000) return false
      throw error
    }
  },
  async inc(key, fields) {
    await MeterTotals.rawCollection().updateOne({ _id: key }, { $inc: fields, $set: { updated: Date.now() } }, { upsert: true })
  },
  // holds.mjs: counters are created on first use; wallets never are
  async get(store, key) {
    return (store === 'wallets' ? Wallets : MeterTotals).rawCollection().findOne({ _id: key })
  },
  async incIf(store, key, inc, guards, now = Date.now()) {
    const raw = (store === 'wallets' ? Wallets : MeterTotals).rawCollection()
    if (store === 'counters') {
      await raw.updateOne({ _id: key }, { $setOnInsert: { created: now } }, { upsert: true }).catch(error => { if (error?.code !== 11000) throw error })
    }
    const result = await raw.updateOne({ _id: key, ...guardFilter(guards) }, { $inc: inc, $set: { updated: now, heldAt: now } })
    return result.modifiedCount === 1
  },
  async add(store, key, fields, now = Date.now()) {
    await (store === 'wallets' ? Wallets : MeterTotals).rawCollection().updateOne({ _id: key }, { $inc: fields, $set: { updated: now } }, { upsert: store === 'counters' })
  },
  async debitWallet(walletId, chargeMicros, event, releaseMicros = 0) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const wallet = await Wallets.findOneAsync({ _id: walletId }) || { ...emptyWallet(), _id: walletId }
      // a wallet being refunded is not debited: Slatebox carries that last moment
      if (wallet.refunding) return { debitedMicros: 0, exhausted: true, wallet }
      const out = debitWithRelease(wallet, chargeMicros, releaseMicros)
      if (!out.debitedMicros && !releaseMicros) return out
      const changed = await Wallets.rawCollection().updateOne(
        { _id: walletId, refunding: null, balanceMicros: wallet.balanceMicros, refundableMicros: wallet.refundableMicros, heldMicros: wallet.heldMicros ?? null },
        { $set: { balanceMicros: out.wallet.balanceMicros, refundableMicros: out.wallet.refundableMicros, heldMicros: out.wallet.heldMicros, updated: Date.now() } },
      )
      if (!changed.modifiedCount) continue
      if (!out.debitedMicros) return out
      await WalletLedger.rawCollection().insertOne({
        _id: Random.id(), walletId, type: 'spend', idempotencyKey: 'spend:' + event.ref, amountMicros: -out.debitedMicros,
        refundableDeltaMicros: out.refundableDeltaMicros, meterEventId: event.ref, note: `${event.kind} (${event.feature})`, created: Date.now(),
      }).catch(error => { if (error?.code !== 11000) throw error })
      return out
    }
    throw new Error('The balance changed while it was being charged.')
  },
}

export async function recordCallMinutes(call, charge, now) {
  const settings = await meterSettings()
  const out = await recordUsage(usageIo, {
    ref: charge.ref, payer: call.payer, actorId: call.starterId, kind: charge.kind, route: call.route, feature: 'call',
    model: null, units: charge.participantMinutes, costMicros: callCostMicros(charge.kind, charge.participantMinutes), now, settings,
    pro: call.pro === true,
  })
  if (call.route === 'free' && call.pro !== true) checkAlerts(now).catch(error => console.error('meter alert check failed', error.message))
  return out
}

// ---------- alerts ----------
async function sendAlert(text, now) {
  const admins = await Permissions.find({ claimId: CONSTANTS.claims.uberMensch._id }, { fields: { userId: 1 } }).fetchAsync()
  for (const { userId } of admins) {
    await Messages.insertAsync({ timestamp: now, userId, text, read: false, priority: 10, type: CONSTANTS.messageTypes.system })
  }
  const settings = await meterSettings()
  const to = Meteor.settings.metering?.alertEmail || settings.alertEmail
  if (to && (process.env.MAIL_URL || Meteor.settings.packages?.email?.service)) {
    await Email.sendAsync({ from: Meteor.settings.mailFrom || 'no-reply@slatebox.com', to, subject: 'Slatebox meter and billing', text }).catch(() => {})
  }
}
export const alert = text => sendAlert(text, Date.now())

async function once(key) {
  const result = await SystemSettings.rawCollection().updateOne({ _id: key }, { $setOnInsert: { created: Date.now() } }, { upsert: true })
  return Boolean(result.upsertedCount)
}

let lastAlertCheck = 0
const STAGE_TEXT = {
  50: 'Half of this month\'s shared budget is spent.',
  70: 'Shared budget at 70%: new free video calls now start as voice.',
  90: 'Shared budget at 90%: free AI is down to 10 drafts a day.',
  100: 'Shared budget at 100%: new free calls are paused. Pro credits are not paused.',
  110: 'Shared budget at 110%: free AI is paused. This is the hard ceiling for free use; Pro credits are not paused.',
}
export async function checkAlerts(now) {
  if (now - lastAlertCheck < 60_000) return
  lastAlertCheck = now
  const settings = await meterSettings()
  const global = await globalTotals(now)
  const { percent, dailyCeilingHit } = budgetLevel({ ...global, budget: { ...settings.budget, hold: null } })
  for (const stage of [50, 70, 90, 100, 110]) {
    if (percent >= stage && await once(`alert:${stage}:${monthKey(now)}`)) await sendAlert(STAGE_TEXT[stage], now)
  }
  if (dailyCeilingHit && await once(`alert:daily:${dayKey(now)}`)) {
    await sendAlert('Today\'s free spend reached the daily ceiling. Free calls pause until midnight UTC.', now)
  }
  const days = []
  for (let i = 1; i <= 7; i++) days.push(`global:${dayKey(now - i * 86_400_000)}`)
  const past = await MeterTotals.find({ _id: { $in: days } }).fetchAsync()
  if (past.length >= 3) {
    const average = past.reduce((s, r) => s + (r.freeMicros || 0), 0) / 7
    if (average > 0 && global.todayFreeMicros > settings.budget.spikeFactor * average && await once(`alert:spike:${dayKey(now)}`)) {
      await sendAlert('Today\'s free spend is more than twice the 7-day average.', now)
    }
  }
}

// The calling connection's real address (set by onConnection below), for the guest route's
// count per address. A Cloudflare edge stands for many people, and the cluster's own address (the
// ingress, when no forwarded address is read) for everyone, so neither is counted (limits.mjs).
function callerAddress() {
  // eslint-disable-next-line no-underscore-dangle
  const address = DDP._CurrentMethodInvocation.get()?.connection?.clientAddress
  return address && !isProxyAddress(address) ? address : null
}

// ---------- the AI meter ----------
// The rules are in meter-core.mjs and holds.mjs; this supplies Mongo and the route lookup.
installMeter(createMeter({
  enabled: meterOn,
  io: usageIo,
  settings: meterSettings,
  newId: () => Random.id(),
  // who was refused is read again here, so the refusal carries the pay sheet's action for them
  makeError: (code, message, { userId, wallet } = {}) => (async () => {
    const user = userId ? await Meteor.users.findOneAsync(userId, userFields) : null
    return refusalError(user, code, message, wallet ? { wallet } : {})
  })(),
  async decide(opts) {
    const userId = opts.userId ?? Meteor.userId()
    const user = userId && await Meteor.users.findOneAsync(userId, userFields)
    const { decision } = await routeFor({ user, kind: opts.kind, feature: opts.feature, estimateMicros: opts.estimateMicros, countsAsDraft: opts.countsAsDraft })
    return { decision, userId: user?._id ?? null, address: callerAddress() }
  },
  credentials: (keyOwner, feature, userId) => credentialsFor(keyOwner, 'ai', feature, userId),
  onSpend({ route: spentOn, now }) {
    if (spentOn === 'free') checkAlerts(now).catch(error => console.error('meter alert check failed', error.message))
  },
}))

// Whether this person can start an AI request now (used to offer AI drafting at all).
export async function canStartAI(user, feature = 'workshop') {
  if (!user || user.isAnonymous) return false
  if (!meterOn()) {
    // A server with no meter uses its operator's provider. Self-hosted operators opt in to workshop AI;
    // a person (or team) who connected their own AI may use it there too.
    if (Meteor.settings.public.env !== 'selfhost' || Meteor.settings.selfHosted?.workshopAI === true) return true
    const choice = await aiSettings.resolveFor({ userId: user._id, feature }).catch(() => null)
    return Boolean(choice?.connection && !choice.error)
  }
  // inside a running action the route is already decided
  if (currentAIAction()) return true
  const { decision } = await routeFor({ user, kind: 'ai', feature, estimateMicros: ESTIMATES[feature] ?? ESTIMATES.workshop })
  return decision.ok
}

// Why this person cannot start an AI request now, in the meter's own words ({ code, message }),
// or null when they can. A conversation shows this message as it is.
export async function aiRefusal(user, feature = 'workshop') {
  if (await canStartAI(user, feature)) return null
  if (!user || user.isAnonymous) return { code: 'guest', message: COPY.guestAI }
  if (!meterOn()) return null
  const { decision } = await routeFor({ user, kind: 'ai', feature, estimateMicros: ESTIMATES[feature] ?? ESTIMATES.workshop })
  return decision.ok ? null : { code: decision.code, message: decision.message, pay: await payFor(user, decision.code) }
}

// What is included this month for this person (Pro credits, or the amount everyone has where
// Pro is not needed), in the meter's plain numbers (no key labels, no wallet internals):
// GET /api/v1/me reads it as `ai.included`. Null with no meter or for a guest.
export async function includedThisMonth(user) {
  if (!user || user.isAnonymous || !meterOn()) return null
  const now = Date.now()
  const settings = await meterSettings()
  const [usage, global] = await Promise.all([usageFor(user._id, now), globalTotals(now)])
  const personal = await walletState('user:' + user._id, now, settings)
  const team = user.orgId ? await walletState('org:' + user.orgId, now, settings) : null
  const { keys: _keys, ...included } = allowanceSummary({ person: personOf(user, settings, now), usage, wallets: { personal, team }, global, settings, now, teamId: user.orgId })
  return included
}

// This person's Slatebox Pro (GET /api/v1/me `ai.pro`), or null without one or with no meter.
export function proSummaryFor(user, now = Date.now()) {
  if (!user || user.isAnonymous || !meterOn()) return null
  return proSummary(user.pro, now)
}

// ---------- own keys ----------
async function keyOwnerFor(user, owner, write) {
  if (!user || user.isAnonymous) throw new Meteor.Error('sign-in', 'Sign in to manage your own keys.')
  if (owner === 'team') {
    if (!user.orgId) throw new Meteor.Error('team', 'You are not in a team.')
    if (write && !await isTeamAdmin(user)) throw new Meteor.Error('team-admin', 'Only a team admin can change team keys.')
    return { ownerType: 'org', ownerId: user.orgId }
  }
  return { ownerType: 'user', ownerId: user._id }
}

async function validateKey(provider, secret, baseUrl) {
  // One cheap read, in production only. Tests and local runs use stubs.
  if (Meteor.settings.public.env !== 'prod') return null
  try {
    const res = provider === 'daily'
      ? await fetch('https://api.daily.co/v1/rooms?limit=1', { headers: { Authorization: 'Bearer ' + secret } })
      : provider === 'deepinfra'
        ? await fetch('https://api.deepinfra.com/v1/openai/models', { headers: { Authorization: 'Bearer ' + secret } })
        : await fetch(baseUrl.replace(/\/+$/, '') + '/models', { redirect: 'error', agent: ownEndpointAgent(), headers: secret ? { Authorization: 'Bearer ' + secret } : {} })
    if (res.status === 401 || res.status === 403) return 'The provider did not accept this key.'
    if (!res.ok) return 'The provider could not be reached to check this key. It is saved; try a request.'
    return null
  } catch {
    return 'The provider could not be reached to check this key. It is saved; try a request.'
  }
}

async function listKeys(ownerType, ownerId) {
  if (!ownerId) return []
  // the keys saved here; named AI connections belong to the AI settings (ai.get)
  return (await ProviderKeys.find({ ownerType, ownerId, name: { $exists: false } }, { fields: { cipher: 0 } }).fetchAsync()).map(describeKey)
}

Meteor.methods({
  async 'keys.list'() {
    const user = await Meteor.userAsync()
    // Cloud: nothing to list or add (a key saved before stays stored, unused: keys.remove still removes it)
    if (!user || user.isAnonymous || !master || !OWN_KEYS) return { available: OWN_KEYS && Boolean(master), personal: [], team: [], canEditTeam: false }
    return {
      available: true,
      personal: await listKeys('user', user._id),
      team: await listKeys('org', user.orgId),
      canEditTeam: await isTeamAdmin(user),
    }
  },
  async 'keys.save'(input) {
    check(input, { owner: Match.OneOf('me', 'team'), provider: String, key: Match.Maybe(String), baseUrl: Match.Maybe(String), model: Match.Maybe(String) })
    if (!OWN_KEYS) throw new Meteor.Error('own-keys-cloud', OWN_KEYS_CLOUD)
    if (!master) throw new Meteor.Error('unavailable', 'Own keys are not available on this server.')
    if (!PROVIDERS.includes(input.provider)) throw new Meteor.Error('invalid-key', 'Choose DeepInfra, your own model or Daily.')
    const user = await Meteor.userAsync()
    const owner = await keyOwnerFor(user, input.owner, true)
    const secret = (input.key || '').trim()
    if (/[\r\n]/.test(secret) || secret.length > 400) throw new Meteor.Error('invalid-key', 'Paste the key on one line.')
    let baseUrl, model
    if (input.provider === 'openai-compatible') {
      // a person's endpoint: public https only, and its name must not resolve to a private address
      try {
        baseUrl = checkOwnEndpoint(input.baseUrl || '')
        await assertPublicHost(baseUrl)
      } catch (error) {
        throw new Meteor.Error('invalid-key', error.reason || 'Enter the public address of your model, starting with https://')
      }
      model = (input.model || '').trim()
      if (!model || model.length > 200) throw new Meteor.Error('invalid-key', 'Enter the model name your endpoint serves.')
    } else if (secret.length < 8) {
      throw new Meteor.Error('invalid-key', 'Paste the whole key.')
    }
    const now = Date.now()
    const doc = keyDocument({ master, owner: { ...owner, provider: input.provider }, plaintext: secret, baseUrl, model, now })
    doc.lastError = await validateKey(input.provider, secret, baseUrl)
    // one unnamed key per provider: a second save replaces the first in place (a replacement with
    // a new _id is refused by MongoDB, so the id is set only when the key is new)
    await ProviderKeys.rawCollection().updateOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, provider: input.provider, name: { $exists: false } }, { $set: doc, $setOnInsert: { _id: Random.id() } }, { upsert: true })
    await Audit.insertAsync({ type: 'own-key-saved', userId: user._id, ownerType: owner.ownerType, ownerId: owner.ownerId, provider: input.provider, created: now })
    return describeKey(doc)
  },
  async 'keys.remove'(input) {
    check(input, { owner: Match.OneOf('me', 'team'), provider: String })
    const user = await Meteor.userAsync()
    const owner = await keyOwnerFor(user, input.owner, true)
    await ProviderKeys.removeAsync({ ownerType: owner.ownerType, ownerId: owner.ownerId, provider: input.provider, name: { $exists: false } })
    await Audit.insertAsync({ type: 'own-key-removed', userId: user._id, ownerType: owner.ownerType, ownerId: owner.ownerId, provider: input.provider, created: Date.now() })
    return true
  },

  // What the person has left this month, in plain numbers.
  async 'meter.summary'() {
    const user = await Meteor.userAsync()
    if (!user || user.isAnonymous) return null
    if (!meterOn()) return { metered: false }
    const now = Date.now()
    const settings = await meterSettings()
    const [usage, global] = await Promise.all([usageFor(user._id, now), globalTotals(now)])
    const personal = await walletState('user:' + user._id, now, settings)
    const team = user.orgId ? await walletState('org:' + user.orgId, now, settings) : null
    const keys = OWN_KEYS && master ? await listKeys('user', user._id) : []
    const label = family => keys.find(k => family === 'daily' ? k.provider === 'daily' : k.provider !== 'daily')?.label ?? null
    return {
      metered: true,
      ...allowanceSummary({ person: personOf(user, settings, now), usage, wallets: { personal, team }, global, settings, now, teamId: user.orgId, keys: { ai: label('ai'), daily: label('daily') } }),
      firstTopUp: !personal.firstTopUpAt,
      refundableCents: refundableCents(personal),
      ...(team && { teamFirstTopUp: !team.firstTopUpAt, teamAdmin: await isTeamAdmin(user), teamRefundableCents: refundableCents(team) }),
      frozen: Boolean(personal.frozen),
      // own keys are a self-hosted feature: never offered on Slatebox Cloud (own-keys.mjs)
      ownKeysAvailable: OWN_KEYS && Boolean(master),
      topUpsAvailable: paymentsOn(),
      marginPercent: settings.marginPercent,
      emailVerified: Boolean(user.emails?.[0]?.verified),
      // Slatebox Pro: what the person holds, and whether it can be bought here
      proState: proSummary(user.pro, now),
      // on sale where Pro is needed (pro-billing.mjs proOnSale: 'now' on Cloud), where payments are configured
      proAvailable: paymentsOn() && proOnSale(settings),
      // the subscription looks out of date (a missed webhook): the profile asks pro.refresh
      proStale: Boolean(user.pro?.subscriptionId && ['active', 'trialing'].includes(user.pro.status) && now > (user.pro.currentPeriodEnd || 0)),
      // the pay sheet (design §3.2): whether it takes payments here (public.stripe.inApp, computed at
      // startup), the top-up amounts and card-fee setting, and Manage's state. users.pro stays unpublished.
      inApp: Meteor.settings.public.stripe?.inApp === true,
      topUpAmounts: TOP_UP_AMOUNTS,
      topUpCardFee: cardFeeMode(settings.topUp),
      proRenews: Boolean(user.pro?.subscriptionId && proSummary(user.pro, now)?.renewsOn),
      // a payment that waits for the person (3DS): Manage shows "Confirm your card"
      proActionNeeded: Boolean(user.pro?.actionNeeded?.invoiceId),
      // a switch to monthly waiting for the renewal (a schedule): "Monthly from … · Keep yearly"
      proPending: user.pro?.scheduleId && user.pro.currentPeriodEnd ? { interval: 'month', from: new Date(user.pro.currentPeriodEnd).toISOString() } : null,
      // a switch to yearly that was never confirmed and expired, in the last week
      proSwitchExpired: Boolean(user.pro?.switchExpiredAt && now - user.pro.switchExpiredAt < 7 * 86_400_000),
      // brand, last four and expiry of Pro's card (read on demand, 10 minutes in memory)
      proCard: user.pro?.subscriptionId && proCardReader ? await proCardReader(user) : null,
    }
  },

  async 'meter.adminSummary'() {
    if (!await isUberMensch(Meteor.userId())) throw new Meteor.Error('denied', 'Only an administrator can see the free budget.')
    const now = Date.now()
    const settings = await meterSettings()
    const month = monthKey(now)
    const totals = await MeterTotals.findOneAsync({ _id: 'global:' + month }) || {}
    const global = await globalTotals(now)
    const { level, percent } = budgetLevel({ ...global, budget: settings.budget })
    const days = []
    for (let i = 1; i <= 7; i++) days.push(`global:${dayKey(now - i * 86_400_000)}`)
    const past = await MeterTotals.find({ _id: { $in: days } }).fetchAsync()
    const raw = MeterEvents.rawCollection()
    const [top, routes] = await Promise.all([
      raw.aggregate([{ $match: { month, route: 'free' } }, { $group: { _id: '$payerId', micros: { $sum: '$costMicros' } } }, { $sort: { micros: -1 } }, { $limit: 20 }]).toArray(),
      raw.aggregate([{ $match: { month } }, { $group: { _id: '$route', events: { $sum: 1 }, charge: { $sum: '$chargeMicros' } } }]).toArray(),
    ])
    const people = await Meteor.users.find({ _id: { $in: top.map(t => t._id) } }, { fields: { emails: 1, freeStopped: 1 } }).fetchAsync()
    const ledger = await WalletLedger.rawCollection().aggregate([
      { $match: { created: { $gte: Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1) }, type: { $in: ['topup', 'refund'] } } },
      { $group: { _id: '$type', micros: { $sum: '$amountMicros' }, count: { $sum: 1 } } },
    ]).toArray()
    const perDay = settings.free.aiActionsPerDay
    const atCapToday = await MeterTotals.find({ _id: { $regex: `^user:.*:${dayKey(now)}$` }, aiActions: { $gte: perDay } }).countAsync()
    const atCapMonth = await MeterTotals.find({ _id: { $regex: `^user:.*:${month}$` }, $or: [
      { aiMicros: { $gte: settings.free.aiMicrosPerMonth } }, { voiceMinutes: { $gte: settings.free.voiceMinutesPerMonth } }, { videoMinutes: { $gte: settings.free.videoMinutesPerMonth } },
    ] }).countAsync()
    const d = new Date(now)
    const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    const elapsedDays = Math.max(1, (now - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) / 86_400_000)
    const allEvents = routes.reduce((s, r) => s + r.events, 0)
    return {
      budgetMicros: settings.budget.monthlyMicros, hold: settings.budget.hold,
      spentMicros: global.monthFreeMicros, byKind: totals.freeByKind || {}, percent, level,
      // Pro credits spent this month: Slatebox's cost, outside the shared budget's stages
      proSpentMicros: totals.proMicros || 0, proByKind: totals.proByKind || {},
      todayMicros: global.todayFreeMicros, dailyCeilingMicros: Math.floor(settings.budget.monthlyMicros / settings.budget.dailyCeilingDivisor),
      sevenDayAverageMicros: Math.round(past.reduce((s, r) => s + (r.freeMicros || 0), 0) / 7),
      projectedMicros: Math.round(global.monthFreeMicros / elapsedDays * daysInMonth),
      atCapToday, atCapMonth,
      topPayers: top.map(t => {
        const person = people.find(p => p._id === t._id)
        return { userId: t._id, email: person?.emails?.[0]?.address ?? null, micros: t.micros, freeStopped: person?.freeStopped === true }
      }),
      ownKeyShare: allEvents ? (routes.find(r => r._id === 'byok')?.events || 0) / allEvents : 0,
      balanceSpendMicros: routes.find(r => r._id === 'balance')?.charge || 0,
      topUps: ledger.find(l => l._id === 'topup') || { micros: 0, count: 0 },
      refunds: ledger.find(l => l._id === 'refund') || { micros: 0, count: 0 },
      proRequiredFrom: settings.free.proRequiredFrom,
      proNeededNow: proNeeded(settings, now),
      pro: await proCounts(),
      // Pro credits: the provider cost they are sized to, and what full use costs
      creditCostMicros: settings.free.creditCostMicrosPerMonth,
      fullUseMicros: fullUseMicros(settings.free),
    }
  },

  // Stops (or allows again) one account's included amount (free or Pro credits): for accounts that look made to drain the budget.
  async 'meter.setFreeStopped'(input) {
    check(input, { userId: String, stopped: Boolean })
    const adminId = Meteor.userId()
    if (!await isUberMensch(adminId)) throw new Meteor.Error('denied', 'Only an administrator can change free use.')
    const changed = await Meteor.users.updateAsync({ _id: input.userId }, input.stopped ? { $set: { freeStopped: true } } : { $unset: { freeStopped: '' } })
    if (!changed) throw new Meteor.Error('not-found', 'That account was not found.')
    await Audit.insertAsync({ type: input.stopped ? 'free-use-stopped' : 'free-use-allowed', userId: adminId, targetUserId: input.userId, created: Date.now() })
    return true
  },

  async 'meter.setBudget'(input) {
    check(input, {
      monthlyDollars: Match.Maybe(Number), hold: Match.Maybe(Match.OneOf(null, ...Object.keys(HOLDS))),
      // when included AI and calls need Slatebox Pro: 'now', 'never' or a moment (ms)
      proRequiredFrom: Match.Optional(Match.OneOf('now', 'never', Number)),
      // what Pro credits may cost Slatebox per person a month, in dollars (sizes every allowance)
      creditDollars: Match.Optional(Number),
    })
    const userId = Meteor.userId()
    if (!await isUberMensch(userId)) throw new Meteor.Error('denied', 'Only an administrator can change the free budget.')
    const set = {}
    if (input.monthlyDollars !== undefined && input.monthlyDollars !== null) {
      if (!Number.isFinite(input.monthlyDollars) || input.monthlyDollars < 0 || input.monthlyDollars > 1_000_000) throw new Meteor.Error('invalid', 'Enter a budget in dollars.')
      set['budget.monthlyMicros'] = Math.round(input.monthlyDollars * 1_000_000)
    }
    if (input.hold !== undefined) set['budget.hold'] = input.hold
    if (input.proRequiredFrom !== undefined) {
      if (typeof input.proRequiredFrom === 'number' && (!Number.isFinite(input.proRequiredFrom) || input.proRequiredFrom < Date.UTC(2026, 0, 1))) {
        throw new Meteor.Error('invalid', 'Choose now, never or a date for when Slatebox Pro is needed.')
      }
      set['free.proRequiredFrom'] = proSwitchValue(input.proRequiredFrom)
    }
    if (input.creditDollars !== undefined) {
      if (!Number.isFinite(input.creditDollars) || input.creditDollars < 0.5 || input.creditDollars > 100) throw new Meteor.Error('invalid', 'Enter what Pro credits may cost a month, in dollars (0.50 to 100).')
      set['free.creditCostMicrosPerMonth'] = Math.round(input.creditDollars * 1_000_000)
    }
    if (!Object.keys(set).length) return false
    await SystemSettings.rawCollection().updateOne({ _id: 'metering' }, { $set: set }, { upsert: true })
    await Audit.insertAsync({ type: 'free-budget-changed', userId, change: set, created: Date.now() })
    forgetSettings()
    return true
  },
})

// ---------- the call tick (one replica at a time) ----------
const tickLeaseId = Random.id()
async function takeLease(now) {
  const result = await SystemSettings.rawCollection().updateOne(
    { _id: 'meter-tick-lease', $or: [{ until: { $lte: now } }, { holder: tickLeaseId }] },
    { $set: { holder: tickLeaseId, until: now + 90_000 } },
  )
  if (result.matchedCount) return true
  // first run: create the lease
  try {
    await SystemSettings.rawCollection().insertOne({ _id: 'meter-tick-lease', holder: tickLeaseId, until: now + 90_000 })
    return true
  } catch { return false }
}

export async function callClient(call, ownKey) {
  const base = Meteor.settings.daily?.apiBase
  // the Deepgram secret goes only into rooms the operator runs unmetered (calls.mjs transcriptionAllowed);
  // a Deepgram key an administrator connected in AI control wins over the settings file's
  const transcriptionKey = transcriptionAllowed(call) ? ((await auxCredential('deepgram'))?.apiKey || Meteor.settings.deepgram?.secret) : null
  return dailyClient(fetch, ownKey || Meteor.settings.daily?.apiKey, transcriptionKey, base)
}

async function minutesLeftForCall(call, now, settings) {
  if (call.route === 'balance') {
    const wallet = await walletState(`${call.payer.type}:${call.payer.id}`, now, settings)
    return minutesLeftFor({
      route: 'balance', settings,
      spendableMicros: spendableMicros(wallet, { kind: 'voice', now, holdHours: settings.topUp.holdHours }),
      spendableVideoMicros: spendableMicros(wallet, { kind: 'video', topups: wallet.topups, now, holdHours: settings.topUp.holdHours }),
    })
  }
  const user = await Meteor.users.findOneAsync(call.payer.id, userFields)
  return minutesLeftFor({ route: 'free', usage: await usageFor(call.payer.id, now), person: personOf(user, settings, now), settings: settingsForUser(user, settings, now), now })
}

export async function tickCall(call, now = Date.now()) {
  const settings = await meterSettings()
  let ownKey = null
  if (call.provider === 'own-key') ownKey = (await credentialsFor(call.keyOwner, 'daily').catch(() => null))?.apiKey
  const client = await callClient(call, ownKey)
  const count = await client.presence(call.roomName)
  // a call started on Pro credits is never paused by the shared budget (calls.mjs startCall)
  const level = call.pro ? 0 : budgetLevel({ ...await globalTotals(now), budget: settings.budget }).level
  const minutesLeft = call.provider === 'slatebox' ? await minutesLeftForCall(call, now, settings) : { voice: 0, video: 0 }
  const out = tick({ call, presence: count === null ? null : { count }, now, minutesLeft, level })
  if (out.charge) await recordCallMinutes(call, out.charge, now)
  const set = { ...out.set }
  try {
    if (out.decision === 'extend') await client.extendRoom(call.roomName, out.set.roomExpAt)
    if (out.decision === 'move-to-voice') {
      set.roomUrl = await client.createRoom(roomRequest({ name: out.set.roomName, now }))
      // the client on every device follows the call to the voice room; the video room is closed
      client.deleteRoom(call.roomName).catch(() => {})
    }
    if (out.decision === 'end') await client.deleteRoom(call.roomName).catch(() => {})
  } catch (error) {
    console.error('call tick could not reach the call provider', call._id, error.message)
  }
  await HuddleCalls.updateAsync({ _id: call._id, state: 'open' }, { $set: set })
  return out
}

// A hold left by a server that stopped mid-request is released after this long without change.
const STALE_HOLD_MS = 15 * 60_000
async function sweepStaleHolds(now) {
  const before = now - STALE_HOLD_MS
  await MeterTotals.rawCollection().updateMany(
    { heldAt: { $lt: before }, $or: [{ heldMicros: { $ne: 0, $exists: true } }, { heldAiMicros: { $ne: 0, $exists: true } }] },
    { $set: { heldMicros: 0, heldAiMicros: 0, updated: now } },
  )
  await Wallets.rawCollection().updateMany({ heldAt: { $lt: before }, heldMicros: { $gt: 0 } }, { $set: { heldMicros: 0, updated: now } })
  // a refund lock from a server that stopped mid-refund
  await Wallets.rawCollection().updateMany({ refundingAt: { $lt: now - 10 * 60_000 } }, { $unset: { refunding: '', refundingAt: '' } })
}

async function runTicks() {
  const now = Date.now()
  if (!await takeLease(now)) return
  await sweepStaleHolds(now).catch(error => console.error('stale hold sweep failed', error.message))
  if (!await HuddleCalls.findOneAsync({ state: 'open' }, { fields: { _id: 1 } })) return
  for (const call of await HuddleCalls.find({ state: 'open' }).fetchAsync()) {
    await tickCall(call, now).catch(error => console.error('call tick failed', call._id, error.message))
  }
}

// Per person and per network address, on every metered method (limits.mjs).
if (METERED) {
  for (const rule of METER_RATE_LIMITS) DDPRateLimiter.addRule(ddpRule(rule), rule.count, rule.intervalMs)
}

// The caller's real address behind Cloudflare (client-address.mjs), for every rate limit that
// counts by address. Meteor alone gives the edge's address, or none when Cloudflare's entry is kept.
Meteor.onConnection(connection => {
  const address = resolveClientAddress({
    forwardedFor: connection.httpHeaders?.['x-forwarded-for'], forwardedCount: process.env.HTTP_FORWARDED_COUNT, fallback: connection.clientAddress,
  })
  if (address !== connection.clientAddress) connection.clientAddress = address
})

Meteor.startup(async () => {
  await runM1({
    hasMarker: async id => Boolean(await SystemSettings.findOneAsync({ _id: id }, { fields: { _id: 1 } })),
    setMarker: id => SystemSettings.rawCollection().updateOne({ _id: id }, { $set: { done: Date.now() } }, { upsert: true }),
    ensureIndex: (collection, spec, options) => ({
      meterEvents: MeterEvents, walletLedger: WalletLedger, providerKeys: ProviderKeys, huddleCalls: HuddleCalls, aiAudit: AIAudit,
    })[collection].rawCollection().createIndex(spec, options || {}),
    hasSettings: async id => Boolean(await SystemSettings.findOneAsync({ _id: id }, { fields: { _id: 1 } })),
    insertSettings: doc => SystemSettings.rawCollection().insertOne(doc),
  }).catch(error => console.error('pricing migration M1 failed', error.message))
  // named AI connections: several of one type per owner (migrations.mjs PROVIDER_KEY_INDEXES)
  await runM2({
    hasMarker: async id => Boolean(await SystemSettings.findOneAsync({ _id: id }, { fields: { _id: 1 } })),
    setMarker: id => SystemSettings.rawCollection().updateOne({ _id: id }, { $set: { done: Date.now() } }, { upsert: true }),
    indexes: collection => ({ providerKeys: ProviderKeys })[collection].rawCollection().indexes().catch(() => []),
    dropIndex: (collection, name) => ({ providerKeys: ProviderKeys })[collection].rawCollection().dropIndex(name),
    ensureIndex: (collection, spec, options) => ({ providerKeys: ProviderKeys })[collection].rawCollection().createIndex(spec, options || {}),
  }).catch(error => console.error('AI connections migration M2 failed', error.message))
  // Slatebox Pro: indexes only, no data change (migrations.mjs M4)
  await runM4({
    hasMarker: async id => Boolean(await SystemSettings.findOneAsync({ _id: id }, { fields: { _id: 1 } })),
    setMarker: id => SystemSettings.rawCollection().updateOne({ _id: id }, { $set: { done: Date.now() } }, { upsert: true }),
    ensureIndex: (collection, spec, options) => ({ users: Meteor.users })[collection].rawCollection().createIndex(spec, options || {}),
  }).catch(error => console.error('Slatebox Pro migration M4 failed', error.message))
  if (Meteor.settings.metering?.tick !== false) Meteor.setInterval(() => { runTicks().catch(error => console.error('call ticks failed', error.message)) }, 60_000)
})
