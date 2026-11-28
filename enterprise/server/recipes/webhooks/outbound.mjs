// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Outbound webhooks: what a recipe did, sent to the addresses its owner (or a project manager)
// added, signed (sign.mjs), at least once.
//   emit(event)     one delivery per matching hook (the instance's own, and the project's), written
//                   at once; nothing is sent while the run waits
//   deliverDue()    the delivery worker: each due delivery is taken with a lease, POSTed through the
//                   same guarded fetch outside agents use (https, public addresses only, 10 s, a
//                   64 KB body), and marked delivered on a 2xx; otherwise tried again at 1 m, 5 m,
//                   30 m, 2 h, 6 h and 24 h, then dead. A hook that fails 8 times in a row is turned
//                   off and its owner told.
// Receivers dedupe on Slatebox-Delivery. A delivery body never holds a secret, a token or note text.
import { validate } from '/server/actions/schema.mjs'
import { ENVELOPE_LIMITS, envelope, eventSchema } from '../../../common/recipes/events.mjs'
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, liveSecrets, signatureHeader } from './sign.mjs'
import { docOf } from '../store.mjs'

export const DELIVERY_LIMITS = Object.freeze({
  timeoutMs: 10000, bodyBytes: ENVELOPE_LIMITS.bodyBytes, backoffMs: [60e3, 300e3, 1800e3, 7200e3, 21600e3, 86400e3],
  failuresToDisable: 8, leaseMs: 30000, batch: 25, hooksPerScope: 10,
})

export class EventRefused extends Error {
  constructor(message) {
    super(message)
    this.name = 'EventRefused'
    this.code = 'bad_event'
  }
}

/**
 * deps: { store, clock, fetch (createMcpFetch), sealer: { open(hookId, sealed) }, randomId, notify(ownerId, message), log }
 */
export function createOutbound({ store, clock = Date.now, fetch, sealer, randomId, notify = async () => {}, log = () => {}, limits = DELIVERY_LIMITS }) {
  const { hooks, deliveries } = store
  const newId = randomId || (() => Math.random().toString(36).slice(2, 14))

  /** The outbound hooks this event goes to. */
  async function hooksFor(instance, type) {
    const list = await hooks.find({
      direction: 'outbound', state: 'active',
      $or: [{ 'scope.instanceId': instance._id }, { 'scope.projectId': instance.projectId }],
    }, { limit: limits.hooksPerScope * 2 }).toArray()
    return list.filter((hook) => hook.events?.includes('*') || hook.events?.includes(type))
  }

  /**
   * Records an event for delivery. data is checked against the event's schema (common, or the
   * recipe's own events: ids, counts and short codes only). → the deliveries written.
   */
  async function emit({ type, instance, run = null, data = {}, manifest = null, hookId = null }) {
    const schema = eventSchema(type, manifest)
    if (!schema) throw new EventRefused(`The recipe does not send ${type}.`)
    const invalid = validate(schema, data)
    if (invalid) throw new EventRefused(`${type}: ${invalid.message}`)
    // a test ping goes to its one hook, whatever events it listens for
    const targets = hookId ? [await hooks.findOne({ _id: hookId, direction: 'outbound', state: 'active' })].filter(Boolean) : await hooksFor(instance, type)
    if (!targets.length) return []
    const eventId = `evt_${newId()}`
    let body = JSON.stringify(envelope({ id: eventId, type, at: clock(), instance, run, data }))
    if (Buffer.byteLength(body) > limits.bodyBytes) body = JSON.stringify(envelope({ id: eventId, type, at: clock(), instance, run, data: { truncated: true } }))
    const now = new Date(clock())
    const written = []
    for (const hook of targets) {
      const doc = { _id: `${eventId}.${hook._id}`, eventId, hookId: hook._id, ownerId: hook.ownerId, event: type, body, attempt: 0, nextAt: now, state: 'pending', responseCode: null, durationMs: null, leaseUntil: null, created: now }
      await deliveries.insertOne(doc)
      written.push(doc)
    }
    return written
  }

  async function take(now) {
    return docOf(await deliveries.findOneAndUpdate(
      { state: 'pending', nextAt: { $lte: new Date(now) }, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date(now) } }] },
      { $set: { leaseUntil: new Date(now + limits.leaseMs) } },
      { sort: { nextAt: 1 }, returnDocument: 'after' }
    ))
  }

  /** Sends one delivery now. → { ok, status } */
  async function deliver(delivery) {
    const hook = await hooks.findOne({ _id: delivery.hookId })
    const now = clock()
    if (!hook || hook.state !== 'active' || !hook.url) {
      await deliveries.updateOne({ _id: delivery._id }, { $set: { state: 'dead', leaseUntil: null, responseCode: null } })
      return { ok: false, status: null }
    }
    const secrets = liveSecrets(hook.secrets, now).map((s) => ({ plain: sealer.open(hook._id, s.sealed) })).filter((s) => s.plain)
    const started = clock()
    let status = null
    try {
      if (!secrets.length) throw Object.assign(new Error('no secret'), { code: 'no_secret' })
      const t = Math.floor(now / 1000)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), limits.timeoutMs)
      try {
        const response = await fetch(hook.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signatureHeader(secrets, delivery.body, t), [EVENT_HEADER]: delivery.event, [DELIVERY_HEADER]: delivery._id },
          body: delivery.body,
          signal: controller.signal,
        })
        status = response.status
        await response.body?.cancel?.().catch(() => {})
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      log('warn', 'delivery_error', error?.code || 'network')
    }
    const durationMs = Math.max(0, clock() - started)
    const ok = Number.isInteger(status) && status >= 200 && status < 300
    const attempt = (delivery.attempt || 0) + 1
    if (ok) {
      await deliveries.updateOne({ _id: delivery._id }, { $set: { state: 'delivered', attempt, responseCode: status, durationMs, leaseUntil: null, deliveredAt: new Date(clock()) } })
      await hooks.updateOne({ _id: hook._id }, { $set: { failures: 0, lastDelivery: { at: new Date(clock()), status: 'delivered', code: status } } })
      return { ok, status }
    }
    const delay = attempt <= limits.backoffMs.length ? limits.backoffMs[attempt - 1] : null
    await deliveries.updateOne({ _id: delivery._id }, {
      $set: delay === null
        ? { state: 'dead', attempt, responseCode: status, durationMs, leaseUntil: null }
        : { state: 'pending', attempt, responseCode: status, durationMs, leaseUntil: null, nextAt: new Date(clock() + delay) },
    })
    const after = docOf(await hooks.findOneAndUpdate({ _id: hook._id }, { $inc: { failures: 1 }, $set: { lastDelivery: { at: new Date(clock()), status: 'failed', code: status } } }, { returnDocument: 'after' }))
    if (after && after.failures >= limits.failuresToDisable && after.state === 'active') {
      await hooks.updateOne({ _id: hook._id }, { $set: { state: 'disabled', disabledAt: new Date(clock()), disabledReason: 'failures' } })
      await notify(hook.ownerId, { code: 'hook_disabled', hookId: hook._id, text: `A recipe webhook to ${hostOf(hook.url)} failed ${limits.failuresToDisable} times in a row and was turned off.` }).catch(() => {})
    }
    return { ok, status }
  }

  /** The delivery worker's pass: up to `batch` due deliveries. → how many were tried. */
  async function deliverDue() {
    let tried = 0
    for (; tried < limits.batch; tried += 1) {
      const delivery = await take(clock())
      if (!delivery) break
      await deliver(delivery)
    }
    return tried
  }

  return { emit, deliver, deliverDue, hooksFor }
}

export const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return 'an address'
  }
}
