// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Meteor side of outside agents: the collections, the publication every screen on a slate
// reads (its invited agents; their live suggestions are the app's own, agentSuggestions.forSlate),
// and the real dependencies of the service:
// mcpFetch, Slatebox's model (settings.ai.use.connectors, falling back to the conversation's
// choice), the metered request, the registry (as the agent, with the inviter's rights) and
// presence; and sign-in (S2b): the vault (mcpCredentials, sealed under the app's master key), the
// sign-in flows (mcpSignins, 10 minutes, used once) and automatic registrations (mcpClients).
// Loaded at server start where enterprise code is unlocked (Cloud, or a licensed self-hosted
// install) unless the kill switch settings.connectors.off is on (index.js).
/* eslint-disable no-console */
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Accounts } from 'meteor/accounts-base'
import { createAppRegistry } from '/server/actions/index.mjs'
import { deps, idempotency, limiter } from '/server/actions/mount'
import { sessionAuthorization } from '/server/exec/conversation.mjs'
// Imported before the registry is built: it puts the suggestion store on deps (deps.suggestions),
// so the agent's saves become live suggestions like every other agent's.
import { suggestions as suggestionStore } from '/server/agents/suggestions-meteor.js'
import { resolvePresentationSlate } from '/server/methods/creative-slates'
import req from '/server/methods/ai/req'
import { resolveAIFeatureConfig } from '/server/methods/ai/feature-config.mjs'
import { runAIAction } from '/server/metering/context.mjs'
import { proActive } from '/server/pro-billing.mjs'
import { isCloudEdition } from '/imports/api/common/edition.mjs'
import { presence } from '/server/presence/meteor'
import { firstNameOf, sanitizeClientName } from '/imports/api/common/agent-label.mjs'
import { Slates } from '/imports/api/common/models'
import { loadMasterKey } from '/server/metering/vault.mjs'
import { createMcpFetch } from './mcp-fetch.mjs'
import { callTool, discover } from './mcp-session.mjs'
import { ConnectorRefused, createConnectorService } from './service.mjs'
import { connectorSettings } from './connector-settings.mjs'
import { createVault } from './credentials.mjs'
import { createSignIn, probe } from './signin.mjs'

export const McpConnections = new Mongo.Collection('mcpConnections')
// Never published: sealed tokens, sign-in flows and registrations stay on the server.
const McpCredentials = new Mongo.Collection('mcpCredentials')
const McpSignins = new Mongo.Collection('mcpSignins')
const McpClients = new Mongo.Collection('mcpClients')

const drawable = (slate) => !slate.creative || slate.nativeCanvasDrawing || slate.creative.model?.kind === 'workshop'

// What a person may do on a slate, by the rule the canvas uses (their session's rights).
// No userId: someone signed out, who may only read (a public slate's visitors see agents too).
async function forUser(shareId, userId) {
  if (typeof shareId !== 'string') return null
  const opened = await resolvePresentationSlate(shareId, userId)
  if (!opened?.slateBase) return null
  return { slate: opened.slateBase, canRead: Boolean(opened.accessLevel), canEdit: Boolean(userId && opened.canEdit) && drawable(opened.slateBase) }
}

// What a token may do on a slate, by the token rule (api-token-core authorizeTokenForSlate): its
// account's own rights, never an unlisted link's.
async function forToken(principal, shareId) {
  if (typeof shareId !== 'string') return null
  const [read, write] = await Promise.all([deps.authorizeTokenForSlate(principal, shareId, false), deps.authorizeTokenForSlate(principal, shareId, true)])
  if (!read?.slate) return null
  return { slate: read.slate, canRead: Boolean(read.authorized), canEdit: Boolean(write.authorized) && drawable(read.slate) }
}

// The agent's writes run through the app's own registry, with the inviter's session rights.
const registry = createAppRegistry({
  deps: { ...deps, authorizeTokenForSlate: async (token, shareId, write = false) => sessionAuthorization(await resolvePresentationSlate(shareId, token.userId), token.userId, write) },
  idempotency,
  limiter,
})

function model() {
  const config = resolveAIFeatureConfig('chat', Meteor.settings)
  return async ({ feature, tool, system, user, userId, shareId }) => {
    const turn = await req({
      provider: config.provider, engine: config.engine, feature, sdkChat: true, shareId, userId,
      system, prompts: [{ role: 'user', content: user }], functions: [tool], function_call: { name: tool.name },
      maxResponseValidationRetries: 1,
      validateResponse: ({ toolCall }) => (toolCall?.name === tool.name && toolCall.arguments && typeof toolCall.arguments === 'object'
        ? null : { code: 'invalid-call', retryPrompt: `Call ${tool.name} once.` }),
    })
    if (turn.abort) throw new ConnectorRefused(422, 'ai_unavailable', turn.abortMessage || 'Slatebox AI is not available right now. Try again in a minute.')
    return turn.toolCall?.arguments || {}
  }
}

