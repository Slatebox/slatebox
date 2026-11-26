// Slatebox Cloud's side of "Unlock enterprise, stay on your servers" (owner, 2026-11-25): a
// self-hosted server's administrator signs in from that server (device flow, client
// 'slatebox-server', scope license:trial) and Cloud answers one enterprise license key for it.
// MIT, runs without Meteor (scripts/license-issuer.test.mjs); server/licenses/meteor.js wires it.
//
// What a request gets, in order:
//   1. the account's own license: a key Slatebox recorded for it after a purchase on slatebox.com
//      (a row with source 'purchase'), when it covers the asking host (or names none);
//   2. the account's trial for that same host, again (re-runnable: the same key every time);
//   3. a new free trial: trialDays long (settings.licenses.trialDays, 30 by default), bound to the
//      asking host (so it unlocks that install only), kind on-prem, trial: true. One per account,
//      and one per public host name across accounts; refused with a plain reason otherwise.
// Every issue is audited, and each account may ask at most 10 times an hour.
// The signing key is Slatebox LLC's private Ed25519 key, in Cloud's server-side settings only
// (settings.licenses.signer { kid, privateKey }), never in the repository; without it nothing is
// offered (the device purpose answers invalid_scope, and the route 404).
export const TRIAL_DAYS = 30
export const ASKS_PER_HOUR = 10
const DAY = 86_400_000
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/

export class LicenseIssueError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.status = status
    this.code = code
    Object.assign(this, extra)
  }
}

export const licenseIssuerConfigured = (settings) => {
  const signer = settings?.licenses?.signer
  return Boolean(signer && typeof signer === 'object' && typeof signer.kid === 'string' && signer.kid && typeof signer.privateKey === 'string' && signer.privateKey)
}

export const trialDaysFrom = (settings) => {
  const days = Number(settings?.licenses?.trialDays)
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : TRIAL_DAYS
}

/** The asking install's host name, lower case, or null when it is not one. */
export function cleanHost(value) {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase().replace(/\.$/, '')
  return HOST.test(host) ? host : null
}
// A host only one install can have (a public name): "localhost" or a bare name may be anyone's.
const sharedHost = (host) => !host.includes('.')
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)

/**
 * @param {object} options
 * @param {{ findOne: Function, insertOne: Function, find: Function }} options.licenses  Mongo collection (raw)
 * @param {(payload: object) => Promise<string>} options.sign  signs a key (enterprise-license.mjs signLicense with Cloud's signer)
 * @param {{ take: Function }} options.counter  device.mjs createWindowCounter / memoryWindowCounter
 * @param {number} [options.trialDays]
 * @param {(entry: object) => Promise<void>|void} [options.audit]
 */
export function createLicenseIssuer({ licenses, sign, counter, trialDays = TRIAL_DAYS, audit = () => {}, now = Date.now, newId }) {
  const auditRow = (entry) => Promise.resolve(audit({ ...entry, at: new Date(now()) })).catch(() => {})
  const live = (row) => !row.expiresAt || Date.parse(row.expiresAt + 'T00:00:00Z') + DAY > now()

  /**
   * @param {{ userId: string, email?: string|null, host: string, installId?: string|null }} ask
   * @returns {Promise<{ key: string, trial: boolean, licenseId: string, expiresAt: string, hosts: string[], again: boolean }>}
   */
  async function issue({ userId, email = null, host: given, installId = null }) {
    if (!userId) throw new LicenseIssueError(401, 'unauthorized', 'Sign in to Slatebox Cloud first.')
    const host = cleanHost(given)
    if (!host) throw new LicenseIssueError(400, 'invalid_request', 'The server did not say its host name.')
    const taken = await counter.take(`license:${userId}`, ASKS_PER_HOUR, 3_600_000)
    if (!taken.allowed) throw new LicenseIssueError(429, 'rate_limited', 'Too many license requests from this account. Try again in an hour.', { retryAfter: taken.retryAfter })

    const shown = (row, again) => ({ key: row.key, trial: Boolean(row.trial), licenseId: row._id, expiresAt: row.expiresAt, hosts: row.hosts || [], again })

    // 1. A license bought for this account (recorded by Slatebox after the purchase).
    const bought = (await licenses.find({ userId, source: 'purchase', revokedAt: null }).toArray()).filter(live)
      .find((row) => !row.hosts?.length || row.hosts.includes(host))
    if (bought) {
      await auditRow({ type: 'license-fetched', userId, licenseId: bought._id, host, installId })
      return shown(bought, true)
    }
    // 2. This account's trial: the same key again for the same host, refused for another.
    const mine = await licenses.findOne({ userId, trial: true })
    if (mine) {
      if ((mine.hosts || []).includes(host) && live(mine)) {
        await auditRow({ type: 'license-trial-again', userId, licenseId: mine._id, host, installId })
        return shown(mine, true)
      }
      await auditRow({ type: 'license-trial-refused', userId, host, reason: 'trial_used' })
      if ((mine.hosts || []).includes(host))
        throw new LicenseIssueError(409, 'trial_used', `The free trial for ${host} has ended. Get a license at slatebox.com to keep enterprise features on.`)
      throw new LicenseIssueError(409, 'trial_used', `This account already had its free trial (for ${(mine.hosts || [])[0] || 'another server'}). Get a license at slatebox.com for this server.`)
    }
    // 3. A new trial; a public host name gets one trial, whoever asks.
    if (!sharedHost(host) && (await licenses.findOne({ trial: true, hosts: host }))) {
      await auditRow({ type: 'license-trial-refused', userId, host, reason: 'trial_used_host' })
      throw new LicenseIssueError(409, 'trial_used_host', `${host} already had a free trial. Get a license at slatebox.com to keep enterprise features on.`)
    }
    const id = `trial_${newId()}`
    const issuedAt = ymd(now())
    const expiresAt = ymd(now() + (trialDays - 1) * DAY)
    const payload = { id, licensee: email || 'Slatebox trial', kind: 'on-prem', trial: true, issuedAt, expiresAt, hosts: [host] }
    const key = await sign(payload)
    const row = { _id: id, userId, trial: true, source: 'trial', key, hosts: [host], installId, issuedAt, expiresAt, createdAt: new Date(now()), revokedAt: null }
    try {
      await licenses.insertOne(row)
    } catch (error) {
      // Two asks at once: the unique index keeps one trial per account; answer that one.
      if (error?.code === 11000) {
        const first = await licenses.findOne({ userId, trial: true })
        if (first && (first.hosts || []).includes(host)) return shown(first, true)
        throw new LicenseIssueError(409, 'trial_used', 'This account already had its free trial. Get a license at slatebox.com for this server.')
      }
      throw error
    }
    await auditRow({ type: 'license-trial-issued', userId, licenseId: id, host, installId, expiresAt })
    return shown(row, false)
  }

  return { issue }
}

/** The licenses collection's indexes: one trial per account, and lookups by host. */
export async function ensureLicenseIndexes(collection) {
  await collection.createIndex({ userId: 1 }, { unique: true, partialFilterExpression: { trial: true }, name: 'one_trial_per_account' })
  await collection.createIndex({ hosts: 1, trial: 1 })
  await collection.createIndex({ userId: 1, source: 1 })
}
