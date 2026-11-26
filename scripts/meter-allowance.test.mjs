// The personalization allowance (owner, 2026-11-26): on Slatebox Cloud a brand-new free account was
// refused the interview ("… comes with Slatebox Pro, $5 a month, or a balance"). Each signed-in
// person, never a guest, now gets a daily allowance (UTC day) of the features that get to know them,
// paid by Slatebox on its own binding with no Pro needed; past it the meter applies unchanged. A
// request an own key serves never uses it. Self-host has no meter, so nothing changes there.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { meterWorld, NOW } from './fixtures/meter-world.mjs'
import { chargeFixed, chargeProviderCall, currentAIAction, installMeter, runAIAction } from '../web/app/server/metering/context.mjs'
import { COPY, DEFAULT_METERING, OWN_KEY_COPY, dayKey, resolveMetering, route } from '../web/app/server/metering/policy.mjs'
import {
  DEFAULT_PERSONAL_ALLOWANCE, PEOPLE_PER_ADDRESS, PERSONAL_FEATURES, allowanceField, allowancePerDay, holdAllowance, releaseAllowance, resolvePersonalAllowance, usedUpWords,
  DEFAULT_GUEST_ALLOWANCE, DEFAULT_GUEST_ALLOWANCE_PER_ADDRESS, GUEST_FEATURES, guestAllowanceCheck, guestUsedUpWords, resolveGuestAllowance,
} from '../web/app/server/metering/allowance.mjs'
import { guardsPass } from '../web/app/server/metering/holds.mjs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const HOUR = 3_600_000
const USED_UP = "You've used today's free talk with Slatebox. It comes back tomorrow, or keep going with Pro or your own key."
// Slatebox Cloud: Pro is needed from now; own keys on (vault key, not turned off)
const cloud = (over = {}) => ({ ...structuredClone(DEFAULT_METERING), free: { ...DEFAULT_METERING.free, proRequiredFrom: 'now' }, ownKeys: true, ...over })
// meteor.js personOf for a brand-new free account on Cloud: no Pro, so no included amount
const fresh = { included: false, pro: false, proPastDue: false }
const withPro = { included: true, pro: true, proPastDue: false }
const dayRow = (w, at = NOW) => w.stores.counters.get(`user:u1:${dayKey(at)}`) || {}
const turnsTaken = (w, at = NOW) => dayRow(w, at)[allowanceField('interview')] || 0
let refs = 0
// one interview turn: the model answers with usage, as req.js charges it
const turn = (costMicros = 3000) => runAIAction({ feature: 'interview' }, async action => {
  await chargeProviderCall({ ref: 'audit-' + refs++, provider: 'p', model: 'm', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, costMicros })
  return action.route
})
test.afterEach(() => installMeter(null))

test('the defaults live in one place: 20 interview turns, 5 For you runs, 3 builds and 20 start page turns a day, all four paid for', () => {
  assert.deepEqual({ ...DEFAULT_PERSONAL_ALLOWANCE }, { interview: 20, 'start.interview': 20, 'personal.suggest': 5, 'personal.build': 3 })
  assert.equal(DEFAULT_METERING.personalAllowance, DEFAULT_PERSONAL_ALLOWANCE)
  assert.deepEqual(resolveMetering().personalAllowance, { interview: 20, 'start.interview': 20, 'personal.suggest': 5, 'personal.build': 3 })
  // For you joined on 2026-11-26 (owner): its ideas and building one; then the start page's use-case interview (S6), whose
  // tile builds are personal.build too (one use for a whole build)
  assert.deepEqual([...PERSONAL_FEATURES], ['interview', 'personal.suggest', 'personal.build', 'start.interview'])
  assert.equal(allowancePerDay('start.interview', resolveMetering()), 20)
  const settings = resolveMetering()
  assert.equal(allowancePerDay('interview', settings), 20)
  assert.equal(allowancePerDay('personal.suggest', settings), 5)
  assert.equal(allowancePerDay('personal.build', settings), 3)
  // an ordinary board draft is not part of it
  assert.equal(allowancePerDay('workshop', settings), 0)
  // one field per feature on the person's day, with no dots for Mongo
  assert.equal(allowanceField('personal.suggest'), 'allowance_personal_suggest')
  assert.equal(allowanceField('personal.build'), 'allowance_personal_build')
  const example = JSON.parse(read('web/app/settings.example.json'))
  assert.deepEqual(example.metering.personalAllowance, { interview: 20, 'personal.suggest': 5, 'personal.build': 3, 'start.interview': 20 })
  assert.match(example.metering['//personalAllowance'], /UTC day/)
})

test('counting: a brand-new free account gets 20 turns (the first question counts), costs nothing, then the meter decides', async () => {
  const w = await meterWorld({ person: fresh, settings: cloud() })
  for (let i = 0; i < 20; i++) assert.equal(await turn(), 'allowance', `turn ${i + 1}`)
  assert.equal(turnsTaken(w), 20)
  await assert.rejects(turn(), error => error.error === 'pro' && error.reason === USED_UP)
  assert.equal(turnsTaken(w), 20, 'a refused turn takes nothing')
  // nothing of the person's: no Pro credits, no draft, no hold left
  assert.deepEqual(w.spent(), { drafts: 0, todayMicros: 0, monthMicros: 0, heldDay: 0, heldMonth: 0 })
  assert.equal(w.global().heldMicros, 0)
})

