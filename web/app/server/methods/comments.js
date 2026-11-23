// methods
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import CONSTANTS from '../../imports/api/common/constants'
import { Comments, Messages } from '../../imports/api/common/models'
import { canCommentSlate, canEditSlate, findSlate } from '../common/slate-access'

const method = {}

// Resolving the comments on a note is for anyone who may comment there: the slate's comment role.
// (Posting a comment is the comments.add action, server/actions/comments.mjs.)
method[CONSTANTS.methods.comments.toggleResolve] = async function toggleResolve(opts) {
  check(opts, Match.ObjectIncluding({ slateId: String, nodeId: String, resolved: Boolean }))
  if (!this.userId || !await canCommentSlate(this.userId, await findSlate({ slateId: opts.slateId }))) return null
  return Comments.updateAsync(
    { slateId: opts.slateId, nodeId: opts.nodeId },
    { $set: { resolved: opts.resolved } },
    { multi: true }
  )
}

// A person removes their own comment; whoever may edit the slate removes all of a note's comments,
// and any one reply of the Slatebox agent.
method[CONSTANTS.methods.comments.remove] = async function removeComments(opts) {
  check(opts, Match.OneOf(
    Match.ObjectIncluding({ slateId: String, nodeId: String }),
    Match.ObjectIncluding({ commentId: String }),
  ))
  if (!this.userId) return { removeComments: 0, removeMessages: 0 }
  if (opts.commentId) {
    const agentReply = await Comments.findOneAsync({ _id: opts.commentId, createdByUserId: 'slatebox-agent', fromAgent: true }, { fields: { slateId: 1 } })
    const mayRemove = agentReply && await canEditSlate(this.userId, await findSlate({ slateId: agentReply.slateId }))
    const removeComments = await Comments.removeAsync(mayRemove ? { _id: opts.commentId } : { _id: opts.commentId, createdByUserId: this.userId })
    const removeMessages = removeComments ? await Messages.removeAsync({ commentId: opts.commentId }) : 0
    return { removeComments, removeMessages }
  }
  if (!await canEditSlate(this.userId, await findSlate({ slateId: opts.slateId }))) return { removeComments: 0, removeMessages: 0 }
  const removeComments = await Comments.removeAsync({ slateId: opts.slateId, nodeId: opts.nodeId })
  const removeMessages = await Messages.removeAsync({ slateId: opts.slateId, nodeId: opts.nodeId })
  return { removeComments, removeMessages }
}

Meteor.methods(method)
