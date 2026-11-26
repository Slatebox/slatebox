// The AI control plane's Meteor glue: the one aiControl instance every AI path and the admin
// actions use. It loads the snapshot at start, checks the generation every 5 s and reloads when it
// moved (snapshot.mjs), writes through store.mjs, and keeps the providers' keys in the backend
// (keys.mjs, sealed with SLATEBOX_KEY_ENCRYPTION_KEY). Before the first AI call it moves any key the
// settings file still holds into the backend (migrations/ai-control-002.mjs).
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import {
  AIAudit, AIAgents, AIBindings, AIChoices, AIControlAudit, AIControlState, AIModels, AIPromptVersions, AIPrompts, AIProviders, ProviderKeys, SystemSettings,
} from '../../imports/api/common/models'
import { aiSettings, guardedFetch, hosted, isServerAdmin, setAISettingsAudit } from '../methods/ai/ai-settings'
import { aiCostMicros, isPriced, setDbPriceSource } from '../metering/prices.mjs'
import { loadMasterKey } from '../metering/vault.mjs'
import { M5_MARKER, runM5 } from '../metering/migrations.mjs'
import { operatorConfig, setProviderSource } from '../methods/ai/connections.mjs'
import { MAX_CHECK_RESPONSE_BYTES, assertEndpointHost, checkEndpointUrl, endpointRules, guardedLookup } from '../methods/ai/endpoint-policy.mjs'
import { checkConnection, listModels } from '../methods/ai/connection-check.mjs'
import { checkAuxConnection } from './aux-check.mjs'
import WebSocket from 'ws'
import { checkRealtime } from '../voice/check.mjs'
import { createCatalogOps, createWriteLimit, dbPriceFor } from './models.mjs'
import { SURFACES, surface as surfaceById } from './catalogue.mjs'
import { createAdminOps, createStatusHub, surfacesStatus } from './admin.mjs'
import { defaultRoute, promptFor, resolveModel } from './resolve.mjs'
import { BUILTIN_PROVIDERS, mergeProviders } from './providers.mjs'
import { CODE_PROMPTS, promptText, prompts as promptRegistry } from './prompts/index.mjs'
import { createPromptOps } from './prompt-ops.mjs'
import { fixtureFor } from './fixtures/index.mjs'
import { evalsFor } from './evals/index.mjs'
import req from '../methods/ai/req'
import { runAIAction } from '../metering/context.mjs'
import { createSnapshotHolder } from './snapshot.mjs'
import { STATE_ID, createControlStore, ensureAIControlIndexes } from './store.mjs'
import { createAIControl } from './facade.mjs'
import { createBindingOps } from './bindings.mjs'
import { createKeyStore } from './keys.mjs'
import { importSettingsKeys, runAIControl002 } from '../migrations/ai-control-002.mjs'
import { displayName } from '../instance/account-summary.mjs'

const raw = {
  providers: AIProviders.rawCollection(),
  models: AIModels.rawCollection(),
  bindings: AIBindings.rawCollection(),
  agents: AIAgents.rawCollection(),
  prompts: AIPrompts.rawCollection(),
  promptVersions: AIPromptVersions.rawCollection(),
  state: AIControlState.rawCollection(),
  audit: AIControlAudit.rawCollection(),
}
const keysCollection = ProviderKeys.rawCollection()
const master = loadMasterKey(process.env)

// The endpoint rules for the server's own configuration (an administrator's provider address).
const serverRules = () => endpointRules({ hosted, level: 'server', privateEndpoints: operatorConfig(Meteor.settings).privateEndpoints })

