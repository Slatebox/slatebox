/* eslint-disable no-underscore-dangle */
/* eslint-disable func-names */
import { Meteor } from 'meteor/meteor'
import { Match } from 'meteor/check'
import { canEditSlate, canReadSlate, findSlate } from './common/slate-access'
import { PLAN_FIELDS } from './metering/migrations.mjs'
import { runFields, runsSince } from '../imports/api/common/slate-operation-runs.mjs'
import CONSTANTS from '../imports/api/common/constants'
import {
  Tags,
  Messages,
  Slates,
  Collaboration,
  SlateOperationRuns,
  Organizations,
  Claims,
  Permissions,
  SlateAccess,
  Comments,
  ApprovalRequests,
  IconPacks,
  AIContent,
  Transcripts,
  ChatIntentions,
  OrganizationSettings,
} from '../imports/api/common/models'
import { templateCategories } from './bootstrap/template-categories.mjs'
import AuthManager from '../imports/api/common/AuthManager'
// agentPresence.forSlate: the agents saving to a slate, for anyone who may read it.
import './presence/publication'
// agentSuggestions.forSlate: what agents suggest on a slate, drawn live as ghosts on every screen.
import './agents/suggestions-publication'

Meteor.publish(CONSTANTS.publications.slateAccess, function () {
  if (this.userId) {
    return SlateAccess.find({
      $or: [{ userId: this.userId }, { owningUserId: this.userId }],
    })
  }
  this.ready()
  return null
})

Meteor.publish(CONSTANTS.publications.tags, function ({ types } = {}) {
  if (this.userId && Array.isArray(types) && types.every(type => typeof type === 'string')) {
    const others = types.filter(type => type !== 'template')
    const kinds = [{ type: { $in: others } }]
    if (types.includes('template')) {
      kinds.push({ type: 'template', title: { $in: templateCategories.map(tag => tag.title) } })
    }
    return Tags.find({ $or: kinds })
  }
  this.ready()
  return null
})

Meteor.publish(
  CONSTANTS.publications.aiContent,
  function (aid, isConversation) {
    if (this.userId && aid) {
      const query = {
        aid,
      }
      if (isConversation) {
        query.aiDerived = true
      }
      return AIContent.find(query)
    }
    this.ready()
    return null
  }
)

Meteor.publish(
  CONSTANTS.publications.slateOperationRuns,
  async function (shareId, since) {
    if (typeof shareId !== 'string' || !shareId) {
      this.ready()
      return null
    }
    // Every open canvas that may read the slate is sent the agent's saved edits and draws them
    // itself, a visitor with no account too (they used to wait for an account holder's canvas to
    // pass them on through the room). Only an editor is sent the words the person gave the agent.
    const slate = await findSlate({ shareId })
    const canEdit = await canEditSlate(this.userId, slate)
    if (!canEdit && !await canReadSlate(this.userId, slate)) {
      this.ready()
      return null
    }
    return SlateOperationRuns.find(runsSince(shareId, since), { fields: runFields(canEdit) })
  }
)

Meteor.publish(CONSTANTS.publications.iconPacks, async function () {
  if (this.userId) {
    const user = await Meteor.userAsync()
    const query = {
      $or: [
        {
          $and: [
            {
              userId: this.userId,
            },
            {
              visibility: 'private',
            },
          ],
        },
        {
          $and: [
            {
              visibility: 'public',
            },
          ],
        },
      ],
    }

    if (user?.orgId) {
      query.$or.push({
        $and: [
          {
            orgId: user.orgId,
          },
          {
            visibility: 'org',
          },
        ],
      })
    }
    // console.log(
    //   'getting iconPacks',
    //   JSON.stringify(query, null, 2),
    //   IconPacks.find(query).count()
    // )
    return IconPacks.find(query, { fields: { icons: 0 } })
  }
  return null
})

