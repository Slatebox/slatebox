// The growth funnel (owner request 2026-11-27: conversion tracking for the share mark, comparison
// pages, directories and launch posts): first-party, Slatebox Cloud only, never with Do Not Track or
// Global Privacy Control, counts by source, step and day, each step once per account.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  DIRECT, EXISTING, automatedBrowser, GROWTH_STORAGE_KEY, OTHER, SHARED_LINK, STEPS, cleanLabel, funnelRows, growthOn, planVisit,
  privacySignal, privacySignalFromHeaders, rate, readRemembered, referrerHost, remember, sourceFromLocation, weekOf,
} from '../web/app/imports/api/common/growth.mjs'
import { RAW_TTL_DAYS, createGrowthFunnel, ensureGrowthIndexes, growthSummary, readVisit } from '../web/app/server/growth/funnel-core.mjs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const DAY = 86_400_000
const T0 = Date.parse('2026-11-27T12:00:00Z') // a Friday

// --- a small in-memory stand-in for the three raw collections -------------------------------
function get(doc, path) {
  return path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc)
}
function set(doc, path, value) {
  const keys = path.split('.')
  let at = doc
  for (const k of keys.slice(0, -1)) at = at[k] ??= {}
  at[keys.at(-1)] = value
}
function matches(doc, filter) {
  return Object.entries(filter).every(([path, want]) => {
    const have = get(doc, path)
    if (want && typeof want === 'object' && '$exists' in want) return (have !== undefined) === want.$exists
    return have === want
  })
}
function collection() {
  const rows = new Map()
  let next = 0
  const indexes = []
  return {
    rows,
    indexes,
    async insertOne(doc) { const _id = doc._id ?? `r${++next}`; rows.set(_id, { ...structuredClone(doc), _id }); return { insertedId: _id } },
    async findOne(filter) { return [...rows.values()].find((d) => matches(d, filter)) ?? null },
    async updateOne(filter, update, options = {}) {
      let doc = [...rows.values()].find((d) => matches(d, filter))
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 }
        if (filter._id !== undefined && rows.has(filter._id)) { const e = new Error('dup'); e.code = 11000; throw e }
        doc = { _id: filter._id ?? `r${++next}` }
        for (const [k, v] of Object.entries(update.$setOnInsert || {})) set(doc, k, structuredClone(v))
        rows.set(doc._id, doc)
      }
      for (const [k, v] of Object.entries(update.$set || {})) set(doc, k, v)
      for (const [k, v] of Object.entries(update.$inc || {})) set(doc, k, (get(doc, k) || 0) + v)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async deleteOne(filter) { const d = [...rows.values()].find((x) => matches(x, filter)); if (d) rows.delete(d._id); return { deletedCount: d ? 1 : 0 } },
    async deleteMany(filter) { let n = 0; for (const d of [...rows.values()]) if (matches(d, filter)) { rows.delete(d._id); n += 1 } return { deletedCount: n } },
    async createIndex(spec, options) { indexes.push({ spec, options }) },
  }
}

function setup({ on = true, accounts = {}, states = {}, now = T0 } = {}) {
  const clock = { at: now }
  const stores = { events: collection(), days: collection(), people: collection() }
  const io = {
    account: async (id) => accounts[id] ?? null,
    state: async (id) => states[id] ?? { slate: false, share: false, invite: false, paid: {} },
  }
  const funnel = createGrowthFunnel({ ...stores, io, on: () => on, now: () => clock.at, log: { warn() {} } })
  const count = (step, source, kind = null) => [...stores.days.rows.values()]
    .filter((r) => r.step === step && (source === undefined || r.source === source) && (r.kind ?? null) === kind)
    .reduce((n, r) => n + r.n, 0)
  return { funnel, stores, clock, accounts, states, count }
}

