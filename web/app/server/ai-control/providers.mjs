// Providers: every model provider this server talks to is a stored row (aiProviders) made from a
// preset (provider-presets.mjs): "Meta (Muse)" at https://api.meta.ai/v1, "DeepInfra", ... or
// "Other (OpenAI-compatible)" with an address of its own. A provider's keys live in providerKeys
// (keys.mjs), its models in aiModels (models.mjs).
//
// The only code rows are the services beside the models (generated pictures, picture search, icons,
// call transcription): they are not chosen per part of Slatebox, but their keys are kept the same
// way as a model provider's.
//
// Pure: no Meteor, no database.
import { PRESET_IDS, PROVIDER_PRESETS } from './provider-presets.mjs'

export const CHAT_PROTOCOLS = Object.freeze(['openai-chat', 'anthropic-messages', 'openai-images'])
export const AUX_PROTOCOLS = Object.freeze(['stability-images', 'google-cse', 'nounproject', 'deepgram'])
export const PROTOCOLS = Object.freeze([...CHAT_PROTOCOLS, ...AUX_PROTOCOLS])
// How an "Other" provider takes its key (named presets fix theirs).
export const AUTH_STYLES = Object.freeze(['bearer', 'header', 'none'])
export const PROVIDER_CAPS = Object.freeze(['tools', 'vision', 'json', 'images', 'reasoning'])
export const TOOL_CHOICES = Object.freeze(['auto', 'named', 'required'])

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/
// Extra headers carry nothing secret: a name that sounds like a credential is refused.
const SECRET_NAME = /auth|key|token|secret|cookie|password|session/i
const RESERVED_HEADERS = /^(host|content-type|content-length|accept|connection|transfer-encoding|user-agent|anthropic-version)$/i

const aux = (id, fields) => Object.freeze({
  _id: id, builtin: true, aux: true, status: 'active', auth: Object.freeze({ style: 'bearer' }), extraHeaders: Object.freeze({}),
  baseUrlLocked: true, modelOptional: true, ...fields,
})

// The services beside the models, one code row each.
export const BUILTIN_PROVIDERS = Object.freeze({
  stability: aux('stability', {
    label: 'Stability AI (pictures)', protocol: 'stability-images', baseUrl: 'https://api.stability.ai',
    auth: Object.freeze({ style: 'header', name: 'Authorization' }),
  }),
  'google-cse': aux('google-cse', {
    label: 'Google picture search', protocol: 'google-cse', baseUrl: 'https://customsearch.googleapis.com', modelOptional: false,
    auth: Object.freeze({ style: 'query', name: 'key' }), modelLabel: 'Search engine ID (cx)', settingsKey: 'googleImageSearch.apiKey',
  }),
  nounproject: aux('nounproject', {
    label: 'Noun Project icons', protocol: 'nounproject', baseUrl: 'https://api.thenounproject.com',
    auth: Object.freeze({ style: 'oauth1' }), keyLabel: 'Key and secret as key:secret', keyParts: Object.freeze(['key', 'secret']), settingsKey: 'nounProject.key',
  }),
  deepgram: aux('deepgram', {
    label: 'Deepgram (call transcription)', protocol: 'deepgram', baseUrl: 'https://api.deepgram.com',
    auth: Object.freeze({ style: 'header', name: 'Authorization', prefix: 'Token ' }), settingsKey: 'deepgram.secret',
  }),
})
export const BUILTIN_PROVIDER_IDS = Object.freeze(Object.keys(BUILTIN_PROVIDERS))
export const AUX_PROVIDER_IDS = BUILTIN_PROVIDER_IDS

export class ProviderError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProviderError'
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// A value that looks like a key whatever it is called: sk-…, sk-ant-…, AIza…, or a long run of
// base64 or hex.
const KEY_LIKE = /(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|\b[A-Za-z0-9+/=_-]{32,}\b)/
export const looksLikeSecret = (text) => typeof text === 'string' && KEY_LIKE.test(text)

function normalizeHeaders(extraHeaders) {
  const out = {}
  if (extraHeaders === undefined || extraHeaders === null) return out
  if (!isObject(extraHeaders) || Object.keys(extraHeaders).length > 10) throw new ProviderError('extraHeaders is an object of at most 10 header names and values.')
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (!HEADER_NAME.test(name)) throw new ProviderError(`${name} is not a header name.`)
    if (SECRET_NAME.test(name)) throw new ProviderError(`${name} looks like a credential. Extra headers carry nothing secret: add a key instead.`)
    if (RESERVED_HEADERS.test(name)) throw new ProviderError(`Slatebox sets ${name} itself.`)
    if (typeof value !== 'string' || value.length > 200 || /[\r\n]/.test(value)) throw new ProviderError(`The value of ${name} is text of at most 200 characters on one line.`)
    if (looksLikeSecret(value)) throw new ProviderError(`The value of ${name} looks like a key. Extra headers carry nothing secret.`)
    out[name] = value
  }
  return out
}

function normalizeAuth(auth) {
  if (auth === undefined || auth === null) return { style: 'bearer' }
  if (!isObject(auth) || !AUTH_STYLES.includes(auth.style)) throw new ProviderError(`auth.style is ${AUTH_STYLES.join(', ')}.`)
  if (auth.style === 'header') {
    if (typeof auth.name !== 'string' || !HEADER_NAME.test(auth.name) || RESERVED_HEADERS.test(auth.name)) throw new ProviderError('auth.name is the header the key goes in, for example x-api-key.')
    return { style: 'header', name: auth.name }
  }
  return { style: auth.style }
}

