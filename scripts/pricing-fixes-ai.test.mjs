// Fixes for the hostile review of feat/pricing (pricing-attack-app): the AI meter.
// C1 own key and Slatebox-paid images, C2 the meter fails closed, H1 parallel requests,
// M3 failed requests, M5 fake accounts, L3 the provider's cost figure.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { meterWorld, NOW } from './fixtures/meter-world.mjs'
import { runAIAction, chargeProviderCall, chargeFixed, installMeter, aiRequestGate } from '../web/app/server/metering/context.mjs'
import { DEFAULT_METERING, route, meteringEnabled, budgetLevel } from '../web/app/server/metering/policy.mjs'
import { aiCostMicros } from '../web/app/server/metering/prices.mjs'

const app = new URL('../web/app/', import.meta.url).pathname
const source = path => readFileSync(join(app, path), 'utf8')
const QWEN = 'Qwen/Qwen3-235B-A22B-Instruct-2507'
const CALL = 6200 // 20k in + 8k out on Qwen
let seq = 0
// One legacy-generation request: the provider is called until the action's ceiling stops it.
const generation = () => runAIAction({ feature: 'generation' }, async () => {
  for (;;) {
    await new Promise(resolve => setImmediate(resolve))
    const r = await chargeProviderCall({ ref: 'audit' + seq++, model: QWEN, usage: { inputTokens: 20000, outputTokens: 8000 } })
    if (r.stop) return 'stopped'
  }
})
const person = { id: 'u1', anonymous: false, emailVerified: true }
// own keys pay on a self-hosted meter only (settings.ownKeys); Slatebox Cloud: own-keys-cloud.test.mjs
const selfHostedMeter = { ...DEFAULT_METERING, ownKeys: true }
const base = { person, teamId: null, usage: {}, wallets: {}, global: {}, settings: selfHostedMeter, now: NOW }

test('C1: an own AI key never pays for image search or image generation, which use Slatebox keys', () => {
  for (const kind of ['imageSearch', 'imageGeneration']) {
    const d = route({ ...base, kind, keys: { personal: { ai: true }, team: { ai: true } }, teamId: 't1', estimateMicros: 5000 })
    assert.equal(d.route, 'free', kind)
  }
  assert.equal(route({ ...base, kind: 'ai', keys: { personal: { ai: true } }, estimateMicros: 5000 }).route, 'byok')
})

test('C1: 1,000 searches and 1,000 images by someone with an own key are counted and capped', async () => {
  const w = await meterWorld({ keys: { ai: true }, settings: structuredClone(selfHostedMeter) })
  let refused = 0
  for (let i = 0; i < 1000; i++) {
    await runAIAction({ feature: 'image-search', kind: 'imageSearch' }, () => chargeFixed({ ref: 's' + i, kind: 'imageSearch', costMicros: 5000, model: 'google-cse' })).catch(() => refused++)
    await runAIAction({ feature: 'image-generation', kind: 'imageGeneration' }, () => chargeFixed({ ref: 'g' + i, kind: 'imageGeneration', costMicros: 30000, model: 'stability' })).catch(() => refused++)
  }
  assert.ok(refused > 1900, `most were refused once the free amount ran out (${refused})`)
  assert.ok(w.paid() <= 500_000, `Slatebox paid at most the daily free amount, not $35 (${w.paid()})`)
  assert.equal(w.global().monthFreeMicros, w.paid(), 'every cent is in the global budget')
})

test('C1: an image search inside an own-key AI chat is charged to the free amount, not the own key', async () => {
  const w = await meterWorld({ keys: { ai: true }, settings: structuredClone(selfHostedMeter) })
  await runAIAction({ feature: 'workshop' }, async action => {
    assert.equal(action.route, 'byok')
    await chargeFixed({ ref: 'search-in-chat', kind: 'imageSearch', costMicros: 5000, model: 'google-cse' })
  })
  assert.equal(w.events.get('search-in-chat').route, 'free')
  assert.equal(w.global().monthFreeMicros, 5000)
  assert.equal(w.paid(), 5000)
})

