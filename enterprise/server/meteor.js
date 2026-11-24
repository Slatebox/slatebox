// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Meteor side of outside agents: the collections, the publication every screen on a slate
// reads (its invited agents and their live ghosts), and the real dependencies of the service:
// mcpFetch, Slatebox's model (settings.ai.use.connectors, falling back to the conversation's
// choice), the metered request, the registry (as the agent, with the inviter's rights) and
// presence. Loaded at server start on Cloud only, when the invite switch is on (index.js).
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
import { createMcpFetch } from './mcp-fetch.mjs'
import { callTool, discover } from './mcp-session.mjs'
import { ConnectorRefused, createConnectorService } from './service.mjs'
import { connectorSettings } from './settings.mjs'

export const McpConnections = new Mongo.Collection('mcpConnections')
export const AgentSuggestions = new Mongo.Collection('agentSuggestions')

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

const connectionsStore = {
  insert: (doc) => McpConnections.insertAsync(doc),
  findOne: (query) => McpConnections.findOneAsync(query),
  find: (query) => McpConnections.find(query, { sort: { createdAt: 1 } }).fetchAsync(),
  update: (id, set) => McpConnections.updateAsync({ _id: id }, { $set: set }),
}

export function startConnectors() {
  const settings = connectorSettings(Meteor.settings)
  const fetch = createMcpFetch({ devOrigins: settings.devOrigins, userAgent: settings.userAgent })
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
    devOrigins: settings.devOrigins,
    audit: (entry) => console.log('[connectors]', JSON.stringify({ ...entry, at: new Date().toISOString() })),
  })
  Meteor.startup(async () => {
    await McpConnections.rawCollection().createIndex({ slateId: 1, status: 1 })
    await AgentSuggestions.rawCollection().createIndex({ slateId: 1 })
    await AgentSuggestions.rawCollection().createIndex({ connectionId: 1 })
    await AgentSuggestions.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  })

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

  return service
}
