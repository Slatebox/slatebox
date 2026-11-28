import { Meteor } from 'meteor/meteor'
import {
  SlateAccess,
  SlateApiTokens,
  Slates,
} from '../imports/api/common/models'
import { createApiTokenService } from './api-token-core.mjs'
import { slateProjectRoleOf } from './projects/access-meteor'

const apiTokenService = createApiTokenService({
  apiTokens: SlateApiTokens,
  users: Meteor.users,
  slates: Slates,
  slateAccess: SlateAccess,
  // a token's account in the slate's project: its own and its team's grants only
  projectRoleOf: (slate, user) => slateProjectRoleOf(slate, user, { token: true }),
})

export default apiTokenService
