import { Meteor } from 'meteor/meteor';
import { CONSTANTS } from '/imports/api/common/constants.js';
import { promisify } from './promisify.js';

const createAnonymousUser = async (onComplete) => {
  return new Promise(async (resolve, reject) => {
    try {
      let email = await promisify(Meteor.call, CONSTANTS.methods.users.createAnonymous);
      Meteor.loginWithPassword(email, CONSTANTS.anonUserPwd, (err, data) => {
        resolve(null)
      });
    } catch (err) {
      console.log("error ", err);
      reject(err);
    }
  });
};
export { createAnonymousUser };