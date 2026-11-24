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
  // The presentation default and its fallback (server/config/ai-defaults.json).
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
// An administrator's published binding may tighten a surface's estimate and ceiling (AI control,
// spec 1.4 limits: tighten only). source(meterFeature) → { estimate, ceiling } (µ$, either null),
// set by ai-control/index.mjs from the snapshot.
let limitSource = () => null
export function setLimitSource(source) {
  limitSource = typeof source === 'function' ? source : () => null
}
const limitOf = (feature, key) => {
  try {
    const value = limitSource(feature)?.[key]
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}
const tighter = (code, set) => (set !== null && (code === undefined || code === null || set < code) ? set : code)

export function actionCeilingMicros(feature) {
  return tighter(CEILINGS[feature] ?? DEFAULT_CEILING, limitOf(feature, 'ceiling'))
}

/** The pre-check estimate for a meter feature: the catalogue's, or a binding's lower one. */
export function actionEstimateMicros(feature) {
  return tighter(ESTIMATES[feature], limitOf(feature, 'estimate'))
}

// Prices an administrator set on a model in AI control (aiModels, spec 1.3), read from the
// snapshot: they win over the settings file and the table from the next call, with no restart.
// source(model) → { inPerMillion, outPerMillion, id } or null; ai-control/index.mjs sets it.
let dbPrices = () => null
export function setDbPriceSource(source) {
  dbPrices = typeof source === 'function' ? source : () => null
}

const dbPriceOf = (model) => {
  try {
    const row = model ? dbPrices(model) : null
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

export function aiPrice(model) {
  return dbPriceOf(model) || prices.find(row => row.model === model) || dearest
}

// DeepInfra returns usage.estimated_cost. Its unit is not yet confirmed from a recorded
// response, so it can raise the table price but never lower it.
export function aiCostMicros({ model, usage = {} }) {
  const price = aiPrice(model)
  // Whole micro-dollars per million tokens keep the arithmetic exact; round up.
  const perToken = (usage.inputTokens || 0) * Math.round(price.inPerMillion * 1e6) + (usage.outputTokens || 0) * Math.round(price.outPerMillion * 1e6)
  const table = Math.ceil(perToken / 1e6)
  const provider = typeof usage.providerCostUsd === 'number' && usage.providerCostUsd > 0 ? Math.ceil(usage.providerCostUsd * 1_000_000) : 0
  if (provider > table) return { costMicros: provider, source: 'provider', priceModel: model }
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
