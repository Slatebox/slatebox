// Accounts are made in two ways: by the server for a guest or an invited teammate, and by
// accounts-password's createUser method, whose options come from whoever calls it. Only a
// server call may set the team or the guest flag; onCreateUser reads them from here.
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { Accounts } from 'meteor/accounts-base'
import { attemptedPassword, isSharedGuestPassword } from './shared-guest-password.mjs'

const trusted = new Meteor.EnvironmentVariable()

export function createTrustedUser(options, fields = {}) {
  return trusted.withValue(fields, () => Accounts.createUserAsync(options))
}

/** Run make() with the fields only the server may set (the team), e.g. around Accounts.insertUserDoc. */
export function withTrustedFields(fields, make) {
  return trusted.withValue(fields, make)
}

export function onCreateUser(suggested, user) {
  if (isSharedGuestPassword(suggested.password)) throw new Meteor.Error(403, 'Choose another password.')
  const fields = trusted.get() || {}
  const muser = user
  muser.isAnonymous = fields.isAnonymous === true
  muser.clientId = Random.hexString(12)
  muser.referredBy = typeof suggested.referredBy === 'string' ? suggested.referredBy.slice(0, 64) : 'slatebox'
  muser.whiteListedIPs = ['*']
  if (typeof fields.orgId === 'string' && fields.orgId) muser.orgId = fields.orgId
  const profile = suggested.profile && typeof suggested.profile === 'object' ? suggested.profile : {}
  muser.profile = {
    firstName: typeof profile.firstName === 'string' ? profile.firstName.slice(0, 100) : '',
    lastName: typeof profile.lastName === 'string' ? profile.lastName.slice(0, 100) : '',
    ...(typeof profile.transcribeOnStart === 'boolean' ? { transcribeOnStart: profile.transcribeOnStart } : {}),
    ...(typeof profile.audioMutedOnStart === 'boolean' ? { audioMutedOnStart: profile.audioMutedOnStart } : {}),
  }
  return muser
}

// A guest has no password anyone knows: the caller signs in with the resume token returned.
export async function createGuestAccount({ referralCode } = {}) {
  const email = `guest-${Random.id()}@anonymous.slatebox.invalid`
  const userId = await createTrustedUser({
    email,
    password: Random.secret(),
    profile: { firstName: '', lastName: '', transcribeOnStart: true, audioMutedOnStart: false },
    referredBy: typeof referralCode === 'string' ? referralCode : undefined,
  }, { isAnonymous: true })
  return { userId, email }
}

export async function guestLoginToken(userId) {
  const stamped = Accounts._generateStampedLoginToken()
  await Accounts._insertLoginToken(userId, stamped)
  return stamped.token
}

// Guests made before guests had their own passwords share one known password, so a
// password sign-in is never accepted for a guest; a guest signs in with its resume token.
Accounts.validateLoginAttempt((attempt) => {
  if (attempt.type === 'password' && attempt.user?.isAnonymous) {
    throw new Meteor.Error(403, 'Guests sign in with their saved session.')
  }
  // An account saved from such a guest may still have that password: it is refused for everyone.
  if (attempt.type === 'password' && isSharedGuestPassword(attemptedPassword(attempt))) {
    throw new Meteor.Error(403, 'That password is no longer accepted. Reset your password to sign in.')
  }
  return attempt.allowed
})
