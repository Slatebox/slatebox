// methods.js
import CONSTANTS from '../../imports/api/common/constants'
import SlateAccess from '../../imports/api/common/models'
import { Meteor } from 'meteor/meteor'

const method = {}

method[CONSTANTS.methods.slateAccess.get] = async (opts) => {
  if (Meteor.user()) {
    const access = SlateAccess.find({ slateId: opts.id }).fetch()
    return access
  }
  return []
}

Meteor.methods(method)
