// What Admin tools › Enterprise features shows (server/enterprise.js 'enterprise.licenseStatus').
// MIT, without Meteor (scripts/enterprise-license.test.mjs). Never the key itself.
import { editionOf } from '../imports/api/common/edition.mjs'
import { enterpriseAccess, LICENSE_WORDS } from './enterprise-license.mjs'

// Where the admin page's on-prem license button goes for now: Slatebox's contact form, on its on-prem topic. No price is
// shown in the app; the purchase flow comes later.
export const UPGRADE_URL = 'https://slatebox.com/contact/?topic=on-prem&source=app-admin'

/**
 * @param {{ settings: object, env?: object, running: { loaded: boolean, access: object }, now?: number, access?: Function }} options
 *   running: what the server loaded at start (a new key takes effect after a restart)
 */
export function licenseStatusFor({ settings, env = {}, running, now = Date.now(), access = enterpriseAccess }) {
  const edition = editionOf(settings)
  const current = access({ settings, env, now })
  const iso = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString().slice(0, 10) : null)
  return {
    edition,
    unlocked: Boolean(running?.loaded),
    via: running?.loaded ? running.access?.via ?? null : null,
    reason: current.reason,
    words: current.words || LICENSE_WORDS[current.reason] || '',
    license: current.license,
    // The license's last day (once it has ended: the last day of its grace).
    worksUntil: current.endsAt ? iso(current.endsAt - 86_400_000) : null,
    // A key added or changed since the server started is used after a restart.
    restartNeeded: Boolean(current.unlocked) !== Boolean(running?.loaded),
    upgradeUrl: edition === 'cloud' ? null : UPGRADE_URL,
  }
}
