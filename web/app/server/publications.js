/* eslint-disable no-underscore-dangle */
/* eslint-disable func-names */
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../imports/api/common/constants'
import {
  Messages,
  PricingTiers,
  Slates,
  Collaboration,
  Organizations,
  Claims,
  Permissions,
  SlateAccess,
  Collaborators,
  Comments,
  ApprovalRequests,
} from '../imports/api/common/models'
import AuthManager from '../imports/api/common/AuthManager'

Meteor.publish(CONSTANTS.publications.slateAccess, function () {
  if (this.userId) {
    return SlateAccess.find({
      $or: [{ userId: this.userId }, { owningUserId: this.userId }],
    })
  }
  this.ready()
  return null
})

Meteor.publish(CONSTANTS.publications.users.me, function () {
  return Meteor.users.find(
    { _id: this.userId },
    {
      fields: {
        isAnonymous: 1,
        orgId: 1,
        isOrgOwner: 1,
        createdAt: 1,
        roles: 1,
        planType: 1,
      },
    }
  )
})

Meteor.publish(CONSTANTS.publications.shareableSlate, (slateId) => {
  if (Meteor.user()) {
    return Slates.find({ _id: slateId, userId: Meteor.userId() })
  }
  return null
})

Meteor.publish(CONSTANTS.publications.messages, function (opts) {
  if (this.userId) {
    let msearch = { type: opts.type }
    switch (opts.type) {
      case CONSTANTS.messageTypes.system: {
        msearch = { ...msearch, userId: this.userId }
        break
      }
      case CONSTANTS.messageTypes.chat:
      default: {
        msearch = { ...msearch, slateShareId: opts.slateShareId }
        break
      }
    }
    console.log('getting messages ', msearch, Messages.find(msearch).count())
    return Messages.find(msearch, { sort: { timestamp: -1 } })
  }
  return null
})

Meteor.publish(CONSTANTS.publications.comments, (filter) => {
  // can be anonymously subscribed to
  if (filter.slateId) {
    const query = { slateId: filter.slateId }
    if (filter.nodeId) {
      query.nodeId = filter.nodeId
    }
    // todo: additional slateaccess filter check for this slateId?
    return Comments.find(query, { sort: { timestamp: -1 } })
  }
})

Meteor.publish(
  CONSTANTS.publications.collaboration,
  (_slateIds, _slateInstanceIds, asOfDate) =>
    // the date in the table is GREATER THAN or equal to the last saved date

    Collaboration.find({
      $and: [
        { slateId: { $in: _slateIds } },
        { dated: { $gt: asOfDate } },
        { instanceId: { $nin: _slateInstanceIds } },
      ],
    })
)

Meteor.publish(CONSTANTS.publications.collaborators, (shareIds) =>
  Collaborators.find({ shareId: { $in: shareIds } })
)

Meteor.publish(CONSTANTS.publications.organizations, function () {
  const user = Meteor.users.findOne({ _id: this.userId })
  if (user && user.orgId) {
    return Organizations.find({ _id: user.orgId })
  }
  return null
})

Meteor.publish(CONSTANTS.publications.orgUsers, function () {
  const user = Meteor.users.findOne({ _id: this.userId })
  if (
    user?.orgId &&
    AuthManager.userHasClaim(user._id, [CONSTANTS.claims.canViewUsers._id])
  ) {
    return Meteor.users.find(
      { orgId: user.orgId },
      {
        fields: {
          profile: 1,
          isAnonymous: 1,
          createdAt: 1,
          emails: 1,
          orgId: 1,
          isOrgOwner: 1,
        },
      }
    )
  }
  this.ready()
  return null
})

// slimmed down pub just for guest users
Meteor.publish(CONSTANTS.publications.orgUsersForGuest, function (opts) {
  // todo use slateAccess to ensure opts.slateId is unlisted or public
  const slate = Slates.findOne({ _id: opts.slateId })
  if (
    slate &&
    (slate.options.isUnlisted || slate.options.isPublic) &&
    opts.orgId
  ) {
    return Meteor.users.find(
      { orgId: opts.orgId },
      { fields: { profile: 1, isAnonymous: 1, emails: 1 } }
    )
  }
  this.ready()
  return null
})

Meteor.publish(CONSTANTS.publications.orgSlates, function () {
  const user = Meteor.users.findOne({ _id: this.userId })
  if (
    user?.orgId &&
    AuthManager.userHasClaim(user._id, [CONSTANTS.claims.canViewSlates._id])
  ) {
    return Slates.find({ orgId: user.orgId }, { sort: { lastSaved: -1 } })
  }
  this.ready()
  return null
})

Meteor.publish(CONSTANTS.publications.claims, function () {
  if (Meteor.user()) {
    return Claims.find({}, { disableOplog: true })
  }
  this.ready()
  return null
})

Meteor.publish(CONSTANTS.publications.pricingTiers, function () {
  if (Meteor.user()) {
    return PricingTiers.find({}, { disableOplog: true })
  }
  this.ready()
  return null
})

Meteor.publish(CONSTANTS.publications.permissions, function () {
  const user = Meteor.users.findOne({ _id: this.userId })
  if (user?.orgId) {
    return Permissions.find({ orgId: user.orgId }, { disableOplog: true })
  }
  this.ready()
  return null
})

Meteor.publish(
  CONSTANTS.publications.approvalRequests,
  function (type, slateId) {
    if (this.userId) {
      return ApprovalRequests.find({ type, slateId })
    }
    this.ready()
    return null
  }
)