test('the day is UTC: the last second of a UTC day and the first of the next are different days', async () => {
  let at = Date.UTC(2026, 10, 19, 23, 59, 59)
  const w = await meterWorld({ person: fresh, settings: cloud(), clock: () => at })
  for (let i = 0; i < 20; i++) await turn()
  await assert.rejects(turn(), error => error.error === 'pro')
  // 19:00 in New York on the 19th is already the 20th in UTC; a local evening is not a new day by itself
  at = Date.parse('2026-11-19T19:00:01-05:00')
  assert.equal(dayKey(at), '2026-11-20')
  assert.equal(await turn(), 'allowance')
  assert.equal(turnsTaken(w, Date.UTC(2026, 10, 19, 12)), 20)
  assert.equal(turnsTaken(w, at), 1)
})

test('race safety: two turns at the same moment cannot both take the last one; 25 at once take exactly 20', async () => {
  const w = await meterWorld({ person: fresh, settings: cloud() })
  for (let i = 0; i < 19; i++) await turn()
  const two = await Promise.allSettled([turn(), turn()])
  assert.deepEqual(two.map(r => r.status).sort(), ['fulfilled', 'rejected'])
  assert.equal(two.find(r => r.status === 'rejected').reason.reason, USED_UP, 'the one that lost is told the free talk is used up')
  assert.equal(turnsTaken(w), 20)

  const many = await meterWorld({ person: fresh, settings: cloud() })
  const all = await Promise.allSettled(Array.from({ length: 25 }, () => turn()))
  assert.equal(all.filter(r => r.status === 'fulfilled').length, 20)
  assert.equal(turnsTaken(many), 20)

  // the hold itself: one conditional update on the person's day, the shared budget's ceiling on the month
  const io = { rows: new Map(),
    async get(_, key) { await new Promise(r => setImmediate(r)); return this.rows.get(key) ? { ...this.rows.get(key) } : null },
    async incIf(_, key, inc, guards) { await new Promise(r => setImmediate(r)); const row = this.rows.get(key) || {}; if (!guardsPass(row, guards)) return false; for (const [k, v] of Object.entries(inc)) row[k] = (row[k] || 0) + v; this.rows.set(key, row); return true },
    async add(_, key, fields) { const row = this.rows.get(key) || {}; for (const [k, v] of Object.entries(fields)) row[k] = (row[k] || 0) + v; this.rows.set(key, row) } }
  const args = { feature: 'interview', perDay: 1, keys: { day: 'd', global: 'g' }, ceilingMicros: 50_000, estimateMicros: 2000, globalCap: 1_100_000_000, now: NOW }
  const holds = await Promise.all([holdAllowance(io, args), holdAllowance(io, args), holdAllowance(io, args)])
  assert.deepEqual(holds.map(h => h.ok).sort(), [false, false, true])
  assert.deepEqual(holds.filter(h => !h.ok).map(h => h.code), ['used-up', 'used-up'])
  assert.equal(io.rows.get('d').allowance_interview, 1)
  assert.equal(io.rows.get('g').heldMicros, 50_000)
  // the shared budget at its ceiling: no allowance, and no use taken
  const full = await holdAllowance(io, { ...args, perDay: 5, keys: { day: 'd2', global: 'g' }, globalCap: 50_000 })
  assert.deepEqual([full.ok, full.code, io.rows.get('d2')?.allowance_interview ?? 0], [false, 'paused', 0])
})

test('refund: a turn whose model call fails before any usage gives its use back; one that spent keeps it', async () => {
  const w = await meterWorld({ person: fresh, settings: cloud() })
  await assert.rejects(runAIAction({ feature: 'interview' }, async () => { throw new Error('provider down') }), /provider down/)
  assert.equal(turnsTaken(w), 0)
  assert.equal(w.global().heldMicros, 0)
  // usage came back, then the answer could not be read: the use stays taken, and what it cost is the shared budget's
  await assert.rejects(runAIAction({ feature: 'interview' }, async () => {
    await chargeProviderCall({ ref: 'spent-then-failed', provider: 'p', model: 'm', usage: { totalTokens: 5 }, costMicros: 1200 })
    throw new Error('unreadable')
  }), /unreadable/)
  assert.equal(turnsTaken(w), 1)
  assert.equal(w.global().monthFreeMicros, 1200)
  assert.equal(w.global().heldMicros, 0)
})

test('an own key never uses the allowance: the request is byok and nothing is counted', async () => {
  const w = await meterWorld({ person: fresh, settings: cloud(), keys: { ai: true } })
  assert.equal(await turn(), 'byok')
  assert.equal(turnsTaken(w), 0)
  assert.equal(w.paid(), 0)
  // a team's own key too
  const r = route({ kind: 'ai', feature: 'interview', person: { id: 'p1', anonymous: false, emailVerified: true, ...fresh }, teamId: 't1', keys: { team: { ai: true } }, usage: {}, wallets: {}, global: {}, settings: cloud(), now: NOW })
  assert.equal(r.route, 'byok')
  // own keys off here: a saved key pays nothing, and the allowance serves as for anyone
  const off = route({ kind: 'ai', feature: 'interview', person: { id: 'p1', anonymous: false, emailVerified: true, ...fresh }, keys: { personal: { ai: true } }, usage: {}, wallets: {}, global: {}, settings: cloud({ ownKeys: false }), now: NOW })
  assert.equal(off.route, 'allowance')
})

