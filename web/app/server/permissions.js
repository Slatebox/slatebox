/* eslint-disable no-unused-vars */
import { Meteor } from 'meteor/meteor'
import AuthManager from '../imports/api/common/AuthManager'
import CONSTANTS from '../imports/api/common/constants'
import {
  GuestViews,
  Organizations,
  Collaboration,
  Slates,
  Collaborators,
  Claims,
  Messages,
  SlateAccess,
  Comments,
  Audit,
  ApprovalRequests,
} from '../imports/api/common/models'

function hasPermission(userId, doc, isSlate) {
  let allow = false
  if (!userId) {
    if (doc.instanceId) {
      const hasGuestView = GuestViews.findOne({
        guestCollaboratorId: doc.instanceId,
      })
      allow = hasGuestView
        ? new Date().valueOf() < hasGuestView.timestamp + 1000 * 60 * 60 * 24
        : false
    }
  } else {
    allow = doc.userId === userId
    if (!allow) {
      allow = isSlate ? doc.options.collaboration.allow : false
    }
  }
  return allow
}

function hasOrgPermission(userId, addlClaims = []) {
  return AuthManager.userHasClaim(userId, [
    CONSTANTS.claims.admin.id,
    ...addlClaims,
  ])
}

function isMasterUser() {
  return Meteor.user() && Meteor.user().isMasterUser
}

Meteor.users.allow({
  insert(userId, doc) {
    return hasOrgPermission(userId, [CONSTANTS.claims.canAddUsers.id])
  },
  update(userId, doc, fieldNames, modifier) {
    const perm =
      hasOrgPermission(userId, [CONSTANTS.claims.canEditUsers.id]) ||
      Meteor.userId() === userId
    return perm
  },
  remove(userId, doc) {
    return (
      hasOrgPermission(userId, [CONSTANTS.claims.canRemoveUsers.id]) ||
      Meteor.userId() === userId
    )
  },
})

Audit.allow({
  insert(userId, doc) {
    return hasOrgPermission(userId)
  },
  update(userId, doc, fieldNames, modifier) {
    return hasOrgPermission(userId) || Meteor.userId() === userId
  },
  remove(userId, doc) {
    return hasOrgPermission(userId) || Meteor.userId() === userId
  },
})

Messages.allow({
  insert(userId, doc) {
    return hasOrgPermission(userId) || Meteor.userId() === userId
  },
  update(userId, doc, fieldNames, modifier) {
    return hasOrgPermission(userId) || Meteor.userId() === userId
  },
  remove(userId, doc) {
    return hasOrgPermission(userId) || Meteor.userId() === userId
  },
})

Comments.allow({
  insert(userId, doc) {
    return hasOrgPermission(userId) || Meteor.userId() === userId
  },
  update(userId, doc, fieldNames, modifier) {
    return hasOrgPermission(userId) || Meteor.userId() === userId
  },
  remove(userId, doc) {
    return hasOrgPermission(userId) || Meteor.userId() === userId
  },
})

Collaboration.allow({
  insert(userId, doc) {
    return hasPermission(userId, doc)
  },
  update(userId, doc, fieldNames, modifier) {
    return hasPermission(userId, doc)
  },
  remove(userId, doc) {
    return hasPermission(userId, doc)
  },
})

Slates.allow({
  insert(userId, doc) {
    return hasPermission(userId, doc, true)
  },
  update(userId, doc, fieldNames, modifier) {
    const p = hasPermission(userId, doc, true)
    return p
  },
  remove(userId, doc) {
    return hasPermission(userId, doc, true)
  },
})

SlateAccess.allow({
  insert(userId, doc) {
    return Slates.findOne({ _id: doc.slateId, userId })
  },
  update(userId, doc, fieldNames, modifier) {
    return Slates.findOne({ _id: doc.slateId, userId })
  },
  remove(userId, doc) {
    return Slates.findOne({ _id: doc.slateId, userId })
  },
})

Collaborators.allow({
  insert(userId, doc) {
    return hasPermission(userId, doc)
  },
  update(userId, doc, fieldNames, modifier) {
    return hasPermission(userId, doc)
  },
  remove(userId, doc) {
    return hasPermission(userId, doc)
  },
})

Claims.allow({
  insert(userId, doc) {
    return isMasterUser()
  },
  update(userId, doc, fieldNames, modifier) {
    return isMasterUser()
  },
  remove(userId, doc) {
    return isMasterUser()
  },
})

Organizations.allow({
  insert(userId, doc) {
    return hasOrgPermission(userId)
  },
  update(userId, doc, fieldNames, modifier) {
    return hasOrgPermission(userId)
  },
  remove(userId, doc) {
    return hasOrgPermission(userId)
  },
})

ApprovalRequests.allow({
  insert(userId, doc) {
    return hasPermission(userId, doc)
  },
  update(userId, doc, fieldNames, modifier) {
    return isMasterUser()
  },
  remove(userId, doc) {
    return hasPermission(userId, doc)
  },
})
