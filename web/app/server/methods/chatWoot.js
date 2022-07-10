/* eslint-disable no-inner-declarations */
// methods.js
import { Meteor } from 'meteor/meteor'
import CryptoJS from 'crypto-js'
import CONSTANTS from '../../imports/api/common/constants'

const method = {}

method[CONSTANTS.methods.chatWoot.identifyUser] = async () => {
  // console.log("calling chatwoot identity", Meteor.userId());
  if (Meteor.userId() && Meteor.settings.chatWoot.userIdentityValidationToken) {
    const hash = CryptoJS.HmacSHA256(
      Meteor.userId(),
      Meteor.settings.chatWoot.userIdentityValidationToken
    ).toString(CryptoJS.enc.Hex)
    return hash
  }
  return null
}

Meteor.methods(method)
