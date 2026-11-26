// Admin › Updates on a self-hosted Slatebox: the update check, the admin's choices and what the page
// shows, over the shared record (store.mjs) and decision (policy.mjs). Pure: the database
// collections, the fetch, the clock, the notices and the audit log come in (meteor.js passes the
// real ones; scripts/updates-*.test.mjs pass stand-ins). Nothing here ever names an image to run:
// the host updater looks the version up in the signed manifest itself (installer updater/run.mjs).
import { DEFAULT_FEED_URL, readFeed } from './feed.mjs'
import {
  DAY_MS, HEARTBEAT_LATE_MS, compareVersions, decisionWords, isMajorStep, normalizePolicy, offered, parseVersion, rollbackOffer, validTimeZone,
} from './policy.mjs'
import * as store from './store.mjs'

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
export const CHECK_JITTER_MS = 30 * 60 * 1000
export const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000
export const ROLLBACK_CONFIRM = 'roll back'

export class UpdatesError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.code = code
    this.details = details
  }
}

/** settings.selfHosted.updates, as configure.mjs writes it (SLATEBOX_UPDATES, SLATEBOX_UPDATE_FEED). */
export function updateMode(settings) {
  const given = settings?.selfHosted?.updates || {}
  return { mode: ['auto', 'notify', 'off'].includes(given.mode) ? given.mode : 'auto', feedUrl: typeof given.feedUrl === 'string' && given.feedUrl ? given.feedUrl : null }
}

/** When the next check is due: every 6 hours, a random half hour either way; after failures, doubling up to a day. */
export function nextCheckDelay({ failures = 0, random = Math.random } = {}) {
  const jitter = Math.round((random() * 2 - 1) * CHECK_JITTER_MS)
  if (failures <= 0) return CHECK_EVERY_MS + jitter
  return Math.min(BACKOFF_MAX_MS, 15 * 60 * 1000 * 2 ** (failures - 1)) + Math.abs(jitter) / 6
}

/**
 * @param {object} io
 *   cols        { settings, events } raw collections
 *   settings    Meteor.settings
 *   get         (url) => { bytes }: the feed's transport (safe fetch with GitHub's hosts)
 *   keys        the trusted release keys (verify.mjs trustedKeys())
 *   current     () => { version, revision } of this image (identity.json), or nulls
 *   setUp       async () => whether the server's first admin exists
 *   notify      async ({ key, kind, title, text, url, security }) => void (every server admin)
 *   audit       async ({ by, action, before, after }) => void
 *   now, random
 */
