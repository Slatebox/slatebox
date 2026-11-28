import { Meteor } from 'meteor/meteor'

// Projects from the browser: one thin wrapper per projects.* action (server/actions/projects-*.mjs),
// the same handlers and checks that tokens, exec, the MCP server and the CLI reach. A refusal rejects
// with a Meteor.Error whose `error` is the action's code and whose reason is the sentence to show
// (projectsModel.mjs projectErrorWords).

/**
 * @typedef {'owner'|'manager'|'editor'|'commenter'|'viewer'} ProjectRole
 * @typedef {{
 *   _id: string, ownerId: string, ownerName?: string, ownerEmail?: string, orgId: string|null, rootId: string,
 *   parentId: string|null, depth: 0|1|2|3, name: string, description: string, color: number|null,
 *   created: string, lastSaved: string, recipesPaused: boolean, role?: ProjectRole
 * }} Project
 * @typedef {{
 *   _id: string, projectId: string, kind: 'link'|'user'|'team', userId: string|null, orgId: string|null,
 *   role: 'none'|'viewer'|'commenter'|'editor'|'manager', accessKey: string|null,
 *   userName?: string, email?: string, orgName?: string, pending?: boolean
 * }} ProjectAccess
 */

const call = (method, input = {}) => Meteor.callAsync(method, input)

const projectsApi = {
  /** @returns {Promise<{projects: Project[]}>} every drive and folder the caller sees (folders carry their drive's role) */
  list: (input = {}) => call('projects.list', input),
  /** @param {{projectId?: string, accessKey?: string}} input  accessKey: a drive's link (/p/<accessKey>)
   *  @returns {Promise<{project: Project, drive: Project, folders: Project[]}>} */
  get: (input) => call('projects.get', input),
  /** @param {{name: string, description?: string, color?: number|null, orgId?: string|null, parentId?: string|null}} input
   *  @returns {Promise<Project>} a drive, or a folder when parentId is given */
  create: (input) => call('projects.create', input),
  /** @param {{projectId: string, name?: string, description?: string, color?: number|null, parentId?: string}} input */
  update: (input) => call('projects.update', input),
  /** @param {{projectId: string, moveContentsTo?: string}} input */
  remove: (input) => call('projects.delete', input),
  /** @param {{projectId: string, folders?: boolean, linkKey?: string}} input
   *  @returns {Promise<{slates: Array<{_id: string, shareId: string, name: string, userId: string, lastSaved: string, projectId: string}>}>} */
  slates: (input) => call('projects.slates', input),
  /** @param {{shareId: string, projectId: string|null}} input  null: out of any project */
  moveSlate: (input) => call('projects.moveSlate', input),
  /** @param {{projectId: string}} input @returns {Promise<{grants: ProjectAccess[]}>} */
  access: (input) => call('projects.access', input),
  /**
   * One change to who may open the drive. role 'none' removes a person's or team's grant.
   * @param {{projectId: string} & ({userId: string, role: string} | {email: string, role: string} | {orgId: string, role: string} | {link: 'none'|'viewer'|'commenter'|'editor', rotate?: boolean})} input
   * @returns {Promise<{grants: ProjectAccess[]}>}
   */
  share: (input) => call('projects.share', input),
}

export default projectsApi

