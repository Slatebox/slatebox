// When a self-hosted Slatebox updates itself: one pure decision, shared by the app (Admin › Updates,
// web/app/server/updates/policy-core.mjs is a byte-identical copy) and the container's own
// `slatebox updates policy` (which the host updater asks every five minutes). No I/O, no clock of
// its own: everything comes in as arguments, so the tests can walk every rule and every time zone.
//
// The app only says what an administrator wants (a policy, approvals, "update now"). It never names
// an image: the host updater looks the version up in the signed release manifest itself.

export const UPDATES_ID = 'selfHostUpdates'
export const SETTINGS_COLLECTION = 'systemSettings'
export const EVENTS_COLLECTION = 'selfHostUpdateEvents'
export const EVENTS_KEEP = 500
export const LEASE_MS = 2 * 60 * 60 * 1000
export const HEARTBEAT_LATE_MS = 3 * 24 * 60 * 60 * 1000
export const UPDATER_PROTOCOL = 1
export const DAY_MS = 24 * 60 * 60 * 1000
export const PHASES = Object.freeze(['verifying', 'backing-up', 'pulling', 'starting', 'healthy', 'rolled-back', 'failed', 'verification-failed'])
export const FINAL_PHASES = Object.freeze(['healthy', 'rolled-back', 'failed', 'verification-failed'])
export const FAILED_OUTCOMES = Object.freeze(['rolled-back', 'failed', 'verification-failed'])
export const CHANNELS = Object.freeze(['stable', 'preview'])
export const WEEKDAYS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])

const window = Object.freeze({ days: Object.freeze([0, 1, 2, 3, 4, 5, 6]), start: '04:00', hours: 2 })

/** A new install: updates on for minor and patch releases, daily 04:00-06:00 (an hour after the 03:00 backup). */
export const DEFAULT_POLICY = Object.freeze({
  auto: true, channel: 'stable', window, timeZone: 'UTC', holdBackDays: 2, includeMajor: false,
  notify: Object.freeze({ bell: true, email: true }),
})
/** An install that had data before it gained the updater: nothing changes until an admin says so. */
export const EXISTING_INSTALL_POLICY = Object.freeze({ ...DEFAULT_POLICY, auto: false })

// ------------------------------------------------------------------ versions

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

