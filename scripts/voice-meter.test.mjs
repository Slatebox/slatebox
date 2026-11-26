// The meter of a voice session (web/app/server/voice/meter.mjs, metering/policy.mjs): voice on
// Slatebox Cloud is never paid from a free amount, only from Pro credits, a balance or the person's
// own key; each minute is one held meter action, every usage report is recorded at the voice
// model's audio and text prices, and a minute that cannot be held or spends past its ceiling ends
// the session (cap). Own keys and servers with no meter are never charged. The tick also ends a
// session at its time limit and after a quiet stretch.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_METERING, VOICE_METER_FEATURES, messageFor, route } from '../web/app/server/metering/policy.mjs'
import { voicePrice } from '../web/app/server/metering/prices.mjs'
import { VOICE_LIMITS, createVoiceMeter, voiceLimits, voiceTick } from '../web/app/server/voice/meter.mjs'
import { PAY_CODES, payRoute } from '../web/app/imports/api/billing/pay-route.mjs'
import { SURFACES } from '../web/app/server/ai-control/catalogue.mjs'

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0)
const MIN = 60_000
const settings = { ...DEFAULT_METERING, ownKeys: true }
const person = { id: 'p1', anonymous: false, emailVerified: true }
const empty = { aiActionsToday: 0, aiMicrosMonth: 0, freeMicrosToday: 0, voiceMinutesMonth: 0, videoMinutesMonth: 0 }
const ask = (overrides = {}) => route({
  kind: 'ai', feature: 'voice-chat', person, teamId: null, keys: {}, usage: empty, wallets: {}, global: { monthFreeMicros: 0, todayFreeMicros: 0 },
  estimateMicros: 50_000, settings, now: NOW, ...overrides,
})

test('the voice meter features are the voice parts\' own', () => {
  assert.deepEqual([...VOICE_METER_FEATURES].sort(), SURFACES.filter((s) => s.needs.includes('voice')).flatMap((s) => s.meterFeatures).sort())
})

test('voice is never paid from a free amount: Pro credits, a balance or an own key', () => {
  // the same person, the same day: a chat turn is free, a voice minute is not
  assert.equal(ask({ feature: 'chat' }).route, 'free')
  // the typed interview is paid from the personalization allowance (metering/allowance.mjs); its voice minute is not
  assert.equal(ask({ feature: 'interview' }).route, 'allowance')
  assert.equal(ask({ feature: 'voice-interview' }).code, 'pro-voice')
  const refused = ask()
  assert.deepEqual([refused.ok, refused.code], [false, 'pro-voice'])
  assert.match(refused.message, /Talking with the agent comes with Slatebox Pro/)
  assert.match(refused.message, /your own voice key/, 'own keys on: the words name them')
  assert.doesNotMatch(messageFor('pro-voice', null, { ownKeys: false }), /own/)
  // Pro credits pay, bounded by the person's own caps
  const pro = ask({ person: { ...person, pro: true } })
  assert.deepEqual([pro.ok, pro.route, pro.pro], [true, 'free', true])
  // a balance pays
  const wallet = { balanceMicros: 5_000_000, heldMicros: 0 }
  assert.deepEqual([ask({ wallets: { personal: wallet } }).route, ask({ wallets: { personal: wallet } }).payer], ['balance', { type: 'user', id: 'p1' }])
  // the person's own key pays (their own choice serves voice), no Pro needed
  assert.equal(ask({ keys: { personal: { ai: true } } }).route, 'byok')
  // where Pro is needed and they have none, the same refusal
  assert.equal(ask({ person: { ...person, included: false } }).code, 'pro-voice')
  // a guest has no voice
  assert.equal(ask({ person: { id: 'g', anonymous: true } }).code, 'guest')
  // the pay sheet offers Pro for it
  assert.ok(PAY_CODES.includes('pro-voice'))
  assert.equal(payRoute({ code: 'pro-voice', summary: { emailVerified: true, proState: null, proAvailable: true, topUpsAvailable: true } }).action, 'pro')
})

function fakeMeter({ refuseAt = Infinity, ceilingMicros = 200_000 } = {}) {
  const log = []
  let n = 0
  return {
    log,
    enabled: () => true,
    async begin(opts) {
      n += 1
      if (n >= refuseAt) throw Object.assign(new Error('no credits'), { error: 'ai-month', reason: "You have used this month's Pro credits for AI." })
      log.push(['begin', opts])
      return { actionId: `a${n}`, ceilingMicros }
    },
    async record(action, entry) {
      log.push(['record', action.actionId, entry])
      return { costMicros: entry.costMicros }
    },
    async finish(action, outcome) { log.push(['finish', action.actionId, outcome]) },
  }
}

const price = voicePrice('gpt-realtime-2.1')
const minute = { audioIn: 600, audioOut: 1200, textIn: 1000 } // 100,000 µ$ at gpt-realtime-2.1

