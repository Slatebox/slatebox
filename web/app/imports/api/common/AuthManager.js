/* eslint-disable no-underscore-dangle */
/* eslint-disable no-await-in-loop */
import { Meteor } from 'meteor/meteor'
import CONSTANTS from './constants'
import utils from './utils'
import { Permissions } from './models'
import { decideClaims, serverAdminSelector, splitClaims } from './server-admin.mjs'

export default class AuthManager {
  static async ensurePermissions() {
    const permissions = await Permissions.find().countAsync()
    if (permissions === 0) {
      await utils.pause(500)
      return AuthManager.ensurePermissions()
    }
    return true
  }

  // Whether this person is an administrator of this Slatebox server (the uberMensch claim, a row in
  // no team). The server reads the row; a browser never has it (the permissions publication sends a
  // team's rows only), so it asks the server, which answers for the signed-in account alone.
  static async isServerAdmin(userId) {
    if (typeof userId !== 'string' || !userId) return false
    if (Meteor.isServer) return Boolean(await Permissions.findOneAsync(serverAdminSelector(userId), { fields: { _id: 1 } }))
    if (userId !== Meteor.userId()) return false
    try {
      return (await Meteor.callAsync(CONSTANTS.methods.admin.status))?.admin === true
    } catch {
      return false
    }
  }

  // claims: one claim or a list. The team claims always include the team 'admin' claim (a team
  // admin holds them all). The server administrator claim (uberMensch) is read on its own: asking
  // for it alone needs it alone, never the team admin claim as well (server-admin.mjs decideClaims).
  static async userHasClaim(userId, claims, mustBeInAll) {
    if (typeof userId !== 'string' || !userId) return false
    const { serverAdmin, team } = splitClaims(claims)
    const isServerAdmin = serverAdmin ? await AuthManager.isServerAdmin(userId) : false
    if (team.length === 0) return decideClaims({ claims, isServerAdmin, mustBeInAll })
    if (Meteor.isClient) {
      await AuthManager.ensurePermissions()
    }
    // A team claim counts only in the team the person is in now: a row a person was given in
    // a team of their own says nothing about another team.
    let query = { userId }
    if (Meteor.isServer) {
      const user = await Meteor.users.findOneAsync(userId, { fields: { orgId: 1 } })
      if (!user?.orgId) return decideClaims({ claims, isServerAdmin, mustBeInAll })
      query = { userId, orgId: user.orgId }
    }
    const permissions = await Permissions.find(query).fetchAsync()
    return decideClaims({ claims, isServerAdmin, teamClaimIds: permissions.map((p) => p.claimId), mustBeInAll })
  }
}
