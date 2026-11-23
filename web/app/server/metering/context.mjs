// The running AI action: who pays, by which route, and how much this request has spent.
// Every paid AI path runs inside runAIAction. req.js refuses to send anything when the
// meter is on and no action is running, so a new code path cannot spend uncounted.
import { AsyncLocalStorage } from 'node:async_hooks'
import { ownKeyCovers } from './policy.mjs'

export const UNMETERED_MESSAGE = 'This AI request is not counted, so it was not sent.'
export const CEILING_MESSAGE = 'This request grew too large. Try a shorter brief.'

const storage = new AsyncLocalStorage()
let meter = null

// meter: { enabled(): boolean, begin(opts): Promise<action>, record(action, entry): Promise<{ costMicros }>,
//          finish(action, { ok }): Promise<void> }. The Meteor glue installs it at startup.
export function installMeter(implementation) {
  meter = implementation || null
}

export function meterOn() {
  return Boolean(meter?.enabled())
}

export function currentAIAction() {
  return storage.getStore() ?? null
}

// The longest a request's hold waits for work it started and did not wait for.
export const DETACHED_LIMIT_MS = 5 * 60_000

// Work a request starts without waiting for it (the conversation pipeline behind openai.chat,
// its timed rerun) keeps the request open: its hold stays set until that work ends.
export function keepActionOpen(promise) {
  const action = currentAIAction()
  if (!action || !action.pending) return promise
  const tracked = Promise.resolve(promise).then(() => {}, () => {})
  action.pending.add(tracked)
  tracked.then(() => action.pending.delete(tracked))
  return promise
}

async function detachedDone(action) {
  const deadline = Date.now() + DETACHED_LIMIT_MS
  while (action.pending.size && Date.now() < deadline) {
    let timer
    await Promise.race([Promise.all([...action.pending]), new Promise(resolve => { timer = setTimeout(resolve, deadline - Date.now()); timer.unref?.() })])
    clearTimeout(timer)
  }
}

// opts: { feature, estimateMicros?, kind? ('ai' | 'imageSearch' | 'imageGeneration'), countsAsDraft? }
export async function runAIAction(opts, fn) {
  if (!meterOn()) return fn(null)
  const running = currentAIAction()
  // A nested entry point (nativeCanvas.preview → workshops.draft) belongs to the outer action.
  if (running && !running.finished) return fn(running)
  const action = await meter.begin(opts)
  action.pending = new Set()
  let ok = false
  try {
    const result = await storage.run(action, () => fn(action))
    ok = true
    return result
  } finally {
    if (action.pending.size) {
      const outcome = ok
      detachedDone(action).then(() => meter.finish(action, { ok: outcome })).catch(error => console.error('AI meter could not close a request', error.message))
    } else {
      await meter.finish(action, { ok })
    }
  }
}

// Called by req.js before it resolves a key or builds a request. A request whose action has
// already ended is not counted, so it is refused too.
export function aiRequestGate() {
  if (!meterOn()) return null
  const action = currentAIAction()
  if (action && !action.finished) return null
  return { abort: true, abortMessage: UNMETERED_MESSAGE, fallbackBlocked: true, unmetered: true }
}

// Called by req.js after each AIAudit row that carries token usage: every retry, shape
// retry and fallback costs money. entry: { ref (AIAudit id), provider, model, usage }.
// An attempt that was sent but came back with no usage (a timeout, a dropped connection,
// a 5xx) is charged the feature's estimate: providers usually bill what they generated.
export async function chargeProviderCall(entry) {
  const action = currentAIAction()
  if (!meterOn() || !action) return { stop: false }
  if (action.finished) return { stop: true, abortMessage: UNMETERED_MESSAGE }
  const priced = entry.usage ? entry : { ...entry, costMicros: action.estimateMicros || 5000 }
  const { costMicros = 0 } = await meter.record(action, priced)
  action.spentMicros = (action.spentMicros || 0) + costMicros
  // An own key has no ceiling: the person pays their provider.
  if (action.route !== 'byok' && action.spentMicros >= action.ceilingMicros) {
    return { stop: true, abortMessage: CEILING_MESSAGE }
  }
  return { stop: false }
}

const FIXED_FEATURE = { imageSearch: 'image-search', imageGeneration: 'image-generation' }

// A use with a fixed price (an image search, a generated image).
// entry: { ref, kind: 'imageSearch' | 'imageGeneration', costMicros, model? }
// Slatebox's own Google and Stability keys pay for these, so inside a request paid by an own
// AI key they are counted as a separate use: the included amount (Pro credits), then the balance.
export async function chargeFixed(entry) {
  const action = currentAIAction()
  if (!meterOn()) return { charged: false }
  if (!action || action.finished) throw Object.assign(new Error(UNMETERED_MESSAGE), { error: 'unmetered' })
  if (action.route === 'byok' && !ownKeyCovers(entry.kind)) {
    const use = await meter.begin({ feature: FIXED_FEATURE[entry.kind] || action.feature, kind: entry.kind, userId: action.userId, estimateMicros: entry.costMicros, countsAsDraft: false })
    let ok = false
    try {
      await meter.record(use, entry)
      ok = true
    } finally {
      await meter.finish(use, { ok })
    }
    return { charged: true, route: use.route }
  }
  const { costMicros = 0 } = await meter.record(action, entry)
  action.spentMicros = (action.spentMicros || 0) + costMicros
  return { charged: true }
}

// The server chooses the model from the feature's configuration. What a browser asks for is ignored.
export function pinnedEngine(featureConfig) {
  return featureConfig?.engine
}
