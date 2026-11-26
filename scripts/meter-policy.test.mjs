import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_METERING, budgetLevel, route, monthKey, dayKey, resetsOn, videoAllowance, allowanceSummary,
  aiActionsPerDay, meteringEnabled,
} from '../web/app/server/metering/policy.mjs'

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)
// A meter with own keys on (settings.ownKeys): they pay first and its words name them. Own keys on
// Slatebox Cloud: scripts/own-keys-cloud.test.mjs.
const settings = { ...DEFAULT_METERING, ownKeys: true }
const person = { id: 'p1', anonymous: false, emailVerified: true }
const empty = { aiActionsToday: 0, aiMicrosMonth: 0, freeMicrosToday: 0, voiceMinutesMonth: 0, videoMinutesMonth: 0 }
const quiet = { monthFreeMicros: 0, todayFreeMicros: 0 }
function ask(overrides = {}) {
  return route({
    kind: 'ai', person, teamId: null, keys: {}, usage: empty, wallets: {}, global: quiet,
    estimateMicros: 5000, settings, now: NOW, ...overrides,
  })
}

test('defaults: Pro credits sized to $3.75 of provider cost a month, so yearly Pro covers full use in the worst likely case', () => {
  assert.equal(settings.free.aiActionsPerDay, 30)
  assert.equal(settings.free.creditCostMicrosPerMonth, 3_750_000)
  assert.equal(settings.free.aiMicrosPerMonth, 937_500)
  assert.equal(settings.free.voiceMinutesPerMonth, 1380)
  assert.equal(settings.free.videoMinutesPerMonth, 330)
  assert.equal(settings.free.perPersonMicrosPerDay, 500_000)
  assert.equal(settings.budget.monthlyMicros, 1_000_000_000)
  assert.equal(settings.marginPercent, 5)
})

test('metering is on only when settings say so, and off on self-host by default', () => {
  // Restated (owner decision 2026-11-24): the meter runs only on Slatebox Cloud by its Cloud key
  // (cloud-lock.mjs); `cloud` is that answer, false unless the caller says so
  assert.equal(meteringEnabled({ metering: { enabled: true }, public: { env: 'prod' } }, { cloud: true }), true)
  assert.throws(() => meteringEnabled({ metering: { enabled: true }, public: { env: 'prod' } }), /Slatebox Cloud key/)
  // the Cloud fails closed: production without the meter does not start (pricing-fixes-ai C2)
  assert.throws(() => meteringEnabled({ public: { env: 'prod' } }), /metering\.enabled/)
  assert.equal(meteringEnabled({ public: { env: 'selfhost' } }), false)
  // Restated: a self-hosted server has no meter, even when its settings switch one on
  assert.equal(meteringEnabled({ metering: { enabled: true }, public: { env: 'selfhost' } }), false)
})

test('route order is own key, then free, then balance, then a refusal', () => {
  const withKey = ask({ keys: { personal: { ai: true } } })
  assert.deepEqual([withKey.route, withKey.keyOwner], ['byok', { type: 'user', id: 'p1' }])
  const teamKey = ask({ teamId: 't1', keys: { team: { ai: true } } })
  assert.deepEqual([teamKey.route, teamKey.keyOwner], ['byok', { type: 'org', id: 't1' }])
  assert.equal(ask().route, 'free')
  const spent = { ...empty, aiActionsToday: 30 }
  const balance = ask({ usage: spent, wallets: { personal: { balanceMicros: 1_000_000 } } })
  assert.deepEqual([balance.route, balance.payer], ['balance', { type: 'user', id: 'p1' }])
  const team = ask({ usage: spent, teamId: 't1', wallets: { personal: { balanceMicros: 0 }, team: { balanceMicros: 1_000_000 } } })
  assert.deepEqual([team.route, team.payer], ['balance', { type: 'org', id: 't1' }])
  const refused = ask({ usage: spent })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'ai-today')
  assert.match(refused.message, /^You have used today's free AI\. Add your own key or top up in your profile\.$/)
})

