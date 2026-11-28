// The Meteor side of projects: the core on the real collections, bound into the interface enterprise
// code already holds (host.mjs), the claim of address invitations at sign-in, and the 'projects'
// publication the sidebar and the project page read. Everything else is in core.mjs, tested without
// Meteor (scripts/project-core.test.mjs).
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { MongoInternals } from 'meteor/mongo'
import { Random } from 'meteor/random'
import AuthManager from '../../imports/api/common/AuthManager'
import CONSTANTS from '../../imports/api/common/constants'
import { Organizations, ProjectAccess, Projects, Slates } from '../../imports/api/common/models'
import { audit } from '../audit/recorder.mjs'
import { slateSaveCore } from '../slate-save'
import { deleteOwnedSlate, generateSlateShareId } from '../methods/slates'
import { projectAccess } from './access-meteor'
import { createProjectsCore } from './core.mjs'
import { projectsHost } from './host.mjs'

const appOrigin = () => Meteor.settings.public?.baseUrl || Meteor.absoluteUrl()
const CLAIMS = { admin: CONSTANTS.claims.admin._id, canAddSlates: CONSTANTS.claims.canAddSlates._id }

export const projectsCore = createProjectsCore({
  stores: {
    projects: Projects.rawCollection(),
    projectAccess: ProjectAccess.rawCollection(),
    slates: Slates.rawCollection(),
    users: Meteor.users.rawCollection(),
  },
  access: projectAccess,
  saveCore: slateSaveCore,
  audit,
  deleteOwnedSlate,
  hooks: projectsHost.hooks,
  withTransaction: (action) =>
    MongoInternals.defaultRemoteCollectionDriver().mongo.client.withSession((session) => session.withTransaction(() => action(session))),
  hasClaim: (userId, claim) => AuthManager.userHasClaim(userId, [CLAIMS[claim]]),
  newId: () => Random.id(),
  // a link's key: 24 characters a person cannot guess (/p/<key>)
  generateKey: () => Random.id(24),
  generateShareId: generateSlateShareId,
  now: () => new Date(),
  appOrigin,
  teamName: async (orgId) => (await Organizations.findOneAsync({ _id: orgId }, { fields: { name: 1 } }))?.name || '',
})

projectsHost.bind(projectsCore)

// Someone invited to a project by address signs in with that address verified: the invitation
// becomes their grant. Never fails the sign-in.
Accounts.onLogin((attempt) => {
  const user = attempt?.user
  if (!user?._id || user.isAnonymous) return
  projectsCore.claimInvites(user).catch((error) => console.error('[projects] invitations', error?.message)) // eslint-disable-line no-console
})

// The sidebar's projects and the open project's folders: the drives the person has a role in, with
// every folder in them (a drive holds at most 500). Who has access is not published: managers read
// it through projects.access.
Meteor.publish(CONSTANTS.publications.projects, async function publishProjects() {
  if (!this.userId) return this.ready()
  const user = await Meteor.users.findOneAsync({ _id: this.userId }, { fields: { _id: 1, orgId: 1 } })
  if (!user) return this.ready()
  const ids = await projectAccess.readableDriveIds(user)
  return Projects.find({ rootId: { $in: ids } }, { fields: { name: 1, description: 1, color: 1, ownerId: 1, orgId: 1, rootId: 1, parentId: 1, depth: 1, lastSaved: 1, recipesPaused: 1 } })
})

// The link route (/p/<key>): which project the key opens, so the page can go there. A plain method:
// a person with no account may hold the link too.
Meteor.methods({
  async 'projects.openLink'(linkKey) {
    if (typeof linkKey !== 'string') return null
    return projectsCore.resolveLink(linkKey)
  },
})
