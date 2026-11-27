// Growth funnel: which links bring people to Slatebox Cloud and how far they get. First-party only,
// Slatebox Cloud only. Shared by the browser (imports/ui/components/GrowthBeacon.jsx) and the server
// (server/growth/), so both read the same rules.
//
// - Cloud only: off and absent on a self-hosted Slatebox (public.env 'selfhost'), and wherever the
//   Cloud license is missing (public.payments.cloud, set at start by cloud-lock.mjs applyCloudLock).
// - A browser that sends Do Not Track or Global Privacy Control is never counted: it sends nothing,
//   keeps nothing, and asks the server to forget what it kept for that account before.
// - No cookies and no third-party scripts. The browser keeps one small entry in its own local storage
//   (GROWTH_STORAGE_KEY: where it first came from, and the day), so a guest who signs up next week
//   is counted under the link that brought them.
// - What is stored is a source label (the ref or utm_source of the link, or the referring site's
//   host name), a step and a day. Never a full address, a query, a name or an email.

export const GROWTH_STORAGE_KEY = 'sb-growth'

/** The funnel, in order. 'paid' is any first payment; the paid kinds are counted beside it. */
export const STEPS = Object.freeze(['landing', 'visit', 'slate', 'signup', 'share', 'return', 'invite', 'paid'])
export const PAID_KINDS = Object.freeze(['business', 'pro', 'topup', 'ownkey'])
export const STEP_LABELS = Object.freeze({
  landing: 'Arrived by a tagged link',
  visit: 'First visit to the app',
  slate: 'First slate',
  signup: 'Signed up',
  share: 'First share',
  return: 'Came back another day',
  invite: 'Invited their team',
  paid: 'Paid or added their own key',
})
export const PAID_LABELS = Object.freeze({
  business: 'Slatebox Business',
  pro: 'Slatebox Pro',
  topup: 'Top-up',
  ownkey: 'Own AI key added',
})

export const DIRECT = 'direct'
export const SHARED_LINK = 'shared-link'
export const EXISTING = 'existing'
export const OTHER = 'other'
const LABEL = /^[a-z0-9][a-z0-9._-]{0,39}$/
// app hosts: a click inside Slatebox Cloud is not a source
const OWN_HOSTS = /(^|\.)app\.slatebox\.com$|(^|\.)test\.slatebox\.com$|^localhost$|^127\.0\.0\.1$/

/**
 * Whether the funnel runs with these settings: Slatebox Cloud (never a self-hosted server) and not
 * switched off (settings.growth.enabled false). The server decides once at start and tells browsers
 * in public.growth.on (server/growth/meteor.js); a browser reads both.
 */
export function growthOn(settings) {
  const pub = settings?.public
  if (!pub || pub.env === 'selfhost' || pub.payments?.cloud !== true) return false
  if (settings.growth && settings.growth.enabled === false) return false
  // the browser: the server's answer, when it gave one
  if (pub.growth && typeof pub.growth === 'object' && 'on' in pub.growth) return pub.growth.on === true
  return true
}

/** Whether the browser asks not to be tracked (Do Not Track or Global Privacy Control). */
export function privacySignal(nav = globalThis.navigator, win = globalThis.window) {
  try {
    if (nav?.globalPrivacyControl === true) return true
    const dnt = nav?.doNotTrack ?? win?.doNotTrack ?? nav?.msDoNotTrack
    return dnt === '1' || dnt === 'yes' || dnt === 1
  } catch {
    return false
  }
}

/** An automated browser (navigator.webdriver: test suites, crawlers that say so) is never counted. */
export function automatedBrowser(nav = globalThis.navigator) {
  try {
    return nav?.webdriver === true
  } catch {
    return false
  }
}

/** The same signal from request headers (DNT: 1, Sec-GPC: 1). */
export function privacySignalFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') return false
  return String(headers.dnt ?? '').trim() === '1' || String(headers['sec-gpc'] ?? '').trim() === '1'
}

/** A source label as stored: lower case, letters, digits, '.', '_' and '-', at most 40. Else null. */
export function cleanLabel(value) {
  if (typeof value !== 'string') return null
  // an address or a link is never a label (nothing that could name a person is kept)
  if (/[@:/\\]|%40/i.test(value)) return null
  const text = value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '').slice(0, 40)
  if (!text || !LABEL.test(text)) return null
  // nothing that looks like contact details or a secret
  if (/\b(?:sk|rk|pk)[-_][a-z0-9]{6,}/.test(text)) return null
  return text
}

