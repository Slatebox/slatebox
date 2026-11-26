/* eslint-disable no-underscore-dangle */
// methods.js
import { randomBytes } from 'node:crypto'
import { Meteor } from 'meteor/meteor'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import CONSTANTS from '../../imports/api/common/constants'
import { GuestViews, SlateAccess } from '../../imports/api/common/models'
import collaboratorDetails, { relayParams } from '../common/collaborator-details.mjs'
import { relayAccess } from '../common/relay-access.mjs'
import { slateOpenStores } from './slates'

// Keys a person when the collaboration relay's key pair is not set up: made once per server, so a
// person's tabs still count once (collaborator-details.mjs).
const PROCESS_SECRET = randomBytes(32).toString('hex')

// Who may join a slate's room, and as what (relay-access.mjs): the slate's open rule for read,
// the canvas save's rule for write. The room is the slate's own id from its record.
const relayStores = {
  ...slateOpenStores,
  access: SlateAccess.rawCollection(),
  guestViews: GuestViews.rawCollection(),
}

const text = (value) => (typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined)

async function accessFor(user, { id, shareId, routeKey, readOnly } = {}) {
  return relayAccess(relayStores, {
    user: user || null,
    shareId: text(shareId),
    routeKey: text(routeKey),
    visitor: text(id),
    readOnly: readOnly === true,
  })
}

const method = {}
// A token is a credential: neither method logs its answer.
method[CONSTANTS.methods.collaborators.init] = async ({ id, shareId, routeKey, readOnly } = {}) => {
  const user = await Meteor.userAsync()
  return collaboratorDetails({
    user,
    userId: Meteor.userId(),
    id,
    shareId,
    settings: Meteor.settings,
    fallbackSecret: PROCESS_SECRET,
    access: await accessFor(user, { id, shareId, routeKey, readOnly }),
  })
}

// A fresh room token for the same slate, the access check run again (the engine asks before its
// token runs out and when the relay refuses it). Only the token: no legacy credential.
method[CONSTANTS.methods.collaborators.refresh] = async ({ id, shareId, routeKey, readOnly } = {}) => {
  const access = await accessFor(await Meteor.userAsync(), { id, shareId, routeKey, readOnly })
  const wsParams = relayParams({ settings: Meteor.settings, access, legacy: false })
  return {
    wsParams,
    relayCode: wsParams ? access.code : (access.code === 'ok' ? 'relay-off' : access.code),
    relayRole: wsParams ? access.role : null,
  }
}

Meteor.methods(method)

// A canvas asks once per slate it opens (and a slates page once per picture); a refresh comes
// about every 15 minutes per open slate.
const { init, refresh } = CONSTANTS.methods.collaborators
DDPRateLimiter.addRule({ type: 'method', name: init, connectionId: () => true }, 120, 60000)
DDPRateLimiter.addRule({ type: 'method', name: init, clientAddress: () => true }, 600, 60000)
DDPRateLimiter.addRule({ type: 'method', name: refresh, connectionId: () => true }, 30, 60000)
DDPRateLimiter.addRule({ type: 'method', name: refresh, clientAddress: () => true }, 300, 60000)
