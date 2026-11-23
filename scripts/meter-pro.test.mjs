// Slatebox Pro and the meter. Pro switches on the monthly amount everyone had before it
// (included: true); without it, once settings.free.proRequiredFrom has passed, own keys stay free,
// a balance pays, the free presentation plan stays at the guest caps, and everything else is
// refused with a clear message. Pro credits are never paused by the shared budget.
import test from 'node:test'
import assert from 'node:assert/strict'
import { meterWorld, NOW } from './fixtures/meter-world.mjs'
import { runAIAction, installMeter, chargeFixed } from '../web/app/server/metering/context.mjs'
import { COPY, DEFAULT_METERING, allowanceSummary, budgetLevel, messageFor, proNeeded, route } from '../web/app/server/metering/policy.mjs'
import { recordUsage } from '../web/app/server/metering/record.mjs'
import { CALL_COPY, startCall, tick } from '../web/app/server/metering/calls.mjs'
import { proActive, proIncluded } from '../web/app/server/pro-billing.mjs'

const DAY = 86_400_000
const quiet = { monthFreeMicros: 0, todayFreeMicros: 0 }
// Slatebox Cloud: Pro is needed from now (owner decision 2026-11-22)
const switched = { ...DEFAULT_METERING, free: { ...DEFAULT_METERING.free, proRequiredFrom: 'now' } }
// what meteor.js personOf gives for a person after the switch
const noPro = { id: 'p1', anonymous: false, emailVerified: true, included: false, pro: false, proPastDue: false }
const withPro = { id: 'p1', anonymous: false, emailVerified: true, included: true, pro: true, proPastDue: false }
const pastDue = { ...noPro, proPastDue: true }
const ask = (overrides = {}) => route({
  kind: 'ai', person: noPro, teamId: null, keys: {}, usage: {}, wallets: {}, global: quiet,
  estimateMicros: 5000, settings: switched, now: NOW, ...overrides,
})

test('the switch: "never" by default (self-host), "now" on Cloud, or a moment', () => {
  assert.equal(DEFAULT_METERING.free.proRequiredFrom, 'never')
  assert.equal(proNeeded(DEFAULT_METERING, NOW), false)
  assert.equal(proNeeded(switched, NOW), true)
  assert.equal(proNeeded({ free: { proRequiredFrom: NOW + 1 } }, NOW), false)
  assert.equal(proNeeded({ free: { proRequiredFrom: NOW - DAY } }, NOW), true)
  // meteor.js personOf: included for everyone where Pro is not needed, for Pro only where it is
  const pro = { status: 'active', currentPeriodEnd: NOW + DAY }
  assert.equal(proIncluded(undefined, NOW, DEFAULT_METERING), true)
  assert.equal(proIncluded(undefined, NOW, switched), false)
  assert.equal(proIncluded(pro, NOW, switched), true)
  assert.equal(proActive(pro, NOW), true)
})

const pick = (r) => [r.ok, r.code, r.route]

test('without Pro: included AI is refused with the exact words, and nothing is spent', () => {
  const r = ask()
  assert.deepEqual(r, { ok: false, code: 'pro', message: 'AI on Slatebox comes with Slatebox Pro, $5 a month, or a balance. Get Pro or top up in your profile.' })
  assert.equal(r.message, COPY.getPro)
})

test('Slatebox Cloud never uses an own AI key, a team key or a Daily key saved before: without Pro they are refused as Pro', () => {
  assert.deepEqual(pick(ask({ keys: { personal: { ai: true } } })), [false, 'pro', undefined])
  assert.deepEqual(pick(ask({ teamId: 't1', keys: { team: { ai: true } } })), [false, 'pro', undefined])
  assert.deepEqual(pick(ask({ kind: 'voice', keys: { personal: { daily: true } } })), [false, 'pro-calls', undefined])
  assert.deepEqual(pick(ask({ kind: 'video', keys: { personal: { daily: true }, team: { daily: true } }, teamId: 't1' })), [false, 'pro-calls', undefined])
  // with Pro, its credits pay, never the saved key
  assert.deepEqual(pick(ask({ person: withPro, keys: { personal: { ai: true } } })), [true, undefined, 'free'])
})