// The app's suggestion store, as the service needs it: the agent's id on a slate, and
// withdrawing everything it still has waiting there when it is removed.
const suggestionsStore = {
  agentIdOf: async (principal, slate) => (await presence.identify(principal, slate)).agentId,
  withdraw: (person, slate, agentId) => suggestionStore.discard(person, slate, { agentId }),
  // People on the slate paused every agent there (agents.control): asking is refused up front.
  paused: async (slate) => (await suggestionStore.controlsOf(slate._id)).paused,
}

const credentialsStore = {
  get: (id) => McpCredentials.findOneAsync({ _id: id }),
  put: ({ _id, ...doc }) => McpCredentials.upsertAsync({ _id }, { $set: doc }),
  update: (id, set) => McpCredentials.updateAsync({ _id: id }, { $set: set }),
  // The refresh lease: only one process holds a row at a time; an expired lease can be taken over.
  async claim(id, leaseId, until, at) {
    const changed = await McpCredentials.updateAsync({ _id: id, $or: [{ lease: null }, { 'lease.until': { $lt: at } }] }, { $set: { lease: { id: leaseId, until } } })
    return changed > 0
  },
  release: (id, leaseId) => McpCredentials.updateAsync({ _id: id, 'lease.id': leaseId }, { $set: { lease: null } }),
  remove: (id) => McpCredentials.removeAsync({ _id: id }),
}

const flowsStore = {
  insert: (doc) => McpSignins.insertAsync(doc),
  get: (id) => McpSignins.findOneAsync({ _id: id }),
  async claim(id, from, set) {
    const result = await McpSignins.rawCollection().findOneAndUpdate({ _id: id, status: from, expiresAt: { $gt: new Date() } }, { $set: set }, { returnDocument: 'after' })
    return result && (result.value !== undefined ? result.value : result)
  },
  // Single use: the state is taken once ('opened' → 'used'); a second callback finds nothing.
  async takeByState(stateHash) {
    const result = await McpSignins.rawCollection().findOneAndUpdate({ stateHash, status: 'opened' }, { $set: { status: 'used', authorizeUrl: null } }, { returnDocument: 'after' })
    return result && (result.value !== undefined ? result.value : result)
  },
  update: (id, set) => McpSignins.updateAsync({ _id: id }, { $set: set }),
}

const clientsStore = {
  get: (id) => McpClients.findOneAsync({ _id: id }),
  put: ({ _id, ...doc }) => McpClients.upsertAsync({ _id }, { $set: doc }),
}

const connectionsStore = {
  insert: (doc) => McpConnections.insertAsync(doc),
  findOne: (query) => McpConnections.findOneAsync(query),
  find: (query) => McpConnections.find(query, { sort: { createdAt: 1 } }).fetchAsync(),
  update: (id, set) => McpConnections.updateAsync({ _id: id }, { $set: set }),
}

// Who a request to the sign-in start route is: the Slatebox page sends its login token in a header
// (never a cookie, so no other site can make a browser send it).
async function userFor(req) {
  const token = typeof req.get === 'function' ? req.get('x-slatebox-login-token') : req.headers?.['x-slatebox-login-token']
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null
  const user = await Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': Accounts._hashLoginToken(token) }, { fields: { _id: 1 } })
  return user?._id || null
}

export const appOrigin = () => String(Meteor.settings.public?.baseUrl || Meteor.absoluteUrl()).replace(/\/+$/, '')

