// The Meteor side of agent presence: the collection, its key and indexes, and the store the
// action layer, exec and the in-app conversation write through.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { randomBytes } from 'node:crypto'
import { AgentPresence, SlateApiTokens } from '../../imports/api/common/models'
import { createAgentPresence } from './agentPresence.mjs'

// One HMAC key per instance, shared by every app process: made once, kept in the database.
const PresenceKeys = new Mongo.Collection('agentPresenceKeys')
async function presenceSecret() {
  const fromSettings = process.env.SLATEBOX_PRESENCE_SECRET || Meteor.settings.private?.presenceSecret
  if (fromSettings) return fromSettings
  await PresenceKeys.rawCollection().updateOne(
    { _id: 'agentKey' },
    { $setOnInsert: { key: randomBytes(32).toString('hex'), createdAt: new Date() } },
    { upsert: true }
  )
  return (await PresenceKeys.rawCollection().findOne({ _id: 'agentKey' })).key
}

export const presence = createAgentPresence({
  collection: AgentPresence.rawCollection(),
  findUser: (userId) => Meteor.users.findOneAsync(userId, { fields: { profile: 1, emails: 1 } }),
  findToken: (tokenId) => SlateApiTokens.findOneAsync({ _id: tokenId }, { fields: { lastClient: 1 } }),
  secret: presenceSecret,
})

Meteor.startup(async () => {
  await presence.ensureIndexes()
})
