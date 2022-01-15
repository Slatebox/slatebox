// methods.js
import { CONSTANTS } from '../../imports/api/common/constants.js';
import { Messages, Slates } from '../../imports/api/common/models.js';
import { Meteor } from 'meteor/meteor';

let method = {};

method[CONSTANTS.methods.messages.recreateMessagesForComment] = async function (opts) {
  //{ by: { commentId: editableComment._id }, set: { read: false, text: editableComment.text } }
  const updates = [];
  if (opts.commentId) {
    console.log("Will remove messages by commentId ", opts.commentId);
    updates.push(Messages.remove({ commentId: opts.commentId }));
    let user = Meteor.users.findOne({ _id: opts.userId });
    let userName = "Guest";
    if (user) {
      userName = user?.emails[0].address ? " " + user.emails[0].address.split("@")[0] : "";
      if (user.profile && user.profile.firstName) {
        userName = ` ${user.profile.firstName} ${user.profile.lastName}`;
      }
    }
    const note = `[${Slates.findOne({ _id: opts.slateId }).options.name}] from ${userName}: ${opts.text}`;
    opts.mentionedTeamMembers.forEach(u => {
      updates.push(Messages.insert({ timestamp: new Date().valueOf(), commentId: opts.commentId, userId: u, text: note, read: false, priority: 5, slateId: opts.slateId, nodeId: opts.nodeId, action: { type: CONSTANTS.messageActionTypes.slate, toolTip: `Go to the slate to reply to this comment` } }));
    });

    console.log("updates are ", updates);

    return updates;
  }
  return null;
}

Meteor.methods(method);