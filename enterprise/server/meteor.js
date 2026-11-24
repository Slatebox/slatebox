// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Meteor side of outside agents: the collections, the publication every screen on a slate
// reads (its invited agents and their live ghosts), and the real dependencies of the service:
// mcpFetch, Slatebox's model (settings.ai.use.connectors, falling back to the conversation's
// choice), the metered request, the registry (as the agent, with the inviter's rights) and
// presence; and sign-in (S2b): the vault (mcpCredentials, sealed under the app's master key), the
// sign-in flows (mcpSignins, 10 minutes, used once) and automatic registrations (mcpClients).
// Loaded at server start on Cloud only, when the invite switch is on (index.js).
/* eslint-disable no-console */
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { createAppRegistry } from '/server/actions/index.mjs'
import { deps, idempotency, limiter } from '/server/actions/mount'
import { canvasOfWrites, sessionAuthorization } from '/server/exec/conversation.mjs'
import { resolvePresentationSlate } from '/server/methods/creative-slates'
import req from '/server/methods/ai/req'
import { resolveAIFeatureConfig } from '/server/methods/ai/feature-config.mjs'
import { runAIAction } from '/server/metering/context.mjs'
import { proActive } from '/server/pro-billing.mjs'
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
export const AgentSuggestions = new Mongo.Collection('agentSuggestions')
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

const suggestionsStore = {
  insert: (doc) => AgentSuggestions.insertAsync(doc),
  findOne: (query) => AgentSuggestions.findOneAsync(query),
  update: (id, set) => AgentSuggestions.updateAsync({ _id: id }, { $set: set }),
  pushItem: (id, item) => AgentSuggestions.updateAsync({ _id: id }, { $push: { items: item } }),
  async setItem(id, n, set, onlyIf = null) {
    const $set = Object.fromEntries(Object.entries(set).map(([key, value]) => ['items.$.' + key, value]))
    const changed = await AgentSuggestions.updateAsync({ _id: id, items: { $elemMatch: { n, ...(onlyIf && { status: onlyIf }) } } }, { $set })
    return changed > 0
  },
  removeForConnection: (connectionId) => AgentSuggestions.removeAsync({ connectionId }),
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

export const appOrigin = () => String(Meteor.settings.public?.baseUrl || Meteor.absoluteUrl()).replace(/\/+$/, '')

export function startConnectors() {
  const settings = connectorSettings(Meteor.settings)
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
    canvasOf: canvasOfWrites,
    access: { forUser, reload: (shareId) => Slates.findOneAsync({ shareId }, { fields: { revision: 1 } }) },
    pro: async (userId) => {
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
    await AgentSuggestions.rawCollection().createIndex({ slateId: 1 })
    await AgentSuggestions.rawCollection().createIndex({ connectionId: 1 })
    await AgentSuggestions.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
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

  // Everyone who can read a slate sees its invited agents and their ghosts, live.
  Meteor.publish('connectors.forSlate', async function forSlate(shareId) {
    if (typeof shareId !== 'string') return this.ready()
    const found = await forUser(shareId, this.userId)
    if (!found?.canRead) return this.ready()
    const slateId = found.slate._id
    return [
      McpConnections.find({ slateId, status: { $ne: 'removed' } }, { fields: { name: 1, inviterName: 1, host: 1, status: 1, ownerId: 1, slateId: 1, contextLevel: 1, colorIndex: 1, createdAt: 1 } }),
      AgentSuggestions.find({ slateId, expiresAt: { $gt: new Date() } }, { fields: { plan: 0, 'items.plan': 0, request: 0 } }),
    ]
  })

  return { service, signIn, origin: appOrigin }
}
