/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable default-case */
/* eslint-disable no-underscore-dangle */
// methods
import { Random } from 'meteor/random'
import { JoinedSlates } from './joined-slates'
import { deliverTeamInvitations } from './team-invitations.mjs'
import { forgetGrowthOf, growthStep } from '../growth/meteor'
import { Meteor } from 'meteor/meteor'
import { Email } from 'meteor/email'
import { refundBalance } from './wallet'
import { removeAccountAfterRefund } from '../wallet-stripe.mjs'
import { endProForRemoval, PRO_END_FAILED, mergePurchase } from './pro'
import { mergeLinkLive } from '../pro-claim.mjs'
import { Accounts } from 'meteor/accounts-base'
import { check, Match } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { createGuestAccount, createTrustedUser, guestLoginToken } from '../common/accounts'
import { resolveSlateRole, slateVisibility } from './slate-role.mjs'
import { isSharedGuestPassword } from '../common/shared-guest-password.mjs'
import { setupRequired } from '../self-host-setup/state.js'
import { NOT_SET_UP_MESSAGE } from '../self-host-setup/core.mjs'
import CONSTANTS from '../../imports/api/common/constants'
import AuthManager from '../../imports/api/common/AuthManager'
// The server administrator check (the uberMensch claim alone; no team needed)
import { isInstanceAdmin } from '../permissions'
import { teamPerson } from '../common/team-person'
import { roleChangeRefusal, clearedByAdmin } from '../team-guard.mjs'
import { readCreditName } from '../../imports/api/common/library-model.mjs'
import { removePersonalData } from '../profile/meteor'
import { removePasskeysAddedUnverified, removePasskeysOf } from '../passkeys/meteor'

import {
  Permissions,
  Claims,
  Organizations,
  Slates,
  Messages,
  SlateAccess,
  SlateApiTokens,
  SlateOperationRuns,
  SlatePresentations,
  LoginLinks,
  APILinks,
  ProviderKeys,
  AIChoices,
} from '../../imports/api/common/models'
import utils from '../../imports/api/common/utils'
import { accounts, enrollmentMailAvailable, verificationMailAvailable } from '../instance/meteor'
import { membersChanged } from './business'
import { emailLogoUrl } from '../email/setup'
import { firstNameOf, loginLink as loginLinkEmail } from '../email/templates.mjs'


async function sendVerification(userId) {
  if (!verificationMailAvailable()) return { verificationEmailSent: false }
  try {
    await Accounts.sendVerificationEmail(userId)
  } catch {
    throw new Meteor.Error('verification-delivery', 'Your account is saved. Email delivery failed. Request a new verification email from your profile.')
  }
  return true
}

const method = {}
method[CONSTANTS.methods.users.verificationMailAvailable] = verificationMailAvailable
// Profile → Credits: the confirmation email again, for an account that never confirmed
// (included AI and calls need a confirmed address). Rate limited in metering/limits.mjs.
method[CONSTANTS.methods.users.sendVerification] = async function resendVerification() {
  const user = await Meteor.userAsync()
  if (!user || user.isAnonymous) throw new Meteor.Error('sign-in', 'Sign in to confirm your email address.')
  if (user.emails?.[0]?.verified) return { alreadyConfirmed: true }
  const sent = await sendVerification(user._id)
  return sent === true ? { sent: true, address: user.emails?.[0]?.address ?? null } : { sent: false }
}
// A guest is never placed in a team: whoever asks gets a plain guest, signed in with the resume
// token returned (a guest has no password anyone knows).
method[CONSTANTS.methods.users.createAnonymous] = async function createAnonymous(opts) {
  check(opts, Match.Maybe(Match.ObjectIncluding({ referralCode: Match.Maybe(String) })))
  if (this.userId) throw new Meteor.Error('signed-in', 'You are already signed in.')
  const { userId, email } = await createGuestAccount({ referralCode: opts?.referralCode })
  return { email, token: await guestLoginToken(userId) }
}

