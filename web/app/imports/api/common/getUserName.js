import { Meteor } from 'meteor/meteor';

//should be client only
const getUserName = (userId) => {
  let user = Meteor.users.findOne({ _id: userId });
  if (!user || user?.isAnonymous) {
    return 'Guest'
  } else if (user?.profile?.firstName) {
    return `${user?.profile?.firstName} ${user?.profile?.lastName}`.replace(/undefined/gi, "");
   } else {
    return user?.emails[0].address.split('@')[0];
   }
}

export { getUserName };