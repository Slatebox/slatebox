// Method and login timing (settings.metrics.methodTiming): how long each Meteor method, login and
// publication took on this server, summed up per 5-minute window into ONE compact log line:
//
//   [method-timing] {"at":"2026-11-27T01:05:00.000Z","s":300,"rate":1,"m":{"login":[12,8,41,0],"sub:joinedSlates.rows":[3,22,30,0]}}
//
// Each entry is [calls, p50 ms, p95 ms, errors]. A publication is `sub:<name>` and its time is until it
// was ready. A method called from inside another method or publication on this server (Meteor.callAsync)
// is `call:<name>`: it skips the write-fence wait and its time is already inside its caller's, so it is
// kept apart from the client's calls of the same name. A server call made outside any method or
// publication (a route, a timer) has no caller to tell it apart and counts under the method's own name. Only names and durations are kept: never arguments, results, user ids or addresses.
// No line is written for a window with no calls. Plain Node, no Meteor (server/metrics/meteor.js wires it).

export const WINDOW_MS = 5 * 60 * 1000
// Durations kept per name per window. Past this a uniform reservoir keeps the percentiles honest.
export const SAMPLES_PER_NAME = 1000
// Names per window: everything past this is counted under `other` (names come from the server's own
// method and publication registry, so this only bounds memory).
export const MAX_NAMES = 300
const NAME = /^[\w.:/-]{1,100}$/

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted, p) {
  if (!sorted.length) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

/** A number in [0, 1]; anything else means every call (1). */
export function sampleRateOf(value) {
  const rate = Number(value)
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1
}

/** settings.metrics → { on, sampleRate }. Off unless methodTiming is exactly true. */
export function timingSettings(settings) {
  const metrics = settings?.metrics
  return { on: metrics?.methodTiming === true, sampleRate: sampleRateOf(metrics?.sampleRate ?? 1) }
}

export function createMethodTiming({
  windowMs = WINDOW_MS,
  sampleRate = 1,
  random = Math.random,
  now = Date.now,
  log = line => console.log(line),
} = {}) {
  const rate = sampleRateOf(sampleRate)
  let rows = new Map()
  let windowStart = now()
  let timer = null

  function rowFor(name) {
    const key = typeof name === 'string' && NAME.test(name) ? name : 'other'
    let row = rows.get(key)
    if (!row) {
      if (rows.size >= MAX_NAMES) return rowFor('other')
      row = { calls: 0, errors: 0, seen: 0, samples: [] }
      rows.set(key, row)
    }
    return row
  }

  /** One finished call: kind 'method', 'call' (nested server call) or 'publication', its name, how long it took and whether it failed. */
  function record(kind, name, durationMs, failed = false) {
    if (rate < 1 && !(random() < rate)) return
    const ms = Number(durationMs)
    if (!Number.isFinite(ms) || ms < 0) return
    const row = rowFor(kind === 'publication' ? `sub:${name}` : kind === 'call' ? `call:${name}` : name)
    row.calls += 1
    if (failed) row.errors += 1
    row.seen += 1
    if (row.samples.length < SAMPLES_PER_NAME) row.samples.push(ms)
    else {
      const slot = Math.floor(random() * row.seen)
      if (slot < SAMPLES_PER_NAME) row.samples[slot] = ms
    }
  }

  /** The window's summary ({ at, s, rate, m }), or null with no calls. Starts the next window. */
  function summary() {
    const ended = rows
    const startedAt = windowStart
    rows = new Map()
    windowStart = now()
    if (!ended.size) return null
    const m = {}
    for (const [name, row] of [...ended].sort((a, b) => b[1].calls - a[1].calls || (a[0] < b[0] ? -1 : 1))) {
      const sorted = row.samples.sort((a, b) => a - b)
      m[name] = [row.calls, Math.round(percentile(sorted, 50)), Math.round(percentile(sorted, 95)), row.errors]
    }
    return { at: new Date(startedAt).toISOString(), s: Math.round((windowStart - startedAt) / 1000), rate, m }
  }

  function flush() {
    const line = summary()
    if (line) log(`[method-timing] ${JSON.stringify(line)}`)
    return line
  }

  function start() {
    if (timer) return
    windowStart = now()
    timer = setInterval(flush, windowMs)
    timer.unref?.()
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { record, summary, flush, start, stop }
}