// --- sources -----------------------------------------------------------------------------------
test('a link names its source by ref, else utm_source, with utm_campaign beside it', () => {
  assert.deepEqual(sourceFromLocation({ search: '?ref=made-with' }), { source: 'made-with', campaign: null, tagged: true })
  assert.deepEqual(sourceFromLocation({ search: '?utm_source=HN&utm_campaign=Show HN' }), { source: 'hn', campaign: 'show-hn', tagged: true })
  assert.equal(sourceFromLocation({ search: '?ref=compare-miro&utm_source=x' }).source, 'compare-miro')
  // a tag that does not clean still landed, as 'other'
  assert.deepEqual(sourceFromLocation({ search: '?ref=%F0%9F%98%80' }), { source: OTHER, campaign: null, tagged: true })
})

test('without a tag: the referring site, a shared link opened straight, or direct', () => {
  assert.deepEqual(sourceFromLocation({ referrer: 'https://news.ycombinator.com/item?id=1' }), { source: 'news.ycombinator.com', campaign: null, tagged: false })
  assert.equal(sourceFromLocation({ referrer: 'https://www.slatebox.com/compare/miro/' }).source, 'slatebox.com')
  // a click inside the app is not a source
  assert.equal(sourceFromLocation({ referrer: 'https://app.slatebox.com/new', path: '/new' }).source, DIRECT)
  assert.equal(sourceFromLocation({ path: '/present/abc123' }).source, SHARED_LINK)
  assert.equal(sourceFromLocation({ path: '/canvas/abc123' }).source, SHARED_LINK)
  assert.equal(sourceFromLocation({ path: '/' }).source, DIRECT)
  assert.equal(referrerHost('not a url'), null)
})

test('a label never keeps an address, a link or a key', () => {
  assert.equal(cleanLabel('tim@slatebox.com'), null)
  assert.equal(cleanLabel('tim%40slatebox.com'), null)
  assert.equal(cleanLabel('https://x.com/a'), null)
  assert.equal(cleanLabel('sk-abcdef123456'), null)
  assert.equal(cleanLabel('Product Hunt'), 'product-hunt')
  assert.equal(cleanLabel('x'.repeat(80)).length, 40)
  assert.equal(cleanLabel(''), null)
  assert.equal(cleanLabel(42), null)
  assert.equal(sourceFromLocation({ search: '?ref=tim@slatebox.com' }).source, OTHER)
})

test('Do Not Track and Global Privacy Control, from the browser or the headers', () => {
  assert.equal(privacySignal({ globalPrivacyControl: true }, {}), true)
  assert.equal(privacySignal({ doNotTrack: '1' }, {}), true)
  assert.equal(privacySignal({}, { doNotTrack: '1' }), true)
  assert.equal(privacySignal({ doNotTrack: 'unspecified' }, {}), false)
  assert.equal(privacySignal({}, {}), false)
  assert.equal(privacySignalFromHeaders({ dnt: '1' }), true)
  assert.equal(privacySignalFromHeaders({ 'sec-gpc': '1' }), true)
  assert.equal(privacySignalFromHeaders({ 'user-agent': 'x' }), false)
  assert.equal(privacySignalFromHeaders(null), false)
})

test('an automated browser is never counted', () => {
  assert.equal(automatedBrowser({ webdriver: true }), true)
  assert.equal(automatedBrowser({ webdriver: false }), false)
  assert.equal(automatedBrowser(undefined), false)
  assert.match(read('web/app/imports/ui/components/GrowthBeacon.jsx'), /\|\| automatedBrowser\(\)\) return/)
})

test('Cloud only: off on a self-hosted server, without the Cloud license, or switched off', () => {
  const cloud = { public: { env: 'prod', payments: { cloud: true } } }
  assert.equal(growthOn(cloud), true)
  assert.equal(growthOn({ public: { env: 'selfhost', payments: { cloud: true } } }), false)
  assert.equal(growthOn({ public: { env: 'prod', payments: { cloud: false } } }), false)
  assert.equal(growthOn({ public: { env: 'prod' } }), false)
  assert.equal(growthOn({ ...cloud, growth: { enabled: false } }), false)
  // the browser reads the server's answer
  assert.equal(growthOn({ public: { env: 'prod', payments: { cloud: true }, growth: { on: false } } }), false)
  assert.equal(growthOn({ public: { env: 'prod', payments: { cloud: true }, growth: { on: true } } }), true)
  assert.equal(growthOn(undefined), false)
})