test('each minute is one held action; usage is recorded at audio and text prices, once each, on the minute it arrived in', async () => {
  const meter = fakeMeter()
  const vm = createVoiceMeter({ meter, metered: true, userId: 'p1', feature: 'voice-chat', sessionId: 's1', model: 'gpt-realtime-2.1', price })
  assert.deepEqual(await vm.start(), { ok: true })
  assert.deepEqual(meter.log[0], ['begin', { feature: 'voice-chat', kind: 'ai', userId: 'p1', countsAsDraft: false }])
  assert.equal((await vm.usage(minute)).costMicros, 100_000)
  // a tick and a report at the same moment: the report lands on the minute it arrived in
  const [ticked, reported] = await Promise.all([vm.tick(), vm.usage({ audioIn: 300 })])
  assert.deepEqual([ticked.ok, reported.ok], [true, true])
  await vm.end()
  assert.deepEqual(meter.log.map(([kind, id]) => (kind === 'begin' ? kind : `${kind}:${id}`)), ['begin', 'record:a1', 'finish:a1', 'begin', 'record:a2', 'finish:a2'])
  const refs = meter.log.filter(([kind]) => kind === 'record').map(([, , entry]) => entry.ref)
  assert.deepEqual(refs, ['voice:s1:1', 'voice:s1:2'], 'each report recorded once, under its own ref')
  assert.equal(meter.log[1][2].model, 'gpt-realtime-2.1')
  assert.equal(meter.log[1][2].usage.totalTokens, 2800)
  assert.equal(vm.spentMicros(), 100_000 + 9600)
})

test('a minute that cannot be held, or spends past its ceiling, is a cap', async () => {
  const refused = fakeMeter({ refuseAt: 2 })
  const vm = createVoiceMeter({ meter: refused, metered: true, userId: 'p1', feature: 'voice-chat', sessionId: 's2', model: 'gpt-realtime-2.1', price })
  assert.equal((await vm.start()).ok, true)
  const next = await vm.tick()
  assert.deepEqual([next.ok, next.code], [false, 'ai-month'])
  assert.match(next.message, /Pro credits/)
  const tight = fakeMeter({ ceilingMicros: 150_000 })
  const vm2 = createVoiceMeter({ meter: tight, metered: true, userId: 'p1', feature: 'voice-chat', sessionId: 's3', model: 'gpt-realtime-2.1', price })
  await vm2.start()
  assert.equal((await vm2.usage(minute)).ok, true)
  const over = await vm2.usage(minute)
  assert.deepEqual([over.ok, over.code], [false, 'cap'])
  const none = fakeMeter({ refuseAt: 1 })
  assert.equal((await createVoiceMeter({ meter: none, metered: true, userId: 'p1', feature: 'voice-chat', sessionId: 's4', model: 'm', price }).start()).ok, false)
})

test('an own key or a server with no meter is never charged: no hold, no record', async () => {
  const meter = fakeMeter()
  const vm = createVoiceMeter({ meter, metered: false, userId: 'p1', feature: 'voice-chat', sessionId: 's5', model: 'gpt-realtime-2.1', price })
  assert.equal((await vm.start()).ok, true)
  assert.deepEqual(await vm.usage(minute), { ok: true, costMicros: 0 })
  assert.equal((await vm.tick()).ok, true)
  await vm.end()
  assert.deepEqual(meter.log, [])
  assert.equal(vm.spentMicros(), 0)
})

test('the tick: a session ends at its time limit and after a quiet stretch; the operator may change both', () => {
  const session = { startedAt: NOW, lastActivityAt: NOW, tickIndex: 0 }
  assert.deepEqual(voiceTick({ session, now: NOW + MIN }), { decision: 'continue', set: { lastTickAt: NOW + MIN, tickIndex: 1 } })
  assert.equal(voiceTick({ session: { ...session, lastActivityAt: NOW + 29 * MIN }, now: NOW + VOICE_LIMITS.maxMinutes * MIN }).reason, 'limit')
  assert.equal(voiceTick({ session, now: NOW + VOICE_LIMITS.idleMinutes * MIN }).reason, 'idle')
  assert.equal(voiceTick({ session: { ...session, lastActivityAt: NOW + 4 * MIN }, now: NOW + 5 * MIN }).decision, 'continue')
  const limits = voiceLimits({ voice: { maxMinutes: 60, idleMinutes: 2, perPod: 10 } })
  assert.deepEqual([limits.maxMinutes, limits.idleMinutes, limits.perPod], [60, 2, 10])
  assert.deepEqual(voiceLimits({ voice: { maxMinutes: 0, idleMinutes: 'x', perPod: 1e9 } }), VOICE_LIMITS, 'a wrong value keeps the default')
  assert.equal(voiceTick({ session, now: NOW + 2 * MIN, limits }).reason, 'idle')
})

test('a minute before the time limit or the quiet stretch ends a session, the tick warns (the time limit first)', () => {
  const MIN = 60_000
  const NOW = 1_700_000_000_000
  const session = { startedAt: NOW, lastActivityAt: NOW, tickIndex: 0 }
  assert.equal(voiceTick({ session: { ...session, lastActivityAt: NOW + 28 * MIN }, now: NOW + 29 * MIN }).warn, 'limit')
  assert.equal(voiceTick({ session: { ...session, lastActivityAt: NOW + 10 * MIN }, now: NOW + 14 * MIN }).warn, 'idle')
  assert.equal(voiceTick({ session: { ...session, lastActivityAt: NOW + 10 * MIN }, now: NOW + 13 * MIN }).warn, undefined)
  assert.equal(voiceTick({ session: { ...session, lastActivityAt: NOW + 25 * MIN }, now: NOW + 29 * MIN }).warn, 'limit')
  assert.equal(voiceLimits({ voice: { perPerson: 3 } }).perPerson, 3)
  assert.equal(voiceLimits({ voice: { perPerson: 0 } }).perPerson, VOICE_LIMITS.perPerson)
})
