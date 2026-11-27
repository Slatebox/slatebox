// Growth funnel (imports/api/common/growth.mjs has the rules both sides share): which links bring
// people to Slatebox Cloud, and how far they get. Pure: the Meteor glue (server/growth/meteor.js)
// hands in the collections, the account reads and the Cloud check; the tests hand in fakes.
//
// Three stores, all first-party, in this server's Mongo:
// - events: one raw row per counted step { step, kind, source, campaign, day, week, at }, no account
//   id (nothing reads one there: the people row counts each step once), removed after RAW_TTL_DAYS.
// - days: the aggregate the Growth page reads, one counter per day, source, campaign, step and paid
//   kind. No user id. Kept AGGREGATE_TTL_DAYS.
// - people: one row per counted account { source, campaign, firstDay, steps: { step: day } }, so
//   each step counts once per account. The account's own id, nothing else about them. Removed with
//   the account, when the browser asks not to be tracked, or PEOPLE_TTL_DAYS after it was made.
//
// Counting never fails the request it rides on, and counts nothing:
// - where this is not Slatebox Cloud (on() false),
// - for a request whose headers say Do Not Track or Global Privacy Control,
// - for an account with no people row (one only the browser beacon makes, so an account whose
//   browser asked not to be tracked is never counted by the server either).
import { PAID_KINDS, STEPS, DIRECT, EXISTING, OTHER, cleanLabel, dayOf, privacySignalFromHeaders, weekOf } from '../../imports/api/common/growth.mjs'

export const RAW_TTL_DAYS = 90
export const AGGREGATE_TTL_DAYS = 800
// a people row goes this long after it was made (a guest that never came back, an account long counted)
export const PEOPLE_TTL_DAYS = 400
// an account older than this is never new to the funnel, whatever the browser remembers
export const NEW_ACCOUNT_DAYS = 365
export const SUMMARY_WEEKS = 12
export const TOP_SOURCES = 15
export const TOP_CAMPAIGNS = 10
// an account made this long before the browser's first remembered visit was here before the funnel
export const EXISTING_AFTER_MS = 2 * 86_400_000
// an account's state (slates, shares, payments) is read at most this often per server process
export const RECHECK_MS = 10 * 60_000
// at most this many different source and campaign labels a day per server process come from browsers;
// past it a new label counts as 'other', so made-up labels cannot fill the database with rows
export const LABELS_PER_DAY = 300
const DAY = 86_400_000
const NO_CAMPAIGN = '-'
const NO_KIND = '-'

const emptySteps = () => Object.fromEntries(STEPS.map((step) => [step, 0]))
const emptyPaid = () => Object.fromEntries(PAID_KINDS.map((kind) => [kind, 0]))

/** What a browser's visit report may carry, cleaned; anything else is dropped. */
export function readVisit(input) {
  const value = input && typeof input === 'object' ? input : {}
  const since = typeof value.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.since) ? value.since : null
  const tagged = value.tagged === true
  return {
    source: cleanLabel(value.source) || DIRECT,
    campaign: cleanLabel(value.campaign ?? '') || null,
    first: value.first === true,
    since,
    tagged,
    tagSource: tagged ? cleanLabel(value.tagSource) || 'other' : null,
    tagCampaign: tagged ? cleanLabel(value.tagCampaign ?? '') || null : null,
  }
}

/**
 * The recorder.
 * stores: { events, days, people } (raw Mongo collections)
 * io: { account(userId) -> { createdAt, isAnonymous } | null, state(userId) -> { slate, share, invite, paid: { kind: bool } } }
 * on(): whether this server is Slatebox Cloud.
 */
