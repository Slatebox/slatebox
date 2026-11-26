// What AI, calls and image search cost Slatebox, in micro-dollars (1 dollar = 1,000,000).
// Each row names where the price came from and when it was read. Estimates and ceilings per
// feature come from the surface catalogue (ai-control/catalogue.mjs). An administrator prices a
// model in AI control (aiModels, read from the next call); an operator prices a model this table
// lacks, or reprices one, in settings.metering.prices (configurePrices, applied once at start). An unknown model is
// priced at the dearest known row, so a settings change to a new model can never be counted
// as cheap.

import { METER_CEILINGS, METER_ESTIMATES } from '../ai-control/catalogue.mjs'

const DEEPINFRA = 'https://deepinfra.com/pricing'
const ANTHROPIC = 'https://platform.claude.com/docs/en/about-claude/pricing'
const OPENAI = 'https://developers.openai.com/api/docs/pricing'
const GEMINI = 'https://aistudio.google.com/docs/pricing'
const META = 'https://dev.meta.ai/docs/pricing-rate-limits'
const READ = '2026-11-19'
const READ_2 = '2026-11-22'

// Dollars per million tokens. Dollars per million tokens equals micro-dollars per token.
export const AI_PRICES = Object.freeze([
  { model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', inPerMillion: 0.09, outPerMillion: 0.55, source: DEEPINFRA, read: READ },
  // The page lists DeepSeek-V3.1, the closest to the configured V3.1-Terminus fallback.
  { model: 'deepseek-ai/DeepSeek-V3.1-Terminus', inPerMillion: 0.25, outPerMillion: 0.95, source: DEEPINFRA, read: READ },
  { model: 'deepseek-ai/DeepSeek-V3.1', inPerMillion: 0.25, outPerMillion: 0.95, source: DEEPINFRA, read: READ },
  { model: 'deepseek-ai/DeepSeek-V3', inPerMillion: 0.32, outPerMillion: 0.89, source: DEEPINFRA, read: READ },
  { model: 'anthropic/claude-sonnet-4-6', inPerMillion: 3, outPerMillion: 15, source: DEEPINFRA, read: READ },
  { model: 'claude-sonnet-4-6', inPerMillion: 3, outPerMillion: 15, source: ANTHROPIC, read: READ },
  { model: 'gpt-4o-mini', inPerMillion: 0.15, outPerMillion: 0.6, source: OPENAI, read: READ },
  // DeepInfra's Gemini Flash models (shapes on Slatebox Cloud).
  { model: 'google/gemini-3.5-flash', inPerMillion: 1.5, outPerMillion: 9, source: DEEPINFRA, read: READ_2 },
  { model: 'google/gemini-3.7-flash', inPerMillion: 0.75, outPerMillion: 3.75, source: DEEPINFRA, read: READ_2 },
  // Gemini API direct, for an operator's connection. Gemini 3.8 Flash is $0.75 / $3.75 until
  // 2026-12-31 and $1.50 / $7.50 from 2027-01-01: the later price, so the meter never counts it
  // as cheaper.
  { model: 'gemini-3.8-flash', inPerMillion: 1.5, outPerMillion: 7.5, source: GEMINI, read: READ_2 },
  { model: 'gemini-3.5-flash-lite', inPerMillion: 0.3, outPerMillion: 2.5, source: GEMINI, read: READ_2 },
  // Meta Model API direct, for an operator's connection. Muse Ember is $0.10 / $0.50 up to 200K
  // input tokens and $0.30 / $1.50 above: the higher price, for the same reason. No row is added
  // dearer than the dearest one above it (that would reprice every unknown model).
  { model: 'muse-spark-1.3', inPerMillion: 1.25, outPerMillion: 4.25, source: META, read: READ_2 },
  { model: 'muse-ember-1.0', inPerMillion: 0.3, outPerMillion: 1.5, source: META, read: READ_2 },
])

// Realtime voice models (server/voice), dollars per million tokens by modality: what the person
// says (audio in), what the agent says (audio out), and the text around it (instructions, the
// tool's replies, transcripts). Kept apart from AI_PRICES: a voice model never prices a text call,
// and these rows are dearer than any text row (the text table's "dearest row" stays a text price).
// An unknown voice model is priced at the dearest voice row.
const READ_3 = '2026-11-26'
export const VOICE_PRICES = Object.freeze([
  { model: 'gemini-3.8-live', audioInPerMillion: 3, audioOutPerMillion: 12, textInPerMillion: 0.75, textOutPerMillion: 4.5, source: GEMINI, read: READ_3 },
  { model: 'gemini-3.1-flash-live-preview', audioInPerMillion: 3, audioOutPerMillion: 12, textInPerMillion: 0.75, textOutPerMillion: 4.5, source: GEMINI, read: READ_3 },
  { model: 'gpt-realtime-2.1', audioInPerMillion: 32, audioOutPerMillion: 64, textInPerMillion: 4, textOutPerMillion: 24, cachedAudioInPerMillion: 0.4, source: OPENAI, read: READ_3 },
  { model: 'gpt-realtime-2.1-mini', audioInPerMillion: 10, audioOutPerMillion: 20, textInPerMillion: 0.6, textOutPerMillion: 2.4, source: OPENAI, read: READ_3 },
].map(Object.freeze))
const voiceWeight = (row) => row.audioInPerMillion + row.audioOutPerMillion + row.textInPerMillion + row.textOutPerMillion
const DEAREST_VOICE = VOICE_PRICES.reduce((a, b) => (voiceWeight(b) > voiceWeight(a) ? b : a))

/**
 * The price of a voice model: the model row's own prices an administrator set in AI control
 * (prices: { inputPerM, outputPerM, audioInputPerM, audioOutputPerM, cachedAudioInputPerM }), when
 * it has both audio prices, else the table's row, else the dearest voice row.
 * → { model, audioInPerMillion, audioOutPerMillion, textInPerMillion, textOutPerMillion, cachedAudioInPerMillion?, source }
 */
export function voicePrice(model, rowPrices = null) {
  const p = rowPrices
  if (p && Number.isFinite(p.audioInputPerM) && Number.isFinite(p.audioOutputPerM)) {
    const table = VOICE_PRICES.find((row) => row.model === model) || DEAREST_VOICE
    return Object.freeze({
      model, audioInPerMillion: p.audioInputPerM, audioOutPerMillion: p.audioOutputPerM,
      textInPerMillion: Number.isFinite(p.inputPerM) ? p.inputPerM : table.textInPerMillion,
      textOutPerMillion: Number.isFinite(p.outputPerM) ? p.outputPerM : table.textOutPerMillion,
      ...(Number.isFinite(p.cachedAudioInputPerM) && { cachedAudioInPerMillion: p.cachedAudioInputPerM }),
      source: 'db',
    })
  }
  return VOICE_PRICES.find((row) => row.model === model) || DEAREST_VOICE
}

/**
 * What one stretch of a voice session cost, in whole micro-dollars (rounded up). usage: the
 * provider-neutral counts the relay reads from Gemini's usageMetadata or OpenAI's response.done
 * ({ audioIn, audioOut, textIn, textOut, cachedAudioIn }, tokens). Cached audio is priced at the
 * cached rate where the row has one, else as audio in.
 */
export function voiceCostMicros(usage = {}, price) {
  const n = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
  const rate = (perMillion) => Math.round((perMillion || 0) * 1e6)
  const cachedRate = Number.isFinite(price.cachedAudioInPerMillion) ? price.cachedAudioInPerMillion : price.audioInPerMillion
  const perToken = n(usage.audioIn) * rate(price.audioInPerMillion) + n(usage.audioOut) * rate(price.audioOutPerMillion)
    + n(usage.textIn) * rate(price.textInPerMillion) + n(usage.textOut) * rate(price.textOutPerMillion)
    + n(usage.cachedAudioIn) * rate(cachedRate)
  return Math.ceil(perToken / 1e6)
}

// The most a settings row may say a million tokens cost, in dollars: a sane bound that catches a
// price typed in cents or per thousand tokens.
export const MAX_PRICE_PER_MILLION = 1000
const PRICE_KEYS = ['model', 'inPerMillion', 'outPerMillion']

/**
 * The table with the operator's rows (settings.metering.prices: [{ model, inPerMillion,
 * outPerMillion }]) added, or replacing the table's row for the same model. Throws a plain
 * message for a wrong entry, so a mistyped price stops the start instead of being metered.
 */
export function mergePrices(table, overrides) {
  if (overrides === undefined || overrides === null) return table
  const fail = (where, message) => { throw new Error(`settings metering.prices${where}: ${message}`) }
  if (!Array.isArray(overrides)) fail('', 'is a list of { model, inPerMillion, outPerMillion }')
  const rows = new Map(table.map((row) => [row.model, row]))
  const seen = new Set()
  overrides.forEach((entry, i) => {
    const at = `[${i}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(at, 'is an object { model, inPerMillion, outPerMillion }')
    const extra = Object.keys(entry).find((key) => !PRICE_KEYS.includes(key))
    if (extra) fail(at, `${extra} is not a price field (${PRICE_KEYS.join(', ')})`)
    if (typeof entry.model !== 'string' || !entry.model.trim() || entry.model.length > 200) fail(at, 'model is the model name the provider reports')
    if (seen.has(entry.model)) fail(at, `${entry.model} is listed twice`)
    seen.add(entry.model)
    const wrong = ['inPerMillion', 'outPerMillion'].find((key) => {
      const value = entry[key]
      return typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_PRICE_PER_MILLION
    })
    if (wrong) fail(at, `${wrong} is dollars per million tokens, a number from 0 to ${MAX_PRICE_PER_MILLION}`)
    rows.set(entry.model, Object.freeze({ model: entry.model, inPerMillion: entry.inPerMillion, outPerMillion: entry.outPerMillion, source: 'settings', read: null }))
  })
  return Object.freeze([...rows.values()])
}

const dearestOf = (rows) => rows.reduce((a, b) => (b.inPerMillion + b.outPerMillion > a.inPerMillion + a.outPerMillion ? b : a))
let prices = AI_PRICES
let dearest = dearestOf(prices)

// Applies settings.metering.prices once at start (metering/meteor.js). Throws for a wrong entry.
export function configurePrices(settings = {}) {
  prices = mergePrices(AI_PRICES, settings?.metering?.prices)
  dearest = dearestOf(prices)
  return prices
}

// The prices in use: the table, with the operator's rows.
export const activePrices = () => prices

// Daily base list prices per participant-minute. No credit is taken for Daily's
// 10,000 free minutes, so the budget errs on the side of caution.
export const CALL_PRICES = Object.freeze({
  videoMicros: 4000, voiceMicros: 990, source: 'https://www.daily.co/pricing/video-sdk/', read: READ,
})

export const FIXED_PRICES = Object.freeze({
  // Google Custom Search JSON API, $5 per 1,000 queries (closes 2027-01-01).
  imageSearch: 5000,
  // Stability's current price for Stable Image Core (3 credits at $0.01).
  imageGeneration: 30000,
})

// The pre-check estimate for one request, by meter feature: the surface catalogue's estimates
// (ai-control/catalogue.mjs) under the features runAIAction meters them as.
export const ESTIMATES = METER_ESTIMATES

// The most one request may spend, retries and fallbacks included, from the catalogue too.
// A presentation plan's prompt is capped (presentationRequest.mjs: the most notes and text it
// sends), so its largest request at the dearest price fits here; its estimate is worked out from
// the prompt before it is sent. A shape request is a short prompt and at most one retry.
const CEILINGS = METER_CEILINGS
const DEFAULT_CEILING = 50_000

export function actionCeilingMicros(feature) {
  return CEILINGS[feature] ?? DEFAULT_CEILING
}

/** The pre-check estimate for a meter feature: the catalogue's. */
export function actionEstimateMicros(feature) {
  return ESTIMATES[feature]
}

// Prices an administrator set on a model in AI control (aiModels, spec 1.3), read from the
// snapshot: they win over the settings file and the table from the next call, with no restart.
// source(model, where?) → { inPerMillion, outPerMillion, id } or null; where names the provider
// that served the call ({ provider }); ai-control/index.mjs sets it.
let dbPrices = () => null
export function setDbPriceSource(source) {
  dbPrices = typeof source === 'function' ? source : () => null
}

const dbPriceOf = (model, where = null) => {
  try {
    const row = model ? dbPrices(model, where) : null
    if (!row || !Number.isFinite(row.inPerMillion) || !Number.isFinite(row.outPerMillion)) return null
    return Object.freeze({ model, inPerMillion: row.inPerMillion, outPerMillion: row.outPerMillion, source: 'db', read: null, ...(row.id && { id: row.id }) })
  } catch {
    return null
  }
}

/** Whether a model has a price of its own (AI control, the settings file or the table). Unpriced is charged at the dearest row. */
export function isPriced(model) {
  return Boolean(dbPriceOf(model) || prices.some(row => row.model === model))
}

/**
 * The price of one call. where: the provider that served it ({ provider }), so an administrator's
 * price applies only to that provider's model. Without one, the dearest price an administrator set
 * for the model name, then the table (or the dearest row).
 */
export function aiPrice(model, where = null) {
  const table = prices.find(row => row.model === model)
  return dbPriceOf(model, where) || table || dearest
}

// DeepInfra returns usage.estimated_cost. Its unit is not yet confirmed from a recorded
// response, so it can raise the table price but never lower it.
export function aiCostMicros({ model, usage = {}, connection = null, provider = null }) {
  // a server route's provider (server:<provider>); a person's own connection is priced from the table
  const server = typeof connection === 'string' && connection.startsWith('server:')
  const where = server ? { provider: provider && provider !== 'connection' ? provider : connection.slice('server:'.length) } : connection ? { provider: null } : null
  const price = aiPrice(model, where)
  // Whole micro-dollars per million tokens keep the arithmetic exact; round up.
  const perToken = (usage.inputTokens || 0) * Math.round(price.inPerMillion * 1e6) + (usage.outputTokens || 0) * Math.round(price.outPerMillion * 1e6)
  const table = Math.ceil(perToken / 1e6)
  const provider$ = typeof usage.providerCostUsd === 'number' && usage.providerCostUsd > 0 ? Math.ceil(usage.providerCostUsd * 1_000_000) : 0
  if (provider$ > table) return { costMicros: provider$, source: 'provider', priceModel: model }
  return { costMicros: table, source: price.source === 'db' ? 'db' : 'table', priceModel: price.model }
}

export function callCostMicros(kind, participantMinutes) {
  return Math.ceil(participantMinutes * (kind === 'video' ? CALL_PRICES.videoMicros : CALL_PRICES.voiceMicros))
}

// What Slatebox pays and what a wallet is charged. Only balance spending carries the margin.
// With an own key Slatebox pays nothing; the provider amount is kept for the person's own list.
export function meterAmounts({ costMicros, route, marginPercent }) {
  if (route === 'byok') return { costMicros: 0, chargeMicros: 0, providerMicros: costMicros }
  if (route === 'balance') return { costMicros, chargeMicros: Math.ceil(costMicros * (100 + marginPercent) / 100) }
  return { costMicros, chargeMicros: 0 }
}
