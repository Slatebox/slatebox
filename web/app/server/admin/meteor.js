// Server admin: the admin.status and admin.dashboard methods (server/admin/dashboard-core.mjs over
// the app's collections and Stripe client). Plain methods for the admin pages, not registry
// actions: nothing a token or an agent should reach (like enterprise.licenseStatus).
//
// admin.status answers for the signed-in account only: { admin } (the uberMensch claim alone, no
// team needed). The browser uses it to draw the Admin links; every admin method still checks the
// claim itself (permissions.js isInstanceAdmin).
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../imports/api/common/constants'
import { LibraryItems, MeterEvents, Organizations, WalletLedger } from '../../imports/api/common/models'
import { QUEUE_WAITING } from '../../imports/api/common/library-model.mjs'
import { PRO_CREDITS, PRO_LOOKUP_KEYS } from '../../imports/api/pro/catalog.mjs'
import { isInstanceAdmin } from '../permissions'
import { paymentsOn } from '../cloud-lock-meteor'
import { stripeClient } from '../methods/wallet'
import { meterOn } from '../metering/meteor'
import { keyMode } from '../pay-settings.mjs'
import { businessPriceIds } from '../business-billing.mjs'
import { createAdminDashboard } from './dashboard-core.mjs'
import { agentSummary } from '../agent-reach/usage-core.mjs'
import { agentUsageIo } from '../agent-reach/usage-meteor'
import { selfHosted } from '../../imports/api/common/own-keys.mjs'

const DAY = 86_400_000
const raw = (collection) => collection.rawCollection()
const users = () => raw(Meteor.users)
const LIVE = ['active', 'trialing', 'past_due']

const io = {
  async people(now) {
    const member = { isAnonymous: { $ne: true } }
    const [members, guests, signups7, signups30] = await Promise.all([
      users().countDocuments(member),
      users().countDocuments({ isAnonymous: true }),
      users().countDocuments({ ...member, createdAt: { $gte: new Date(now - 7 * DAY) } }),
      users().countDocuments({ ...member, createdAt: { $gte: new Date(now - 30 * DAY) } }),
    ])
    return { members, guests, signups7, signups30 }
  },
  async plans() {
    const [pro, business] = await Promise.all([
      users().aggregate([{ $match: { 'pro.status': { $in: LIVE } } }, { $group: { _id: '$pro.status', n: { $sum: 1 } } }]).toArray(),
      raw(Organizations).aggregate([
        { $match: { 'business.status': { $in: LIVE } } },
        { $group: { _id: null, teams: { $sum: 1 }, members: { $sum: { $ifNull: ['$business.members', 0] } } } },
      ]).toArray(),
    ])
    const proBy = Object.fromEntries(pro.map((row) => [row._id, row.n]))
    return {
      pro: { active: proBy.active || 0, trialing: proBy.trialing || 0, pastDue: proBy.past_due || 0 },
      business: { teams: business[0]?.teams || 0, members: business[0]?.members || 0 },
    }
  },
  async usage(month) {
    const events = raw(MeterEvents)
    const match = { $match: { month } }
    const [routes, byModel, byFeature, calls, top] = await Promise.all([
      events.aggregate([match, { $group: { _id: '$route', cost: { $sum: '$costMicros' }, charge: { $sum: '$chargeMicros' } } }]).toArray(),
      events.aggregate([{ $match: { month, kind: { $in: ['ai', 'imageSearch', 'imageGeneration'] } } },
        { $group: { _id: '$model', costMicros: { $sum: '$costMicros' }, uses: { $sum: 1 } } }, { $sort: { costMicros: -1 } }, { $limit: 8 }]).toArray(),
      events.aggregate([match, { $group: { _id: '$feature', costMicros: { $sum: '$costMicros' }, uses: { $sum: 1 } } }, { $sort: { costMicros: -1 } }, { $limit: 8 }]).toArray(),
      events.aggregate([{ $match: { month, kind: { $in: ['voice', 'video'] } } }, { $group: { _id: '$kind', minutes: { $sum: '$units' } } }]).toArray(),
      events.aggregate([match, { $group: { _id: { t: '$payerType', id: '$payerId' }, costMicros: { $sum: '$costMicros' }, chargeMicros: { $sum: '$chargeMicros' } } },
        { $sort: { costMicros: -1 } }, { $limit: 5 }]).toArray(),
    ])
    const route = (name) => routes.find((r) => r._id === name) || { cost: 0, charge: 0 }
    const minutes = (kind) => calls.find((c) => c._id === kind)?.minutes || 0
    return {
      spent: {
        includedMicros: route('free').cost,
        balanceMicros: route('balance').charge,
        costMicros: routes.reduce((sum, r) => sum + (r.cost || 0), 0),
      },
      byModel: byModel.map((row) => ({ name: row._id || 'Unknown', costMicros: row.costMicros, uses: row.uses })),
      byFeature: byFeature.map((row) => ({ name: row._id || 'Unknown', costMicros: row.costMicros, uses: row.uses })),
      calls: { voiceMinutes: minutes('voice'), videoMinutes: minutes('video') },
      topSpenders: top.map((row) => ({ payerType: row._id.t, payerId: row._id.id, costMicros: row.costMicros, chargeMicros: row.chargeMicros })),
    }
  },
  async grants(month, now) {
    const start = Date.parse(`${month}-01T00:00:00Z`)
    const [proPeople, topUps] = await Promise.all([
      users().countDocuments({ 'pro.status': { $in: ['active', 'trialing'] } }),
      raw(WalletLedger).aggregate([{ $match: { type: 'topup', created: { $gte: start, $lte: now } } }, { $group: { _id: null, micros: { $sum: '$amountMicros' } } }]).toArray(),
    ])
    return { proPeople, topUpMicros: topUps[0]?.micros || 0 }
  },
  async library() {
    const waiting = await raw(LibraryItems).countDocuments({ origin: 'user', reviewStatus: { $in: [...QUEUE_WAITING] } })
    return { waiting }
  },
  // agent clients this week: connections, tool calls, top tools, accounts that came by an agent
  agents: (now) => agentSummary({ io: agentUsageIo, now }),
  async emailsOf(ids) {
    const rows = await users().find({ _id: { $in: ids } }, { projection: { 'emails.address': 1 } }).toArray()
    return Object.fromEntries(rows.map((u) => [u._id, u.emails?.[0]?.address || null]))
  },
}

const admin = createAdminDashboard({
  isAdmin: isInstanceAdmin,
  // Slatebox Cloud's license and a Stripe key (cloud-lock.mjs); the key's mode only, never the key
  payments: () => ({ on: paymentsOn(), mode: keyMode(Meteor.settings.stripePrivateKey) }),
  stripe: () => stripeClient(),
  plans: () => ({ pro: PRO_LOOKUP_KEYS, business: businessPriceIds(Meteor.settings) }),
  io,
  meterOn: () => meterOn(),
  proAllowanceMicros: PRO_CREDITS.creditCostMicrosPerMonth,
  selfHosted: () => selfHosted(Meteor.settings),
})

export const adminStatus = (userId) => admin.status(userId)

Meteor.methods({
  async [CONSTANTS.methods.admin.status]() {
    return admin.status(this.userId)
  },
  async [CONSTANTS.methods.admin.dashboard](options) {
    const refresh = Boolean(options && typeof options === 'object' && options.refresh === true)
    try {
      return await admin.dashboard(this.userId, { refresh })
    } catch (error) {
      if (error?.code === 'denied') throw new Meteor.Error('denied', error.message)
      throw new Meteor.Error('admin-dashboard', 'Could not build the overview. Try again in a minute.')
    }
  },
})
