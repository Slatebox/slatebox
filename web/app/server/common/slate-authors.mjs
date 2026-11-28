/* eslint-disable no-underscore-dangle */
// The name under a slate's card in a list (My slates, a project, shared): the slate's owner, never
// the person looking. A shared project lists other people's slates, so each card is named after
// slate.userId, looked up on the server. Another person's name follows the library's author rule
// (server/library/meteor.js): their profile name only, never their email address; a guest account
// is 'Guest' and a registered account without a name is UNNAMED_AUTHOR. Only the viewer's own
// slates may fall back to the start of their own email address, as their own cards always did.
// No Meteor here: the method passes the users lookup in.
import { UNNAMED_AUTHOR } from '../../imports/api/common/library-model.mjs'

export const GUEST_AUTHOR = 'Guest'

// What a lookup reads of each owner: enough for a name, nothing else.
export const AUTHOR_FIELDS = Object.freeze({ _id: 1, isAnonymous: 1, 'profile.firstName': 1, 'profile.lastName': 1, emails: 1 })

const part = (value) => (typeof value === 'string' ? value.trim() : '')

/** The name shown for a slate's owner to the viewer (viewerId), by the rule above. */
export function authorNameOf(user, viewerId = null) {
  if (!user || user.isAnonymous === true) return GUEST_AUTHOR
  const name = [part(user.profile?.firstName), part(user.profile?.lastName)].filter(Boolean).join(' ')
  if (name) return name
  if (viewerId && user._id === viewerId) return part(user.emails?.[0]?.address).split('@')[0] || UNNAMED_AUTHOR
  return UNNAMED_AUTHOR
}

/**
 * Each slate with authorName, its owner's name for the viewer. findUsers(ids, fields) returns the
 * users among ids (one lookup for the whole page). A slate whose owner is gone reads UNNAMED_AUTHOR.
 */
export async function withAuthorNames(slates, { viewerId = null, findUsers }) {
  const list = Array.isArray(slates) ? slates : []
  const ids = [...new Set(list.map((s) => s?.userId).filter((id) => typeof id === 'string' && id))]
  const users = ids.length ? await findUsers(ids, AUTHOR_FIELDS) : []
  const byId = new Map((users || []).map((u) => [u._id, u]))
  return list.map((slate) => {
    if (!slate || typeof slate !== 'object') return slate
    const owner = byId.get(slate.userId)
    return { ...slate, authorName: owner ? authorNameOf(owner, viewerId) : UNNAMED_AUTHOR }
  })
}
