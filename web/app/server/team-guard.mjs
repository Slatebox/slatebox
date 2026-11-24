/* eslint-disable no-underscore-dangle */
// Who may change whom in a team: the server's one rule for removing a member
// (organizations.removeMember) and for changing a member's team claims (users.changeRoles).
// The team page offers the same choices, but the page is never the guard.
//
// - Nobody removes or changes the team owner, and nobody removes or changes themselves here.
// - Only an admin (the owner or a holder of the admin claim) removes an admin, changes an admin's
//   claims, or gives or takes the admin claim.
// - The server administrator claim (uberMensch) is never given, taken or wiped from a team page.

export const ADMIN_CLAIM = 'admin'
export const SERVER_ADMIN_CLAIM = 'uberMensch'
// the claims a role change moves; making someone an admin clears these (admin includes them)
export const PEOPLE_CLAIMS = ['canViewUsers', 'canEditUsers', 'canAddUsers', 'canRemoveUsers']

/**
 * Why the caller may not remove this member, or null when they may.
 * caller: { _id, orgId, canRemove, isAdmin }; member: { _id, orgId, isOrgOwner, isAdmin } or null.
 */
export function removalRefusal(caller, member) {
  if (!caller?._id || !caller.orgId || !member || member.orgId !== caller.orgId) return 'Choose a member of your team.'
  if (member._id === caller._id) return 'You cannot remove yourself from the team here.'
  if (!caller.canRemove) return 'You do not have permission to remove people.'
  if (member.isOrgOwner) return 'The team owner cannot be removed.'
  if (member.isAdmin && !caller.isAdmin) return 'Only an admin can remove an admin.'
  return null
}

/**
 * Why the caller may not make this claim change, or null when they may.
 * caller: { _id, isAdmin }; member: { _id, isOrgOwner, isAdmin }; change: { claimIds, action }.
 */
export function roleChangeRefusal(caller, member, change) {
  if (!member) return 'That person is not in your team.'
  if (change.claimIds.includes(SERVER_ADMIN_CLAIM)) return 'That role cannot be given.'
  if (member._id === caller._id) return 'You cannot change your own role.'
  if (member.isOrgOwner) return "The team owner's role cannot be changed."
  if (!caller.isAdmin && (member.isAdmin || change.claimIds.includes(ADMIN_CLAIM))) return 'Only an admin can change who is an admin.'
  return null
}

/** The rows the admin claim replaces when it is given: the people claims only, never slate claims or uberMensch. */
export const clearedByAdmin = () => [...PEOPLE_CLAIMS]
