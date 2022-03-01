import { Meteor } from 'meteor/meteor'
import CONSTANTS from '/imports/api/common/constants'
import promisify from './promisify'

const createAnonymousUser = async () =>
  new Promise(async (resolve, reject) => {
    try {
      const email = await promisify(
        Meteor.call,
        CONSTANTS.methods.users.createAnonymous
      )
      Meteor.loginWithPassword(email, CONSTANTS.anonUserPwd, () => {
        resolve(null)
      })
    } catch (err) {
      console.error('error creating user', err)
      reject(err)
    }
  })
export default createAnonymousUser
