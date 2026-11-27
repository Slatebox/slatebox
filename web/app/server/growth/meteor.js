// The Meteor side of the growth funnel (funnel-core.mjs): its three collections, the browser's
// visit report (growth.visit) and opt-out (growth.forget), the hooks other server code calls when a
// step happens (growthStep), and the admin Growth page's read (admin.growth). Slatebox Cloud only:
// on a self-hosted server (or without the Cloud license) browsers are told it is off, the methods
// answer nothing and nothing is written.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import CONSTANTS from '../../imports/api/common/constants'
import { Organizations, ProviderKeys, SlateAccess, SlatePresentations, Slates, WalletLedger } from '../../imports/api/common/models'
import { growthOn } from '../../imports/api/common/growth.mjs'
import { cloudOn } from '../cloud-lock-meteor'
import { isInstanceAdmin } from '../permissions'
import { createGrowthFunnel, ensureGrowthIndexes, growthSummary, SUMMARY_WEEKS } from './funnel-core.mjs'

const GrowthEvents = new Mongo.Collection('growthEvents')
const GrowthDays = new Mongo.Collection('growthDays')
const GrowthPeople = new Mongo.Collection('growthPeople')
const events = GrowthEvents.rawCollection()
const days = GrowthDays.rawCollection()
const people = GrowthPeople.rawCollection()
const raw = (collection) => collection.rawCollection()
const LIVE = ['active', 'trialing', 'past_due']

const on = () => cloudOn() && growthOn(Meteor.settings)

// Browsers learn at start whether to report at all (Meteor sends settings.public to every browser).
if (Meteor.settings.public && typeof Meteor.settings.public === 'object') {
  Meteor.settings.public.growth = { on: on() }
}

const exists = async (collection, filter) => Boolean(await raw(collection).findOne(filter, { projection: { _id: 1 } }))

const io = {
  async account(userId) {
    return Meteor.users.rawCollection().findOne({ _id: userId }, { projection: { createdAt: 1, isAnonymous: 1 } })
  },
  // what an account has done so far: read only, by indexed fields, one row each at most
  async state(userId) {
    const user = await Meteor.users.rawCollection().findOne({ _id: userId }, { projection: { orgId: 1, isOrgOwner: 1, 'pro.status': 1 } })
    if (!user) return null
    const owner = Boolean(user.orgId && user.isOrgOwner)
    const [slate, sharedSlate, namedGrant, published, teammate, business, topup, ownKey] = await Promise.all([
      exists(Slates, { userId }),
      // a new slate is private (private-slate-document.mjs): public or unlisted is a choice to share
      exists(Slates, { userId, $or: [{ 'options.isPublic': true }, { 'options.isUnlisted': true }] }),
      exists(SlateAccess, { owningUserId: userId, type: 'private' }),
      exists(SlatePresentations, { userId, isPublished: true }),
      owner ? exists(Meteor.users, { orgId: user.orgId, _id: { $ne: userId } }) : false,
      owner ? exists(Organizations, { _id: user.orgId, 'business.status': { $in: LIVE } }) : false,
      exists(WalletLedger, { walletId: { $in: [`user:${userId}`, ...(owner ? [`org:${user.orgId}`] : [])] }, type: 'topup' }),
      exists(ProviderKeys, { $or: [{ ownerType: 'user', ownerId: userId }, ...(owner ? [{ ownerType: 'org', ownerId: user.orgId }] : [])] }),
    ])
    return {
      slate,
      share: sharedSlate || namedGrant || published,
      invite: teammate,
      paid: { business, pro: LIVE.includes(user.pro?.status), topup, ownkey: ownKey },
    }
  },
}

export const growth = createGrowthFunnel({ events, days, people, io, on })

/** A step another part of the server saw happen ('slate', 'share', 'invite'). Never throws, never waits the caller. */
export function growthStep(userId, step, kind = null) {
  growth.step({ userId, step, kind }).catch(() => {})
}

/** Removes what the funnel kept for an account (with the account). */
export const forgetGrowthOf = (userId) => growth.forget(userId)

Meteor.methods({
  async [CONSTANTS.methods.growth.visit](input) {
    if (!on()) return { counted: [] }
    return growth.visit({ userId: this.userId || null, input, headers: this.connection?.httpHeaders || {} })
  },
  // The browser sends Do Not Track or Global Privacy Control: forget this account's row.
  async [CONSTANTS.methods.growth.forget]() {
    if (!this.userId) return false
    return growth.forget(this.userId)
  },
  async [CONSTANTS.methods.admin.growth](options) {
    if (!(await isInstanceAdmin(this.userId))) throw new Meteor.Error('denied', 'Only an administrator of this server can see this.')
    if (!on()) return { on: false }
    const weeks = Number.isInteger(options?.weeks) && options.weeks >= 1 && options.weeks <= 52 ? options.weeks : SUMMARY_WEEKS
    const now = Date.now()
    const since = new Date(now - (weeks + 1) * 7 * 86_400_000).toISOString().slice(0, 10)
    const rows = await days.find({ day: { $gte: since } }).toArray()
    return { on: true, ...growthSummary(rows, { now, weeks }) }
  },
})

// one report per page load and one per sign-in; a little more for many tabs, never a flood
DDPRateLimiter.addRule({ type: 'method', name: CONSTANTS.methods.growth.visit, connectionId: () => true }, 10, 60000)
// and per address, so opening many connections does not multiply it
DDPRateLimiter.addRule({ type: 'method', name: CONSTANTS.methods.growth.visit, clientAddress: () => true }, 60, 60000)
DDPRateLimiter.addRule({ type: 'method', name: CONSTANTS.methods.growth.forget, connectionId: () => true }, 5, 60000)

Meteor.startup(() => {
  if (!on()) return
  ensureGrowthIndexes({ events, days, people }).catch((error) => console.warn(`growth: indexes not made (${error.message})`))
})
