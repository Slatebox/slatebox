// Meteor glue for the AI settings (ai-settings-core.mjs): the stores, who is an administrator or
// a team admin, and the guarded fetch every connection uses. The actions ai.get, ai.update and
// ai.check (server/actions) and every AI path (req.js, stabilityai.js, the meter) use this one
// instance.
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import CONSTANTS from '../../../imports/api/common/constants'
import { AIChoices, Permissions, ProviderKeys } from '../../../imports/api/common/models'
import { loadMasterKey } from '../../metering/vault.mjs'
import { currentAIAction } from '../../metering/context.mjs'
import { createAISettings } from './ai-settings-core.mjs'
import { MAX_CHECK_RESPONSE_BYTES, assertEndpointHost, connectionFetch } from './endpoint-policy.mjs'
import { checkAuxConnection } from '../../ai-control/aux-check.mjs'
import { createConnectionStore } from './connection-store.mjs'
import { checkConnection, listModels } from './connection-check.mjs'
import { operatorConfig } from './connections.mjs'
import { selfHosted } from '../../../imports/api/common/own-keys.mjs'
import { isInstanceAdmin } from '../../permissions'

// Slatebox Cloud (any env but 'selfhost', own-keys.mjs): people and teams bring no AI of their own.
export const hosted = !selfHosted(Meteor.settings)

// A wrong ai section in the settings stops the start with a plain message, before anything is sent.
operatorConfig(Meteor.settings)

// providerKeys and aiChoices through one store (connection-store.mjs), the same code the
// real-database test runs
const store = createConnectionStore({ keys: ProviderKeys.rawCollection(), choices: AIChoices.rawCollection(), newId: () => Random.id() })

// Every request to a connection connects through a lookup that applies the endpoint rules, and
// follows no redirect (endpoint-policy.mjs connectionFetch).
// Every answer is read up to a cap (endpoint-policy.mjs MAX_CONNECTION_RESPONSE_BYTES); Test
// connection reads less.
export const guardedFetch = (rules, options) => (url, init) => connectionFetch(String(url), rules, undefined, options)(url, init)

// An administrator of this server (the uberMensch claim, permissions.js isInstanceAdmin): the one
// who changes the server's AI.
export const isServerAdmin = (userId) => isInstanceAdmin(userId)

// Where changes are recorded: the AI control audit trail, set by ai-control/index.mjs once its
// store exists (it imports this file, so it hands the store in rather than this file importing it).
let auditSink = null
export const setAISettingsAudit = (record) => {
  auditSink = record
}

export const aiSettings = createAISettings({
  store,
  master: loadMasterKey(process.env),
  settings: Meteor.settings,
  hosted,
  loadUser: (id) => Meteor.users.findOneAsync(id, { fields: { orgId: 1, isAnonymous: 1 } }),
  isAdmin: isServerAdmin,
  isTeamAdmin: async (user) => Boolean(user?.orgId && await Permissions.findOneAsync({ userId: user._id, orgId: user.orgId, claimId: CONSTANTS.claims.admin._id }, { fields: { _id: 1 } })),
  check: (connection, rules) => checkConnection(connection, { fetch: guardedFetch(rules, { maxBytes: MAX_CHECK_RESPONSE_BYTES }) }),
  // ai.models.discover: a provider's model list can be long (the default cap of an answer applies)
  listModels: (connection, rules) => listModels(connection, { fetch: guardedFetch(rules) }),
  // the services beside the models (picture search, icons, transcription, Stability)
  checkAux: (connection, rules) => checkAuxConnection(connection, { fetch: guardedFetch(rules, { maxBytes: MAX_CHECK_RESPONSE_BYTES }) }),
  assertHost: (baseUrl, rules) => assertEndpointHost(baseUrl, rules),
  // a settings-file connection's apiKeyEnv is read here for each request
  env: process.env,
  audit: (entry) => (auditSink ? auditSink(entry) : undefined),
})

function callerId() {
  const running = currentAIAction()
  if (running?.userId) return running.userId
  try {
    return Meteor.userId()
  } catch {
    return null
  }
}

// The connection that serves this AI request (see ai-settings-core.mjs resolveFor).
export function resolveRequestConnection({ feature, request = {}, userId = callerId() }) {
  return aiSettings.resolveFor({ userId, feature, request })
}

/**
 * Whether an administrator turned off the surface of this request feature (ai-settings-core.mjs
 * surfaceOff): checked before a rate limit or lock is taken, so a part that is off always answers
 * with the administrator's message. → null or { surface, message }. Never throws: a broken read
 * leaves the request to req(), which checks again.
 */
export async function surfaceOffFor({ feature, userId = callerId() }) {
  try {
    return await aiSettings.surfaceOff({ userId, feature })
  } catch (error) {
    console.warn(`ai-settings: whether ${feature} is turned off could not be read: ${error.message}`)
    return null
  }
}

/**
 * The key of a service beside the models for one request (ai-settings-core.mjs auxCredential): the
 * server's connection in the app when there is one, so a key rotated there is used at once, else
 * null and the caller reads the settings file as before. Never throws: a broken row falls back.
 */
export async function auxCredential(provider) {
  try {
    return await aiSettings.auxCredential(provider)
  } catch (error) {
    console.warn(`ai-settings: the ${provider} key in the app could not be read; the settings file applies: ${error.message}`)
    return null
  }
}