test('without Pro: a balance pays, then the team balance; a balance too small says so', () => {
  const mine = ask({ wallets: { personal: { balanceMicros: 1_000_000 } } })
  assert.deepEqual([mine.route, mine.payer], ['balance', { type: 'user', id: 'p1' }])
  const team = ask({ teamId: 't1', wallets: { personal: { balanceMicros: 0 }, team: { balanceMicros: 1_000_000 } } })
  assert.deepEqual([team.route, team.payer], ['balance', { type: 'org', id: 't1' }])
  const low = ask({ wallets: { personal: { balanceMicros: 100 } } })
  assert.equal(low.code, 'pro')
  assert.equal(low.message, `${COPY.getPro} Your balance is too low for this request.`)
  assert.equal(ask({ wallets: { personal: { balanceMicros: 9e9, frozen: true } } }).code, 'frozen')
})

test('without Pro: image search and image generation need Pro or a balance; an AI key never covers them', () => {
  for (const kind of ['imageSearch', 'imageGeneration']) {
    const r = ask({ kind, keys: { personal: { ai: true } } })
    assert.deepEqual([r.ok, r.code, r.message], [false, 'pro-images', 'Image search and image generation come with Slatebox Pro or a balance. Get Pro or top up in your profile.'], kind)
    assert.equal(ask({ kind, wallets: { personal: { balanceMicros: 1_000_000 } } }).route, 'balance', kind)
  }
})

test('without Pro: starting a call is refused unless a Daily key or a balance pays; video falls back to voice a balance covers', () => {
  for (const kind of ['voice', 'video']) {
    const r = ask({ kind })
    assert.deepEqual([r.ok, r.code, r.message], [false, 'pro-calls', "Starting a call comes with Slatebox Pro, $5 a month, or a balance. Anyone can join a call that's already running."], kind)
  }
  const voiceOnly = ask({ kind: 'video', minutes: 10, wallets: { personal: { balanceMicros: 1_000_000, recentTopUpMicros: 1_000_000 } } })
  assert.deepEqual([voiceOnly.ok, voiceOnly.route, voiceOnly.kind, voiceOnly.fellBackToVoice], [true, 'balance', 'voice', true])
  assert.equal(voiceOnly.notice, COPY.balanceVoiceOnly)
})

test('past due: credits are paused with the card message, and the balance still works (a saved own key does not, on Cloud)', () => {
  for (const kind of ['ai', 'voice', 'imageSearch']) {
    const r = ask({ kind, person: pastDue })
    assert.deepEqual([r.code, r.message], ['pro-past-due', "Your Pro payment didn't go through, so your credits are paused. Update your card in your profile. Your balance still works."], kind)
  }
  assert.equal(ask({ person: pastDue, keys: { personal: { ai: true } } }).code, 'pro-past-due')
  assert.equal(ask({ person: pastDue, wallets: { personal: { balanceMicros: 1_000_000 } } }).route, 'balance')
})

test('without Pro the presentation plan stays free at the guest caps, and guestPresentationsPerDay: 0 turns it off', () => {
  const plan = ask({ feature: 'presentation' })
  assert.deepEqual([plan.ok, plan.route, plan.draftsPerDay, plan.perAddressPerDay], [true, 'free', 5, 20])
  const used = ask({ feature: 'presentation', usage: { aiActionsToday: 5 } })
  assert.equal(used.code, 'pro')
  // a balance pays once the plans are used
  assert.equal(ask({ feature: 'presentation', usage: { aiActionsToday: 5 }, wallets: { personal: { balanceMicros: 1_000_000 } } }).route, 'balance')
  const off = { ...switched, free: { ...switched.free, guestPresentationsPerDay: 0 } }
  assert.equal(ask({ feature: 'presentation', settings: off }).code, 'pro')
  assert.equal(route({ kind: 'ai', feature: 'presentation', person: { id: 'g', anonymous: true }, usage: {}, global: quiet, settings: off, now: NOW }).code, 'presentations-today')
})

test('Pro: its credits (sized to $3.75 a month), in Pro words once used up', () => {
  const r = ask({ person: withPro })
  assert.deepEqual([r.ok, r.route, r.pro, r.level], [true, 'free', true, 0])
  const drafts = ask({ person: withPro, usage: { aiActionsToday: 30 } })
  assert.deepEqual([drafts.code, drafts.message], ['ai-today', "You have used today's Pro credits for AI. Top up in your profile."])
  assert.equal(ask({ person: withPro, usage: { aiActionsToday: 29 } }).ok, true)
  assert.equal(ask({ person: withPro, usage: { aiMicrosMonth: 936_000 }, estimateMicros: 5000 }).code, 'ai-month')
  assert.equal(ask({ person: withPro, kind: 'voice', usage: { voiceMinutesMonth: 1380 } }).message, "You have used this month's Pro credits for calls. Top up in your profile.")
  assert.equal(ask({ person: withPro, kind: 'voice', usage: { voiceMinutesMonth: 1370 } }).ok, true)
  assert.equal(ask({ person: withPro, kind: 'video', minutes: 10, usage: { videoMinutesMonth: 330, voiceMinutesMonth: 1380 } }).code, 'calls-month')
  assert.equal(ask({ person: withPro, kind: 'video', minutes: 10, usage: { videoMinutesMonth: 320 } }).kind, 'video')
  // before the switch, the same person without Pro hears the words of the free amount
  assert.equal(messageFor('ai-today'), COPY.aiToday)
  assert.equal(messageFor('ai-today', { pro: true }), COPY.proAiToday)
})

