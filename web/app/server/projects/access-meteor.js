// The project access loader on the real collections: the one every door of the slate rule asks
// (common/slate-access.js, methods/slates.js, methods/creative-slates.js, api-token-auth.mjs,
// methods/users.js). It imports only the collections and the claim check, so any of them can
// import it without pulling in the projects core.
import { Meteor } from 'meteor/meteor'
import AuthManager from '../../imports/api/common/AuthManager'
import CONSTANTS from '../../imports/api/common/constants'
import { ProjectAccess, Projects } from '../../imports/api/common/models'
import { createProjectAccess } from './project-access.mjs'

export const projectAccess = createProjectAccess({
  projects: Projects.rawCollection(),
  projectAccess: ProjectAccess.rawCollection(),
  users: Meteor.users.rawCollection(),
  isTeamAdmin: (userId) => AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin._id]),
})

// The slate rule's projectRole input (methods/slate-role.mjs resolveSlateRole).
//   projectKey: a drive link's key the address carried (?p=<key>); token: an API token's account
export const slateProjectRoleOf = (board, user, { projectKey = null, token = false } = {}) =>
  projectAccess.slateProjectRole(board, user, { linkKey: typeof projectKey === 'string' ? projectKey : null, token })