let keyStore = null
const read = {
  generation: async () => (await raw.state.findOne({ _id: STATE_ID }, { projection: { generation: 1 } }))?.generation ?? 0,
  async all() {
    const [state, providers, models, bindings, prompts, agents, keys] = await Promise.all([
      raw.state.findOne({ _id: STATE_ID }),
      raw.providers.find({}).toArray(),
      raw.models.find({}).toArray(),
      // the one choice per part (documents of the earlier shape carry a scope in their id and wait
      // for ai-control-002)
      raw.bindings.find({}).toArray().then((docs) => docs.filter((doc) => !String(doc._id).includes('|'))),
      raw.prompts.find({ status: { $ne: 'archived' } }).toArray(),
      raw.agents.find({}).toArray(),
      // which provider has an active key, never the key
      keyStore.activeSummary(),
    ])
    const wanted = prompts.filter((p) => p.labels?.published).map((p) => `${p._id}@${p.labels.published}`)
    const promptVersions = wanted.length ? await raw.promptVersions.find({ _id: { $in: wanted } }).toArray() : []
    return { state, providers: providers.filter((p) => p.status !== 'archived' && p.preset), models: models.filter((m) => m.provider), bindings, prompts, promptVersions, agents, keys }
  },
}

export const snapshotHolder = createSnapshotHolder({ read })

export const aiControlStore = createControlStore({
  collections: raw,
  newId: () => Random.id(),
  onWrite: () => snapshotHolder.refresh({ force: true }),
})

// A voice provider's key or model, tested by its socket's setup (server/voice/check.mjs), the
// address looked up with the server's own rules.
const voiceCheck = (connection) => checkRealtime(connection, {
  connect: (url, headers) => new WebSocket(url, { headers, perMessageDeflate: false, handshakeTimeout: 10000, lookup: guardedLookup(serverRules()) }),
})

// A provider a key belongs to: a stored model provider, or a service beside the models. One the
// import has just made counts at once (the snapshot may still be loading).
const justMade = new Map()
const providerOf = (id) => BUILTIN_PROVIDERS[id] || mergeProviders(snapshotHolder.current().providers)[id] || justMade.get(id) || null

keyStore = createKeyStore({
  keys: keysCollection,
  master,
  providerOf,
  check: (connection) => checkConnection(connection, { fetch: guardedFetch(serverRules(), { maxBytes: MAX_CHECK_RESPONSE_BYTES }) }),
  checkAux: (connection) => checkAuxConnection(connection, { fetch: guardedFetch(serverRules(), { maxBytes: MAX_CHECK_RESPONSE_BYTES }) }),
  // a voice provider's key: its socket's setup (server/voice/check.mjs), looked up with the server's rules
  checkRealtime: (connection) => voiceCheck(connection),
  // a key test asks the provider's first enabled model (the default's when it is that provider's)
  modelFor: (provider) => {
    const snap = snapshotHolder.current()
    const fallback = defaultRoute(snap)
    if (fallback?.provider === provider && !fallback.error) return fallback.model
    return Object.values(snap.models).find((m) => m.provider === provider && m.status !== 'disabled')?.model ?? null
  },
  audit: (entry) => aiControlStore.record(entry),
  // every pod's snapshot sees which provider has a key; this pod at once
  bump: async (actor) => {
    await aiControlStore.bump(actor)
    await snapshotHolder.refresh({ force: true })
  },
})
export const aiKeys = keyStore

export const aiControl = createAIControl({
  holder: snapshotHolder,
  choiceHolders: (userId) => aiSettings.choiceHolders(userId),
  codePrompts: CODE_PROMPTS,
  isPriced,
  // a settings-file key kept for this boot answers too (the import's alert says why)
  keyed: (provider) => keyStore.fromSettings().includes(provider),
  // a self-hosted server charges nobody, so an unpriced model's warning says its spend is counted
  charges: hosted,
})

/** Bindings: one choice per part of Slatebox (bindings.mjs), for the ai.bindings.* actions. */
export const aiBindings = createBindingOps({ store: aiControlStore, snapshot: () => snapshotHolder.current() })

// Every prompt a call site sends (prompts/index.mjs promptText) comes from here: the published
// version, else the built-in text. A published version that does not render falls back to the
// built-in text and is named in health, once per version on this pod.
promptRegistry.setSource((id) => promptFor(snapshotHolder.current(), promptRegistry.byId[id], CODE_PROMPTS), {
  onFallback: ({ id, version, error }) => aiControl.noteHealth({
    kind: 'prompt', id,
    problem: version ? `Version ${version} could not be rendered (${error.message}); the built-in text was used.` : `The prompt could not be read (${error.message}); the built-in text was used.`,
  }),
})

