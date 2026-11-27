// The Meteor side of the "Made with Slatebox" mark (core.mjs): madeWith.status for every shared page
// (signed in or not), madeWith.setHidden for a self-hosted server's administrator. Plain methods,
// not registry actions: nothing a token or an agent should change.
import { Meteor } from 'meteor/meteor'
import { check } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { SystemSettings } from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'
import { isCloudEdition } from '../../imports/api/common/edition.mjs'
import { MADE_WITH_ROW } from '../../imports/api/common/made-with.mjs'
import { isInstanceAdmin } from '../permissions'
import { createMadeWith, MadeWithError } from './core.mjs'

// Also read by the server-drawn embed page (apiHooks.js /embed/:shareId).
export const madeWith = createMadeWith({
  cloud: isCloudEdition(Meteor.settings),
  rows: {
    read: () => SystemSettings.findOneAsync({ _id: MADE_WITH_ROW }, { fields: { hidden: 1 } }),
    write: (fields) => SystemSettings.rawCollection().updateOne({ _id: MADE_WITH_ROW }, { $set: fields }, { upsert: true }),
  },
  isServerAdmin: (userId) => isInstanceAdmin(userId),
})

const asMeteor = (fn) =>
  async function wrapped(...args) {
    try {
      return await fn.apply(this, args)
    } catch (error) {
      if (error instanceof MadeWithError) throw new Meteor.Error(error.code, error.message)
      throw error
    }
  }

const M = CONSTANTS.methods.madeWith
Meteor.methods({
  [M.status]: asMeteor(async function status() {
    return madeWith.status(this.userId)
  }),
  [M.setHidden]: asMeteor(async function setHidden(hidden) {
    check(hidden, Boolean)
    return madeWith.setHidden(this.userId, hidden)
  }),
})

DDPRateLimiter.addRule({ type: 'method', name: M.status, connectionId: () => true }, 60, 60 * 1000)
DDPRateLimiter.addRule({ type: 'method', name: M.setHidden, connectionId: () => true }, 10, 60 * 1000)