Meteor.publish(CONSTANTS.publications.users.me, function () {
  return Meteor.users.find(
    { _id: this.userId },
    {
      fields: {
        isAnonymous: 1,
        clientId: 1,
        orgId: 1,
        isOrgOwner: 1,
        createdAt: 1,
        roles: 1,
        isEducationCertified: 1,
        requestingEducationCertification: 1,
      },
    }
  )
})

Meteor.publish(CONSTANTS.publications.shareableSlate, async (slateId) => {
  const user = await Meteor.userAsync()
  if (user) {
    return Slates.find({ _id: slateId, userId: Meteor.userId() })
  }
  return null
})

// System and AI messages are the subscriber's own; chat is one slate's, and only for a slate the
// subscriber can read.
Meteor.publish(CONSTANTS.publications.messages, async function (opts) {
  if (!this.userId || !Match.test(opts, Match.ObjectIncluding({ types: [String], slateShareId: Match.Maybe(String) }))) return this.ready()
  const msearch = { type: { $in: opts.types } }
  if (
    opts.types.includes(CONSTANTS.messageTypes.system) ||
    opts.types.includes(CONSTANTS.messageTypes.ai)
  ) {
    msearch.userId = this.userId
  } else if (opts.types.includes(CONSTANTS.messageTypes.chat)) {
    // Chat is scoped to one canvas; without a slate nothing is published.
    if (!opts.slateShareId || !await canReadSlate(this.userId, await findSlate({ shareId: opts.slateShareId }))) {
      return this.ready()
    }
    msearch.slateShareId = opts.slateShareId
  } else {
    msearch.userId = this.userId
  }
  return Messages.find(msearch, { sort: { timestamp: -1 } })
})

// Comments of one slate (optionally one note), for anyone who can read that slate.
Meteor.publish(CONSTANTS.publications.comments, async function (filter) {
  if (!Match.test(filter, Match.ObjectIncluding({ slateId: String, nodeId: Match.Maybe(String) }))) return this.ready()
  if (!await canReadSlate(this.userId, await findSlate({ slateId: filter.slateId }))) return this.ready()
  const query = { slateId: filter.slateId }
  if (filter.nodeId) query.nodeId = filter.nodeId
  return Comments.find(query, { sort: { timestamp: -1 } })
})

Meteor.publish(
  CONSTANTS.publications.collaboration,
  async function (_slateIds, _slateInstanceIds, asOfDate) {
    if (!Match.test(_slateIds, [String]) || !Match.test(_slateInstanceIds, [String]) || !Match.test(asOfDate, Number) || _slateIds.length > 20) return this.ready()
    const readable = []
    for (const shareId of _slateIds) {
      if (await canReadSlate(this.userId, await findSlate({ shareId }))) readable.push(shareId)
    }
    // the date in the table is GREATER THAN or equal to the last saved date
    return Collaboration.find({
      $and: [
        { slateId: { $in: readable } },
        { dated: { $gt: asOfDate } },
        { instanceId: { $nin: _slateInstanceIds } },
      ],
    })
  }
)

// A person's own team. Old billing fields stay on the server until the cleanup step removes them.
const hiddenTeamFields = Object.fromEntries([...PLAN_FIELDS, 'customerId', 'invitationLease'].map(field => [field, 0]))
Meteor.publish(CONSTANTS.publications.organizations, async function () {
  const user = await Meteor.users.findOneAsync({ _id: this.userId })
  // A team import waiting for confirmation (hidden: true) is shown to no one (server/team-export).
  if (user?.orgId) return Organizations.find({ _id: user.orgId, hidden: { $ne: true } }, { fields: hiddenTeamFields })
  return null
})

