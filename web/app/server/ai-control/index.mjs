// The AI control plane's Meteor glue: the one aiControl instance every AI path and the admin
// actions use. It loads the snapshot of the DB layer at start, checks the generation every 5 s
// and reloads when it moved (snapshot.mjs), and writes through store.mjs.
//
// Break-glass: settings.ai.control.dbLayer 'off' (settings file, restart) never reads the DB
// layer; Slatebox then behaves exactly as it did before AI control existed.
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import {
  AIAudit, AIAgents, AIBindingVersions, AIBindings, AIChoices, AIControlAudit, AIControlState, AIModels, AIPromptVersions, AIPrompts, AIProviders, ProviderKeys,
} from '../../imports/api/common/models'
import { aiSettings, hosted, isServerAdmin, setAISettingsAudit } from '../methods/ai/ai-settings'
import { aiCostMicros, isPriced, setDbPriceSource, setLimitSource } from '../metering/prices.mjs'
import { setProviderSource } from '../methods/ai/connections.mjs'
import { assertEndpointHost, checkEndpointUrl, endpointRules } from '../methods/ai/endpoint-policy.mjs'
import { createConnectionStore } from '../methods/ai/connection-store.mjs'
import { createCatalogOps, createWriteLimit, dbPriceFor, providersView } from './models.mjs'
import { SURFACES } from './catalogue.mjs'
import { createAdminOps, createStatusHub, surfacesStatus } from './admin.mjs'
import { resolveBinding } from './resolve.mjs'
import { operatorConfig } from '../methods/ai/connections.mjs'
import { createSnapshotHolder, fileDbLayer, parsePromptRef } from './snapshot.mjs'
import { STATE_ID, createControlStore, ensureAIControlIndexes } from './store.mjs'
import { createAIControl } from './facade.mjs'
import { createBindingOps, limitsFor } from './bindings.mjs'
import { applyBreaker, requestBreaker } from './breaker.mjs'
import { runAIControl001 } from '../migrations/ai-control-001.mjs'
import { displayName } from '../instance/account-summary.mjs'

// A wrong ai.control section in the settings stops the start with a plain message.
const dbLayer = fileDbLayer(Meteor.settings)

const raw = {
  providers: AIProviders.rawCollection(),
  models: AIModels.rawCollection(),
  bindings: AIBindings.rawCollection(),
  bindingVersions: AIBindingVersions.rawCollection(),
  agents: AIAgents.rawCollection(),
  prompts: AIPrompts.rawCollection(),
  promptVersions: AIPromptVersions.rawCollection(),
  state: AIControlState.rawCollection(),
  audit: AIControlAudit.rawCollection(),
}

const read = {
  generation: async () => (await raw.state.findOne({ _id: STATE_ID }, { projection: { generation: 1 } }))?.generation ?? 0,
  async all() {
    const [state, providers, connections, models, bindings, prompts, agents] = await Promise.all([
      raw.state.findOne({ _id: STATE_ID }),
      raw.providers.find({ status: { $ne: 'archived' } }).toArray(),
      // the server's connections, never their keys
      ProviderKeys.rawCollection().find({ ownerType: 'server', ownerId: 'server', provider: { $ne: 'daily' } },
        { projection: { cipher: 0, previousCipher: 0 } }).toArray().then((docs) => docs.filter((doc) => doc.name)),
      raw.models.find({}).toArray(),
      raw.bindings.find({}).toArray(),
      raw.prompts.find({ status: { $ne: 'archived' } }).toArray(),
      raw.agents.find({}).toArray(),
    ])
    // only the prompt versions something uses: each head's published one and any a binding pins
    const wanted = new Set(prompts.filter((p) => p.labels?.published).map((p) => `${p._id}@${p.labels.published}`))
    for (const binding of bindings) {
      for (const ref of Object.values(binding.prompts || {})) {
        const pin = parsePromptRef(ref)
        if (pin?.version) wanted.add(`${pin.id}@${pin.version}`)
      }
    }
    const promptVersions = wanted.size ? await raw.promptVersions.find({ _id: { $in: [...wanted] } }).toArray() : []
    return { state, providers, connections: connections.map((doc) => ({ ...doc, hasKey: Boolean(doc.last4) })), models, bindings, prompts, promptVersions, agents }
  },
}

export const snapshotHolder = createSnapshotHolder({
  read,
  settings: Meteor.settings,
  fileConnections: () => operatorConfig(Meteor.settings).connections.map((c) => c.name),
})

export const aiControlStore = createControlStore({
  collections: raw,
  newId: () => Random.id(),
  onWrite: () => snapshotHolder.refresh({ force: true }),
})

export const aiControl = createAIControl({
  holder: snapshotHolder,
  choiceHolders: (userId) => aiSettings.choiceHolders(userId),
  settings: Meteor.settings,
  isPriced,
  providerView: (snap) => providersView(snap),
  // a binding that kept failing on this pod (breaker.mjs) shows with the snapshot's health
  extraHealth: () => requestBreaker.health(),
})

/** Bindings: drafts, publish, rollback and removal (bindings.mjs), for the ai.bindings.* actions. */
export const aiBindings = createBindingOps({
  store: aiControlStore,
  bindings: raw.bindings,
  versions: raw.bindingVersions,
  snapshot: () => snapshotHolder.current(),
  // the server's connections a chain may name: the settings file's and the app's
  connections: async () => (await aiSettings.serverState()).connections.map((c) => ({ name: c.name, status: c.disabled ? 'disabled' : 'active', capabilities: c.capabilities || {} })),
  breaker: requestBreaker,
})

