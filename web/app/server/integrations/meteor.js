// The Meteor side of account-removal.mjs: the app's own Mongo database, by collection name (the
// integration collections are defined by enterprise code, which may not run here).
import { MongoInternals } from 'meteor/mongo'
import { removeIntegrationsOf } from './account-removal.mjs'

const collection = (name) => MongoInternals.defaultRemoteCollectionDriver().mongo.db.collection(name)

/** Every integration row a person owns, revoked at its vendor first where enterprise code runs. */
// eslint-disable-next-line import/prefer-default-export
export const removeIntegrationsOfAccount = (userId) => removeIntegrationsOf(userId, { collection })
