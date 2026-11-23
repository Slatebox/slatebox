// methods
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import CONSTANTS from '../../imports/api/common/constants'
import { Comments, Messages } from '../../imports/api/common/models'
import { canEditSlate, canReadSlate, findSlate } from '../common/slate-access'

const method = {}

// Resolving the comments on a note is for anyone who may comment there: the slate is readable.
method[CONSTANTS.methods.comments.toggleResolve] = async function toggleResolve(opts) {
  check(opts, Match.ObjectIncluding({ slateId: String, nodeId: String, resolved: Boolean }))
  if (!this.userId || !await canReadSlate(this.userId, await findSlate({ slateId: opts.slateId }))) return null
  return Comments.updateAsync(
    { slateId: opts.slateId, nodeId: opts.nodeId },
    { $set: { resolved: opts.resolved } },
    { multi: true }
  )
}

// A person removes their own comment; whoever may edit the slate removes all of a note's comments.
method[CONSTANTS.methods.comments.remove] = async function removeComments(opts) {
  check(opts, Match.OneOf(
    Match.ObjectIncluding({ slateId: String, nodeId: String }),
    Match.ObjectIncluding({ commentId: String }),
  ))
  if (!this.userId) return { removeComments: 0, removeMessages: 0 }
  if (opts.commentId) {
    const removeComments = await Comments.removeAsync({ _id: opts.commentId, createdByUserId: this.userId })
    const removeMessages = removeComments ? await Messages.removeAsync({ commentId: opts.commentId }) : 0
    return { removeComments, removeMessages }
  }
  if (!await canEditSlate(this.userId, await findSlate({ slateId: opts.slateId }))) return { removeComments: 0, removeMessages: 0 }
  const removeComments = await Comments.removeAsync({ slateId: opts.slateId, nodeId: opts.nodeId })
  const removeMessages = await Messages.removeAsync({ slateId: opts.slateId, nodeId: opts.nodeId })
  return { removeComments, removeMessages }
}

Meteor.methods(method)
