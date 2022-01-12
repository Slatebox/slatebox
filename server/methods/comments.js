// methods.js
import { CONSTANTS } from '../../imports/api/common/constants.js';
import { Comments, Messages } from '../../imports/api/common/models.js';
import { Meteor } from 'meteor/meteor';

let method = {};

method[CONSTANTS.methods.comments.toggleResolve] = async function (opts) {
  if (Meteor.user() && opts.slateId && opts.nodeId) {
    let update = Comments.update({ slateId: opts.slateId, nodeId: opts.nodeId }, { $set: { resolved: opts.resolved } }, { multi: true });
    return update;
  }
  return null;
}

method[CONSTANTS.methods.comments.remove] = async function (opts) {
  let removeComments = {};
  let removeMessages = {};
  if (Meteor.user() && opts.slateId && opts.nodeId) {
    removeComments = Comments.remove({ slateId: opts.slateId, nodeId: opts.nodeId });
    removeMessages = Messages.remove({ slateId: opts.slateId, nodeId: opts.nodeId });
  } else if (opts.commentId) {
    //can be done via a guest
    removeComments = Comments.remove({ _id: opts.commentId });
    removeMessages = Messages.remove({ commentId: opts.commentId });
  }
  return { removeComments, removeMessages };
}

Meteor.methods(method);