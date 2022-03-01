import { Meteor } from 'meteor/meteor'

// should be client only
const getUserName = (userId) => {
  const user = Meteor.users.findOne({ _id: userId })
  if (!user || user.isAnonymous === true) {
    return 'Guest'
  }
  if (user?.profile?.firstName) {
    return `${user?.profile?.firstName} ${user?.profile?.lastName}`.replace(
      /undefined/gi,
      ''
    )
  }
  return user?.emails[0].address.split('@')[0]
}

export default getUserName