test('the browser keeps where it first came from; a later tagged link lands without moving it', () => {
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  const first = planVisit({ location: { search: '?ref=made-with' }, remembered: readRemembered(storage), now: T0 })
  assert.deepEqual(first.send, { source: 'made-with', campaign: null, first: true, tagged: true, tagSource: 'made-with', tagCampaign: null })
  remember(first.keep, storage)
  assert.ok(store.has(GROWTH_STORAGE_KEY))
  const later = planVisit({ location: { search: '?utm_source=hn' }, remembered: readRemembered(storage), now: T0 + 3 * DAY })
  assert.deepEqual(later.send, { source: 'made-with', campaign: null, first: false, tagged: true, tagSource: 'hn', tagCampaign: null })
  assert.equal(later.keep.d, '2026-11-27')
  // a broken entry reads as none
  store.set(GROWTH_STORAGE_KEY, '{bad')
  assert.equal(readRemembered(storage), null)
  assert.equal(readRemembered({ getItem() { throw new Error('blocked') } }), null)
})

test('a visit report is cleaned before anything reads it', () => {
  assert.deepEqual(readVisit({ source: 'a@b.c', first: 'yes', tagged: true, tagSource: '' , since: 'x' }),
    { source: DIRECT, campaign: null, first: false, since: null, tagged: true, tagSource: 'other', tagCampaign: null })
  assert.deepEqual(readVisit(null).source, DIRECT)
})

// --- the recorder --------------------------------------------------------------------------------
test('off, or with Do Not Track in the headers, nothing is written', async () => {
  const off = setup({ on: false })
  assert.deepEqual(await off.funnel.visit({ input: { source: 'hn', first: true, tagged: true, tagSource: 'hn' } }), { counted: [] })
  assert.equal(await off.funnel.step({ userId: 'u1', step: 'slate' }), false)
  assert.equal(off.stores.events.rows.size + off.stores.days.rows.size + off.stores.people.rows.size, 0)
  const dnt = setup()
  assert.deepEqual(await dnt.funnel.visit({ userId: 'u1', input: { source: 'hn', first: true, tagged: true, tagSource: 'hn' }, headers: { dnt: '1' } }), { counted: [] })
  assert.equal(dnt.stores.events.rows.size + dnt.stores.days.rows.size + dnt.stores.people.rows.size, 0)
})

test('an anonymous first visit by a tagged link: a landing and a visit, and no account id in the counts', async () => {
  const { funnel, stores, count } = setup()
  const out = await funnel.visit({ input: { source: 'made-with', first: true, tagged: true, tagSource: 'made-with', since: '2026-11-27' } })
  assert.deepEqual(out.counted, ['landing', 'visit'])
  assert.equal(count('landing', 'made-with'), 1)
  assert.equal(count('visit', 'made-with'), 1)
  for (const row of stores.days.rows.values()) {
    assert.equal('userId' in row, false)
    assert.deepEqual(Object.keys(row).sort(), ['_id', 'at', 'campaign', 'day', 'kind', 'n', 'source', 'step', 'week'])
  }
  assert.equal(stores.people.rows.size, 0)
})

