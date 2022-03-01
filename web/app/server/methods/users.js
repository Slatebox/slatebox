/* eslint-disable no-underscore-dangle */
// methods
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import CONSTANTS from '../../imports/api/common/constants'
import AuthManager from '../../imports/api/common/AuthManager'

import {
  Permissions,
  Claims,
  Organizations,
  Slates,
  Messages,
  SlateAccess,
} from '../../imports/api/common/models'

const method = {}
method[CONSTANTS.methods.users.createAnonymous] = async (opts) => {
  // HTTP_FORWARDED_COUNT=1 should be set
  const email = `user@${Random.id()}.com`
  const base = {
    isAnonymous: true,
    password: CONSTANTS.anonUserPwd,
    email,
    profile: { name: '' },
    planType: 'free',
  }
  if (opts && opts.orgId) {
    Object.assign(base, { orgId: opts.orgId })
  }
  Accounts.createUser(base)

  return email
}

method[CONSTANTS.methods.users.impersonate] = async (email) => {
  if (
    AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.uberMensch._id])
  ) {
    const usr = Meteor.users.findOne({ 'emails.0.address': email })
    if (usr) {
      this.setUserId(usr._id)
    } else {
      throw new Meteor.Error(
        'impersonateUser.userDoesntExist',
        'Cannot impersonate user if not exist'
      )
    }
  } else {
    throw new Meteor.Error(
      'impersonateUser.noPermission',
      'You do not have permission'
    )
  }
}

method[CONSTANTS.methods.users.getSlateAccessUrl] = async (opts) => {
  if (opts.slateId) {
    const root = `/canvas`
    const slate = Slates.findOne({ _id: opts.slateId })
    let type = 'public'
    if (slate.options.isPrivate) {
      type = 'private'
    } else if (slate.options.isUnlisted) {
      type = 'unlisted'
    }
    if (Meteor.userId() && Meteor.userId() === slate.userId) {
      return `${root}/${slate.shareId}/${opts.nodeId}`
    }
    const slateAccess = SlateAccess.findOne({
      slateId: opts.slateId,
      type,
    })
    if (slateAccess) {
      return `${root}/${slateAccess.accessKey}/${opts.nodeId}`
    }
  }
  return null
}

method[CONSTANTS.methods.users.getUserName] = async (opts) => {
  // HTTP_FORWARDED_COUNT=1 should be set
  const user = Meteor.users.findOne({ _id: opts.userId })
  return user?.isAnonymous
    ? 'Guest'
    : `${user?.profile?.firstName} ${user?.profile?.lastName}`.replace(
        /undefined/gi,
        ''
      ) || user?.emails[0].address.split(' ')[0]
}

method[CONSTANTS.methods.users.identify] = async (opts) => {
  if (Meteor.user()) {
    const updateUser = {
      isAnonymous: false,
      profile: {
        firstName: Meteor.user().profile?.firstName || '',
        lastName: Meteor.user().profile?.lastName || '',
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
    }
    Meteor.users.update({ _id: Meteor.userId() }, { $set: updateUser })
    Accounts.sendVerificationEmail(Meteor.userId())
    return true
  }
  return false
}

method[CONSTANTS.methods.users.resetPassword] = async (opts) => {
  if (opts.email) {
    const user = Meteor.users.findOne({ 'emails.0.address': opts.email })
    if (user) {
      Accounts.sendResetPasswordEmail(user._id, opts.email)
      return true
    }
    return false
  }
  return false
}

// only for uber admins
method[CONSTANTS.methods.users.search] = async (opts) => {
  if (
    AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.uberMensch._id])
  ) {
    const re = { $regex: opts.search, $options: 'gi' }
    const all = Meteor.users
      .find({
        $and: [
          {
            $or: [
              { 'profile.firstName': re },
              { 'profile.lastName': re },
              { 'emails.0.address': re },
            ],
          },
        ],
      })
      .fetch()
    return all.splice(0, 100)
  }
  return null
}

method[CONSTANTS.methods.users.get] = async (opts) => {
  // needs to be open for registration check of the same email
  if (opts.email || opts._id) {
    const find = {}
    if (opts.email) {
      find['emails.0.address'] = opts.email
    }
    if (opts._id) {
      find._id = opts._id
    }
    if (opts.count) {
      return Meteor.users.find(find).count()
    }
    const users = Meteor.users.find(find).fetch()
    if (opts.includeSlateCounts) {
      const slates = Slates.find(
        { userId: { $in: users.map((u) => u._id) } },
        { fields: { userId: 1, _id: 1 } }
      ).fetch()
      return users.map((u) => ({
        user: u,
        slateCount: slates.filter((s) => s.userId === u._id).length,
      }))
    }
    return users
  }
  return null
}

