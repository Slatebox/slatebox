// Slatebox Business delivers what it sells: a team with an active Business membership shares one AI
// and call pool, Pro's monthly amount for every member it pays for (business/catalog.mjs, terms A3),
// drawn on through the team's month counter while each person's day caps still hold, and never
// paused by the shared free budget. Without Business (or once it ends) the member is back on the
// Pro rule. Inviting outside agents is free for everyone, so Business does not sell it (owner, 2026-11-26).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COPY, DEFAULT_METERING, allowanceSummary, monthKey, dayKey, route } from '../web/app/server/metering/policy.mjs'
import { creditsForPool, inPool, poolMonthKey, teamPool } from '../web/app/server/metering/pool.mjs'
import { guardsPass, holdFree, releaseHold } from '../web/app/server/metering/holds.mjs'
import { recordUsage } from '../web/app/server/metering/record.mjs'
import { CALL_LIMITS, startCall, tick } from '../web/app/server/metering/calls.mjs'

const NOW = Date.UTC(2026, 10, 19, 12)
const DAY = 86_400_000
const switched = { ...DEFAULT_METERING, free: { ...DEFAULT_METERING.free, proRequiredFrom: 'now' } }
const org = (business, _id = 't1') => ({ _id, business })
const member = (extra = {}) => ({ _id: 'u1', orgId: 't1', emails: [{ address: 'a@example.com', verified: true }], ...extra })
const noPro = { id: 'u1', anonymous: false, emailVerified: true, included: false, pro: false, proPastDue: false }

test('teamPool: only an active Business membership of the person\'s own team gives a pool', () => {
  const active = org({ status: 'active', source: 'stripe', members: 4 })
  assert.deepEqual(teamPool({ user: member(), org: active, now: NOW }), { id: 't1', members: 4 })
  // a staff contract carries no quantity: the joined members count
  assert.deepEqual(teamPool({ user: member(), org: org({ status: 'active', until: new Date(NOW + DAY) }), members: 3, now: NOW }), { id: 't1', members: 3 })
  // ended, cancelled, someone else's team, no team, a guest
  assert.equal(teamPool({ user: member(), org: org({ status: 'active', until: NOW - 1 }), now: NOW }), null)
  assert.equal(teamPool({ user: member(), org: org({ status: 'canceled', members: 4 }), now: NOW }), null)
  assert.equal(teamPool({ user: member(), org: org({ status: 'active', members: 4 }, 't2'), now: NOW }), null)
  assert.equal(teamPool({ user: member({ orgId: null }), org: active, now: NOW }), null)
  assert.equal(teamPool({ user: member({ isAnonymous: true }), org: active, now: NOW }), null)
  assert.equal(teamPool({ user: member(), org: org(null), now: NOW }), null)
  // a member with their own live Pro uses their Pro credits, as before
  assert.equal(teamPool({ user: member({ pro: { status: 'active', currentPeriodEnd: NOW + DAY } }), org: active, now: NOW }), null)
})

test('the pool is Pro\'s monthly amount times the members paid for; day caps are untouched', () => {
  const pooled = creditsForPool(switched, { id: 't1', members: 5 })
  assert.equal(pooled.free.aiMicrosPerMonth, switched.free.aiMicrosPerMonth * 5)
  assert.equal(pooled.free.voiceMinutesPerMonth, switched.free.voiceMinutesPerMonth * 5)
  assert.equal(pooled.free.videoMinutesPerMonth, switched.free.videoMinutesPerMonth * 5)
  assert.equal(pooled.free.perPersonMicrosPerDay, switched.free.perPersonMicrosPerDay)
  assert.equal(pooled.free.aiActionsPerDay, switched.free.aiActionsPerDay)
  assert.equal(creditsForPool(switched, null), switched)
})