test('Pro is never paused by the shared budget: at 110% Pro AI and calls still run; everyone else free is paused', () => {
  const over = { monthFreeMicros: DEFAULT_METERING.budget.monthlyMicros * 1.2, todayFreeMicros: DEFAULT_METERING.budget.monthlyMicros }
  assert.equal(ask({ person: withPro, global: over }).route, 'free')
  assert.equal(ask({ person: withPro, kind: 'video', global: over }).kind, 'video')
  // the same amount before the switch (no Pro) follows the stages, as today
  const free = route({ kind: 'ai', person: { id: 'p2', anonymous: false, emailVerified: true }, usage: {}, wallets: {}, global: over, estimateMicros: 5000, settings: DEFAULT_METERING, now: NOW })
  assert.equal(free.code, 'ai-paused')
})

test('the meter holds a Pro request past the global cap but still caps the person\'s day and month', async () => {
  const w = await meterWorld({ person: { included: true, pro: true }, globalMonth: DEFAULT_METERING.budget.monthlyMicros * 2, settings: structuredClone(switched) })
  const out = await runAIAction({ feature: 'workshop' }, async () => { await chargeFixed({ ref: 'pro-1', kind: 'imageSearch', costMicros: 5000, model: 'google-cse' }); return 'drafted' })
  assert.equal(out, 'drafted')
  assert.equal(w.spent().drafts, 1)
  // the global month counts the request as Pro credits (admin totals), never in the shared budget
  assert.equal(w.global().monthFreeMicros, DEFAULT_METERING.budget.monthlyMicros * 2)
  assert.ok(w.global().monthProMicros > 0)
  // and the day cap still holds
  const settings = structuredClone(switched)
  settings.free.aiActionsPerDay = 1
  const w2 = await meterWorld({ person: { included: true, pro: true }, globalMonth: DEFAULT_METERING.budget.monthlyMicros * 2, settings })
  await runAIAction({ feature: 'workshop' }, async () => 'one')
  await assert.rejects(runAIAction({ feature: 'workshop' }, async () => 'two'), error => error.error === 'ai-today' && /Pro credits/.test(error.reason))
  installMeter(null)
})

test('Pro spend alone never raises the shared budget\'s level, its daily rule or its held amount', async () => {
  const settings = structuredClone(switched)
  settings.free.aiActionsPerDay = 1000
  settings.free.aiMicrosPerMonth = 1e12
  settings.free.perPersonMicrosPerDay = 1e12
  const w = await meterWorld({ person: { included: true, pro: true }, settings })
  // a request in flight sets its hold aside as Pro, not in the budget's heldMicros
  let during = null
  await runAIAction({ feature: 'workshop' }, async () => { during = w.global(); await chargeFixed({ ref: 'p-first', kind: 'imageSearch', costMicros: 5000, model: 'google-cse' }); return 'drafted' })
  assert.equal(during.heldMicros, 0)
  assert.ok(during.heldProMicros > 0)
  for (let i = 0; i < 20; i++) await runAIAction({ feature: 'workshop' }, () => chargeFixed({ ref: 'p' + i, kind: 'imageSearch', costMicros: 5000, model: 'google-cse' }))
  const g = w.global()
  assert.deepEqual([g.monthFreeMicros, g.todayFreeMicros, g.heldMicros, g.heldProMicros], [0, 0, 0, 0])
  assert.ok(g.monthProMicros > 0 && g.todayProMicros === g.monthProMicros)
  assert.equal(budgetLevel({ monthFreeMicros: g.monthFreeMicros, todayFreeMicros: g.todayFreeMicros, budget: settings.budget }).level, 0)
  installMeter(null)

  // a call started on Pro: its minutes count as Pro, even far past the whole shared budget
  const rows = new Map()
  const io = {
    async insertEvent() { return true },
    async inc(key, fields) { const row = rows.get(key) || {}; for (const [k, v] of Object.entries(fields)) row[k] = (row[k] || 0) + v; rows.set(key, row) },
  }
  const big = DEFAULT_METERING.budget.monthlyMicros * 2
  await recordUsage(io, { ref: 'c1:1', payer: { type: 'user', id: 'p1' }, actorId: 'p1', kind: 'voice', route: 'free', feature: 'call', units: 10, costMicros: big, now: NOW, settings, pro: true })
  const month = rows.get('global:2026-11'), day = rows.get('global:2026-11-19')
  assert.equal(month.freeMicros, undefined)
  assert.equal(day.freeMicros, undefined)
  assert.equal(month.proMicros, big)
  assert.equal(month['proByKind.voice'], big)
  assert.equal(rows.get('user:p1:2026-11').voiceMinutes, 10, 'the person\'s own month still counts it')
  // the same use not on Pro is the shared budget's
  await recordUsage(io, { ref: 'c2:1', payer: { type: 'user', id: 'p2' }, actorId: 'p2', kind: 'voice', route: 'free', feature: 'call', units: 10, costMicros: 5, now: NOW, settings })
  assert.equal(rows.get('global:2026-11').freeMicros, 5)
})

