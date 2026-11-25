// Provider presets: what each model provider IS (Meta, OpenAI, DeepInfra, ...), its fixed address,
// how its key is sent, how it takes a forced tool call, and the models an administrator usually
// adds first. Adding a provider in Admin → AI control copies one of these into aiProviders; only
// "Other (OpenAI-compatible)" takes an address of its own. The wire protocol is an internal detail
// (most vendors speak the OpenAI API), shown small on the page.
//
// Suggested models carry their price from the meter's table (metering/prices.mjs AI_PRICES) when it
// has one; the administrator can change or add prices on the Models tab.
//
// Pure data and functions: no Meteor, no database.
import { AI_PRICES } from '../metering/prices.mjs'

const BEARER = Object.freeze({ style: 'bearer' })

const suggested = (model, label, capabilities = { tools: true }) => {
  const row = AI_PRICES.find((p) => p.model === model)
  return Object.freeze({
    model, label, capabilities: Object.freeze({ ...capabilities }),
    prices: row ? Object.freeze({ inputPerM: row.inPerMillion, outputPerM: row.outPerMillion, imageEach: null, currency: 'USD' }) : null,
  })
}

const preset = (id, fields) => Object.freeze({
  id, protocol: 'openai-chat', auth: BEARER, toolChoice: 'auto', baseUrlLocked: true, models: Object.freeze([]), ...fields,
})

// The order is the order of the Add a provider list.
export const PROVIDER_PRESETS = Object.freeze({
  meta: preset('meta', {
    label: 'Meta (Muse)', baseUrl: 'https://api.meta.ai/v1',
    models: Object.freeze([suggested('muse-ember-1.0', 'Muse Ember'), suggested('muse-spark-1.3', 'Muse Spark')]),
  }),
  openai: preset('openai', {
    label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', toolChoice: 'named',
    models: Object.freeze([suggested('gpt-4o-mini', 'GPT-4o mini', { tools: true, vision: true })]),
  }),
  anthropic: preset('anthropic', {
    label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages',
    auth: Object.freeze({ style: 'header', name: 'x-api-key' }), toolChoice: 'named',
    models: Object.freeze([suggested('claude-sonnet-4-6', 'Claude Sonnet 4.6', { tools: true, vision: true })]),
  }),
  deepinfra: preset('deepinfra', {
    label: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai', toolChoice: 'named',
    models: Object.freeze([
      suggested('Qwen/Qwen3-235B-A22B-Instruct-2507', 'Qwen3 235B'),
      suggested('deepseek-ai/DeepSeek-V3.1-Terminus', 'DeepSeek V3.1 Terminus'),
      suggested('google/gemini-3.5-flash', 'Gemini 3.5 Flash'),
      suggested('google/gemini-3.7-flash', 'Gemini 3.7 Flash'),
      suggested('anthropic/claude-sonnet-4-6', 'Claude Sonnet 4.6', { tools: true, vision: true }),
    ]),
  }),
  together: preset('together', { label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' }),
  groq: preset('groq', { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' }),
  fireworks: preset('fireworks', { label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1' }),
  openrouter: preset('openrouter', { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' }),
  mistral: preset('mistral', { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' }),
  xai: preset('xai', { label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1' }),
  gemini: preset('gemini', {
    label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: Object.freeze([suggested('gemini-3.8-flash', 'Gemini 3.8 Flash', { tools: true, vision: true }), suggested('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite')]),
  }),
  other: preset('other', { label: 'Other (OpenAI-compatible)', baseUrl: null, baseUrlLocked: false }),
})
export const PRESET_IDS = Object.freeze(Object.keys(PROVIDER_PRESETS))

/** The built-in default when nothing is set: Meta Muse Ember (the owner's choice). */
export const BUILTIN_DEFAULT = Object.freeze({ preset: 'meta', model: 'muse-ember-1.0' })

/** What the protocol means, in a few small words for the page. */
export const PROTOCOL_TEXT = Object.freeze({
  'openai-chat': 'speaks the OpenAI API',
  'anthropic-messages': 'speaks the Anthropic API',
  'openai-images': 'speaks the OpenAI images API',
})

const hostOf = (url) => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

/** The named preset whose fixed address has this host (api.meta.ai → meta), or null. */
export function presetForUrl(baseUrl) {
  const host = hostOf(baseUrl)
  if (!host) return null
  for (const p of Object.values(PROVIDER_PRESETS)) {
    if (p.baseUrl && hostOf(p.baseUrl) === host) return p
  }
  return null
}

/**
 * A provider row as it is stored, from a preset: { _id, preset, label, baseUrl, protocol, auth,
 * toolChoice, extraHeaders, status }. id and label default to the preset's; baseUrl is the preset's
 * for every named preset and the given one for "other".
 */
export function providerFromPreset(presetId, { id = null, label = null, baseUrl = null } = {}) {
  const p = PROVIDER_PRESETS[presetId]
  if (!p) return null
  return {
    _id: id || p.id, preset: p.id, label: label || p.label,
    baseUrl: p.baseUrlLocked ? p.baseUrl : baseUrl, protocol: p.protocol, auth: { ...p.auth },
    toolChoice: p.toolChoice, extraHeaders: {}, status: 'active',
  }
}
