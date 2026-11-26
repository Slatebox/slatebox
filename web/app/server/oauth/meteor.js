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
import { cloudOn } from '../cloud-lock-meteor'
import { createOAuthCore, REQUEST_ID } from './core.mjs'
import { createDeviceFlow, createWindowCounter, DeviceError, teamClaimsConfigured } from './device.mjs'
import { mountOAuth as mount } from './routes.mjs'
import { licenseIssuerConfigured } from '../licenses/issuer.mjs'

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

// Device-code sign-in (device.mjs): grants by hash only, and the counters its limits use.
export const OAuthDeviceGrants = new Mongo.Collection('oauthDeviceGrants')
const OAuthDeviceCounters = new Mongo.Collection('oauthDeviceCounters')

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

// Offered only on Slatebox Cloud: team addresses where the claim service is set up, moves
// (team:export and team:move for `slatebox migrate` / `import --from cloud`, and a self-hosted
// server's own Move to Slatebox Cloud) everywhere on Cloud, and enterprise license keys for
// self-hosted servers where Cloud holds the signing key (server/licenses).
export const device = createDeviceFlow({
  grants: OAuthDeviceGrants,
  apiTokens: SlateApiTokens,
  users: Meteor.users,
  origin: appOrigin(),
  counter: createWindowCounter({ collection: OAuthDeviceCounters.rawCollection() }),
  enabled: (purpose) => cloudOn() && (purpose === 'move' || (purpose === 'license' ? licenseIssuerConfigured(Meteor.settings) : teamClaimsConfigured(Meteor.settings))),
  pepper: Meteor.settings.cloudflare?.teamClaims?.auditPepper || 'slatebox-device',
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
    device,
    address: (req) => clientAddress(req, forwardedCount),
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
    OAuthDeviceGrants.rawCollection().createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
    OAuthDeviceGrants.rawCollection().createIndex({ deviceHash: 1 }, { unique: true }),
    OAuthDeviceGrants.rawCollection().createIndex({ userCodeHash: 1, status: 1 }),
    OAuthDeviceCounters.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    SlateApiTokens.rawCollection().createIndex({ refreshHash: 1 }, { unique: true, partialFilterExpression: { refreshHash: { $type: 'string' } } }),
    SlateApiTokens.rawCollection().createIndex({ refreshHashPrev: 1 }, { partialFilterExpression: { refreshHashPrev: { $type: 'string' } } }),
    SlateApiTokens.rawCollection().createIndex({ codeHash: 1 }, { partialFilterExpression: { codeHash: { $type: 'string' } } }),
  ]).catch((error) => console.error('oauth indexes', error)) // eslint-disable-line no-console
})

const currentUser = (userId) => (userId ? Meteor.users.findOneAsync(userId, { fields: { _id: 1, isAnonymous: 1 } }) : null)

const deviceCall = async (fn) => {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof DeviceError) throw new Meteor.Error(error.error, error.message)
    throw error
  }
}

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
  // /device: what a code asks for (null when it is unknown, used or lapsed), and the person's answer.
  async [CONSTANTS.methods.oauth.deviceDescribe]({ userCode }) {
    check(userCode, String)
    return deviceCall(async () => device.describe({ userCode, user: await currentUser(this.userId) }))
  },
  async [CONSTANTS.methods.oauth.deviceDecide]({ userCode, allow }) {
    check(userCode, String)
    check(allow, Boolean)
    return deviceCall(async () => device.decide({ userCode, user: await currentUser(this.userId), allow }))
  },
  // After "Approve": what the command did with it (a team address claimed, or refused and why).
  async [CONSTANTS.methods.oauth.deviceOutcome]({ grant }) {
    check(grant, String)
    return deviceCall(async () => device.outcome({ grant, user: await currentUser(this.userId) }))
  },
})

// Twenty answers a minute per connection: enough for a person, not for guessing request ids.
;[CONSTANTS.methods.oauth.describe, CONSTANTS.methods.oauth.decide, CONSTANTS.methods.oauth.deviceDescribe, CONSTANTS.methods.oauth.deviceDecide].forEach((name) =>
  DDPRateLimiter.addRule({ type: 'method', name, connectionId: () => true }, 20, 60 * 1000)
)
// The page asks every two seconds while it waits for the outcome.
DDPRateLimiter.addRule({ type: 'method', name: CONSTANTS.methods.oauth.deviceOutcome, connectionId: () => true }, 60, 60 * 1000)
