// The circuit breaker for valid but bad configuration (spec 2.4). Validation catches broken
// references, not a working host that keeps failing. Per pod and per surface, it watches the last
// `window` requests served by a published binding's model chain: when more than half of them failed
// with an infrastructure or shape failure (at least `minCalls` seen), the surface is served from the
// settings file and built-in defaults on this pod for `coolMs` (10 minutes), and a health entry says
// so. It never applies to a surface an administrator turned off (req.js checks that first).
//
// Pure apart from the clock; req.js records into the one instance below and asks it before each
// request, ai-control/index.mjs shows its entries with the snapshot's health.

export const BREAKER_WINDOW = 50
export const BREAKER_MIN_CALLS = 10
export const BREAKER_RATIO = 0.5
export const BREAKER_COOL_MS = 10 * 60 * 1000
const COUNTED = new Set(['infra', 'shape'])

export function createBreaker({ window = BREAKER_WINDOW, minCalls = BREAKER_MIN_CALLS, ratio = BREAKER_RATIO, coolMs = BREAKER_COOL_MS, now = Date.now, log = console } = {}) {
  const seen = new Map() // surface -> { outcomes: [boolean failed], bindingVersion }
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
     * (infra, shape, context, other); only infra and shape count against the binding.
     */
    record(surface, { failure = null, bindingVersion = null } = {}) {
      if (!surface || state(surface)) return
      const row = seen.get(surface) || { outcomes: [], bindingVersion }
      // a new published version starts with a clean record
      if (row.bindingVersion !== bindingVersion) {
        row.outcomes = []
        row.bindingVersion = bindingVersion
      }
      row.outcomes.push(COUNTED.has(failure))
      if (row.outcomes.length > window) row.outcomes.shift()
      seen.set(surface, row)
      const failed = row.outcomes.filter(Boolean).length
      if (row.outcomes.length >= minCalls && failed / row.outcomes.length > ratio) {
        const at = now()
        open.set(surface, { surface, since: at, until: at + coolMs, bindingVersion, failed, calls: row.outcomes.length })
        seen.delete(surface)
        log.warn?.(`ai-control: ${surface} failed ${failed} of ${row.outcomes.length} calls on ${bindingVersion}; using the settings file and built-in AI on this pod for ${Math.round(coolMs / 60000)} minutes`)
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
        out.push({ kind: 'breaker', id: surface, bindingVersion: entry.bindingVersion, until: new Date(entry.until).toISOString(), problem: `Its model failed ${entry.failed} of the last ${entry.calls} calls: using the settings file and built-in AI on this server until ${until} UTC. Roll back the binding or fix its connection.` })
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

/** The one breaker of this pod. */
export const requestBreaker = createBreaker()