method[CONSTANTS.methods.users.allowedInPrivateBeta] = async () => {
  const user = await Meteor.userAsync()
  if (user) {
    return user.allowedInPrivateBeta
  }
  return false
}

method[CONSTANTS.methods.users.isMasterUser] = async () => {
  const user = await Meteor.userAsync()
  return Boolean(user?.isMasterUser)
}

// The link a message points to: the slate's own address, given only to someone the slate's
// sharing already lets in. A link key is never handed out here.
method[CONSTANTS.methods.users.getSlateAccessUrl] = async function getSlateAccessUrl(opts) {
  check(opts, Match.ObjectIncluding({ slateId: String, nodeId: Match.Maybe(String) }))
  const user = this.userId && await Meteor.users.findOneAsync(this.userId, { fields: { orgId: 1, isMasterUser: 1 } })
  if (!user) return null
  const slate = await Slates.findOneAsync({ _id: opts.slateId }, { fields: { _id: 1, userId: 1, orgId: 1, shareId: 1, options: 1 } })
  if (!slate) return null
  const isAdmin = Boolean(user.isMasterUser === true ||
    (user.orgId && user.orgId === slate.orgId && await AuthManager.userHasClaim(user._id, [CONSTANTS.claims.admin._id])))
  // The slate's id alone is not its link: only the owner, a team admin, a person the sharing
  // names, or anyone for a public slate gets the address.
  const grants = slate.userId === user._id ? [] : await SlateAccess.find({ slateId: slate._id, type: slateVisibility(slate) }, {
    fields: { slateId: 1, type: 1, userId: 1, accessKey: 1, slateAccessPermissionId: 1 },
  }).fetchAsync()
  const named = grants.some((g) => g.userId === user._id)
  if (slate.userId !== user._id && !isAdmin && !named && !slate.options?.isPublic) return null
  if (!resolveSlateRole(slate, user, isAdmin, grants)) return null
  return `/canvas/${slate.shareId}${opts.nodeId ? `/${opts.nodeId}` : ''}`
}

// Server-only: the name shown for an account.
export async function getUserName(userId) {
  const user = typeof userId === 'string' && await Meteor.users.findOneAsync({ _id: userId }, { fields: { isAnonymous: 1, profile: 1, emails: 1 } })
  if (!user) return ''
  let userName = user.isAnonymous
    ? 'Guest'
    : `${user.profile?.firstName} ${user.profile?.lastName}`.replace(/undefined/gi, '').trim()
  if (userName === '') userName = user.emails?.[0]?.address?.split('@')[0] || ''
  return userName
}

// Names an account. A guest becomes a registered account here, and only by choosing its own
// password in the same call (sent over the app's TLS connection like any sign-up form).
method[CONSTANTS.methods.users.identify] = async (opts) => {
  check(opts, Match.ObjectIncluding({
    firstName: Match.Maybe(String), lastName: Match.Maybe(String), email: Match.Maybe(String),
    password: Match.Maybe(String),
  }))
  const user = await Meteor.userAsync()
  if (user) {
    // A guest from before a self-hosted server had setup links saves itself only after setup.
    if (user.isAnonymous && await setupRequired()) throw new Meteor.Error('not-set-up', NOT_SET_UP_MESSAGE)
    if (user.isAnonymous && !(opts.password?.length >= 6)) {
      throw new Meteor.Error('password-required', 'Choose a password to save your account.')
    }
    if (user.isAnonymous && isSharedGuestPassword(opts.password)) {
      throw new Meteor.Error('password-required', 'Choose another password to save your account.')
    }
    const updateUser = {
      isAnonymous: false,
      profile: {
        firstName: user.profile?.firstName || '',
        lastName: user.profile?.lastName || '',
        transcribeOnStart: true,
        audioMutedOnStart: false,
        // The first run's answer (methods/first-slate.js) comes with the guest into the account.
        ...(user.profile?.start && { start: user.profile.start }),
        // So does how many start page tiles they keep (server/start): the tiles are the account's own (its id does not
        // change), and /new keeps showing them under "Yours".
        ...(Number.isInteger(user.profile?.startTiles) && user.profile.startTiles > 0 && { startTiles: user.profile.startTiles }),
      },
    }
    if (opts.firstName) {
      updateUser.profile.firstName = opts.firstName
    }
    if (opts.lastName) {
      updateUser.profile.lastName = opts.lastName
    }
    if (opts.email) {
      updateUser['emails.0.address'] = opts.email
      if (opts.email !== user.emails?.[0]?.address) updateUser['emails.0.verified'] = false
    }
    if (user.isAnonymous) await Accounts.setPasswordAsync(user._id, opts.password, { logout: false })
    await Meteor.users.updateAsync(
      { _id: Meteor.userId() },
      { $set: updateUser }
    )
    return sendVerification(user._id)
  }
  return false
}

