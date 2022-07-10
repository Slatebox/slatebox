import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import setup from './email/setup'
import './bootstrap/all'

Meteor.startup(() => {
  // setup mail
  setup()

  // swallow debug messages
  Meteor._debug = (function (superMeteorDebug) {
    return function (error, info) {
      if (error !== 'discarding unknown livedata message type') {
        superMeteorDebug(error, info)
      }
    }
  })(Meteor._debug)

  Accounts.onCreateUser((suggested, user) => {
    const muser = user
    muser.isAnonymous = suggested.isAnonymous || false
    if (suggested.orgId) {
      muser.orgId = suggested.orgId
    }
    if (suggested.userName) muser.userName = suggested.userName
    if (suggested.profile) muser.profile = suggested.profile
    if (suggested.isDemo) muser.isDemo = suggested.isDemo
    return muser
  })
})