/**
 * A provider as it is stored: made from a preset. A named preset keeps its own address, protocol,
 * key style and tool choice whatever the input says; "other" takes an address (checkUrl(url) → the
 * address without a trailing slash, or throws: the endpoint rules for the server's own
 * configuration), and may say how its key is sent, how it takes a forced tool call and extra
 * headers. Throws ProviderError.
 * → { _id, preset, label, baseUrl, protocol, auth, toolChoice, extraHeaders, status }
 */
export function normalizeProvider(input, { checkUrl = (url) => url } = {}) {
  if (!isObject(input)) throw new ProviderError('A provider is an object with a preset and a name.')
  const presetId = input.preset
  const p = PROVIDER_PRESETS[presetId]
  if (!p) throw new ProviderError(`preset is one of ${PRESET_IDS.join(', ')}.`)
  const id = input._id ?? input.id ?? p.id
  if (typeof id !== 'string' || !SLUG.test(id)) throw new ProviderError('Name the provider with lowercase letters, digits and dashes, for example meta.')
  if (BUILTIN_PROVIDERS[id]) throw new ProviderError(`${id} is a service of this server, not a model provider.`)
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : p.label
  if (label.length > 80 || /[\r\n]/.test(label)) throw new ProviderError('Give the provider a name of at most 80 characters on one line.')
  const status = input.status === undefined ? 'active' : input.status
  if (!['active', 'archived'].includes(status)) throw new ProviderError('status is active or archived.')
  if (p.baseUrlLocked) {
    return { _id: id, preset: p.id, label, baseUrl: p.baseUrl, protocol: p.protocol, auth: { ...p.auth }, toolChoice: p.toolChoice, extraHeaders: {}, status }
  }
  if (typeof input.baseUrl !== 'string' || !input.baseUrl || input.baseUrl.length > 500) throw new ProviderError('Give the address up to /v1, for example https://models.example.com/v1.')
  const baseUrl = checkUrl(input.baseUrl)
  const toolChoice = input.toolChoice === undefined || input.toolChoice === null ? 'auto' : input.toolChoice
  if (!TOOL_CHOICES.includes(toolChoice)) throw new ProviderError(`toolChoice is ${TOOL_CHOICES.join(', ')}.`)
  return { _id: id, preset: p.id, label, baseUrl, protocol: p.protocol, auth: normalizeAuth(input.auth), toolChoice, extraHeaders: normalizeHeaders(input.extraHeaders), status }
}

/**
 * Every provider in use: the services, then the stored model providers (an archived row or a row
 * that fails its checks is left out). stored: { [id]: aiProviders document } → { [id]: provider }
 */
export function mergeProviders(stored = {}) {
  const out = { ...BUILTIN_PROVIDERS }
  for (const [id, doc] of Object.entries(stored || {})) {
    if (BUILTIN_PROVIDERS[id] || !isObject(doc) || doc.status === 'archived') continue
    try {
      // the address was checked when it was saved; here only its shape
      out[id] = Object.freeze({ ...normalizeProvider({ ...doc, _id: id }), builtin: false })
    } catch {
      // the snapshot names a broken row in its health; it is simply not offered
    }
  }
  return out
}

const typeOf = (row, builtin) => Object.freeze({
  label: row.label,
  ...(row.baseUrl && { baseUrl: row.baseUrl }),
  baseUrlLocked: Boolean(row.baseUrl && row.baseUrlLocked !== false),
  ...(row.keyRequired && { keyRequired: true }),
  protocol: row.protocol,
  auth: row.auth,
  extraHeaders: row.extraHeaders || {},
  defaultCapabilities: row.defaultCapabilities || {},
  toolChoice: row.toolChoice || 'auto',
  ...(row.preset && { preset: row.preset }),
  builtin,
})

/**
 * The connection types a request or a person's own connection may name: every named preset (by
 * its id), the generic OpenAI-compatible endpoint people connect their own models with
 * (openai-compatible), and the stored providers (by their id; a stored row wins over a preset of
 * the same id). → { [id]: { label, baseUrl?, baseUrlLocked, keyRequired?, protocol, auth,
 * extraHeaders, defaultCapabilities, toolChoice, preset?, builtin } }
 */
export function chatConnectionTypes(stored = {}) {
  const out = {}
  for (const p of Object.values(PROVIDER_PRESETS)) {
    if (!p.baseUrlLocked) continue
    out[p.id] = typeOf({ ...p, preset: p.id, keyRequired: true, baseUrlLocked: true }, true)
  }
  const other = PROVIDER_PRESETS.other
  out['openai-compatible'] = typeOf({ ...other, preset: 'other', baseUrl: null }, true)
  for (const [id, provider] of Object.entries(mergeProviders(stored))) {
    if (!CHAT_PROTOCOLS.includes(provider.protocol)) continue
    out[id] = typeOf({ ...provider, keyRequired: provider.auth?.style !== 'none' }, false)
  }
  return out
}

/** What an administrator reads about a provider (nothing in a provider is secret). */
export const publicProvider = (p) => ({
  id: p._id, label: p.label, preset: p.preset ?? null, protocol: p.protocol, baseUrl: p.baseUrl ?? null,
  baseUrlLocked: p.preset ? Boolean(PROVIDER_PRESETS[p.preset]?.baseUrlLocked) : true,
  auth: p.auth, toolChoice: p.toolChoice ?? null, extraHeaders: p.extraHeaders || {},
  builtin: Boolean(p.builtin), aux: Boolean(p.aux), status: p.status || 'active',
  ...(p.modelLabel && { modelLabel: p.modelLabel }), ...(p.keyLabel && { keyLabel: p.keyLabel }), ...(p.version && { version: p.version }),
})
