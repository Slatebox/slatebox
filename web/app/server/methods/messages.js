// methods
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../imports/api/common/constants'
import { Messages, Slates } from '../../imports/api/common/models'

const method = {}

method[CONSTANTS.methods.messages.recreateMessagesForComment] = async (
  opts
) => {
  // { by: { commentId: editableComment._id }, set: { read: false, text: editableComment.text } }
  const updates = []
  if (opts.commentId) {
    updates.push(Messages.remove({ commentId: opts.commentId }))
    const user = Meteor.users.findOne({ _id: opts.userId })
    let userName = 'Guest'
    if (user) {
      userName = user?.emails[0].address
        ? ` ${user.emails[0].address.split('@')[0]}`
        : ''
      if (user.profile && user.profile.firstName) {
        userName = ` ${user.profile.firstName} ${user.profile.lastName}`
      }
    }
    const note = `[${
      Slates.findOne({ _id: opts.slateId }).options.name
    }] from ${userName}: ${opts.text}`
    opts.mentionedTeamMembers.forEach((u) => {
      updates.push(
        Messages.insert({
          timestamp: new Date().valueOf(),
          commentId: opts.commentId,
          userId: u,
          text: note,
          read: false,
          priority: 5,
          slateId: opts.slateId,
          nodeId: opts.nodeId,
          action: {
            type: CONSTANTS.messageActionTypes.slate,
            toolTip: `Go to the slate to reply to this comment`,
          },
        })
      )
    })

    return updates
  }
  return null
}

Meteor.methods(method)
