/* eslint-disable no-plusplus */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-underscore-dangle */
// methods.js
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../imports/api/common/constants'
import {
  GuestViews,
  Organizations,
  Permissions,
  Slates,
  ArchivedSlates,
  PricingTiers,
  Messages,
} from '../../imports/api/common/models'
import AuthManager from '../../imports/api/common/AuthManager'

const method = {}
method[CONSTANTS.methods.organizations.create] = async (opts) => {
  if (Meteor.userId()) {
    const orgId = Random.id()
    Organizations.insert({
      _id: orgId,
      name: opts.name,
      planType: 'free',
      createdByUserId: opts.createdByUserId,
      createdOn: new Date().valueOf(),
    })
    // always make the creator the owner and admin and remove planType from user henceforth
    Meteor.users.update(
      { _id: opts.createdByUserId },
      { $set: { isOrgOwner: true }, $unset: { planType: true } }
    )
    Slates.update(
      { userId: Meteor.userId() },
      { $set: { orgId } },
      { multi: true }
    ) // retrofit previously created slates by this user
    Permissions.insert({
      userId: opts.createdByUserId,
      orgId,
      claimId: CONSTANTS.claims.admin._id,
    })
    return orgId
  }
  return null
}

method[CONSTANTS.methods.organizations.getCancellationImplications] =
  async () => {
    const otherUsers = Meteor.users
      .find({ orgId: Meteor.user().orgId })
      .fetch()
      .filter((u) => u._id !== Meteor.userId())
    const otherSlates = Slates.find({
      userId: { $in: otherUsers.map((u) => u._id) },
    }).count()
    const mySlates = Slates.find({ userId: Meteor.userId() }).count()
    const orgOwner = Meteor.users.findOne({
      orgId: Meteor.user().orgId,
      isOrgOwner: true,
    })
    return {
      otherUsers: otherUsers.length,
      otherSlates,
      mySlates,
      orgOwner: {
        name: `${orgOwner.profile.firstName} ${orgOwner.profile.lastName}`,
        email: orgOwner.emails[0].address,
        id: orgOwner._id,
      },
    }
  }

method[CONSTANTS.methods.organizations.delete] = async () => {
  if (Meteor.user() && Meteor.user().orgId && Meteor.user().isOrgOwner) {
    const implications = Meteor.call(
      CONSTANTS.methods.organizations.getCancellationImplications
    )
    if (implications.otherUsers === 0 && implications.otherSlates === 0) {
      // only thing left should be the slates for the user in question
      // archive all this user's slates
      // remove customer
      Slates.remove({ userId: Meteor.userId(), orgId: Meteor.user().orgId })

      GuestViews.remove({ slateOrgId: Meteor.user().orgId })

      Organizations.remove({ _id: Meteor.user().orgId })

      Messages.remove({ userId: Meteor.userId() })

      Meteor.users.remove({ _id: Meteor.userId() })

      return {
        success: true,
        reason: `Your team, slates, and account have all been completely removed. Thanks for trying Slatebox!`,
      }
    }
    return {
      success: false,
      reason: `You still have ${implications.otherUsers} team members and ${implications.otherSlates} slates for those team members that need to be removed prior to deleting your team account.`,
    }
  }
  return {
    success: false,
    reason: `Only team owners are allowed to remove teams`,
  }
}

method[CONSTANTS.methods.organizations.trackGuest] = async (opts) => {
  const entity = opts.slateOrgId
    ? Organizations.findOne({ _id: opts.slateOrgId })
    : Meteor.users.findOne({ _id: opts.slateOwner })
  const total = GuestViews.find(
    { orgId: opts.orgId, month: new Date().getMonth() + 1 },
    { fields: { _id: 1 } }
  ).fetch().length
  const slateOwner = Meteor.call(CONSTANTS.methods.users.getUserName, {
    userId: opts.slateOwner,
  })

  let allowGuestAccess = !opts.isUnlisted
  if (opts.isUnlisted) {
    const allowableGuestViews = PricingTiers.findOne({
      $or: [
        { 'monthly.priceId': entity.planType },
        { 'yearly.priceId': entity.planType },
      ],
    }).guestViewsPerMonth
    allowGuestAccess = total < allowableGuestViews
  }
  if (allowGuestAccess) {
    GuestViews.upsert(
      {
        _id: opts.guestCollaboratorId,
      },
      {
        slateOrgId: opts.slateOrgId,
        slateId: opts.slateId,
        slateOwnerUserId: opts.slateOwner,
        timestamp: new Date().valueOf(),
        month: new Date().getMonth() + 1,
        userId: opts.userId,
        orgId: opts.orgId,
        actualGuest: !opts.userId,
        guestCollaboratorId: opts.guestCollaboratorId,
        isUnlisted: opts.isUnlisted,
        isPublic: opts.isPublic,
      }
    )
    return { allow: true, slateOwnerUserName: slateOwner }
  }
  // put a message in the orgOwner's mailbox noting that this guest was rejected
  return { allow: false, slateOwnerUserName: slateOwner }
}

