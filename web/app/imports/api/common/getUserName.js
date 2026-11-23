import { Meteor } from 'meteor/meteor'

// should be client only
const getExternalUserName = async (userId) => {
  const user = await Meteor.users.findOneAsync({ _id: userId })
  let userName = ''
  if (!user || user.isAnonymous === true) {
    userName = 'Guest'
  } else if (user?.profile?.firstName) {
    userName = `${user?.profile?.firstName} ${user?.profile?.lastName}`.replace(
      /undefined/gi,
      ''
    )
  } else {
    userName = user?.emails?.[0]?.address?.split('@')[0] || 'Guest'
  }

  return userName.length > 10 ? `${userName.substring(0, 10)}...` : userName
}

// should be client only
const getUserName = () => {
  const user = Meteor.user()
  let userName = ''
  if (!user || user.isAnonymous === true) {
    userName = 'Guest'
  } else if (user?.profile?.firstName) {
    userName = `${user?.profile?.firstName} ${user?.profile?.lastName}`.replace(
      /undefined/gi,
      ''
    )
  } else {
    userName = user?.emails?.[0]?.address?.split('@')[0] || 'Guest'
  }

  return userName.length > 10 ? `${userName.substring(0, 10)}...` : userName
}

export { getUserName, getExternalUserName }
export default getUserName