// The name what someone publishes credits ("How should we credit you?", asked as they submit to the
// library when their account has no name): saved to their profile. A guest has no profile to name.
method[CONSTANTS.methods.users.setCreditName] = async function setCreditName(text) {
  check(text, String)
  const user = this.userId && await Meteor.users.findOneAsync(this.userId, { fields: { isAnonymous: 1 } })
  if (!user) throw new Meteor.Error('sign-in', 'Sign in first.')
  if (user.isAnonymous) throw new Meteor.Error('sign_in_to_publish', 'Sign up to publish to the library. Your slates come with you.')
  const read = readCreditName(text)
  if (read.problem) throw new Meteor.Error('invalid-name', read.problem)
  await Meteor.users.updateAsync({ _id: user._id }, { $set: { 'profile.firstName': read.firstName, 'profile.lastName': read.lastName } })
  return { name: read.name }
}

method[CONSTANTS.methods.users.certifyForEducation] = async (opts) => {
  if (
    await isInstanceAdmin(Meteor.userId())
  ) {
    const curUser = await Meteor.users.findOneAsync({ _id: opts.userId })
    if (curUser) {
      if (curUser.orgId) {
        await Organizations.updateAsync(
          { _id: curUser.orgId },
          { $set: { isEducationInstitution: !curUser.isEducationCertified } }
        )
      }
      const updateUser = {
        isEducationCertified: !curUser.isEducationCertified,
        profile: {
          educationInstitution: opts.institution ?? '',
          educationAddress: opts.address ?? '',
        },
      }
      await Meteor.users.updateAsync(
        { _id: opts.userId },
        { $set: updateUser, $unset: { requestingEducationCertification: true } }
      )
      return updateUser.isEducationCertified
    }
    return false
  }
  return false
}

method[CONSTANTS.methods.users.requestEducationCertification] = async (
  opts
) => {
  const user = await Meteor.userAsync()
  if (user) {
    let org = null
    const profileUpdate = {
      educationInstitution: opts?.institution ?? '',
      educationAddress: opts?.address ?? '',
    }
    if (user.orgId) {
      org = await Organizations.findOneAsync({ _id: user.orgId })
    }
    if (user.isEducationCertified) {
      if (org?.isEducationInstitution) {
        return {
          result: CONSTANTS.educationCertification.requestStatuses.CERTIFIED,
          reason: 'You and your org are ALREADY certified for education',
        }
      }
      await Organizations.updateAsync(
        { _id: user.orgId },
        { $set: { isEducationInstitution: true, ...profileUpdate } }
      )
      return {
        result: CONSTANTS.educationCertification.requestStatuses.CERTIFIED,
        reason: 'You and your org are ALREADY certified for education',
      }
    }
    if (org?.isEducationInstitution) {
      // org has already been certified, so this user should just be set to certified
      await Meteor.users.updateAsync(
        { _id: Meteor.userId() },
        {
          $set: {
            isEducationCertified: true,
            profile: profileUpdate,
          },
        }
      )
      return {
        result: CONSTANTS.educationCertification.requestStatuses.CERTIFIED,
        reason: 'Your org are ALREADY certified for education',
      }
    }
    // the user is not certified, may or may not have an org
    // so note that the request was received
    await Meteor.users.updateAsync(
      { _id: Meteor.userId() },
      {
        $set: {
          requestingEducationCertification: true,
        },
      }
    )
    return {
      result: CONSTANTS.educationCertification.requestStatuses.PENDING,
      reason: 'Your request has been received',
    }
  }
  return {
    result: 'UNAUTHORIZED',
    reason: 'Unauthorized',
  }
}

