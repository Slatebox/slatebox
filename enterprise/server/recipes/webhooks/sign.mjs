// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Webhook signatures, both ways:
//   Slatebox-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>[,v1=<older secret's>]
// After a rotation the old secret keeps signing (a second v1) for 24 hours, so a receiver can
// switch at its own pace. A verifier accepts any v1 from any live secret, within 5 minutes of t,
// compared in constant time.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER = 'Slatebox-Signature'
export const EVENT_HEADER = 'Slatebox-Event'
export const DELIVERY_HEADER = 'Slatebox-Delivery'
export const TOLERANCE_S = 300
export const ROTATION_OVERLAP_MS = 24 * 3600 * 1000

/** A new secret: whsec_ and 32 random bytes. Shown once. */
export const newSecret = (random = randomBytes) => `whsec_${random(32).toString('base64url')}`

const hmac = (secret, t, body) => createHmac('sha256', secret).update(`${t}.`).update(typeof body === 'string' ? body : Buffer.from(body)).digest('hex')

/**
 * The header for a body. secrets: [{ plain }], newest first (the live ones only).
 * t: unix seconds.
 */
export function signatureHeader(secrets, body, t) {
  if (!secrets?.length) throw new Error('A hook needs a secret to sign with.')
  return [`t=${t}`, ...secrets.map((s) => `v1=${hmac(s.plain, t, body)}`)].join(',')
}

export function parseSignature(header) {
  if (typeof header !== 'string' || header.length > 2000) return null
  let t = null
  const v1 = []
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=')
    if (key === 't' && /^\d{1,12}$/.test(value || '')) t = Number(value)
    else if (key === 'v1' && /^[a-f0-9]{64}$/.test(value || '')) v1.push(value)
  }
  return t === null || !v1.length ? null : { t, v1 }
}

/**
 * Whether a header signs this body with one of the secrets ([{ plain }]) within the tolerance.
 * now: milliseconds.
 */
export function verifySignature(header, secrets, body, now, { toleranceS = TOLERANCE_S } = {}) {
  const parsed = parseSignature(header)
  if (!parsed) return false
  if (Math.abs(Math.floor(now / 1000) - parsed.t) > toleranceS) return false
  for (const secret of secrets || []) {
    const expected = Buffer.from(hmac(secret.plain, parsed.t, body), 'hex')
    for (const given of parsed.v1) {
      const candidate = Buffer.from(given, 'hex')
      if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true
    }
  }
  return false
}

/** The secrets still signing at `now` (a retired one stops after its overlap), newest first. */
export const liveSecrets = (secrets, now) =>
  [...(secrets || [])].filter((s) => !s.retiresAt || new Date(s.retiresAt).getTime() > now).sort((a, b) => new Date(b.created) - new Date(a.created))
