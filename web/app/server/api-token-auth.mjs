import { Meteor } from 'meteor/meteor'
import {
  SlateAccess,
  SlateApiTokens,
  Slates,
} from '../imports/api/common/models'
import { createApiTokenService } from './api-token-core.mjs'

const apiTokenService = createApiTokenService({
  apiTokens: SlateApiTokens,
  users: Meteor.users,
  slates: Slates,
  slateAccess: SlateAccess,
})

export default apiTokenService