export function startConnectors() {
  const settings = connectorSettings(Meteor.settings, { development: Meteor.isDevelopment })
  const fetch = createMcpFetch({ devOrigins: settings.devOrigins, userAgent: settings.userAgent })
  // Sign-in's own fetch: the same checks, may GET metadata, follows no redirect, small answers.
  const signInFetch = createMcpFetch({ devOrigins: settings.devOrigins, userAgent: settings.userAgent, methods: ['GET', 'POST'], maxRedirects: 0, maxBytes: 256 * 1024, timeoutMs: 10000 })
  // The app's existing master key (never generated here). Without it, sign-in servers are not offered.
  const master = loadMasterKey()
  if (!master) console.warn('[connectors] SLATEBOX_KEY_ENCRYPTION_KEY is not set: agents that need sign-in are not offered')
  const vault = createVault({
    store: credentialsStore,
    master,
    fetch: signInFetch,
    secretFor: (registration) => settings.oauthApps[registration.provider]?.clientSecret || null,
  })
  const signIn = createSignIn({
    flows: flowsStore,
    clients: clientsStore,
    vault,
    master,
    fetch: signInFetch,
    apps: () => settings.oauthApps,
    origin: appOrigin,
    devOrigins: settings.devOrigins,
  })
  const service = createConnectorService({
    connections: connectionsStore,
    suggestions: suggestionsStore,
    fetch,
    session: { discover, callTool },
    // The person's own choice for connectors (else their conversation choice), inside one metered request.
    model: model(),
    metered: (fn, { userId }) => runAIAction({ feature: 'connectors', userId, countsAsDraft: true }, fn),
    applyOperations: (principal, input, mode) =>
      registry.run(principal, 'slates.applyOperations', { ...input, mode }, mode === 'save' ? { idempotencyKey: `${principal.runId}:${input.plan.operations[0]?.ids?.[0] || 'k'}` } : {}),
    access: { forUser, forToken, reload: (shareId) => Slates.findOneAsync({ shareId }, { fields: { revision: 1 } }) },
    // Slatebox Pro is needed to invite agents on Slatebox Cloud. A licensed self-hosted install has
    // no Pro: its license is what unlocks invited agents for everyone who may edit there.
    pro: async (userId) => {
      if (!isCloudEdition(Meteor.settings)) return true
      const user = await Meteor.users.findOneAsync(userId, { fields: { pro: 1 } })
      return proActive(user?.pro)
    },
    firstName: async (userId) => firstNameOf(await Meteor.users.findOneAsync(userId, { fields: { profile: 1, emails: 1 } })),
    sanitizeName: sanitizeClientName,
    presence,
    vault,
    signIn,
    probe,
    devOrigins: settings.devOrigins,
    audit: (entry) => console.log('[connectors]', JSON.stringify({ ...entry, at: new Date().toISOString() })),
  })
  Meteor.startup(async () => {
    await McpConnections.rawCollection().createIndex({ slateId: 1, status: 1 })
    await McpConnections.rawCollection().createIndex({ ownerId: 1, address: 1 })
    await McpCredentials.rawCollection().createIndex({ ownerId: 1 })
    await McpSignins.rawCollection().createIndex({ stateHash: 1 })
    await McpSignins.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  })
  // Hourly: forget (and revoke) sign-ins no agent uses any more.
  const sweep = () => service.sweep(() => McpCredentials.find({}, { fields: { ownerId: 1, address: 1, createdAt: 1 } }).fetchAsync())
    .then(({ removed }) => removed && console.log('[connectors]', JSON.stringify({ kind: 'sweep', removed })))
    .catch((error) => console.warn('[connectors] sweep failed', error?.message))
  Meteor.setTimeout(sweep, 60000)
  Meteor.setInterval(sweep, 3600000)

  // Everyone who can read a slate sees its invited agents, live (their ghosts come with the app's
  // agentSuggestions.forSlate, like every agent's).
  Meteor.publish('connectors.forSlate', async function forSlate(shareId) {
    if (typeof shareId !== 'string') return this.ready()
    const found = await forUser(shareId, this.userId)
    if (!found?.canRead) return this.ready()
    const slateId = found.slate._id
    // No account ids leave the server: each screen gets `mine` (it invited this agent) and
    // `removable` (it may remove it: the inviter, or the slate's owner) instead of the inviter's id.
    const viewer = this.userId
    const ownsSlate = Boolean(viewer && found.slate.userId === viewer)
    const shown = ({ _id, ownerId, ...fields }) => ({ ...fields, mine: Boolean(viewer && ownerId === viewer), removable: Boolean(viewer && (ownerId === viewer || ownsSlate)) })
    const handle = await McpConnections.find({ slateId, status: { $ne: 'removed' } }, { fields: { name: 1, inviterName: 1, host: 1, status: 1, ownerId: 1, slateId: 1, contextLevel: 1, colorIndex: 1, agentId: 1, createdAt: 1 } })
      .observeAsync({
        added: (doc) => this.added('mcpConnections', doc._id, shown(doc)),
        changed: (doc) => this.changed('mcpConnections', doc._id, shown(doc)),
        removed: (doc) => this.removed('mcpConnections', doc._id),
      })
    this.onStop(() => handle.stop())
    this.ready()
    return undefined
  })

  return { service, signIn, origin: appOrigin, userFor }
}
