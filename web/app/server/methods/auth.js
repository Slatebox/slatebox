import { Meteor } from 'meteor/meteor'

import { hookSignatureIsValid } from '../common/api-signature.mjs'
import CONSTANTS from '../../imports/api/common/constants'

const method = {}

// The signed-request check for the HTTP hooks. It is a plain function so callers await it:
// Meteor.call on an async method returns a promise, which is always truthy. A collaboration
// relay credential never passes it (server/common/api-signature.mjs).
export async function isApiSignatureValid({ bearer, dateString } = {}) {
  const { publicKey, secretKey } = Meteor.settings.slateboxAPI || {}
  return hookSignatureIsValid({ publicKey, secretKey, bearer, dateString })
}

// The signed passthrough route in the browser asks whether its link is valid.
method[CONSTANTS.methods.auth.isAuthenticated] = async ({ bearer, dateString } = {}) =>
  isApiSignatureValid({ bearer, dateString })

Meteor.methods(method)
