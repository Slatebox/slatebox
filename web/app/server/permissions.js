/* eslint-disable no-unused-vars */
import { Meteor } from 'meteor/meteor'
import AuthManager from '../imports/api/common/AuthManager'
import CONSTANTS from '../imports/api/common/constants'
import { canReadSlate, findSlate } from './common/slate-access'
import { unsafeKeyPath, unsafeModifierPath } from './common/document-keys.mjs'
import {
  GuestViews,
  Organizations,
  Collaboration,
  Collaborators,
  Claims,
  Messages,
  Comments,
  Audit,
  ApprovalRequests,
  IconPacks,
  AIContent,
  Transcripts,
} from '../imports/api/common/models'

// No browser write stores a key minimongo refuses: such a document, once published, stops the
// browser of everyone who receives it (server/common/document-keys.mjs).
const unsafeWrites = {
  insert: (userId, doc) => Boolean(unsafeKeyPath(doc)),
  update: (userId, doc, fieldNames, modifier) => Boolean(unsafeModifierPath(modifier)),
}
for (const collection of [Meteor.users, Comments, Messages, AIContent, Claims, Organizations, ApprovalRequests]) {
  collection.deny(unsafeWrites)
}

// A browser write needs a signed-in account (a guest is one): a connection that is not signed in
// writes nothing.
async function hasPermission(userId, doc) {
  return Boolean(userId && doc.userId === userId)
}

async function isMasterUser() {
  const user = await Meteor.userAsync()
  return user?.isMasterUser
}

Meteor.users.allow({
  update(userId, doc, fields) {
    return Boolean(userId && doc._id === userId && fields.every(field => field === 'profile'))
  },
  async remove(userId, doc) {
    if (!userId) return false
    if (doc._id === userId) return true
    const owner = await Meteor.users.findOneAsync(userId, { fields: { orgId: 1 } })
    return Boolean(owner?.orgId && owner.orgId === doc.orgId &&
      await AuthManager.userHasClaim(userId, [CONSTANTS.claims.canRemoveUsers._id]))
  },
})

// Browser writes to these collections are the ones the app makes, each to a row of the writer's
// own: a comment by its author on a slate the author can read; a chat line or a note to oneself;
// a mention of a teammate named in one's own comment; marking one's own message read. Audit rows
// and icon packs are written by the server only.
const onlyFields = (fieldNames, allowed) => fieldNames.every(field => allowed.includes(field))
const signedIn = userId => typeof userId === 'string' && userId.length > 0

Comments.allow({
  // Comments are posted on the server only (comments.add: the comment role, and "@Slatebox ..."
  // asks the Slatebox agent there), never inserted from a browser.
  insert() {
    return false
  },
  update(userId, doc, fieldNames) {
    return signedIn(userId) && doc.createdByUserId === userId && onlyFields(fieldNames, ['text', 'resolved', 'mentionedTeamMembers'])
  },
  remove(userId, doc) {
    return signedIn(userId) && doc.createdByUserId === userId
  },
})

Messages.allow({
  async insert(userId, doc) {
    if (!signedIn(userId)) return false
    if (doc.type === CONSTANTS.messageTypes.chat) {
      // The browser posts its own line, and the line that says an AI request could not start.
      return (doc.userId === userId || doc.userId === 'ai') &&
        canReadSlate(userId, await findSlate({ shareId: doc.slateShareId }))
    }
    if (doc.userId === userId) return doc.type === CONSTANTS.messageTypes.system
    // A mention: the recipient is a teammate named in the sender's own comment.
    if (doc.type !== CONSTANTS.messageTypes.system || typeof doc.commentId !== 'string' || typeof doc.userId !== 'string') return false
    const sender = await Meteor.users.findOneAsync(userId, { fields: { orgId: 1 } })
    return Boolean(sender?.orgId &&
      await Comments.findOneAsync({ _id: doc.commentId, createdByUserId: userId, mentionedTeamMembers: doc.userId }, { fields: { _id: 1 } }) &&
      await Meteor.users.findOneAsync({ _id: doc.userId, orgId: sender.orgId }, { fields: { _id: 1 } }))
  },
  update(userId, doc, fieldNames) {
    return signedIn(userId) && doc.userId === userId && onlyFields(fieldNames, ['read'])
  },
  remove(userId, doc) {
    return signedIn(userId) && doc.userId === userId
  },
})

// The one AI row a browser writes: the marker that a run's layout has settled.
AIContent.allow({
  insert(userId, doc) {
    return signedIn(userId) && doc.layoutSettled === true && typeof doc.aid === 'string' &&
      doc._id === `${doc.aid}_layout_settled` &&
      Object.keys(doc).every(key => ['_id', 'type', 'aid', 'slateShareId', 'layoutSettled'].includes(key))
  },
})

// Collaboration.allow({
//   async insert(userId, doc) {
//     return hasPermission(userId, doc)
//   },
//   async update(userId, doc, fieldNames, modifier) {
//     return hasPermission(userId, doc)
//   },
//   async remove(userId, doc) {
//     return hasPermission(userId, doc)
//   },
// })


// No browser writes the slates collection. Content saves through the save core
// (server/slate-save-core.mjs) from methods and actions; settings through slates.updateSettings;
// a copy through slates.copy. With no allow rule, every client insert, update and remove is refused.

// Sharing changes run through owner-scoped server methods that update the board and grant atomically.

// Collaborators.allow({
//   async insert(userId, doc) {
//     return hasPermission(userId, doc)
//   },
//   async update(userId, doc, fieldNames, modifier) {
//     return hasPermission(userId, doc)
//   },
//   async remove(userId, doc) {
//     return hasPermission(userId, doc)
//   },
// })

Claims.allow({
  async insert(userId, doc) {
    return isMasterUser()
  },
  async update(userId, doc, fieldNames, modifier) {
    return isMasterUser()
  },
  async remove(userId, doc) {
    return isMasterUser()
  },
})

// A team's admin renames the team. Everything else about a team is the server's.
Organizations.allow({
  async update(userId, doc, fieldNames) {
    if (!signedIn(userId) || !onlyFields(fieldNames, ['name'])) return false
    const user = await Meteor.users.findOneAsync(userId, { fields: { orgId: 1 } })
    return Boolean(user?.orgId === doc._id && await AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin._id]))
  },
})

ApprovalRequests.allow({
  async insert(userId, doc) {
    return hasPermission(userId, doc)
  },
  async update(userId, doc, fieldNames, modifier) {
    return isMasterUser()
  },
  async remove(userId, doc) {
    return hasPermission(userId, doc)
  },
})

// Transcripts.allow({
//   async insert(userId, doc) {
//     return hasPermission(userId, doc)
//   },
//   async update(userId, doc, fieldNames, modifier) {
//     return hasPermission(userId)
//   },
//   async remove(userId, doc) {
//     return hasPermission(userId, doc)
//   },
// })