method[CONSTANTS.methods.users.getTokenByEmailForTesting] = async (opts) => {
  if (Meteor.settings.public.env === 'dev') {
    const user = Meteor.users.findOne({ 'emails.0.address': opts.email })
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

method[CONSTANTS.methods.users.extractUserAndOrgNamesByResetToken] = async (
  token
) => {
  const user = Meteor.users.findOne({
    $or: [
      { 'services.password.reset.token': token },
      { 'services.password.enroll.token': token },
    ],
  })
  console.log('got user by token', user)
  const orgName =
    user && user.orgId ? Organizations.findOne({ _id: user.orgId }).name : null
  return user
    ? {
        name: `${user.profile.firstName} ${user.profile.lastName}`,
        orgName,
      }
    : null
}

method[CONSTANTS.methods.users.update] = async (opts) => {
  if (
    Meteor.user() &&
    (Meteor.userId() === opts.userId ||
      AuthManager.userHasClaim(Meteor.userId(), [
        CONSTANTS.claims.canEditUsers._id,
      ]))
  ) {
    const user = Meteor.users.findOne(opts.userId)
    const upd = {
      profile: {
        firstName: user.profile?.firstName || '',
        lastName: user.profile?.lastName || '',
      },
    }

    if (opts.orgId) {
      upd.orgId = opts.orgId
    }
    if (opts.firstName) {
      upd.profile.firstName = opts.firstName
    }
    if (opts.lastName) {
      upd.profile.lastName = opts.lastName
    }
    if (opts.email) {
      const existing = Meteor.users.findOne({ _id: opts.userId })
      if (existing && existing.emails[0].address !== opts.email) {
        Accounts.removeEmail(opts.userId, existing.emails[0].address)
        Accounts.addEmail(opts.userId, opts.email, false)
        Accounts.sendVerificationEmail(opts.userId)
      }
      return `The user's email is updated - a verification email was sent to ${opts.email}.`
    }
    if (Object.keys(upd).length > 0) {
      Meteor.users.update({ _id: opts.userId }, { $set: upd })
    }
    return `The user was successfully updated`
  }
  return `You do not have permission to update this user`
}

method[CONSTANTS.methods.users.invite] = async (opts) => {
  opts.invites.forEach((invite) => {
    const pkg = {
      orgId: opts.orgId,
      email: invite.email.toLowerCase(),
      profile: { firstName: invite.firstName, lastName: invite.lastName },
      intro: { firstView: true },
    }
    const userId = Accounts.createUser(pkg)
    Accounts.sendEnrollmentEmail(userId, opts.email)
  })

  let qtyUpdate = null
  if (Organizations.findOne({ _id: opts.orgId }).planType !== 'free') {
    qtyUpdate = Meteor.call(CONSTANTS.methods.stripe.updateSubscriptionQuantity)
  }

  return { success: true, qtyUpdate }
}

method[CONSTANTS.methods.users.resendEnrollment] = async (opts) => {
  for (const user of opts.users) {
    const resEmail = Accounts.sendEnrollmentEmail(
      user._id,
      user.emails[0].email
    )
  }
  return { success: true }
}

method[CONSTANTS.methods.users.changeEmail] = async (opts) => {
  if (Meteor.user() && !Meteor.user().isAnonymous) {
    const previousEmail = Meteor.user().emails[0].address
    Accounts.removeEmail(Meteor.userId(), previousEmail)
    Accounts.addEmail(Meteor.userId(), opts.email)
    Accounts.sendVerificationEmail(Meteor.userId())
    return true
  }
}

method[CONSTANTS.methods.users.delete] = async () => {
  if (Meteor.user() && !Meteor.user().orgId) {
    Slates.remove({ userId: Meteor.userId() })
    Messages.remove({ userId: Meteor.userId() })
    Meteor.users.remove({ _id: Meteor.userId() })
    return true
  }
  return false
}

method[CONSTANTS.methods.users.changeRoles] = async (opts) => {
  if (
    Meteor.user() &&
    AuthManager.userHasClaim(Meteor.userId(), [
      CONSTANTS.claims.canEditUsers._id,
    ])
  ) {
    opts.users.forEach((u) => {
      if (u.orgId === Meteor.user().orgId) {
        const claims = Claims.find({ _id: { $in: u.claimIds } }).fetch()
        if (claims.length !== u.claimIds.length) {
          throw new Meteor.Error(
            `You've tried to add or remove role(s) that do not exist: ${JSON.stringify(
              u.claimIds.filter((r) => r !== claims.map((c) => c._id))
            )}`
          )
        } else {
          switch (u.action) {
            case 'add':
              if (u.claimIds[0] === 'admin') {
                Permissions.remove({ orgId: opts.orgId, userId: u.userId })
              }
              claims.forEach((c) => {
                // only if it doesn't exist
                const q = {
                  orgId: Meteor.user().orgId,
                  userId: u.userId,
                  claimId: c._id,
                }
                if (Permissions.find(q).count() === 0) {
                  Permissions.insert(q)
                }
              })
              break
            case 'delete':
              Permissions.remove({
                orgId: Meteor.user().orgId,
                userId: u.userId,
                claimId: { $in: claims.map((c) => c._id) },
              })
              break
          }
        }
        Meteor.users.update({ _id: u._id }, { $set: { roles: u.claimIds } })
      }
    })
    return true
  }
  return false
}

Meteor.methods(method)
