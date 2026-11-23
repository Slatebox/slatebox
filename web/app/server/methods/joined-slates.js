import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Random } from 'meteor/random'
import { getSlatesForUser } from './slates'
import { slateVisibility } from './slate-role.mjs'
import { Slates, SlateAccess } from '../../imports/api/common/models'

// History belongs to the recipient. A remembered URL never grants access by itself.
export const JoinedSlates = new Mongo.Collection('joinedSlateHistory')
export async function rememberJoinedSlate(userId, slateId, accessKey) {
  const entry = { slateId, accessKey }
  await JoinedSlates.rawCollection().updateOne({ _id: userId }, [{
    $set: {
      revision: { $cond: [
        { $eq: [{ $arrayElemAt: ['$links', 0] }, { $literal: entry }] },
        '$revision', Random.id(),
      ] },
      links: { $slice: [{ $concatArrays: [[{ $literal: entry }], {
        $filter: { input: { $ifNull: ['$links', []] }, as: 'link', cond: { $ne: ['$$link.slateId', { $literal: slateId }] } },
      }] }, 12] },
    },
  }], { upsert: true })
}

// A saved contribution can return the editor to the precise invitation they used.
export async function rememberInvitedEdit(userId, board, routeKey) {
  if (!userId || userId === board.userId || typeof routeKey !== 'string' ||
      routeKey === board.shareId || routeKey === board.options?.url_name) return
  const type = slateVisibility(board)
  if (type === 'private') return
  try {
    const grant = await SlateAccess.findOneAsync({ slateId: board._id, accessKey: routeKey,
      type, userId: null, slateAccessPermissionId: 'EDIT' }, { fields: { _id: 1 } })
    if (grant) await rememberJoinedSlate(userId, board._id, routeKey)
  } catch {
    // The board save already succeeded. Another contribution can retry history.
    console.warn('Could not remember the joined slate after saving its edit.')
  }
}

Meteor.publish('joinedSlates.index', function () {
  return this.userId ? JoinedSlates.find(this.userId, { fields: { revision: 1 } }) : this.ready()
})

// Resubscribed with the account's new revision when its twelve recent links change.
// Board and grant observers remove a revoked title even while My Slates stays open.
Meteor.publish('joinedSlates.rows', async function (revision) {
  if (!this.userId || typeof revision !== 'string') return this.ready()
  const history = await JoinedSlates.findOneAsync({ _id: this.userId, revision })
  if (!history) return this.ready()
  const links = history.links
  const ids = links.map(link => link.slateId)
  const user = await Meteor.users.findOneAsync(this.userId, { fields: { orgId: 1, isMasterUser: 1 } })
  if (!user) return this.ready()
  const visible = new Map()
  const versions = new Map()
  const handles = []
  let stopped = false
  this.onStop(() => { stopped = true; handles.forEach(handle => handle.stop()) })
  const refresh = async id => {
    const index = ids.indexOf(id)
    const { accessKey } = links[index]
    const version = (versions.get(id) || 0) + 1
    versions.set(id, version)
    const grant = await SlateAccess.findOneAsync({ slateId: id, accessKey, userId: null,
      type: { $in: ['public', 'unlisted'] }, slateAccessPermissionId: { $in: ['EDIT', 'READ', 'COMMENT'] },
    }, { fields: { _id: 1 } })
    // Older installations used a separate document ID for the same kind of link.
    // Use the canvas resolver so the dashboard sees exactly what that URL permits.
    const access = grant && await getSlatesForUser({ shareId: accessKey }, user)
    if (stopped || versions.get(id) !== version) return
    const board = access?.slateBase
    if (board?._id === id && board.userId !== user._id && access.accessLevel) {
      const title = board.options.name || 'Untitled slate'
      if (!visible.has(id)) this.added('joinedSlateRows', id, { title, accessKey, index })
      else if (visible.get(id) !== title) this.changed('joinedSlateRows', id, { title })
      visible.set(id, title)
    } else if (visible.delete(id)) this.removed('joinedSlateRows', id)
  }
  const cursors = [
    [Slates.find({ _id: { $in: ids } }, {
      fields: { 'options.name': 1, 'options.isUnlisted': 1, 'options.isPublic': 1, 'options.isPrivate': 1, userId: 1, orgId: 1 },
    }), '_id'],
    [SlateAccess.find({ slateId: { $in: ids } }, {
      fields: { slateId: 1, userId: 1, accessKey: 1, type: 1, slateAccessPermissionId: 1 },
    }), 'slateId'],
  ]
  let ready = false
  for (const [cursor, field] of cursors) {
    if (stopped) return
    const change = doc => ready && refresh(doc[field])
    const handle = await cursor.observeAsync({ added: change, changed: change, removed: change })
    if (stopped) { await handle.stop(); return }
    handles.push(handle)
  }
  ready = true
  await Promise.all(ids.map(refresh))
  if (!stopped) this.ready()
})