test('on Cloud (Pro needed) a Business member without Pro gets included AI and calls from the pool, not "Get Pro"', () => {
  const pool = { id: 't1', members: 3 }
  const ask = (kind, usage = {}) => route({
    kind, person: inPool(noPro, pool), teamId: 't1', keys: {}, usage, wallets: {},
    global: { monthFreeMicros: switched.budget.monthlyMicros * 2, todayFreeMicros: 0 }, // the free budget is far past its pause
    estimateMicros: 5000, minutes: 10, settings: creditsForPool(switched, pool), now: NOW,
  })
  for (const kind of ['ai', 'imageSearch', 'voice', 'video']) {
    const d = ask(kind)
    assert.equal(d.ok, true, kind)
    assert.equal(d.route, 'free')
    assert.equal(d.pro, true, 'never paused by the shared free budget')
    assert.deepEqual(d.pool, pool)
  }
  // without Business the same person is refused as before
  const plain = route({ kind: 'ai', person: noPro, teamId: 't1', keys: {}, usage: {}, wallets: {}, global: {}, estimateMicros: 5000, settings: switched, now: NOW })
  assert.equal(plain.code, 'pro')
  // the team's month used up: refused in the pool's words
  const spent = ask('ai', { aiMicrosMonth: switched.free.aiMicrosPerMonth * 3 })
  assert.deepEqual([spent.ok, spent.code, spent.message], [false, 'ai-month', COPY.poolAiMonth])
  const calls = ask('voice', { voiceMinutesMonth: switched.free.voiceMinutesPerMonth * 3 })
  assert.deepEqual([calls.ok, calls.code], [false, 'calls-month'])
})

// a small counter store with the real guards (holds.mjs)
function store() {
  const rows = new Map()
  const add = (key, fields) => { const row = { ...(rows.get(key) || {}) }; for (const [k, v] of Object.entries(fields)) row[k] = (row[k] || 0) + v; rows.set(key, row) }
  return {
    rows,
    io: {
      async get(_s, key) { return rows.get(key) ? { ...rows.get(key) } : null },
      async incIf(_s, key, inc, guards) { if (!guardsPass(rows.get(key) || {}, guards)) return false; add(key, inc); return true },
      async add(_s, key, fields) { add(key, fields) },
      async insertEvent() { return true },
      async inc(key, fields) { add(key, fields) },
    },
  }
}

test('members draw on one team month: two members together may use the whole pool, and no more', async () => {
  const settings = structuredClone(switched)
  settings.free.aiMicrosPerMonth = 100_000
  settings.free.perPersonMicrosPerDay = 1e12
  settings.free.aiActionsPerDay = 1000
  const pool = { id: 't1', members: 2 }
  const pooled = creditsForPool(settings, pool)
  const { io, rows } = store()
  const month = poolMonthKey('t1', NOW)
  assert.equal(month, `org:t1:${monthKey(NOW)}`)
  const spend = async (payerId, micros) => {
    const hold = await holdFree(io, { payerId, kind: 'ai', countsAsDraft: true, draftsPerDay: 1000, estimateMicros: micros, ceilingMicros: micros, settings: pooled, now: NOW, enforceGlobal: false, monthCounter: month })
    if (!hold.ok) return hold
    await recordUsage(io, { ref: `${payerId}:${micros}:${Math.random()}`, payer: { type: 'user', id: payerId }, actorId: payerId, kind: 'imageSearch', route: 'free', feature: 'workshop', units: 1, costMicros: micros, now: NOW, settings: pooled, hold })
    await releaseHold(io, hold, { ok: true }, NOW)
    return hold
  }
  // u1 alone uses more than one member's amount: the pool is the team's
  assert.equal((await spend('u1', 150_000)).ok, true)
  assert.equal((await spend('u2', 40_000)).ok, true)
  const refused = await spend('u2', 20_000)
  assert.deepEqual([refused.ok, refused.code], [false, 'ai-month'])
  assert.equal(rows.get(month).aiMicros, 190_000)
  assert.equal(rows.get(`user:u1:${monthKey(NOW)}`), undefined, 'no personal month counter is drawn on')
  // each person's own day still counts
  assert.equal(rows.get(`user:u1:${dayKey(NOW)}`).freeMicros, 150_000)
})