// The key import and the catalogue import run before the first AI call; a call waits for them at
// most 15 s and then goes on (a key that could not be moved is used from memory, keys.mjs).
let aiReadyPromise = null
const IMPORT_WAIT_MS = 15000
async function aiReady() {
  if (!aiReadyPromise) return snapshotHolder.ready()
  let timer
  await Promise.race([aiReadyPromise, new Promise((resolve) => { timer = setTimeout(resolve, IMPORT_WAIT_MS) })]).finally(() => clearTimeout(timer))
  return snapshotHolder.ready()
}

// Every AI request asks AI control for its part (ai-settings-core.mjs resolveFor): on or off, and
// which model with which provider; the key is opened from the backend for each request.
aiSettings.setRouteSource(async ({ surface, useDefault }) => {
  const snapshot = await aiReady()
  if (useDefault) return { enabled: true, disabledMessage: null, source: 'default', followed: null, route: defaultRoute(snapshot) }
  return resolveModel(snapshot, { surface })
})
aiSettings.setKeySource(keyStore)

// The stored providers are connection types (connections.mjs), and the prices set on models win in
// the meter (metering/prices.mjs): both read the snapshot, so a change reaches every pod within one
// poll, with no restart.
setProviderSource(() => snapshotHolder.current().providers)
setDbPriceSource((model, where) => dbPriceFor(snapshotHolder.current(), model, where))

/** ai.providers.* and ai.models.* (models.mjs). */
export const aiCatalog = createCatalogOps({
  store: aiControlStore,
  snapshot: () => snapshotHolder.current(),
  keys: keyStore,
  checkUrl: (url) => checkEndpointUrl(url, serverRules()),
  assertHost: (url) => assertEndpointHost(url, serverRules()),
  // archived providers are not in the snapshot; a change reads the stored document
  readProvider: (id) => raw.providers.findOne({ _id: id }),
  listModels: (connection) => listModels(connection, { fetch: guardedFetch(serverRules()) }),
  check: (connection) => checkConnection(connection, { fetch: guardedFetch(serverRules(), { maxBytes: MAX_CHECK_RESPONSE_BYTES }) }),
  checkRealtime: (connection) => voiceCheck(connection),
})

/**
 * Prompts (prompt-ops.mjs): drafts, test runs, the eval gate, publish and rollback, for the
 * ai.prompts.* actions. A test run and the eval cases are sent through the chosen part's model and
 * metered to the administrator as admin.test; test runs are 30 an hour per administrator.
 */
export const aiPrompts = createPromptOps({
  store: aiControlStore,
  prompts: raw.prompts,
  versions: raw.promptVersions,
  registry: promptRegistry,
  live: promptText,
  fixtureFor,
  evalsFor,
  costOf: aiCostMicros,
  snapshot: () => snapshotHolder.current(),
  health: () => aiControl.health(),
  testLimit: createWriteLimit({ count: 30, windowMs: 60 * 60 * 1000 }),
  request: (opts, { surface, actor }) => runAIAction({ feature: 'admin.test', estimateMicros: surfaceById('admin.test').estimate, userId: actor.userId }, () => req({
    ...opts,
    feature: surfaceById(surface)?.requestFeatures?.[0] || surface,
    userId: actor.userId,
  })),
})

/** AI control writes per administrator: 60 in 10 minutes. */
export const aiControlWriteLimit = createWriteLimit()

/** Whether a person may read and change AI control: an administrator of this server. */
export const isAIControlAdmin = isServerAdmin

// ai.update (a person's and a team's own AI) records its changes in the same audit trail.
setAISettingsAudit((entry) => aiControlStore.record(entry))

/** The audit trail, usage per part and reset, for the ai.control.* and ai.audit.* actions. */
export const aiControlOps = createAdminOps({
  store: aiControlStore,
  audit: raw.audit,
  aiAudit: AIAudit.rawCollection(),
  costOf: aiCostMicros,
  bindings: aiBindings,
  prompts: aiPrompts,
  // the Changes tab names people, never their account ids (ai.audit.list is administrators only)
  namesOf: async (userIds) => {
    const users = await Meteor.users.rawCollection().find({ _id: { $in: userIds } }, { projection: { profile: 1, emails: 1, username: 1 } }).toArray()
    return Object.fromEntries(users.map((user) => [user._id, displayName(user) || user.profile?.name || user.username || 'an account with no name']))
  },
})

