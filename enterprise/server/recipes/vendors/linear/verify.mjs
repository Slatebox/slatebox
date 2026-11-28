// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Linear's webhook signature (https://linear.app/developers/webhooks): Linear-Signature is the hex
// HMAC-SHA256 of the exact raw body under the OAuth app's webhook signing secret, and the body's
// webhookTimestamp (milliseconds) must be within a minute of now, so a captured delivery cannot be
// replayed. Compared in constant time; a missing or malformed header is refused. express.json skips
// /integrations/linear/events (web/app/server/raw-body-paths.mjs) so the bytes are Linear's own.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const LINEAR_VERIFY_LIMITS = Object.freeze({ maxBytes: 1024 * 1024, skewMs: 60 * 1000 })

/** The header Linear sends for a body (what a test, or Linear, signs with). */
export const linearSignature = (secret, raw) => createHmac('sha256', String(secret)).update(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))).digest('hex')

/** Whether these bytes carry Linear's signature. */
export function verifyLinearSignature({ secret, signature, raw }) {
  if (typeof secret !== 'string' || secret.length < 8 || !raw) return false
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false
  const expected = Buffer.from(linearSignature(secret, raw), 'hex')
  const given = Buffer.from(signature, 'hex')
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Whether a delivery's own timestamp is within a minute of now (replays are refused). */
export const freshDelivery = (body, now = Date.now()) => Number.isFinite(Number(body?.webhookTimestamp)) && Math.abs(now - Number(body.webhookTimestamp)) <= LINEAR_VERIFY_LIMITS.skewMs

const header = (req, name) => (typeof req.get === 'function' ? req.get(name) : req.headers?.[name.toLowerCase()]) || null

/** The delivery headers of a request. */
export const linearHeaders = (req) => ({
  event: header(req, 'linear-event'),
  delivery: header(req, 'linear-delivery'),
  signature: header(req, 'linear-signature'),
})