method[CONSTANTS.methods.organizations.guestViewReport] = async () => {
  if (
    (Meteor.user() &&
      Meteor.user().orgId &&
      AuthManager.userHasClaim(Meteor.userId(), [
        CONSTANTS.claims.admin._id,
      ])) ||
    (Meteor.user() && !Meteor.user().orgId && Meteor.user().planType !== 'free')
  ) {
    const rows = []
    /*
    {
      "_id" : "JE8DMxcowrQ8AhQvC",
      "slateOrgId" : "a5qcbP3tNkT5Yfeio",
      "slateId" : "df38c1671c53",
      "slateOwnerUserId" : "tyht9XPojB8i5zYcD",
      "timestamp" : 1626057160413,
      "month" : 7,
      "userId" : null,
      "orgId" : null,
      "actualGuest" : true,
      "guestCollaboratorId" : "JE8DMxcowrQ8AhQvC",
      "isUnlisted" : true,
      "isPublic" : false
    }
    */

    const gvQuery = Meteor.user().orgId
      ? { slateOrgId: Meteor.user().orgId }
      : { slateOwnerUserId: Meteor.userId() }
    const guestViews = GuestViews.find(gvQuery).fetch()
    const slatesAccessed = Slates.find({
      _id: { $in: guestViews.map((gv) => gv.slateId) },
    }).fetch()
    const slatesArchivedAccessed = ArchivedSlates.find({
      _id: { $in: guestViews.map((gv) => gv.slateId) },
    }).fetch()
    const usersAccessed = Meteor.users
      .find({ _id: { $in: guestViews.map((gv) => gv.userId) } })
      .fetch()
    const slateOwners = Meteor.users
      .find({ _id: { $in: guestViews.map((gv) => gv.slateOwnerUserId) } })
      .fetch()
    const orgsAccessed = Organizations.find({
      _id: { $in: guestViews.map((gv) => gv.orgId) },
    }).fetch()

    const entity = Meteor.user().orgId
      ? Organizations.findOne({ _id: Meteor.user().orgId })
      : Meteor.user()
    const allowableGuestViews = PricingTiers.findOne({
      $or: [
        { 'monthly.priceId': entity.planType },
        { 'yearly.priceId': entity.planType },
      ],
    }).guestViewsPerMonth
    const allowableGuestViewsOnProTeam = PricingTiers.findOne({
      useForProOrgGuestViewCount: true,
    }).guestViewsPerMonth
    const headers = ['Date', 'Type', 'Slate', 'Owner', 'Guest']
    const totalUnlistedViewsByMonth = {}
    const totalPublicViewsByMonth = {}

    guestViews.forEach((gv) => {
      let slateName = slatesAccessed.find((s) => s._id === gv.slateId)?.options
        ?.name
      if (!slateName) {
        slateName = slatesArchivedAccessed.find((s) => s._id === gv.slateId)
          ?.options?.name
      }
      if (!slateName) {
        slateName = '[Removed]'
      }
      let user = 'Guest'
      let foreignOrg = null
      const actUser = usersAccessed.find((u) => u._id === gv.userId)

      if (actUser && !actUser.isAnonymous) {
        user =
          actUser.profile &&
          actUser.profile.firstName &&
          actUser.profile.firstName.trim() !== ''
            ? `${actUser.profile.firstName} ${actUser.profile.lastName}`
            : actUser.emails[0].address.split('@')[0]
        if (actUser.orgId) {
          const forg = orgsAccessed.find((o) => o._id === actUser.orgId)
          foreignOrg = forg ? forg.name : '[Unknown]'
        }
      }
      let userDetails =
        gv.actualGuest || (actUser && actUser.isAnonymous) ? 'Anonymous' : user
      if (foreignOrg) {
        userDetails = `${userDetails} with ${foreignOrg}`
      }
      const type = gv.isUnlisted ? 'unlisted' : 'public'

      const owner = slateOwners.find((so) => so._id === gv.slateOwnerUserId)
      const slateOwner = owner
        ? owner.profile && owner.profile.firstName.trim() !== ''
          ? `${owner.profile.firstName} ${owner.profile.lastName}`
          : owner.emails[0].address.split('@')[0]
        : '[Removed]'

      rows.push([
        new Date(gv.timestamp).toLocaleDateString(),
        type,
        slateName,
        slateOwner,
        userDetails,
      ])

      if (gv.isUnlisted) {
        if (!totalUnlistedViewsByMonth[gv.month]) {
          totalUnlistedViewsByMonth[gv.month] = 0
        }
        totalUnlistedViewsByMonth[gv.month]++
      } else {
        if (!totalPublicViewsByMonth[gv.month]) {
          totalPublicViewsByMonth[gv.month] = 0
        }
        totalPublicViewsByMonth[gv.month]++
      }
    })

    // sort time desc
    rows.sort((a, b) => new Date(a[0]).valueOf() - new Date(b[0]).valueOf())

    return {
      headerRow: headers,
      dataRows: rows,
      allowableUnlistedViewsPerMonth: allowableGuestViews,
      allowableUnlistedViewsPerMonthOnProTeam: allowableGuestViewsOnProTeam,
      totalUnlistedViewsByMonth,
      totalPublicViewsByMonth,
      totalViews: rows.length,
    }
  }
}

Meteor.methods(method)