test('a call started on the pool keeps counting its minutes on the team month', async () => {
  const pool = { id: 't1', members: 2 }
  const call = startCall({ callId: 'c1', shareId: 's1', starterId: 'u1', decision: { ok: true, route: 'free', kind: 'voice', payer: { type: 'user', id: 'u1' }, pro: true, pool }, now: NOW })
  assert.deepEqual(call.pool, pool)
  assert.equal(call.pro, true)
  const { io, rows } = store()
  await recordUsage(io, { ref: 'c1:1', payer: call.payer, actorId: 'u1', kind: 'voice', route: 'free', feature: 'call', units: 12, costMicros: 10, now: NOW, settings: switched, pro: true, pool: call.pool })
  assert.equal(rows.get(`org:t1:${monthKey(NOW)}`).voiceMinutes, 12)
  assert.equal(rows.get(`user:u1:${monthKey(NOW)}`), undefined)
})

test('Profile → Credits shows the team\'s pool for a member', () => {
  const pool = { id: 't1', members: 3 }
  const s = allowanceSummary({ person: inPool(noPro, pool), usage: {}, settings: creditsForPool(switched, pool), now: NOW, teamId: 't1' })
  assert.equal(s.included, true)
  assert.equal(s.needsPro, false)
  assert.deepEqual(s.teamPool, { members: 3 })
  assert.ok(s.voiceHoursLeft > allowanceSummary({ person: { ...noPro, included: true, pro: true }, usage: {}, settings: switched, now: NOW }).voiceHoursLeft)
})

test('the meter reads the pool for every included use: route, hold, calls and the summaries (source pins)', () => {
  const meteor = readFileSync(new URL('../web/app/server/metering/meteor.js', import.meta.url), 'utf8')
  assert.match(meteor, /const pool = await poolFor\(user, now\)\n\s+const \[usage, global, personalKeys/)
  assert.match(meteor, /person: personOf\(user, settings, now, pool\), teamId/)
  assert.match(meteor, /pool: call\.pool \?\? null/)
  const core = readFileSync(new URL('../web/app/server/metering/meter-core.mjs', import.meta.url), 'utf8')
  assert.match(core, /monthCounter: poolMonthKey\(decision\.pool\.id, at\)/)
  const daily = readFileSync(new URL('../web/app/server/methods/daily.js', import.meta.url), 'utf8')
  assert.match(daily, /usageFor\(user\._id, now, call\.pool \?\? null\)/)
})

test('inviting outside agents is free (owner, 2026-11-26): no Cloud gate asks for Pro or a Business seat', () => {
  const gate = readFileSync(new URL('../enterprise/server/meteor.js', import.meta.url), 'utf8')
  assert.doesNotMatch(gate, /invitesAgents|proActive|\bpro: /)
  const membership = readFileSync(new URL('../web/app/imports/api/business/membership.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(membership, /invitesAgents/)
})

test('a call on the pool is never cut off because the pool ran out (terms A3); other calls still are', () => {
  const pool = { id: 't1', members: 2 }
  const base = startCall({ callId: 'c2', shareId: 's1', starterId: 'u1', decision: { ok: true, route: 'free', kind: 'voice', payer: { type: 'user', id: 'u1' }, pro: true, pool }, now: NOW })
  const at = NOW + 9 * 60_000
  const call = { ...base, participants: ['u1', 'u2'], lastCount: 2 }
  const out = tick({ call, presence: { count: 2 }, now: at, minutesLeft: { voice: 0, video: 0 }, level: 0 })
  assert.equal(out.decision, 'extend')
  assert.equal(out.warning, null)
  assert.ok(out.charge.participantMinutes > 0, 'its minutes are still charged to the team month')
  // the same call without the pool ends on its allowance, as before
  const { pool: _p, ...plain } = call
  assert.notEqual(tick({ call: plain, presence: { count: 2 }, now: at, minutesLeft: { voice: 0, video: 0 }, level: 0 }).decision, 'extend')
  // and the usual limits still hold for a pool call
  assert.equal(tick({ call, presence: { count: 2 }, now: NOW + CALL_LIMITS.maxHours * 3_600_000, minutesLeft: { voice: 0, video: 0 }, level: 0 }).decision, 'end')
})