export function parseVersion(text) {
  const match = SEMVER.exec(String(text ?? '').trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ? match[4].split('.') : [], text: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}` }
}

export const isPreview = version => (parseVersion(version)?.pre.length ?? 0) > 0

/** SemVer precedence: -1, 0 or 1. Build metadata is ignored; an unreadable version sorts lowest. */
export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return x ? 1 : y ? -1 : 0
  for (const key of ['major', 'minor', 'patch']) if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn && Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1
    if (pn !== qn) return pn ? -1 : 1
    if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

export const isMajorStep = (from, to) => {
  const x = parseVersion(from)
  const y = parseVersion(to)
  return Boolean(x && y && y.major > x.major)
}

// ------------------------------------------------------------------ the policy an admin sets

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export function validTimeZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch { return false }
}

/** An admin's policy, checked and completed. → { policy, errors: [{ field, message }] } */
export function normalizePolicy(input, base = DEFAULT_POLICY) {
  const errors = []
  const given = input && typeof input === 'object' ? input : {}
  const policy = { ...base, ...given, window: { ...base.window, ...(given.window || {}) }, notify: { ...base.notify, ...(given.notify || {}) } }
  policy.auto = policy.auto === true
  policy.includeMajor = policy.includeMajor === true
  policy.notify = { bell: policy.notify.bell !== false, email: policy.notify.email !== false }
  if (!CHANNELS.includes(policy.channel)) errors.push({ field: 'channel', message: 'Choose stable or preview.' })
  if (!validTimeZone(policy.timeZone)) errors.push({ field: 'timeZone', message: 'Choose a time zone such as America/New_York.' })
  const days = Array.isArray(policy.window.days) ? [...new Set(policy.window.days.map(Number))].sort() : []
  if (!days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) errors.push({ field: 'window.days', message: 'Choose at least one day.' })
  if (!TIME.test(String(policy.window.start))) errors.push({ field: 'window.start', message: 'Give a start time such as 04:00.' })
  const hours = Number(policy.window.hours)
  if (!Number.isInteger(hours) || hours < 1 || hours > 12) errors.push({ field: 'window.hours', message: 'The window is 1 to 12 hours long.' })
  const holdBack = Number(policy.holdBackDays)
  if (!Number.isInteger(holdBack) || holdBack < 0 || holdBack > 30) errors.push({ field: 'holdBackDays', message: 'Wait 0 to 30 days.' })
  policy.window = { days, start: String(policy.window.start), hours }
  policy.holdBackDays = holdBack
  const known = ['auto', 'channel', 'window', 'timeZone', 'holdBackDays', 'includeMajor', 'notify']
  for (const key of Object.keys(policy)) if (!known.includes(key)) delete policy[key]
  return { policy, errors }
}

// ------------------------------------------------------------------ the apply window

const PARTS = new Map()
function localParts(now, timeZone) {
  let format = PARTS.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    PARTS.set(timeZone, format)
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(now)).map(part => [part.type, part.value]))
  return { day: WEEKDAYS.indexOf(parts.weekday), minute: Number(parts.hour) * 60 + Number(parts.minute) }
}

/**
 * Is `now` inside the window, by the wall clock of its time zone? A window may cross midnight (it
 * belongs to the day it starts on). On the night clocks go forward, a 02:00 window still opens at
 * the first minute that exists (03:00); on the night they go back, the repeated hour counts once
 * more, which only lengthens the window.
 */
export function inWindow(policyWindow, timeZone, now) {
  const { day, minute } = localParts(now, timeZone)
  const [h, m] = String(policyWindow.start).split(':').map(Number)
  const start = h * 60 + m
  const length = policyWindow.hours * 60
  const week = 7 * 1440
  const at = day * 1440 + minute
  return policyWindow.days.some(d => {
    const from = d * 1440 + start
    return (at >= from && at < from + length) || (at + week >= from && at + week < from + length)
  })
}

/** When the window next opens (a timestamp), searching minute by minute-ish (15 min steps) up to 8 days. */
export function nextWindow(policyWindow, timeZone, now) {
  if (inWindow(policyWindow, timeZone, now)) return now
  const step = 15 * 60 * 1000
  const first = Math.ceil(now / step) * step
  for (let t = first; t < now + 8 * DAY_MS; t += step) if (inWindow(policyWindow, timeZone, t)) return t
  return null
}

// ------------------------------------------------------------------ the decision

/** The newest release the channel offers (preview sees stable too), from a verified feed. */
export function offered(feed, channel) {
  if (!feed) return null
  const stable = feed.stable?.version ? feed.stable : null
  const preview = channel === 'preview' && feed.preview?.version ? feed.preview : null
  if (stable && preview) return compareVersions(preview.version, stable.version) > 0 ? preview : stable
  return preview || stable
}

const yankedIn = (feed, version) => (feed?.yanked || []).find(item => compareVersions(item.version, version) === 0) || null

/** The last attempt at a version, from the history (newest first). */
const lastAttemptAt = (history, version) => (history || []).find(item => item.target && compareVersions(item.target, version) === 0) || null

/**
 * What the host updater should do now.
 * @param {object} input
 *   policy     the admin's policy (normalizePolicy)
 *   now        a timestamp
 *   current    the running version ('2.0.0'); null when the image cannot say
 *   feed       the verified channel feed, or null; feedExpired: true when it is past expiresAt
 *   manifests  { [version]: verified manifest } for the versions the feed names
 *   approvals  versions an admin approved (major releases)
 *   request    an admin's "update now" / "roll back" / "retry": { kind, version, at }
 *   history    attempts, newest first: [{ id, target, outcome, at }]
 *   lease      { attemptId, until } while an attempt runs
 * @returns {{ action: 'none'|'apply'|'rollback', reason: string, target: {version}|null, notice?: string }}
 */
export function decide({ policy = DEFAULT_POLICY, now, current = null, feed = null, feedExpired = false, manifests = {}, approvals = [], request = null, history = [], lease = null }) {
  const none = (reason, extra = {}) => ({ action: 'none', reason, target: null, ...extra })
  if (lease && lease.until > now) return none('running', { attemptId: lease.attemptId })
  if (request?.kind === 'rollback') return { action: 'rollback', reason: 'requested', target: request.version ? { version: request.version } : null }

  const release = offered(feed, policy.channel)
  const currentYank = current ? yankedIn(feed, current) : null
  const notice = currentYank ? `The version this server runs (${current}) was withdrawn: ${currentYank.reason || 'update as soon as you can'}.` : undefined
  if (!release) return none(feed ? 'up-to-date' : 'no-feed', { notice })
  if (!current || !parseVersion(current)) return none('unknown-version', { notice })
  if (compareVersions(release.version, current) <= 0) return none('up-to-date', { notice })
  const target = { version: parseVersion(release.version).text }
  if (yankedIn(feed, target.version)) return none('yanked', { notice })
  const manifest = manifests[target.version] || null
  if (!manifest) return none('no-manifest', { notice })
  const major = manifest.major === true || isMajorStep(current, target.version)
  const approved = approvals.some(version => compareVersions(version, target.version) === 0)
  if (major && !approved) return none('needs-approval', { target, notice })

  // "Update now" (or "Try again"): no window, no waiting, but never past a yank or a major approval.
  if (request && (request.kind === 'apply' || request.kind === 'retry') && (!request.version || compareVersions(request.version, target.version) === 0)) {
    return { action: 'apply', reason: 'requested', target, notice }
  }
  if (!policy.auto) return none('notify-only', { target, notice })
  if (feedExpired) return none('feed-expired', { target, notice })
  if (major && !policy.includeMajor) return none('major-manual', { target, notice })
  const released = Date.parse(manifest.releasedAt)
  const holdUntil = (Number.isFinite(released) ? released : now) + policy.holdBackDays * DAY_MS
  if (holdUntil > now) return none('held-back', { target, notice, until: holdUntil })
  const last = lastAttemptAt(history, target.version)
  if (last && FAILED_OUTCOMES.includes(last.outcome)) return none('not-retried', { target, notice, outcome: last.outcome })
  if (!inWindow(policy.window, policy.timeZone, now)) return none('outside-window', { target, notice, until: nextWindow(policy.window, policy.timeZone, now) })
  return { action: 'apply', reason: 'window', target, notice }
}

/** Plain words for a decision, for Admin › Updates and `slatebox updates status`. */
export function decisionWords(decision, { timeZone = 'UTC' } = {}) {
  const when = at => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(at))
  const v = decision.target?.version
  switch (decision.reason) {
    case 'running': return 'An update is running now.'
    case 'requested': return decision.action === 'rollback' ? 'Rolling back now.' : `Updating to ${v} now.`
    case 'window': return `Updating to ${v} in this window.`
    case 'no-feed': return 'Slatebox has not checked for updates yet.'
    case 'up-to-date': return 'Slatebox is up to date.'
    case 'unknown-version': return 'This image does not say which version it is, so it is not updated automatically.'
    case 'yanked': return 'The newest release was withdrawn; nothing is applied.'
    case 'no-manifest': return 'The newest release could not be checked yet.'
    case 'needs-approval': return `${v} is a major release: approve it before it is applied.`
    case 'notify-only': return `${v} is available. Automatic updates are off.`
    case 'feed-expired': return `${v} is available, but Slatebox cannot confirm the newest version right now, so it waits.`
    case 'major-manual': return `${v} is approved. Major releases are applied when you choose Update now.`
    case 'held-back': return `${v} is applied after ${when(decision.until)}, once it has been out for a few days.`
    case 'not-retried': return `${v} was ${decision.outcome === 'rolled-back' ? 'rolled back' : 'not applied'} last time. Choose Try again, or wait for a newer release.`
    case 'outside-window': return decision.until ? `${v} is applied in the next window (${when(decision.until)}).` : `${v} is waiting for the update window.`
    default: return ''
  }
}

/** Whether "Roll back" is offered: the last attempt succeeded and the host still has its backup. */
export function rollbackOffer({ history = [], host = null }) {
  const last = (history || []).find(item => item.outcome === 'healthy' && item.kind !== 'rollback')
  if (!last || !last.from || !host?.preUpgradeBackup) return null
  return { to: last.from, from: last.target, keepsData: Boolean(last.downgradeSafe), backupAt: host.preUpgradeBackupAt || null }
}
