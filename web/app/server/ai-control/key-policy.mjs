// Which keys a connection saved in the app may point at, and who may change what (spec 1.2, 6.2).
//
// A connection's key is sealed in the database (keyRef sealed), read from an environment variable
// (keyRef env) or absent (keyRef none). An environment variable named from the database is
// limited: otherwise an administrator, or an agent holding ai:admin, could point a connection at a
// host they control and read any secret of the process (the key-encryption key, the database
// password). Only SLATEBOX_AI_KEY_* names, or names the settings file allows, are accepted, and
// some prefixes never are.
//
// Pure.
import { mergeProviderInput } from './providers.mjs'

export const ENV_KEY_NAME = /^SLATEBOX_AI_KEY_[A-Z0-9_]{1,40}$/
// Never, whatever the settings file allows.
const NEVER = [/^SLATEBOX_KEY_ENCRYPTION_KEY/, /^MONGO_/, /^METEOR_/, /^STRIPE_/, /^DAILY_/, /^DEEPGRAM_/]
const ANY_ENV = /^[A-Z][A-Z0-9_]{1,63}$/

/** The settings file's extra names (settings.ai.envKeyAllowlist), filtered to well-formed ones. */
export function envKeyAllowlist(settings = {}) {
  const list = settings?.ai?.envKeyAllowlist
  return Array.isArray(list) ? list.filter((name) => typeof name === 'string' && ANY_ENV.test(name)) : []
}

/**
 * Whether a connection saved in the app may read its key from this environment variable.
 * → null when allowed, else the reason (a sentence for the administrator).
 */
export function envKeyRefusal(name, settings = {}) {
  if (typeof name !== 'string' || !ANY_ENV.test(name)) return 'Name the environment variable in capitals, digits and underscores, for example SLATEBOX_AI_KEY_GEMINI.'
  if (NEVER.some((rule) => rule.test(name))) return `${name} is not an AI key and can never be used as one.`
  if (ENV_KEY_NAME.test(name) || envKeyAllowlist(settings).includes(name)) return null
  return `${name} is not allowed. Use a name starting SLATEBOX_AI_KEY_, or add it to ai.envKeyAllowlist in the settings file.`
}

/**
 * The fields of a connection or provider write that only a person may set (spec 6.2): anything
 * that decides where a key goes or which key goes. An agent holding ai:admin may save a keyless
 * connection to a provider with a locked address, and change labels, capabilities and models.
 *
 * kind: 'connection' | 'provider'; input: the write; previous: the stored document or null;
 * provider: the provider the connection uses (for its locked address).
 * → null when an agent may make this write, else the reason.
 */
export function agentRefusal(kind, input, previous, { provider = null } = {}) {
  if (kind === 'provider') {
    if (!previous) {
      if (input.baseUrl || input.auth || (input.extraHeaders && Object.keys(input.extraHeaders).length)) return 'Only a person can add a provider with an address, a key style or extra headers.'
      return null
    }
    // compared as it will be stored: a field left out keeps its value (models.mjs saveProvider)
    const next = mergeProviderInput(input, previous)
    const changed = (field, normalize = (v) => v ?? null) => JSON.stringify(normalize(next[field])) !== JSON.stringify(normalize(previous[field]))
    const url = (v) => (v ? String(v).replace(/\/+$/, '') : null)
    const style = (v) => (v && typeof v === 'object' ? { style: v.style ?? 'bearer', ...(v.name && { name: String(v.name).toLowerCase() }) } : { style: 'bearer' })
    if (changed('baseUrl', url)) return 'Only a person can set where a provider sends requests (baseUrl).'
    if (url(next.baseUrl) && changed('baseUrlLocked', (v) => v !== false)) return 'Only a person can lock or unlock a provider\'s address (baseUrlLocked).'
    if (changed('protocol')) return 'Only a person can change a provider\'s protocol.'
    if (changed('auth', style)) return 'Only a person can change how a provider sends its key (auth).'
    if (changed('extraHeaders', (v) => (v && Object.keys(v).length ? v : null))) return 'Only a person can change a provider\'s extra headers.'
    return null
  }
  if (typeof input.apiKey === 'string') return 'Only a person can send a key. An agent may save a connection without one.'
  if (input.rotate) return 'Only a person can rotate a key.'
  if (input.keyRef !== undefined && input.keyRef?.kind !== 'none') return 'Only a person can say where a connection\'s key comes from (keyRef).'
  const providerOf = input.type ?? input.provider
  if (previous && providerOf !== undefined && providerOf !== previous.provider) return 'Only a person can change a connection\'s provider.'
  if (!previous && !provider?.baseUrlLocked) return 'Only a person can add a connection whose address can be chosen. An agent may add a keyless connection to a provider with a fixed address.'
  // a connection a person turned off (after a leak, say) is turned back on by a person
  if (previous?.status === 'disabled' && input.status !== undefined && input.status !== 'disabled') return 'Only a person can turn a connection back on.'
  const sameUrl = (a, b) => String(a ?? '').replace(/\/+$/, '') === String(b ?? '').replace(/\/+$/, '')
  if (input.baseUrl !== undefined && input.baseUrl !== null && !sameUrl(input.baseUrl, previous?.baseUrl ?? provider?.baseUrl)) return 'Only a person can change where a connection sends requests (baseUrl).'
  return null
}
