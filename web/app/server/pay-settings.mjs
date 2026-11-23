// Payment settings: the API version every Stripe call is pinned to, the client's options, and the
// in-app pay sheet's public settings (public.stripe.publishableKey, public.stripe.inApp). A bad
// setting turns the sheet off, so the hosted redirect still works; it never stops the app.
// Pure; the Meteor glue is server/pay-settings-startup.js and server/methods/wallet.js.

// The version stripe-node 23.1.0 was built for. The webhook endpoint is moved to the same one in
// the Dashboard; bump both with the SDK (scripts/pay-settings.test.mjs checks the SDK's).
export const STRIPE_API_VERSION = '2026-10-28.endive'
const API_VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}\.[a-z]+$/

/** settings.stripe.apiVersion when it is a dated release name, else the pinned one. */
export function stripeApiVersion(settings) {
  const named = settings?.stripe?.apiVersion
  return typeof named === 'string' && API_VERSION_SHAPE.test(named) ? named : STRIPE_API_VERSION
}

/** Options for `new Stripe(key, options)`: the pinned version, and a local mock's address (settings.stripe.apiBase). */
export function stripeClientOptions(settings) {
  const options = { apiVersion: stripeApiVersion(settings) }
  const base = settings?.stripe?.apiBase
  if (base) {
    const url = new URL(base)
    Object.assign(options, { host: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), protocol: url.protocol.replace(':', '') })
  }
  return options
}

/** 'test' | 'live' | null, from a pk_, sk_ or rk_ key's prefix. */
export function keyMode(key) {
  const m = typeof key === 'string' ? /^(?:pk|sk|rk)_(test|live)_/.exec(key) : null
  return m ? m[1] : null
}

const SECRET = /^(?:sk|rk)_(?:test|live)_|^whsec_/

/** Dotted paths of secret-shaped strings (sk_, rk_, whsec_) anywhere under public settings. */
export function secretsUnderPublic(value, path = []) {
  if (typeof value === 'string') return SECRET.test(value) ? [path.join('.')] : []
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, inner]) => secretsUnderPublic(inner, [...path, key]))
}

/**
 * Whether the pay sheet takes payments in the app. → { publishableKey|null, inApp, problems[] }
 * On: a pk_ key, a Stripe secret key of the same mode, pk_live_ only where public.env is 'prod',
 * and public.stripe.inApp not false. No key, or inApp:false (the kill switch), is not a problem.
 */
export function checkPaySettings(settings) {
  const given = settings?.public?.stripe?.publishableKey
  const problems = []
  if (given === undefined || given === null || given === '') return { publishableKey: null, inApp: false, problems }
  if (typeof given !== 'string' || !/^pk_(test|live)_/.test(given)) {
    return { publishableKey: null, inApp: false, problems: ['not-a-publishable-key'] }
  }
  const mode = keyMode(given)
  const secretMode = keyMode(settings?.stripePrivateKey)
  if (mode === 'live' && settings?.public?.env !== 'prod') problems.push('live-key-outside-prod')
  if (!secretMode || !/^(sk|rk)_/.test(settings.stripePrivateKey)) problems.push('no-secret-key')
  else if (secretMode !== mode) problems.push('mode-mismatch')
  const wanted = settings?.public?.stripe?.inApp !== false
  return { publishableKey: given, inApp: wanted && problems.length === 0, problems }
}

/**
 * At startup: write the computed inApp into public.stripe (what the browser reads), remove a value
 * that is not a publishable key, and blank any secret under public. Logs the problem and the path,
 * never a value. Mutates `settings`; returns checkPaySettings's answer.
 */
export function applyPaySettings(settings, log = () => {}) {
  const pub = settings?.public
  if (!pub || typeof pub !== 'object') return { publishableKey: null, inApp: false, problems: [] }
  secretsUnderPublic(pub).forEach((path) => {
    const keys = path.split('.')
    const parent = keys.slice(0, -1).reduce((o, k) => o[k], pub)
    parent[keys.at(-1)] = ''
    log(`A secret key was set under public settings at public.${path}; it was removed and is never sent to browsers. Move it out of public.`)
  })
  const out = checkPaySettings(settings)
  if (!pub.stripe || typeof pub.stripe !== 'object') pub.stripe = {}
  if (out.publishableKey === null) delete pub.stripe.publishableKey
  pub.stripe.inApp = out.inApp
  if (out.problems.length) log(`In-app payments are off (${out.problems.join(', ')}); payments use the hosted page. Check public.stripe.publishableKey and stripePrivateKey.`)
  return out
}
