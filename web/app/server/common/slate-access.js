// Who may read or edit a slate, by the same sharing rules the canvas and the save methods use
// (slate-role.mjs, native-slate-save.mjs). Every method and publication that takes a slate id
// from a caller asks here before it reads or writes anything of that slate.
import { Meteor } from 'meteor/meteor'
import AuthManager from '../../imports/api/common/AuthManager'
import CONSTANTS from '../../imports/api/common/constants'
import { GuestViews, SlateAccess, Slates } from '../../imports/api/common/models'
import { resolveSlateRole, slateVisibility } from '../methods/slate-role.mjs'
import { canEditNativeSlate } from '../methods/native-slate-save.mjs'

const slateFields = { _id: 1, userId: 1, orgId: 1, shareId: 1, options: 1, sharingRevision: 1 }
const isTeamAdmin = (userId) => AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin._id])

export const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128

export async function findSlate({ slateId, shareId }) {
  if (isId(slateId)) return Slates.findOneAsync({ _id: slateId }, { fields: slateFields })
  if (isId(shareId)) return Slates.findOneAsync({ shareId }, { fields: slateFields })
  return null
}

async function viewer(userId) {
  if (!isId(userId)) return null
  return Meteor.users.findOneAsync(userId, { fields: { orgId: 1, isMasterUser: 1, isAnonymous: 1 } })
}

// A slate is readable by its owner, by anyone when it is public or unlisted (the slate's own id
// is what an unlisted link resolves to), and otherwise by whoever its sharing names.
export async function canReadSlate(userId, slate) {
  if (!slate) return false
  if (userId && slate.userId === userId) return true
  if (slate.options?.isPublic || slate.options?.isUnlisted) return true
  const user = await viewer(userId)
  if (!user) return false
  const isAdmin = user.isMasterUser === true || Boolean(user.orgId && user.orgId === slate.orgId && await isTeamAdmin(user._id))
  const grants = await SlateAccess.find({ slateId: slate._id, type: slateVisibility(slate) }, {
    fields: { slateId: 1, type: 1, userId: 1, accessKey: 1, slateAccessPermissionId: 1 },
  }).fetchAsync()
  return Boolean(resolveSlateRole(slate, user, isAdmin, grants))
}

export async function canEditSlate(userId, slate) {
  if (!slate) return false
  if (userId && slate.userId === userId) return true
  const user = await viewer(userId)
  if (!user) return false
  return Boolean(await canEditNativeSlate({
    access: SlateAccess.rawCollection(), guestViews: GuestViews.rawCollection(), isTeamAdmin,
  }, user, slate))
}

export async function requireEditableSlate(userId, query) {
  const slate = await findSlate(query)
  if (!slate || !await canEditSlate(userId, slate)) {
    throw new Meteor.Error('slate-denied', 'You do not have permission to change this slate.')
  }
  return slate
}

export async function requireReadableSlate(userId, query) {
  const slate = await findSlate(query)
  if (!slate || !await canReadSlate(userId, slate)) {
    throw new Meteor.Error('slate-denied', 'You do not have access to this slate.')
  }
  return slate
}