Meteor.publish(CONSTANTS.publications.orgUsers, async function () {
  const user = await Meteor.users.findOneAsync({ _id: this.userId })
  if (
    user?.orgId &&
    (await AuthManager.userHasClaim(user._id, [
      CONSTANTS.claims.canViewUsers._id,
    ]))
  ) {
    return Meteor.users.find(
      { orgId: user.orgId },
      {
        fields: {
          profile: 1,
          isAnonymous: 1,
          createdAt: 1,
          emails: 1,
          orgId: 1,
          isOrgOwner: 1,
        },
      }
    )
  }
  this.ready()
  return null
})

// The names a visitor of a public or unlisted team slate sees beside its comments: the slate's
// own team, names only.
Meteor.publish(CONSTANTS.publications.orgUsersForGuest, async function (opts) {
  if (!Match.test(opts, Match.ObjectIncluding({ slateId: String }))) return this.ready()
  const slate = await findSlate({ slateId: opts.slateId })
  if (slate?.orgId && (slate.options?.isUnlisted || slate.options?.isPublic)) {
    return Meteor.users.find(
      { orgId: slate.orgId },
      { fields: { 'profile.firstName': 1, 'profile.lastName': 1, isAnonymous: 1 } }
    )
  }
  this.ready()
  return null
})

Meteor.publish(CONSTANTS.publications.orgSlates, async function () {
  const user = await Meteor.users.findOneAsync({ _id: this.userId })
  if (
    user?.orgId &&
    (await AuthManager.userHasClaim(user._id, [
      CONSTANTS.claims.canViewSlates._id,
    ]))
  ) {
    return Slates.find({ orgId: user.orgId }, { sort: { lastSaved: -1 } })
  }
  this.ready()
  return null
})

Meteor.publish(CONSTANTS.publications.claims, async function () {
  const user = await Meteor.userAsync()
  if (user) {
    if (user.isMasterUser) {
      return Claims.find({}, { disableOplog: true })
    }
    return Claims.find({ _id: { $ne: 'uberMensch' } }, { disableOplog: true })
  }
  this.ready()
  return null
})

Meteor.publish(CONSTANTS.publications.permissions, async function () {
  const user = await Meteor.userAsync()
  if (user?.orgId) {
    return Permissions.find({ orgId: user.orgId }, { disableOplog: true })
  }
  this.ready()
  return null
})

Meteor.publish(
  CONSTANTS.publications.approvalRequests,
  function (type, slateId) {
    if (this.userId && typeof type === 'string' && typeof slateId === 'string') {
      return ApprovalRequests.find({ type, slateId, userId: this.userId })
    }
    this.ready()
    return null
  }
)

Meteor.publish(CONSTANTS.publications.transcripts, async function (opts) {
  const slateShareId = opts?.slateShareId
  if (this.userId && typeof slateShareId === 'string' && await canReadSlate(this.userId, await findSlate({ shareId: slateShareId }))) {
    return Transcripts.find({ slateShareId }, { sort: { timestamp: -1 } })
  }
  this.ready()
  return null
})

Meteor.publish(CONSTANTS.publications.chatIntentions, async function () {
  if (this.userId) {
    const user = await Meteor.userAsync()
    const isUserMaster = await Meteor.callAsync(
      CONSTANTS.methods.users.isMasterUser
    )
    if (isUserMaster) {
      return ChatIntentions.find({}, { sort: { order: 1 } })
    }
    // A person sees their own personas, their team's (when they have a team), and the shared
    // ones. An account without a team has orgId undefined, which must not match every other
    // such account's personas.
    return ChatIntentions.find(
      {
        $or: [
          { userId: this.userId },
          ...(typeof user?.orgId === 'string' && user.orgId ? [{ orgId: user.orgId }] : []),
          { universal: true },
          { system: true },
        ],
      },
      { sort: { order: 1 } }
    )
  }
  this.ready()
  return null
})

Meteor.publish('organizationSettings', async function () {
  const user = await Meteor.users.findOneAsync({ _id: this.userId })
  if (user && user.orgId) {
    return OrganizationSettings.find({ orgId: user.orgId })
  }
  this.ready()
  return null
})