test('a guest who signs up, shares, comes back and pays: each step once, under the first source', async () => {
  const { funnel, stores, clock, accounts, states, count } = setup({
    accounts: { g1: { createdAt: new Date(T0), isAnonymous: true } },
  })
  await funnel.visit({ input: { source: 'compare-miro', first: true, tagged: true, tagSource: 'compare-miro', since: '2026-11-27' } })
  // the guest account starts during the same load
  states.g1 = { slate: true, share: false, invite: false, paid: {} }
  let out = await funnel.visit({ userId: 'g1', input: { source: 'compare-miro', first: false, since: '2026-11-27' } })
  assert.deepEqual(out.counted, ['slate'])
  assert.equal(stores.people.rows.get('g1').source, 'compare-miro')
  // the explicit hook for the same step counts nothing more
  assert.equal(await funnel.step({ userId: 'g1', step: 'slate' }), false)
  assert.equal(count('slate', 'compare-miro'), 1)
  // signs up and shares a link
  accounts.g1.isAnonymous = false
  assert.equal(await funnel.step({ userId: 'g1', step: 'share' }), true)
  funnel.recheck('g1')
  out = await funnel.visit({ userId: 'g1', input: { source: 'compare-miro', first: false, since: '2026-11-27' } })
  assert.deepEqual(out.counted, ['signup'])
  // the next day, back, with a team invitation and a Business seat and an own key
  clock.at = T0 + DAY
  states.g1 = { slate: true, share: true, invite: true, paid: { business: true, ownkey: true } }
  funnel.recheck('g1')
  out = await funnel.visit({ userId: 'g1', input: { source: 'compare-miro', first: true, since: '2026-11-27' } })
  assert.deepEqual(out.counted.sort(), ['invite', 'paid:business', 'paid:ownkey', 'return', 'visit'].sort())
  assert.equal(count('paid', 'compare-miro'), 1)
  assert.equal(count('paid', 'compare-miro', 'business'), 1)
  assert.equal(count('paid', 'compare-miro', 'ownkey'), 1)
  // nothing counts twice
  funnel.recheck('g1')
  out = await funnel.visit({ userId: 'g1', input: { source: 'compare-miro', first: true, since: '2026-11-27' } })
  assert.deepEqual(out.counted, [])
  // a top-up later: its own kind, not a second "paid"
  states.g1.paid.topup = true
  funnel.recheck('g1')
  out = await funnel.visit({ userId: 'g1', input: { source: 'compare-miro', since: '2026-11-27' } })
  assert.deepEqual(out.counted, ['paid:topup'])
  assert.equal(count('paid', 'compare-miro'), 1)
  // raw events carry the account id and the step, nothing else about the person
  for (const row of stores.events.rows.values()) assert.deepEqual(Object.keys(row).sort(), ['_id', 'at', 'campaign', 'day', 'kind', 'source', 'step', 'userId', 'week'])
})

test('an account from before counting began counts only what it pays, under "existing"', async () => {
  const { funnel, stores, states, count } = setup({
    accounts: { old: { createdAt: new Date(T0 - 400 * DAY), isAnonymous: false } },
    states: { old: { slate: true, share: true, invite: true, paid: { pro: true } } },
  })
  const out = await funnel.visit({ userId: 'old', input: { source: 'hn', first: true, tagged: true, tagSource: 'hn', since: '2026-11-27' } })
  assert.deepEqual(out.counted, ['landing', 'paid:pro'])
  assert.equal(stores.people.rows.get('old').source, EXISTING)
  assert.equal(count('signup'), 0)
  assert.equal(count('visit'), 0)
  assert.equal(count('paid', EXISTING, 'pro'), 1)
  assert.ok(states)
})

test('the server counts nothing for an account its browser never reported (opted out, or not Cloud)', async () => {
  const { funnel, stores } = setup({ accounts: { u: { createdAt: new Date(T0), isAnonymous: false } } })
  assert.equal(await funnel.step({ userId: 'u', step: 'share' }), false)
  assert.equal(await funnel.step({ userId: '', step: 'share' }), false)
  assert.equal(stores.days.rows.size, 0)
})

test('forget removes the account row and its raw events; the weekly counts stay', async () => {
  const { funnel, stores } = setup({ accounts: { u: { createdAt: new Date(T0), isAnonymous: false } } })
  await funnel.visit({ userId: 'u', input: { source: 'hn', first: true, tagged: true, tagSource: 'hn', since: '2026-11-27' } })
  assert.ok(stores.people.rows.has('u'))
  const daysBefore = stores.days.rows.size
  assert.equal(await funnel.forget('u'), true)
  assert.equal(stores.people.rows.has('u'), false)
  assert.equal([...stores.events.rows.values()].some((r) => r.userId === 'u'), false)
  assert.equal(stores.days.rows.size, daysBefore)
})