test('guests get none; a person whose free use was stopped, or a shared budget at its pause, gets none either', async () => {
  const ask = (person, over = {}) => route({ kind: 'ai', feature: 'interview', person, keys: {}, usage: {}, wallets: {}, global: {}, settings: cloud(), now: NOW, ...over })
  const guest = ask({ id: 'g1', anonymous: true })
  assert.deepEqual([guest.ok, guest.code, guest.message], [false, 'guest', COPY.guestAI])
  assert.equal(ask(null).code, 'guest')
  const w = await meterWorld({ person: { anonymous: true }, settings: cloud() })
  await assert.rejects(turn(), error => error.error === 'guest')
  assert.equal(turnsTaken(w), 0)
  const stopped = ask({ id: 'p1', anonymous: false, emailVerified: true, ...fresh, freeStopped: true })
  assert.equal(stopped.code, 'pro')
  assert.notEqual(stopped.message, USED_UP)
  const paused = ask({ id: 'p1', anonymous: false, emailVerified: true, ...fresh }, { global: { monthFreeMicros: 1_100_000_000 } })
  assert.equal(paused.ok, false)
  // other features and other kinds are metered as before
  assert.equal(ask({ id: 'p1', anonymous: false, emailVerified: true, ...fresh }, { feature: 'workshop' }).code, 'pro')
  assert.equal(ask({ id: 'p1', anonymous: false, emailVerified: true, ...fresh }, { kind: 'imageSearch' }).code, 'pro-images')
})

test('past the allowance the meter applies unchanged: Pro credits, a balance, or the words that the free talk is used up', async () => {
  const usedUp = { allowanceToday: { interview: 20 } }
  const ask = (person, over = {}) => route({ kind: 'ai', feature: 'interview', person: { id: 'p1', anonymous: false, emailVerified: true, ...person }, keys: {}, usage: usedUp, wallets: {}, global: {}, estimateMicros: 2000, settings: cloud(), now: NOW, ...over })
  // with Pro: its credits
  assert.deepEqual([ask(withPro).route, ask(withPro).pro], ['free', true])
  // a balance
  assert.equal(ask(fresh, { wallets: { personal: { balanceMicros: 1_000_000 } } }).route, 'balance')
  // neither: refused as Pro is, with the allowance's own words, and the same way on
  const none = ask(fresh)
  assert.deepEqual([none.ok, none.code, none.message, none.allowance], [false, 'pro', USED_UP, 'used-up'])
  const low = ask(fresh, { wallets: { personal: { balanceMicros: 100 } } })
  assert.equal(low.message, `${USED_UP} ${COPY.balanceTooLow}`)
  // own keys off here: the words do not offer one
  assert.equal(ask(fresh, { settings: cloud({ ownKeys: false }) }).message, "You've used today's free talk with Slatebox. It comes back tomorrow, or keep going with Pro.")
  assert.equal(usedUpWords('interview', { ownKeys: true }), USED_UP)
  // within it, Pro members are served by the allowance first, so their credits are kept
  assert.equal(ask(withPro, { usage: {} }).route, 'allowance')

  // in the running meter: turn 21 on a balance is charged as any request, the allowance untouched
  const w = await meterWorld({ person: fresh, settings: cloud(), wallet: { balanceMicros: 1_000_000, refundableMicros: 1_000_000 } })
  for (let i = 0; i < 20; i++) await turn()
  assert.equal(await turn(3000), 'balance')
  assert.equal(w.wallet().balanceMicros, 1_000_000 - 3150)
})

test('settings: the operator overrides the defaults (checked at start), a stored value wins, 0 turns it off', () => {
  assert.deepEqual(resolveMetering({ deploy: { personalAllowance: { interview: 3 } } }).personalAllowance, { interview: 3, 'start.interview': 20, 'personal.suggest': 5, 'personal.build': 3 })
  assert.deepEqual(resolveMetering({ deploy: { personalAllowance: { interview: 3 } }, stored: { personalAllowance: { interview: 7 } } }).personalAllowance.interview, 7)
  // a settings file's notes are not features
  assert.deepEqual(resolvePersonalAllowance({ deploy: { '//': 'note', interview: 10 } }), { interview: 10, 'start.interview': 20, 'personal.suggest': 5, 'personal.build': 3 })
  for (const bad of [{ interview: -1 }, { interview: 2.5 }, { interview: '20' }, { workshop: 5 }, [], 'twenty']) {
    assert.throws(() => resolveMetering({ deploy: { personalAllowance: bad } }), /personalAllowance/, JSON.stringify(bad))
  }
  // a wrong stored value is left out, never a stop for every request
  assert.equal(resolveMetering({ stored: { personalAllowance: { interview: 'lots' } } }).personalAllowance.interview, 20)
  // 3 a day: the fourth is the meter's
  const three = cloud({ personalAllowance: { interview: 3, 'personal.suggest': 5 } })
  const ask = (n, settings = three) => route({ kind: 'ai', feature: 'interview', person: { id: 'p1', anonymous: false, emailVerified: true, ...fresh }, keys: {}, usage: { allowanceToday: { interview: n } }, wallets: {}, global: {}, settings, now: NOW })
  assert.equal(ask(2).route, 'allowance')
  assert.deepEqual([ask(3).code, ask(3).message], ['pro', USED_UP])
  // 0: off, so the meter's own words, with nothing said about a free talk
  const off = ask(0, cloud({ personalAllowance: { interview: 0, 'personal.suggest': 5 } }))
  assert.deepEqual([off.code, off.message], ['pro', OWN_KEY_COPY.getPro])
})

