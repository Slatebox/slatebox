// methods.js
import { CONSTANTS } from '../../imports/api/common/constants.js';
import { SlateAccess } from '../../imports/api/common/models.js';
import { Meteor } from 'meteor/meteor';

let method = {};

method[CONSTANTS.methods.slateAccess.get] = async function (opts) {
  if (Meteor.user()) {
    let access = SlateAccess.find({ slateId: opts.id }).fetch();
    return access;
  }
  return [];
}

Meteor.methods(method);