method[CONSTANTS.methods.users.resetPassword] = async (opts) => {
  check(opts, Match.ObjectIncluding({ email: String }))
  if (opts.email) {
    const user = await Meteor.users.findOneAsync({
      'emails.0.address': opts.email,
    }, { fields: { _id: 1 } })
    if (user) {
      await Accounts.sendResetPasswordEmail(user._id, opts.email)
      return true
    }
    return false
  }
  return false
}

// only for uber admins
method[CONSTANTS.methods.users.search] = async (opts) => {
  if (
    await isInstanceAdmin(Meteor.userId())
  ) {
    check(opts.search, String)
    const re = { $regex: opts.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
    const andClause = [
      {
        $or: [
          { 'profile.firstName': re },
          { 'profile.lastName': re },
          { 'emails.0.address': re },
        ],
      },
    ]
    switch (opts?.filter) {
      case CONSTANTS.educationCertification.requestStatuses.PENDING: {
        andClause.push({ requestingEducationCertification: true })
        break
      }
      case CONSTANTS.educationCertification.requestStatuses.CERTIFIED: {
        andClause.push({ isEducationCertified: true })
        break
      }
    }
    // A team import waiting for confirmation is hidden: its placeholder people are not listed.
    const hiddenTeams = await Organizations.find({ hidden: true }, { fields: { _id: 1 } }).fetchAsync()
    if (hiddenTeams.length) andClause.push({ orgId: { $nin: hiddenTeams.map((team) => team._id) } })
    const all = await Meteor.users
      .find({
        $and: andClause,
      }, { fields: { profile: 1, emails: 1, orgId: 1, isEducationCertified: 1, requestingEducationCertification: 1, createdAt: 1 } })
      .fetchAsync()
    return all.splice(0, 100)
  }
  return null
}

// Two questions only. Whether an address is taken (the registration and team email checks,
// which anyone may ask), and, for a team member, the member's slate count (which only a team
// admin of the same team may ask). An account document is never returned.
method[CONSTANTS.methods.users.get] = async function getUsers(opts) {
  check(opts, Match.OneOf(
    { email: String, count: true },
    { _id: String, includeSlateCounts: true },
  ))
  if (opts.email) return Meteor.users.find({ 'emails.0.address': opts.email }).countAsync()
  const actor = this.userId && await Meteor.users.findOneAsync(this.userId, { fields: { orgId: 1 } })
  if (!actor?.orgId || !await AuthManager.userHasClaim(actor._id, [CONSTANTS.claims.canRemoveUsers._id, CONSTANTS.claims.canViewUsers._id])) return null
  const member = await Meteor.users.findOneAsync({ _id: opts._id, orgId: actor.orgId }, { fields: { profile: 1, emails: 1 } })
  if (!member) return null
  return [{ user: member, slateCount: await Slates.find({ userId: member._id }).countAsync() }]
}

method[CONSTANTS.methods.users.getTokenByEmailForTesting] = async (opts) => {
  if (['dev', 'test'].includes(Meteor.settings.public.env)) {
    const user = await Meteor.users.findOneAsync({
      'emails.0.address': opts.email,
    })
    switch (opts.type) {
      case 'verifyEmail': {
        return user.services.email.verificationTokens[0].token
      }
      default: {
        return 'Unknown'
      }
    }
  } else {
    return null
  }
}

// An emailed one-time login link is the only thing a browser may ask for, and only for an
// address: the link goes to that mailbox, never back to the caller.
method[CONSTANTS.methods.users.generateSpecialUseLoginToken] = async function (opts = {}) {
  if (typeof opts.email !== 'string' || !opts.email.includes('@')) return null
  return issueLoginToken({ email: opts.email.trim(), asEmail: true })
}

// Server-only: a login link for the signed embed and API hooks.
export async function createApiLoginLink({ userId, promptHash, prompt } = {}) {
  if (typeof userId !== 'string' || !userId) return null
  return issueLoginToken({ userId, promptHash, prompt })
}

async function issueLoginToken(opts) {
  if (opts.email || opts.userId) {
    const query = opts.userId
      ? { _id: opts.userId }
      : { 'emails.0.address': opts.email }
    const user = await Meteor.users.findOneAsync(query)
    if (user) {
      // create the login token
      // Creates a stamped login token
      const loginToken = Accounts._generateStampedLoginToken()

      /**
       * Hashes the stamped login token and inserts the stamped login token
       * to the user with the id specified, adds it to the field
       * services.resume.loginTokens.$.hashedToken.
       * (you can use Accounts._hashLoginToken(stampedLoginToken.token)
       * to get the same token that gets inserted)
       */
      await Accounts._insertLoginToken(user._id, loginToken)
      const llId = Random.id()
      if (opts.asEmail) {
        await LoginLinks.insertAsync({
          _id: llId,
          userId: user._id,
          // the link goes to this mailbox, so opening it confirms the address
          email: opts.email,
          createdAt: new Date(),
          token: loginToken.token,
        })
        const mail = loginLinkEmail({ firstName: firstNameOf(user), url: `${Meteor.settings.public.baseUrl}/login-link/${llId}`, logoUrl: emailLogoUrl() })
        await Email.sendAsync({
          from: Meteor.settings.mailFrom || 'no-reply@slatebox.com',
          to: opts.email,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        })
        return true
      }
      // everything else is an embed or API
      await APILinks.insertAsync({
        _id: llId,
        userId: user._id,
        created: Date.now(),
        token: loginToken.token,
        promptHash: opts.promptHash,
        prompt: opts.prompt,
        imageUrl: null,
      })
      return llId
    }
  }
  return null
}

method[CONSTANTS.methods.users.attemptLoginWithLink] = async (opts) => {
  if (opts.token) {
    if (typeof opts.token !== 'string') return null
    const ll = await LoginLinks.findOneAsync({ _id: opts.token })
    // A guest's Pro purchase with an address that already had an account (pro-claim.mjs): the link
    // went only to that address, so opening it signs its owner in and moves the Pro there. Once.
    if (ll?.mergeFrom) {
      const removed = await LoginLinks.rawCollection().deleteOne({ _id: ll._id })
      if (removed.deletedCount !== 1 || !mergeLinkLive(ll, Date.now())) return null
      try {
        await mergePurchase({ guestId: ll.mergeFrom, targetId: ll.userId })
      } catch (error) {
        // Stripe could not be reached: the link stays usable, nothing was moved halfway that a retry would not finish
        await LoginLinks.rawCollection().insertOne(ll).catch(() => {})
        throw new Meteor.Error('merge-failed', 'We could not move Slatebox Pro just now. Open the link again in a minute.')
      }
      await Meteor.users.updateAsync({ _id: ll.userId, 'emails.address': ll.email }, { $set: { 'emails.$.verified': true } })
      // the address is proven: passkeys added before it was confirmed go (passkeys/core.mjs)
      await removePasskeysAddedUnverified(ll.userId, 'sign-in-link')
      const stamped = Accounts._generateStampedLoginToken()
      await Accounts._insertLoginToken(ll.userId, stamped)
      return stamped.token
    }
    if (ll) {
      await LoginLinks.removeAsync({ _id: opts.token })
      // The emailed link reached that mailbox: the address is confirmed, if it is still the account's.
      if (ll.email) {
        await Meteor.users.updateAsync({ _id: ll.userId, 'emails.0.address': ll.email }, { $set: { 'emails.0.verified': true } })
        // and passkeys added before it was confirmed go, as a password reset removes them (passkeys/core.mjs)
        await removePasskeysAddedUnverified(ll.userId, 'sign-in-link')
      }
      return ll.token
    }
  }
  return null
}

method[CONSTANTS.methods.users.extractUserAndOrgNamesByResetToken] = async (
  token
) => {
  if (typeof token !== 'string' || !token) return null
  const user = await Meteor.users.findOneAsync({
    $or: [
      { 'services.password.reset.token': token },
      { 'services.password.enroll.token': token },
    ],
  }, { fields: { 'profile.firstName': 1, 'profile.lastName': 1, orgId: 1 } })
  const orgName =
    user && user.orgId
      ? (await Organizations.findOneAsync({ _id: user.orgId }))?.name ?? null
      : null
  return user
    ? {
        name: `${user.profile.firstName} ${user.profile.lastName}`,
        orgName,
      }
    : null
}

// A person updates their own names and call settings. A team member with canEditUsers may also
// update another member of the same team, including the address. The team is never changed
// here: organizations.create puts its creator in the new team.
method[CONSTANTS.methods.users.update] = async function updateUser(opts) {
  check(opts, Match.ObjectIncluding({
    userId: String, firstName: Match.Maybe(String), lastName: Match.Maybe(String), email: Match.Maybe(String),
    audioMutedOnStart: Match.Maybe(Boolean), transcribeOnStart: Match.Maybe(Boolean), orgId: Match.Maybe(String),
  }))
  const actor = this.userId && await Meteor.users.findOneAsync(this.userId, { fields: { orgId: 1 } })
  if (!actor) return 'You do not have permission to update this user'
  const self = opts.userId === actor._id
  if (!self && !(actor.orgId && await AuthManager.userHasClaim(actor._id, [CONSTANTS.claims.canEditUsers._id]))) {
    return 'You do not have permission to update this user'
  }
  const user = await Meteor.users.findOneAsync(self ? { _id: actor._id } : { _id: opts.userId, orgId: actor.orgId })
  if (!user) return 'You do not have permission to update this user'
  if (opts.email && !self) {
    // A person a team import brought has no address until the import invites them
    // (server/team-export/invite.mjs, which checks the address against every account here).
    if (!user.emails?.[0]?.address) return 'This person has not been invited yet. Invite them from the team import.'
    if (user.emails[0].address === opts.email) return "The user's email is unchanged."
    await Accounts.addEmailAsync(user._id, opts.email, false)
    if (user.emails[0].address.toLowerCase() !== opts.email.toLowerCase()) await Accounts.removeEmail(user._id, user.emails[0].address)
    const sent = await sendVerification(user._id)
    if (sent !== true) return "The user's email is updated. Email delivery is disabled on this instance."
    return `The user's email is updated - a verification email was sent to ${opts.email}.`
  }
  const set = {}
  for (const key of ['firstName', 'lastName', 'audioMutedOnStart', 'transcribeOnStart']) {
    if (opts[key] !== undefined && opts[key] !== null) set[`profile.${key}`] = opts[key]
  }
  if (Object.keys(set).length > 0) await Meteor.users.updateAsync({ _id: user._id }, { $set: set })
  return `The user was successfully updated`
}

async function inviteTeam(opts = {}, resend) {
  const actor = await Meteor.userAsync()
  const orgId = actor?.orgId
  const claimIds = [CONSTANTS.claims.canAddUsers._id, CONSTANTS.claims.admin._id]
  if (!orgId || (opts.orgId && opts.orgId !== orgId) ||
      !await Permissions.findOneAsync({ userId: actor._id, orgId, claimId: { $in: claimIds } })) {
    throw new Meteor.Error('invite-denied', 'Only a team inviter can send enrollment email for this team.')
  }
  const org = await Organizations.findOneAsync(orgId, { fields: { _id: 1 } })
  if (!org) throw new Meteor.Error('team-unavailable', 'The team is unavailable.')
  // Serialize email-token rotation across app replicas.
  // A stopped process releases its claim automatically after the lease expires.
  const lock = Random.id()
  const lease = () => ({ id: lock, until: Date.now() + 5 * 60 * 1000 })
  const acquired = await Organizations.updateAsync({ _id: orgId, $or: [
    { invitationLease: { $exists: false } }, { 'invitationLease.until': { $lte: Date.now() } },
  ] }, { $set: { invitationLease: lease() } })
  if (!acquired) throw new Meteor.Error('invite-busy', 'Team invitations are being processed. Try again shortly.')
  const refresh = async () => {
    if (!await Organizations.updateAsync({ _id: orgId, 'invitationLease.id': lock }, { $set: { invitationLease: lease() } })) {
      throw new Meteor.Error('invite-busy', 'The invitation request expired. Try again.')
    }
  }
  const fields = { orgId: 1, emails: 1, isAnonymous: 1, 'services.password.bcrypt': 1, 'services.password.argon2': 1, teamEnrollmentSentAt: 1 }
  try {
    const delivered = await deliverTeamInvitations({
      org, invites: opts.invites, memberIds: resend ? opts.users?.map(u => u?._id) || [] : undefined,
      io: {
        error: (code, message) => new Meteor.Error(code, message),
        mailAvailable: enrollmentMailAvailable,
        byTeamId: (teamId, id) => Meteor.users.findOneAsync({ _id: id, orgId: teamId }, { fields }),
        byEmail: email => Accounts.findUserByEmail(email, { fields }),
        create: async (teamId, { email, firstName, lastName }) => {
          await refresh()
          return createTrustedUser({ email, profile: { firstName, lastName } }, { orgId: teamId })
        },
        send: async (id, email) => {
          await refresh()
          await Accounts.sendEnrollmentEmail(id, email)
        },
        markSent: (teamId, id) => Meteor.users.updateAsync({ _id: id, orgId: teamId }, { $set: { teamEnrollmentSentAt: new Date() } }),
      },
    })
    // a team billed for Slatebox Business pays for a member once they accept (business-billing.mjs
    // acceptedMember; their sign-in updates the count): an invitation alone changes nothing, so
    // this only catches a count that had drifted
    if (!resend) membersChanged(orgId, { recordedFirst: true })
    // the first team invitation counts in the growth funnel (Slatebox Cloud only)
    if (!resend) growthStep(actor._id, 'invite')
    return delivered
  } finally {
    await Organizations.updateAsync({ _id: orgId, 'invitationLease.id': lock }, { $unset: { invitationLease: 1 } })
  }
}

method[CONSTANTS.methods.users.invite] = opts => inviteTeam(opts, false)
method[CONSTANTS.methods.users.resendEnrollment] = opts => inviteTeam(opts, true)

method[CONSTANTS.methods.users.changeEmail] = async (opts) => {
  const user = await Meteor.userAsync()
  if (user && !user.isAnonymous) {
    const previousEmail = user.emails[0].address
    await Accounts.addEmailAsync(user._id, opts.email)
    if (previousEmail.toLowerCase() !== opts.email.toLowerCase()) await Accounts.removeEmail(user._id, previousEmail)
    return sendVerification(user._id)
  }
}

method[CONSTANTS.methods.users.delete] = async function removeOwnAccount() {
  const user = await Meteor.userAsync()
  if (!user || user.orgId) return false
  // The balance is refunded to the card first, then Slatebox Pro ends at once (no refund of the
  // current period), then the account is removed. A failed refund leaves Pro on and removes
  // nothing; a failure to end Pro removes nothing.
  await removeAccountAfterRefund({
    refund: () => refundBalance('user:' + user._id),
    endPro: () => endProForRemoval(user).catch(() => { throw new Meteor.Error('pro-end-failed', PRO_END_FAILED) }),
    remove: async () => true,
  }).catch(error => { throw error instanceof Meteor.Error ? error : new Meteor.Error('refund-failed', error.message) })
  const owner = { userId: user._id }
  await JoinedSlates.removeAsync(user._id)
  await SlateApiTokens.removeAsync(owner)
  await SlateOperationRuns.removeAsync(owner)
  await Slates.removeAsync(owner)
  await SlatePresentations.removeAsync({ ...owner, workshop: { $exists: true } })
  await Messages.removeAsync(owner)
  // the person's own AI connections, keys and choices
  await ProviderKeys.removeAsync({ ownerType: 'user', ownerId: user._id })
  await AIChoices.removeAsync({ _id: 'user:' + user._id })
  // About you: every fact they kept and their personalization switches
  await removePersonalData(user._id)
  // their passkeys (the devices keep theirs until the browser is told the account is gone)
  await removePasskeysOf(user._id)
  // what the growth funnel kept for the account (its source and steps, and its raw events)
  await forgetGrowthOf(user._id)
  // Meteor Accounts normally closes every connection watching a removed login token.
  // Release only this connection's observer so it can receive the deletion result.
  const connection = this.connection
  const token = connection && Accounts._getLoginToken(connection.id)
  if (token) Accounts._setLoginToken(user._id, connection, null)
  try {
    await Meteor.users.removeAsync({ _id: user._id })
  } catch (error) {
    if (token) Accounts._setLoginToken(user._id, connection, token)
    throw error
  }
  if (connection) await this.setUserId(null)
  return true
}

// A team member with canEditUsers changes the team roles of members of the same team. The
// target is read from the database, never from the request, and uberMensch is never granted.
method[CONSTANTS.methods.users.changeRoles] = async function changeRoles(opts) {
  check(opts, Match.ObjectIncluding({ users: [Match.ObjectIncluding({ userId: String, claimIds: [String], action: Match.OneOf('add', 'delete') })] }))
  const user = this.userId && await Meteor.users.findOneAsync(this.userId, { fields: { orgId: 1 } })
  if (!user?.orgId || !await AuthManager.userHasClaim(user._id, [CONSTANTS.claims.canEditUsers._id])) return false
  const caller = await teamPerson(user._id)
  for (const u of opts.users) {
    if (u.claimIds.includes(CONSTANTS.claims.uberMensch._id)) throw new Meteor.Error('roles-denied', 'That role cannot be given.')
    const found = await teamPerson(u.userId)
    const member = found?.orgId === user.orgId ? found : null
    // never the owner, never yourself, the admin claim only by an admin, never uberMensch (server/team-guard.mjs)
    const refusal = roleChangeRefusal(caller, member, u)
    if (refusal) throw new Meteor.Error('roles-denied', refusal)
    const claims = await Claims.find({ _id: { $in: u.claimIds } }).fetchAsync()
    if (claims.length !== u.claimIds.length) {
      throw new Meteor.Error(`You've tried to add or remove role(s) that do not exist: ${JSON.stringify(
        u.claimIds.filter((r) => !claims.some((c) => c._id === r)))}`)
    }
    const team = { orgId: user.orgId, userId: member._id }
    if (u.action === 'add') {
      // the admin claim includes the people claims, so it replaces them; slate claims and the
      // server administrator claim stay
      if (u.claimIds[0] === CONSTANTS.claims.admin._id) await Permissions.removeAsync({ ...team, claimId: { $in: clearedByAdmin() } })
      for (const c of claims) {
        const q = { ...team, claimId: c._id }
        if ((await Permissions.find(q).countAsync()) === 0) await Permissions.insertAsync(q)
      }
    } else {
      await Permissions.removeAsync({ ...team, claimId: { $in: claims.map((c) => c._id) } })
    }
    await Meteor.users.updateAsync({ _id: member._id }, { $set: { roles: u.claimIds } })
  }
  return true
}

// Who may ask how often: the methods that send mail or make accounts, per connection.
const limited = [
  [CONSTANTS.methods.users.resetPassword, 5, 60000],
  [CONSTANTS.methods.users.generateSpecialUseLoginToken, 5, 60000],
  [CONSTANTS.methods.users.identify, 10, 60000],
  [CONSTANTS.methods.users.setCreditName, 10, 60000],
  [CONSTANTS.methods.users.changeEmail, 5, 60000],
  [CONSTANTS.methods.users.createAnonymous, 10, 60000],
  [CONSTANTS.methods.users.get, 30, 60000],
]
for (const [name, count, interval] of limited) {
  DDPRateLimiter.addRule({ type: 'method', name, connectionId: () => true }, count, interval)
}

Meteor.methods(method)