test('the meter records allowance use, charges nothing and shows it to operators', async () => {
  const w = await meterWorld({ person: fresh, settings: cloud(), wallet: { balanceMicros: 500_000, refundableMicros: 500_000 } })
  assert.equal(await turn(4000), 'allowance')
  const [event] = [...w.events.values()]
  assert.deepEqual({ route: event.route, feature: event.feature, costMicros: event.costMicros, chargeMicros: event.chargeMicros, payerId: event.payerId },
    { route: 'allowance', feature: 'interview', costMicros: 4000, chargeMicros: 0, payerId: 'u1' })
  // nothing from the balance, nothing from Pro credits
  assert.equal(w.wallet().balanceMicros, 500_000)
  assert.equal(w.spent().monthMicros, 0)
  // Slatebox's cost: in the shared budget, and on its own keys by feature
  const month = w.stores.counters.get('global:2026-11')
  assert.deepEqual([month.freeMicros, month.allowanceMicros, month['allowanceByFeature.interview'], month.heldMicros], [4000, 4000, 4000, 0])
  // and in the shared budget's line by kind, so Admin → Budget and Pro's lines add up to the month
  assert.equal(month['freeByKind.ai'], 4000)
  assert.equal(w.stores.counters.get(`global:${dayKey(NOW)}`).allowanceMicros, 4000)
  assert.equal(dayRow(w).allowanceMicros, 4000)
  assert.equal(w.paid(), 4000)
  // a fixed-price use inside one is metered on its own (the allowance pays for the agent's turns only)
  const image = await runAIAction({ feature: 'interview' }, () => chargeFixed({ ref: 'img-1', kind: 'imageSearch', costMicros: 5000 }))
  assert.deepEqual(image, { charged: true, route: 'balance' })
  assert.equal(w.events.get('img-1').route, 'balance')
  assert.equal(w.wallet().balanceMicros, 500_000 - 5250)
  // the per-request ceiling still holds
  const big = await runAIAction({ feature: 'interview' }, async action => action.ceilingMicros)
  assert.ok(big <= 50_000)
})

test('the Mongo glue reads and passes the allowance; self-host has no meter, so nothing changes there', async () => {
  const meteor = read('web/app/server/metering/meteor.js')
  assert.match(meteor, /allowanceToday: allowanceUsage\(day\)/)
  assert.match(meteor, /allowanceTaken: opts\.allowanceTaken \?\? null/)
  assert.match(meteor, /allowanceSpentMicros: totals\.allowanceMicros \|\| 0/)
  assert.match(meteor, /spentOn === 'free' \|\| spentOn === 'allowance'/)
  // the interview stays metered under its feature, with its rate limits
  assert.match(read('web/app/server/methods/interview.js'), /run: \(userId, fn\) => runAIAction\(\{ feature: 'interview', userId \}, fn\)/)
  assert.match(read('web/app/server/metering/limits.mjs'), /'interview\.start', 'interview\.turn'/)
  // no meter: the request runs as it is, and nothing is counted
  installMeter(null)
  assert.equal(await runAIAction({ feature: 'interview' }, async action => action), null)
  assert.match(read('web/app/imports/ui/pages/admin/FreeBudget.jsx'), /data-admin-allowance=""/)
})

// Review, 2026-11-26: throwaway accounts made from one place must not each get the allowance.
test('one network address shares the allowance: 5 people\'s worth a day, however many accounts it makes', async () => {
  assert.equal(PEOPLE_PER_ADDRESS, 5)
  const rows = new Map()
  const io = {
    async get(_, key) { return rows.get(key) ? { ...rows.get(key) } : null },
    async incIf(_, key, inc, guards) { const row = rows.get(key) || {}; if (!guardsPass(row, guards)) return false; for (const [k, v] of Object.entries(inc)) row[k] = (row[k] || 0) + v; rows.set(key, row); return true },
    async add(_, key, fields) { const row = rows.get(key) || {}; for (const [k, v] of Object.entries(fields)) row[k] = (row[k] || 0) + v; rows.set(key, row) },
  }
  const hold = person => holdAllowance(io, { feature: 'interview', perDay: 20, keys: { day: `user:${person}:d`, global: 'g', address: 'address:203.0.113.7:d' }, ceilingMicros: 1000, estimateMicros: 100, globalCap: 1e12, now: NOW })
  const taken = []
  for (let person = 0; person < 6; person++) for (let i = 0; i < 20; i++) taken.push(await hold('p' + person))
  assert.equal(taken.filter(h => h.ok).length, 100)
  assert.deepEqual([...new Set(taken.slice(100).map(h => h.code))], ['address'])
  assert.equal(rows.get('address:203.0.113.7:d').allowance_interview, 100)
  assert.equal(rows.get('user:p5:d')?.allowance_interview ?? 0, 0, 'a refused hold takes nothing from the person')
  // a failed turn gives the address's use back too
  await releaseAllowance(io, taken[0], { ok: false }, NOW)
  assert.equal(rows.get('address:203.0.113.7:d').allowance_interview, 99)
  // the person refused for the address is told what the meter says, never that their own free talk is used up
  const refused = route({ kind: 'ai', feature: 'interview', person: { id: 'p5', anonymous: false, emailVerified: false, ...fresh }, keys: {}, usage: {}, wallets: {}, global: {}, settings: cloud(), now: NOW, allowanceTaken: 'address' })
  assert.deepEqual([refused.code, refused.message, refused.allowance], ['pro', OWN_KEY_COPY.getPro, undefined])

  // the running meter counts the caller's address; an address that stands for many callers is not counted
  const w = await meterWorld({ person: fresh, settings: cloud(), address: '203.0.113.7' })
  assert.equal(await turn(), 'allowance')
  assert.equal(w.stores.counters.get(`address:203.0.113.7:${dayKey(NOW)}`).allowance_interview, 1)
  const edge = await meterWorld({ person: fresh, settings: cloud(), address: '104.16.0.1' })
  assert.equal(await turn(), 'allowance')
  assert.equal([...edge.stores.counters.keys()].some(key => key.startsWith('address:')), false)
})

