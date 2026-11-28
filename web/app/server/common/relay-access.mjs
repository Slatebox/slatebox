// What the collaboration relay lets a person do in a slate's room: nothing, read or write.
//
// - Read: whoever the canvas opens the slate for (openSlateRole, the rule slates.get follows): the
//   owner, a teammate or admin the sharing names, an invitation's holder, anyone on a public or
//   unlisted slate (embeds and presentations included), a guest on a slate shared with guests.
// - Write: only who a canvas save would be taken from (canEditNativeSlate, the rule slates.update
//   enforces, with its visitor and address), and never a visitor on a workshop slate (the save
//   refuses them too). Anyone else who may read gets read.
// - The room is the slate's own id from the server's record (the engine's options.id), never a
//   value the caller sends.
//
// stores: the openSlateRole stores, plus access (SlateAccess, raw: find().toArray()), guestViews
// (GuestViews, raw: findOne) for canEditNativeSlate.
import { openSlateRole } from './slate-open-role.mjs'
import { canEditNativeSlate } from '../methods/native-slate-save.mjs'
import { hasWorkshop } from '../../imports/api/common/workshop-notes.mjs'

export const RELAY_CODES = Object.freeze({
  ok: 'ok',
  // No key, or not a string: there is no slate to ask about.
  invalidSlate: 'invalid-slate',
  // Nothing has that address (a new slate not saved yet, or a made-up one).
  notFound: 'slate-not-found',
  // The slate exists and this person may not open it.
  noAccess: 'no-access',
})

const isKey = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128

/**
 * user: the caller's account or null. shareId: the slate's share id. routeKey: the address the
 * canvas was opened at (an invitation's key, the url name or the share id); it decides an
 * invitation's role, as it does for the save. visitor: the canvas's visitor id (a guest's
 * admission). readOnly: the caller asks for read only (a slate's picture never edits).
 * projectKey: a drive link's key the canvas was opened with (?p=<key>).
 * Returns { code, role?, room?, slateId? }.
 */
export async function relayAccess(stores, { user, shareId, routeKey, visitor, readOnly = false, projectKey = null } = {}) {
  const key = isKey(routeKey) ? routeKey : isKey(shareId) ? shareId : null
  if (!key) return { code: RELAY_CODES.invalidSlate }
  const opened = await openSlateRole(stores, key, user || null, { projectKey })
  if (opened && opened.found === false) return { code: RELAY_CODES.notFound }
  if (!opened?.slate) return { code: RELAY_CODES.noAccess }
  const { slate } = opened
  // An address and a share id that name two different slates are refused, not mixed.
  if (isKey(shareId) && isKey(routeKey) && shareId !== slate.shareId) return { code: RELAY_CODES.noAccess }
  // The engine joins the room named by the slate's options.id (compat-facade collab.init({ roomName: options.id })),
  // which is not the Mongo _id; a slate saved without one falls back to its _id.
  const room = String(slate.options?.id || slate._id)
  let role = 'read'
  if (!readOnly && opened.accessLevel === 'EDIT') {
    // The address as the canvas's save sends it (routeKey; the share id when none is named).
    const editable = await canEditNativeSlate(stores, user || null, slate, typeof visitor === 'string' ? visitor : undefined,
      isKey(routeKey) ? routeKey : slate.shareId, { projectKey })
    if (editable && !(hasWorkshop(slate) && !user?._id)) role = 'write'
  }
  return { code: RELAY_CODES.ok, role, room, slateId: slate._id }
}