test('without Pro through the real meter: refused before anything is sent, and a balance pays instead', async () => {
  const w = await meterWorld({ person: { included: false, pro: false }, settings: structuredClone(switched) })
  let sent = false
  await assert.rejects(runAIAction({ feature: 'workshop' }, async () => { sent = true }), error => error.error === 'pro')
  assert.equal(sent, false)
  assert.equal(w.spent().drafts, 0)
  const paid = await meterWorld({ person: { included: false, pro: false }, wallet: { balanceMicros: 5_000_000, refundableMicros: 5_000_000 }, settings: structuredClone(switched) })
  assert.equal(await runAIAction({ feature: 'workshop' }, async () => 'drafted'), 'drafted')
  assert.equal(paid.spent().drafts, 0, 'a balance-paid draft never uses the included count')
  installMeter(null)
})

test('the Credits page: no amount shown without Pro after the switch; Pro shows its credits and no stage notes', () => {
  const base = { usage: {}, wallets: {}, global: { monthFreeMicros: DEFAULT_METERING.budget.monthlyMicros * 1.2, todayFreeMicros: 0 }, settings: switched, now: NOW }
  const none = allowanceSummary({ ...base, person: noPro })
  assert.deepEqual([none.included, none.pro, none.needsPro, none.aiLeftToday, none.voiceHoursLeft, none.videoHoursLeft, none.stageNote], [false, false, true, 0, 0, 0, null])
  assert.equal(none.proRequiredFrom, 'now')
  // what Pro would give is still said in plain words, so the person knows what they would buy
  assert.match(none.credits.sentence, /^Each month: about 180 AI drafts \(up to 30 a day\)/)
  const pro = allowanceSummary({ ...base, person: withPro })
  assert.deepEqual([pro.included, pro.pro, pro.needsPro, pro.aiLeftToday, pro.aiPerDay, pro.voiceHoursLeft, pro.videoHoursLeft, pro.stageNote], [true, true, false, 30, 30, 5.5, 1, null])
})

test('a call started on Pro credits is marked so the budget never pauses it, and its notice speaks of Pro', () => {
  const decision = ask({ person: withPro, kind: 'voice' })
  const call = startCall({ callId: 'c'.repeat(16), shareId: 's1', starterId: 'p1', decision, now: NOW })
  assert.equal(call.pro, true)
  assert.equal(call.metered, true)
  const freeCall = startCall({ callId: 'd'.repeat(16), shareId: 's1', starterId: 'p1', decision: { ok: true, route: 'free', kind: 'voice', payer: { type: 'user', id: 'p1' } }, now: NOW })
  assert.equal(freeCall.pro, undefined)
  assert.equal(CALL_COPY.starterNotice(10, true), 'This call uses your Pro credits: about 10 hours of four-person voice left this month.')
  assert.equal(CALL_COPY.starterNotice(10), 'This call uses your free calls: about 10 hours of four-person voice left this month.')
  // the tick at level 0 (meteor.js passes 0 for a Pro call) extends it with minutes left
  const out = tick({ call: { ...call, lastTickAt: NOW, participants: ['a', 'b'] }, presence: { count: 2 }, now: NOW + 60_000, minutesLeft: { voice: 100, video: 0 }, level: 0 })
  assert.equal(out.decision, 'extend')
})

test('guests: the sign-in words promise nothing about price', () => {
  const guest = route({ kind: 'ai', person: { id: 'g', anonymous: true }, usage: {}, global: quiet, settings: switched, now: NOW })
  assert.deepEqual([guest.code, guest.message], ['guest', 'Sign in to use AI.'])
})