test('a tight shared budget shrinks the allowance as it shrinks free drafts; the pause stops it', () => {
  const settings = cloud()
  const { budget, free } = settings
  assert.equal(allowancePerDay('interview', settings, 0), 20)
  const reduced = Math.max(1, Math.floor(20 * budget.reducedAiActionsPerDay / free.aiActionsPerDay))
  assert.ok(reduced < 20)
  assert.equal(allowancePerDay('interview', settings, budget.smallerAiAt), reduced)
  const atStage = { monthFreeMicros: budget.monthlyMicros * budget.smallerAiAt / 100 }
  const ask = n => route({ kind: 'ai', feature: 'interview', person: { id: 'p1', anonymous: false, emailVerified: true, ...fresh }, keys: {}, usage: { allowanceToday: { interview: n } }, wallets: {}, global: atStage, settings, now: NOW })
  assert.deepEqual([ask(reduced - 1).route, ask(reduced - 1).allowance.perDay], ['allowance', reduced])
  assert.deepEqual([ask(reduced).code, ask(reduced).message], ['pro', USED_UP])
})

// req.js on chosen.own (the person's own connection, never recorded outside an own-key request)
const ownConnection = () => { if (currentAIAction()?.route === 'allowance' && currentAIAction().hold) currentAIAction().hold.ownServed = true }

test('a turn served on the person\'s own connection gives its use back; one that Slatebox paid for keeps it', async () => {
  const w = await meterWorld({ person: fresh, settings: cloud() })
  // req.js: chosen.own, so the call is the person's and is not recorded
  assert.equal(await runAIAction({ feature: 'interview' }, async action => { ownConnection(); return action.route }), 'allowance')
  assert.equal(turnsTaken(w), 0)
  assert.equal(w.global().heldMicros, 0)
  // one attempt on the own connection, one on Slatebox's binding: Slatebox paid, so the use stays taken
  await runAIAction({ feature: 'interview' }, async () => {
    ownConnection()
    await chargeProviderCall({ ref: 'mixed', provider: 'p', model: 'm', usage: { totalTokens: 5 }, costMicros: 900 })
  })
  assert.equal(turnsTaken(w), 1)
  // outside an allowance turn it changes nothing
  await meterWorld({ person: withPro, settings: cloud() })
  assert.equal(await runAIAction({ feature: 'workshop' }, async action => { ownConnection(); return action.hold?.ownServed }), undefined)
  assert.match(read('web/app/server/methods/ai/req.js'), /aiOpts\.unpaid = Boolean\(chosen\?\.own\)\n(\s*\/\/[^\n]*\n)+\s*if \(aiOpts\.unpaid && currentAIAction\(\)\?\.route === 'allowance' && currentAIAction\(\)\.hold\) currentAIAction\(\)\.hold\.ownServed = true/)
})

test('operators find allowance spenders: the top free spenders include the allowance route', () => {
  const meteor = read('web/app/server/metering/meteor.js')
  assert.match(meteor, /\$match: \{ month, route: \{ \$in: \['free', 'allowance'\] \} \}/)
  assert.doesNotMatch(meteor, /\$match: \{ month, route: 'free' \}/)
})

// For you (owner, 2026-11-26): its ideas (personal.suggest, 5 runs a day) and building one (personal.build, 3 a day)
// are part of the allowance. A build is a board draft metered under its own key, so ordinary board drafts ('workshop')
// stay on the meter as before.
const IDEAS_USED_UP = "You've used today's free ideas from Slatebox. They come back tomorrow, or keep going with Pro or your own key."
const BUILDS_USED_UP = "You've used today's free builds of your ideas. They come back tomorrow, or keep going with Pro or your own key."
const forYouRun = (feature, costMicros = 3000) => runAIAction({ feature }, async action => {
  await chargeProviderCall({ ref: 'for-you-' + refs++, provider: 'p', model: 'm', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, costMicros })
  return action.route
})