test('own keys work at every stage with no cap', () => {
  const over = { monthFreeMicros: 2_000_000_000, todayFreeMicros: 0 }
  const r = ask({ keys: { personal: { ai: true } }, global: over, usage: { ...empty, aiActionsToday: 999 } })
  assert.equal(r.route, 'byok')
  const call = ask({ kind: 'video', keys: { personal: { daily: true } }, global: over })
  assert.equal(call.route, 'byok')
  assert.equal(call.kind, 'video')
})

test('guests are refused AI, image search and starting calls', () => {
  const guest = { id: 'g', anonymous: true, emailVerified: false }
  assert.equal(ask({ person: guest }).message, 'Sign in to use AI.')
  assert.equal(ask({ person: guest, kind: 'imageSearch' }).code, 'guest')
  assert.equal(ask({ person: guest, kind: 'voice' }).message, 'Sign in to start a call. Anyone can join a call that is already running.')
  assert.equal(ask({ person: null }).code, 'guest')
  // a guest holding a balance still cannot spend it
  assert.equal(ask({ person: guest, wallets: { personal: { balanceMicros: 9e9 } } }).ok, false)
})

test('an unverified email gets no free amount but may use an own key', () => {
  const unverified = { ...person, emailVerified: false }
  assert.equal(ask({ person: unverified }).code, 'unverified')
  assert.equal(ask({ person: unverified, keys: { personal: { ai: true } } }).route, 'byok')
})

test('30 drafts a day, and the hidden month ceiling ($0.9375) refuses a request that would cross it', () => {
  assert.equal(ask({ usage: { ...empty, aiActionsToday: 29 } }).route, 'free')
  assert.equal(ask({ usage: { ...empty, aiActionsToday: 30 } }).code, 'ai-today')
  const nearMonth = { ...empty, aiMicrosMonth: 933_500 }
  const crossing = ask({ usage: nearMonth })
  assert.equal(crossing.code, 'ai-month')
  assert.equal(crossing.message, "You have used this month's free AI. Add your own key or top up in your profile.")
  assert.equal(ask({ usage: nearMonth, estimateMicros: 4000 }).route, 'free')
})

test('image search counts dollars, not drafts', () => {
  assert.equal(ask({ kind: 'imageSearch', usage: { ...empty, aiActionsToday: 30 } }).route, 'free')
  assert.equal(ask({ kind: 'imageSearch', usage: { ...empty, aiMicrosMonth: 936_000 } }).code, 'ai-month')
})

test('$0.50 a day applies to AI and to starting a call', () => {
  // AI: a $0.005 estimate on top of $0.497 crosses $0.50
  assert.equal(ask({ usage: { ...empty, freeMicrosToday: 497_000 } }).code, 'ai-today')
  assert.equal(ask({ usage: { ...empty, freeMicrosToday: 495_000 } }).route, 'free')
  // a call start: ten voice minutes ($0.0099) on top of $0.490 fits, on top of $0.491 does not
  assert.equal(ask({ usage: { ...empty, freeMicrosToday: 490_000 }, kind: 'voice', minutes: 10 }).route, 'free')
  const call = ask({ usage: { ...empty, freeMicrosToday: 491_000 }, kind: 'voice', minutes: 10 })
  assert.equal(call.code, 'calls-today')
})

test('running calls are not cut by the daily ceiling (extension is checked without it)', () => {
  const full = { ...empty, freeMicrosToday: 10_000_000 }
  const extend = ask({ usage: full, kind: 'voice', minutes: 60, running: true })
  assert.equal(extend.route, 'free')
})

test('budget stages switch at 50, 70, 90, 100 and 110 percent', () => {
  const at = percent => budgetLevel({ monthFreeMicros: percent * 10_000_000, todayFreeMicros: 0, budget: settings.budget }).level
  assert.deepEqual([49.9, 50, 69.9, 70, 89.9, 90, 99.9, 100, 109.9, 110, 150].map(at), [0, 50, 50, 70, 70, 90, 90, 100, 100, 110, 110])
})