/** The host a referrer names, without www. Null for none, an unreadable one, or Slatebox Cloud itself. */
export function referrerHost(referrer) {
  if (typeof referrer !== 'string' || !referrer) return null
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '')
    if (!host || OWN_HOSTS.test(host)) return null
    return cleanLabel(host)
  } catch {
    return null
  }
}

/**
 * Where a page load came from: { source, campaign, tagged }.
 * - ref, else utm_source, from the address (tagged: true: a landing);
 * - else the referring site's host name (news.ycombinator.com, slatebox.com);
 * - else a shared slate or presentation opened straight from a link ('shared-link');
 * - else 'direct'.
 * A tag that does not clean is 'other', and still a landing.
 */
export function sourceFromLocation({ search = '', path = '/', referrer = '' } = {}) {
  let params
  try {
    params = new URLSearchParams(search)
  } catch {
    params = new URLSearchParams()
  }
  const raw = params.get('ref') ?? params.get('utm_source')
  const campaign = cleanLabel(params.get('utm_campaign') ?? '') || null
  if (raw !== null && raw.trim()) return { source: cleanLabel(raw) || OTHER, campaign, tagged: true }
  const host = referrerHost(referrer)
  if (host) return { source: host, campaign, tagged: false }
  if (/^\/(?:canvas|present)\/[^/]+/.test(path || '')) return { source: SHARED_LINK, campaign, tagged: false }
  return { source: DIRECT, campaign, tagged: false }
}

/** The day (UTC, YYYY-MM-DD) of a time in ms. */
export const dayOf = (at) => new Date(at).toISOString().slice(0, 10)

/** The Monday (UTC) of the week a day is in, as YYYY-MM-DD. */
export function weekOf(day) {
  const at = Date.parse(`${day}T00:00:00Z`)
  if (!Number.isFinite(at)) return null
  const weekday = (new Date(at).getUTCDay() + 6) % 7
  return dayOf(at - weekday * 86_400_000)
}

/**
 * What this browser remembers (GROWTH_STORAGE_KEY), or null: { s: source, c: campaign|null, d: day }.
 */
export function readRemembered(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(GROWTH_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const s = cleanLabel(value.s)
    const d = typeof value.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.d) ? value.d : null
    if (!s || !d) return null
    return { s, c: cleanLabel(value.c ?? '') || null, d }
  } catch {
    return null
  }
}

export function remember(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(GROWTH_STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* no storage here: this visit still counts, a later one may count as new */
  }
}

export function forgetRemembered(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(GROWTH_STORAGE_KEY)
  } catch {
    /* nothing kept */
  }
}

/**
 * What the browser sends for this page load, and what it keeps.
 * → { send: { source, campaign, first, tagged, tagSource, tagCampaign }, keep }
 * first: no earlier entry (the browser's first visit). The first source is kept for good: a later
 * tagged link counts as a landing under its own tag, never moves the account's source.
 */
export function planVisit({ location, remembered, now = Date.now() }) {
  const here = sourceFromLocation(location)
  const first = !remembered
  const keep = remembered || { s: here.source, c: here.campaign, d: dayOf(now) }
  return {
    send: {
      source: keep.s,
      campaign: keep.c,
      first,
      tagged: here.tagged,
      tagSource: here.tagged ? here.source : null,
      tagCampaign: here.tagged ? here.campaign : null,
    },
    keep,
  }
}

/** A later step as a share of an earlier one (whole percent), or null when the earlier is 0. */
export function rate(later, earlier) {
  if (!earlier) return null
  return Math.round((100 * later) / earlier)
}

/**
 * The funnel rows the Growth page shows for one set of counts: each step with its count and its
 * share of the step before it that has any (landing is skipped as a base: untagged visits never
 * landed). steps: { step: n }.
 */
export function funnelRows(steps) {
  const counts = steps && typeof steps === 'object' ? steps : {}
  let base = null
  return STEPS.map((step) => {
    const n = Number(counts[step]) || 0
    const row = { step, label: STEP_LABELS[step], n, rate: step === 'landing' || step === 'visit' ? null : rate(n, base) }
    if (step !== 'landing') base = n
    return row
  })
}