test('an account is read again at most every ten minutes per server, unless asked', async () => {
  let reads = 0
  const { funnel, clock, states } = setup({ accounts: { u: { createdAt: new Date(T0), isAnonymous: true } } })
  states.u = { slate: false, share: false, invite: false, paid: {} }
  const io = states
  const realState = io.u
  Object.defineProperty(io, 'u', { get() { reads += 1; return realState }, configurable: true })
  await funnel.visit({ userId: 'u', input: { source: 'hn', first: true, since: '2026-11-27' } })
  await funnel.visit({ userId: 'u', input: { source: 'hn', since: '2026-11-27' } })
  assert.equal(reads, 1)
  clock.at += 11 * 60_000
  await funnel.visit({ userId: 'u', input: { source: 'hn', since: '2026-11-27' } })
  assert.equal(reads, 2)
  funnel.recheck('u')
  await funnel.visit({ userId: 'u', input: { source: 'hn', since: '2026-11-27' } })
  assert.equal(reads, 3)
})

test('a failure to record never fails the request', async () => {
  const broken = { insertOne: async () => { throw new Error('down') }, updateOne: async () => { throw new Error('down') }, findOne: async () => { throw new Error('down') }, deleteOne: async () => { throw new Error('down') }, deleteMany: async () => { throw new Error('down') } }
  const funnel = createGrowthFunnel({ events: broken, days: broken, people: broken, io: { account: async () => null, state: async () => null }, on: () => true, log: { warn() {} } })
  assert.deepEqual(await funnel.visit({ input: { tagged: true, tagSource: 'x' } }), { counted: [] })
  assert.equal(await funnel.step({ userId: 'u', step: 'slate' }), false)
  assert.equal(await funnel.forget('u'), false)
})

test('indexes: raw events expire after 90 days, counts after about two years, account rows after 400 days', async () => {
  const stores = { events: collection(), days: collection(), people: collection() }
  await ensureGrowthIndexes(stores)
  assert.deepEqual(stores.events.indexes[0], { spec: { at: 1 }, options: { expireAfterSeconds: RAW_TTL_DAYS * 86400 } })
  assert.equal(RAW_TTL_DAYS, 90)
  assert.equal(stores.days.indexes[0].options.expireAfterSeconds, 800 * 86400)
  assert.equal(stores.people.indexes[0].options.expireAfterSeconds, 400 * 86400)
})

// --- the Growth page --------------------------------------------------------------------------
test('the summary: the funnel by source and by week, paid conversions and campaigns', () => {
  const row = (day, source, step, n, extra = {}) => ({ day, week: weekOf(day), source, step, n, campaign: null, kind: null, ...extra })
  const rows = [
    row('2026-11-27', 'made-with', 'landing', 40),
    row('2026-11-27', 'made-with', 'visit', 30),
    row('2026-11-27', 'made-with', 'signup', 6),
    row('2026-11-27', 'made-with', 'paid', 1),
    row('2026-11-27', 'made-with', 'paid', 1, { kind: 'business' }),
    row('2026-11-20', 'hn', 'landing', 100, { campaign: 'show-hn' }),
    row('2026-11-20', 'hn', 'signup', 9, { campaign: 'show-hn' }),
    row('2026-11-20', 'direct', 'visit', 5),
    row('2025-01-01', 'old', 'visit', 999), // before the window
    row('2026-11-27', 'x', 'nonsense', 3),
  ]
  const s = growthSummary(rows, { now: T0, weeks: 4 })
  assert.equal(s.since, '2026-11-02')
  assert.equal(s.byWeek.length, 4)
  assert.equal(s.byWeek.at(-1).week, '2026-11-23')
  assert.equal(s.byWeek.at(-1).steps.landing, 40)
  assert.equal(s.byWeek.at(-2).steps.landing, 100)
  assert.equal(s.totals.steps.visit, 35)
  assert.equal(s.totals.paid.business, 1)
  assert.equal(s.totals.steps.paid, 1)
  assert.deepEqual(s.bySource.map((r) => r.source), ['made-with', 'hn', 'direct'])
  assert.deepEqual(s.campaigns, [{ source: 'hn', campaign: 'show-hn', landing: 100, signup: 9, paid: 0 }])
  // many sources roll up after the top ones
  const many = Array.from({ length: 20 }, (_, i) => row('2026-11-27', `s${i}`, 'visit', i + 1))
  const rolled = growthSummary(many, { now: T0, weeks: 1, topSources: 5 })
  assert.equal(rolled.bySource.length, 6)
  assert.equal(rolled.bySource.at(-1).rolledUp, true)
  assert.equal(rolled.bySource.at(-1).steps.visit, (1 + 15) * 15 / 2)
})

