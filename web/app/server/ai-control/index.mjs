// The AI control plane's Meteor glue: the one aiControl instance every AI path and the admin
// actions use. It loads the snapshot of the DB layer at start, checks the generation every 5 s
// and reloads when it moved (snapshot.mjs), and writes through store.mjs.
//
// Break-glass: settings.ai.control.dbLayer 'off' (settings file, restart) never reads the DB
// layer; Slatebox then behaves exactly as it did before AI control existed.
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import {
  AIAgents, AIBindingVersions, AIBindings, AIControlAudit, AIControlState, AIModels, AIPromptVersions, AIPrompts, AIProviders, ProviderKeys,
} from '../../imports/api/common/models'
import { aiSettings, isServerAdmin } from '../methods/ai/ai-settings'
import { operatorConfig } from '../methods/ai/connections.mjs'
import { createSnapshotHolder, fileDbLayer, parsePromptRef } from './snapshot.mjs'
import { STATE_ID, createControlStore, ensureAIControlIndexes } from './store.mjs'
import { createAIControl } from './facade.mjs'

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
})

/** Whether a person may read and change AI control: an administrator of this server. */
export const isAIControlAdmin = isServerAdmin

if (dbLayer === 'off') console.warn('ai-control: the DB layer is switched off in the settings file (ai.control.dbLayer); the settings file and built-in defaults apply')

Meteor.startup(() => {
  ensureAIControlIndexes(raw, { auditDays: Meteor.settings?.ai?.auditDays })
    .catch((error) => console.error('ai-control: could not create indexes:', error.message))
  snapshotHolder.start()
})
