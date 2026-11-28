import { maxSlateRole, projectRoleToSlateRole } from '../projects/project-role.mjs'

const roles = ['NONE', 'READ', 'COMMENT', 'EDIT']
const permitted = grant => roles.includes(grant?.slateAccessPermissionId) && grant.slateAccessPermissionId !== 'NONE'
  ? grant.slateAccessPermissionId : null

export function slateVisibility(board) {
  return board.options?.isPublic ? 'public' : board.options?.isUnlisted ? 'unlisted' : 'private'
}

// Native saves and the canvas reader use the same active grant rows. A bare
// board URL cannot choose between two different invitations on older slates.
//
// projectRole: the person's role in the project (drive) the slate sits in, from
// server/projects/project-access.mjs (null when the slate is in none, or the person has none). A
// drive's people get its role on every slate in it, on top of the slate's own sharing: the higher
// of the two wins.
export function resolveSlateRole(board, user, isAdmin, rows, invitation, projectRole = null) {
  return maxSlateRole(ownSlateRole(board, user, isAdmin, rows, invitation), projectRoleToSlateRole(projectRole))
}

function ownSlateRole(board, user, isAdmin, rows, invitation) {
  if (user?._id && user._id === board.userId) return 'EDIT'
  const type = slateVisibility(board)
  const grants = rows.filter(row => row.slateId === board._id && row.type === type)
  const named = user?._id && grants.find(row => row.userId === user._id)
  const exact = invitation === undefined ? null : grants.find(row => row.accessKey === invitation)
  if (invitation !== undefined && (!exact || (exact.userId && exact.userId !== user?._id && !isAdmin))) return null
  if (type === 'private') {
    if (!user?._id) return null
    return named ? permitted(named) : isAdmin ? 'EDIT' : null
  }
  if (exact) {
    const link = permitted(exact)
    if (!link || (named && !permitted(named))) return null
    return named && roles.indexOf(permitted(named)) < roles.indexOf(link) ? permitted(named) : link
  }
  if (!user?._id && type === 'public') return 'READ'
  if (named) return permitted(named)
  if (type === 'unlisted' && grants.length > 1) return isAdmin ? 'EDIT' : null
  const general = grants.filter(row => !row.userId)
  if (general.length === 1) return permitted(general[0])
  if (isAdmin) return 'EDIT'
  if (type === 'unlisted') return null
  // The bare public URL retains its signed-in default on boards with no grants.
  // When historical rows disagree, it is still a publicly readable board.
  return grants.length ? 'READ' : 'EDIT'
}
