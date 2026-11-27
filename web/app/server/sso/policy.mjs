// What single sign-on changes, and what "SSO only" refuses. No Meteor import: unit-tested with node.

export const DEFAULT_ROLES = ['member', 'none']
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const REQUIRED = ['issuer', 'clientId', 'clientSecret', 'authorizationEndpoint', 'tokenEndpoint', 'redirectUri', 'stateKey']

const keycloakSibling = (endpoint, name, from = 'token') => {
  const suffix = `/protocol/openid-connect/${from}`
  return typeof endpoint === 'string' && endpoint.endsWith(suffix) ? `${endpoint.slice(0, -from.length)}${name}` : null
}

/** The server-side SSO settings (Meteor.settings.sso), or null when SSO is off. */
export function ssoSettings(settings) {
  const sso = settings?.sso
  if (!sso || sso.enabled !== true) return null
  for (const name of REQUIRED) {
    if (typeof sso[name] !== 'string' || !sso[name]) throw new Error(`sso.${name} is required when sso.enabled is true`)
  }
  const checkSeconds = Number.isInteger(sso.checkSeconds) && sso.checkSeconds >= 10 ? sso.checkSeconds : 60
  // Who an SSO sign-in lets in without an invitation: everyone, as a Member of the default team
  // ('member', the default), or nobody new joins a team until invited ('none', invite-first).
  const defaultRole = sso.defaultRole === undefined || sso.defaultRole === null || sso.defaultRole === '' ? 'member' : sso.defaultRole
  if (!DEFAULT_ROLES.includes(defaultRole)) throw new Error(`sso.defaultRole must be ${DEFAULT_ROLES.join(' or ')}`)
  if (sso.domains !== undefined && !(Array.isArray(sso.domains) && sso.domains.every(domain => typeof domain === 'string' && DOMAIN.test(domain)))) {
    throw new Error('sso.domains must be a list of domain names, for example ["example.com"]')
  }
  const domains = [...new Set((sso.domains || []).map(domain => domain.toLowerCase()))]
  // The provider's signing keys: settings.sso.jwksUri, else Keycloak's beside its token endpoint.
  const jwksUri = typeof sso.jwksUri === 'string' && sso.jwksUri ? sso.jwksUri : keycloakSibling(sso.tokenEndpoint, 'certs')
  if (!jwksUri) throw new Error('sso.jwksUri is required when the token endpoint is not Keycloak\'s (…/protocol/openid-connect/token)')
  return {
    ...sso,
    jwksUri,
    endSessionEndpoint: typeof sso.endSessionEndpoint === 'string' && sso.endSessionEndpoint ? sso.endSessionEndpoint : keycloakSibling(sso.authorizationEndpoint, 'logout', 'auth'),
    only: sso.only === true,
    // The name accounts are linked under. The issuer changes with the address; a provider name need not.
    provider: typeof sso.provider === 'string' && sso.provider ? sso.provider : sso.issuer,
    label: typeof sso.label === 'string' && sso.label ? sso.label : 'Sign in with SSO',
    checkSeconds,
    defaultRole,
    domains,
    // Normally empty: the default team is the one the setup link's first admin made (recorded at setup).
    defaultTeamId: typeof sso.defaultTeamId === 'string' && sso.defaultTeamId ? sso.defaultTeamId : null,
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
 * - Under SSO only, no password, password reset or sign-up, no passkey, and no guest, for anyone.
 *   (An account linked to SSO never signs in with a passkey either: the last rule refuses every
 *   type but 'sso' and 'resume'.)
 */
export function loginRefusal(attempt, sso, { breakGlass = false } = {}) {
  const user = attempt?.user
  const linked = user?.services?.sso
  if (linked?.revokedAt && attempt?.type !== 'sso') return NO_LONGER_HAS_ACCESS
  if (sso?.only) {
    if (attempt?.type === 'password' || attempt?.type === 'passkey') return SSO_ONLY
    if (['resetPassword', 'createUser', 'changePassword'].includes(attempt?.methodName)) return SSO_ONLY
    if (user?.isAnonymous) return SSO_ONLY
  }
  // A break-glass account (a team's owner, or an admin the team named) keeps its password and
  // passkeys while linked: the way in when the identity provider is down.
  if (linked && !breakGlass && !['sso', 'resume'].includes(attempt?.type)) return LINKED
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
  // Passkeys (server/passkeys): signing in, adding one, and saving a guest with one. Listing and
  // removing stay open to a signed-in account.
  'passkeys.loginOptions',
  'passkeys.registerOptions',
  'passkeys.register',
  'passkeys.claimOptions',
  'passkeys.claim',
]

/** Pages the server answers without a session: closed under SSO only (the API keeps its tokens). */
export function closedPathUnderSsoOnly(path) {
  const pathname = String(path || '').split('?')[0]
  return pathname.startsWith('/embed/')
}
export const SSO_ONLY_MESSAGE = SSO_ONLY

// ---- A team's "Require single sign-on" (connection.policy.requireSso) ----

export const REQUIRE_SSO_MESSAGE = 'Your company signs in with single sign-on. Choose "Sign in with SSO".'
export const SESSION_ENDED = 'Your single sign-on session ended. Sign in again.'

/**
 * Whether a team's "Require single sign-on" covers this account: a member of the connection's
 * team, with an address in one of its verified domains (domains: connections.routableDomains), who
 * is not a break-glass account. Members with other addresses (contractors) and slate guests are
 * not covered.
 */
export function requireSsoCovers(user, connection, { domains, breakGlass = false } = {}) {
  if (!connection?.policy?.requireSso || !connection.enabled || breakGlass) return false
  if (!user || user.isAnonymous || user.orgId !== connection.orgId) return false
  return (user.emails || []).some((entry) => {
    const address = String(entry?.address || '').toLowerCase()
    return (domains || []).includes(address.slice(address.lastIndexOf('@') + 1))
  })
}

/**
 * For Accounts.validateLoginAttempt, under a team's "Require single sign-on": the account signs in
 * with SSO, or a session it already has. Never a password, a passkey or a password reset (a
 * sign-in link is refused where it is sent: users.generateSpecialUseLoginToken).
 */
export function teamPolicyRefusal(attempt, { covered }) {
  if (!covered) return null
  if (['resetPassword', 'changePassword'].includes(attempt?.methodName)) return REQUIRE_SSO_MESSAGE
  if (['sso', 'resume'].includes(attempt?.type)) return null
  return REQUIRE_SSO_MESSAGE
}

/**
 * Whether a session made by a team connection's sign-in is past the team's session length
 * (connection.policy.sessionHours). loginToken: the stored { hashedToken, when } the session
 * resumes with. Sessions the account made another way (a break-glass password) are not limited.
 */
export function ssoSessionExpired({ loginToken, sessionHours, now = Date.now() }) {
  if (!loginToken?.ssoConnectionId || !Number.isFinite(sessionHours) || sessionHours <= 0) return false
  const when = new Date(loginToken.when).getTime()
  return Number.isFinite(when) && now - when > sessionHours * 3600_000
}

/**
 * For Accounts.validateLoginAttempt on 'resume': an account that signs in only through a team
 * connection (covered by its "Require single sign-on", or linked to it and not break-glass) resumes
 * only a session single sign-on made (loginToken.ssoConnectionId). A session made any other way
 * (an emailed sign-in link, an API login link, a purchase link) was stored without a login attempt,
 * so the rules above never saw it. loginToken: the stored token the attempt resumes, or null.
 */
export function resumeRefusal(loginToken, { teamSsoOnly = false } = {}) {
  if (!loginToken || !teamSsoOnly) return null
  return loginToken.ssoConnectionId ? null : REQUIRE_SSO_MESSAGE
}

/**
 * The address a request came from behind `hops` proxies (HTTP_FORWARDED_COUNT): the entry the
 * nearest proxy added to X-Forwarded-For, never the left-most one, which the caller writes. With
 * no proxies, the socket's peer. The same rule as actions/http.mjs clientAddress, for plain
 * (connect) requests.
 */
export function requestAddress(req, hops = 0) {
  const peer = String(req?.socket?.remoteAddress || '')
  if (!hops) return peer
  const list = String(req?.headers?.['x-forwarded-for'] || '').split(',').map((hop) => hop.trim()).filter(Boolean)
  return list.length >= hops ? list[list.length - hops] : peer
}