for (const [feature, perDay, usedUp] of [['personal.suggest', 5, IDEAS_USED_UP], ['personal.build', 3, BUILDS_USED_UP]]) {
  test(`${feature}: ${perDay} a day are counted and cost the person nothing; used up, the meter decides with its own words`, async () => {
    const w = await meterWorld({ person: fresh, settings: cloud() })
    for (let i = 0; i < perDay; i++) assert.equal(await forYouRun(feature), 'allowance', `run ${i + 1}`)
    assert.equal(dayRow(w)[allowanceField(feature)], perDay)
    // the other features' uses are their own
    assert.equal(turnsTaken(w), 0)
    // used up, no Pro and no balance: refused as Pro is, in the allowance's words for this feature
    await assert.rejects(forYouRun(feature), error => error.error === 'pro' && error.reason === usedUp)
    assert.equal(dayRow(w)[allowanceField(feature)], perDay, 'a refused run takes nothing')
    assert.deepEqual(w.spent(), { drafts: 0, todayMicros: 0, monthMicros: 0, heldDay: 0, heldMonth: 0 })
    assert.equal(w.stores.counters.get('global:2026-11')['allowanceByFeature.' + allowanceField(feature).slice('allowance_'.length)], perDay * 3000)
    // the words without own keys, and the route's own answer
    assert.equal(usedUpWords(feature, { ownKeys: true }), usedUp)
    assert.equal(usedUpWords(feature, { ownKeys: false }), usedUp.replace(' or your own key.', '.'))
    const ask = (person, over = {}) => route({ kind: 'ai', feature, person: { id: 'p1', anonymous: false, emailVerified: true, ...person }, keys: {}, usage: { allowanceToday: { [feature]: perDay } }, wallets: {}, global: {}, estimateMicros: 3000, settings: cloud(), now: NOW, ...over })
    assert.deepEqual([ask(fresh).code, ask(fresh).message, ask(fresh).allowance], ['pro', usedUp, 'used-up'])
    // past it: Pro credits, or a balance, as for any request
    assert.equal(ask(withPro).route, 'free')
    assert.equal(ask(fresh, { wallets: { personal: { balanceMicros: 1_000_000 } } }).route, 'balance')
    const paying = await meterWorld({ person: fresh, settings: cloud(), wallet: { balanceMicros: 1_000_000, refundableMicros: 1_000_000 } })
    for (let i = 0; i < perDay; i++) await forYouRun(feature)
    assert.equal(await forYouRun(feature), 'balance')
    assert.equal(dayRow(paying)[allowanceField(feature)], perDay)
  })

  test(`${feature}: an own key never uses the allowance, nor a run served on the person's own connection`, async () => {
    const w = await meterWorld({ person: fresh, settings: cloud(), keys: { ai: true } })
    assert.equal(await forYouRun(feature), 'byok')
    assert.equal(dayRow(w)[allowanceField(feature)] || 0, 0)
    assert.equal(w.paid(), 0)
    const own = await meterWorld({ person: fresh, settings: cloud() })
    assert.equal(await runAIAction({ feature }, async action => { ownConnection(); return action.route }), 'allowance')
    assert.equal(dayRow(own)[allowanceField(feature)] || 0, 0)
  })
}