// Every AI request asks this for its surface (ai-settings-core.mjs resolveFor): a published binding
// turns it off, or gives it a model chain, parameters and tools. A surface whose binding kept
// failing on this pod is served from the settings file and built-in AI until the breaker closes.
aiSettings.setBindingSource(async ({ surface, userId, orgId, holders }) => {
  const snapshot = await snapshotHolder.ready()
  return applyBreaker(resolveBinding(snapshot, { surface, userId, orgId, holders, settings: Meteor.settings }), requestBreaker)
})
// The keys of the services beside the models saved in the app (picture search, icons, Stability,
// transcription) apply only while the DB layer is on; switched off, the settings file's keys apply,
// exactly as before AI control.
aiSettings.setAuxKeysOn(() => dbLayer !== 'off' && snapshotHolder.current().dbLayer !== 'off')
// ai.update at the server level writes the server's bindings too (spec 4), so they never disagree.
aiSettings.setServerUseSync(({ changes, actor, reason }) => aiBindings.syncServerUse({ actor, changes, reason }))
// A binding's limits tighten the meter's estimate and ceiling for its surface, from the next call.
setLimitSource((feature) => limitsFor(snapshotHolder.current(), feature))

// The providers an administrator added are connection types (connections.mjs), and the prices set
// on models win in the meter (metering/prices.mjs): both read the snapshot, so a change reaches
// every pod within one poll, with no restart.
setProviderSource(() => snapshotHolder.current().providers)
setDbPriceSource((model, where) => dbPriceFor(snapshotHolder.current(), model, where))

// The endpoint rules for the server's own configuration (an administrator's provider address).
const serverRules = () => endpointRules({ hosted, level: 'server', privateEndpoints: operatorConfig(Meteor.settings).privateEndpoints })

/** ai.providers.save / archive and ai.models.save (models.mjs). */
export const aiCatalog = createCatalogOps({
  store: aiControlStore,
  snapshot: () => snapshotHolder.current(),
  aiSettings,
  checkUrl: (url) => checkEndpointUrl(url, serverRules()),
  assertHost: (url) => assertEndpointHost(url, serverRules()),
  // archived providers are not in the snapshot; a change reads the stored document
  readProvider: (id) => raw.providers.findOne({ _id: id }),
})

/** AI control writes per administrator: 60 in 10 minutes (spec 4). */
export const aiControlWriteLimit = createWriteLimit()

/** Whether a person may read and change AI control: an administrator of this server. */
export const isAIControlAdmin = isServerAdmin

// ai.update (the AI settings, every level) records its changes in the same audit trail.
setAISettingsAudit((entry) => aiControlStore.record(entry))

/** The audit trail, usage per surface and reset, for the ai.control.* and ai.audit.* actions. */
export const aiControlOps = createAdminOps({
  store: aiControlStore,
  audit: raw.audit,
  aiAudit: AIAudit.rawCollection(),
  aiSettings,
  costOf: aiCostMicros,
  bindings: aiBindings,
  // the Changes tab names people, never their account ids (ai.audit.list is administrators only)
  namesOf: async (userIds) => {
    const users = await Meteor.users.rawCollection().find({ _id: { $in: userIds } }, { projection: { profile: 1, emails: 1, username: 1 } }).toArray()
    return Object.fromEntries(users.map((user) => [user._id, displayName(user) || user.profile?.name || user.username || 'an account with no name']))
  },
})

// ai.surfaces.status: for every signed-in page, whether each AI surface is on and the message to
// show when an administrator turned it off. No models, prompts or connections. It follows the
// snapshot: a change reaches open pages within one poll. Signed-in only; one shared computation
// and one timer for every subscriber (admin.mjs createStatusHub).
const statusHub = createStatusHub({
  // On and off come from the snapshot alone (the global switch and the server bindings), the same
  // for everyone, so this reads no database; which model answers is never part of it.
  compute: async () => surfacesStatus({
    surfaces: SURFACES,
    snapshot: aiControl.snapshot(),
    bind: (surface) => resolveBinding(aiControl.snapshot(), { surface, holders: { ownProviders: false }, settings: Meteor.settings }),
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

if (dbLayer === 'off') console.warn('ai-control: the DB layer is switched off in the settings file (ai.control.dbLayer); the settings file and built-in defaults apply')

Meteor.startup(() => {
  ensureAIControlIndexes(raw, { auditDays: Meteor.settings?.ai?.auditDays })
    .catch((error) => console.error('ai-control: could not create indexes:', error.message))
  // the Overview's calls, failures and spend per surface read the last day of aiAudit
  AIAudit.rawCollection().createIndex({ created: -1 }, { name: 'created_desc' })
    .catch((error) => console.error('ai-control: could not create the aiAudit index:', error.message))
  snapshotHolder.start()
  // the server's AI choices become bindings, once per database (migrations/ai-control-001.mjs)
  if (dbLayer !== 'off') {
    snapshotHolder.ready()
      .then(() => runAIControl001({ state: raw.state, aiSettings, ops: aiBindings, snapshot: () => snapshotHolder.current(), settings: Meteor.settings }))
      .catch((error) => console.error('ai-control-001: the server\'s AI choices were not moved to bindings; they keep working as choices:', error.message))
  }
  // a rotated key's grace period ends: the key it replaced is dropped (spec 6.3), checked hourly
  const keyStore = createConnectionStore({ keys: ProviderKeys.rawCollection(), choices: AIChoices.rawCollection() })
  const clearGrace = () => keyStore.clearExpiredGrace(new Date())
    .catch((error) => console.warn('ai-control: expired key grace not cleared:', error.message))
  clearGrace()
  Meteor.setInterval(clearGrace, 60 * 60 * 1000)
})
