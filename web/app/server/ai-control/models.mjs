// Providers, models and prices as an administrator changes them (spec 1.1, 1.3, 3.2, 3.3): the
// logic behind ai.providers.save / archive and ai.models.save. Every write goes through the control
// store (the document, its audit row and the generation in one call), so each pod picks it up
// within one poll. Connections stay in providerKeys (ai-settings-core.mjs saveServerConnections).
//
// Pure apart from the injected store, AI settings and address checks.
import { MAX_PRICE_PER_MILLION } from '../metering/prices.mjs'
import { BUILTIN_PROVIDERS, PROVIDER_CAPS, ProviderError, mergeProviderInput, mergeProviders, normalizeProvider, publicProvider } from './providers.mjs'

// The built-in AI's own connections a model row may name (the snapshot accepts the same).
export const BUILTIN_CONNECTIONS = Object.freeze(['deepinfra', 'openai', 'anthropic', 'stabilityai'])
const MODEL_NAME = /^[^\r\n]{1,200}$/
const MAX_IMAGE_PRICE = 10

export class ModelError extends Error {
  constructor(message, status = 400, details = undefined) {
    super(message)
    this.name = 'ModelError'
    this.status = status
    this.details = details
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** A model row's id: <connection name>:<model> for a server connection, builtin:<provider>:<model> for the built-in AI. */
export function modelId(connection, model) {
  const [scope, name] = String(connection).split(':')
  return scope === 'builtin' ? `builtin:${name}:${model}` : `${name}:${model}`
}

/**
 * Checks one model row an administrator saves. serverConnections: the server connection names a row
 * may name (the settings file's and the app's). → the document to store (without _id and version).
 */
export function normalizeModel(input, { serverConnections = [] } = {}) {
  if (!isObject(input)) throw new ModelError('A model is an object with a connection and a model name.')
  const match = typeof input.connection === 'string' && /^(server|builtin):([a-z0-9][a-z0-9-]{0,39})$/.exec(input.connection)
  if (!match) throw new ModelError('connection is server:<name> or builtin:<provider>.')
  const [, scope, name] = match
  if (scope === 'builtin' && !BUILTIN_CONNECTIONS.includes(name)) throw new ModelError(`builtin:${name} is not one of the built-in AI's connections (${BUILTIN_CONNECTIONS.join(', ')}).`)
  if (scope === 'server' && !serverConnections.includes(name)) throw new ModelError(`There is no server connection ${name}.`)
  const model = typeof input.model === 'string' ? input.model.trim() : ''
  if (!MODEL_NAME.test(model)) throw new ModelError('model is the name the provider serves, one line of at most 200 characters.')
  const label = input.label === undefined || input.label === null ? null : String(input.label).trim()
  if (label !== null && (label.length > 80 || /[\r\n]/.test(label))) throw new ModelError('label is at most 80 characters on one line.')
  const capabilities = {}
  if (input.capabilities !== undefined && input.capabilities !== null) {
    if (!isObject(input.capabilities)) throw new ModelError('capabilities is an object of true/false flags.')
    for (const [key, value] of Object.entries(input.capabilities)) {
      if (!PROVIDER_CAPS.includes(key) || typeof value !== 'boolean') throw new ModelError(`capabilities takes ${PROVIDER_CAPS.join(', ')}, each true or false.`)
      capabilities[key] = value
    }
  }
  const whole = (key, max) => {
    const value = input[key]
    if (value === undefined || value === null) return null
    if (!Number.isInteger(value) || value < 1 || value > max) throw new ModelError(`${key} is a whole number from 1 to ${max}.`)
    return value
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
    const extra = Object.keys(input.prices).find((key) => !['inputPerM', 'outputPerM', 'imageEach', 'currency'].includes(key))
    if (extra) throw new ModelError(`${extra} is not a price field (inputPerM, outputPerM, imageEach).`)
    if (input.prices.currency !== undefined && input.prices.currency !== 'USD') throw new ModelError('Prices are in US dollars (currency USD).')
    prices = { inputPerM: price('inputPerM', MAX_PRICE_PER_MILLION), outputPerM: price('outputPerM', MAX_PRICE_PER_MILLION), imageEach: price('imageEach', MAX_IMAGE_PRICE), currency: 'USD' }
    if ((prices.inputPerM === null) !== (prices.outputPerM === null)) throw new ModelError('Give both inputPerM and outputPerM, or neither.')
  }
  const status = input.status === undefined ? 'enabled' : input.status
  if (!['enabled', 'disabled'].includes(status)) throw new ModelError('status is enabled or disabled.')
  return {
    connection: input.connection, model, label, capabilities,
    maxContext: whole('maxContext', 10_000_000), maxOutput: whole('maxOutput', 1_000_000),
    prices, status, source: input.source === 'probe' ? 'probe' : 'admin',
  }
}

/**
 * The price an administrator set for a model (metering/prices.mjs setDbPriceSource). where: the
 * connection that served the call ({ connection: 'server:<name>' | 'builtin', provider }): only the
 * row of that connection and model applies, so a price set on one connection never changes what a
 * call through another (or through the built-in AI) costs. Without where (whether a model is
 * priced at all), the dearest enabled row that serves the name. → { inPerMillion, outPerMillion,
 * id, builtin } or null.
 */
export function dbPriceFor(snapshot, model, where = null) {
  const served = where?.connection
    ? (where.connection === 'builtin' ? (where.provider ? `builtin:${where.provider}` : null) : String(where.connection))
    : undefined
  if (served === null) return null
  let best = null
  for (const row of Object.values(snapshot?.models || {})) {
    if (row.model !== model || row.status === 'disabled') continue
    if (served !== undefined && row.connection !== served) continue
    const p = row.prices
    if (!p || !Number.isFinite(p.inputPerM) || !Number.isFinite(p.outputPerM)) continue
    if (!best || p.inputPerM + p.outputPerM > best.inPerMillion + best.outPerMillion) {
      best = { inPerMillion: p.inputPerM, outPerMillion: p.outputPerM, id: row._id, builtin: String(row.connection).startsWith('builtin:') }
    }
  }
  return best
}

/** The published bindings whose model chain names one of these server connections, or a model of one. */
export function bindingsUsing(snapshot, names) {
  const refs = new Set(names.map((name) => `server:${name}`))
  const models = new Set(Object.values(snapshot?.models || {}).filter((m) => refs.has(m.connection)).map((m) => m._id))
  return Object.values(snapshot?.bindings || {}).filter((b) => (b.chain || []).some((entry) => models.has(entry.model) || refs.has(entry.connection))).map((b) => b._id)
}

/** The providers an administrator reads: the built-in rows and the administrators' own, active and archived. */
export function providersView(snapshot, archived = []) {
  const merged = mergeProviders(snapshot?.providers || {})
  return [...Object.values(merged).map((p) => publicProvider({ ...p, version: snapshot?.providers?.[p._id]?.version })), ...archived.map((p) => publicProvider({ ...p, status: 'archived' }))]
}

/**
 * deps: {
 *   store       ai-control store.mjs (write: document + audit row + generation)
 *   snapshot()  the current snapshot
 *   aiSettings  ai-settings-core.mjs (server connections, dropping keys on an address change)
 *   checkUrl(url) → the address, or throws (endpoint rules for the server's own configuration)
 *   assertHost?(url) → resolves when every address of the name is allowed
 *   readProvider?(id) → the stored provider document, archived ones included (for a change)
 * }
 */
export function createCatalogOps({ store, snapshot, aiSettings, checkUrl, assertHost = async () => {}, readProvider = async (id) => snapshot()?.providers?.[id] ?? null }) {
  async function saveProvider({ userId, actor, input, dropKeys = false, reason = null }) {
    let doc
    // what the change leaves out keeps its stored value (providers.mjs mergeProviderInput)
    const previous = BUILTIN_PROVIDERS[input?.id ?? input?._id] ? null : await readProvider(input?.id ?? input?._id)
    try {
      doc = normalizeProvider(mergeProviderInput(input, previous), { checkUrl })
      if (doc.baseUrl) await assertHost(doc.baseUrl)
    } catch (error) {
      if (error instanceof ProviderError || error?.name === 'EndpointRefused') throw new ModelError(error.message)
      throw error
    }
    // a provider whose address changes never sends its connections' keys to the new one (spec 6.2)
    const moved = previous && (previous.baseUrl ?? null) !== (doc.baseUrl ?? null)
    let dropped = []
    if (moved) {
      const keyed = (await aiSettings.connectionsOfProvider(doc._id)).filter((c) => c.hasKey).map((c) => c.name)
      if (keyed.length && !dropKeys) {
        throw new ModelError(`Changing ${doc._id}'s address removes the keys of ${keyed.join(', ')}: they are never sent to a new address. Send dropKeys true to go ahead.`, 409, { connections: keyed })
      }
      if (keyed.length) dropped = await aiSettings.dropProviderKeys(doc._id)
    }
    const version = (previous?.version ?? 0) + 1
    const result = await store.write({ kind: 'providers', id: doc._id, doc: { ...doc, version }, action: 'ai.providers.save', actor, reason })
    return { provider: publicProvider({ ...doc, version }), droppedKeys: dropped, generation: result.generation, userId }
  }

  async function archiveProvider({ actor, id, reason }) {
    if (BUILTIN_PROVIDERS[id]) throw new ModelError(`${id} is a built-in provider and cannot be archived.`)
    const previous = await readProvider(id)
    if (!previous) throw new ModelError(`There is no provider ${id}.`, 404)
    const using = await aiSettings.connectionsOfProvider(id)
    if (using.length) throw new ModelError(`Connections still use ${id}: ${using.map((c) => c.name).join(', ')}. Remove them first.`, 409, { connections: using.map((c) => c.name) })
    const { _id: _ignored, updatedAt: _u, updatedBy: _b, ...rest } = previous
    const result = await store.write({ kind: 'providers', id, doc: { ...rest, status: 'archived', version: (previous.version ?? 0) + 1 }, action: 'ai.providers.archive', actor, reason })
    return { id, status: 'archived', generation: result.generation }
  }

  async function saveModels({ userId, actor, models, reason = null }) {
    const server = await aiSettings.serverState()
    const serverConnections = server.connections.map((c) => c.name)
    // every row is checked before anything is written
    const docs = models.map((input) => {
      const doc = normalizeModel(input, { serverConnections })
      return { id: modelId(doc.connection, doc.model), doc }
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
      const result = await store.write({ kind: 'models', id, doc: { ...doc, version: (previous?.version ?? 0) + 1 }, action: 'ai.models.save', actor, reason })
      generation = result.generation
      saved.push({ id, ...doc, version: (previous?.version ?? 0) + 1 })
    }
    return { models: saved, generation, userId }
  }

  return { saveProvider, archiveProvider, saveModels, readProvider }
}

/**
 * AI control writes per administrator (spec 4: 60 per 10 minutes), in memory per process: enough to
 * set up a server, not a loop. take(userId) throws ModelError 429 past the limit.
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
