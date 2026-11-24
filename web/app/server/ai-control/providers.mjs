// Providers: vendor templates as data (spec 1.1). A provider says which wire protocol a vendor
// speaks, its address, how its key is sent and what its models can usually do. The wire protocol
// is the only part that is code: a vendor that speaks one of these needs no deploy (Gemini, Meta,
// Mistral, OpenRouter, Groq, Together, Ollama and vLLM all speak openai-chat).
//
// The built-in rows below are the code layer: they cannot be changed or archived, and an aiProviders
// document with one of their ids is skipped. Administrators add others (ai.providers.save); the
// snapshot holds them and connections.mjs reads them through setProviderSource.
//
// Pure: no Meteor, no database.

// Model choices: a connection of one of these serves conversation, drafting, pictures and the rest.
export const CHAT_PROTOCOLS = Object.freeze(['openai-chat', 'anthropic-messages', 'openai-images'])
// Services beside the models, one built-in provider each, with a sealed key instead of a settings
// file entry: generated pictures, picture search, icons and call transcription.
export const AUX_PROTOCOLS = Object.freeze(['stability-images', 'google-cse', 'nounproject', 'deepgram'])
export const PROTOCOLS = Object.freeze([...CHAT_PROTOCOLS, ...AUX_PROTOCOLS])
export const AUTH_STYLES = Object.freeze(['bearer', 'header', 'query', 'none'])
export const PROVIDER_CAPS = Object.freeze(['tools', 'vision', 'json', 'images', 'reasoning'])

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/
// A header or query name: letters, digits and dashes (and underscores for query names).
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/
const QUERY_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
// Extra headers carry nothing secret: a name that sounds like a credential is refused (spec 1.1).
const SECRET_NAME = /auth|key|token|secret|cookie|password|session/i
const RESERVED_HEADERS = /^(host|content-type|content-length|accept|connection|transfer-encoding|user-agent|anthropic-version)$/i

const row = (id, fields) => Object.freeze({
  _id: id, builtin: true, status: 'active', auth: Object.freeze({ style: 'bearer' }), extraHeaders: Object.freeze({}),
  baseUrlLocked: true, keyRequired: true, modelOptional: false, defaultCapabilities: Object.freeze({}), ...fields,
})

