// What an account keeps outside its slates, removed with the account on every path that removes
// one: users.delete (methods/users.js keeps its own copy of this list, with the refund first), a
// team owner deleting their team (methods/organizations.js) and an admin removing a member
// (methods/team-member-slates.js). The delete-account page on slatebox.com promises these go.
// About you (removePersonalData) is removed by each path itself, before the account goes.
import {
  AIChoices,
  ProviderKeys,
  SlateApiTokens,
  SlateOperationRuns,
  SlatePresentationConversations,
  SlatePresentations,
} from '../../imports/api/common/models'
import { JoinedSlates } from './joined-slates'
import { removePasskeysOf } from '../passkeys/meteor'

export async function removeAccountRows(userId) {
  const owner = { userId }
  await JoinedSlates.removeAsync(userId)
  await SlateApiTokens.removeAsync(owner)
  await SlateOperationRuns.removeAsync(owner)
  // every presentation they made (a deck keeps a copy of the slate and its pictures) and its chat
  await SlatePresentations.removeAsync(owner)
  await SlatePresentationConversations.removeAsync(owner)
  // their own AI connections, keys and choices
  await ProviderKeys.removeAsync({ ownerType: 'user', ownerId: userId })
  await AIChoices.removeAsync({ _id: 'user:' + userId })
  await removePasskeysOf(userId)
}
