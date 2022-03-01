/* eslint-disable no-underscore-dangle */
import intersection from 'lodash.intersection'
import uniq from 'lodash.uniq'
import CONSTANTS from './constants'
import { Permissions } from './models'

export default class AuthManager {
  static userHasClaim(userId, claims, mustBeInAll) {
    let uclaims = claims
    if (!uclaims.filter) uclaims = [uclaims]
    // always add admin to the list
    uclaims = uniq(uclaims.concat(CONSTANTS.claims.admin._id))
    const permissions = Permissions.find({ userId }).fetch()
    const claimIds = permissions.map((p) => p.claimId)
    if (mustBeInAll) {
      return intersection(claimIds, uclaims).length === uclaims.length
    }
    return intersection(claimIds, uclaims).length > 0
  }
}
