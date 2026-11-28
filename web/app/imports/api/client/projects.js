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

// The actions answer in the public API's words (projectId, driveId, kind; server/actions/project-schemas.mjs),
// the same answer a token or the CLI gets. The pages read the shapes above: these turn one into the other.
const toProject = (p) => (p ? {
  ...p,
  _id: p.projectId,
  rootId: p.driveId,
  parentId: p.parentId ?? null,
  depth: p.depth ?? (p.kind === 'drive' ? 0 : 1),
  description: p.description || '',
  color: p.color ?? null,
  recipesPaused: Boolean(p.recipesPaused),
} : null)
const keyOfUrl = (url) => (typeof url === 'string' ? decodeURIComponent(url.split('/p/')[1] || '') || null : null)
const toGrants = (answer) => {
  if (!answer) return []
  const link = { _id: `link_${answer.projectId}`, projectId: answer.projectId, kind: 'link', userId: null, orgId: null, role: answer.link?.role || 'none', accessKey: keyOfUrl(answer.link?.url) }
  const people = (answer.grants || []).map((g) => ({
    ...g,
    _id: g.kind === 'team' ? `team_${g.orgId}_${answer.projectId}` : g.userId ? `user_${g.userId}_${answer.projectId}` : `invite_${g.email}_${answer.projectId}`,
    projectId: answer.projectId,
    accessKey: null,
    ...(g.kind === 'team' ? { orgName: g.name } : { userName: g.name }),
  }))
  return [link, ...people]
}

async function getProject({ projectId, accessKey = null, linkKey = null } = {}) {
  let id = projectId
  let key = linkKey
  if (accessKey) {
    const opened = await Meteor.callAsync('projects.openLink', accessKey)
    if (!opened?.projectId) throw new Meteor.Error('not_found', 'This link no longer opens a project.')
    id = opened.projectId
    key = accessKey
  }
  const withKey = (pid) => ({ projectId: pid, ...(key && { linkKey: key }) })
  const here = await call('projects.get', withKey(id))
  const driveAnswer = here.kind === 'drive' ? here : await call('projects.get', withKey(here.driveId))
  const drive = { ...toProject(driveAnswer), slateCount: driveAnswer.slateCount, ownerName: driveAnswer.ownerName }
  const project = { ...toProject(here), slateCount: here.slateCount, ownerName: driveAnswer.ownerName }
  const folders = (driveAnswer.driveFolders || []).map((f) => ({ _id: f.projectId, projectId: f.projectId, parentId: f.parentId, rootId: drive._id, driveId: drive._id, name: f.name, depth: f.depth, role: drive.role, kind: 'folder' }))
  return { project, drive, folders }
}

const projectsApi = {
  /** @returns {Promise<{projects: Project[]}>} the caller's drives (each with its role) */
  list: async (input = {}) => ({ projects: ((await call('projects.list', input))?.projects || []).map(toProject) }),
  /** @param {{projectId?: string, accessKey?: string, linkKey?: string}} input  accessKey: a drive's link (/p/<accessKey>)
   *  @returns {Promise<{project: Project, drive: Project, folders: Project[]}>} */
  get: getProject,
  /** @param {{name: string, description?: string, color?: number|null, orgId?: string|null, parentId?: string|null}} input
   *  @returns {Promise<Project>} a drive, or a folder when parentId is given */
  create: async (input) => toProject(await call('projects.create', input)),
  /** @param {{projectId: string, name?: string, description?: string, color?: number|null, parentId?: string}} input */
  update: async (input) => toProject(await call('projects.update', input)),
  /** @param {{projectId: string, moveContentsTo?: string}} input */
  remove: (input) => call('projects.delete', input),
  /** @param {{projectId: string, folders?: boolean}} input
   *  @returns {Promise<{slates: Array<{shareId: string, name: string, userId: string|null, lastSaved: string|null, projectId: string, url: string}>}>} */
  slates: async ({ projectId, folders = true } = {}) => {
    const answer = await call('projects.slates', { projectId, nested: folders !== false, limit: 100 })
    const me = Meteor.userId()
    return { slates: (answer?.slates || []).map((s) => ({ ...s, _id: s.shareId, userId: s.owner === 'you' ? me : null, lastSaved: s.updated })) }
  },
  /** @param {{shareId: string, projectId: string|null}} input  null: out of any project */
  moveSlate: (input) => call('projects.moveSlate', input),
  /** @param {{projectId: string}} input @returns {Promise<{grants: ProjectAccess[]}>} the link first, then people and teams */
  access: async (input) => ({ grants: toGrants(await call('projects.access', input)) }),
  /**
   * One change to who may open the drive. role 'none' removes a person's or team's grant.
   * @param {{projectId: string} & ({userId: string, role: string} | {email: string, role: string} | {orgId: string, role: string} | {link: 'none'|'viewer'|'commenter'|'editor', rotate?: boolean})} input
   * @returns {Promise<{grants: ProjectAccess[]}>}
   */
  share: async (input) => ({ grants: toGrants(await call('projects.share', input)) }),
}

export default projectsApi

