// Providers, models and prices as an administrator changes them: the logic behind ai.providers.*
// and ai.models.*. Every write goes through the control store (the document, its audit row and the
// generation in one call), so each pod picks it up within one poll. Keys are kept by keys.mjs.
//
// Pure apart from the injected store, key store, address checks and probes.
import { MAX_PRICE_PER_MILLION } from '../metering/prices.mjs'
import { BUILTIN_PROVIDERS, PROVIDER_CAPS, ProviderError, isRealtimeProtocol, mergeProviders, normalizeProvider, publicProvider } from './providers.mjs'
import { PROVIDER_PRESETS, providerFromPreset } from './provider-presets.mjs'
import { modelId } from './snapshot.mjs'

export { modelId }
const MODEL_NAME = /^[^\r\n]{1,200}$/
const MAX_IMAGE_PRICE = 10
// A voice name as providers spell them (Kore, marin, en-US-Chirp3-HD-Kore): letters, digits and . _ -
export const VOICE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const MAX_VOICES = 64
const PRICE_FIELDS = ['inputPerM', 'outputPerM', 'imageEach', 'audioInputPerM', 'audioOutputPerM', 'cachedAudioInputPerM', 'currency']

/** Checks a voice model's voices list: distinct names, at most 64. → the list, or throws ModelError. */
export function normalizeVoices(voices) {
  if (voices === undefined || voices === null) return []
  if (!Array.isArray(voices) || voices.length > MAX_VOICES) throw new ModelError(`voices is a list of at most ${MAX_VOICES} voice names.`)
  const out = []
  for (const name of voices) {
    if (typeof name !== 'string' || !VOICE_NAME.test(name)) throw new ModelError(`${String(name).slice(0, 64)} is not a voice name (letters, digits, dots, dashes and underscores, at most 64).`)
    if (out.includes(name)) throw new ModelError(`${name} is listed twice in voices.`)
    out.push(name)
  }
  return out
}

