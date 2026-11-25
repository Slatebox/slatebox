// What the Providers and keys and Models tabs say, without React (so it is tested under node): a
// key in words (which key, never the key), its last test and last use, a provider's address and
// what it speaks, a model's prices, and the forms as they open.

const day = (value) => {
  const at = value ? new Date(value) : null
  return at && !Number.isNaN(at.getTime()) ? at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null
}
const ago = (value, now = Date.now()) => {
  const at = value ? new Date(value).getTime() : NaN
  if (Number.isNaN(at)) return null
  const minutes = Math.max(0, Math.round((now - at) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return day(value)
}

const PROTOCOL = { 'openai-chat': 'speaks the OpenAI API', 'anthropic-messages': 'speaks the Anthropic API', 'openai-images': 'speaks the OpenAI images API' }

/** A provider's subtitle: "api.meta.ai/v1 · speaks the OpenAI API". */
export function providerSubtitle(provider = {}) {
  let where = provider.baseUrl || ''
  try {
    const url = new URL(provider.baseUrl)
    where = `${url.host}${url.pathname.replace(/\/+$/, '')}`
  } catch {}
  const speaks = PROTOCOL[provider.protocol]
  return [where, speaks].filter(Boolean).join(' · ')
}

const STATUS = { active: 'Active key', standby: 'Standby', revoked: 'Revoked' }
/** A key's status in words. */
export const keyStatusText = (key) => STATUS[key?.status] || 'Key'

/** Who added a key and when ("added Nov 24, 2026 from the settings file"). */
export function keyAddedText(key = {}) {
  const when = day(key.createdAt)
  const how = key.source === 'settings-import' ? 'from the settings file' : key.source === 'env-import' ? 'from an environment variable' : key.source === 'connection-import' ? 'from an earlier connection' : null
  const parts = [when && `added ${when}`, how].filter(Boolean)
  if (key.status === 'revoked' && key.revokedAt) parts.push(`revoked ${day(key.revokedAt)}`)
  return parts.join(' ')
}

/** A key's last test in words. */
export function lastTestText(key = {}) {
  const t = key.lastTest
  if (!t) return 'Not tested yet'
  const when = day(t.at)
  if (t.ok) return `Last tested ${when || ''}: worked${typeof t.latencyMs === 'number' ? ` in ${t.latencyMs} ms` : ''}`.replace(' :', ':')
  return `Last tested ${when || ''}: failed (${t.error || 'no answer'})`.replace(' :', ':')
}

/** When a key was last used for a request. */
export const lastUsedText = (key = {}, now = Date.now()) => (key.lastUsedAt ? `last used ${ago(key.lastUsedAt, now)}` : 'not used yet')

/** A Test result in one sentence ("Answered in 820 ms, tools work"). */
export function checkResultText(result) {
  if (!result) return ''
  if (!result.ok) return result.message || 'The test failed.'
  const parts = [`Works${typeof result.latencyMs === 'number' ? ` (${result.latencyMs} ms)` : ''}`]
  if (result.tools === 'yes') parts.push('tools work')
  else if (result.tools === 'no') parts.push('tools do not work')
  return parts.join(', ')
}

const dollars = (value) => (typeof value === 'number' ? `$${value}` : '–')
/** A model's prices per million tokens in and out (or per image). */
export function priceText(model) {
  const p = model?.prices
  if (!p) return 'Unpriced'
  if (typeof p.inputPerM === 'number' && typeof p.outputPerM === 'number') return `${dollars(p.inputPerM)} / ${dollars(p.outputPerM)} per M`
  if (typeof p.imageEach === 'number') return `${dollars(p.imageEach)} per picture`
  return 'Unpriced'
}

/** Whether a model row has a price of its own. */
export const hasOwnPrice = (model) => priceText(model) !== 'Unpriced'

/** "name: value" lines to an extraHeaders object; throws with a plain message for a bad line. */
export function parseHeaders(text) {
  const out = {}
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const at = line.indexOf(':')
    if (at < 1) throw new Error(`Write each header as name: value (${line.slice(0, 40)}).`)
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

/** A number field: blank is null, otherwise a number (or NaN for the form to refuse). */
export const numberOrNull = (text) => (String(text ?? '').trim() === '' ? null : Number(text))

/** The model ids that are unpriced, from ai.control.get's warnings. */
export const unpricedIds = (warnings = []) => new Set(warnings.filter((w) => w.kind === 'unpriced').map((w) => w.id))

/** What a model can do, in words ("tools, vision"). */
export const capsText = (caps = {}) => ['tools', 'vision', 'images', 'json', 'reasoning'].filter((c) => caps[c]).join(', ') || '—'

/**
 * The Add a provider form as it opens: every field its first render reads is set (a form that
 * started empty and was filled after the first render blanked the page). presets: ai.control.get's.
 */
/**
 * The Add a provider list: every preset, a named one this server already has (and has not
 * archived) marked added, so it is changed on its card instead. Other (any address) can be added
 * again and again. → presets, each with added: boolean
 */
export function addablePresets(presets = [], providers = []) {
  const taken = new Set(providers.filter((p) => p.status !== 'archived').map((p) => p.id))
  return presets.map((p) => ({ ...p, added: p.baseUrlLocked !== false && taken.has(p.id) }))
}

export function providerFormDefaults(presets = [], presetId = 'meta') {
  const open = presets.filter((p) => !p.added)
  const preset = open.find((p) => p.id === presetId) || open[0] || presets[0] || { id: presetId, label: '', baseUrl: '', models: [] }
  return {
    preset: preset.id, label: preset.label || '', id: preset.id === 'other' ? '' : preset.id, baseUrl: preset.baseUrlLocked === false ? '' : preset.baseUrl || '',
    apiKey: '', models: (preset.models || []).slice(0, 1).map((m) => m.model), headers: '',
  }
}

/** The Add a key / Replace key form as it opens. */
export function keyFormDefaults() {
  return { apiKey: '', model: '', label: '' }
}

/**
 * The Add a model / Change form as it opens (open: { model?, provider? } or null while closed).
 * Every field a Select or text field reads is set from the first render.
 */
export function modelFormDefaults(open = null, providers = []) {
  const m = open?.model || {}
  return {
    provider: m.provider || open?.provider || providers[0]?.id || '', model: m.model || '', label: m.label || '',
    caps: m.capabilities || { tools: true }, maxOutput: m.maxOutput ?? '',
    inputPerM: m.prices?.inputPerM ?? '', outputPerM: m.prices?.outputPerM ?? '', imageEach: m.prices?.imageEach ?? '',
    status: m.status || 'enabled', existing: Boolean(open?.model),
  }
}
