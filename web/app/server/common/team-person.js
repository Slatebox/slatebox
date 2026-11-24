/* eslint-disable no-underscore-dangle, import/prefer-default-export */
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../imports/api/common/constants'
import { Permissions } from '../../imports/api/common/models'

/**
 * A person as the team rules see them: their team, whether they own it, whether they are an admin
 * of it (the owner always is). Null when there is no such account.
 */
export async function teamPerson(userId) {
  const person = await Meteor.users.findOneAsync(userId, { fields: { orgId: 1, isOrgOwner: 1 } })
  if (!person) return null
  const admin = Boolean(person.orgId) && (person.isOrgOwner === true ||
    Boolean(await Permissions.findOneAsync({ userId, orgId: person.orgId, claimId: CONSTANTS.claims.admin._id }, { fields: { _id: 1 } })))
  return { _id: person._id, orgId: person.orgId, isOrgOwner: person.isOrgOwner === true, isAdmin: admin }
}

