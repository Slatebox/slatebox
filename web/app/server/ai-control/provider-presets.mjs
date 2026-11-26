// Provider presets: what each model provider IS (Meta, OpenAI, DeepInfra, ...), its fixed address,
// how its key is sent, how it takes a forced tool call, and the models an administrator usually
// adds first. Adding a provider in Admin → AI control copies one of these into aiProviders; only
// "Other (OpenAI-compatible)" takes an address of its own. The wire protocol is an internal detail
// (most vendors speak the OpenAI API), shown small on the page.
//
// Suggested models carry their price from the meter's table (metering/prices.mjs AI_PRICES, and
// VOICE_PRICES for the realtime voice models) when it has one; the administrator can change or add
// prices on the Models tab.
//
// The two realtime presets (OpenAI Realtime, Google Gemini Live) are voice providers: their models
// talk with people in real time through the relay (server/voice), never answer a text request. Their
// suggested models list the voices they offer; which voice a part uses is the administrator's choice
// on its binding (a person's own connection uses the provider's own default voice).
//
// Pure data and functions: no Meteor, no database.
import { AI_PRICES, VOICE_PRICES } from '../metering/prices.mjs'

const BEARER = Object.freeze({ style: 'bearer' })

const suggested = (model, label, capabilities = { tools: true }) => {
  const row = AI_PRICES.find((p) => p.model === model)
  return Object.freeze({
    model, label, capabilities: Object.freeze({ ...capabilities }),
    prices: row ? Object.freeze({ inputPerM: row.inPerMillion, outputPerM: row.outPerMillion, imageEach: null, currency: 'USD' }) : null,
  })
}

// A realtime voice model: its voices (the names its provider documents), and for OpenAI the
// model that writes what the person said (input transcription) as the provider suggests it.
const suggestedVoice = (model, label, { voices, transcriptionModel = null }) => {
  const row = VOICE_PRICES.find((p) => p.model === model)
  return Object.freeze({
    model, label, capabilities: Object.freeze({ voice: true, tools: true }), voices: Object.freeze([...voices]),
    ...(transcriptionModel && { transcriptionModel }),
    prices: row ? Object.freeze({
      inputPerM: row.textInPerMillion, outputPerM: row.textOutPerMillion, audioInputPerM: row.audioInPerMillion, audioOutputPerM: row.audioOutPerMillion,
      ...(row.cachedAudioInPerMillion !== undefined && { cachedAudioInputPerM: row.cachedAudioInPerMillion }), imageEach: null, currency: 'USD',
    }) : null,
  })
}
// https://developers.openai.com/api/docs/models (marin and cedar are the ones OpenAI recommends)
const OPENAI_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']
// https://aistudio.google.com/docs/live-api/capabilities (the prebuilt text-to-speech voices)
const GEMINI_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr', 'Autonoe', 'Callirrhoe', 'Enceladus', 'Iapetus',
  'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux',
  'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat']

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
  // Voice providers (server/voice): the relay holds their WebSocket; the browser never sees it.
  'openai-realtime': preset('openai-realtime', {
    label: 'OpenAI Realtime (voice)', baseUrl: 'wss://api.openai.com/v1/realtime', protocol: 'openai-realtime', toolChoice: 'auto',
    models: Object.freeze([
      suggestedVoice('gpt-realtime-2.1', 'GPT Realtime 2.1', { voices: OPENAI_VOICES, transcriptionModel: 'gpt-realtime-whisper' }),
      suggestedVoice('gpt-realtime-2.1-mini', 'GPT Realtime 2.1 mini', { voices: OPENAI_VOICES, transcriptionModel: 'gpt-realtime-whisper' }),
    ]),
  }),
  'gemini-live': preset('gemini-live', {
    label: 'Google Gemini Live (voice)', baseUrl: 'wss://generativelanguage.googleapis.com', protocol: 'gemini-live', toolChoice: 'auto',
    auth: Object.freeze({ style: 'header', name: 'x-goog-api-key' }),
    models: Object.freeze([
      suggestedVoice('gemini-3.8-live', 'Gemini 3.8 Live', { voices: GEMINI_VOICES }),
      suggestedVoice('gemini-3.1-flash-live-preview', 'Gemini 3.1 Flash Live (preview)', { voices: GEMINI_VOICES }),
    ]),
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
  'openai-realtime': 'talks through the OpenAI Realtime API',
  'gemini-live': 'talks through the Gemini Live API',
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
