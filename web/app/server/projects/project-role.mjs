// The one rule for a person's role in a project (a drive and its folders). Pure, no Meteor: the
// slate rule (methods/slate-role.mjs) takes its answer as one more input, so every door that asks
// "may this person open this slate" (slate-access.js, native-slate-save.mjs, slate-open-role.mjs,
// api-token-core.mjs, users.js getSlateAccessUrl) gives a drive's people the same access.
//
// Access is set on the drive only. A folder's people are its drive's: callers resolve a folder to
// its drive (rootId) before asking.
import { PROJECT_ROLE_RANK, projectRoleToSlateRole } from '../../imports/api/common/project-roles.mjs'

export { PROJECT_ROLE_RANK, projectRoleToSlateRole }

const ROLE_NAMES = ['viewer', 'commenter', 'editor', 'manager']
const higher = (a, b) => ((PROJECT_ROLE_RANK[b] || 0) > (PROJECT_ROLE_RANK[a] || 0) ? b : a)

/**
 * A person's role in a drive.
 * @param {object} drive        the drive (a project whose rootId is its own _id)
 * @param {object|null} user    { _id } or null (a guest with a link)
 * @param {object[]} grants     the drive's ProjectAccess rows
 * @param {object} [options]
 * @param {string|null} [options.linkKey]       the drive link's key the address carried
 * @param {string[]} [options.memberOrgIds]     the teams the person belongs to
 * @param {boolean} [options.teamAdmin]         whether the person is an admin of drive.orgId
 * @returns {'owner'|'manager'|'editor'|'commenter'|'viewer'|null}
 */
export function resolveProjectRole(drive, user, grants = [], { linkKey = null, memberOrgIds = [], teamAdmin = false } = {}) {
  if (!drive) return null
  const userId = user?._id || null
  if (userId && userId === drive.ownerId) return 'owner'
  let role = null
  // A team's admins manage its drives, as they may edit every slate of the team.
  if (userId && teamAdmin && drive.orgId && memberOrgIds.includes(drive.orgId)) role = 'manager'
  for (const grant of grants) {
    if (!grant || grant.projectId !== drive._id || !ROLE_NAMES.includes(grant.role)) continue
    if (grant.kind === 'user' && userId && grant.userId === userId) role = higher(role, grant.role)
    else if (grant.kind === 'team' && userId && grant.orgId && memberOrgIds.includes(grant.orgId)) role = higher(role, grant.role)
    else if (grant.kind === 'link' && typeof linkKey === 'string' && linkKey.length && grant.accessKey === linkKey) {
      // A link opens the drive; it never manages it.
      role = higher(role, grant.role === 'manager' ? 'editor' : grant.role)
    }
  }
  return role
}

const SLATE_RANK = { READ: 1, COMMENT: 2, EDIT: 3 }

/** The higher of two slate roles (EDIT > COMMENT > READ > null). */
export function maxSlateRole(a, b) {
  const ra = SLATE_RANK[a] || 0
  const rb = SLATE_RANK[b] || 0
  if (!ra && !rb) return null
  return rb > ra ? b : a
}
