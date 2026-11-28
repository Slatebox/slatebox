// Deleting slates removes what agents suggested on them (suggestions.mjs removeSuggestionsOn). Only
// the collections, so the methods that delete slates and accounts import it without the action
// layer (suggestions-meteor.js loads server/actions/mount).
import { MongoInternals } from 'meteor/mongo'
import { AgentSuggestions, Slates } from '../../imports/api/common/models'
import { removeSuggestionsOn } from './suggestions.mjs'

const controls = () => MongoInternals.defaultRemoteCollectionDriver().mongo.db.collection('agentSlateControls')

/**
 * The slates matching selector are about to be removed: every agent's suggestions on them (and
 * their agent controls) go with them. A database error reaches the caller, as the other rows do.
 */
export async function removeSuggestionsOfSlates(selector) {
  const ids = (await Slates.rawCollection().find(selector, { projection: { _id: 1 } }).toArray()).map((slate) => slate._id)
  return removeSuggestionsOn(ids, { suggestions: AgentSuggestions.rawCollection(), controls: controls() })
}