test('a For you build is metered under personal.build; every other board draft stays on workshop, outside the allowance', async () => {
  const workshops = read('web/app/server/methods/workshops.js')
  const forYou = workshops.slice(workshops.indexOf('export function draftForYou'))
  assert.match(forYou, /^export function draftForYou\(\{ userId, brief, format, personal \}\) \{\n\s*return runAIAction\(\{ feature: 'personal\.build', userId \}/)
  assert.match(workshops, /'workshops\.draft'\(brief, format = 'lanes', currentDraft\) \{\n\s*return runAIAction\(\{ feature: 'workshop' \}/)
  assert.equal((workshops.match(/feature: 'personal\.build'/g) || []).length, 1, 'only draftForYou uses it')
  // the build keeps the draft's gates: the surface switch, the one-draft-a-minute lock and the quality gate
  const draft = workshops.slice(workshops.indexOf('async function draftWorkshop'), workshops.indexOf('export function draftForYou'))
  assert.match(draft, /surfaceOffFor\(\{ feature: 'workshop', userId: user\._id \}\)/)
  assert.match(draft, /workshopDraftAvailableAt: now \+ 60000/)
  assert.match(draft, /componentDraftCheck\(toolCall/)
  assert.match(draft, /gridDraftCheck\(toolCall/)
  // and its model request is board drafting's (the workshop.draft surface)
  assert.match(draft, /req\(\{\n\s*feature: 'workshop',/)
  // an ordinary board draft past nothing: the meter, never the allowance
  const w = await meterWorld({ person: fresh, settings: cloud() })
  await assert.rejects(forYouRun('workshop'), error => error.error === 'pro' && error.reason === OWN_KEY_COPY.getPro)
  assert.deepEqual(Object.keys(dayRow(w)).filter(key => key.startsWith('allowance_')), [])
  // the For you suggestion stays metered under its own key
  assert.match(read('web/app/server/personal/meteor.js'), /const FEATURE = 'personal\.suggest'[\s\S]*run: refusing\(\(userId, fn\) => runAIAction\(\{ feature: FEATURE, userId \}, fn\)\)/)
})

// ---------- the guest allowance (S6, owner 2026-11-26): the start page's use-case interview and its build ----------
// /new is the page guests land on, so a guest gets a small daily allowance there, per guest and per network address: about
// 12 turns of the talk and 1 build of its tile. Nothing else is open to a guest through it; past it, save the account.
const GUEST_TURN_USED_UP = "You've used today's free talk with Slatebox. Save your account to keep going, or come back tomorrow."
const startTurn = (feature = 'start.interview', costMicros = 3000) => runAIAction({ feature }, async action => {
  await chargeProviderCall({ ref: 'start-' + refs++, provider: 'p', model: 'm', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, costMicros })
  return action.route
})
const guest = { id: 'g1', anonymous: true }

test('the guest allowance: its defaults and its words live in one place, for the start page\'s talk and its build only', () => {
  assert.deepEqual([...GUEST_FEATURES], ['start.interview', 'start.build'])
  assert.deepEqual({ ...DEFAULT_GUEST_ALLOWANCE }, { 'start.interview': 12, 'start.build': 1 })
  assert.deepEqual({ ...DEFAULT_GUEST_ALLOWANCE_PER_ADDRESS }, { 'start.interview': 36, 'start.build': 3 })
  assert.equal(DEFAULT_METERING.guestAllowance, DEFAULT_GUEST_ALLOWANCE)
  assert.equal(DEFAULT_METERING.guestAllowancePerAddress, DEFAULT_GUEST_ALLOWANCE_PER_ADDRESS)
  assert.deepEqual(resolveMetering().guestAllowance, { 'start.interview': 12, 'start.build': 1 })
  assert.equal(guestUsedUpWords('start.interview'), GUEST_TURN_USED_UP)
  assert.match(guestUsedUpWords('start.build'), /today's free build\. Save your account/)
  const example = JSON.parse(read('web/app/settings.example.json'))
  assert.deepEqual(example.metering.guestAllowance, { 'start.interview': 12, 'start.build': 1 })
  assert.deepEqual(example.metering.guestAllowancePerAddress, { 'start.interview': 36, 'start.build': 3 })
  assert.match(example.metering['//guestAllowance'], /per network address|network address/)
  // the guest allowance names its own count per address, never the signed-in one's
  assert.match(read('web/app/server/metering/meter-core.mjs'), /address: `address:\$\{guest \? 'guest:' : ''\}\$\{place\}:\$\{dayKey\(at\)\}`/)
})

test('a guest: 12 turns of the talk and 1 build a day from the guest allowance; then save the account; nothing else is open to them', () => {
  const ask = (over = {}) => route({ kind: 'ai', feature: 'start.interview', person: guest, keys: {}, usage: {}, wallets: {}, global: {}, settings: cloud(), now: NOW, ...over })
  const ok = ask()
  assert.deepEqual([ok.ok, ok.route, ok.allowance], [true, 'allowance', { feature: 'start.interview', perDay: 12, perAddress: 36, guest: true }])
  assert.equal(ask({ usage: { allowanceToday: { 'start.interview': 11 } } }).route, 'allowance')
  const done = ask({ usage: { allowanceToday: { 'start.interview': 12 } } })
  assert.deepEqual([done.ok, done.code, done.message], [false, 'guest', GUEST_TURN_USED_UP])
  const build = ask({ feature: 'start.build' })
  assert.deepEqual([build.route, build.allowance.perDay, build.allowance.perAddress], ['allowance', 1, 3])
  assert.equal(ask({ feature: 'start.build', usage: { allowanceToday: { 'start.build': 1 } } }).code, 'guest')
  // nothing else: the interview in About you, For you, a board draft, a For you build stay an account's
  for (const feature of ['interview', 'personal.suggest', 'personal.build', 'workshop', 'welcome']) {
    const refused = ask({ feature })
    assert.deepEqual([refused.ok, refused.code, refused.message], [false, 'guest', COPY.guestAI], feature)
  }
  // a stopped guest, a shared budget at its pause, a taken hold, or the allowance turned off: none
  assert.equal(ask({ person: { ...guest, freeStopped: true } }).code, 'guest')
  assert.equal(ask({ global: { monthFreeMicros: 1_100_000_000 } }).code, 'guest')
  assert.equal(ask({ allowanceTaken: 'address' }).message, GUEST_TURN_USED_UP)
  assert.equal(ask({ settings: cloud({ guestAllowance: { 'start.interview': 0, 'start.build': 1 } }) }).code, 'guest')
  assert.equal(guestAllowanceCheck({ kind: 'ai', feature: 'start.interview', person: { id: 'p1', anonymous: false }, settings: cloud() }), null, 'a signed-in person is the personalization allowance\'s')
  // a signed-in person's start page talk is the personalization allowance (20 a day); their tile build is personal.build
  const person = route({ kind: 'ai', feature: 'start.interview', person: { id: 'p1', anonymous: false, emailVerified: true, ...fresh }, keys: {}, usage: {}, wallets: {}, global: {}, settings: cloud(), now: NOW })
  assert.deepEqual([person.route, person.allowance], ['allowance', { feature: 'start.interview', perDay: 20 }])
  const turnedOff = route({ kind: 'ai', feature: 'start.interview', person: { id: 'p1', anonymous: false, emailVerified: true, ...fresh }, keys: {}, usage: { allowanceToday: { 'start.interview': 20 } }, wallets: {}, global: {}, settings: cloud(), now: NOW })
  assert.match(turnedOff.message, /today's free talks on the start page/)
})

test('in the running meter: a guest\'s 12 turns cost them nothing and count on their day and their address\'s guest count; the 13th says save the account', async () => {
  const w = await meterWorld({ person: { anonymous: true }, settings: cloud(), address: '203.0.113.7' })
  for (let i = 0; i < 12; i++) assert.equal(await startTurn(), 'allowance', `turn ${i + 1}`)
  await assert.rejects(startTurn(), error => error.error === 'guest' && error.reason === GUEST_TURN_USED_UP)
  assert.equal(dayRow(w)[allowanceField('start.interview')], 12)
  assert.equal(w.stores.counters.get(`address:guest:203.0.113.7:${dayKey(NOW)}`)[allowanceField('start.interview')], 12)
  assert.equal(w.stores.counters.get(`address:203.0.113.7:${dayKey(NOW)}`), undefined, 'never the signed-in people\'s count for that address')
  // one build, then none
  assert.equal(await startTurn('start.build', 9000), 'allowance')
  await assert.rejects(startTurn('start.build'), error => error.error === 'guest' && /free build/.test(error.reason))
  // Slatebox's cost, in the shared budget, nothing of the guest's
  assert.equal(w.global().monthFreeMicros, 12 * 3000 + 9000)
  assert.deepEqual(w.spent(), { drafts: 0, todayMicros: 0, monthMicros: 0, heldDay: 0, heldMonth: 0 })
  // a signed-in person's start page turn counts on the signed-in count for the address, never the guests'
  const p = await meterWorld({ person: fresh, settings: cloud(), address: '203.0.113.8' })
  assert.equal(await startTurn(), 'allowance')
  assert.equal(p.stores.counters.get(`address:203.0.113.8:${dayKey(NOW)}`)[allowanceField('start.interview')], 1)
  assert.equal(p.stores.counters.get(`address:guest:203.0.113.8:${dayKey(NOW)}`), undefined)
})

test('one network address shares the guest allowance: 36 turns and 3 builds a day however many guest accounts it makes', async () => {
  const rows = new Map()
  const io = {
    async get(_, key) { await new Promise(r => setImmediate(r)); return rows.get(key) ? { ...rows.get(key) } : null },
    async incIf(_, key, inc, guards) { await new Promise(r => setImmediate(r)); const row = rows.get(key) || {}; if (!guardsPass(row, guards)) return false; for (const [k, v] of Object.entries(inc)) row[k] = (row[k] || 0) + v; rows.set(key, row); return true },
    async add(_, key, fields) { const row = rows.get(key) || {}; for (const [k, v] of Object.entries(fields)) row[k] = (row[k] || 0) + v; rows.set(key, row) },
  }
  const hold = (who, feature = 'start.interview', perDay = 12, perAddress = 36) => holdAllowance(io, { feature, perDay, perAddress, keys: { day: `user:${who}:d`, global: 'g', address: 'address:guest:203.0.113.7:d' }, ceilingMicros: 1000, estimateMicros: 100, globalCap: 1e12, now: NOW })
  // five guests from one place, 12 turns each asked for: 36 served, the rest refused for the address
  const taken = []
  for (const who of ['g1', 'g2', 'g3', 'g4', 'g5']) for (let i = 0; i < 12; i++) taken.push(await hold(who))
  assert.equal(taken.filter(h => h.ok).length, 36)
  assert.deepEqual([...new Set(taken.slice(36).map(h => h.code))], ['address'])
  assert.equal(rows.get('address:guest:203.0.113.7:d').allowance_start_interview, 36)
  assert.equal(rows.get('user:g4:d')?.allowance_start_interview ?? 0, 0, 'the fourth guest got none: the address had used its share')
  // builds: 3 for the address, 1 per guest
  const builds = []
  for (const who of ['g1', 'g1', 'g2', 'g3', 'g4']) builds.push(await hold(who, 'start.build', 1, 3))
  assert.deepEqual(builds.map(h => h.ok || h.code), [true, 'used-up', true, true, 'address'])
  // the per-person rule still holds alone: a guest is never given past 12, whatever the address has left
  const solo = []
  for (let i = 0; i < 13; i++) solo.push(await holdAllowance(io, { feature: 'start.interview', perDay: 12, perAddress: 36, keys: { day: 'user:solo:d', global: 'g', address: 'address:guest:198.51.100.1:d' }, ceilingMicros: 1000, estimateMicros: 100, globalCap: 1e12, now: NOW }))
  assert.deepEqual([solo.filter(h => h.ok).length, solo.at(-1).code], [12, 'used-up'])
})

test('guest allowance settings: the operator sets them (checked at start), an administrator\'s stored value wins, 0 turns one off', () => {
  const resolved = resolveMetering({ deploy: { guestAllowance: { 'start.interview': 5 }, guestAllowancePerAddress: { 'start.build': 2 } } })
  assert.deepEqual(resolved.guestAllowance, { 'start.interview': 5, 'start.build': 1 })
  assert.deepEqual(resolved.guestAllowancePerAddress, { 'start.interview': 36, 'start.build': 2 })
  assert.equal(resolveMetering({ deploy: { guestAllowance: { 'start.interview': 5 } }, stored: { guestAllowance: { 'start.interview': 8 } } }).guestAllowance['start.interview'], 8)
  assert.deepEqual(resolveGuestAllowance({ deploy: { '//': 'note', 'start.build': 0 } }).guestAllowance, { 'start.interview': 12, 'start.build': 0 })
  for (const bad of [{ 'start.interview': -1 }, { 'start.interview': 1.5 }, { interview: 3 }, { 'personal.build': 1 }, [], 'twelve']) {
    assert.throws(() => resolveMetering({ deploy: { guestAllowance: bad } }), /guestAllowance/, JSON.stringify(bad))
    assert.throws(() => resolveMetering({ deploy: { guestAllowancePerAddress: bad } }), /guestAllowancePerAddress/, JSON.stringify(bad))
  }
  // a wrong stored value is left out
  assert.equal(resolveMetering({ stored: { guestAllowance: { 'start.interview': 'lots' } } }).guestAllowance['start.interview'], 12)
  // the admin page names both allowances
  assert.match(read('web/app/imports/ui/pages/admin/FreeBudget.jsx'), /data\.guestAllowance\?\.\['start\.interview'\]/)
})
