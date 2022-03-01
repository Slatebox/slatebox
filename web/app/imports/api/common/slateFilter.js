/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import AuthManager from './AuthManager'
import CONSTANTS from './constants'
import { Slates, SlateAccess } from './models'

function slateFilter(opts) {
  const queryable = []
  const userId = Meteor.userId()
  switch (opts.type) {
    case 'team':
    case 'mine': {
      if (opts.private) {
        queryable.push({
          $or: [{ 'options.isPrivate': true }, { 'options.isUnlisted': true }],
        })
      }
      if (opts.type === 'team' && Meteor.user().orgId) {
        const isAdmin = AuthManager.userHasClaim(userId, [
          CONSTANTS.claims.admin._id,
        ])
        const validSlateIds = []
        const accessibleSlateIds = SlateAccess.find({
          userId,
          type: 'private',
          orgId: Meteor.user().orgId,
          slateAccessPermissionId: {
            $ne: CONSTANTS.slateAccessPermissions.none.id,
          },
        })
          .fetch()
          .filter((a) => a.slateId)
        Slates.find(
          { orgId: Meteor.user().orgId },
          {
            fields: {
              userId: 1,
              'options.id': 1,
              'options.isPublic': 1,
              'options.isPrivate': 1,
              'options.isUnlisted': 1,
            },
          }
        )
          .fetch()
          .forEach((s) => {
            if (s.options.isPublic && s.userId !== userId) {
              validSlateIds.push(s.options.id)
            } else if (
              s.options.isPrivate &&
              (accessibleSlateIds.includes(s.options.id) ||
                (isAdmin && s.userId !== userId))
            ) {
              validSlateIds.push(s.options.id)
            }
          })
        queryable.push({ orgId: Meteor.user().orgId })
        queryable.push({ _id: { $in: validSlateIds } })
      } else {
        queryable.push({ userId })
      }
      break
    }
    case 'templates': {
      queryable.push({
        'options.isTemplate': true,
        'options.templateApproved': true,
      })
      break
    }
    case 'community': {
      queryable.push({ 'options.isTemplate': { $exists: false } })
      queryable.push({ userId: { $ne: userId } })
      const masterUser = Meteor.users.findOne({ isMasterUser: true })
      if (masterUser) {
        queryable.push({ userId: { $ne: masterUser._id } })
      }
      queryable.push({ 'options.isPublic': true })
      break
    }
    default: {
      break
    }
  }

  if (opts.filterString) {
    if (opts.useFullText) {
      queryable.push({ $text: { $search: opts.filterString } })
    } else {
      const re = { $regex: opts.filterString, $options: 'gi' }
      queryable.push({
        $or: [
          { 'options.nameSearch': re },
          { 'options.descriptionSearch': re },
          { 'options.textSearch': re },
        ],
      })
    }
  }

  return queryable
}

export default slateFilter