test('funnel rows: each step as a share of the one above it', () => {
  const rows = funnelRows({ landing: 50, visit: 200, slate: 100, signup: 25, share: 5, return: 10, invite: 2, paid: 1 })
  assert.deepEqual(rows.map((r) => r.step), STEPS)
  assert.equal(rows[0].rate, null)
  assert.equal(rows[1].rate, null)
  assert.equal(rows.find((r) => r.step === 'slate').rate, 50)
  assert.equal(rows.find((r) => r.step === 'signup').rate, 25)
  assert.equal(rate(1, 0), null)
})

// --- wiring ------------------------------------------------------------------------------------
test('no cookie, no third-party script: the beacon calls only its own method, and only on Cloud', () => {
  const beacon = read('web/app/imports/ui/components/GrowthBeacon.jsx')
  const shared = read('web/app/imports/api/common/growth.mjs')
  const server = read('web/app/server/growth/meteor.js') + read('web/app/server/growth/funnel-core.mjs')
  for (const text of [beacon, shared, server]) {
    assert.doesNotMatch(text, /document\.cookie\s*=/)
    assert.doesNotMatch(text, /<script|createElement\(['"]script|https?:\/\/(?!app\.slatebox|test\.slatebox)/)
  }
  assert.match(beacon, /growthOn\(Meteor\.settings\)/)
  assert.match(beacon, /privacySignal\(\)/)
  assert.match(beacon, /CONSTANTS\.methods\.growth\.forget/)
  // the server tells browsers whether it runs, from the Cloud license
  assert.match(server, /const on = \(\) => cloudOn\(\) && growthOn\(Meteor\.settings\)/)
  assert.match(server, /Meteor\.settings\.public\.growth = \{ on: on\(\) \}/)
  // the admin read is for server administrators only
  assert.match(server, /isInstanceAdmin\(this\.userId\)/)
  assert.match(read('web/app/client/main.jsx'), /<GrowthBeacon \/>/)
  assert.match(read('web/app/server/main.js'), /import '\.\/growth\/meteor'/)
})

test('the steps are hooked where they happen, and removing an account removes its row', () => {
  assert.match(read('web/app/server/slate-save.js'), /growthStep\(actor\.userId, 'slate'\)/)
  const access = read('web/app/server/methods/slateAccess.js')
  assert.match(access, /if \(!initialize && type !== 'private'\) growthStep\(this\.userId, 'share'\)/)
  assert.match(access, /growthStep\(ownerId, 'share'\)/)
  const users = read('web/app/server/methods/users.js')
  assert.match(users, /if \(!resend\) growthStep\(actor\._id, 'invite'\)/)
  assert.match(users, /await forgetGrowthOf\(user\._id\)/)
})

test('the Growth admin page exists only where the funnel runs', () => {
  const routes = read('web/app/imports/ui/SBRoutes.jsx')
  assert.match(routes, /growthOn\(Meteor\.settings\) && <Route path="\/admin\/growth"/)
  assert.match(read('web/app/imports/ui/pages/AdminTools.jsx'), /growthOn\(Meteor\.settings\) && CLOUD_SECTIONS/)
})
