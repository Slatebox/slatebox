// Whether a team's single sign-on, provisioning (SCIM) and activity log may be configured and read.
// One switch for all three. The owner's decision (2026-11-27, replacing 2026-11-22's 'free'): on
// Slatebox Cloud they are part of Business; a self-hosted server has them for every team, free. A team whose Business lapses keeps signing in through its
// single sign-on and its log keeps recording (nobody is locked out and history has no gap), but
// changing the set-up and reading the log wait until Business is back.
import { isCloudEdition } from './edition.mjs'
import { businessActive } from '../business/membership.mjs'

export const TEAM_SECURITY = Object.freeze({ cloudPlan: 'business' }) // 'free' | 'business'

export function teamSecurityOn({ settings, org, now = Date.now(), plan = TEAM_SECURITY.cloudPlan }) {
  if (!isCloudEdition(settings)) return true
  return plan === 'free' || businessActive(org, now)
}