test('the admin hold raises the stage but never lowers it', () => {
  const held = { ...settings.budget, hold: 'pause-calls' }
  assert.equal(budgetLevel({ monthFreeMicros: 0, todayFreeMicros: 0, budget: held }).level, 100)
  assert.equal(budgetLevel({ monthFreeMicros: 1_200_000_000, todayFreeMicros: 0, budget: held }).level, 110)
  for (const [hold, level] of [['video-to-voice', 70], ['smaller-ai', 90], ['pause-ai', 110], [null, 0]]) {
    assert.equal(budgetLevel({ monthFreeMicros: 0, todayFreeMicros: 0, budget: { ...settings.budget, hold } }).level, level)
  }
})

test('the daily ceiling of P / 20 applies the 100 percent rules for the rest of the UTC day', () => {
  const b = budgetLevel({ monthFreeMicros: 100_000_000, todayFreeMicros: 50_000_000, budget: settings.budget })
  assert.equal(b.level, 100)
  assert.equal(b.dailyCeilingHit, true)
  assert.equal(budgetLevel({ monthFreeMicros: 100_000_000, todayFreeMicros: 49_999_999, budget: settings.budget }).level, 0)
})

test('70 percent: new free video starts as voice; 90 percent: 10 drafts a day; 100 percent: free calls pause; 110 percent: free AI pauses', () => {
  const at = percent => ({ monthFreeMicros: percent * 10_000_000, todayFreeMicros: 0 })
  const video70 = ask({ kind: 'video', global: at(70) })
  assert.deepEqual([video70.route, video70.kind, video70.fellBackToVoice], ['free', 'voice', true])
  assert.equal(ask({ kind: 'video', global: at(69) }).kind, 'video')
  assert.equal(aiActionsPerDay(settings, 90), 10)
  assert.equal(aiActionsPerDay(settings, 89), 30)
  assert.equal(ask({ global: at(90), usage: { ...empty, aiActionsToday: 10 } }).code, 'ai-today')
  assert.equal(ask({ global: at(90), usage: { ...empty, aiActionsToday: 9 } }).route, 'free')
  const paused = ask({ kind: 'voice', global: at(100) })
  assert.equal(paused.message, 'Free calls are paused until the 1st. Calls on your own Daily key or your balance still work.')
  assert.equal(ask({ global: at(100) }).route, 'free')
  assert.equal(ask({ global: at(110) }).message, 'Free AI is paused until the 1st. Your own key and your balance still work.')
  // balances keep working at every stage
  assert.equal(ask({ global: at(110), wallets: { personal: { balanceMicros: 1_000_000 } } }).route, 'balance')
  assert.equal(ask({ kind: 'voice', global: at(100), wallets: { personal: { balanceMicros: 1_000_000 } } }).route, 'balance')
})

test('video falls back to voice when the month of free video is used', () => {
  const r = ask({ kind: 'video', usage: { ...empty, videoMinutesMonth: 495 } })
  assert.deepEqual([r.route, r.kind, r.fellBackToVoice], ['free', 'voice', true])
  assert.match(r.notice, /^Your free video for this month is used up, so this call is voice\./)
  const withBalance = ask({ kind: 'video', usage: { ...empty, videoMinutesMonth: 495 }, wallets: { personal: { balanceMicros: 5_000_000 } } })
  assert.deepEqual([withBalance.route, withBalance.kind], ['balance', 'video'])
  const none = ask({ kind: 'video', usage: { ...empty, videoMinutesMonth: 500, voiceMinutesMonth: 2400 } })
  assert.equal(none.code, 'calls-month')
})