export class ModelError extends Error {
  constructor(message, status = 400, details = undefined) {
    super(message)
    this.name = 'ModelError'
    this.status = status
    this.details = details
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Checks one model row an administrator saves. providers: the stored providers ({ [id]: doc }).
 * → the document to store (without _id and version).
 */
export function normalizeModel(input, { providers = {} } = {}) {
  if (!isObject(input)) throw new ModelError('A model is an object with a provider and a model id.')
  const provider = providers[input.provider]
  if (typeof input.provider !== 'string' || !provider || provider.status === 'archived') throw new ModelError(`There is no provider ${input.provider}. Add it on Providers and keys first.`)
  const model = typeof input.model === 'string' ? input.model.trim() : ''
  if (!MODEL_NAME.test(model)) throw new ModelError('model is the id the provider serves, one line of at most 200 characters.')
  const label = input.label === undefined || input.label === null || input.label === '' ? null : String(input.label).trim()
  if (label !== null && (label.length > 80 || /[\r\n]/.test(label))) throw new ModelError('The name is at most 80 characters on one line.')
  const capabilities = {}
  if (input.capabilities !== undefined && input.capabilities !== null) {
    if (!isObject(input.capabilities)) throw new ModelError('capabilities is an object of true/false flags.')
    for (const [key, value] of Object.entries(input.capabilities)) {
      if (!PROVIDER_CAPS.includes(key) || typeof value !== 'boolean') throw new ModelError(`capabilities takes ${PROVIDER_CAPS.join(', ')}, each true or false.`)
      capabilities[key] = value
    }
  }
  if (provider.protocol === 'openai-images') capabilities.images = true
  // a realtime provider's models talk (the voice parts) and answer nothing else; no other model talks
  const realtime = isRealtimeProtocol(provider.protocol)
  if (realtime) capabilities.voice = true
  else if (capabilities.voice === true) throw new ModelError('Only a voice provider\'s models talk (a realtime voice provider).')
  else delete capabilities.voice
  const voices = normalizeVoices(input.voices)
  if (voices.length && !realtime) throw new ModelError('Only a voice provider\'s models have voices.')
  let transcriptionModel = null
  if (input.transcriptionModel !== undefined && input.transcriptionModel !== null && input.transcriptionModel !== '') {
    if (!realtime) throw new ModelError('Only a voice provider\'s models take a transcription model.')
    if (typeof input.transcriptionModel !== 'string' || !MODEL_NAME.test(input.transcriptionModel.trim())) throw new ModelError('transcriptionModel is the id of the model that writes what the person said, one line of at most 200 characters.')
    transcriptionModel = input.transcriptionModel.trim()
  }
  let maxOutput = null
  if (input.maxOutput !== undefined && input.maxOutput !== null) {
    if (!Number.isInteger(input.maxOutput) || input.maxOutput < 1 || input.maxOutput > 1_000_000) throw new ModelError('maxOutput is a whole number from 1 to 1000000.')
    maxOutput = input.maxOutput
  }
  let prices = null
  if (input.prices !== undefined && input.prices !== null) {
    if (!isObject(input.prices)) throw new ModelError('prices is { inputPerM, outputPerM, imageEach } in dollars.')
    const price = (key, max) => {
      const value = input.prices[key]
      if (value === undefined || value === null) return null
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new ModelError(`prices.${key} is dollars, a number from 0 to ${max}.`)
      return value
    }
    const extra = Object.keys(input.prices).find((key) => !PRICE_FIELDS.includes(key))
    if (extra) throw new ModelError(`${extra} is not a price field (inputPerM, outputPerM, imageEach${realtime ? ', audioInputPerM, audioOutputPerM, cachedAudioInputPerM' : ''}).`)
    if (input.prices.currency !== undefined && input.prices.currency !== 'USD') throw new ModelError('Prices are in US dollars (currency USD).')
    prices = { inputPerM: price('inputPerM', MAX_PRICE_PER_MILLION), outputPerM: price('outputPerM', MAX_PRICE_PER_MILLION), imageEach: price('imageEach', MAX_IMAGE_PRICE), currency: 'USD' }
    if ((prices.inputPerM === null) !== (prices.outputPerM === null)) throw new ModelError('Give both the input and output price, or neither.')
    // what a voice model's audio costs: what the person says (in) and what the agent says (out)
    const audio = ['audioInputPerM', 'audioOutputPerM', 'cachedAudioInputPerM'].filter((key) => input.prices[key] !== undefined && input.prices[key] !== null)
    if (audio.length && !realtime) throw new ModelError('Only a voice provider\'s models have audio prices.')
    if (realtime) {
      prices.audioInputPerM = price('audioInputPerM', MAX_PRICE_PER_MILLION)
      prices.audioOutputPerM = price('audioOutputPerM', MAX_PRICE_PER_MILLION)
      const cached = price('cachedAudioInputPerM', MAX_PRICE_PER_MILLION)
      if (cached !== null) prices.cachedAudioInputPerM = cached
      if ((prices.audioInputPerM === null) !== (prices.audioOutputPerM === null)) throw new ModelError('Give both the audio input and audio output price, or neither.')
    }
  }
  const status = input.status === undefined ? 'enabled' : input.status
  if (!['enabled', 'disabled'].includes(status)) throw new ModelError('status is enabled or disabled.')
  return { provider: provider._id, model, label, capabilities, maxOutput, prices, status, ...(realtime && { voices, transcriptionModel }) }
}

/**
 * The price an administrator set for a model (metering/prices.mjs setDbPriceSource). where: the
 * provider that served the call ({ provider }): only that provider's row applies, so a price set on
 * one provider never changes what a call through another costs. Without where (whether a model is
 * priced at all), the dearest enabled row that serves the name. → { inPerMillion, outPerMillion, id } or null.
 */
export function dbPriceFor(snapshot, model, where = null) {
  const served = where ? where.provider ?? null : undefined
  if (served === null) return null
  let best = null
  for (const row of Object.values(snapshot?.models || {})) {
    if (row.model !== model || row.status === 'disabled') continue
    if (served !== undefined && row.provider !== served) continue
    const p = row.prices
    if (!p || !Number.isFinite(p.inputPerM) || !Number.isFinite(p.outputPerM)) continue
    if (!best || p.inputPerM + p.outputPerM > best.inPerMillion + best.outPerMillion) best = { inPerMillion: p.inputPerM, outPerMillion: p.outputPerM, id: row._id }
  }
  return best
}

/** The parts of Slatebox bound to a model, or to any model of a provider. */
export function bindingsUsing(snapshot, { model = null, provider = null }) {
  return Object.values(snapshot?.bindings || {})
    .filter((b) => b.use === 'model' && (model ? b.model === model : snapshot.models?.[b.model]?.provider === provider))
    .map((b) => b.surface)
}

/** The providers an administrator reads: the stored model providers (active and archived) and the services. */
export function providersView(snapshot, archived = []) {
  const merged = mergeProviders(snapshot?.providers || {})
  const rows = Object.values(merged).map((p) => publicProvider({ ...p, version: snapshot?.providers?.[p._id]?.version }))
  return [...rows, ...archived.filter((p) => !merged[p._id]).map((p) => publicProvider({ ...p, status: 'archived' }))]
}

/** The presets an administrator picks from (Add a provider), with their suggested models. */
export const presetsView = () => Object.values(PROVIDER_PRESETS).map((p) => ({
  id: p.id, label: p.label, baseUrl: p.baseUrl, baseUrlLocked: p.baseUrlLocked, protocol: p.protocol,
  models: p.models.map((m) => ({
    model: m.model, label: m.label, capabilities: { ...m.capabilities }, prices: m.prices ? { ...m.prices } : null,
    ...(m.voices && { voices: [...m.voices] }), ...(m.transcriptionModel && { transcriptionModel: m.transcriptionModel }),
  })),
}))

/**
 * deps: {
 *   store       ai-control store.mjs (write: document + audit row + generation)
 *   snapshot()  the current snapshot
 *   keys        keys.mjs key store (keyFor, revokeAll, hasKey)
 *   checkUrl(url) → the address, or throws (endpoint rules for the server's own configuration)
 *   assertHost?(url) → resolves when every address of the name is allowed
 *   readProvider?(id) → the stored provider document, archived ones included
 *   listModels?(connection) → { ok, models, message } (connection-check.mjs listModels)
 *   check?(connection) → a test result (connection-check.mjs checkConnection)
 *   checkRealtime?(connection) → the same for a voice provider's model (server/voice/check.mjs)
 * }
 */
export function createCatalogOps({
  store, snapshot, keys = null, checkUrl, assertHost = async () => {}, readProvider = async (id) => snapshot()?.providers?.[id] ?? null,
  listModels = null, check = null, checkRealtime = null,
}) {
  const checked = async (input, { trusted = false } = {}) => {
    try {
      const doc = normalizeProvider(input, { checkUrl })
      if (!trusted && !PROVIDER_PRESETS[doc.preset].baseUrlLocked) await assertHost(doc.baseUrl)
      return doc
    } catch (error) {
      if (error instanceof ProviderError || error?.name === 'EndpointRefused') throw new ModelError(error.message)
      throw error
    }
  }

  async function writeModels({ actor, models, reason, providers }) {
    const docs = models.map((input) => {
      const doc = normalizeModel(input, { providers })
      return { id: modelId(doc.provider, doc.model), doc }
    })
    const ids = new Set()
    for (const { id } of docs) {
      if (ids.has(id)) throw new ModelError(`${id} appears twice in this change.`)
      ids.add(id)
    }
    const saved = []
    let generation = null
    for (const { id, doc } of docs) {
      const previous = snapshot()?.models?.[id]
      const version = (previous?.version ?? 0) + 1
      const result = await store.write({ kind: 'models', id, doc: { ...doc, version }, action: 'ai.models.save', actor, reason })
      generation = result.generation
      saved.push({ id, ...doc, version })
    }
    return { models: saved, generation }
  }

  /**
   * Adds a provider from a preset (input: { preset, id?, label?, baseUrl? (other only), auth?,
   * toolChoice?, extraHeaders? }), with the preset's suggested models named in models (model ids).
   * An archived provider of the same id comes back. → { provider, models, generation }
   */
  async function addProvider({ actor, input, models = [], reason = null }) {
    const p = PROVIDER_PRESETS[input?.preset]
    if (!p) throw new ModelError(`preset is one of ${Object.keys(PROVIDER_PRESETS).join(', ')}.`)
    const id = input.id || input._id || p.id
    if (BUILTIN_PROVIDERS[id]) throw new ModelError(`${id} is a service of this server, not a model provider.`)
    const previous = await readProvider(id)
    if (previous && previous.status !== 'archived') throw new ModelError(`There is already a provider ${id}. Choose another id, or change that one.`, 409)
    const doc = await checked({ ...input, _id: id })
    const version = (previous?.version ?? 0) + 1
    const result = await store.write({ kind: 'providers', id, doc: { ...doc, version }, action: 'ai.providers.add', actor, reason })
    const wanted = p.models.filter((m) => models.includes(m.model))
    const added = wanted.length
      ? await writeModels({
        actor, reason, providers: { ...snapshot().providers, [id]: { ...doc, version } },
        models: wanted.map((m) => ({
          provider: id, model: m.model, label: m.label, capabilities: m.capabilities, prices: m.prices,
          ...(m.voices && { voices: m.voices }), ...(m.transcriptionModel && { transcriptionModel: m.transcriptionModel }),
        })),
      })
      : { models: [], generation: result.generation }
    return { provider: publicProvider({ ...doc, version }), models: added.models, generation: added.generation ?? result.generation }
  }

  /**
   * Changes a provider's name (any provider), or an Other provider's address, key style, tool
   * choice and extra headers. A new address revokes the provider's keys, after revokeKeys true: a
   * key is never sent to a new address. → { provider, revokedKeys, generation }
   */
  async function saveProvider({ actor, input, revokeKeys = false, reason = null }) {
    const id = input?.id ?? input?._id
    const previous = await readProvider(id)
    if (!previous || previous.status === 'archived') throw new ModelError(`There is no provider ${id}.`, 404)
    const { _id: _i, updatedAt: _a, updatedBy: _b, version: _v, ...kept } = previous
    const doc = await checked({ ...kept, ...input, _id: id, preset: previous.preset })
    const moved = (previous.baseUrl ?? null) !== (doc.baseUrl ?? null)
      || JSON.stringify(previous.auth || { style: 'bearer' }) !== JSON.stringify(doc.auth)
    let revokedKeys = []
    if (moved && keys && await keys.hasKey(id)) {
      if (!revokeKeys) throw new ModelError(`Changing where ${doc.label} sends its key revokes its keys: a key is never sent to a new address. Send revokeKeys true to go ahead.`, 409, { revokeKeys: true })
      revokedKeys = await keys.revokeAll({ actor, provider: id, reason: reason || 'The provider\'s address or key style changed' })
    }
    const version = (previous.version ?? 0) + 1
    const result = await store.write({ kind: 'providers', id, doc: { ...doc, version }, action: 'ai.providers.save', actor, reason })
    return { provider: publicProvider({ ...doc, version }), revokedKeys, generation: result.generation }
  }

  /** Archives a provider. Refused while a part of Slatebox uses one of its models. */
  async function archiveProvider({ actor, id, reason }) {
    if (BUILTIN_PROVIDERS[id]) throw new ModelError(`${id} is a service of this server and cannot be archived.`)
    const previous = await readProvider(id)
    if (!previous) throw new ModelError(`There is no provider ${id}.`, 404)
    const using = bindingsUsing(snapshot(), { provider: id })
    if (using.length) throw new ModelError(`Parts of Slatebox still use ${previous.label}: ${using.join(', ')}. Change them on the Bindings tab first.`, 409, { surfaces: using })
    const { _id: _ignored, updatedAt: _u, updatedBy: _b, ...rest } = previous
    const result = await store.write({ kind: 'providers', id, doc: { ...rest, status: 'archived', version: (previous.version ?? 0) + 1 }, action: 'ai.providers.archive', actor, reason })
    return { id, status: 'archived', generation: result.generation }
  }

  /** Adds or changes models. → { models, generation } */
  async function saveModels({ actor, models, reason = null }) {
    return writeModels({ actor, models, reason, providers: snapshot()?.providers || {} })
  }

  /** Removes a model. Refused while a part of Slatebox uses it. */
  async function removeModel({ actor, id, reason = null }) {
    const model = snapshot()?.models?.[id]
    if (!model) throw new ModelError(`There is no model ${id}.`, 404)
    const using = bindingsUsing(snapshot(), { model: id })
    if (using.length) throw new ModelError(`Parts of Slatebox still use ${model.label || model.model}: ${using.join(', ')}. Change them on the Bindings tab first.`, 409, { surfaces: using })
    const result = await store.write({ kind: 'models', id, doc: null, action: 'ai.models.remove', actor, reason })
    return { removed: id, generation: result.generation }
  }

  // A provider's active key as a connection a probe can send (never returned).
  async function connectionOf(providerId, model = null) {
    const provider = snapshot()?.providers?.[providerId]
    if (!provider || provider.status === 'archived') throw new ModelError(`There is no provider ${providerId}.`, 404)
    const key = keys ? await keys.keyFor(providerId, { use: false }) : { error: 'Keys are not available.' }
    if (key.error) throw new ModelError(key.error, 409)
    return { name: providerId, type: providerId, baseUrl: provider.baseUrl, model, apiKey: key.apiKey, capabilities: {} }
  }

  /** The models a provider lists, with its active key. Writes nothing. */
  const realtimeOf = (providerId) => {
    const protocol = snapshot()?.providers?.[providerId]?.protocol
    return isRealtimeProtocol(protocol) ? protocol : null
  }
  // a voice provider lists no models the way a chat provider does: its suggestions are on Add a provider
  const notForVoice = (providerId) => {
    if (realtimeOf(providerId)) throw new ModelError('A voice provider\'s models are not listed here: add them from its suggestions, or by their id.', 409)
  }

  async function discoverModels({ provider }) {
    if (!listModels) throw new ModelError('Listing models is not available on this server.', 503)
    notForVoice(provider)
    const connection = await connectionOf(provider)
    const out = await listModels(connection)
    return { provider, ...out }
  }

  /** Sends one short request to a model with its provider's active key. Writes nothing. */
  async function testModel({ id }) {
    if (!check) throw new ModelError('Testing is not available on this server.', 503)
    const model = snapshot()?.models?.[id]
    if (!model) throw new ModelError(`There is no model ${id}.`, 404)
    const protocol = realtimeOf(model.provider)
    if (protocol && !checkRealtime) throw new ModelError('Testing voice models is not available on this server.', 503)
    const connection = await connectionOf(model.provider, model.model)
    if (protocol) return { id, ...(await checkRealtime({ ...connection, protocol })) }
    return { id, ...(await check(connection)) }
  }

  /**
   * A provider from a preset when none of that id exists (ai-control-002 imports keys and the
   * route of today into it). → the stored provider document
   */
  // trusted: the address came from the operator's own settings file, so its name is not looked up again
  async function ensureProvider({ actor, preset, id = null, baseUrl = null, label = null, action = 'ai.providers.add', reason = null, trusted = false }) {
    const row = providerFromPreset(preset, { id, baseUrl, label })
    const previous = await readProvider(row._id)
    if (previous && previous.status !== 'archived') return previous
    const doc = await checked(row, { trusted })
    const version = (previous?.version ?? 0) + 1
    await store.write({ kind: 'providers', id: doc._id, doc: { ...doc, version }, action, actor, reason })
    return { ...doc, version }
  }

  return { addProvider, saveProvider, archiveProvider, saveModels, removeModel, discoverModels, testModel, ensureProvider, readProvider }
}

/**
 * AI control writes per administrator (60 per 10 minutes), in memory per process: enough to set up
 * a server, not a loop. take(userId) throws ModelError 429 past the limit.
 */
export function createWriteLimit({ count = 60, windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const by = new Map()
  return {
    take(userId) {
      const at = now()
      const recent = (by.get(userId) || []).filter((t) => at - t < windowMs)
      if (recent.length >= count) {
        by.set(userId, recent)
        throw new ModelError('Too many AI control changes. Wait a few minutes and try again.', 429, { retryAfter: Math.ceil((windowMs - (at - recent[0])) / 1000) })
      }
      recent.push(at)
      by.set(userId, recent)
    },
  }
}
