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
const LINKED = 'This account signs in with single sign-on. Choose "Sign in with SSO".'
export const NO_LONGER_HAS_ACCESS = 'Your single sign-on account no longer has access. Sign in again.'

/**
 * For Accounts.validateLoginAttempt: the reason a sign-in is refused, or null.
 * - An account linked to SSO signs in with SSO or a saved session, never with a password or a
 *   password reset, in either mode; once the identity provider has refused it (revokedAt), not
 *   with a saved session either, until it signs in with SSO again.
 * - Under SSO only, no password, password reset or sign-up, and no guest, for anyone.
 */
export function loginRefusal(attempt, sso) {
  const user = attempt?.user
  const linked = user?.services?.sso
  if (linked?.revokedAt && attempt?.type !== 'sso') return NO_LONGER_HAS_ACCESS
  if (sso?.only) {
    if (attempt?.type === 'password') return SSO_ONLY
    if (['resetPassword', 'createUser', 'changePassword'].includes(attempt?.methodName)) return SSO_ONLY
    if (user?.isAnonymous) return SSO_ONLY
  }
  if (linked && !['sso', 'resume'].includes(attempt?.type)) return LINKED
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

/**
 * Methods that only make sense with passwords or guests; closed under SSO only, for everyone,
 * signed in or not. (Everything else needs a signed-in account under SSO only: see gate.mjs.)
 * The app's own names are checked against CONSTANTS by the unit test, and index.js logs any
 * name that is not registered instead of skipping it silently.
 */
export const METHODS_CLOSED_UNDER_SSO_ONLY = [
  'forgotPassword',
  'users.generateSpecialUseLoginToken',
  'users.attemptLoginWithLink',
  'users.resetPassword',
  'users.createAnonymous',
  'creativeSlates.createGuest',
  'users.identify',
]

/** Pages the server answers without a session: closed under SSO only (the API keeps its tokens). */
export function closedPathUnderSsoOnly(path) {
  const pathname = String(path || '').split('?')[0]
  return pathname === '/api/public-presentations' || pathname.startsWith('/embed/')
}
export const SSO_ONLY_MESSAGE = SSO_ONLY
