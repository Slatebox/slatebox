// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Inbound webhooks: POST /hooks/recipes/:hookId runs a recipe with the data a developer's system
// sends (a CI job's dependency graph, a deploy, a form). The request is checked in this order, and
// the first failure answers:
//   404 no such hook (or recipes off)   401 bad or old signature (5 minutes)   413 over 256 KB
//   400 not JSON, or data that does not meet the recipe's inputSchema (details.pointer)
//   200 the same delivery again within an hour (the first run's id; nothing new runs)
//   429 more than 30 an hour for the instance (Retry-After)   409 the recipe is not on
//   202 { runId }: the run is queued with trigger { kind: 'inbound', input: data }
// Framework-free: routes.mjs passes the raw body and headers in and writes the answer out.
import { validate } from '/server/actions/schema.mjs'
import { createHash } from 'node:crypto'
import { DELIVERY_HEADER, SIGNATURE_HEADER, liveSecrets, parseSignature, verifySignature } from './sign.mjs'
import { isDuplicate } from '../store.mjs'

export const INBOUND_LIMITS = Object.freeze({ bodyBytes: 256 * 1024, perHour: 30, replayMs: 3600 * 1000, reasonChars: 200 })

const answer = (status, body, headers = {}) => ({ status, body, headers })
const header = (headers, name) => {
  const want = name.toLowerCase()
  for (const [key, value] of Object.entries(headers || {})) if (key.toLowerCase() === want) return Array.isArray(value) ? value[0] : value
  return undefined
}
/** A validator path (a.b[2].c) as a JSON pointer (/a/b/2/c). */
export const pointerOf = (path) => (path ? '/' + String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : '')

/**
 * deps: { store, clock, sealer: { open(hookId, sealed) }, manifestOf(recipeId), enqueue(instance, trigger), isOn(),
 *         hookAllowed(hook, instance) → boolean (authority.mjs) }
 */
export function createInbound({ store, clock = Date.now, sealer, manifestOf, enqueue, isOn = async () => true, limits = INBOUND_LIMITS, hookAllowed = async () => true }) {
  const { hooks, instances, runs, inbox } = store

  async function handle({ hookId, headers = {}, rawBody }) {
    if (!(await isOn())) return answer(404, { error: { code: 'not_found', message: 'There is no such hook.' } })
    if (typeof hookId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(hookId)) return answer(404, { error: { code: 'not_found', message: 'There is no such hook.' } })
    const hook = await hooks.findOne({ _id: hookId, direction: 'inbound' })
    if (!hook || hook.state !== 'active') return answer(404, { error: { code: 'not_found', message: 'There is no such hook.' } })
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''))
    if (body.length > limits.bodyBytes) return answer(413, { error: { code: 'too_large', message: 'The body is over 256 KB.' } })
    const now = clock()
    const secrets = liveSecrets(hook.secrets, now).map((s) => ({ plain: sealer.open(hook._id, s.sealed) })).filter((s) => s.plain)
    if (!verifySignature(header(headers, SIGNATURE_HEADER), secrets, body, now)) return answer(401, { error: { code: 'bad_signature', message: 'The Slatebox-Signature header does not sign this body, or its time is more than 5 minutes off.' } })
    let parsed
    try {
      parsed = JSON.parse(body.toString('utf8'))
    } catch {
      return answer(400, { error: { code: 'bad_payload', message: 'The body is not JSON.', details: { pointer: '' } } })
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return answer(400, { error: { code: 'bad_payload', message: 'The body is an object: { reason?, data }.', details: { pointer: '' } } })
    const extra = Object.keys(parsed).filter((key) => !['reason', 'data', 'id'].includes(key))
    if (extra.length) return answer(400, { error: { code: 'bad_payload', message: `The body holds no ${extra[0]}.`, details: { pointer: `/${extra[0]}` } } })
    const instance = await instances.findOne({ _id: hook.scope?.instanceId })
    // a hook whose person lost the right to add it feeds the recipe nothing (authority.mjs)
    if (!instance || !(await hookAllowed(hook, instance))) return answer(404, { error: { code: 'not_found', message: 'There is no such hook.' } })
    const manifest = manifestOf(instance.recipeId)
    if (!manifest?.inputSchema) return answer(400, { error: { code: 'bad_payload', message: 'This recipe takes no data.', details: { pointer: '/data' } } })
    const invalid = validate(manifest.inputSchema, parsed.data)
    if (invalid) return answer(400, { error: { code: 'bad_payload', message: invalid.message, details: { pointer: '/data' + pointerOf(invalid.path) } } })
    // Replays: the same delivery within an hour answers the first run, and runs nothing. The
    // Slatebox-Delivery header is not signed, so a captured request sent again with a new one is
    // caught by its signature instead (its time and body, which the signature covers).
    const deliveryId = String(header(headers, DELIVERY_HEADER) || parsed.id || '').slice(0, 128)
    const signedAt = parseSignature(header(headers, SIGNATURE_HEADER))?.t
    const keys = [
      `replay:${hook._id}:sig:${signedAt}:${createHash('sha256').update(body).digest('hex')}`,
      ...(deliveryId ? [`replay:${hook._id}:${deliveryId}`] : []),
    ]
    for (const key of keys) {
      const seen = await inbox.findOne({ _id: key })
      if (seen && now - new Date(seen.at).getTime() < limits.replayMs) return answer(200, { runId: seen.runId, duplicate: true })
    }
    if (instance.state !== 'active') return answer(409, { error: { code: 'recipe_not_on', message: 'This recipe is not on. Turn it on, then send again.' } })
    const lastHour = await runs.countDocuments({ instanceId: instance._id, 'trigger.kind': 'inbound', created: { $gt: new Date(now - 3600000) } })
    if (lastHour >= limits.perHour) return answer(429, { error: { code: 'rate_limited', message: `At most ${limits.perHour} calls an hour for one recipe.` } }, { 'Retry-After': '600' })
    for (const key of keys) {
      try {
        await inbox.insertOne({ _id: key, at: new Date(now), runId: null })
      } catch (error) {
        if (!isDuplicate(error)) throw error
        // an older key past its hour: take it over
        const taken = await inbox.updateOne({ _id: key, at: { $lt: new Date(now - limits.replayMs) } }, { $set: { at: new Date(now), runId: null } })
        if (!taken.modifiedCount) {
          const first = await inbox.findOne({ _id: key })
          return answer(200, { runId: first?.runId ?? null, duplicate: true })
        }
      }
    }
    const reason = typeof parsed.reason === 'string' ? parsed.reason.replace(/\s+/g, ' ').slice(0, limits.reasonChars) : null
    const run = await enqueue(instance, { kind: 'inbound', hookId: hook._id, deliveryId: deliveryId || null, ...(reason && { reason }), input: parsed.data })
    for (const key of keys) await inbox.updateOne({ _id: key }, { $set: { runId: run._id } })
    await hooks.updateOne({ _id: hook._id }, { $set: { lastDelivery: { at: new Date(now), status: 'received', code: 202 } } })
    return answer(202, { runId: run._id })
  }

  return { handle }
}
