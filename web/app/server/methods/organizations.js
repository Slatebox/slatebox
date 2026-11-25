/* eslint-disable no-plusplus */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-underscore-dangle */
// methods.js
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { check, Match } from 'meteor/check'
import { getUserName } from './users'
import { recordGuestAdmission } from './guest-admission.mjs'
import { refundBalance } from './wallet'
import { removeAccountAfterRefund } from '../wallet-stripe.mjs'
import { endProForRemoval, PRO_END_FAILED } from './pro'
import { endBusinessForRemoval, BUSINESS_END_FAILED } from './business'
import CONSTANTS from '../../imports/api/common/constants'
import {
  GuestViews,
  Organizations,
  Permissions,
  Slates,
  ArchivedSlates,
  Messages,
  Wallets,
} from '../../imports/api/common/models'
import AuthManager from '../../imports/api/common/AuthManager'

const method = {}

/**
 * Make a team for a registered person without one: they become its owner and admin, and their
 * slates move into it. Used by organizations.create and by a self-hosted server's setup link.
 */
export async function createTeamFor(user, teamName) {
  const name = String(teamName || '').trim().slice(0, 120)
  if (!name) throw new Meteor.Error('team-name', 'Give the team a name.')
  const orgId = Random.id()
  await Organizations.insertAsync({
    _id: orgId,
    name,
    isEducationInstitution: Boolean(user.isEducationCertified),
    createdByUserId: user._id,
    createdOn: new Date().valueOf(),
  })
  // The creator is the owner and admin.
  await Meteor.users.updateAsync(
    { _id: user._id, orgId: { $exists: false } },
    { $set: { isOrgOwner: true, orgId } }
  )
  await Slates.updateAsync({ userId: user._id }, { $set: { orgId } }, { multi: true })
  await Permissions.insertAsync({ userId: user._id, orgId, claimId: CONSTANTS.claims.admin._id })
  return orgId
}

// A registered person without a team makes one, and becomes its owner and admin. The owner is
// always the caller, never a person the request names.
method[CONSTANTS.methods.organizations.create] = async function createOrganization(opts) {
  check(opts, Match.ObjectIncluding({ name: String }))
  const user = this.userId && await Meteor.users.findOneAsync(this.userId, { fields: { isAnonymous: 1, orgId: 1, isEducationCertified: 1 } })
  if (!user || user.isAnonymous) throw new Meteor.Error('team-denied', 'Save your account before making a team.')
  if (user.orgId) return user.orgId
  return createTeamFor(user, opts.name)
}

// A subscription still billing: the statuses endProForRemoval and endBusinessForRemoval skip.
const ENDED = ['canceled', 'incomplete_expired']
const hasBalance = async (walletId) => ((await Wallets.findOneAsync({ _id: walletId }, { fields: { balanceMicros: 1 } }))?.balanceMicros || 0) > 0

async function cancellationImplications(user) {
  const otherUsers = await Meteor.users.find({ orgId: user.orgId, _id: { $ne: user._id } }, { fields: { _id: 1 } }).fetchAsync()
  const otherSlates = await Slates.find({ userId: { $in: otherUsers.map((u) => u._id) } }).countAsync()
  // organizations.delete removes the owner's slates in the team (userId + orgId); any others are
  // counted apart, so Team settings can say they are not kept
  const mySlates = await Slates.find({ userId: user._id, orgId: user.orgId }).countAsync()
  const myOtherSlates = await Slates.find({ userId: user._id, orgId: { $ne: user.orgId } }).countAsync()
  const orgOwner = await Meteor.users.findOneAsync({ orgId: user.orgId, isOrgOwner: true }, { fields: { profile: 1, emails: 1 } })
  // What deleting the team would end first, for its owner only: the same checks the delete runs
  // (refundBalance, endBusinessForRemoval, endProForRemoval), so the dialog names only what applies.
  let ends = null
  if (user.isOrgOwner) {
    const org = await Organizations.findOneAsync({ _id: user.orgId }, { fields: { business: 1 } })
    const business = org?.business
    ends = {
      balance: (await hasBalance(`org:${user.orgId}`)) || (await hasBalance(`user:${user._id}`)),
      business: business?.source === 'stripe' && Boolean(business.subscriptionId) && !ENDED.includes(business.stripeStatus),
      pro: Boolean(user.pro?.subscriptionId) && !ENDED.includes(user.pro.status),
    }
  }
  return {
    otherUsers: otherUsers.length,
    otherSlates,
    mySlates,
    myOtherSlates,
    ends,
    orgOwner: orgOwner ? {
      name: `${orgOwner.profile?.firstName ?? ''} ${orgOwner.profile?.lastName ?? ''}`.trim(),
      email: orgOwner.emails?.[0]?.address,
      id: orgOwner._id,
    } : null,
  }
}

