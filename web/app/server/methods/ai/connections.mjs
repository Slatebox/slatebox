// AI connections and choices. A connection is a provider the person, their team or the operator
// connected: a cloud provider with a key, or any OpenAI-compatible endpoint (a model on their own
// computer, their network or a host) with an address, an optional key and a model name. A choice
// says which connection each feature uses, with a default for the rest. People mix freely: no
// rule ties a feature to a kind of provider, and Slatebox never routes a request somewhere the
// person did not choose. Nothing here names a model.
import { EndpointRefused, checkEndpointUrl, endpointRules } from './endpoint-policy.mjs'

// What the person chooses per feature, and what each needs from a model.
export const AI_FEATURES = Object.freeze([
  Object.freeze({ id: 'chat', title: 'Conversation and edits', verb: 'call tools', needs: Object.freeze(['tools']) }),
  Object.freeze({ id: 'generation', title: 'Drafts and layouts', verb: 'call tools', needs: Object.freeze(['tools']) }),
  Object.freeze({ id: 'presentation', title: 'Presentation planning', verb: 'call tools', needs: Object.freeze(['tools']) }),
  Object.freeze({ id: 'vision', title: 'Reading images and diagrams', verb: 'read images', needs: Object.freeze(['vision']) }),
  Object.freeze({ id: 'images', title: 'Generating images', verb: 'make images', needs: Object.freeze(['images']) }),
  Object.freeze({ id: 'shape', title: 'Drawing custom shapes', verb: 'call tools', needs: Object.freeze(['tools']) }),
])
const FEATURE_IDS = AI_FEATURES.map((f) => f.id)
export const USE_KEYS = Object.freeze(['default', ...FEATURE_IDS])

// The features the server's AI paths name, by the choice that serves them.
const REQUEST_FEATURES = Object.freeze({
  welcome: 'chat', workshop: 'chat', 'lane-chat': 'chat', 'map-chat': 'chat',
  generation: 'generation', layout: 'generation', presentation: 'presentation', vision: 'vision',
  'image-generation': 'images', images: 'images', chat: 'chat', shape: 'shape',
})
// Paths that are not a model at all (image search, video calls): the built-in service serves them.
export const BUILTIN_ONLY_FEATURES = Object.freeze(['image-search', 'call'])
/**
 * The choice that serves a request feature. A router step (<feature>-route, such as the chat edit
 * router welcome-route) belongs to its feature. A feature nobody has listed yet follows the
 * conversation choice: a request is never sent to the built-in AI behind the person's back.
 */
export function choiceFeatureFor(feature) {
  if (BUILTIN_ONLY_FEATURES.includes(feature)) return null
  if (REQUEST_FEATURES[feature]) return REQUEST_FEATURES[feature]
  if (typeof feature === 'string' && feature.endsWith('-route')) return choiceFeatureFor(feature.slice(0, -'-route'.length))
  return 'chat'
}

