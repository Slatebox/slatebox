// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Google as a recipe vendor (design F.1): a run's session as the owner (drive.file: picked files
// only), Drive's push notifications and the poll that backs them up, and the one outside change a
// Google recipe may make: google.write_sheet, one column of one picked sheet, offered only once
// Google has verified the spreadsheets scope (settings.connectors.google.verifiedScopes).
import { createDriveWatch } from './watch.mjs'
import { createGoogleRecipeSession, GOOGLE_BASES, GoogleSignInNeeded } from './session.mjs'

export const SPREADSHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const RANGE = /^'(?:[^']|'')+'![A-Z]{1,2}\d{1,6}(?::[A-Z]{1,2}\d{1,6})?$/

/** The write-back may change only the granted file and column, one cell at a time, never a formula. */
export function checkGoogleHardLimits(write, grant = null) {
  if (write?.kind !== 'google.write_sheet') return 'refused'
  const { fileId, range } = write.target || {}
  if (!fileId || !RANGE.test(range || '')) return 'refused'
  const cell = range.split('!')[1]
  if (cell.includes(':')) return 'refused'
  if (grant) {
    if (grant.scope?.fileId !== fileId) return 'refused'
    const column = cell.replace(/\d+$/, '')
    if (!(grant.scope?.columns || []).includes(column)) return 'refused'
    if (grant.scope?.tab && range.split('!')[0] !== `'${String(grant.scope.tab).replace(/'/g, "''")}'`) return 'refused'
  }
  const values = write.body?.values
  if (!Array.isArray(values) || values.length !== 1 || !Array.isArray(values[0]) || values[0].length !== 1) return 'refused'
  const value = String(values[0][0] ?? '')
  if (value.length > 200 || /^[=+\-@]/.test(value)) return 'refused'
  return null
}

/**
 * deps:
 *   integrationOf(userId) → the owner's Google integration row ({ status })
 *   tokenFor(userId, { force }) → the owner's Google token (vault.tokenFor(userId, GOOGLE_ADDRESS, { force }))
 *   fetch          the guarded fetch (createMcpFetch, Google's hosts)
 *   bases          { drive, sheets, docs } (a development fake on a development server)
 *   verifiedScopes() → the scopes Google verified for this install (write-back needs spreadsheets)
 *   watch          { store, instances, secret(), origin() } for Drive's push notifications
 *   trigger(instanceId, trigger), log, now
 */
export function createVendor({ integrationOf, tokenFor, fetch, bases = GOOGLE_BASES, verifiedScopes = () => [], watch, trigger = async () => {}, log = () => {}, now = Date.now }) {
  async function signedIn(instance) {
    const row = await integrationOf(instance.ownerId)
    if (!row || row.status === 'needs_sign_in') throw new GoogleSignInNeeded()
  }
  // The owner's call for the watch and the poll (outside a run: not budgeted; the poll's cadence bounds it).
  async function ownerApi(userId, method, url, body, retried = false) {
    const token = await tokenFor(userId, { force: retried }).catch(() => null)
    if (!token) throw new GoogleSignInNeeded()
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body && { 'content-type': 'application/json' }) }, ...(body && { body: JSON.stringify(body) }) })
    if (response.status === 401 && !retried) return ownerApi(userId, method, url, body, true)
    if (!response.ok) throw Object.assign(new Error('Google refused'), { code: `google_${response.status}` })
    const text = await response.text()
    try {
      return text ? JSON.parse(text) : {}
    } catch {
      throw Object.assign(new Error('Google answered something unreadable'), { code: 'google_bad_answer' })
    }
  }
  const drive = createDriveWatch({ store: watch.store, api: ownerApi, bases, instances: watch.instances, trigger, secret: watch.secret, origin: watch.origin, log, now })

  return {
    name: 'google',

    async session(instance, { signal = null, budget = null } = {}) {
      await signedIn(instance)
      return createGoogleRecipeSession({ userId: instance.ownerId, tokenFor, fetch, bases, budget, signal })
    },

    routes: () => [drive.route()],

    /** Timers the runtime runs on every process: the poll (every minute; each file at its own cadence) and channel renewal. */
    intervals: () => [
      { name: 'google-poll', everyMs: 60000, run: () => drive.poll() },
      { name: 'google-watch-renew', everyMs: 15 * 60000, run: () => drive.renew() },
    ],

    /** Lifecycle: an instance turned on (or its files changed) is watched; paused or deleted, unwatched. */
    activated: (instance) => drive.watch(instance),
    deactivated: (instanceId) => drive.unwatch(instanceId),

    matchInstances(event) {
      return { state: 'active', 'match.google.fileIds': { $in: event.fileIds || [] } }
    },

    /** Whether the write is offered at all on this install (Google verified the scope). */
    writesOffered: () => verifiedScopes().includes(SPREADSHEETS_SCOPE),

    checkHardLimits: (write, grant) => checkGoogleHardLimits(write, grant),

    async perform(write, { instance, grant = null, signal = null } = {}) {
      if (!verifiedScopes().includes(SPREADSHEETS_SCOPE)) throw Object.assign(new Error('write-back is not offered on this install'), { code: 'refused' })
      if (checkGoogleHardLimits(write, grant)) throw Object.assign(new Error('refused by a hard limit'), { code: 'refused' })
      await signedIn(instance)
      const session = createGoogleRecipeSession({ userId: instance.ownerId, tokenFor, fetch, bases, signal, writable: true })
      await session.writeValues(write.target.fileId, write.target.range, write.body.values)
      return { ref: `${write.target.fileId}:${write.target.range}` }
    },

    forget: (instanceId) => drive.unwatch(instanceId),

    _drive: drive,
  }
}
