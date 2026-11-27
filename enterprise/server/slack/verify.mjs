// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Everything Slack calls is checked before it is read: Slack signs each request with the app's
// signing secret (v0=HMAC-SHA256(secret, "v0:<timestamp>:<raw body>"), X-Slack-Signature), and a
// timestamp more than five minutes from now is refused, so a recorded request cannot be replayed.
// The raw body is read here (express.json skips /integrations/slack/: web/app/server/raw-body-paths.mjs),
// capped at 256 KiB. What Slatebox puts in a modal's private_metadata is signed the same way, so a
// modal's answer names only a message Slatebox itself put there.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const VERIFY_LIMITS = Object.freeze({ skewSeconds: 300, maxBytes: 256 * 1024 })

const same = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Slack's signature for a body at a timestamp (what a test, or Slack, sends). */
export const signatureOf = (signingSecret, timestamp, raw) =>
  'v0=' + createHmac('sha256', signingSecret).update(`v0:${timestamp}:${Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)}`).digest('hex')

/** Whether this request is Slack's: the right signature over this exact body, signed in the last five minutes. */
export function verifySlackRequest({ signingSecret, timestamp, signature, raw, now = Date.now() }) {
  if (typeof signingSecret !== 'string' || !signingSecret) return false
  if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp)) return false
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > VERIFY_LIMITS.skewSeconds) return false
  if (typeof signature !== 'string' || !/^v0=[0-9a-f]{64}$/.test(signature)) return false
  return same(signatureOf(signingSecret, timestamp, raw), signature)
}

/** The request's raw body (at most maxBytes; more is refused). Already-read bodies (a Buffer or string) are used as they are. */
export async function readRaw(req, maxBytes = VERIFY_LIMITS.maxBytes) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody
  if (Buffer.isBuffer(req.body)) return req.body
  if (typeof req.body === 'string') return Buffer.from(req.body)
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw Object.assign(new Error('too large'), { code: 'too_large' })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const header = (req, name) => (typeof req.get === 'function' ? req.get(name) : req.headers?.[name.toLowerCase()]) || null

/** The signature headers of a request. */
export const slackHeaders = (req) => ({ timestamp: header(req, 'x-slack-request-timestamp'), signature: header(req, 'x-slack-signature'), retry: header(req, 'x-slack-retry-num') })

/** A short value signed with the app's secret, for a modal's private_metadata (never message text). */
export function signMetadata(secret, value) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url')
  const mac = createHmac('sha256', String(secret)).update('slatebox-metadata:' + body).digest('base64url')
  return `${body}.${mac}`
}

/** The value signMetadata signed, or null when it was changed or signed with another secret. */
export function openMetadata(secret, text) {
  if (typeof text !== 'string' || text.length > 3000 || !secret) return null
  const [body, mac] = text.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', String(secret)).update('slatebox-metadata:' + body).digest('base64url')
  if (!same(expected, mac)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
