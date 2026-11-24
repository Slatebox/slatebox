// Slatebox Business's shared AI and call pool (business/catalog.mjs "includes"; terms Schedule A3):
// every member of a team with an active Business membership adds what Slatebox Pro includes in a
// month, and the team's members draw on one month counter together (org:<team>:<month>), while each
// person's own day caps still hold. Business members are paying people, so the shared free
// budget's stages never pause them (the same as Pro credits, policy.mjs route).
// A member with their own live Slatebox Pro uses their Pro credits first, as before.
// Pure: meteor.js reads the team and its members; holds.mjs, record.mjs and meter-core.mjs take
// the pool a decision carries.
import { businessActive } from '../../imports/api/business/membership.mjs'
import { proActive } from '../pro-billing.mjs'
import { monthKey } from './policy.mjs'

/** The team month counter a pool draws on. */
export const poolMonthKey = (teamId, now) => `org:${teamId}:${monthKey(now)}`

/**
 * The pool this person draws on, or null: { id: teamId, members }.
 * org: the person's team ({ _id, business }); members: its joined members (billableMembers), used
 * when the membership does not say how many it pays for (a staff-written contract). A membership
 * bought in the app carries Stripe's quantity (business.members), which is what the team pays for.
 */
export function teamPool({ user, org, members = 1, now = Date.now() }) {
  if (!user || user.isAnonymous || !user.orgId || !org || org._id !== user.orgId) return null
  if (proActive(user.pro, now)) return null
  if (!businessActive(org, now)) return null
  const paid = org.business.members
  const count = Number.isInteger(paid) && paid > 0 ? paid : Math.floor(Number(members) || 1)
  return { id: org._id, members: Math.max(1, count) }
}

/** The meter's settings with the month's allowances for the whole pool: Pro's amounts times its members. */
export function creditsForPool(settings, pool) {
  const members = pool?.members
  if (!Number.isInteger(members) || members < 1) return settings
  const { free } = settings
  return {
    ...settings,
    free: {
      ...free,
      aiMicrosPerMonth: (free.aiMicrosPerMonth || 0) * members,
      voiceMinutesPerMonth: (free.voiceMinutesPerMonth || 0) * members,
      videoMinutesPerMonth: (free.videoMinutesPerMonth || 0) * members,
    },
  }
}

/** The route's person for a pool member: the month's amount is the team's, paid for, never cut to a share. */
export const inPool = (person, pool) => (pool && person ? { ...person, included: true, pro: true, proPastDue: false, creditShare: 1, pool } : person)
