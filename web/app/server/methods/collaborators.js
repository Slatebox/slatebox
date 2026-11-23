/* eslint-disable no-underscore-dangle */
// methods.js
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../imports/api/common/constants'
import { collabCredential } from '../common/api-signature.mjs'
import { personKeyFor } from '../common/person-key.mjs'
import { guestNameFor, personCursorColour } from '../../imports/api/common/guest-name.mjs'

const method = {}
method[CONSTANTS.methods.collaborators.init] = async ({ id, shareId } = {}) => {
  // The relay's credential is signed with the Slatebox API key over a stamp that is never an ISO
  // instant, so it cannot be replayed as a signed HTTP hook request (api-signature.mjs).
  const { publicKey, secretKey } = Meteor.settings.slateboxAPI
  const signature = collabCredential({ publicKey, secretKey })
  let user = await Meteor.userAsync()

  user = user || {
    _id: 'guest',
    isAnonymous: true,
  }
  /*
   await Meteor.users.findOneAsync(opts.userId) || {
    _id: 'guest',
    isAnonymous: true,
  }
  */
  // A visitor browsing an unlisted or public slate may have no user at all.
  const { isAnonymous } = user
  // Each of a person's tabs on this slate gets the same key, colour and name, so peers count them
  // once and every viewer (and every pointer on the canvas) calls them the same.
  const personKey = personKeyFor({
    userId: Meteor.userId(),
    visitorId: typeof id === 'string' ? id.slice(0, 64) : '',
    slate: typeof shareId === 'string' ? shareId.slice(0, 64) : '',
  }, secretKey)
  const accountName = isAnonymous ? '' : (user.profile?.firstName
    ? `${user.profile.firstName} ${user.profile.lastName || ''}`.trim()
    : user.emails?.[0]?.address?.split('@')[0])
  return {
    isAnonymous,
    userName: accountName || guestNameFor(personKey),
    personKey,
    wsUrl: Meteor.settings.public.wsUrl,
    wsParams: {
      bearer: signature.bearer,
      timestamp: signature.timestamp,
    },
    // The person's own colour, from their key; never one an agent's pointer uses (agent-colors.mjs):
    // near one, the same hue is tried darker, so a guest's name still says its colour and it reads on white.
    color: personCursorColour(personKey),
  }
}

Meteor.methods(method)
