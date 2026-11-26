// Whether this server may run the code in the repository's enterprise/ directory (enterprise/LICENSE).
// MIT, and runs without Meteor (scripts/enterprise-license.test.mjs).
//
// - Slatebox Cloud runs it: Slatebox LLC's own service. Saying so in settings is not enough:
//   settings.public.edition 'cloud' unlocks only with a Cloud key (kind 'cloud', bound to Cloud's
//   host names) signed like any license, so no settings change alone unlocks a self-hosted install.
// - A self-hosted install carries the same code, locked. A license key from Slatebox LLC unlocks it
//   (an on-prem license: a flat yearly fee per install). The key is checked offline: it is signed
//   with Slatebox LLC's private Ed25519 key, and this file holds only the public half, so no one
//   else can make a key that passes. Nothing is sent anywhere to check it.
// - Single sign-on with the bundled Keycloak is not enterprise code: it stays free on every install.
//
// A license key is one line:
//   sblic1.<key id>.<payload, base64url JSON>.<Ed25519 signature of "sblic1.<key id>.<payload>", base64url>
// payload: { v: 1, product: 'slatebox-enterprise', id, licensee, kind: 'on-prem'|'cloud', issuedAt, expiresAt,
//            hosts?: ['slatebox.example.com'] }   (dates as YYYY-MM-DD, UTC; hosts binds it to installs,
//            and a Cloud key must name them)
//
// Where an install puts it (the first one found wins):
//   settings.enterprise.license        the key itself (private settings, never sent to browsers)
//   SLATEBOX_LICENSE                    the key itself, as an environment variable
//   settings.enterprise.licenseFile     a file holding the key
//   SLATEBOX_LICENSE_FILE               a file holding the key, as an environment variable
//   the key an administrator entered     kept in this server's database (server/enterprise-key.mjs):
//                                       the header button › Unlock (a trial key from Slatebox
//                                       Cloud, or a license key pasted in). Checked exactly like the
//                                       others, so a database row unlocks nothing Slatebox did not sign.
import { createPublicKey, verify as verifySignature } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const LICENSE_FORMAT = 'sblic1'
export const LICENSE_PRODUCT = 'slatebox-enterprise'
// After its end date a key keeps working this long, so a renewal is never an outage.
export const LICENSE_GRACE_DAYS = 14
const DAY = 86_400_000

// Slatebox LLC's license signing keys: the public halves only. The private halves are kept by
// Slatebox LLC and are never in this repository. A new key is added here, never swapped in, so keys
// already issued keep working until they end.
export const LICENSE_KEYS = Object.freeze({
  'slatebox-2026-11': 'MCowBQYDK2VwAyEATlrvAVQ/GDyVB5uHYwOwp3P8w9TytrSsyHt8u7rnMMU=',
})

// What an administrator reads for each state (the admin page and the server log).
export const LICENSE_WORDS = Object.freeze({
  cloud: 'Slatebox Cloud: enterprise features are on.',
  cloud_no_key: 'These settings say Slatebox Cloud, but there is no Slatebox Cloud key: enterprise features are off.',
  wrong_kind: 'The license key is for another kind of install (Slatebox Cloud or on-prem).',
  license: 'Enterprise features are on with this install\'s license.',
  grace: 'This install\'s license has ended. Enterprise features stay on for a few more days: renew to keep them.',
  no_license: 'Enterprise features are off on this install. An on-prem license from Slatebox turns them on.',
  malformed: 'The license key could not be read. Check that it was copied in full.',
  unknown_key: 'The license key was not issued by Slatebox.',
  bad_signature: 'The license key was not issued by Slatebox, or it was changed.',
  wrong_product: 'The license key is not for Slatebox enterprise features.',
  not_yet: 'The license key is not valid yet.',
  expired: 'This install\'s license has ended. Renew it to unlock enterprise features again.',
  wrong_host: 'The license key is for another install.',
  unreadable_file: 'The license file could not be read.',
})

const b64url = (text) => Buffer.from(text, 'base64url')
const day = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value + 'T00:00:00Z') : NaN)
const keyObject = (spki) => createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' })

