import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AI_PRICES, CALL_PRICES, FIXED_PRICES, ESTIMATES, aiPrice, aiCostMicros, meterAmounts, callCostMicros, actionCeilingMicros,
} from '../web/app/server/metering/prices.mjs'
import { normalizeProviderUsage } from '../web/app/server/methods/ai/provider.mjs'

test('every price row names its source and the date it was read', () => {
  for (const row of AI_PRICES) {
    assert.match(row.source, /^https:\/\//, row.model)
    assert.match(row.read, /^\d{4}-\d{2}-\d{2}$/, row.model)
    assert.ok(row.inPerMillion > 0 && row.outPerMillion > 0, row.model)
  }
  assert.match(CALL_PRICES.source, /^https:\/\/www\.daily\.co\//)
})

test('cost from tokens for each model in the table', () => {
  for (const row of AI_PRICES) {
    const { costMicros, source } = aiCostMicros({ model: row.model, usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } })
    assert.equal(source, 'table')
    assert.equal(costMicros, Math.round(row.inPerMillion * 1e6) + Math.round(row.outPerMillion * 1e6))
  }
  // a typical Qwen3 draft: 1,200 in and 900 out
  const draft = aiCostMicros({ model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', usage: { inputTokens: 1200, outputTokens: 900 } })
  assert.equal(draft.costMicros, 603) // 1,200 x $0.09/M + 900 x $0.55/M = $0.000603
})

test('an unknown model is priced at the dearest known price', () => {
  const dearest = AI_PRICES.reduce((a, b) => (b.inPerMillion + b.outPerMillion > a.inPerMillion + a.outPerMillion ? b : a))
  assert.equal(aiPrice('someone/new-model').model, dearest.model)
  const { costMicros } = aiCostMicros({ model: 'someone/new-model', usage: { inputTokens: 1000, outputTokens: 1000 } })
  assert.equal(costMicros, Math.ceil((1000 * Math.round(dearest.inPerMillion * 1e6) + 1000 * Math.round(dearest.outPerMillion * 1e6)) / 1e6))
})

test('a provider cost field in the response can raise the table price, never lower it (fixture)', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/deepinfra-usage-with-cost.json', import.meta.url)))
  const usage = normalizeProviderUsage('deepinfra', fixture)
  assert.equal(usage.inputTokens, fixture.usage.prompt_tokens)
  assert.equal(usage.providerCostUsd, fixture.usage.estimated_cost)
  const { costMicros } = aiCostMicros({ model: fixture.model, usage })
  const table = aiCostMicros({ model: fixture.model, usage: { ...usage, providerCostUsd: undefined } }).costMicros
  assert.equal(costMicros, Math.max(table, Math.ceil(fixture.usage.estimated_cost * 1_000_000)))
  assert.equal(aiCostMicros({ model: fixture.model, usage: { ...usage, providerCostUsd: 1 } }).source, 'provider')
  // a zero or missing field falls back to the table
  assert.equal(aiCostMicros({ model: fixture.model, usage: { ...usage, providerCostUsd: undefined } }).source, 'table')
})

test('margin applies only to balance charges', () => {
  assert.deepEqual(meterAmounts({ costMicros: 1000, route: 'balance', marginPercent: 5 }), { costMicros: 1000, chargeMicros: 1050 })
  assert.deepEqual(meterAmounts({ costMicros: 1000, route: 'free', marginPercent: 5 }), { costMicros: 1000, chargeMicros: 0 })
  assert.deepEqual(meterAmounts({ costMicros: 1000, route: 'byok', marginPercent: 5 }), { costMicros: 0, chargeMicros: 0, providerMicros: 1000 })
  assert.deepEqual(meterAmounts({ costMicros: 3, route: 'balance', marginPercent: 5 }), { costMicros: 3, chargeMicros: 4 })
})

test('call minutes are priced at Daily base list prices, per participant-minute', () => {
  assert.equal(CALL_PRICES.videoMicros, 4000)
  assert.equal(CALL_PRICES.voiceMicros, 990)
  assert.equal(callCostMicros('video', 20 * 10), 800_000)
  assert.equal(callCostMicros('voice', 2400), 2_376_000)
})

test('fixed prices, estimates and per-action ceilings', () => {
  assert.equal(FIXED_PRICES.imageSearch, 5000)
  assert.equal(FIXED_PRICES.imageGeneration, 30000)
  assert.deepEqual(ESTIMATES, {
    workshop: 5000, 'lane-chat': 3000, 'map-chat': 3000, welcome: 2000, generation: 30000,
    presentation: 10000, 'image-search': 5000, 'image-generation': 30000, shape: 8000,
    // the interview (S2, 2026-11-26): one conversation turn, chat's estimate
    interview: 2000,
    // For you (S4, 2026-11-26): one suggestion, a forced call and at most one retry
    'personal.suggest': 3000,
  })
  assert.equal(actionCeilingMicros('interview'), 50_000)
  assert.equal(actionCeilingMicros('personal.suggest'), 50_000)
  assert.equal(actionCeilingMicros('generation'), 200_000)
  // A custom shape is a short prompt and at most one retry.
  assert.equal(actionCeilingMicros('shape'), 60_000)
  assert.equal(actionCeilingMicros('workshop'), 50_000)
})

// ---------- AI control S3: prices set on models in AI control (spec 1.3) ----------
test('a price set in AI control wins from the next call; without one the settings file and the table apply; unpriced is the dearest', async () => {
  const { setDbPriceSource, isPriced } = await import('../web/app/server/metering/prices.mjs')
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }
  const before = aiCostMicros({ model: 'muse-ember-1.0', usage })
  assert.equal(before.source, 'table')
  try {
    setDbPriceSource((model) => (model === 'muse-ember-1.0' ? { inPerMillion: 0.4, outPerMillion: 1.2, id: 'muse:muse-ember-1.0' } : null))
    assert.deepEqual(aiCostMicros({ model: 'muse-ember-1.0', usage }), { costMicros: 1_600_000, source: 'db', priceModel: 'muse-ember-1.0' })
    assert.equal(aiPrice('muse-ember-1.0').id, 'muse:muse-ember-1.0')
    // the provider's own reported cost can still raise it, never lower it
    assert.equal(aiCostMicros({ model: 'muse-ember-1.0', usage: { ...usage, providerCostUsd: 5 } }).source, 'provider')
    // a model only AI control prices is priced; one nobody prices is not, and costs the dearest
    setDbPriceSource((model) => (model === 'brand-new' ? { inPerMillion: 1, outPerMillion: 2 } : null))
    assert.equal(isPriced('brand-new'), true)
    assert.equal(isPriced('nobody-priced-me'), false)
    const dearest = AI_PRICES.reduce((a, b) => (b.inPerMillion + b.outPerMillion > a.inPerMillion + a.outPerMillion ? b : a))
    assert.equal(aiPrice('nobody-priced-me').model, dearest.model)
    // a broken source never breaks the meter: the table applies
    setDbPriceSource(() => { throw new Error('snapshot gone') })
    assert.equal(aiCostMicros({ model: 'muse-ember-1.0', usage }).costMicros, before.costMicros)
    setDbPriceSource(() => ({ inPerMillion: 'cheap', outPerMillion: 1 }))
    assert.equal(aiCostMicros({ model: 'muse-ember-1.0', usage }).source, 'table')
  } finally {
    setDbPriceSource(null)
  }
  assert.deepEqual(aiCostMicros({ model: 'muse-ember-1.0', usage }), before)
})