export function createGrowthFunnel({ events, days, people, io, on = () => false, now = () => Date.now(), log = console, recheckMs = RECHECK_MS, remembered = 5000, labelsPerDay = LABELS_PER_DAY }) {
  // when each account's state was last read, so a busy account costs a few reads a while, not a read per report
  const checked = new Map()
  // the source and campaign labels browsers brought today (LABELS_PER_DAY)
  let labels = { day: null, seen: new Set() }
  function admit(source, campaign) {
    const day = dayOf(now())
    if (labels.day !== day) labels = { day, seen: new Set() }
    const key = `${source}|${campaign || NO_CAMPAIGN}`
    if (labels.seen.has(key)) return { source, campaign }
    if (labels.seen.size >= labelsPerDay) return { source: OTHER, campaign: null }
    labels.seen.add(key)
    return { source, campaign }
  }
  async function bump({ step, kind = null, source, campaign = null }) {
    const at = now()
    const day = dayOf(at)
    const week = weekOf(day)
    await events.insertOne({ step, kind, source, campaign, day, week, at: new Date(at) })
    await days.updateOne(
      { _id: [day, source, campaign || NO_CAMPAIGN, step, kind || NO_KIND].join('|') },
      { $inc: { n: 1 }, $setOnInsert: { day, week, source, campaign, step, kind, at: new Date(Date.parse(`${day}T00:00:00Z`)) } },
      { upsert: true },
    )
  }

  /** Marks a step for an account once; true when this call was the first. */
  async function markOnce(person, key) {
    const day = dayOf(now())
    const result = await people.updateOne({ _id: person._id, [`steps.${key}`]: { $exists: false } }, { $set: { [`steps.${key}`]: day } })
    return (result?.modifiedCount ?? 0) === 1
  }

  async function reach(person, step, kind = null) {
    if (!STEPS.includes(step)) return false
    if (step === 'paid' && !PAID_KINDS.includes(kind)) return false
    // an account from before the funnel counts only what it pays
    if (person.source === EXISTING && step !== 'paid') return false
    let counted = false
    if (step === 'paid') {
      if (await markOnce(person, `paid_${kind}`)) {
        await bump({ step, kind, source: person.source, campaign: person.campaign })
        counted = true
      }
      if (await markOnce(person, 'paid')) {
        await bump({ step, source: person.source, campaign: person.campaign })
        counted = true
      }
      return counted
    }
    if (await markOnce(person, step)) {
      await bump({ step, source: person.source, campaign: person.campaign })
      counted = true
    }
    return counted
  }

  async function personFor(userId, visit) {
    const account = await io.account(userId)
    if (!account) return null
    const created = account.createdAt instanceof Date ? account.createdAt.getTime() : Number(account.createdAt) || 0
    const since = Date.parse(`${visit.since || dayOf(now())}T00:00:00Z`)
    const existing = created > 0 && (created < since - EXISTING_AFTER_MS || created < now() - NEW_ACCOUNT_DAYS * DAY)
    const today = dayOf(now())
    try {
      await people.updateOne(
        { _id: userId },
        { $setOnInsert: { source: existing ? EXISTING : visit.source, campaign: existing ? null : visit.campaign, firstDay: today, at: new Date(now()), steps: {} } },
        { upsert: true },
      )
    } catch (error) {
      // a duplicate key from a race is the row already there
      if (error?.code !== 11000) throw error
    }
    const person = await people.findOne({ _id: userId })
    return person ? { person, account } : null
  }

  /** Catches up on every step this account has reached (the visit report, and after a known change). */
  async function reconcile(person, account) {
    const counted = []
    if (account && account.isAnonymous === false && (await reach(person, 'signup'))) counted.push('signup')
    if (person.firstDay && person.firstDay !== dayOf(now()) && (await reach(person, 'return'))) counted.push('return')
    const marked = person.steps || {}
    const open = person.source === EXISTING
      ? PAID_KINDS.some((kind) => !marked[`paid_${kind}`])
      : ['slate', 'share', 'invite'].some((step) => !marked[step]) || PAID_KINDS.some((kind) => !marked[`paid_${kind}`])
    const last = checked.get(person._id)
    if (!open || (last !== undefined && now() - last < recheckMs)) return counted
    checked.delete(person._id)
    checked.set(person._id, now())
    if (checked.size > remembered) checked.delete(checked.keys().next().value)
    const state = (await io.state(person._id)) || {}
    for (const step of ['slate', 'share', 'invite']) if (state[step] && (await reach(person, step))) counted.push(step)
    for (const kind of PAID_KINDS) if (state.paid?.[kind] && (await reach(person, 'paid', kind))) counted.push(`paid:${kind}`)
    return counted
  }

  const safely = (fn, fallback) => async (...args) => {
    try {
      return await fn(...args)
    } catch (error) {
      log.warn?.(`growth: not recorded (${error?.message})`)
      return fallback
    }
  }

  /**
   * A browser's report of one page load (or of a sign-in during it): { userId|null, input, headers }.
   * → { counted: [steps] }
   */
  async function visit({ userId = null, input, headers = {} }) {
    if (!on() || privacySignalFromHeaders(headers)) return { counted: [] }
    const report = readVisit(input)
    ;({ source: report.source, campaign: report.campaign } = admit(report.source, report.campaign))
    if (report.tagged) ({ source: report.tagSource, campaign: report.tagCampaign } = admit(report.tagSource, report.tagCampaign))
    const counted = []
    if (report.tagged) {
      await bump({ step: 'landing', source: report.tagSource, campaign: report.tagCampaign })
      counted.push('landing')
    }
    if (!userId) {
      if (report.first) {
        await bump({ step: 'visit', source: report.source, campaign: report.campaign })
        counted.push('visit')
      }
      return { counted }
    }
    const found = await personFor(userId, report)
    if (!found) return { counted }
    const { person, account } = found
    if (report.first && (await reach(person, 'visit'))) counted.push('visit')
    counted.push(...(await reconcile(person, account)))
    return { counted }
  }

  /** A known change on the server (a slate made, a link shared, an invitation sent). */
  async function step({ userId, step: name, kind = null }) {
    if (!on() || typeof userId !== 'string' || !userId) return false
    const person = await people.findOne({ _id: userId })
    if (!person) return false
    return reach(person, name, kind)
  }

  /** After a payment or a new key: read this account's state again at its next report. */
  function recheck(userId) {
    checked.delete(userId)
  }

  /** Forget an account: its people row (the browser asked, or the account went). Raw events never hold its id. */
  async function forget(userId) {
    if (typeof userId !== 'string' || !userId) return false
    await people.deleteOne({ _id: userId })
    return true
  }

  return {
    visit: safely(visit, { counted: [] }),
    step: safely(step, false),
    forget: safely(forget, false),
    recheck,
  }
}

