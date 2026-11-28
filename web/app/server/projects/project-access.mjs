/* eslint-disable no-underscore-dangle */
// Loads the project input to the slate rule, once per question. Meteor-free, with injected stores
// (raw MongoDB driver collections, or anything with findOne and find().toArray()):
//   projects       the 'projects' collection (drives and folders)
//   projectAccess  the 'projectAccess' collection (a drive's grants)
//   users          Meteor.users (orgId)
//   isTeamAdmin(userId) -> boolean   the team admin claim (AuthManager)
//
// The answer feeds resolveSlateRole's projectRole (methods/slate-role.mjs) at every door.
import { resolveProjectRole } from './project-role.mjs'

const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128
const GRANT_FIELDS = { projectId: 1, kind: 1, userId: 1, orgId: 1, role: 1, accessKey: 1 }
const DRIVE_FIELDS = { _id: 1, ownerId: 1, orgId: 1, rootId: 1, parentId: 1, recipesPaused: 1, sharingRevision: 1 }

export function createProjectAccess({ projects, projectAccess, users, isTeamAdmin = async () => false }) {
  async function driveOf(projectId) {
    if (!isId(projectId)) return null
    const found = await projects.findOne({ _id: projectId }, { projection: DRIVE_FIELDS })
    if (!found) return null
    if (found.rootId === found._id) return found
    return projects.findOne({ _id: found.rootId }, { projection: DRIVE_FIELDS })
  }

  async function memberOf(user) {
    if (!user?._id) return { orgIds: [], orgId: null }
    // The caller may hand in a partial user ({ _id } from a token): read the team from the account.
    const orgId = user.orgId !== undefined ? user.orgId : (await users.findOne({ _id: user._id }, { projection: { orgId: 1 } }))?.orgId
    return { orgIds: orgId ? [orgId] : [], orgId: orgId || null }
  }

  /**
   * @param {object|null} user   { _id, orgId? } or null for a guest
   * @param {string} projectId   a drive or a folder
   * @param {object} [options]
   * @param {string|null} [options.linkKey]   a drive link key (/p/<key>, ?p=<key>)
   * @param {boolean} [options.token]          an API token or connected app: user and team grants
   *   only; no link grant and no team admin's manager rights (as a token never uses an unlisted
   *   link and never acts as an admin on slates)
   */
  async function roleIn(drive, user, { linkKey = null, token = false } = {}) {
    if (!drive) return null
    const { orgIds, orgId } = await memberOf(user)
    const grants = await projectAccess.find({ projectId: drive._id }, { projection: GRANT_FIELDS }).toArray()
    const teamAdmin = !token && Boolean(user?._id && drive.orgId && orgId === drive.orgId && await isTeamAdmin(user._id))
    return resolveProjectRole(drive, user?._id ? user : null, grants, { linkKey: token ? null : linkKey, memberOrgIds: orgIds, teamAdmin })
  }

  // The project and, nested, every folder under it: the projects a list of its slates covers.
  async function folderIds(projectId, { nested = true } = {}) {
    if (!isId(projectId)) return []
    const project = await projects.findOne({ _id: projectId }, { projection: { _id: 1, rootId: 1 } })
    if (!project) return []
    if (!nested) return [project._id]
    const tree = await projects.find({ rootId: project.rootId }, { projection: { _id: 1, parentId: 1 } }).toArray()
    const out = [project._id]
    for (let i = 0; i < out.length; i += 1) for (const row of tree) if (row.parentId === out[i]) out.push(row._id)
    return out
  }

  return {
    driveOf,
    folderIds,
    async roleFor(user, projectId, options = {}) {
      return roleIn(await driveOf(projectId), user, options)
    },
    // The projects a list of this project's slates covers for this person (the slates.get project
    // page), or [] when they have no role in it. A drive link's key (/p/<key>) gives its holder the
    // link's role, and so the drive's slates: a project role opens every slate in the drive on top
    // of the slate's own sharing (methods/slate-role.mjs resolveSlateRole).
    async listableProjectIds(user, projectId, { linkKey = null, token = false, nested = false } = {}) {
      if (!user?._id || !isId(projectId)) return []
      const role = await roleIn(await driveOf(projectId), user, { linkKey: typeof linkKey === 'string' && linkKey ? linkKey : null, token })
      if (!role) return []
      return folderIds(projectId, { nested })
    },
    // The role the slate's drive gives this person (null when the slate is in no drive).
    async slateProjectRole(board, user, { linkKey = null, token = false } = {}) {
      if (!board?.projectId) return null
      const role = await roleIn(await driveOf(board.projectId), user, { linkKey, token })
      // Someone with no account opens through a drive link as a viewer at most: editing and
      // commenting need an account (a guest's save is refused on any private slate).
      if (!user?._id && role) return 'viewer'
      return role
    },
    // The drives this person sees in their sidebar: their own, those shared with them by name or
    // through their team, and, for a team admin, every drive of the team.
    async readableDriveIds(user) {
      if (!user?._id) return []
      const { orgId } = await memberOf(user)
      const ids = new Set()
      for (const drive of await projects.find({ ownerId: user._id, parentId: null }, { projection: { _id: 1 } }).toArray()) ids.add(drive._id)
      const grants = await projectAccess.find({
        $or: [{ kind: 'user', userId: user._id }, ...(orgId ? [{ kind: 'team', orgId }] : [])],
        role: { $ne: 'none' },
      }, { projection: { projectId: 1 } }).toArray()
      for (const grant of grants) ids.add(grant.projectId)
      if (orgId && await isTeamAdmin(user._id)) {
        for (const drive of await projects.find({ orgId, parentId: null }, { projection: { _id: 1 } }).toArray()) ids.add(drive._id)
      }
      return [...ids]
    },
  }
}