method[CONSTANTS.methods.organizations.getCancellationImplications] = async function getCancellationImplications() {
  const user = this.userId && await Meteor.users.findOneAsync(this.userId, { fields: { orgId: 1, isOrgOwner: 1, pro: 1 } })
  if (!user?.orgId) return null
  return cancellationImplications(user)
}

method[CONSTANTS.methods.organizations.get] = async () => {
  const user = await Meteor.userAsync()
  if (user?.orgId) {
    return Organizations.findOneAsync({ _id: user.orgId })
  }
  return null
}

method[CONSTANTS.methods.organizations.delete] = async function deleteOrganization() {
  const user = await Meteor.userAsync()
  if (user?.orgId && user.isOrgOwner) {
    const implications = await cancellationImplications(user)
    if (implications.otherUsers === 0 && implications.otherSlates === 0) {
      // Team and personal balances go back to the card first, then the owner's Slatebox Pro
      // ends; if either fails, nothing is removed (a failed refund leaves Pro on).
      await removeAccountAfterRefund({
        refund: async () => { await refundBalance('org:' + user.orgId); await refundBalance('user:' + user._id) },
        endPro: async () => {
          await endBusinessForRemoval(user.orgId).catch(() => { throw new Meteor.Error('business-end-failed', BUSINESS_END_FAILED) })
          return endProForRemoval(user).catch(() => { throw new Meteor.Error('pro-end-failed', PRO_END_FAILED) })
        },
        remove: async () => true,
      }).catch(error => { throw error instanceof Meteor.Error ? error : new Meteor.Error('refund-failed', error.message) })
      await Slates.removeAsync({
        userId: Meteor.userId(),
        orgId: user.orgId,
      })

      await GuestViews.removeAsync({ slateOrgId: user.orgId })

      await Organizations.removeAsync({ _id: user.orgId })

      await Messages.removeAsync({ userId: user._id })

      // As users.delete does: Meteor Accounts closes every connection watching a removed login
      // token, so the result never reached Team settings. Release only this connection's
      // observer so it receives the result, then sign it out.
      const { connection } = this
      const token = connection && Accounts._getLoginToken(connection.id)
      if (token) Accounts._setLoginToken(user._id, connection, null)
      try {
        await Meteor.users.removeAsync({ _id: user._id })
      } catch (error) {
        if (token) Accounts._setLoginToken(user._id, connection, token)
        throw error
      }
      if (connection) await this.setUserId(null)

      return {
        success: true,
        reason: `Your team, slates, and account have all been completely removed. Thanks for trying Slatebox!`,
      }
    }
    return {
      success: false,
      reason: `You still have ${implications.otherUsers} team members and ${implications.otherSlates} slates for those team members that need to be removed prior to deleting your team account.`,
    }
  }
  return {
    success: false,
    reason: `Only team owners are allowed to remove teams`,
  }
}

async function admitSlateGuest(slateId, viewer, visitor) {
  if (
    typeof slateId !== 'string' ||
    !slateId ||
    typeof visitor !== 'string' ||
    !visitor ||
    visitor.length > 128
  )
    return { allow: false }
  const slate = await Slates.findOneAsync(
    { _id: slateId },
    {
      fields: {
        userId: 1,
        orgId: 1,
        'options.name': 1,
        'options.isUnlisted': 1,
        'options.isPublic': 1,
      },
    }
  )
  if (
    !slate ||
    (!viewer && !slate.options.isUnlisted && !slate.options.isPublic)
  )
    return { allow: false }
  // Anyone with the link is admitted, however many people visit. The receipt is the
  // 24-hour access record other code checks.
  const slateOwner = await getUserName(slate.userId)
  await recordGuestAdmission({ views: GuestViews.rawCollection() }, slate, viewer, visitor)
  return { allow: true, slateOwnerUserName: slateOwner }
}

method[CONSTANTS.methods.organizations.trackGuest] = async function trackGuest(
  opts
) {
  const connection = this.connection
  if (connection) connection.slateboxGuestAdmission = null
  const viewer = await Meteor.userAsync()
  const result = await admitSlateGuest(
    opts.slateId,
    viewer,
    opts.guestCollaboratorId
  )
  if (!viewer && connection && result.allow) {
    connection.slateboxGuestAdmission = {
      slateId: opts.slateId,
      visitor: opts.guestCollaboratorId,
    }
  }
  return result
}

Meteor.methods(method)