test('balance needs to cover the estimate plus the margin; frozen wallets are refused; video waits 24 hours after a top-up', () => {
  const spent = { ...empty, aiActionsToday: 30 }
  assert.equal(ask({ usage: spent, wallets: { personal: { balanceMicros: 5250 } } }).route, 'balance')
  assert.equal(ask({ usage: spent, wallets: { personal: { balanceMicros: 5249 } } }).ok, false)
  const frozen = ask({ usage: spent, wallets: { personal: { balanceMicros: 9e9, frozen: true } } })
  assert.equal(frozen.message, 'Your balance is on hold. Write to us at https://slatebox.com/contact/?topic=billing.')
  const noVideo = { ...empty, videoMinutesMonth: 500 }
  const fresh = ask({ kind: 'video', usage: noVideo, wallets: { personal: { balanceMicros: 10_000_000, recentTopUpMicros: 10_000_000 } } })
  assert.deepEqual([fresh.route, fresh.kind], ['free', 'voice'])
  const aged = ask({ kind: 'video', usage: noVideo, wallets: { personal: { balanceMicros: 10_000_000, recentTopUpMicros: 0 } } })
  assert.deepEqual([aged.route, aged.kind], ['balance', 'video'])
})

test('UTC month and day boundaries', () => {
  const lastSecond = Date.UTC(2026, 10, 30, 23, 59, 59)
  const first = Date.UTC(2026, 11, 1, 0, 0, 0)
  assert.equal(monthKey(lastSecond), '2026-11')
  assert.equal(monthKey(first), '2026-12')
  assert.equal(dayKey(lastSecond), '2026-11-30')
  assert.equal(dayKey(first), '2026-12-01')
  assert.equal(resetsOn(NOW), '1 December')
  assert.equal(resetsOn(Date.UTC(2026, 11, 31)), '1 January')
})

test('everyone has the same video minutes: 330 a month', () => {
  assert.equal(videoAllowance(settings), 330)
  const video = ask({ kind: 'video', usage: { ...empty, videoMinutesMonth: 310 } })
  assert.equal(video.kind, 'video')
})

test('the summary a person sees has plain numbers and never micros, stages or the dollar ceiling', () => {
  const s = allowanceSummary({
    person, usage: { ...empty, aiActionsToday: 6, voiceMinutesMonth: 60, videoMinutesMonth: 120 },
    wallets: { personal: { balanceMicros: 12_400_000 } }, global: quiet, settings, now: NOW, keys: { ai: 'DeepInfra key ending 4f2a', daily: null },
  })
  assert.deepEqual(s, {
    aiLeftToday: 24, aiPerDay: 30, aiMonthUsedUp: false, voiceHoursLeft: 5.5, videoHoursLeft: 0.5,
    resetsOn: '1 December', balanceCents: 1240, keys: { ai: 'DeepInfra key ending 4f2a', daily: null }, stageNote: null,
    // where Slatebox Pro is never needed (self-host, the default), the month's amount is everyone's
    included: true, pro: false, needsPro: false, proRequiredFrom: 'never',
    credits: {
      costDollars: 3.75, draftsPerDay: 30, draftsPerMonth: 180, voiceHours: 5.5, videoHours: 1,
      sentence: 'Each month: about 180 AI drafts (up to 30 a day), about 5½ hours of four-person voice calls and about 1 hour of four-person video calls.',
    },
  })
  assert.doesNotMatch(JSON.stringify(s), /micros|1000000|percent/i)
  const used = allowanceSummary({ person, usage: { ...empty, aiMicrosMonth: 937_500 }, wallets: {}, global: quiet, settings, now: NOW, keys: {} })
  assert.equal(used.aiMonthUsedUp, true)
  const paused = allowanceSummary({ person, usage: empty, wallets: {}, global: { monthFreeMicros: 1_000_000_000, todayFreeMicros: 0 }, settings, now: NOW, keys: {} })
  assert.equal(paused.stageNote, 'Free calls are paused until the 1st. Calls on your own Daily key or your balance still work.')
  const pausedAI = allowanceSummary({ person, usage: empty, wallets: {}, global: { monthFreeMicros: 1_100_000_000, todayFreeMicros: 0 }, settings, now: NOW, keys: {} })
  assert.equal(pausedAI.stageNote, 'Free AI and free calls are paused until the 1st. Your own keys and your balance still work.')
})
