/* eslint-disable no-underscore-dangle, no-await-in-loop, no-restricted-syntax, no-continue */
// What happens to a person their company turns off over SCIM (active=false, or DELETE). Pure: a
// plan, and an executor that runs it through an injected store. Nothing here deletes the account
// or a slate: deleting a person stays a deliberate owner action (organizations.removeMember).
//
// 1. Signed out everywhere: every saved session ends (open tabs close), and their API tokens,
//    one-time sign-in links and passkeys end (server/sso/accounts.mjs revokeCredentials).
// 2. The account is disabled (isDisabled, disabledBy 'scim'): sign-in, API tokens and passkeys
//    already refuse a disabled account.
// 3. Their roles in the team end (the team's Permissions rows for them).
// 4. The slates they own in the team move to the team's recipient for departing members (the
//    owner unless a team admin chose someone else), with formerOwnerId kept, and their sharing,
//    comments and messages as they are. Slates outside the team (no orgId) stay on the account.
// 5. A team billed for Slatebox Business pays for one member fewer (membersChanged).
//
// Turned on again (active=true), the account signs in again with SSO; slates do not move back.

export const DISABLED_BY_SCIM = 'scim'
export const DISABLED_MESSAGE = 'This Slatebox account is turned off. Ask your team admin.'

/** For Accounts.validateLoginAttempt: no sign-in of any kind, a saved session included, for a disabled account. */
export function disabledLoginRefusal(attempt) {
  return attempt?.user?.isDisabled === true ? DISABLED_MESSAGE : null
}

/**
 * The steps for turning a person off, in order, or [] when there is nothing to do (they are off
 * already). user: { _id, orgId, isOrgOwner, isDisabled }; recipientId: who receives their slates.
 */
export function deprovisionPlan(user, { orgId, recipientId }) {
  if (!user || user.orgId !== orgId) return []
  if (user.isOrgOwner) return []
  const steps = []
  if (user.isDisabled !== true) steps.push({ step: 'signOut', userId: user._id }, { step: 'disable', userId: user._id })
  steps.push({ step: 'removeRoles', userId: user._id, orgId })
  if (recipientId && recipientId !== user._id) steps.push({ step: 'moveSlates', from: user._id, to: recipientId, orgId })
  if (user.isDisabled !== true) steps.push({ step: 'membersChanged', orgId })
  return steps
}

/** The account's update when it is turned off. */
export const disableModifier = (now = Date.now()) => ({
  $set: { isDisabled: true, disabledBy: DISABLED_BY_SCIM, disabledAt: new Date(now), 'services.resume.loginTokens': [] },
})

/** The account's update when it is turned on again: only an account SCIM turned off. */
export const enableModifier = () => ({ $unset: { isDisabled: '', disabledBy: '', disabledAt: '' } })

/**
 * Runs a plan. store: { signOut(userId), disable(userId), removeRoles(orgId, userId),
 * moveSlates(orgId, from, to) → moved, membersChanged(orgId) }. Answers { moved }.
 */
export async function runDeprovision(plan, store) {
  let moved = 0
  for (const step of plan) {
    if (step.step === 'signOut') await store.signOut(step.userId)
    else if (step.step === 'disable') await store.disable(step.userId)
    else if (step.step === 'removeRoles') await store.removeRoles(step.orgId, step.userId)
    else if (step.step === 'moveSlates') moved += (await store.moveSlates(step.orgId, step.from, step.to)) || 0
    else if (step.step === 'membersChanged') await store.membersChanged(step.orgId)
  }
  return { moved }
}
