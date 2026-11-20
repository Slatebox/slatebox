// What single sign-on changes, and what "SSO only" refuses. No Meteor import: unit-tested with node.

const REQUIRED = ['issuer', 'clientId', 'clientSecret', 'authorizationEndpoint', 'tokenEndpoint', 'redirectUri', 'stateKey']

/** The server-side SSO settings (Meteor.settings.sso), or null when SSO is off. */
export function ssoSettings(settings) {
  const sso = settings?.sso
  if (!sso || sso.enabled !== true) return null
  for (const name of REQUIRED) {
    if (typeof sso[name] !== 'string' || !sso[name]) throw new Error(`sso.${name} is required when sso.enabled is true`)
  }
  const checkSeconds = Number.isInteger(sso.checkSeconds) && sso.checkSeconds >= 10 ? sso.checkSeconds : 60
  return {
    ...sso,
    only: sso.only === true,
    // The name accounts are linked under. The issuer changes with the address; a provider name need not.
    provider: typeof sso.provider === 'string' && sso.provider ? sso.provider : sso.issuer,
    label: typeof sso.label === 'string' && sso.label ? sso.label : 'Sign in with SSO',
    checkSeconds,
  }
}

const SSO_ONLY = 'This Slatebox uses single sign-on. Choose "Sign in with SSO".'

/** For Accounts.validateLoginAttempt: the reason a sign-in is refused, or null. */
export function loginRefusal(attempt, sso) {
  if (!sso?.only) return null
  if (attempt?.type === 'password') return SSO_ONLY
  if (['resetPassword', 'createUser', 'changePassword'].includes(attempt?.methodName)) return SSO_ONLY
  return null
}

/**
 * For Accounts.validateNewUser. Under SSO only, accounts come from single sign-on, or from a
 * team invitation (the invited person then signs in with SSO and is matched by email). No
 * guest and no self-made account with a password.
 */
export function mayCreateUser(user, sso) {
  if (!sso?.only) return true
  if (user?.services?.sso) return true
  if (user?.isAnonymous) return false
  return typeof user?.orgId === 'string' && user.orgId !== ''
}

/** Methods that only make sense with passwords or guests; closed under SSO only. */
export const METHODS_CLOSED_UNDER_SSO_ONLY = [
  'forgotPassword',
  'users.generateSpecialUseLoginToken',
  'users.createAnonymous',
  'creativeSlates.createGuest',
  'users.identify',
]
export const SSO_ONLY_MESSAGE = SSO_ONLY
