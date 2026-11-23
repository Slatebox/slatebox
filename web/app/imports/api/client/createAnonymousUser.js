import { Meteor } from 'meteor/meteor'
import CONSTANTS from '/imports/api/common/constants'

const createAnonymousUser = async ({ referralCode, creativeEditLink } = {}) =>
  new Promise(async (resolve, reject) => {
    try {
      // The server makes the guest and hands back a session token: a guest has no password.
      const { token } = creativeEditLink
        ? await Meteor.callAsync('creativeSlates.createGuest', creativeEditLink)
        : await Meteor.callAsync(CONSTANTS.methods.users.createAnonymous, referralCode ? { referralCode } : {})
      Meteor.loginWithToken(token, (err) => {
        if (err) reject(err)
        else resolve()
      })
    } catch (err) {
      console.error('error creating user', err)
      reject(err)
    }
  })
export default createAnonymousUser
