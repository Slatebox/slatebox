// The personalization allowance (owner, 2026-11-26): on Slatebox Cloud each signed-in person, not a
// guest, gets a few uses a day of the features that get to know them, paid by Slatebox on its own
// binding, with no Pro needed. Past it the meter applies unchanged (Pro credits, a balance, an own
// key). A request an own key serves never uses it. Self-host has no meter, so none of this runs there.
//
// Pure apart from the injected io (holds.mjs's: get, incIf, add), so the rules are tested with an
// in-memory store (scripts/meter-allowance.test.mjs).

// What a person gets a day, per meter feature: the one place the defaults live. The operator changes
// them with settings.metering.personalAllowance (checked at start) and an administrator in the
// stored meter settings (SystemSettings 'metering', personalAllowance). 0 turns one off.
export const DEFAULT_PERSONAL_ALLOWANCE = Object.freeze({
  // turns of the interview in About you (interview.start counts as a turn)
  interview: 20,
  // runs of For you ideas
  'personal.suggest': 5,
})

// The meter features the allowance pays for today. A feature joins by being added here, once its
// requests run inside runAIAction under that feature name ('personal.suggest', then 'profile.sources'
// and 'profile.import' with a default above).
export const PERSONAL_FEATURES = Object.freeze(['interview'])

// What a person reads when today's allowance for a feature is used up and the meter has nothing
// else for them (no Pro, no balance). `own`: own keys are on here (settings.ownKeys).
const USED_UP = Object.freeze({
  interview: {
    own: "You've used today's free talk with Slatebox. It comes back tomorrow, or keep going with Pro or your own key.",
    cloud: "You've used today's free talk with Slatebox. It comes back tomorrow, or keep going with Pro.",
  },
  'personal.suggest': {
    own: "You've used today's free ideas from Slatebox. They come back tomorrow, or keep going with Pro or your own key.",
    cloud: "You've used today's free ideas from Slatebox. They come back tomorrow, or keep going with Pro.",
  },
})
const USED_UP_ANY = Object.freeze({
  own: "You've used today's free amount of this. It comes back tomorrow, or keep going with Pro or your own key.",
  cloud: "You've used today's free amount of this. It comes back tomorrow, or keep going with Pro.",
})

/** The words for a feature whose allowance is used up today. */
export const usedUpWords = (feature, settings = null) => (USED_UP[feature] || USED_UP_ANY)[settings?.ownKeys === true ? 'own' : 'cloud']

const MAX_PER_DAY = 1000

/**
 * The allowance as stored or deployed, checked: { feature: whole number of uses a day }. Only the
 * features above may be named. Throws for anything else (a deploy value stops the start).
 */
export function checkPersonalAllowance(value, where = 'metering.personalAllowance') {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`settings ${where} is an object of uses a day by feature, e.g. {"interview": 20}.`)
  const out = {}
  for (const [feature, perDay] of Object.entries(value)) {
    // a settings file's own notes ("//")
    if (feature.startsWith('//')) continue
    if (!Object.hasOwn(DEFAULT_PERSONAL_ALLOWANCE, feature)) {
      throw new Error(`settings ${where} names ${JSON.stringify(feature)}; it can name ${Object.keys(DEFAULT_PERSONAL_ALLOWANCE).map(f => JSON.stringify(f)).join(', ')}.`)
    }
    if (!Number.isInteger(perDay) || perDay < 0 || perDay > MAX_PER_DAY) throw new Error(`settings ${where}.${feature} is a whole number of uses a day, 0 to ${MAX_PER_DAY}.`)
    out[feature] = perDay
  }
  return out
}

// A stored value is read on every request, so a wrong entry there is left out (the deploy value or
// the default stands) instead of stopping every metered request.
function storedAllowance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [feature, perDay] of Object.entries(value)) {
    try { Object.assign(out, checkPersonalAllowance({ [feature]: perDay })) } catch { /* left out */ }
  }
  return out
}

/** The allowance in force: the defaults, then the deploy settings (checked), then what an administrator stored. */
export function resolvePersonalAllowance({ deploy, stored } = {}) {
  return Object.freeze({ ...DEFAULT_PERSONAL_ALLOWANCE, ...checkPersonalAllowance(deploy), ...storedAllowance(stored) })
}

/**
 * Uses a day of a feature the allowance pays for, or 0 when it pays for none of it. level: the shared
 * budget's stage (policy.mjs budgetLevel); from its smaller-drafts stage (smallerAiAt) it shrinks in the
 * same proportion as free drafts do (reducedAiActionsPerDay of aiActionsPerDay), never below 1.
 */
export function allowancePerDay(feature, settings, level = 0) {
  if (!PERSONAL_FEATURES.includes(feature)) return 0
  const perDay = settings?.personalAllowance?.[feature] ?? DEFAULT_PERSONAL_ALLOWANCE[feature] ?? 0
  if (!Number.isInteger(perDay) || perDay <= 0) return 0
  const budget = settings?.budget, full = settings?.free?.aiActionsPerDay
  if (budget && level >= budget.smallerAiAt && full > 0 && budget.reducedAiActionsPerDay < full) {
    return Math.max(1, Math.floor(perDay * Math.max(0, budget.reducedAiActionsPerDay) / full))
  }
  return perDay
}

