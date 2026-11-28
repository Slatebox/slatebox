// Where a new slate may go: the one check every creation path makes before it puts a slate in a
// project (the first canvas save, slates.create, slates.importMermaid, slates.copy, a recipe).
// Pure, with the project access loader (project-access.mjs) injected.
import { problem } from '../actions/errors.mjs'
import { atLeast } from '../../imports/api/common/project-roles.mjs'

export const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * @param {{ access: ReturnType<import('./project-access.mjs').createProjectAccess> }} stores
 * @param {{ _id: string, orgId?: string|null }} user   who makes the slate (its owner)
 * @param {string|null|undefined} projectId             the drive or folder it goes in
 * @param {{ token?: boolean }} [options]               a token's role (no link, no admin rights)
 * @returns {Promise<{ projectId: string|null, orgId: string|null }>} what the new slate stores;
 *   orgId is the drive's team (a drive slate is the drive's team's), or the person's own
 */
export async function checkPlacement({ access }, user, projectId, { token = false } = {}) {
  const own = { projectId: null, orgId: user?.orgId || null }
  if (projectId === undefined || projectId === null || projectId === '') return own
  if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) throw problem(400, 'invalid_request', 'projectId names a project.')
  if (!user?._id) throw problem(403, 'registration_required', 'Create an account to add slates to a project.')
  const drive = await access.driveOf(projectId)
  const role = drive ? await access.roleFor(user, projectId, { token }) : null
  if (!role) throw problem(404, 'not_found', 'Project not found or unavailable.')
  if (!atLeast(role, 'editor')) throw problem(403, 'forbidden', 'Only an editor of this project can add slates to it.')
  return { projectId, orgId: drive.orgId || null }
}
