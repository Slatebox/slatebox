// The one answer to "may this person open this slate, and as what": the canvas's read
// (slates.get, getSlatesForUser) and the collaboration relay's room token (collaborators.init)
// both ask here, so the relay never lets in anyone the canvas would turn away.
//
// key is what the address names: a slate's share id, its url name, or an invitation's access key
// (whose type must match the slate's visibility). stores:
//   findSlate(query) -> slate | null, findGrant(query) -> grant | null,
//   listGrants(query) -> grants (slateId, type, userId, accessKey, slateAccessPermissionId),
//   isTeamAdmin(userId) -> boolean.
// Returns { found: false } when nothing has that key (a new slate's address), null when the
// person may not open it, and { slate, accessLevel, invitation } when they may.
import { resolveSlateRole, slateVisibility } from '../methods/slate-role.mjs'

export async function openSlateRole({ findSlate, findGrant, listGrants, isTeamAdmin }, key, user) {
  if (typeof key !== 'string' || !key.length) return null
  let invitation
  let slate = await findSlate({ $or: [{ shareId: key }, { 'options.url_name': key }] })
  if (!slate) {
    const grant = await findGrant({ accessKey: key })
    if (!grant) return { found: false }
    slate = await findSlate({ _id: grant.slateId })
    if (!slate) return null
    // The invitation's kind must match how the slate is shared now.
    if ((grant.type === 'unlisted' && !slate.options?.isUnlisted) ||
        (grant.type === 'private' && !slate.options?.isPrivate) ||
        (grant.type === 'public' && !slate.options?.isPublic)) return null
    invitation = key
  }
  if (!user && !slate.options?.isPublic && !slate.options?.isUnlisted) return null
  const isAdmin = Boolean(user?.isMasterUser === true ||
    (user?.orgId && user.orgId === slate.orgId && await isTeamAdmin(user._id)))
  const grants = user?._id && slate.userId === user._id ? [] :
    await listGrants({ slateId: slate._id, type: slateVisibility(slate) })
  const accessLevel = resolveSlateRole(slate, user, isAdmin, grants, invitation)
  if (!accessLevel) return null
  return { slate, accessLevel, invitation }
}
