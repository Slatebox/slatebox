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
// Loaded at server start wherever enterprise code runs (Cloud, and every self-hosted install whose
// build carries it) unless the kill switch settings.connectors.off is on (index.js).
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
import { waitingActions } from '/server/agents/suggestions.mjs'
import { resolvePresentationSlate } from '/server/methods/creative-slates'
import req from '/server/methods/ai/req'
import { runAIAction } from '/server/metering/context.mjs'
import { presence } from '/server/presence/meteor'
import { firstNameOf, sanitizeClientName } from '/imports/api/common/agent-label.mjs'
import { AIAgents, LibraryItems, SlatePresentations, Slates } from '/imports/api/common/models'
import { slateShareImage, slateShareText } from '/server/common/share-image.mjs'
import { setLibraryIntegrations } from '/server/library/integration-hooks.mjs'
import { setProfileIntegrations } from '/server/profile/integration-hooks.mjs'
import { setAccountIntegrations } from '/server/integrations/account-removal.mjs'
import { loadMasterKey } from '/server/metering/vault.mjs'
import { createMcpFetch } from './mcp-fetch.mjs'
import { callTool, discover } from './mcp-session.mjs'
import { ConnectorRefused, createConnectorService, meterRefusal, profileIntegration, profileSource } from './service.mjs'
import { connectorSettings } from './connector-settings.mjs'
import { createIntegrationApps } from './integration-apps.mjs'
import { cardFor, retiredFor } from '../common/gallery.mjs'
import { communityCard, liveGallery } from './gallery-admin.mjs'
import { CLOUD_LIBRARY_LIMITS, CLOUD_ORIGIN, cloudLibraryOn, createCloudCatalog } from './cloud-library.mjs'
import { createVault } from './credentials.mjs'
import { credentialInUse } from './credential-users.mjs'
import { createSignIn, probe } from './signin.mjs'
import { migrateIntegrations, resumeLapsedIntegrations, retireSlackMcp } from './integrations-migrate.mjs'
import { itemsFromLayout } from './translate.mjs'
import { createGoogleService, googleConfiguration, googleSettings, GOOGLE_ADDRESS } from './google/google.mjs'
import { createSlackService, slackOnlyFetch, slackSettings, SLACK_ADDRESS } from './slack/slack.mjs'
import { INVITE_CARDS, NATIVE_CARDS } from '../common/gallery.mjs'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { deleteStoredFile, storedFileBase, storeImage, storedFileKey } from '/server/common/fileStore'

export const McpConnections = new Mongo.Collection('mcpConnections')
// Never published: sealed tokens, sign-in flows and registrations stay on the server.
const McpCredentials = new Mongo.Collection('mcpCredentials')
const McpSignins = new Mongo.Collection('mcpSignins')
const McpClients = new Mongo.Collection('mcpClients')
// Each person's connected agent servers, apart from any slate (never published: the Integrations
// page reads them through integrations.list), and each slate owner's outsideAgents choice.
const Integrations = new Mongo.Collection('integrations')
const IntegrationSlateSettings = new Mongo.Collection('integrationSlateSettings')
// Google: each person's last Doc per slate, and the Drive files they picked for a slate (ids and names only).
const GoogleDocLinks = new Mongo.Collection('googleDocLinks')
const GoogleSlateFiles = new Mongo.Collection('googleSlateFiles')
// Action cards (an invited agent's changes outside Slatebox, waiting, done, failed or declined) and
// act-without-asking choices: read through connectors.outsideActions, never published.
const OutsideActions = new Mongo.Collection('mcpOutsideActions')
// A self-hosted install's last good copy of Slatebox Cloud's Community cards (cloud-library.mjs): one row.
const CloudCatalog = new Mongo.Collection('connectorCloudCatalog')
// The OAuth apps an administrator entered (Admin › AI control › Integration apps): one row per
// provider, the client secret sealed. Never published: read through connectors.apps.list.
const ConnectorOAuthApps = new Mongo.Collection('connectorOAuthApps')
// Slack (native, on its Web API): each workspace's bot token (sealed; link previews, the Send to
// slate shortcut, /slatebox), Slack's event ids already handled (hashed, an hour), and the read gate
// every server process shares (a channel or thread once a minute per workspace while unlisted).
// Never published.
const SlackWorkspaces = new Mongo.Collection('slackWorkspaces')
const SlackEvents = new Mongo.Collection('slackEvents')
const SlackReadGates = new Mongo.Collection('slackReadGates')
const oauthAppRows = {
  get: (provider) => ConnectorOAuthApps.findOneAsync({ _id: provider }),
  all: () => ConnectorOAuthApps.find({}).fetchAsync(),
  put: (provider, { _id, ...doc }) => ConnectorOAuthApps.upsertAsync({ _id: provider }, { $set: doc }),
  remove: (provider) => ConnectorOAuthApps.removeAsync({ _id: provider }),
}

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

