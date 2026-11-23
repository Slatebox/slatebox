/* eslint-disable no-inner-declarations */
// methods.js
import { Meteor } from 'meteor/meteor'
import CryptoJS from 'crypto-js'
import CONSTANTS from '../../imports/api/common/constants'

const method = {}

method[CONSTANTS.methods.chatWoot.identifyUser] = async () => {
  // Per-env kill switch (test runs public.chatWoot.enabled=false: the widget
  // must never identify there — all guests shared one anonymous Chatwoot
  // contact). Also fixes the crash class: settings had NO chatWoot block, so
  // the unguarded property read threw a TypeError on every logged-in load,
  // setUser never ran, and every visitor collapsed to the same anonymous
  // contact (the shared-transcript mechanism, ledger iter25/30).
  if (Meteor.settings?.public?.chatWoot?.enabled === false) return null
  const token = Meteor.settings?.chatWoot?.userIdentityValidationToken
  if (Meteor.userId() && token) {
    const hash = CryptoJS.HmacSHA256(
      Meteor.userId(),
      token
    ).toString(CryptoJS.enc.Hex)
    return hash
  }
  return null
}

Meteor.methods(method)