// The four connection types that existed before providers were data, and the services beside them.
export const BUILTIN_PROVIDERS = Object.freeze({
  'openai-compatible': row('openai-compatible', {
    label: 'OpenAI-compatible endpoint', protocol: 'openai-chat', baseUrl: null, baseUrlLocked: false, keyRequired: false, toolChoice: 'auto',
  }),
  deepinfra: row('deepinfra', { label: 'DeepInfra', protocol: 'openai-chat', baseUrl: 'https://api.deepinfra.com/v1/openai', modelOptional: true, toolChoice: 'named' }),
  openai: row('openai', { label: 'OpenAI', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', toolChoice: 'named' }),
  anthropic: row('anthropic', { label: 'Anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', auth: Object.freeze({ style: 'header', name: 'x-api-key' }), toolChoice: 'named' }),
  stability: row('stability', {
    label: 'Stability AI (pictures)', protocol: 'stability-images', baseUrl: 'https://api.stability.ai', modelOptional: true, aux: true,
    auth: Object.freeze({ style: 'header', name: 'Authorization' }), settingsKey: 'stabilityai.apiKey',
  }),
  'google-cse': row('google-cse', {
    label: 'Google picture search', protocol: 'google-cse', baseUrl: 'https://customsearch.googleapis.com', aux: true,
    auth: Object.freeze({ style: 'query', name: 'key' }), modelLabel: 'Search engine ID (cx)', settingsKey: 'googleImageSearch.apiKey',
  }),
  nounproject: row('nounproject', {
    label: 'Noun Project icons', protocol: 'nounproject', baseUrl: 'https://api.thenounproject.com', modelOptional: true, aux: true,
    auth: Object.freeze({ style: 'oauth1' }), keyLabel: 'Key and secret as key:secret', keyParts: Object.freeze(['key', 'secret']), settingsKey: 'nounProject.key',
  }),
  deepgram: row('deepgram', {
    label: 'Deepgram (call transcription)', protocol: 'deepgram', baseUrl: 'https://api.deepgram.com', modelOptional: true, aux: true,
    auth: Object.freeze({ style: 'header', name: 'Authorization', prefix: 'Token ' }), settingsKey: 'deepgram.secret',
  }),
})
export const BUILTIN_PROVIDER_IDS = Object.freeze(Object.keys(BUILTIN_PROVIDERS))
export const AUX_PROVIDER_IDS = Object.freeze(BUILTIN_PROVIDER_IDS.filter((id) => BUILTIN_PROVIDERS[id].aux))

export class ProviderError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProviderError'
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// A value that looks like a key whatever it is called (spec 6.2): sk-…, sk-ant-…, AIza…, or a long
// run of base64 or hex.
const KEY_LIKE = /(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|\b[A-Za-z0-9+/=_-]{32,}\b)/
export const looksLikeSecret = (text) => typeof text === 'string' && KEY_LIKE.test(text)


/**
 * Checks a provider an administrator saves (or one read back from the database). Throws
 * ProviderError. checkUrl(baseUrl) → the address with no trailing slash, or throws (the endpoint
 * rules for the server's own configuration).
 * → { _id, label, protocol, baseUrl, baseUrlLocked, auth, extraHeaders, keyRequired, modelOptional,
 *     defaultCapabilities, status }
 */
/**
 * A provider change as it will be stored: the fields the input leaves out keep their stored values
 * (a save never clears an address, key style or headers by omission). The key style follows a
 * change of protocol, since Anthropic's is fixed. Send null to clear a field.
 */
export const PROVIDER_KEPT_FIELDS = Object.freeze(['baseUrl', 'baseUrlLocked', 'auth', 'extraHeaders', 'defaultCapabilities', 'keyRequired', 'modelOptional'])
export function mergeProviderInput(input, previous) {
  if (!isObject(input) || !isObject(previous)) return input
  const out = { ...input }
  for (const key of PROVIDER_KEPT_FIELDS) {
    if (out[key] !== undefined) continue
    if (key === 'auth' && input.protocol !== undefined && input.protocol !== previous.protocol) continue
    if (previous[key] !== undefined) out[key] = previous[key]
  }
  return out
}

export function normalizeProvider(input, { checkUrl = (url) => url } = {}) {
  if (!isObject(input)) throw new ProviderError('A provider is an object with an id, a label and a wire protocol.')
  const id = input._id ?? input.id
  if (typeof id !== 'string' || !SLUG.test(id)) throw new ProviderError('Name the provider with lowercase letters, digits and dashes, for example gemini.')
  if (BUILTIN_PROVIDERS[id]) throw new ProviderError(`${id} is a built-in provider and cannot be changed.`)
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  if (!label || label.length > 80 || /[\r\n]/.test(label)) throw new ProviderError('Give the provider a label of at most 80 characters.')
  if (!CHAT_PROTOCOLS.includes(input.protocol)) throw new ProviderError(`protocol is one of ${CHAT_PROTOCOLS.join(', ')}. A new wire protocol needs a Slatebox release.`)
  let baseUrl = null
  if (input.baseUrl !== undefined && input.baseUrl !== null && input.baseUrl !== '') {
    if (typeof input.baseUrl !== 'string' || input.baseUrl.length > 500) throw new ProviderError('baseUrl is the address up to /v1.')
    baseUrl = checkUrl(input.baseUrl)
  }
  const baseUrlLocked = baseUrl ? input.baseUrlLocked !== false : false
  if (input.baseUrlLocked === true && !baseUrl) throw new ProviderError('A provider that locks its address needs one: give baseUrl.')
  const auth = normalizeAuth(input.auth, input.protocol)
  const extraHeaders = {}
  if (input.extraHeaders !== undefined && input.extraHeaders !== null) {
    if (!isObject(input.extraHeaders) || Object.keys(input.extraHeaders).length > 10) throw new ProviderError('extraHeaders is an object of at most 10 header names and values.')
    for (const [name, value] of Object.entries(input.extraHeaders)) {
      if (!HEADER_NAME.test(name)) throw new ProviderError(`${name} is not a header name.`)
      if (SECRET_NAME.test(name)) throw new ProviderError(`${name} looks like a credential. Extra headers carry nothing secret: send a key through the connection instead.`)
      if (RESERVED_HEADERS.test(name)) throw new ProviderError(`Slatebox sets ${name} itself.`)
      if (typeof value !== 'string' || value.length > 200 || /[\r\n]/.test(value)) throw new ProviderError(`The value of ${name} is text of at most 200 characters on one line.`)
      if (looksLikeSecret(value)) throw new ProviderError(`The value of ${name} looks like a key. Extra headers carry nothing secret.`)
      extraHeaders[name] = value
    }
  }
  const defaultCapabilities = {}
  if (input.defaultCapabilities !== undefined && input.defaultCapabilities !== null) {
    if (!isObject(input.defaultCapabilities)) throw new ProviderError('defaultCapabilities is an object of true/false flags.')
    for (const [key, value] of Object.entries(input.defaultCapabilities)) {
      if (!PROVIDER_CAPS.includes(key) || typeof value !== 'boolean') throw new ProviderError(`defaultCapabilities takes ${PROVIDER_CAPS.join(', ')}, each true or false.`)
      defaultCapabilities[key] = value
    }
  }
  if (input.protocol === 'openai-images') defaultCapabilities.images = true
  const status = input.status === undefined ? 'active' : input.status
  if (!['active', 'archived'].includes(status)) throw new ProviderError('status is active or archived.')
  return {
    _id: id, label, protocol: input.protocol, baseUrl, baseUrlLocked, auth, extraHeaders,
    keyRequired: input.keyRequired === undefined ? auth.style !== 'none' : Boolean(input.keyRequired) && auth.style !== 'none',
    modelOptional: Boolean(input.modelOptional), defaultCapabilities, status, builtin: false,
  }
}

function normalizeAuth(auth, protocol) {
  // Anthropic's Messages API takes its key in x-api-key, nothing else
  if (protocol === 'anthropic-messages') {
    if (auth !== undefined && auth !== null && !(isObject(auth) && (auth.style === 'header' && /^x-api-key$/i.test(auth.name || '')))) {
      throw new ProviderError('anthropic-messages sends its key in the x-api-key header; leave auth out.')
    }
    return { style: 'header', name: 'x-api-key' }
  }
  if (auth === undefined || auth === null) return { style: 'bearer' }
  if (!isObject(auth) || !AUTH_STYLES.includes(auth.style)) throw new ProviderError(`auth.style is ${AUTH_STYLES.join(', ')}.`)
  if (auth.style === 'header') {
    if (typeof auth.name !== 'string' || !HEADER_NAME.test(auth.name) || RESERVED_HEADERS.test(auth.name)) throw new ProviderError('auth.name is the header the key goes in, for example x-goog-api-key.')
    return { style: 'header', name: auth.name }
  }
  if (auth.style === 'query') {
    if (typeof auth.name !== 'string' || !QUERY_NAME.test(auth.name)) throw new ProviderError('auth.name is the query parameter the key goes in, for example key.')
    return { style: 'query', name: auth.name }
  }
  return { style: auth.style }
}

/**
 * Every provider in use: the built-in rows, then the administrators' active ones (a stored row
 * with a built-in id, an archived row or a row that fails its checks is left out).
 * stored: { [id]: aiProviders document } (the snapshot's providers) → { [id]: provider }
 */
export function mergeProviders(stored = {}) {
  const out = { ...BUILTIN_PROVIDERS }
  for (const [id, doc] of Object.entries(stored || {})) {
    if (BUILTIN_PROVIDERS[id] || !isObject(doc) || doc.status === 'archived') continue
    try {
      // the address was checked when it was saved; here only its shape
      out[id] = Object.freeze(normalizeProvider({ ...doc, _id: id }))
    } catch {
      // the snapshot names a broken row in its health; it is simply not offered
    }
  }
  return out
}

/**
 * The providers a connection for model choices may name, in the shape connections.mjs has always
 * used for its types: { label, baseUrl?, baseUrlLocked, keyRequired?, modelOptional?, protocol,
 * auth, extraHeaders, defaultCapabilities, toolChoice?, builtin }.
 */
export function chatConnectionTypes(stored = {}) {
  const out = {}
  for (const [id, provider] of Object.entries(mergeProviders(stored))) {
    if (!CHAT_PROTOCOLS.includes(provider.protocol)) continue
    out[id] = Object.freeze({
      label: provider.label,
      ...(provider.baseUrl && { baseUrl: provider.baseUrl }),
      baseUrlLocked: Boolean(provider.baseUrl && provider.baseUrlLocked),
      ...(provider.keyRequired && { keyRequired: true }),
      ...(provider.modelOptional && { modelOptional: true }),
      protocol: provider.protocol,
      auth: provider.auth,
      extraHeaders: provider.extraHeaders || {},
      defaultCapabilities: provider.defaultCapabilities || {},
      ...(provider.toolChoice && { toolChoice: provider.toolChoice }),
      builtin: Boolean(provider.builtin),
    })
  }
  return out
}

/** What an administrator reads about a provider (nothing in a provider is secret). */
export const publicProvider = (p) => ({
  id: p._id, label: p.label, protocol: p.protocol, baseUrl: p.baseUrl ?? null, baseUrlLocked: Boolean(p.baseUrlLocked),
  auth: p.auth, extraHeaders: p.extraHeaders || {}, keyRequired: Boolean(p.keyRequired), modelOptional: Boolean(p.modelOptional),
  defaultCapabilities: p.defaultCapabilities || {}, builtin: Boolean(p.builtin), aux: Boolean(p.aux), status: p.status || 'active',
  ...(p.modelLabel && { modelLabel: p.modelLabel }), ...(p.keyLabel && { keyLabel: p.keyLabel }), ...(p.version && { version: p.version }),
})
