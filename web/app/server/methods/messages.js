/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
// methods
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import CONSTANTS from '../../imports/api/common/constants'
import { Comments, Messages, Slates } from '../../imports/api/common/models'

const method = {}

// After its author edits a comment, the mention messages are made again from the stored comment:
// the recipients are the teammates it names, the text is its text.
method[CONSTANTS.methods.messages.recreateMessagesForComment] = async function recreateMessagesForComment(opts) {
  check(opts, Match.ObjectIncluding({ commentId: String, text: Match.Maybe(String) }))
  const author = this.userId && await Meteor.users.findOneAsync(this.userId, { fields: { orgId: 1, profile: 1, emails: 1 } })
  if (!author) return null
  const comment = await Comments.findOneAsync({ _id: opts.commentId, createdByUserId: author._id })
  if (!comment) return null
  await Messages.removeAsync({ commentId: comment._id })
  const named = Array.isArray(comment.mentionedTeamMembers) ? comment.mentionedTeamMembers.filter((id) => typeof id === 'string') : []
  const recipients = author.orgId && named.length
    ? await Meteor.users.find({ _id: { $in: named }, orgId: author.orgId }, { fields: { _id: 1 } }).fetchAsync()
    : []
  let userName = author.emails?.[0]?.address ? ` ${author.emails[0].address.split('@')[0]}` : ''
  if (author.profile?.firstName) userName = ` ${author.profile.firstName} ${author.profile.lastName}`
  const slateName = (await Slates.findOneAsync({ _id: comment.slateId }, { fields: { 'options.name': 1 } }))?.options?.name || 'a slate'
  const text = typeof opts.text === 'string' ? opts.text.slice(0, 5000) : comment.text
  const note = `[${slateName}] from ${userName}: ${text}`
  const updates = []
  for (const u of recipients) {
    updates.push(await Messages.insertAsync({
      timestamp: new Date().valueOf(),
      commentId: comment._id,
      userId: u._id,
      text: note,
      read: false,
      priority: 5,
      slateId: comment.slateId,
      nodeId: comment.nodeId,
      type: CONSTANTS.messageTypes.system,
      action: {
        type: CONSTANTS.messageActionTypes.slate,
        toolTip: `Go to the slate to reply to this comment`,
      },
    }))
  }
  return updates
}

Meteor.methods(method)
