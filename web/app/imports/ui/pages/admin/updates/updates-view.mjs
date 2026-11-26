// Admin › Updates: the words and shapes the page draws, from updates.status (server/updates/
// service.mjs). Pure, so scripts/admin-updates-view.test.mjs can read every state.

export const DAYS = Object.freeze([
  { value: 1, short: 'Mon', label: 'Monday' }, { value: 2, short: 'Tue', label: 'Tuesday' }, { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' }, { value: 5, short: 'Fri', label: 'Friday' }, { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 0, short: 'Sun', label: 'Sunday' },
])

// The live phases an update goes through, in order (the host updater reports each).
export const STEPS = Object.freeze([
  { phase: 'verifying', label: 'Checking the signature' },
  { phase: 'pulling', label: 'Downloading' },
  { phase: 'backing-up', label: 'Backing up' },
  { phase: 'starting', label: 'Restarting' },
  { phase: 'healthy', label: 'Done' },
])

export const OUTCOMES = Object.freeze({
  healthy: { label: 'Updated', tone: 'success' },
  'rolled-back': { label: 'Rolled back', tone: 'warning' },
  failed: { label: 'Failed', tone: 'error' },
  'verification-failed': { label: 'Did not verify', tone: 'error' },
})

export const HOLD_BACK_CHOICES = Object.freeze([0, 1, 2, 3, 7, 14])
export const LENGTH_CHOICES = Object.freeze([1, 2, 3, 4, 6, 8])

/** Which step of STEPS the live attempt is on (-1 when none). */
export const stepIndex = (phase) => STEPS.findIndex((step) => step.phase === phase)

export function ago(at, now = Date.now()) {
  if (!at) return 'never'
  const minutes = Math.max(0, Math.round((now - new Date(at).getTime()) / 60000))
  if (minutes < 1 || now - new Date(at).getTime() < 60000) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} days ago`
}

export const shortDate = (at, timeZone) => (at ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(timeZone ? { timeZone } : {}) }).format(new Date(at)) : '')
export const dateTime = (at, timeZone) => (at ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone, timeZoneName: 'short' } : {}) }).format(new Date(at)) : '')

/** The host updater's line under the version. */
export function updaterLine(status, now = Date.now()) {
  if (status.mode === 'off') return { tone: 'default', text: 'Update checks are off on this server (SLATEBOX_UPDATES=off).' }
  if (!status.updater) return { tone: 'warning', text: 'Host updater not set up. On the server, run: npx slatebox updates enable', command: 'npx slatebox updates enable' }
  if (status.updater.late) return { tone: 'error', text: `The host updater has not checked in since ${ago(status.updater.at, now)}. On the server, run: npx slatebox updates enable`, command: 'npx slatebox updates enable' }
  return { tone: 'success', text: `Host updater checked in ${ago(status.updater.at, now)}` }
}

/** The main action for the release on offer, if any: approve, update now, try again or nothing. */
export function primaryAction(status) {
  const available = status.available
  if (!available || status.mode === 'off' || status.attempt) return null
  if (available.major && !available.approved) return { kind: 'approve', label: `Approve ${available.version}` }
  if (status.decision?.reason === 'not-retried') return { kind: 'retry', label: 'Try again' }
  if (status.requestPending) return { kind: 'cancel', label: 'Cancel the update' }
  return { kind: 'apply', label: 'Update now' }
}

/** One history row per finished attempt, newest first. */
export function attemptRows(status) {
  return (status.attempts || []).map((attempt) => ({
    id: attempt.id,
    at: attempt.at,
    outcome: OUTCOMES[attempt.outcome] || { label: attempt.outcome, tone: 'default' },
    change: attempt.kind === 'rollback' ? `${attempt.from || '?'} → previous version` : `${attempt.from || '?'} → ${attempt.target || '?'}`,
    detail: attempt.detail || '',
  }))
}

/** The update checks and admin changes, newest first (the attempts' phases are in attemptRows). */
export function eventRows(status) {
  return (status.history || []).filter((event) => event.kind !== 'attempt').slice(0, 20).map((event) => ({
    at: event.at,
    text: event.kind === 'check' ? (event.ok ? `Checked GitHub: ${event.detail}` : `The check failed: ${event.detail}`) : `An admin ${event.detail}`,
    tone: event.kind === 'check' && event.ok === false ? 'error' : 'default',
  }))
}

/** The time zones the browser knows, the admin's own first. */
export function timeZones(own) {
  let all = []
  try { all = Intl.supportedValuesOf('timeZone') } catch { all = ['UTC'] }
  if (!all.includes('UTC')) all = ['UTC', ...all]
  return own && all.includes(own) ? [own, ...all.filter((zone) => zone !== own)] : all
}

/** The window in words: "Every day, 04:00 to 06:00 (America/New_York)". */
export function windowWords(policy) {
  if (!policy) return ''
  const days = [...(policy.window?.days || [])].sort()
  const named = days.length === 7 ? 'Every day' : days.join(',') === '1,2,3,4,5' ? 'Weekdays' : days.join(',') === '0,6' ? 'Weekends' : DAYS.filter((d) => days.includes(d.value)).map((d) => d.short).join(', ')
  const [h, m] = String(policy.window?.start || '04:00').split(':').map(Number)
  const end = (h * 60 + m + (policy.window?.hours || 2) * 60) % 1440
  const pad = (n) => String(n).padStart(2, '0')
  return `${named}, ${pad(h)}:${pad(m)} to ${pad(Math.floor(end / 60))}:${pad(end % 60)} (${policy.timeZone || 'UTC'})`
}

/** Plain release notes: the changelog section, headings and bullets only, no HTML. */
export function noteLines(notes) {
  return String(notes || '').split('\n').map((line) => line.trimEnd()).filter((line) => line.trim()).slice(0, 40).map((line) => {
    if (/^#{1,6}\s/.test(line)) return { kind: 'heading', text: line.replace(/^#{1,6}\s+/, '') }
    if (/^\s*[-*]\s/.test(line)) return { kind: 'item', text: line.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '') }
    return { kind: 'text', text: line.replace(/\*\*/g, '') }
  })
}