// ai.surfaces.status: for every signed-in page, whether each AI part is on and the message to show
// when an administrator turned it off. No models, prompts or keys. One shared computation and one
// timer for every subscriber (admin.mjs createStatusHub).
const statusHub = createStatusHub({
  compute: async () => surfacesStatus({
    surfaces: SURFACES,
    snapshot: aiControl.snapshot(),
    bind: (surface) => resolveModel(aiControl.snapshot(), { surface }),
  }),
  generation: () => aiControl.snapshot().generation,
  every: (fn, ms) => Meteor.setInterval(fn, ms),
  cancel: (handle) => Meteor.clearInterval(handle),
})
Meteor.publish('ai.surfaces.status', async function publishSurfacesStatus() {
  if (!this.userId) return this.ready()
  const sub = await statusHub.subscribe((next) => this.changed('aiSurfacesStatus', 'status', next))
  this.added('aiSurfacesStatus', 'status', sub.current)
  this.ready()
  this.onStop(() => sub.stop())
})

// The key import: a key that could not be moved is tried again 5 minutes later in this boot.
async function importKeys() {
  const report = await importSettingsKeys({
    settings: Meteor.settings,
    env: process.env,
    keys: keyStore,
    catalog: {
      ensureProvider: async (args) => {
        const doc = await aiCatalog.ensureProvider(args)
        justMade.set(doc._id, { ...doc, builtin: false })
        return doc
      },
    },
    health: (entry) => aiControl.noteHealth(entry),
  })
  for (const item of [...report.moved, ...report.kept]) aiControl.clearHealth('keys-import', item.provider)
  return report
}

Meteor.startup(() => {
  ensureAIControlIndexes(raw, { auditDays: Meteor.settings?.ai?.auditDays })
    .catch((error) => console.error('ai-control: could not create indexes:', error.message))
  // the Overview's calls, failures and spend per part read the last day of aiAudit
  AIAudit.rawCollection().createIndex({ created: -1 }, { name: 'created_desc' })
    .catch((error) => console.error('ai-control: could not create the aiAudit index:', error.message))
  snapshotHolder.start()
  aiReadyPromise = (async () => {
    // the key indexes first, so two servers importing at once store each key once (migrations.mjs M5)
    await runM5({
      hasMarker: async (id) => Boolean(await SystemSettings.findOneAsync({ _id: id }, { fields: { _id: 1 } })),
      setMarker: (id) => SystemSettings.rawCollection().updateOne({ _id: id }, { $set: { done: Date.now() } }, { upsert: true }),
      indexes: () => keysCollection.indexes().catch(() => []),
      dropIndex: (_collection, name) => keysCollection.dropIndex(name),
      ensureIndex: (_collection, spec, options) => keysCollection.createIndex(spec, options || {}),
    }).catch((error) => console.error(`ai-control: the key indexes (${M5_MARKER}) were not made:`, error.message))
    await snapshotHolder.ready()
    const report = await importKeys().catch((error) => {
      console.error('ai-control-002: the settings-file keys were not checked:', error.message)
      return { failed: [{}] }
    })
    if (report.failed?.length) Meteor.setTimeout(() => { importKeys().catch(() => {}) }, 5 * 60 * 1000)
    await runAIControl002({
      raw: { ...raw, keys: keysCollection, choices: AIChoices.rawCollection(), bindingVersions: AIControlState.rawDatabase().collection('aiBindingVersions') },
      store: aiControlStore,
      master,
      settings: Meteor.settings,
      env: process.env,
      health: (entry) => aiControl.noteHealth(entry),
      drop: (name) => AIControlState.rawDatabase().dropCollection(name),
    }).catch((error) => console.error('ai-control-002: the AI catalogue was not moved; it is tried again at the next start:', error.message))
    await snapshotHolder.refresh({ force: true })
  })()
})