export function createUpdatesService({ cols, settings, get, keys, current = () => ({ version: null }), setUp = async () => true, notify = async () => {}, audit = async () => {}, now = Date.now, random = Math.random, log = console }) {
  const { mode, feedUrl } = updateMode(settings)
  const runtime = settings?.selfHosted?.updates?.runtime === 'kubernetes' ? 'kubernetes' : 'docker'
  const install = /^[a-z0-9-]{1,63}$/.test(settings?.selfHosted?.updates?.install || '') ? settings.selfHosted.updates.install : null
  let failures = 0
  let dueAt = 0

  const doc = async () => store.ensureDoc(cols, { setUp: await setUp(), now: now() })

  async function checkNow({ by = null } = {}) {
    if (mode === 'off') throw new UpdatesError('off', 'Update checks are off on this server (SLATEBOX_UPDATES=off): it makes no update requests.')
    const before = await doc()
    try {
      const result = await readFeed({ get, url: feedUrl || DEFAULT_FEED_URL, keys, lastSequence: before.feed?.sequence || 0, now: now() })
      await store.recordCheck(cols, { result, now: now() })
      failures = 0
      dueAt = now() + nextCheckDelay({ random })
      const after = await store.readDoc(cols)
      const release = offered(after.feed, after.policy?.channel)
      const version = current().version
      if (release && version && compareVersions(release.version, version) > 0 && after.policy?.notify?.bell !== false) {
        if (await store.markNotified(cols, `available:${release.version}`)) {
          await notify({ key: `available:${release.version}`, kind: 'available', title: `Slatebox ${release.version} is available`, text: `Slatebox ${release.version} is available for this server (it runs ${version}). See Admin › Updates.`, url: '/admin/updates' })
        }
      }
      if (by) await store.addEvent(cols, { kind: 'admin', detail: 'checked now', by }, { now: now() })
      return { ok: true, available: release?.version || null }
    } catch (error) {
      failures += 1
      dueAt = now() + nextCheckDelay({ failures, random })
      await store.recordCheck(cols, { error, now: now() })
      log.warn?.(`[updates] the update check failed: ${error.message}`)
      if (String(error.code || '').startsWith('signature') || ['manifest-hash', 'replay'].includes(error.code)) {
        if (await store.markNotified(cols, `verify:${error.code}:${new Date(now()).toISOString().slice(0, 10)}`)) {
          await notify({ key: `verify:${error.code}`, kind: 'verification-failed', security: true, title: 'Security alert: an update did not verify', text: `Slatebox refused an update because it did not verify (${error.message}). Nothing was installed. See Admin › Updates.`, url: '/admin/updates' })
        }
      }
      return { ok: false, error: error.message, code: error.code || 'error' }
    }
  }

  /** Every ten minutes: the check when due; notices for finished attempts and a silent host updater. */
  async function tick() {
    const d = await doc()
    if (mode !== 'off' && now() >= dueAt) {
      const last = d.feed?.checkedAt ? new Date(d.feed.checkedAt).getTime() : 0
      if (!dueAt && last && now() - last < CHECK_EVERY_MS) dueAt = last + nextCheckDelay({ random })
      else await checkNow()
    }
    const fresh = await store.readDoc(cols)
    for (const attempt of (fresh.attempts || []).slice(0, 5)) {
      if (!['healthy', 'rolled-back', 'failed', 'verification-failed'].includes(attempt.outcome) || attempt.id.endsWith('-from')) continue
      if (!(await store.markNotified(cols, `outcome:${attempt.id}`))) continue
      const words = {
        healthy: attempt.kind === 'rollback' ? ['Slatebox was rolled back', `Slatebox is running its previous version again (from ${attempt.from || 'the newer one'}).`] : [`Slatebox updated to ${attempt.target}`, `This server now runs Slatebox ${attempt.target} (it ran ${attempt.from || 'an older version'}).`],
        'rolled-back': [`The update to ${attempt.target} was rolled back`, `Slatebox ${attempt.target} did not become healthy, so the previous version and its data were put back. ${attempt.detail || ''}`],
        failed: [`The update to ${attempt.target || 'the previous version'} failed`, `${attempt.detail || 'See Admin › Updates.'}`],
        'verification-failed': ['Security alert: an update did not verify', `The host updater refused ${attempt.target}: ${attempt.detail || 'it did not verify'}. Nothing was installed.`],
      }[attempt.outcome]
      await notify({ key: `outcome:${attempt.id}`, kind: attempt.outcome, security: attempt.outcome === 'verification-failed', title: words[0], text: words[1].trim(), url: '/admin/updates' })
    }
    const at = fresh.updater?.at ? new Date(fresh.updater.at).getTime() : null
    if (at && fresh.policy?.auto && mode === 'auto' && now() - at > HEARTBEAT_LATE_MS) {
      if (await store.markNotified(cols, `late:${new Date(at).toISOString()}`)) {
        await notify({ key: 'late', kind: 'updater-late', title: 'The host updater has not checked in', text: 'Automatic updates are on, but the host updater has not checked in for 3 days, so nothing is being applied. On the server, run: npx slatebox updates enable', url: '/admin/updates' })
      }
    }
  }

  /** What Admin › Updates shows. */
  async function status() {
    const d = await doc()
    const t = now()
    const me = current()
    const decision = store.decideFor(d, { now: t, current: me.version, mode })
    const release = d.feed?.ok ? offered(d.feed, d.policy?.channel) : null
    const manifest = release ? d.manifests?.[parseVersion(release.version)?.text] : null
    const newer = Boolean(release && me.version && compareVersions(release.version, me.version) > 0)
    const major = Boolean(newer && manifest && (manifest.major === true || isMajorStep(me.version, release.version)))
    const updaterAt = d.updater?.at ? new Date(d.updater.at).getTime() : null
    const events = await store.listEvents(cols, 60)
    return {
      mode, feedUrl: feedUrl || null, runtime, install,
      current: { version: me.version, revision: me.revision || null },
      policy: d.policy, policySource: d.policySource, zoneFrom: d.zoneFrom || null,
      available: newer && manifest ? {
        version: manifest.version, releasedAt: manifest.releasedAt, notes: manifest.notes || '', notesUrl: manifest.notesUrl || null,
        migrations: manifest.migrations || [], major, approved: (d.approvals || []).some(v => compareVersions(v, manifest.version) === 0),
        signed: true, preview: manifest.channel === 'preview', minUpgradeFrom: manifest.minUpgradeFrom || null,
        // On Kubernetes the installer applies a release (automatic applying there comes later).
        upgradeCommand: runtime === 'kubernetes' ? `npx slatebox upgrade${install && install !== 'slatebox' ? ` --name ${install}` : ''} --to ${manifest.image.repository}@${manifest.image.index}` : null,
      } : null,
      decision: { action: decision.action, reason: decision.reason, until: decision.until || null, words: decisionWords(decision, { timeZone: d.policy?.timeZone || 'UTC' }), notice: decision.notice || null },
      feed: { checkedAt: d.feed?.checkedAt || null, ok: Boolean(d.feed?.ok), expired: Boolean(d.feed?.expired), lastError: d.feed?.lastError || null },
      updater: updaterAt ? { at: new Date(updaterAt), scheduler: d.updater.scheduler, late: t - updaterAt > HEARTBEAT_LATE_MS, minutesAgo: Math.max(0, Math.round((t - updaterAt) / 60000)) } : null,
      request: d.request || null, attempt: d.lease ? d.attempt : null,
      lastAttempt: d.attempts?.[0] || null,
      history: events.map(event => ({ at: event.at, kind: event.kind, phase: event.phase || null, ok: event.ok ?? null, target: event.target || null, from: event.from || null, detail: event.detail || '', by: event.by || null, attemptId: event.attemptId || null })),
      attempts: (d.attempts || []).filter(item => !String(item.id).endsWith('-from')).slice(0, 20),
      rollback: rollbackOffer({ history: d.attempts || [], host: d.host || null }),
      requestPending: Boolean(d.request), now: new Date(t),
    }
  }

  async function changed(by, action, before, after) {
    await audit({ by, action, before, after })
    await store.addEvent(cols, { kind: 'admin', detail: action, by }, { now: now() })
  }

  async function setPolicy(input, { by }) {
    const d = await doc()
    const { policy, errors } = normalizePolicy(input, d.policy)
    if (errors.length) throw new UpdatesError('invalid', errors.map(e => e.message).join(' '), { fields: errors })
    await store.setPolicy(cols, policy)
    await changed(by, 'changed the update settings', d.policy, policy)
    return policy
  }

  /** The first administrator's browser time zone, for a policy no administrator has set yet (once). */
  async function adoptTimeZone(timeZone, { by }) {
    const d = await doc()
    if (!validTimeZone(timeZone)) throw new UpdatesError('invalid', 'Choose a time zone such as America/New_York.')
    if (d.policySource === 'admin' || d.zoneFrom || d.policy?.timeZone === timeZone) return { adopted: false, policy: d.policy }
    if (!(await store.adoptTimeZone(cols, timeZone, { by, now: now() }))) return { adopted: false, policy: d.policy }
    const after = { ...d.policy, timeZone }
    await audit({ by, action: `set the update time zone to ${timeZone} (the administrator's own)`, before: d.policy, after })
    return { adopted: true, policy: after }
  }

  const releaseFor = async version => {
    const d = await doc()
    const v = parseVersion(version)?.text
    if (!v || !d.manifests?.[v]) throw new UpdatesError('unknown-version', `${version} is not a release this server has checked. Choose Check now first.`)
    return { d, v }
  }

  async function approve(version, { by }) {
    const { d, v } = await releaseFor(version)
    await store.approve(cols, v, { by, now: now() })
    await audit({ by, action: `approved ${v}`, before: d.approvals || [], after: [...(d.approvals || []), v] })
    return { approved: v }
  }

  async function applyNow(version, { by, retry = false }) {
    if (mode === 'off') throw new UpdatesError('off', 'Updates are off on this server (SLATEBOX_UPDATES=off).')
    const { d, v } = await releaseFor(version)
    const value = await store.request(cols, { kind: retry ? 'retry' : 'apply', version: v, by, now: now() })
    await audit({ by, action: `${retry ? 'try again' : 'update now'}: ${v}`, before: d.request || null, after: value })
    return { requested: value, updaterReady: Boolean(d.updater?.at) }
  }

  async function cancel({ by }) {
    const d = await doc()
    await store.cancelRequest(cols, { by, now: now() })
    await audit({ by, action: 'cancelled the update request', before: d.request || null, after: null })
    return { cancelled: true }
  }

  async function rollback({ confirm = '' } = {}, { by }) {
    const d = await doc()
    const offer = rollbackOffer({ history: d.attempts || [], host: d.host || null })
    if (!offer) throw new UpdatesError('no-rollback', 'There is no earlier version to roll back to (the backup from before the last update is gone, or there was no update).')
    if (!offer.keepsData && String(confirm).trim().toLowerCase() !== ROLLBACK_CONFIRM) {
      throw new UpdatesError('confirm', `Rolling back to ${offer.to} restores the backup taken before the update: changes since then are lost. Type "${ROLLBACK_CONFIRM}" to confirm.`)
    }
    const value = await store.request(cols, { kind: 'rollback', version: offer.to, by, now: now() })
    await audit({ by, action: `roll back to ${offer.to}${offer.keepsData ? '' : ' (restoring the backup from before the update)'}`, before: d.request || null, after: value })
    return { requested: value }
  }

  return { status, checkNow, tick, setPolicy, adoptTimeZone, approve, applyNow, cancel, rollback, mode, feedUrl, _due: () => dueAt }
}

export { DAY_MS }
