// The Meteor side of agent suggestions: the collections, the store the actions use
// (deps.suggestions) and whether people may let an agent edit directly (deps.agentOptions).
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { Mongo } from 'meteor/mongo'
import { AgentSuggestions } from '../../imports/api/common/models'
import { firstNameOf } from '../../imports/api/common/agent-label.mjs'
import { editDirectlyEnabled } from '../../imports/api/common/agent-settings.mjs'
import { deps } from '../actions/mount'
import { presence } from '../presence/meteor'
import { createSuggestionStore } from './suggestions.mjs'

export const AgentSlateControls = new Mongo.Collection('agentSlateControls')

export const suggestions = createSuggestionStore({
  collection: AgentSuggestions.rawCollection(),
  controls: AgentSlateControls.rawCollection(),
  identify: presence.identify,
  // Keeping and undoing always pass the edit path of the call they are part of (agent-suggestions.mjs).
  applyPlan: async () => {
    throw new Error('suggestions: keep and undo save through the action that asked')
  },
  findName: async (userId) => firstNameOf(await Meteor.users.findOneAsync(userId, { fields: { profile: 1, emails: 1 } })),
  newId: () => Random.id(17),
})

deps.suggestions = suggestions
deps.agentOptions = { editDirectly: () => editDirectlyEnabled(Meteor.settings) }

Meteor.startup(async () => {
  await suggestions.ensureIndexes()
})
