/* eslint-disable no-underscore-dangle */
/* eslint-disable no-await-in-loop */
import intersection from 'lodash.intersection'
import uniq from 'lodash.uniq'
import { Meteor } from 'meteor/meteor'
import CONSTANTS from './constants'
import utils from './utils'
import { Permissions } from './models'

export default class AuthManager {
  static async ensurePermissions() {
    const permissions = await Permissions.find().countAsync()
    if (permissions === 0) {
      await utils.pause(500)
      return AuthManager.ensurePermissions()
    }
    return true
  }

  static async userHasClaim(userId, claims, mustBeInAll) {
    if (typeof userId !== 'string' || !userId) return false
    let uclaims = claims
    if (!uclaims.filter) uclaims = [uclaims]
    // always add admin to the list
    uclaims = uniq(uclaims.concat(CONSTANTS.claims.admin._id))
    if (Meteor.isClient) {
      await AuthManager.ensurePermissions()
    }
    // A team claim counts only in the team the person is in now: a row a person was given in
    // a team of their own says nothing about another team. uberMensch is the one claim that
    // belongs to no team.
    let query = { userId }
    if (Meteor.isServer) {
      const user = await Meteor.users.findOneAsync(userId, { fields: { orgId: 1 } })
      query = { userId, $or: [{ claimId: CONSTANTS.claims.uberMensch._id }, ...(user?.orgId ? [{ orgId: user.orgId }] : [])] }
    }
    const permissions = await Permissions.find(query).fetchAsync()
    const claimIds = permissions.map((p) => p.claimId)
    if (mustBeInAll) {
      return intersection(claimIds, uclaims).length === uclaims.length
    }
    return intersection(claimIds, uclaims).length > 0
  }
}