/** The parts of a license key, or null when it is not one. */
export function parseLicense(text) {
  if (typeof text !== 'string') return null
  const parts = text.trim().split('.')
  if (parts.length !== 4 || parts[0] !== LICENSE_FORMAT || !/^[\w-]{1,64}$/.test(parts[1])) return null
  if (!/^[\w-]+$/.test(parts[2]) || !/^[\w-]+$/.test(parts[3])) return null
  let payload
  try {
    payload = JSON.parse(b64url(parts[2]).toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  return { kid: parts[1], payload, signed: parts.slice(0, 3).join('.'), signature: b64url(parts[3]) }
}

/** What a license says, safe to show an administrator (never the key itself). */
export const licenseSummary = (payload) => ({
  // A free trial Slatebox Cloud issued (server/licenses/issuer.mjs); a bought license says nothing.
  ...(payload.trial === true && { trial: true }),
  id: String(payload.id || ''),
  licensee: String(payload.licensee || ''),
  kind: String(payload.kind || 'on-prem'),
  issuedAt: payload.issuedAt || null,
  expiresAt: payload.expiresAt || null,
  hosts: Array.isArray(payload.hosts) ? payload.hosts.map(String) : [],
})

export const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * This install's host name, worked out one way everywhere a key is checked, kept or asked for
 * (enterpriseAccess, enterprise-key.mjs save, the trial request): settings.public.baseUrl, else
 * ROOT_URL (what Meteor.absoluteUrl() answers from). '' when neither says.
 */
export const installHost = ({ settings, env = {} } = {}) => hostOf(settings?.public?.baseUrl || env?.ROOT_URL || '')

/**
 * Checks a license key offline.
 * @param {string} text  the key
 * @param {{ keys?: Record<string, string>, now?: number, host?: string }} [options]
 *   keys: key id -> Ed25519 public key (SPKI DER, base64); Slatebox LLC's by default.
 *   host: this install's host name (installHost), checked when the key names hosts.
 * @returns {{ valid: boolean, reason: string, license?: ReturnType<typeof licenseSummary>, endsAt?: number }}
 */
export function verifyLicense(text, { keys = LICENSE_KEYS, now = Date.now(), host = '' } = {}) {
  const parsed = parseLicense(text)
  if (!parsed) return { valid: false, reason: 'malformed' }
  const spki = Object.hasOwn(keys, parsed.kid) ? keys[parsed.kid] : null
  if (!spki) return { valid: false, reason: 'unknown_key' }
  let good = false
  try {
    good = verifySignature(null, Buffer.from(parsed.signed, 'utf8'), keyObject(spki), parsed.signature)
  } catch {
    good = false
  }
  if (!good) return { valid: false, reason: 'bad_signature' }
  const { payload } = parsed
  if (payload.v !== 1 || payload.product !== LICENSE_PRODUCT) return { valid: false, reason: 'wrong_product' }
  const license = licenseSummary(payload)
  const from = day(payload.issuedAt)
  const to = day(payload.expiresAt)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { valid: false, reason: 'malformed' }
  if (now < from) return { valid: false, reason: 'not_yet', license }
  if (license.kind !== 'on-prem' && license.kind !== 'cloud') return { valid: false, reason: 'wrong_kind', license }
  // A Cloud key works only on Cloud's own host names.
  if (license.kind === 'cloud' && !license.hosts.length) return { valid: false, reason: 'wrong_kind', license }
  if (license.hosts.length && !license.hosts.some((name) => name.toLowerCase() === String(host).toLowerCase()))
    return { valid: false, reason: 'wrong_host', license }
  // The key covers its last day in full, then the grace. A free trial has no grace: it ends on its
  // last day (a renewal is never an outage; a trial ending is not one).
  const endsAt = to + DAY
  if (now < endsAt) return { valid: true, reason: 'license', license, endsAt }
  if (!license.trial && now < endsAt + LICENSE_GRACE_DAYS * DAY) return { valid: true, reason: 'grace', license, endsAt: endsAt + LICENSE_GRACE_DAYS * DAY }
  return { valid: false, reason: 'expired', license }
}

/** The install's license key as written in its settings or environment (else the one an administrator entered), or null. */
export function readLicenseText({ settings, env = {}, readFile = (path) => readFileSync(path, 'utf8'), stored = null }) {
  const inline = settings?.enterprise?.license || env.SLATEBOX_LICENSE
  if (typeof inline === 'string' && inline.trim()) return { text: inline.trim() }
  const file = settings?.enterprise?.licenseFile || env.SLATEBOX_LICENSE_FILE
  if (typeof file === 'string' && file.trim()) {
    try {
      return { text: String(readFile(file.trim())).trim() }
    } catch {
      return { text: null, problem: 'unreadable_file' }
    }
  }
  if (typeof stored === 'string' && stored.trim()) return { text: stored.trim(), entered: true }
  return { text: null }
}

/**
 * Whether enterprise code may run here, and why.
 * @returns {{ unlocked: boolean, via: 'cloud'|'license'|null, reason: string, words: string,
 *             license: object|null, endsAt: number|null }}
 */
export function enterpriseAccess({ settings, env = {}, readFile, keys = LICENSE_KEYS, now = Date.now(), stored = null }) {
  const out = (unlocked, via, reason, license = null, endsAt = null) => ({ unlocked, via, reason, words: LICENSE_WORDS[reason] || '', license, endsAt })
  // Cloud proves itself with a Cloud key; a self-hosted install with an on-prem key. Each kind
  // unlocks only its own edition, so neither a settings change nor the other kind's key unlocks.
  const cloud = settings?.public?.edition === 'cloud'
  const { text, problem } = readLicenseText({ settings, env, readFile, stored })
  if (problem) return out(false, null, problem)
  if (!text) return out(false, null, cloud ? 'cloud_no_key' : 'no_license')
  const checked = verifyLicense(text, { keys, now, host: installHost({ settings, env }) })
  if (!checked.valid) return out(false, null, checked.reason, checked.license || null)
  if (checked.license.kind !== (cloud ? 'cloud' : 'on-prem')) return out(false, null, 'wrong_kind', checked.license)
  if (cloud) return out(true, 'cloud', checked.reason === 'grace' ? 'grace' : 'cloud', checked.license, checked.endsAt)
  return out(true, 'license', checked.reason, checked.license, checked.endsAt)
}

/**
 * Signs a license key (Slatebox LLC's side; scripts/license-sign.mjs). Never called by the app.
 * @param {object} payload
 * @param {{ kid: string, privateKey: import('node:crypto').KeyObject | string }} signer
 */
export async function signLicense(payload, { kid, privateKey }) {
  const { sign, createPrivateKey } = await import('node:crypto')
  const body = Buffer.from(JSON.stringify({ v: 1, product: LICENSE_PRODUCT, kind: 'on-prem', ...payload }), 'utf8').toString('base64url')
  const signed = `${LICENSE_FORMAT}.${kid}.${body}`
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey
  return `${signed}.${sign(null, Buffer.from(signed, 'utf8'), key).toString('base64url')}`
}
