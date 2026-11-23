/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import AuthManager from './AuthManager'
import CONSTANTS from './constants'
import { SlateAccess } from './models'

async function slateFilter(opts) {
  const queryable = []
  const userId = Meteor.userId()
  const orgId = opts.type === 'team' ? (await Meteor.userAsync())?.orgId : null
  switch (opts.type) {
    case 'team':
    case 'mine': {
      if (opts.private) {
        queryable.push({
          $or: [{ 'options.isPrivate': true }, { 'options.isUnlisted': true }],
        })
      }
      if (opts.type === 'team' && orgId) {
        const isAdmin = await AuthManager.userHasClaim(userId, [
          CONSTANTS.claims.admin._id,
        ])
        const grants = await SlateAccess.find({
          userId,
          type: 'private',
          orgId,
          slateAccessPermissionId: { $ne: CONSTANTS.slateAccessPermissions.none.id },
        }, { fields: { slateId: 1 } }).fetchAsync()
        const visibility = [
          { 'options.isPublic': true },
          isAdmin
            ? { 'options.isPrivate': true }
            : { 'options.isPrivate': true, _id: { $in: grants.map(grant => grant.slateId) } },
        ]
        queryable.push({ orgId, userId: { $ne: userId }, $or: visibility })
      } else {
        queryable.push({ userId })
      }
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