// Whether a request's prompts carry an image part (OpenAI image_url, or Anthropic image with a
// base64 source). Text that merely mentions base64 does not count.
export function carriesImages(prompts) {
  const seen = (value) => {
    if (!value || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some(seen)
    if (value.type === 'image_url' || value.type === 'image' || value.type === 'input_image') return true
    return seen(value.content)
  }
  return seen(prompts || [])
}

// Cloud presets fill in their own address. Any other host is an OpenAI-compatible endpoint.
export const CONNECTION_TYPES = Object.freeze({
  'openai-compatible': Object.freeze({ label: 'OpenAI-compatible endpoint' }),
  deepinfra: Object.freeze({ label: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai', keyRequired: true, modelOptional: true }),
  openai: Object.freeze({ label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyRequired: true }),
  anthropic: Object.freeze({ label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', keyRequired: true }),
})
const CAPABILITIES = ['tools', 'vision', 'images']

export class ConnectionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConnectionError'
  }
}

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
// The name of an environment variable that holds a connection's key (the operator's settings file
// only): the key itself stays in the environment and is read for each request (keyFromEnv).
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/
export const TOOL_CHOICES = Object.freeze(['auto', 'named', 'required'])

/**
 * Checks one connection as a person, team admin, administrator or settings file gives it.
 * context: { hosted, level: 'person' | 'team' | 'server' | 'file' }
 * → { name, type, baseUrl, model?, apiKey?, apiKeyEnv?, capabilities, maxTokens?, toolChoice? }
 * apiKeyEnv (level 'file' only) names the environment variable that holds the key.
 * toolChoice says how the endpoint takes a forced tool call: named (that function), required
 * (some tool; for endpoints with no named form) or auto (the model decides; for endpoints that
 * refuse anything else). req.js's shape checks and retries judge a wrong or missing call.
 */
export function normalizeConnection(input, { hosted, level, privateEndpoints = true }) {
  if (!input || typeof input !== 'object') throw new ConnectionError('A connection is an object with a name, type, address and model.')
  const { name, type } = input
  if (typeof name !== 'string' || !NAME.test(name)) throw new ConnectionError('Name the connection with lowercase letters, digits and dashes, for example my-model.')
  const preset = CONNECTION_TYPES[type]
  if (!preset) throw new ConnectionError(`Choose a type: ${Object.keys(CONNECTION_TYPES).join(', ')}.`)
  let baseUrl
  if (preset.baseUrl) {
    if (input.baseUrl !== undefined && input.baseUrl !== null && input.baseUrl.replace?.(/\/+$/, '') !== preset.baseUrl) {
      throw new ConnectionError(`${preset.label} has its own address. For another host, use the type openai-compatible.`)
    }
    baseUrl = preset.baseUrl
  } else {
    try {
      baseUrl = checkEndpointUrl(input.baseUrl, endpointRules({ hosted, level, privateEndpoints }))
    } catch (error) {
      throw new ConnectionError(error instanceof EndpointRefused ? error.message : 'Enter the address of your model.')
    }
  }
  const model = typeof input.model === 'string' ? input.model.trim() : input.model
  if (model !== undefined && model !== null && (typeof model !== 'string' || !model || model.length > 200 || /[\r\n]/.test(model))) {
    throw new ConnectionError('Enter the model name your endpoint serves.')
  }
  if (!model && !preset.modelOptional) throw new ConnectionError('Enter the model name your endpoint serves.')
  const apiKey = input.apiKey
  if (apiKey !== undefined && apiKey !== null && (typeof apiKey !== 'string' || /[\r\n]/.test(apiKey) || apiKey.length > 400)) {
    throw new ConnectionError('Paste the key on one line.')
  }
  const { apiKeyEnv } = input
  if (apiKeyEnv !== undefined && apiKeyEnv !== null) {
    if (level !== 'file') throw new ConnectionError('apiKeyEnv is only for connections in the server\'s settings file. Send the key itself.')
    if (typeof apiKeyEnv !== 'string' || !ENV_NAME.test(apiKeyEnv)) throw new ConnectionError('apiKeyEnv is the name of an environment variable in capitals, digits and underscores, for example META_API_KEY.')
    if (apiKey) throw new ConnectionError('Give apiKey or apiKeyEnv, not both.')
  }
  if (preset.keyRequired && !apiKey && !apiKeyEnv && !input.keepKey) throw new ConnectionError(`${preset.label} needs a key.`)
  const capabilities = {}
  if (input.capabilities !== undefined) {
    if (!input.capabilities || typeof input.capabilities !== 'object' || Array.isArray(input.capabilities)) throw new ConnectionError('capabilities is an object of tools, vision and images, each true or false.')
    for (const [key, value] of Object.entries(input.capabilities)) {
      if (!CAPABILITIES.includes(key) || typeof value !== 'boolean') throw new ConnectionError('capabilities is an object of tools, vision and images, each true or false.')
      capabilities[key] = value
    }
  }
  const out = { name, type, baseUrl, ...(model && { model }), capabilities }
  if (apiKey) out.apiKey = apiKey
  if (apiKeyEnv) out.apiKeyEnv = apiKeyEnv
  if (input.maxTokens !== undefined && input.maxTokens !== null) {
    if (!Number.isInteger(input.maxTokens) || input.maxTokens < 256 || input.maxTokens > 200000) throw new ConnectionError('maxTokens is a whole number from 256 to 200000.')
    out.maxTokens = input.maxTokens
  }
  if (input.toolChoice !== undefined && input.toolChoice !== null) {
    if (!TOOL_CHOICES.includes(input.toolChoice)) throw new ConnectionError('toolChoice is auto, named or required.')
    out.toolChoice = input.toolChoice
  }
  return out
}

// ---------- references ----------
// A choice names a connection by scope and name: me:<name>, team:<name>, server:<name>, or
// builtin (the AI this server provides by default, the operator's own configuration).
const SCOPES_FOR = { me: ['me', 'team', 'server'], team: ['team', 'server'], server: ['server'] }

export function parseRef(ref) {
  if (ref === 'builtin') return { scope: 'builtin' }
  const match = typeof ref === 'string' && /^(me|team|server):([a-z0-9][a-z0-9-]{0,39})$/.exec(ref)
  return match ? { scope: match[1], name: match[2] } : null
}

// Checks a use object against the connections a level can see. Throws ConnectionError.
export function checkUse(use, level, visible) {
  if (!use || typeof use !== 'object' || Array.isArray(use)) throw new ConnectionError('use is an object of default and feature names.')
  const out = {}
  for (const [key, ref] of Object.entries(use)) {
    if (!USE_KEYS.includes(key)) throw new ConnectionError(`${key} is not a feature. The features are ${USE_KEYS.join(', ')}.`)
    if (ref === null) {
      out[key] = null
      continue
    }
    const parsed = parseRef(ref)
    if (!parsed) throw new ConnectionError(`${ref} is not a choice. Name a connection as me:<name>, team:<name> or server:<name>, or use builtin.`)
    if (parsed.scope !== 'builtin') {
      if (!SCOPES_FOR[level].includes(parsed.scope)) throw new ConnectionError(`${ref} cannot be chosen here.`)
      if (!visible[parsed.scope]?.some((c) => c.name === parsed.name)) throw new ConnectionError(`There is no connection ${ref}.`)
    }
    out[key] = ref
  }
  return out
}

// ---------- the operator's configuration ----------
const isSelfHost = (settings) => settings?.public?.env === 'selfhost'

/**
 * The operator's AI from the settings file: settings.ai = { connections: { name: {...} },
 * use: { default, chat, ... } with plain names or builtin, ownProviders: 'on' | 'off',
 * privateEndpoints: 'on' | 'off' (self-host: whether people and teams may connect endpoints on
 * private networks; on by default, the operator's own connections are not affected) }.
 */
export function operatorConfig(settings = {}) {
  const ai = settings.ai || {}
  const hosted = !isSelfHost(settings)
  const connections = []
  for (const [name, raw] of Object.entries(ai.connections || {})) {
    let connection
    try {
      connection = normalizeConnection({ ...raw, name }, { hosted, level: 'file' })
    } catch (error) {
      throw new ConnectionError(`settings ai.connections.${name}: ${error.message}`)
    }
    connections.push({ ...connection, source: 'file' })
  }
  const use = {}
  for (const [key, value] of Object.entries(ai.use || {})) {
    if (!USE_KEYS.includes(key)) throw new ConnectionError(`settings ai.use.${key}: not a feature (${USE_KEYS.join(', ')})`)
    if (value === 'builtin') use[key] = 'builtin'
    else if (connections.some((c) => c.name === value)) use[key] = `server:${value}`
    else throw new ConnectionError(`settings ai.use.${key}: ${value} is not one of ai.connections`)
  }
  if (ai.ownProviders !== undefined && !['on', 'off'].includes(ai.ownProviders)) throw new ConnectionError('settings ai.ownProviders is on or off')
  if (ai.privateEndpoints !== undefined && !['on', 'off'].includes(ai.privateEndpoints)) throw new ConnectionError('settings ai.privateEndpoints is on or off')
  return { connections, use, ownProviders: ai.ownProviders !== 'off', ownProvidersLocked: ai.ownProviders === 'off', privateEndpoints: ai.privateEndpoints !== 'off' }
}

/**
 * A settings-file connection with its key read from the environment now, so a rotated key is used
 * without a restart. → the connection with apiKey, or with error (naming the variable, never a
 * value) when the variable is unset or empty. Other connections are returned as they are.
 */
export function keyFromEnv(connection, env = {}) {
  if (!connection?.apiKeyEnv) return connection
  const value = typeof env[connection.apiKeyEnv] === 'string' ? env[connection.apiKeyEnv].trim() : ''
  if (!value) return { ...connection, keyError: `its key is not set: the environment variable ${connection.apiKeyEnv} is empty or missing on this server` }
  return { ...connection, apiKey: value }
}

// ---------- resolution ----------
const find = (holder, name) => holder?.connections?.find((c) => c.name === name) || null

function fromUse(holder, feature, scopes, people) {
  if (!holder) return null
  for (const key of [feature, 'default']) {
    const parsed = parseRef(holder.use?.[key])
    if (!parsed) continue
    if (parsed.scope === 'builtin') return { ref: 'builtin', scope: 'builtin', connection: null }
    const owner = scopes[parsed.scope]
    const connection = find(owner, parsed.name)
    if (connection) return { ref: `${parsed.scope}:${parsed.name}`, scope: parsed.scope, connection, own: people.includes(parsed.scope) }
  }
  return null
}

// Keys saved before choices existed: a DeepInfra key serves every model feature, an endpoint the
// conversation features, as they did. Neither makes images: generated images stayed with the
// built-in image service before choices existed, and still do unless the person chooses otherwise.
function fromLegacy(holder, feature, scope) {
  if (feature === 'images') return null
  const connection = holder?.connections?.find((c) => c.legacy === 'all' || (c.legacy === 'chat' && feature === 'chat'))
  return connection ? { ref: `${scope}:${connection.name}`, scope, connection, own: true } : null
}

/**
 * Which connection serves one feature. The person first (their choice for the feature, then their
 * default, then keys saved before choices), then their team the same way, then the operator,
 * then the built-in AI. With ownProviders off only the operator's choices count.
 * → { ref, scope: 'me'|'team'|'server'|'builtin', connection|null, own, feature }
 */
export function resolveAIChoice({ feature, person = null, team = null, server = { connections: [], use: {} }, ownProviders = true }) {
  const scopes = { me: person, team, server }
  const steps = ownProviders
    ? [() => fromUse(person, feature, scopes, ['me', 'team']), () => fromLegacy(person, feature, 'me'),
      () => fromUse(team, feature, { team, server }, ['team']), () => fromLegacy(team, feature, 'team')]
    : []
  steps.push(() => fromUse(server, feature, { server }, []))
  for (const step of steps) {
    const found = step()
    if (found) return { own: false, ...found, feature }
  }
  return { ref: 'builtin', scope: 'builtin', connection: null, own: false, feature }
}

export const featureTitle = (feature) => AI_FEATURES.find((f) => f.id === feature)?.title || feature

// The model and where it lives. withHost false (a person reading about an operator's connection)
// leaves the host out: the operator's network is not theirs to see.
export function connectionLabel(connection, { withHost = true } = {}) {
  if (!connection) return 'the built-in AI'
  if (!withHost) return connection.model ? `${connection.model} (this server's AI)` : `${CONNECTION_TYPES[connection.type]?.label || connection.name} (this server's AI)`
  let host = connection.baseUrl
  try {
    host = new URL(connection.baseUrl).host
  } catch {}
  return connection.model ? `${connection.model} at ${host}` : `${CONNECTION_TYPES[connection.type]?.label || connection.name} (${host})`
}

/**
 * What the chosen model cannot do for this request, or null. Unknown capabilities are tried;
 * only a capability marked false (or, for making images, not marked true) stops a request.
 * request: { images?: boolean (the request carries images), tools?: boolean }
 */
export function capabilityGap({ feature, connection, request = {}, label = connectionLabel(connection) }) {
  if (!connection) return null
  const caps = connection.capabilities || {}
  let need = null
  if (feature === 'images' && caps.images !== true) need = 'images'
  else if ((feature === 'vision' || request.images) && caps.vision === false) need = 'vision'
  else if (request.tools && caps.tools === false) need = 'tools'
  if (!need) return null
  const verbs = { images: 'make images', vision: 'read images', tools: 'call tools, which this feature needs' }
  const title = featureTitle(feature).toLowerCase()
  return {
    need,
    message: `${label} cannot ${verbs[need]}. Choose another model for ${title} in your AI settings.`,
  }
}

// What a person may see about a connection: never the key.
export function publicConnection(connection, extra = {}) {
  let host = connection.baseUrl
  try {
    host = new URL(connection.baseUrl).host
  } catch {}
  return {
    name: connection.name, type: connection.type, baseUrl: connection.baseUrl, host, model: connection.model ?? null,
    capabilities: connection.capabilities || {}, hasKey: Boolean(connection.apiKey || connection.hasKey),
    ...(connection.maxTokens && { maxTokens: connection.maxTokens }), ...(connection.toolChoice && { toolChoice: connection.toolChoice }),
    ...(connection.source && { source: connection.source }), ...(connection.legacy && { legacy: true }),
    lastError: connection.lastError ?? null, ...extra,
  }
}