// How many people's allowance one network address gets a day (a household, a small office, a
// classroom behind one address): throwaway accounts made from one place share it, so making more
// of them gets no more. Addresses that stand for many callers (a Cloudflare edge, the cluster's
// own) are not counted (client-address.mjs isProxyAddress).
export const PEOPLE_PER_ADDRESS = 5

// The counter field on the person's day (MeterTotals `user:<id>:<UTC day>`): no dots, so a feature
// such as 'personal.suggest' stays one field in Mongo.
export const allowanceField = feature => 'allowance_' + String(feature).replace(/[^A-Za-z0-9]/g, '_')

/** Uses of each allowance feature counted on a person's day row. */
export const allowanceUsage = (day = {}) => Object.fromEntries(PERSONAL_FEATURES.map(feature => [feature, day[allowanceField(feature)] || 0]))

/**
 * Whether the allowance serves this request, from what route() is given (policy.mjs).
 * → null (the allowance is not about this request), { ok: true, feature, perDay },
 *   or { ok: false, usedUp } (usedUp: today's uses are gone, so the refusal says so).
 * taken: 'used-up' when the hold found the last use already taken by a request running at the same
 * time (meter-core.mjs), 'paused' when the shared budget's ceiling stopped it, 'address' when the
 * caller's network address had used its share (PEOPLE_PER_ADDRESS).
 */
export function allowanceCheck({ kind, feature, person, usage = {}, settings, level = 0, taken = null }) {
  if (kind !== 'ai' || !person || person.anonymous) return null
  const perDay = allowancePerDay(feature, settings, level)
  if (!perDay) return null
  // stopped by an administrator, the shared budget's hard ceiling, or this network address's share
  // used up by other accounts: no allowance, the meter decides (with its own words: this person may
  // have used none of theirs)
  if (person.freeStopped === true || level >= settings.budget.pauseAiAt || taken === 'paused' || taken === 'address') return { ok: false, usedUp: false }
  if (taken === 'used-up' || (usage.allowanceToday?.[feature] || 0) >= perDay) return { ok: false, usedUp: true }
  return { ok: true, feature, perDay }
}

const refuse = code => ({ ok: false, code })
const negate = fields => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, -v]))

/**
 * Takes one of today's uses (the person's, and their network address's share when it is known) and
 * sets the request's most possible spend aside on the shared budget's month, each with one
 * conditional update, so two requests at the same moment cannot both take the last use, nor pass
 * the budget's ceiling. keys: { day, global, address? } (address: `address:<bucket>:<UTC day>`).
 * → { ok: true, route: 'allowance', feature, field, keys, holdMicros, leftMicros, used: false }
 *   | { ok: false, code: 'used-up' | 'address' | 'paused' }
 */
export async function holdAllowance(io, { feature, perDay, keys, ceilingMicros, estimateMicros, globalCap, now }) {
  const field = allowanceField(feature)
  const need = Math.max(1, estimateMicros)
  const perAddress = perDay * PEOPLE_PER_ADDRESS
  for (let attempt = 0; attempt < 5; attempt++) {
    const [day, global, place] = (await Promise.all([io.get('counters', keys.day), io.get('counters', keys.global),
      keys.address ? io.get('counters', keys.address) : null])).map(d => d || {})
    if ((day[field] || 0) >= perDay) return refuse('used-up')
    if (keys.address && (place[field] || 0) >= perAddress) return refuse('address')
    const globalLeft = globalCap - (global.freeMicros || 0) - (global.heldMicros || 0)
    if (globalLeft < need) return refuse('paused')
    const hold = Math.max(1, Math.min(ceilingMicros, globalLeft))
    if (!await io.incIf('counters', keys.day, { [field]: 1 }, [{ sum: { [field]: 1 }, max: perDay - 1 }], now)) continue
    if (keys.address && !await io.incIf('counters', keys.address, { [field]: 1 }, [{ sum: { [field]: 1 }, max: perAddress - 1 }], now)) {
      await io.add('counters', keys.day, negate({ [field]: 1 }), now)
      continue
    }
    if (!await io.incIf('counters', keys.global, { heldMicros: hold }, [{ sum: { freeMicros: 1, heldMicros: 1 }, max: globalCap - hold }], now)) {
      await io.add('counters', keys.day, negate({ [field]: 1 }), now)
      if (keys.address) await io.add('counters', keys.address, negate({ [field]: 1 }), now)
      continue
    }
    return { ok: true, route: 'allowance', feature, field, keys, holdMicros: hold, leftMicros: hold, used: false }
  }
  return refuse('used-up')
}

/**
 * Gives back what a finished request did not spend, and its use when nothing was recorded on it and
 * either it failed or it ran on the person's own connection (hold.ownServed, set by req.js on
 * resolveRequestConnection's chosen.own), which Slatebox did not pay for.
 */
export async function releaseAllowance(io, hold, { ok }, now) {
  const left = hold.leftMicros
  hold.leftMicros = 0
  if (left) await io.add('counters', hold.keys.global, { heldMicros: -left }, now)
  if (!hold.used && (!ok || hold.ownServed === true)) {
    await io.add('counters', hold.keys.day, { [hold.field]: -1 }, now)
    if (hold.keys.address) await io.add('counters', hold.keys.address, { [hold.field]: -1 }, now)
  }
}
