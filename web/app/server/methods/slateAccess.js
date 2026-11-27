import { configureGeneralLink } from './general-slate-link.mjs'
import { growthStep } from '../growth/meteor'
// methods.js
import CONSTANTS from '../../imports/api/common/constants'
import { SlateAccess, Slates } from '../../imports/api/common/models'
import { Random } from 'meteor/random'
import { MongoInternals } from 'meteor/mongo'
import { Meteor } from 'meteor/meteor'
import { audit } from '../audit/recorder.mjs'

const method = {}

method[CONSTANTS.methods.slateAccess.get] = async (opts) => {
  const user = await Meteor.userAsync()
  if (user && await Slates.findOneAsync({ _id: opts.id, userId: user._id }, {fields:{_id:1}})) {
    const access = await SlateAccess.find({ slateId: opts.id }).fetchAsync()
    return access
  }
  return []
}

method[CONSTANTS.methods.slateAccess.recipients] = async function (slateId) {
  if (!this.userId || typeof slateId !== 'string') return []
  const owner = await Meteor.users.findOneAsync(this.userId, { fields: { orgId: 1 } })
  if (!owner?.orgId) return []
  const board = await Slates.findOneAsync({ _id: slateId, userId: this.userId }, { fields: { orgId: 1 } })
  if (!board || (board.orgId && board.orgId !== owner.orgId)) return []
  return Meteor.users.find({ orgId: owner.orgId, _id: { $ne: this.userId } }, {
    fields: { 'profile.firstName': 1, 'profile.lastName': 1 },
    sort: { 'profile.firstName': 1, 'profile.lastName': 1 },
  }).fetchAsync()
}

// The activity log's entry for a sharing change, after it is saved: the slate by its share id.
const CAN = { READ: 'view', COMMENT: 'comment', EDIT: 'edit' }
const ACCESS = { READ: 'can view', COMMENT: 'can comment', EDIT: 'can edit', NONE: 'no access' }
async function logSharing(slateId, entry) {
  const board = await Slates.findOneAsync({ _id: slateId }, { fields: { shareId: 1, orgId: 1, 'options.name': 1 } })
  if (!board?.shareId) return
  await audit.record({
    ...entry,
    target: { type: 'slate', id: board.shareId, name: board.options?.name || 'Untitled slate' },
    slateId: board.shareId,
    ...(board.orgId && { orgId: board.orgId }),
  })
}

async function changeSharing(slateId, userId, change) {
  const boards = Slates.rawCollection()
  const grants = SlateAccess.rawCollection()
  const client = MongoInternals.defaultRemoteCollectionDriver().mongo.client
  await client.withSession(session => session.withTransaction(async () => {
    // Serialize changes across owner tabs, including first-time link initialization.
    const owner = { _id: slateId, userId }
    const board = await boards.findOneAndUpdate(owner, { $inc: { sharingRevision: 1 } }, {
      session, includeResultMetadata: false, projection: { orgId: 1, options: 1 },
    })
    if (!board) throw new Meteor.Error('unavailable', 'Only the owner can change sharing.')
    await change({ board, boards, grants, owner, session })
  }))
}

method[CONSTANTS.methods.slateAccess.configureLink] = async function ({ slateId, type, permission, initialize = false }) {
  if (!this.userId || typeof slateId !== 'string' || !['private', 'unlisted', 'public'].includes(type) ||
      !['READ', 'COMMENT', 'EDIT'].includes(permission)) throw new Meteor.Error('invalid-link', 'Choose a valid sharing option.')
  await changeSharing(slateId, this.userId, store => configureGeneralLink(store, {
    type, permission, initialize, generateKey: () => Random.id(8),
  }))
  // a link opened to others is a first share in the growth funnel (Slatebox Cloud only)
  if (!initialize && type !== 'private') growthStep(this.userId, 'share')
  // A link set up the first time the panel opens is not a person's choice.
  if (!initialize) await logSharing(slateId, { action: 'sharing.linkChanged', details: { mode: type, role: CAN[permission] || permission } })
}

method[CONSTANTS.methods.slateAccess.configureMember] = async function ({ slateId, memberId, permission }) {
  const ownerId = this.userId
  if (!ownerId || typeof slateId !== 'string' || typeof memberId !== 'string' || memberId === ownerId ||
      !Object.values(CONSTANTS.slateAccessPermissions).some(entry => entry.id === permission)) {
    throw new Meteor.Error('invalid-member', 'Choose a teammate and an access level.')
  }
  await changeSharing(slateId, ownerId, async ({ board, grants, session }) => {
    const users = Meteor.users.rawCollection()
    const account = await users.findOne({ _id: ownerId }, { projection: { orgId: 1 }, session })
    const orgId = account?.orgId
    if (!orgId || (board.orgId && board.orgId !== orgId) ||
        !await users.findOne({ _id: memberId, orgId }, { projection: { _id: 1 }, session })) {
      throw new Meteor.Error('unavailable', 'Choose a member of your team.')
    }
    const identity = { slateId, type: 'private', userId: memberId }
    await grants.updateOne(identity, {
      $set: { slateAccessPermissionId: permission },
      $setOnInsert: { _id: 'private_' + memberId + '_' + slateId, owningUserId: ownerId, orgId, accessKey: Random.id(8) },
    }, { upsert: true, session })
  })
  growthStep(ownerId, 'share')
  await logSharing(slateId, { action: 'sharing.memberChanged', details: { role: ACCESS[permission] || String(permission).toLowerCase() } })
}

Meteor.methods(method)
