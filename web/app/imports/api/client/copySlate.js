import { Meteor } from 'meteor/meteor'
import createAnonymousUser from './createAnonymousUser'

// Copy a slate the visitor can open into a new private slate of theirs. The server builds and
// stores the copy (the slates.copy action); a visitor without an account gets a guest account
// first. Answers the copy's share id.
const copySlate = async (shareId, { keepTemplate = false, fromTemplate = false, name, projectName } = {}) => {
  if (!Meteor.user()) await createAnonymousUser()
  const copied = await Meteor.callAsync('slates.copy', {
    shareId,
    keepTemplate,
    fromTemplate,
    ...(name && { name }),
    ...(projectName && { projectName }),
  })
  return copied.shareId
}

export default copySlate
