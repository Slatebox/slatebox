// Which Slatebox account an SSO identity signs in to. No Meteor import: unit-tested with node.
//
// 1. The account already linked to this issuer and subject.
// 2. Otherwise the account with the same email address, only when the identity provider says
//    the address is verified, and only if that account is not a guest and not linked to
//    another SSO identity. Slatebox must also have verified the address itself: anyone can type
//    any address into their own account, so an unverified address is no proof that the account
//    belongs to the person signing in. The one exception is an account nobody can use yet (a
//    team invitation not yet accepted: no password, no session, no API token). Linking ends
//    every other way into the account (linkModifier, revokeCredentials).
// 3. Otherwise a new account (just-in-time provisioning).

export function ssoIdentity(claims, issuer) {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
  const text = (value) => (typeof value === 'string' ? value.trim().slice(0, 100) : '')
  return {
    issuer,
    subject: claims.sub,
    email,
    emailVerified: claims.email_verified === true,
    firstName: text(claims.given_name) || (text(claims.name).split(' ')[0] || ''),
    lastName: text(claims.family_name),
  }
}

const linkedTo = (user, identity) =>
  user?.services?.sso?.issuer === identity.issuer && user?.services?.sso?.subject === identity.subject

const ownsAddress = (user, email) =>
  (user?.emails || []).some(entry => entry?.verified === true && String(entry.address || '').toLowerCase() === email)

/** Can anyone get into this account today: a password, a saved session or an API token? */
export function hasCredentials(user, { apiTokens = 0 } = {}) {
  const password = user?.services?.password
  return Boolean(password?.bcrypt || password?.argon2 || password?.srp) ||
    (user?.services?.resume?.loginTokens?.length || 0) > 0 ||
    apiTokens > 0
}

export function decideAccount(identity, { bySubject, byEmail, byEmailApiTokens = 0 } = {}) {
  if (bySubject && linkedTo(bySubject, identity)) {
    if (bySubject.isDisabled) return { action: 'refuse', reason: 'this Slatebox account is disabled' }
    return { action: 'login', userId: bySubject._id }
  }
  if (!identity.email) return { action: 'refuse', reason: 'the identity provider sent no email address' }
  if (!identity.emailVerified) return { action: 'refuse', reason: 'the identity provider has not verified the email address' }
  if (byEmail) {
    if (byEmail.isAnonymous) return { action: 'refuse', reason: 'the address belongs to a guest' }
    if (byEmail.isDisabled) return { action: 'refuse', reason: 'this Slatebox account is disabled' }
    if (byEmail.services?.sso && !linkedTo(byEmail, identity)) {
      return { action: 'refuse', reason: 'the account is linked to another single sign-on identity' }
    }
    if (!ownsAddress(byEmail, identity.email) && hasCredentials(byEmail, { apiTokens: byEmailApiTokens })) {
      return { action: 'refuse', reason: 'an account with this address exists, but Slatebox never verified the address' }
    }
    return { action: 'link', userId: byEmail._id }
  }
  return { action: 'create' }
}

export function ssoService(identity, refreshToken, now = Date.now()) {
  return {
    issuer: identity.issuer,
    subject: identity.subject,
    ...(refreshToken ? { refreshToken } : {}),
    lastSignIn: new Date(now),
    checkedAt: new Date(now),
  }
}

/**
 * The update that links an existing account to its SSO identity. The account then signs in with
 * SSO only: its password and every saved session end here (API tokens and sign-in links end in
 * revokeCredentials).
 */
export function linkModifier(user, identity, refreshToken, now = Date.now()) {
  const $set = { 'services.sso': ssoService(identity, refreshToken, now), 'services.resume.loginTokens': [] }
  const index = (user.emails || []).findIndex(entry => String(entry.address || '').toLowerCase() === identity.email)
  if (index >= 0) $set[`emails.${index}.verified`] = true
  return { $set, $unset: { 'services.password': '' } }
}

/** The update for an account whose identity provider refused its session: signed out everywhere. */
export function revokedModifier(now = Date.now()) {
  return {
    $set: { 'services.resume.loginTokens': [], 'services.sso.revokedAt': new Date(now), 'services.sso.checkedAt': new Date(now) },
    $unset: { 'services.sso.refreshToken': '' },
  }
}

/** Revoke the account's API tokens and remove its one-time sign-in links. */
export async function revokeCredentials({ apiTokens, loginLinks, apiLinks }, userId, now = Date.now()) {
  await apiTokens.updateAsync({ userId, revokedAt: null }, { $set: { revokedAt: now } }, { multi: true })
  await loginLinks.removeAsync({ userId })
  await apiLinks.removeAsync({ userId })
}

/**
 * The SSO accounts due for a check at the identity provider. Every one of them, not only those
 * with an open session: an API token works without one.
 */
export function sessionCheckQuery(now, checkSeconds) {
  return { 'services.sso.refreshToken': { $exists: true }, 'services.sso.checkedAt': { $lt: new Date(now - checkSeconds * 1000) } }
}

/** The user document handed to Accounts.insertUserDoc for a new SSO account (no password). */
export function newUserDocument(identity, refreshToken, now = Date.now()) {
  return {
    emails: [{ address: identity.email, verified: true }],
    profile: { firstName: identity.firstName, lastName: identity.lastName },
    services: { sso: ssoService(identity, refreshToken, now) },
  }
}