// The part's model and key come from Admin → AI control (req resolves the route by feature).
function model() {
  return async ({ feature, tool, system, user, userId, shareId }) => {
    const turn = await req({
      feature, sdkChat: true, shareId, userId,
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
  // The slate's answers still waiting: the next answer lands beside their ghosts, and the same ask
  // while its answer waits is that answer.
  waiting: async (slate) => waitingActions(await suggestionStore.list(slate._id)),
  // Action cards: their notes say what became of them, are found by their answer, and are kept or
  // discarded through the app's own decide (keeping runs its checks and saves as the person).
  retext: (slate, change) => suggestionStore.retext(slate, change),
  actionOf: async (slate, actionId) => (await suggestionStore.list(slate._id)).find((action) => action._id === actionId) || null,
  keep: (person, slate, actionId, itemIds) => registry.run(person, 'suggestions.decide', { shareId: slate.shareId, decision: 'keep', actionId, itemIds }),
  discardItems: (person, slate, actionId, itemIds) => suggestionStore.discard(person, slate, { actionId, itemIds }),
}

const outsideStore = {
  ...storeOfLater(() => OutsideActions),
  // Taken once: only a card still in one of these states becomes running (two approvals make it once).
  async claim(id, from, set) {
    const changed = await OutsideActions.updateAsync({ _id: id, state: { $in: from } }, { $set: set })
    return changed > 0
  },
}
function storeOfLater(collection) {
  return {
    insert: (doc) => collection().insertAsync(doc),
    findOne: (query) => collection().findOneAsync(query),
    find: (query) => collection().find(query, { sort: { createdAt: 1 } }).fetchAsync(),
    update: (id, set) => collection().updateAsync({ _id: id }, { $set: set }),
    remove: (id) => collection().removeAsync({ _id: id }),
  }
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
  remove: (id) => McpConnections.removeAsync({ _id: id }),
}

const workspacesStore = {
  get: (id) => SlackWorkspaces.findOneAsync({ _id: id }),
  put: ({ _id, ...doc }) => SlackWorkspaces.upsertAsync({ _id }, { $set: doc }),
  find: (query) => SlackWorkspaces.find(query).fetchAsync(),
  remove: (id) => SlackWorkspaces.removeAsync({ _id: id }),
}

// Taken once per period: the row's next time moves only when it has passed (or the row is new; two
// processes inserting at once: one wins, the other is told no).
const gatesStore = {
  async claim(id, at, until) {
    const raw = SlackReadGates.rawCollection()
    const moved = await raw.updateOne({ _id: id, nextAt: { $lte: at } }, { $set: { nextAt: until } })
    if (moved.modifiedCount > 0) return true
    try {
      await raw.insertOne({ _id: id, nextAt: until })
      return true
    } catch (error) {
      if (error?.code === 11000) return false
      throw error
    }
  },
  get: (id) => SlackReadGates.findOneAsync({ _id: id }),
  hold: (id, until) => SlackReadGates.rawCollection().updateOne({ _id: id }, { $max: { nextAt: until } }, { upsert: true }),
}

const slackEventsStore = {
  async claim(id, expiresAt) {
    try {
      await SlackEvents.rawCollection().insertOne({ _id: id, expiresAt })
      return true
    } catch (error) {
      if (error?.code === 11000) return false
      throw error
    }
  },
}

// The slates a person may put a Slack message on (their own, newest first), by name: the Send to slate
// modal and /slatebox. The modal's answer checks the person's rights again (forUser).
async function editableSlates(userId, { query = '', limit = 100 } = {}) {
  const words = String(query || '').trim().slice(0, 80)
  const named = words ? { 'options.name': { $regex: words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {}
  const rows = await Slates.find({ userId, ...named }, { sort: { lastSaved: -1 }, limit: Math.min(100, limit), fields: { shareId: 1, 'options.name': 1, creative: 1, nativeCanvasDrawing: 1 } }).fetchAsync()
  return rows.filter(drawable).map((slate) => ({ shareId: slate.shareId, name: String(slate.options?.name || 'Untitled slate').slice(0, 80) }))
}

// A link's preview in Slack, by the slate's own visibility (the rule of its social preview, startup.js):
// a public slate's name and picture, a published presentation's; anything else null ("Private slate").
async function publicPreview(kind, id) {
  if (kind === 'present') {
    const deck = await SlatePresentations.findOneAsync({ slateShareId: id, isPublished: true }, { fields: { name: 1, description: 1, imageUrl: 1 } })
    return deck?.name ? { title: deck.name, description: deck.description || '', imageUrl: deck.imageUrl || null } : null
  }
  const slate = await Slates.findOneAsync({ shareId: id, 'options.isPublic': true, 'options.isPrivate': { $ne: true }, 'options.isUnlisted': { $ne: true } },
    { fields: { 'options.id': 1, 'options.name': 1, 'options.description': 1, 'options.isPublic': 1, 'options.isPrivate': 1, 'options.isUnlisted': 1, 'options.staticImage': 1 } })
  if (!slate) return null
  const text = slateShareText(slate)
  return { title: text?.title || 'A slate on Slatebox', description: text?.description || '', imageUrl: slateShareImage(slate, storedFileBase()) }
}

const storeOf = (collection) => ({
  insert: (doc) => collection.insertAsync(doc),
  findOne: (query) => collection.findOneAsync(query),
  find: (query) => collection.find(query, { sort: { createdAt: 1 } }).fetchAsync(),
  update: (id, set) => collection.updateAsync({ _id: id }, { $set: set }),
  remove: (id) => collection.removeAsync({ _id: id }),
})
const integrationsStore = storeOf(Integrations)
const slateSettingsStore = storeOf(IntegrationSlateSettings)

// The slates an integration is on, as its owner may still open them: name and address only.
async function slateList(slateIds, viewerId) {
  if (!slateIds.length) return []
  const slates = await Slates.find({ _id: { $in: slateIds.slice(0, 50) } }, { fields: { shareId: 1, 'options.name': 1 } }).fetchAsync()
  const out = []
  for (const slate of slates) {
    const found = await forUser(slate.shareId, viewerId).catch(() => null)
    if (found?.canRead) out.push({ slateId: slate._id, shareId: slate.shareId, name: String(slate.options?.name || 'Untitled slate').slice(0, 80) })
  }
  return out
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

// The gallery as administrators set it (aiAgents, /admin/ai › Gallery), read at most every few seconds.
const findGallery = () => AIAgents.find({ kind: 'outbound-connector' }).fetchAsync()
// The Community cards after the built-in ones: this server's approved suggestions, then Slatebox
// Cloud's on a self-hosted install (set once the connectors start).
let communitySource = async () => []
let galleryCache = { at: 0, cards: null }
async function gallery() {
  if (galleryCache.cards && Date.now() - galleryCache.at < 5000) return galleryCache.cards
  const cards = liveGallery(await findGallery().catch(() => []), INVITE_CARDS, { extra: await communitySource().catch(() => []) })
  galleryCache = { at: Date.now(), cards }
  return cards
}

// Whether a native card is on (/admin/ai › Gallery): Google Drive's, Slack's.
async function nativeEnabled(id) {
  const docs = await findGallery().catch(() => [])
  return liveGallery(docs, NATIVE_CARDS).some((card) => card.id === id)
}
const googleEnabled = () => nativeEnabled('googledrive')

export function startConnectors({ via = null, isUnlocked = () => true } = {}) {
  const settings = connectorSettings(Meteor.settings, { development: Meteor.isDevelopment })
  const google = () => googleSettings(Meteor.settings, { development: Meteor.isDevelopment })
  const slackConfig = () => slackSettings(Meteor.settings, { development: Meteor.isDevelopment })
  const fetch = createMcpFetch({ devOrigins: settings.devOrigins, userAgent: settings.userAgent })
  // Sign-in's own fetch: the same checks, may GET metadata, follows no redirect, small answers.
  // DELETE: GitHub ends a sign-in with one (oauth.mjs KNOWN_PROVIDERS.github.revoke).
  const signInFetch = createMcpFetch({ devOrigins: [...settings.devOrigins, ...google().devOrigins, ...slackConfig().devOrigins], userAgent: settings.userAgent, methods: ['GET', 'POST', 'DELETE'], maxRedirects: 0, maxBytes: 256 * 1024, timeoutMs: 10000 })
  // Slack's Web API: the same address checks, Slack's own hosts only, no redirects.
  const slackFetch = slackOnlyFetch(createMcpFetch({ devOrigins: slackConfig().devOrigins, userAgent: settings.userAgent, methods: ['POST'], maxRedirects: 0, maxBytes: 2 * 1024 * 1024, timeoutMs: 15000 }), { devOrigins: slackConfig().devOrigins })
  // Google's APIs: the same address checks; uploads are larger, downloads follow Google's own redirects.
  const googleFetch = createMcpFetch({ devOrigins: google().devOrigins, userAgent: settings.userAgent, methods: ['GET', 'POST', 'PATCH', 'DELETE'], maxBytes: 4 * 1024 * 1024, timeoutMs: 30000 })
  // The app's existing master key (never generated here). Without it, sign-in servers are not offered.
  const master = loadMasterKey()
  if (!master) console.warn('[connectors] SLATEBOX_KEY_ENCRYPTION_KEY is not set: agents that need sign-in are not offered')
  // The pre-registered apps: settings.connectors.oauthApps with what an administrator entered in
  // Admin › Integration apps on top, read again every few seconds (a pasted secret needs no restart).
  const integrationApps = createIntegrationApps({
    rows: oauthAppRows,
    master,
    settingsApps: () => settings.oauthApps,
    origin: appOrigin,
    audit: (entry) => {
      console.log('[connectors]', JSON.stringify({ kind: entry.action, provider: entry.target.id, by: entry.actor?.userId ?? null, at: new Date().toISOString() }))
      return deps.aiControlStore?.record(entry)
    },
  })
  const vault = createVault({
    store: credentialsStore,
    master,
    fetch: signInFetch,
    // Google's sign-in is Slatebox's own OAuth client (settings.googleDocs.web); MCP servers' are the
    // integration apps (Admin › Integration apps, else settings.connectors.oauthApps), asked on every refresh.
    secretFor: async (registration) => (registration.provider === 'google' ? google().clientSecret : (await integrationApps.apps())[registration.provider]?.clientSecret || null),
    // Hosts and a reason only (credentials.mjs): never a token.
    log: (entry) => console.warn('[connectors]', JSON.stringify({ ...entry, at: new Date().toISOString() })),
  })
  // A native integration's sign-in callback (Slack's OAuth v2), set once its service exists.
  const natives = {}
  const signIn = createSignIn({
    flows: flowsStore,
    clients: clientsStore,
    vault,
    master,
    fetch: signInFetch,
    apps: () => integrationApps.apps(),
    origin: appOrigin,
    devOrigins: settings.devOrigins,
    natives,
  })
  // Google tells the connector service when it is connected again (set once the service exists).
  let resumeGoogle = async () => {}
  const agentSave = (principal, input, mode) =>
    registry.run(principal, 'slates.applyOperations', { ...input, mode }, mode === 'save' ? { idempotencyKey: `${principal.runId}:${input.plan.operations[0]?.ids?.[0] || 'k'}` } : {})
  const googleService = createGoogleService({
    vault,
    integrations: integrationsStore,
    docLinks: storeOf(GoogleDocLinks),
    slateFiles: storeOf(GoogleSlateFiles),
    fetch: googleFetch,
    config: google,
    enabled: googleEnabled,
    access: { forUser, forToken },
    applyOperations: agentSave,
    presence,
    // Docs and Slides fetch a picture from a public address once (they keep their own copy): the
    // app's image store, drawn again by sharp (only a real PNG survives, at most 2400 px a side),
    // removed as soon as Google has it.
    publishImage: async ({ buffer, slateId }) => {
      const png = await sharp(buffer, { limitInputPixels: 64e6 }).resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
      const url = await storeImage(png, `g_${slateId}_${randomBytes(6).toString('hex')}`)
      return { url, remove: () => deleteStoredFile(storedFileKey(url)) }
    },
    onConnected: (integration) => resumeGoogle(integration),
    itemsFromLayout,
    audit: (entry) => console.log('[google]', JSON.stringify({ ...entry, at: new Date().toISOString() })),
  })
  // Slack tells the connector service when it is connected again, and moves an MCP Slack integration
  // in place (both set once the service exists).
  let resumeSlack = async () => {}
  let moveToNative = async () => null
  const slackService = createSlackService({
    vault,
    integrations: integrationsStore,
    connections: connectionsStore,
    workspaces: workspacesStore,
    gates: gatesStore,
    signIn,
    fetch: slackFetch,
    config: slackConfig,
    apps: () => integrationApps.apps(),
    origin: appOrigin,
    enabled: () => nativeEnabled('slack'),
    master,
    access: { forUser },
    editableSlates,
    publicPreview,
    applyOperations: agentSave,
    presence,
    itemsFromLayout,
    onConnected: (integration) => resumeSlack(integration),
    moveNative: (old, set) => moveToNative(old, set),
    audit: (entry) => console.log('[slack]', JSON.stringify({ ...entry, at: new Date().toISOString() })),
  })
  natives.slack = (flow, code) => slackService.finishInstall(flow, code)
  // The Drive and Slack agents are native sessions beside the MCP one: the same service asks them all.
  const nativeSession = (address) => (address === GOOGLE_ADDRESS ? googleService.driveSession : address === SLACK_ADDRESS ? slackService.slackSession : null)
  const session = {
    discover: (address, f, options) => (nativeSession(address) ? nativeSession(address).discover(address, f, options) : discover(address, f, options)),
    callTool: (address, f, call, options) => (nativeSession(address) ? nativeSession(address).callTool(address, f, call, options) : callTool(address, f, call, options)),
  }
  const service = createConnectorService({
    oauthApps: () => integrationApps.apps(),
    connections: connectionsStore,
    suggestions: suggestionsStore,
    fetch,
    session,
    // The person's own choice for connectors (else their conversation choice), inside one metered request.
    // Integrations are free (owner, 2026-11-26), the agent work they run is not: the meter's refusal
    // (no credits left, no Pro on Cloud) reaches the person with its code, words and pay action.
    model: model(),
    metered: (fn, { userId }) => runAIAction({ feature: 'connectors', userId, countsAsDraft: true }, fn).catch(meterRefusal),
    applyOperations: agentSave,
    access: { forUser, forToken, reload: (shareId) => Slates.findOneAsync({ shareId }, { fields: { revision: 1 } }) },
    firstName: async (userId) => firstNameOf(await Meteor.users.findOneAsync(userId, { fields: { profile: 1, emails: 1 } })),
    sanitizeName: sanitizeClientName,
    presence,
    vault,
    signIn,
    probe,
    devOrigins: settings.devOrigins,
    audit: (entry) => console.log('[connectors]', JSON.stringify({ ...entry, at: new Date().toISOString() })),
    gallery,
    integrations: integrationsStore,
    slateSettings: slateSettingsStore,
    slateList,
    // Google's card off in /admin/ai (or its client or key gone): Drive agents stop, and none joins.
    nativeOn: (address) => (address === GOOGLE_ADDRESS ? googleService.usable() : address === SLACK_ADDRESS ? slackService.usable() : true),
    // Async for every integration: the service awaits it (a plain null here once failed every non-Google disconnect).
    forget: async (integration) => (integration.address === GOOGLE_ADDRESS ? googleService.forget(integration.ownerId) : null),
    outside: outsideStore,
  })
  // Community cards: this server's approved suggestions (the library's review queue), then Slatebox
  // Cloud's on a self-hosted install (cloud-library.mjs), each checked again as a card.
  const cloud = cloudLibraryOn({ via, settings: Meteor.settings }) ? startCloudCatalog(settings) : null
  const localCommunity = async () => {
    const rows = await LibraryItems.find({ kind: 'integration', status: 'published' }, { sort: { publishedAt: 1 }, limit: 200, fields: { title: 1, summary: 1, category: 1, kind: 1, status: 1, integration: 1, authorName: 1 } }).fetchAsync()
    return rows.map((row) => communityCard(row, { devOrigins: settings.devOrigins })).filter(Boolean)
  }
  communitySource = async () => [...(await localCommunity()), ...(cloud ? await cloud.catalog.cards() : [])]
  galleryCache = { at: 0, cards: null }
  // Suggesting a custom server for everyone goes through the library (library.submit kind integration):
  // the MIT core asks these, and only while enterprise code is unlocked (Cloud's key holds).
  const unlockedOr = (fn) => async (...args) => {
    if (!isUnlocked()) throw new ConnectorRefused(403, 'enterprise_locked', 'Integrations are not available on this server.')
    return fn(...args)
  }
  setLibraryIntegrations({
    forSubmit: unlockedOr((principal, input) => service.submissionOf(principal, input)),
    probe: unlockedOr((address) => service.reviewProbe(address)),
    covered: async (address) => Boolean(cardFor(address, await gallery())),
    changed: async () => { galleryCache = { at: 0, cards: null } },
  })
  // The interview (About you) plans its questions from the tools a person connected: names, cards and
  // kinds only, never an address, a token or anything a tool holds; none while the license does not hold.
  setProfileIntegrations({
    connected: async (userId) => {
      if (!isUnlocked() || !userId) return []
      const cards = await gallery()
      const rows = await integrationsStore.find({ ownerId: userId })
      return rows.map((doc) => profileIntegration(doc, cards))
    },
    // About you › "Use <tool> to personalize" (S3): the integrations that have a look-around, and the
    // bounded read-only look itself (service.lookAround: quarantined, capped, lookups only).
    sources: async (userId) => {
      if (!isUnlocked() || !userId) return []
      const cards = await gallery()
      return (await integrationsStore.find({ ownerId: userId })).map((doc) => profileSource(doc, cards)).filter(Boolean)
    },
    lookAround: async (userId, ref) => {
      if (!isUnlocked() || !userId) throw new ConnectorRefused(404, 'not_found', 'That tool is not connected.')
      return service.lookAround({ kind: 'person', userId }, { ref })
    },
  })
  // Keeping an action card's note approves its change: the app's suggestions.decide asks the service
  // first (only while enterprise code is unlocked; a locked server has no cards).
  deps.suggestionGate = (principal, slate, choice) => (isUnlocked() ? service.gate(principal, slate, choice) : null)
  resumeGoogle = (integration) => service.resumeIntegration(integration)
  resumeSlack = (integration) => service.resumeIntegration(integration)
  moveToNative = (old, set) => service.moveNative(old, set)
  // A removed account (users.delete, a team deleted, a member removed): its integrations are
  // disconnected and each sign-in revoked at its vendor, whether or not enterprise code is unlocked
  // (a privacy promise); the app then removes every row the person owns (server/integrations). The
  // Slack workspaces it installed no longer name it (their bot token is the workspace's).
  setAccountIntegrations({
    forgetPerson: (userId) => service.forgetPerson(userId, {
      credentialRows: (id) => McpCredentials.find({ ownerId: id }, { fields: { ownerId: 1, address: 1 } }).fetchAsync(),
      natives: (id) => slackService.forgetPerson(id),
    }),
  })
  Meteor.startup(async () => {
    await McpConnections.rawCollection().createIndex({ slateId: 1, status: 1 })
    await McpConnections.rawCollection().createIndex({ ownerId: 1, address: 1 })
    await McpCredentials.rawCollection().createIndex({ ownerId: 1 })
    await McpSignins.rawCollection().createIndex({ stateHash: 1 })
    await McpSignins.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    await McpConnections.rawCollection().createIndex({ integrationId: 1, status: 1 })
    await Integrations.rawCollection().createIndex({ ownerId: 1, address: 1 }, { unique: true })
    await Integrations.rawCollection().createIndex({ ownerId: 1, rule: 1 })
    await OutsideActions.rawCollection().createIndex({ slateId: 1, actionId: 1 })
    await OutsideActions.rawCollection().createIndex({ connectionId: 1 })
    await OutsideActions.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    await OutsideActions.rawCollection().createIndex({ ownerId: 1 })
    await Integrations.rawCollection().createIndex({ kind: 1, slackTeamId: 1, slackUserId: 1 })
    await SlackWorkspaces.rawCollection().createIndex({ teamId: 1 })
    await SlackEvents.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    // Connect once: each person's agents already on slates become their integrations (idempotent).
    const moved = await migrateIntegrations({ connections: connectionsStore, integrations: integrationsStore }).catch((error) => {
      console.warn('[connectors] integrations migration failed', error?.message)
      return null
    })
    if (moved?.created || moved?.linked) console.log('[connectors]', JSON.stringify({ kind: 'integrations_migrated', ...moved }))
    const resumed = await resumeLapsedIntegrations({ connections: connectionsStore, integrations: integrationsStore }).catch((error) => {
      console.warn('[connectors] resuming lapsed integrations failed', error?.message)
      return null
    })
    if (resumed?.resumed) console.log('[connectors]', JSON.stringify({ kind: 'integrations_resumed', ...resumed }))
    // Slack moved to its Web API: integrations still at its MCP address ask to connect again.
    const retired = await retireSlackMcp({ connections: connectionsStore, integrations: integrationsStore }).catch((error) => {
      console.warn('[connectors] retiring Slack MCP failed', error?.message)
      return null
    })
    if (retired?.marked) console.log('[connectors]', JSON.stringify({ kind: 'slack_mcp_retired', ...retired }))
  })
  // Hourly: forget (and revoke) sign-ins no agent uses any more.
  const sweep = () => !isUnlocked() ? Promise.resolve() : service.sweep(() => McpCredentials.find({}, { fields: { ownerId: 1, address: 1, createdAt: 1 } }).fetchAsync(), { inUse: credentialInUse })
    .then(({ removed }) => removed && console.log('[connectors]', JSON.stringify({ kind: 'sweep', removed })))
    .catch((error) => console.warn('[connectors] sweep failed', error?.message))
  Meteor.setTimeout(sweep, 60000)
  Meteor.setInterval(sweep, 3600000)

  // Everyone who can read a slate sees its invited agents, live (their ghosts come with the app's
  // agentSuggestions.forSlate, like every agent's).
  Meteor.publish('connectors.forSlate', async function forSlate(shareId) {
    // A key that ended while the server ran: the publication goes quiet like every action.
    if (typeof shareId !== 'string' || !isUnlocked()) return this.ready()
    const found = await forUser(shareId, this.userId)
    if (!found?.canRead) return this.ready()
    const slateId = found.slate._id
    // No account ids leave the server: each screen gets `mine` (it invited this agent) and
    // `removable` (it may remove it: the inviter, or the slate's owner) instead of the inviter's id.
    const viewer = this.userId
    const ownsSlate = Boolean(viewer && found.slate.userId === viewer)
    // The address stays on the server: each screen gets the gallery card it came from (galleryId), so the
    // gallery can mark an agent "On this slate" and the chip can say what it adds.
    // The host only to the agent's own inviter (an internal server's address is theirs to share).
    const shown = ({ _id, ownerId, address, galleryId, host, ...fields }) => ({
      ...fields, ...(viewer && ownerId === viewer && { host }), galleryId: galleryId || cardFor(address)?.id || null, retired: retiredFor(address)?.why || null, mine: Boolean(viewer && ownerId === viewer), removable: Boolean(viewer && (ownerId === viewer || ownsSlate)),
    })
    const handle = await McpConnections.find({ slateId, status: { $ne: 'removed' } }, { fields: { name: 1, inviterName: 1, host: 1, status: 1, ownerId: 1, slateId: 1, contextLevel: 1, colorIndex: 1, agentId: 1, createdAt: 1, address: 1, galleryId: 1, joinedBy: 1, integrationId: 1 } })
      .observeAsync({
        added: (doc) => this.added('mcpConnections', doc._id, shown(doc)),
        changed: (doc) => this.changed('mcpConnections', doc._id, shown(doc)),
        removed: (doc) => this.removed('mcpConnections', doc._id),
      })
    this.onStop(() => handle.stop())
    this.ready()
    return undefined
  })

  // /admin/ai › Gallery's configuration row: yes or no only.
  const configured = async () => ({
    google: googleConfiguration(google(), { vaultKey: Boolean(master) }),
    ...(cloud && { cloudLibrary: await cloud.catalog.status() }),
  })
  return { service, google: googleService, slack: slackService, slackEvents: slackEventsStore, signIn, origin: appOrigin, userFor, findGallery, configured, community: () => communitySource(), integrationApps }
}

// Slatebox Cloud's Community cards on a self-hosted install: pulled at start and every few hours by one
// server at a time (a lease on the row), the last good copy served in between and while offline.
function startCloudCatalog(settings) {
  const fetch = createMcpFetch({ devOrigins: settings.devOrigins, userAgent: settings.userAgent, methods: ['GET'], maxRedirects: 0, maxBytes: CLOUD_LIBRARY_LIMITS.maxBytes, timeoutMs: CLOUD_LIBRARY_LIMITS.timeoutMs })
  // Another origin only in a development run (a fake Cloud in a test); production always asks Slatebox Cloud.
  const origin = (Meteor.isDevelopment && typeof Meteor.settings.enterprise?.cloudOrigin === 'string' && Meteor.settings.enterprise.cloudOrigin) || CLOUD_ORIGIN
  const store = {
    get: () => CloudCatalog.findOneAsync({ _id: 'cloud' }),
    put: (doc) => CloudCatalog.upsertAsync({ _id: 'cloud' }, { $set: doc }),
  }
  const catalog = createCloudCatalog({ fetch, store, origin, log: (entry) => console.log('[connectors]', JSON.stringify(entry)) })
  const run = async () => {
    const until = new Date(Date.now() + 10 * 60 * 1000)
    const leased = await CloudCatalog.rawCollection().updateOne({ _id: 'lease', $or: [{ until: { $lt: new Date() } }, { until: { $exists: false } }] }, { $set: { until } }, { upsert: false })
      .then((r) => r.modifiedCount > 0)
      .catch(() => false)
    const first = !leased && !(await CloudCatalog.findOneAsync({ _id: 'lease' }).catch(() => null)) && (await CloudCatalog.insertAsync({ _id: 'lease', until }).then(() => true).catch(() => false))
    if (!leased && !first) return
    await catalog.sync()
    galleryCache = { at: 0, cards: null }
  }
  Meteor.setTimeout(() => run().catch((error) => console.warn('[connectors] cloud library failed', error?.message)), 15000)
  Meteor.setInterval(() => run().catch((error) => console.warn('[connectors] cloud library failed', error?.message)), CLOUD_LIBRARY_LIMITS.everyMs)
  return { catalog, run }
}
