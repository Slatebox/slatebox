// Payments and the AI meter run only on Slatebox Cloud (owner decision, 2026-11-24). MIT, runs
// without Meteor (scripts/cloud-lock.test.mjs); server/cloud-lock-meteor.js is its Meteor side.
//
// Slatebox Cloud proves itself the way invited agents already require: settings.public.edition
// 'cloud' AND a signed Slatebox Cloud key (license kind 'cloud', bound to Cloud's host names) that
// server/enterprise-license.mjs accepts. Settings alone never switch payments on, so a self-hosted
// install cannot run a paid clone of Slatebox with its own Stripe keys and metering.enabled: there
// Slatebox Pro, Slatebox Business, top-ups, balances and the meter all stay off, whatever the
// settings say. An on-prem license (kind 'on-prem') unlocks enterprise features, never payments.
import { enterpriseAccess } from './enterprise-license.mjs'

export const CLOUD_ONLY = 'cloud_only'
export const CLOUD_ONLY_WORDS = 'Payments run only on Slatebox Cloud. A self-hosted Slatebox has nothing to pay for.'

// The one line the server logs at start (server/cloud-lock-meteor.js).
export const CLOUD_LOCK_LINES = Object.freeze({
  on: '[payments] Slatebox Cloud license found: payments and the meter may run here.',
  off: '[payments] No Slatebox Cloud license: payments (Pro, Business, top-ups, balances) and the meter are off here, whatever the settings say.',
})

/**
 * Whether this server is Slatebox Cloud by its signed Cloud key: enterpriseAccess resolves to
 * via 'cloud'. Anything else (no key, an on-prem key, a bad, foreign, expired or other host's key,
 * an unreadable file, an error) is false.
 */
export function cloudLicensed({ settings, env = {}, now = Date.now(), keys, readFile, access = enterpriseAccess } = {}) {
  try {
    const options = { settings, env, now }
    if (keys) options.keys = keys
    if (readFile) options.readFile = readFile
    return access(options)?.via === 'cloud'
  } catch {
    return false
  }
}

/**
 * The lock, checked live (a key that ends while the server runs locks payments then), remembered
 * for ttlMs so a busy server does not verify a signature on every call.
 * → { on(): boolean, payments(): boolean }   payments: on() and a Stripe secret key is set
 */
export function createCloudLock({ settings, env = {}, now = () => Date.now(), keys, readFile, access, ttlMs = 60_000 } = {}) {
  let cached = null
  const on = () => {
    const at = now()
    if (cached && cached.until > at) return cached.value
    const value = cloudLicensed({ settings, env, now: at, keys, readFile, access })
    cached = { value, until: at + ttlMs }
    return value
  }
  return {
    on,
    payments: () => on() && Boolean(settings?.stripePrivateKey),
  }
}

/**
 * At start, what browsers are told (Meteor sends settings.public to every browser): where the
 * lock is closed, in-app payments are off and the publishable key is removed, and
 * public.payments.cloud says whether billing UI may show at all. Mutates settings.public.
 */
export function applyCloudLock(settings, cloud) {
  const pub = settings?.public
  if (!pub || typeof pub !== 'object') return
  pub.payments = { cloud: cloud === true }
  if (cloud === true) return
  pub.stripe = { ...(pub.stripe && typeof pub.stripe === 'object' ? pub.stripe : {}), inApp: false }
  delete pub.stripe.publishableKey
}
