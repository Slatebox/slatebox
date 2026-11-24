// The circuit breaker for valid but bad configuration (spec 2.4). Validation catches broken
// references, not a working host that keeps failing. Per pod and per surface, it watches the last
// `window` requests served by a published binding's model chain (two entries or more: a one-entry
// binding is a choice and is never moved, resolve.mjs choiceLike). When more than half of them
// failed with an infrastructure or shape failure (at least `minCalls` seen), and the failures came
// from at least `minUsers` different people (so one person cannot trip it for everyone with
// prompts that break the answer's shape, or huge inputs that time out), it opens for `coolMs`
// (10 minutes) with a health entry and the Overview's one-click rollback. What an open breaker does
// is the binding's (resolve.mjs tripRule): 'fallback' serves the surface from the settings file
// and the built-in AI on this pod; 'report' keeps the chain. It never applies to a surface an
// administrator turned off (req.js checks that first).
//
// Pure apart from the clock; req.js records into the one instance below and asks it before each
// request, ai-control/index.mjs shows its entries with the snapshot's health.

export const BREAKER_WINDOW = 50
export const BREAKER_MIN_CALLS = 10
export const BREAKER_RATIO = 0.5
export const BREAKER_MIN_USERS = 3
export const BREAKER_COOL_MS = 10 * 60 * 1000
const COUNTED = new Set(['infra', 'shape'])

export function createBreaker({ window = BREAKER_WINDOW, minCalls = BREAKER_MIN_CALLS, ratio = BREAKER_RATIO, minUsers = BREAKER_MIN_USERS, coolMs = BREAKER_COOL_MS, now = Date.now, log = console } = {}) {
  const seen = new Map() // surface -> { outcomes: [{ failed, who }], bindingVersion }
  const open = new Map() // surface -> { until, since, bindingVersion, failed, calls }

  function state(surface) {
    const entry = open.get(surface)
    if (!entry) return null
    if (now() >= entry.until) {
      open.delete(surface)
      return null
    }
    return entry
  }

  return {
    /**
     * One request a published binding's chain served. failure: null (answered) or its class
     * (infra, shape, context, other); only infra and shape count against the binding. userId: who
     * it was for; onTrip: what an open breaker does for this binding ('fallback' or 'report').
     */
    record(surface, { failure = null, bindingVersion = null, userId = null, onTrip = 'report' } = {}) {
      if (!surface || state(surface)) return
      const row = seen.get(surface) || { outcomes: [], bindingVersion }
      // a new published version starts with a clean record
      if (row.bindingVersion !== bindingVersion) {
        row.outcomes = []
        row.bindingVersion = bindingVersion
      }
      row.outcomes.push({ failed: COUNTED.has(failure), who: userId ?? 'anonymous' })
      if (row.outcomes.length > window) row.outcomes.shift()
      seen.set(surface, row)
      const failures = row.outcomes.filter((o) => o.failed)
      const people = new Set(failures.map((o) => o.who)).size
      if (row.outcomes.length >= minCalls && failures.length / row.outcomes.length > ratio && people >= minUsers) {
        const at = now()
        const action = onTrip === 'fallback' ? 'fallback' : 'report'
        open.set(surface, { surface, since: at, until: at + coolMs, bindingVersion, failed: failures.length, calls: row.outcomes.length, people, onTrip: action })
        seen.delete(surface)
        log.warn?.(`ai-control: ${surface} failed ${failures.length} of ${row.outcomes.length} calls for ${people} people on ${bindingVersion}; ${action === 'fallback' ? `using the settings file and built-in AI on this pod for ${Math.round(coolMs / 60000)} minutes` : 'its chain stays in use (the binding does not fall back)'}`)
      }
    },
    /** Whether the surface is served from the settings file and code on this pod now: the entry, or null. */
    isOpen: (surface) => state(surface),
    /** Health entries for every open breaker. */
    health() {
      const out = []
      for (const surface of [...open.keys()]) {
        const entry = state(surface)
        if (!entry) continue
        const until = new Date(entry.until).toISOString().slice(11, 16)
        const doing = entry.onTrip === 'fallback'
          ? `using the settings file and built-in AI on this server until ${until} UTC`
          : 'it keeps using its own models, as the binding says'
        out.push({ kind: 'breaker', id: surface, bindingVersion: entry.bindingVersion, onTrip: entry.onTrip, until: new Date(entry.until).toISOString(), problem: `Its model failed ${entry.failed} of the last ${entry.calls} calls: ${doing}. Roll back the binding or fix its connection.` })
      }
      return out
    },
    /** Closes a surface's breaker (a new publish or rollback), or all of them. */
    reset(surface = null) {
      if (surface) {
        open.delete(surface)
        seen.delete(surface)
      } else {
        open.clear()
        seen.clear()
      }
    },
  }
}

/**
 * A resolved binding as the request path takes it, with this pod's breaker applied (used by
 * ai-control/index.mjs): a new version (published on any pod) closes the surface's breaker; only a
 * chain of two or more whose binding falls back on a trip (resolve.mjs tripRule) leaves its chain
 * while the breaker is open (tripped). A one-entry binding is a choice and never trips.
 */
export function applyBreaker(binding, breaker) {
  const open = breaker.isOpen(binding.surface)
  if (open && open.bindingVersion !== binding.bindingVersion) breaker.reset(binding.surface)
  const tripped = Boolean(binding.chainFromBinding && !binding.choiceLike && binding.onTrip === 'fallback' && breaker.isOpen(binding.surface))
  return { ...binding, tripped }
}

/** The one breaker of this pod. */
export const requestBreaker = createBreaker()
