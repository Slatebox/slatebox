// The license key an administrator entered in the app (the header button for self-hosted installs › Unlock): a trial key
// Slatebox Cloud issued to this install, or a bought key pasted in. MIT, runs without Meteor
// (scripts/selfhost-options.test.mjs); server/selfhost-options/meteor.js gives it the real collection.
//
// - Kept in one row of this server's database (systemSettings, _id 'enterpriseLicense'), so it
//   survives restarts and needs no settings file or environment change. Settings and environment
//   still win when they hold a key (server/enterprise-license.mjs readLicenseText): an operator's
//   key is never overridden from the browser.
// - Checked before it is kept, exactly as a key in settings is: signed by Slatebox LLC, for this
//   product, this kind of install and this install's host, and not ended. A key that would not
//   unlock is refused with its reason, and the one already kept stays.
// - Never handed back: what the app shows is the license's summary (licensee, end date, hosts).
// - cached() answers synchronously (the loader's hourly re-check reads it); load() fills it at
//   start, save() and clear() keep it current.
import { LICENSE_WORDS, verifyLicense } from './enterprise-license.mjs'

export const LICENSE_ROW = 'enterpriseLicense'
const MAX_KEY_LENGTH = 4096

export class LicenseKeyError extends Error {
  constructor(reason, message = LICENSE_WORDS[reason] || 'The license key was refused.') {
    super(message)
    this.reason = reason
    this.code = reason
    this.status = 400
  }
}

/**
 * @param {object} options
 * @param {{ findOneAsync: Function, upsertAsync: Function, removeAsync: Function }} options.collection  systemSettings
 * @param {Record<string, string>} [options.keys]  Slatebox LLC's public keys (the license module's by default)
 * @param {() => number} [options.now]
 */
export function createLicenseKeyStore({ collection, keys, now = Date.now }) {
  let text = null
  return {
    cached: () => text,
    async load() {
      const row = await collection.findOneAsync({ _id: LICENSE_ROW })
      text = typeof row?.key === 'string' && row.key ? row.key : null
      return text !== null
    },
    /**
     * Checks a key and keeps it. Throws LicenseKeyError (with reason) when it would not unlock here.
     * @param {string} given  the key as typed or as Cloud sent it
     * @param {{ host: string, kind?: 'on-prem', by?: string|null, source: 'trial'|'pasted' }} where
     * @returns {Promise<{ license: object, endsAt: number, reason: string }>}  never the key
     */
    async save(given, { host, by = null, source }) {
      const key = typeof given === 'string' ? given.trim() : ''
      if (!key || key.length > MAX_KEY_LENGTH || /\s/.test(key)) throw new LicenseKeyError('malformed')
      const checked = verifyLicense(key, { ...(keys && { keys }), now: now(), host })
      if (!checked.valid) throw new LicenseKeyError(checked.reason)
      // Only an on-prem key belongs on a self-hosted install; a Cloud key never unlocks one.
      if (checked.license.kind !== 'on-prem') throw new LicenseKeyError('wrong_kind')
      await collection.upsertAsync(
        { _id: LICENSE_ROW },
        { $set: { key, licenseId: checked.license.id, source, savedBy: by, savedAt: new Date(now()) } }
      )
      text = key
      return { license: checked.license, endsAt: checked.endsAt, reason: checked.reason }
    },
    async clear() {
      await collection.removeAsync({ _id: LICENSE_ROW })
      text = null
    },
  }
}
