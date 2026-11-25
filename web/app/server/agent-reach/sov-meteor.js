/* eslint-disable no-console */
// The Meteor side of share of voice (sov-core.mjs): the runs collection, the settings row in
// systemSettings, the model providers AI control has keys for, the weekly tick on Slatebox Cloud,
// and the admin methods (administrators of this server only). On another server the job is off
// unless the operator sets SLATEBOX_SHARE_OF_VOICE=on.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Random } from 'meteor/random'
import CONSTANTS from '../../imports/api/common/constants'
import { SystemSettings } from '../../imports/api/common/models'
import { isInstanceAdmin } from '../permissions'
import { cloudOn } from '../cloud-lock-meteor'
import { aiControl, aiKeys } from '../ai-control/index.mjs'
import { defaultRoute } from '../ai-control/resolve.mjs'
import { guardedFetch, hosted } from '../methods/ai/ai-settings'
import { operatorConfig } from '../methods/ai/connections.mjs'
import { endpointRules } from '../methods/ai/endpoint-policy.mjs'
import { plainChat } from './plain-chat.mjs'
import { createShareOfVoice, ensureShareOfVoiceIndexes } from './sov-core.mjs'

const ShareOfVoiceRuns = new Mongo.Collection('shareOfVoiceRuns')
const runs = ShareOfVoiceRuns.rawCollection()
const CHAT = new Set(['openai-chat', 'anthropic-messages'])
const TICK_MS = 60 * 60 * 1000

export const shareOfVoiceOn = () => cloudOn() || /^on$/i.test(String(process.env.SLATEBOX_SHARE_OF_VOICE || ''))

// Every model provider with a key and a chat model: the default's model where the default is that
// provider's, else its first enabled model.
async function providers() {
  const snap = aiControl.snapshot()
  const fallback = defaultRoute(snap)
  const out = []
  for (const provider of Object.values(snap.providers || {})) {
    if (!CHAT.has(provider.protocol) || provider.status === 'disabled' || !provider.baseUrl) continue
    if (!snap.keys?.[provider._id] && !(await aiKeys.hasKey(provider._id))) continue
    const model = fallback?.provider === provider._id && !fallback.error
      ? fallback.model
      : Object.values(snap.models || {}).find((m) => m.provider === provider._id && m.status !== 'disabled')?.model
    if (model) out.push({ provider: provider._id, label: provider.label || provider._id, model, baseUrl: provider.baseUrl })
  }
  return out
}

const rules = () => endpointRules({ hosted, level: 'server', privateEndpoints: operatorConfig(Meteor.settings).privateEndpoints })

async function ask({ provider, model, question, system }) {
  const target = (await providers()).find((p) => p.provider === provider)
  if (!target) throw new Error('This provider has no key or model now.')
  const key = await aiKeys.keyFor(provider)
  if (key.error) throw new Error(key.error)
  return plainChat({ connection: { type: provider, baseUrl: target.baseUrl, apiKey: key.apiKey, model }, system, user: question, fetchImpl: guardedFetch(rules()), maxTokens: 1200 })
}

export const shareOfVoice = createShareOfVoice({
  runs,
  settings: SystemSettings.rawCollection(),
  providers,
  ask,
  enabled: shareOfVoiceOn,
  newId: () => Random.id(),
})

async function requireAdmin(userId) {
  if (!userId || (await isInstanceAdmin(userId)) !== true) throw new Meteor.Error('denied', 'Only an administrator of this server can see share of voice.')
}
const asMeteorError = (error) => (error instanceof Meteor.Error ? error : new Meteor.Error(error?.code || 'share-of-voice', error?.message || 'Share of voice could not do that.'))

Meteor.methods({
  async [CONSTANTS.methods.admin.shareOfVoice]() {
    await requireAdmin(this.userId)
    return shareOfVoice.view()
  },
  async [CONSTANTS.methods.admin.shareOfVoiceQuestions](questions) {
    await requireAdmin(this.userId)
    try {
      return questions === null ? await shareOfVoice.resetQuestions(this.userId) : await shareOfVoice.setQuestions(questions, this.userId)
    } catch (error) {
      throw asMeteorError(error)
    }
  },
  async [CONSTANTS.methods.admin.shareOfVoiceRun]() {
    await requireAdmin(this.userId)
    try {
      const { started } = await shareOfVoice.runNow(this.userId)
      return { started }
    } catch (error) {
      throw asMeteorError(error)
    }
  },
})

Meteor.startup(() => {
  ensureShareOfVoiceIndexes(runs).catch((error) => console.warn(`share-of-voice: index not made (${error.message})`))
  // every hour each process asks whether the week is up; one claims the run (sov-core claim)
  const tick = () => shareOfVoice.tick().catch((error) => console.warn(`share-of-voice: ${error.message}`))
  Meteor.setTimeout(tick, 10 * 60 * 1000)
  Meteor.setInterval(tick, TICK_MS)
})
