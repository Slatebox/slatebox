// The meter of a voice session, as calls.mjs meters a call: a 60-second tick. On Slatebox Cloud each
// minute of a session is one meter action (meter-core.mjs): it is held before the minute starts
// (the voice part's estimate, at most its ceiling), every usage report the provider sends in that
// minute (Gemini's usageMetadata, OpenAI's response.done) is recorded at the voice model's audio
// and text prices (metering/prices.mjs voicePrice), and the hold is released when the minute ends.
// A minute that cannot be held (no Pro credits or balance left: policy.mjs never pays voice from a
// free amount), or one that spends past its ceiling, closes the session with closing { reason: 'cap' }.
// A session on the person's or team's own key, and every session on a server with no meter
// (self-host), is never charged.
//
// The tick also ends a session at its time limit and after a stretch with nobody speaking, and a
// minute before either it says so (warn: the browser shows and announces it). Pure apart from the
// injected meter.
import { voiceCostMicros } from '../metering/prices.mjs'

const MIN = 60_000

// What a session may last, how many one server holds and how many one person may have open at
// once (settings.voice overrides each).
export const VOICE_LIMITS = Object.freeze({ maxMinutes: 30, idleMinutes: 5, perPod: 50, perPerson: 2, warnMinutes: 1 })

/** The limits in use: VOICE_LIMITS with the operator's settings.voice, each a sane whole number. */
export function voiceLimits(settings = {}) {
  const given = settings?.voice || {}
  const pick = (key, min, max) => (Number.isInteger(given[key]) && given[key] >= min && given[key] <= max ? given[key] : VOICE_LIMITS[key])
  return Object.freeze({
    maxMinutes: pick('maxMinutes', 1, 240), idleMinutes: pick('idleMinutes', 1, 60), perPod: pick('perPod', 1, 1000), perPerson: pick('perPerson', 1, 10),
    warnMinutes: VOICE_LIMITS.warnMinutes,
  })
}

/**
 * One tick of an open session. session: { startedAt, lastActivityAt, lastTickAt, tickIndex }.
 * → { decision: 'continue' | 'end', reason?: 'limit' | 'idle', warn?: 'limit' | 'idle', set }:
 * warn when the next tick would end it (the time limit first).
 */
export function voiceTick({ session, now, limits = VOICE_LIMITS }) {
  const set = { lastTickAt: now, tickIndex: (session.tickIndex || 0) + 1 }
  const elapsed = now - session.startedAt
  const quiet = now - (session.lastActivityAt ?? session.startedAt)
  if (elapsed >= limits.maxMinutes * MIN) return { decision: 'end', reason: 'limit', set }
  if (quiet >= limits.idleMinutes * MIN) return { decision: 'end', reason: 'idle', set }
  const warnAt = (limits.warnMinutes ?? VOICE_LIMITS.warnMinutes) * MIN
  if (limits.maxMinutes * MIN - elapsed <= warnAt) return { decision: 'continue', warn: 'limit', set }
  if (limits.idleMinutes * MIN - quiet <= warnAt) return { decision: 'continue', warn: 'idle', set }
  return { decision: 'continue', set }
}

const tokens = (usage) => ['audioIn', 'audioOut', 'textIn', 'textOut', 'cachedAudioIn'].reduce((n, key) => n + (Number(usage?.[key]) || 0), 0)

/**
 * deps: {
 *   meter: meter-core's { enabled(), begin(opts), record(action, entry), finish(action, { ok }) },
 *   metered: whether this session is charged (the meter is on and the session is not on an own key),
 *   userId, feature (the voice part's meter feature), sessionId, model, price (prices.mjs voicePrice)
 * }
 * Every call is serialized: a usage report that arrives during a tick is recorded on the minute it
 * belongs to. → { start, usage, tick, end, spentMicros() }; start, usage and tick answer
 * { ok: true } or { ok: false, code, message }.
 */
export function createVoiceMeter({ meter, metered, userId, feature, sessionId, model, price }) {
  let action = null
  let minuteMicros = 0
  let spent = 0
  let seq = 0
  let chain = Promise.resolve()
  const serial = (fn) => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => {})
    return next
  }
  const refused = (error) => ({ ok: false, code: error?.error || error?.code || 'cap', message: error?.reason || error?.message || 'This voice session cannot go on.' })

  async function hold() {
    try {
      action = await meter.begin({ feature, kind: 'ai', userId, countsAsDraft: false })
      minuteMicros = 0
      return { ok: true }
    } catch (error) {
      action = null
      return refused(error)
    }
  }

  return {
    metered: Boolean(metered),
    spentMicros: () => spent,
    start: () => serial(async () => (metered ? hold() : { ok: true })),
    usage: (usage) => serial(async () => {
      const costMicros = voiceCostMicros(usage, price)
      if (!metered) return { ok: true, costMicros: 0 }
      if (!action) return { ok: false, code: 'cap', message: 'This voice session has no credits held.' }
      seq += 1
      const out = await meter.record(action, { ref: `voice:${sessionId}:${seq}`, model, costMicros, usage: { totalTokens: tokens(usage) } })
      spent += out?.costMicros ?? costMicros
      minuteMicros += costMicros
      if (minuteMicros > action.ceilingMicros) return { ok: false, code: 'cap', message: 'This voice session reached the most one minute may spend.', costMicros }
      return { ok: true, costMicros }
    }),
    tick: () => serial(async () => {
      if (!metered) return { ok: true }
      if (action) await meter.finish(action, { ok: true })
      action = null
      return hold()
    }),
    end: () => serial(async () => {
      if (action) await meter.finish(action, { ok: true })
      action = null
      return { ok: true }
    }),
  }
}
