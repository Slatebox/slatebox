// Passkeys, the Meteor side: the two collections, the passkeys.* methods, their rate limits, and the
// 'passkey' login handler (mirroring the 'sso' one in server/sso/index.js). The rules live in
// core.mjs beside this file and are unit-tested there (scripts/passkeys.test.mjs).
//
//   passkeys            one row per passkey: userId, credentialId (unique), publicKey, counter,
//                       transports, aaguid, deviceType, backedUp, name, createdAt, lastUsedAt.
//                       Never published, never exported (team export and Cloud move leave it
//                       behind: a passkey belongs to this server's address and cannot move anyway).
//   passkeyChallenges   a challenge's hash, purpose, account or connection, and expiry. Used once
//                       (taken with findOneAndDelete) and cleared by a TTL index.
//
// The WebAuthn user handle is 32 random bytes at users.services.passkey.userHandle, never the
// address. `services` is never published to a browser.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Accounts } from 'meteor/accounts-base'
import { Email } from 'meteor/email'
import { check, Match } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { Audit } from '../../imports/api/common/models'
import { ssoSettings } from '../sso/policy.mjs'
import { setupRequired } from '../self-host-setup/state.js'
import { verificationMailAvailable } from '../instance/meteor'
import { emailLogoUrl } from '../email/setup'
import { firstNameOf, passkeyAdded } from '../email/templates.mjs'
import { METHODS, PasskeyError, RATE_LIMITS, createPasskeys, relyingParty } from './core.mjs'

export const Passkeys = new Mongo.Collection('passkeys')
const PasskeyChallenges = new Mongo.Collection('passkeyChallenges')

const log = (line) => console.log(`passkeys: ${line}`)
const sso = (() => { try { return ssoSettings(Meteor.settings) } catch { return null } })()
// ROOT_URL (what Meteor.absoluteUrl answers from) and the settings; never a request's Host header.
const rp = relyingParty({ rootUrl: Meteor.absoluteUrl(), settings: Meteor.settings })
if (rp.off) log(`off: ${rp.off}`)
else log(`on for ${rp.rpId} (${rp.origins.join(', ')})${rp.ignored.length ? `; left out: ${rp.ignored.join(', ')}` : ''}`)

/** Remove every passkey of an account (account removal, SSO linking: server/sso). */
export const removePasskeysOf = (userId) => Passkeys.removeAsync({ userId })

async function sendVerification(userId) {
  if (!verificationMailAvailable()) return { verificationEmailSent: false }
  try {
    await Accounts.sendVerificationEmail(userId)
  } catch {
    throw new Meteor.Error('verification-delivery', 'Your account is saved. Email delivery failed. Request a new verification email from your profile.')
  }
  return true
}

async function notifyAdded(user, passkey) {
  const to = user.emails?.[0]?.address
  if (!to || !verificationMailAvailable()) return
  const base = String(Meteor.settings.public?.baseUrl || Meteor.absoluteUrl()).replace(/\/+$/, '')
  const mail = passkeyAdded({ firstName: firstNameOf(user), passkeyName: passkey.name, url: `${base}/profile?tab=sign-in`, logoUrl: emailLogoUrl() })
  // A notice: a mail failure never undoes the passkey.
  await Email.sendAsync({ from: Meteor.settings.mailFrom || 'no-reply@slatebox.com', to, subject: mail.subject, text: mail.text, html: mail.html })
    .catch((error) => log(`the notice for account ${user._id} was not sent: ${error?.message}`))
}

const USER_FIELDS = { _id: 1, emails: 1, profile: 1, isAnonymous: 1, isDisabled: 1, 'services.passkey': 1, 'services.sso': 1, 'services.password': 1 }

export const passkeys = createPasskeys({
  rp: () => rp,
  ssoOnly: () => Boolean(sso?.only),
  users: {
    get: (id) => Meteor.users.findOneAsync({ _id: id }, { fields: USER_FIELDS }),
    byEmail: (email) => Accounts.findUserByEmail(email, { fields: { _id: 1 } }),
    // Set once: a second tab racing this one keeps the first handle.
    async setHandle(id, handle) {
      await Meteor.users.updateAsync({ _id: id, 'services.passkey.userHandle': { $exists: false } }, { $set: { 'services.passkey.userHandle': handle } })
      const user = await Meteor.users.findOneAsync({ _id: id }, { fields: { 'services.passkey.userHandle': 1 } })
      return user?.services?.passkey?.userHandle
    },
    // A guest saved with a passkey: what users.identify does for a password, without one. The
    // guest's random password goes (nobody knows it), and the first-run answer stays.
    async claim(id, { email, firstName, lastName }) {
      const user = await Meteor.users.findOneAsync({ _id: id, isAnonymous: true }, { fields: { profile: 1 } })
      if (!user) return false
      const updated = await Meteor.users.updateAsync({ _id: id, isAnonymous: true }, {
        $set: {
          isAnonymous: false,
          'emails.0.address': email,
          'emails.0.verified': false,
          profile: {
            firstName: firstName || user.profile?.firstName || '',
            lastName: lastName || user.profile?.lastName || '',
            transcribeOnStart: true,
            audioMutedOnStart: false,
            ...(user.profile?.start && { start: user.profile.start }),
          },
        },
        $unset: { 'services.password': '' },
      })
      return updated === 1
    },
  },
  passkeys: {
    insert: (doc) => Passkeys.insertAsync(doc),
    byUser: (userId) => Passkeys.find({ userId }).fetchAsync(),
    byCredentialId: (credentialId) => Passkeys.findOneAsync({ credentialId }),
    update: (id, set) => Passkeys.updateAsync({ _id: id }, { $set: set }),
    remove: (id, userId) => Passkeys.removeAsync({ _id: id, userId }),
  },
  challenges: {
    insert: (record) => PasskeyChallenges.insertAsync(record),
    // Used once: the first taker deletes it; a replay finds nothing. (Either driver result shape.)
    async take(key) {
      const result = await PasskeyChallenges.rawCollection().findOneAndDelete({ _id: key })
      return (result && (result.value !== undefined ? result.value : result)) || null
    },
  },
  setupRequired,
  sendVerification,
  notifyAdded,
  audit: (entry) => Audit.insertAsync({ ...entry, created: Date.now() }),
  log,
})

