// A team's Slatebox Business membership: organizations.business = { status: 'active', until? },
// `until` being when it ends (a Date or a time in ms), absent while it runs. Staff write it for a
// contract (no source); the webhook writes it for a team that bought Business in the app
// (source 'stripe', server/business-billing.mjs), where settings name the two Stripe prices.

/** Whether a team (its organizations document) has an active Business membership at `now`. */
export function businessActive(org, now = Date.now()) {
  const business = org?.business
  if (!business || typeof business !== 'object' || business.status !== 'active') return false
  if (business.until === undefined || business.until === null) return true
  const until = business.until instanceof Date ? business.until.getTime() : business.until
  return Number.isFinite(until) && until > now
}

/**
 * Owner decision (2026-11-24): Slatebox Business members count as Pro for inviting outside agents. On Slatebox
 * Cloud a person may invite, keep and ask outside agents with Slatebox Pro, or with a seat on a Business team.
 */
export function invitesAgents({ pro, org }, now = Date.now()) {
  return Boolean(pro) || businessActive(org, now)
}