/**
 * The Growth page: the last `weeks` weeks of the aggregate, by source and by week, and paid
 * conversions. rows: the days rows since the first of those weeks.
 */
export function growthSummary(rows, { now = Date.now(), weeks = SUMMARY_WEEKS, topSources = TOP_SOURCES, topCampaigns = TOP_CAMPAIGNS } = {}) {
  const thisWeek = weekOf(dayOf(now))
  const weekList = []
  for (let i = weeks - 1; i >= 0; i -= 1) weekList.push(dayOf(Date.parse(`${thisWeek}T00:00:00Z`) - i * 7 * DAY))
  const since = weekList[0]
  const totals = { steps: emptySteps(), paid: emptyPaid() }
  const bySource = new Map()
  const byWeek = new Map(weekList.map((week) => [week, { week, steps: emptySteps(), paid: emptyPaid() }]))
  const campaigns = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.day !== 'string' || row.day < since || !STEPS.includes(row.step)) continue
    const n = Number(row.n) || 0
    if (!n) continue
    const week = row.week || weekOf(row.day)
    const source = row.source || DIRECT
    const s = bySource.get(source) || { source, steps: emptySteps(), paid: emptyPaid() }
    const w = byWeek.get(week)
    const paidKind = row.step === 'paid' && PAID_KINDS.includes(row.kind) ? row.kind : null
    if (row.step === 'paid' && row.kind && !paidKind) continue
    if (paidKind) {
      s.paid[paidKind] += n
      totals.paid[paidKind] += n
      if (w) w.paid[paidKind] += n
    } else {
      s.steps[row.step] += n
      totals.steps[row.step] += n
      if (w) w.steps[row.step] += n
    }
    bySource.set(source, s)
    if (row.campaign && !paidKind) {
      const key = `${source}|${row.campaign}`
      const c = campaigns.get(key) || { source, campaign: row.campaign, landing: 0, signup: 0, paid: 0 }
      if (row.step === 'landing' || row.step === 'signup' || row.step === 'paid') c[row.step] += n
      campaigns.set(key, c)
    }
  }
  const weight = (s) => s.steps.landing + s.steps.visit + s.steps.signup * 10 + s.steps.paid * 100
  const sorted = [...bySource.values()].sort((a, b) => weight(b) - weight(a) || a.source.localeCompare(b.source))
  const top = sorted.slice(0, topSources)
  const rest = sorted.slice(topSources)
  if (rest.length) {
    const others = { source: `${rest.length} more`, rolledUp: true, steps: emptySteps(), paid: emptyPaid() }
    for (const s of rest) {
      for (const step of STEPS) others.steps[step] += s.steps[step]
      for (const kind of PAID_KINDS) others.paid[kind] += s.paid[kind]
    }
    top.push(others)
  }
  return {
    since,
    weeks: weekList.length,
    steps: STEPS,
    paidKinds: PAID_KINDS,
    totals,
    bySource: top,
    byWeek: [...byWeek.values()],
    campaigns: [...campaigns.values()].sort((a, b) => b.landing - a.landing || b.signup - a.signup || a.source.localeCompare(b.source)).slice(0, topCampaigns),
  }
}

export async function ensureGrowthIndexes({ events, days, people }) {
  await events.createIndex({ at: 1 }, { expireAfterSeconds: RAW_TTL_DAYS * 86400 })
  await days.createIndex({ at: 1 }, { expireAfterSeconds: AGGREGATE_TTL_DAYS * 86400 })
  await days.createIndex({ day: 1 })
  await people.createIndex({ at: 1 }, { expireAfterSeconds: PEOPLE_TTL_DAYS * 86400 })
}