/** The address was just proven (a password reset, an emailed sign-in link): see core's removeAddedUnverified. */
export const removePasskeysAddedUnverified = (userId, reason) =>
  passkeys.removeAddedUnverified({ userId, reason }).catch((error) => { log(`removing unconfirmed passkeys of ${userId} failed: ${error?.message}`); return 0 })

// The browser gets the words of a refusal, and its code to act on (unknown-passkey: tell the
// browser's passkey list to drop it).
const asMeteorError = (error) => (error instanceof PasskeyError ? new Meteor.Error(error.code, error.message) : error)
const run = async (fn) => { try { return await fn() } catch (error) { throw asMeteorError(error) } }
const ctx = (invocation) => ({ userId: invocation.userId, connectionId: invocation.connection?.id || null })
const responseShape = Match.ObjectIncluding({ id: String, rawId: String, type: String, response: Object })

Meteor.methods({
  [METHODS.available]() {
    return passkeys.available()
  },
  async [METHODS.loginOptions]() {
    return run(() => passkeys.loginOptions(ctx(this)))
  },
  async [METHODS.registerOptions]() {
    return run(() => passkeys.registerOptions(ctx(this)))
  },
  async [METHODS.register](opts) {
    check(opts, { response: responseShape, name: Match.Maybe(String) })
    return run(() => passkeys.register(ctx(this), opts))
  },
  async [METHODS.claimOptions](opts) {
    check(opts, { email: String })
    return run(() => passkeys.claimOptions(ctx(this), opts))
  },
  async [METHODS.claim](opts) {
    check(opts, { response: responseShape, email: String, firstName: Match.Maybe(String), lastName: Match.Maybe(String), name: Match.Maybe(String) })
    return run(() => passkeys.claim(ctx(this), opts))
  },
  async [METHODS.list]() {
    return run(() => passkeys.list(ctx(this)))
  },
  async [METHODS.rename](opts) {
    check(opts, { id: String, name: String })
    return run(() => passkeys.rename(ctx(this), opts))
  },
  async [METHODS.remove](opts) {
    check(opts, { id: String })
    return run(() => passkeys.remove(ctx(this), opts))
  },
})

for (const [name, count, interval, extra] of RATE_LIMITS) {
  DDPRateLimiter.addRule({ type: 'method', name, connectionId: () => true }, count, interval)
  if (extra?.clientAddress) DDPRateLimiter.addRule({ type: 'method', name, clientAddress: () => true }, extra.clientAddress, interval)
}

// Accounts.callLoginMethod({ methodArguments: [{ passkey: <AuthenticationResponseJSON> }] }).
// The challenge was issued to this connection by passkeys.loginOptions and is used once here.
Accounts.registerLoginHandler('passkey', async function passkeyLogin(options) {
  if (!options || typeof options.passkey !== 'object' || options.passkey === null) return undefined
  try {
    const { userId } = await passkeys.login({ connectionId: this.connection?.id || null }, options.passkey)
    return { userId }
  } catch (error) {
    if (error instanceof PasskeyError) return { error: new Meteor.Error(error.code, error.message) }
    throw error
  }
})

// A password reset proves the address (the link went to it) and ends every session: the passkeys
// added before the address was confirmed go too, as the old password does.
Accounts.onLogin(async (attempt) => {
  if (attempt?.methodName === 'resetPassword' && attempt.user?._id) await removePasskeysAddedUnverified(attempt.user._id, 'password-reset')
})

Meteor.startup(async () => {
  await Promise.all([
    Passkeys.rawCollection().createIndex({ credentialId: 1 }, { unique: true }),
    Passkeys.rawCollection().createIndex({ userId: 1 }),
    PasskeyChallenges.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]).catch((error) => console.error('passkeys: indexes', error?.message))
})