test('C1: stabilityai and images.search run as their own kinds', () => {
  assert.match(source('server/methods/stabilityai.js'), /runAIAction\(\{ feature: 'image-generation', kind: 'imageGeneration' \}/)
  assert.match(source('server/methods/stabilityai.js'), /kind: 'imageGeneration', costMicros: FIXED_PRICES\.imageGeneration/)
  assert.match(source('server/methods/images.js'), /kind: 'imageSearch'/)
})

test('C2: Slatebox Cloud refuses to start without the meter; dev and self-host default to off', () => {
  assert.throws(() => meteringEnabled({ public: { env: 'prod' } }), /metering\.enabled/)
  assert.throws(() => meteringEnabled({ public: { env: 'prod' }, metering: { enabled: false } }), /metering\.enabled/)
  assert.throws(() => meteringEnabled({ public: { env: 'test' } }), /metering\.enabled/)
  assert.throws(() => meteringEnabled({ public: { env: 'stage' }, metering: {} }), /metering\.enabled/)
  assert.equal(meteringEnabled({ public: { env: 'prod' }, metering: { enabled: true } }), true)
  assert.equal(meteringEnabled({ public: { env: 'test' }, metering: { enabled: false } }), false)
  assert.equal(meteringEnabled({ public: { env: 'dev' } }), false)
  assert.equal(meteringEnabled({ public: { env: 'selfhost' } }), false)
  assert.equal(meteringEnabled({ public: { env: 'selfhost' }, metering: { enabled: true } }), true)
  // decided once at startup, so a bad setting stops the server instead of the first request
  assert.match(source('server/metering/meteor.js'), /const METERED = meteringEnabled\(Meteor\.settings\)/)
})

test('H1: 200 parallel requests from one account stay within 30 drafts, $0.50 a day and $1.00 a month', async () => {
  const w = await meterWorld()
  const results = await Promise.allSettled(Array.from({ length: 200 }, generation))
  const s = w.spent()
  assert.ok(results.some(r => r.status === 'rejected'), 'later requests are refused')
  assert.ok(s.drafts <= 30, `drafts ${s.drafts}`)
  // each running request may finish one provider call past its hold
  assert.ok(s.todayMicros <= 500_000 + 3 * CALL, `today ${s.todayMicros}`)
  assert.ok(s.monthMicros <= 1_000_000, `month ${s.monthMicros}`)
  assert.equal(s.heldDay, 0, 'every hold is released')
  assert.equal(s.heldMonth, 0)
})

test('H1: a $0.05 balance buys at most $0.05 of AI, however many requests run at once', async () => {
  const w = await meterWorld({ wallet: { balanceMicros: 50_000, refundableMicros: 50_000 }, globalMonth: 1_200_000_000 })
  await Promise.allSettled(Array.from({ length: 200 }, generation))
  assert.ok(w.paid() <= 50_000 + CALL, `provider spend ${w.paid()}`)
  assert.equal(w.wallet().heldMicros || 0, 0)
  assert.ok(w.wallet().balanceMicros >= 0)
})

test('H1: one account cannot push the month past the 110% ceiling', async () => {
  const w = await meterWorld({ globalMonth: 1_099_000_000 })
  await Promise.allSettled(Array.from({ length: 200 }, generation))
  const { percent } = budgetLevel({ monthFreeMicros: w.global().monthFreeMicros, budget: w.settings.budget })
  assert.ok(percent <= 110.01, `month at ${percent.toFixed(3)}%`)
})

test('H1: a request started inside a running action after it finished is refused (fire-and-forget chains are held open)', async () => {
  const w = await meterWorld()
  const { keepActionOpen } = await import('../web/app/server/metering/context.mjs')
  let release
  const chain = new Promise(resolve => { release = resolve })
  let late = null
  await runAIAction({ feature: 'generation' }, async () => {
    keepActionOpen(chain.then(async () => chargeProviderCall({ ref: 'late-1', model: QWEN, usage: { inputTokens: 1000, outputTokens: 100 } })))
  })
  assert.ok(w.spent().heldDay > 0, 'the hold stays while the chain runs')
  release()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(w.spent().heldDay, 0, 'and is released when it ends')
  assert.ok(w.events.has('late-1'))
  // after the action is finished, nothing more can be sent in its name (a timer that was not held open)
  await runAIAction({ feature: 'workshop' }, async () => { late = new Promise(resolve => setTimeout(() => resolve(aiRequestGate()), 10)) })
  assert.equal((await late)?.abort, true)
  installMeter(null)
})

test('H1: the openai.chat chain and its rerun keep their action open', () => {
  assert.match(source('server/methods/openai.js'), /keepActionOpen\(processConversation\(aiOpts\)/)
  assert.match(source('server/methods/ai/processConversation.js'), /keepActionOpen\(/)
})

test('M3: a timeout, network error or 5xx after sending is charged the feature estimate', async () => {
  const w = await meterWorld()
  await runAIAction({ feature: 'workshop' }, async () => {
    await chargeProviderCall({ ref: 'timeout-1', model: QWEN, usage: null })
  })
  assert.equal(w.events.get('timeout-1').costMicros, 5000)
  const req = source('server/methods/ai/req.js')
  assert.match(req, /chargeUnansweredAttempt/)
  // the thrown-error branch (timeouts and network errors, retried or final) charges before it decides to retry
  const thrown = req.slice(req.indexOf('} catch (err) {'))
  assert.ok(thrown.indexOf('await chargeUnansweredAttempt(') < thrown.indexOf('if (retryable)'))
  // the error-body branch charges a 5xx (or no status) before it decides to retry or give up
  const body = req.slice(req.indexOf('const errorCode = responseError.code'))
  assert.ok(body.indexOf('await chargeUnansweredAttempt(') < body.indexOf('isRetryableProviderFailure'))
  assert.match(body, /responseStatus >= 500/)
})

test('M5: an administrator can stop free use for one account, and metered methods are rate limited', async () => {
  const d = route({ ...base, kind: 'ai', person: { ...person, freeStopped: true }, estimateMicros: 5000 })
  assert.equal(d.ok, false)
  assert.equal(d.code, 'free-stopped')
  const { METER_RATE_LIMITS } = await import('../web/app/server/metering/limits.mjs')
  const constants = source('imports/api/common/constants.js')
  for (const name of ['openai.chat', 'workshops.draft', 'images.search', 'stabilityai.generate', 'daily.join', 'wallet.refund', 'wallet.createTopUp']) {
    assert.ok(METER_RATE_LIMITS.some(rule => rule.method === name && rule.per === 'user'), name + ' per person')
    assert.ok(METER_RATE_LIMITS.some(rule => rule.method === name && rule.per === 'address'), name + ' per address')
  }
  assert.ok(constants.length > 0)
  assert.match(source('server/metering/meteor.js'), /DDPRateLimiter\.addRule/)
  assert.match(source('server/metering/meteor.js'), /'meter\.setFreeStopped'/)
  assert.match(source('imports/ui/pages/admin/FreeBudget.jsx'), /meter\.setFreeStopped/)
})

test('L3: DeepInfra estimated_cost never lowers the table price', () => {
  const usage = { inputTokens: 20000, outputTokens: 8000, providerCostUsd: 0.000001 }
  assert.equal(aiCostMicros({ model: QWEN, usage }).costMicros, CALL)
  assert.equal(aiCostMicros({ model: QWEN, usage: { ...usage, providerCostUsd: 1 } }).costMicros, 1_000_000)
})
