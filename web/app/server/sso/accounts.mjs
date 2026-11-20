// Which Slatebox account an SSO identity signs in to. No Meteor import: unit-tested with node.
//
// 1. The account already linked to this issuer and subject.
// 2. Otherwise the account with the same email address, only when the identity provider says
//    the address is verified, and only if that account is not a guest and not linked to
//    another SSO identity. It is then linked.
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

export function decideAccount(identity, { bySubject, byEmail } = {}) {
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

/** The user document handed to Accounts.insertUserDoc for a new SSO account (no password). */
export function newUserDocument(identity, refreshToken, now = Date.now()) {
  return {
    emails: [{ address: identity.email, verified: true }],
    profile: { firstName: identity.firstName, lastName: identity.lastName },
    services: { sso: ssoService(identity, refreshToken, now) },
  }
}
