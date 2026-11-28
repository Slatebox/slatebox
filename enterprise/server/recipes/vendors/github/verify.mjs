// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// GitHub's webhook signature: X-Hub-Signature-256: sha256=<hex HMAC-SHA256(webhook secret, raw body)>,
// over the exact bytes GitHub sent (express.json must skip /integrations/github/: raw-body-paths.mjs).
// Compared in constant time; a missing, short or malformed header is refused. The body is read here,
// capped at 25 MB (GitHub's own cap on a delivery).
import { createHmac, timingSafeEqual } from 'node:crypto'

export const GITHUB_VERIFY_LIMITS = Object.freeze({ maxBytes: 25 * 1024 * 1024 })

/** The header GitHub sends for a body (what a test, or GitHub, signs with). */
export const githubSignature = (secret, raw) =>
  'sha256=' + createHmac('sha256', String(secret)).update(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))).digest('hex')

/** Whether a delivery is GitHub's: the right signature over this exact body. */
export function verifyGithubSignature({ secret, signature, raw }) {
  if (typeof secret !== 'string' || secret.length < 8) return false
  if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false
  const expected = Buffer.from(githubSignature(secret, raw))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** The request's raw body, at most maxBytes. A body already read as bytes or text is used as it is. */
export async function readRawBody(req, maxBytes = GITHUB_VERIFY_LIMITS.maxBytes) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody
  if (Buffer.isBuffer(req.body)) return req.body
  if (typeof req.body === 'string') return Buffer.from(req.body)
  // A body express.json already parsed cannot be checked (its bytes are gone): refused as unsigned.
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return null
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

/** The delivery headers of a request. */
export const githubHeaders = (req) => ({
  event: header(req, 'x-github-event'),
  delivery: header(req, 'x-github-delivery'),
  signature: header(req, 'x-hub-signature-256'),
})
