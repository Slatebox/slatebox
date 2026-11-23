// The Meteor side of OAuth for the hosted MCP endpoint: the collections, the MCP SDK's handlers
// (loaded the way mcp/meteor.js loads the SDK), the routes, and the two methods the consent page
// (/oauth/consent) calls. Only a signed-in, non-guest account may answer a request.
import express from 'express'
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { check, Match } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { SlateApiTokens } from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'
import { clientAddress } from '../actions/http.mjs'
import { registry } from '../actions/mount'
import { createOAuthCore, REQUEST_ID } from './core.mjs'
import { mountOAuth as mount } from './routes.mjs'

/* eslint-disable camelcase, no-undef */
const load = createRequire(
  typeof __meteor_bootstrap__ === 'undefined'
    ? join(process.cwd(), 'package.json')
    : join(__meteor_bootstrap__.serverDir, 'npm', 'package.json')
)
/* eslint-enable camelcase, no-undef */

export const OAuthClients = new Mongo.Collection('oauthClients')
export const OAuthRequests = new Mongo.Collection('oauthRequests')
export const OAuthCodes = new Mongo.Collection('oauthCodes')
// Rotated refresh tokens, by hash only, until the connection they belonged to could have lapsed.
export const OAuthRefreshFamily = new Mongo.Collection('oauthRefreshFamily')

export const appOrigin = () => Meteor.settings.public?.baseUrl || Meteor.absoluteUrl()

export const oauth = createOAuthCore({
  clients: OAuthClients,
  requests: OAuthRequests,
  codes: OAuthCodes,
  refreshFamily: OAuthRefreshFamily,
  apiTokens: SlateApiTokens,
  users: Meteor.users,
  origin: appOrigin(),
  errors: load('@modelcontextprotocol/sdk/server/auth/errors.js'),
})

export function mountOAuth(app) {
  const forwardedCount = Number.parseInt(process.env.HTTP_FORWARDED_COUNT, 10) || 0
  // express-rate-limit is the SDK's own dependency: load it the way the SDK's handlers do.
  const { ipKeyGenerator } = createRequire(load.resolve('@modelcontextprotocol/sdk/server/auth/handlers/token.js'))('express-rate-limit')
  mount(app, {
    express,
    core: oauth,
    // What the metadata advertises: every scope a tool needs, from the actions.
    scopes: registry.neededScopes(),
    handlers: {
      authorizationHandler: load('@modelcontextprotocol/sdk/server/auth/handlers/authorize.js').authorizationHandler,
      tokenHandler: load('@modelcontextprotocol/sdk/server/auth/handlers/token.js').tokenHandler,
      clientRegistrationHandler: load('@modelcontextprotocol/sdk/server/auth/handlers/register.js').clientRegistrationHandler,
      revocationHandler: load('@modelcontextprotocol/sdk/server/auth/handlers/revoke.js').revocationHandler,
      metadataHandler: load('@modelcontextprotocol/sdk/server/auth/handlers/metadata.js').metadataHandler,
    },
    // The SDK's limits, counted by the caller's own address (behind the proxies, as /api/v1 counts).
    rateLimit: {
      keyGenerator: (req) => ipKeyGenerator(clientAddress(req, forwardedCount) || 'unknown'),
      validate: { trustProxy: false, xForwardedForHeader: false },
    },
  })
}

Meteor.startup(async () => {
  await Promise.all([
    // Requests and codes are short-lived; Mongo drops them at purgeAt (core.mjs).
    OAuthRequests.rawCollection().createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
    OAuthCodes.rawCollection().createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
    OAuthRefreshFamily.rawCollection().createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
    OAuthRefreshFamily.rawCollection().createIndex({ tokenId: 1 }),
    SlateApiTokens.rawCollection().createIndex({ refreshHash: 1 }, { unique: true, partialFilterExpression: { refreshHash: { $type: 'string' } } }),
    SlateApiTokens.rawCollection().createIndex({ refreshHashPrev: 1 }, { partialFilterExpression: { refreshHashPrev: { $type: 'string' } } }),
    SlateApiTokens.rawCollection().createIndex({ codeHash: 1 }, { partialFilterExpression: { codeHash: { $type: 'string' } } }),
  ]).catch((error) => console.error('oauth indexes', error)) // eslint-disable-line no-console
})

const currentUser = (userId) => (userId ? Meteor.users.findOneAsync(userId, { fields: { _id: 1, isAnonymous: 1 } }) : null)

Meteor.methods({
  // What the consent page shows, or null when the request is unknown, decided or lapsed.
  async [CONSTANTS.methods.oauth.describe]({ requestId }) {
    check(requestId, String)
    if (!REQUEST_ID.test(requestId)) return null
    return oauth.describeRequest(requestId)
  },
  // The person's answer: returns { redirectTo }, the address the browser goes to next.
  async [CONSTANTS.methods.oauth.decide]({ requestId, allow, scopes }) {
    check(requestId, String)
    check(allow, Boolean)
    check(scopes, Match.Maybe([String]))
    try {
      return await oauth.decide({ requestId, user: await currentUser(this.userId), allow, scopes })
    } catch (error) {
      if (error.code) throw new Meteor.Error(error.code, error.message)
      throw error
    }
  },
})

// Twenty answers a minute per connection: enough for a person, not for guessing request ids.
;[CONSTANTS.methods.oauth.describe, CONSTANTS.methods.oauth.decide].forEach((name) =>
  DDPRateLimiter.addRule({ type: 'method', name, connectionId: () => true }, 20, 60 * 1000)
)
