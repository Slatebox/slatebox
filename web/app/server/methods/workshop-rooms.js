import { Meteor } from 'meteor/meteor'
import { moveWorkshopCard, validateWorkshop } from 'slateboxjs/workshops/model'
import { WorkshopRooms } from '../../imports/api/common/workshopRooms'
import { Permissions, SlateAccess, Slates } from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'

const unavailable = () => new Meteor.Error('unavailable', 'This private workshop is unavailable to this account.')
const validId = value => typeof value === 'string' && /^[a-f0-9]{10}$/.test(value)
const slateFields = { shareId: 1, userId: 1, orgId: 1, 'options.isPrivate': 1, 'options.isUnlisted': 1, 'options.isPublic': 1 }
const privateSlate = slate => slate?.options?.isPrivate === true && !slate.options.isPublic && !slate.options.isUnlisted
const grantLevels = ['EDIT', 'READ', 'COMMENT', 'NONE']

async function accessTo(shareId, userId) {
  if (!userId || !validId(shareId)) return null
  const [room, user] = await Promise.all([
    WorkshopRooms.findOneAsync(shareId),
    Meteor.users.findOneAsync(userId, { fields: { orgId: 1, isMasterUser: 1 } }),
  ])
  if (!room || !user) return null
  const slate = await Slates.findOneAsync({ _id: room.slateId, shareId, userId: room.ownerId }, { fields: slateFields })
  if (!privateSlate(slate)) return null
  const owner = slate.userId === userId
  const sameTeam = Boolean(slate.orgId && user.orgId === slate.orgId)
  if (owner || user.isMasterUser || (sameTeam && await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.admin._id }))) {
    return { room, slate, owner, sameTeam, edit: true }
  }
  if (slate.orgId && !sameTeam) return null
  const grant = await SlateAccess.findOneAsync({ slateId: slate._id, type: 'private', userId })
  if (!grant || !['EDIT', 'READ', 'COMMENT'].includes(grant.slateAccessPermissionId)) return null
  return { room, slate, owner: false, sameTeam, edit: grant.slateAccessPermissionId === 'EDIT' }
}

Meteor.methods({
  async 'workshops.openRoom'(shareId) {
    if (!this.userId || !validId(shareId)) throw unavailable()
    const slate = await Slates.findOneAsync({ shareId, userId: this.userId }, { fields: { ...slateFields, workshop: 1 } })
    if (!privateSlate(slate) || !slate.workshop) throw unavailable()
    const model = validateWorkshop(slate.workshop)
    await WorkshopRooms.rawCollection().updateOne({ _id: shareId }, {
      $setOnInsert: { slateId: slate._id, ownerId: this.userId, model, revision: 0 },
    }, { upsert: true })
    return shareId
  },

  async 'workshops.move'(shareId, revision, cardId, laneId) {
    const access = await accessTo(shareId, this.userId)
    if (!access?.edit) throw unavailable()
    const room = access.room
    if (!Number.isSafeInteger(revision) || revision < 0 || typeof cardId !== 'string' || typeof laneId !== 'string') {
      throw new Meteor.Error('invalid-move', 'Choose a token and an available destination.')
    }
    const stale = () => new Meteor.Error('stale', 'The workshop has changed. Review the current board and try your move again.')
    if (revision !== room.revision) throw stale()
    let next
    try { next = moveWorkshopCard(room.model, cardId, laneId) }
    catch { throw new Meteor.Error('invalid-move', 'That move is unavailable under the current workshop rules.') }
    if (next === room.model) return revision
    const changes = { model: next }
    if (next.kind === 'release-plan') changes.undo = { by: this.userId, model: room.model }
    const result = await WorkshopRooms.rawCollection().updateOne({ _id: shareId, revision }, {
      $set: changes, $inc: { revision: 1 },
    })
    if (!result.matchedCount) throw stale()
    return revision + 1
  },

  async 'workshops.undoReleaseMove'(shareId, revision) {
    const access = await accessTo(shareId, this.userId)
    if (!access?.edit || access.room.model.kind !== 'release-plan') throw unavailable()
    const { room } = access
    if (!Number.isSafeInteger(revision) || revision !== room.revision || !room.undo || room.undo.by !== this.userId) {
      throw new Meteor.Error('stale', 'Only your most recent move can be undone before another participant moves.')
    }
    const result = await WorkshopRooms.rawCollection().updateOne({ _id: shareId, revision, 'undo.by': this.userId }, {
      $set: { model: room.undo.model }, $inc: { revision: 1 }, $unset: { undo: '' },
    })
    if (!result.matchedCount) throw new Meteor.Error('stale', 'The plan has changed. Review the current release window.')
    return revision + 1
  },

  async 'workshops.setMember'(shareId, email, level) {
    const access = await accessTo(shareId, this.userId)
    if (!access?.owner || !access.sameTeam) throw unavailable()
    if (typeof email !== 'string' || email.length > 254 || !grantLevels.includes(level)) throw unavailable()
    const address = email.trim().toLowerCase()
    const member = await Meteor.users.findOneAsync({ orgId: access.slate.orgId,
      'emails.address': { $regex: '^' + address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' },
    }, { fields: { _id: 1 } })
    if (!member || member._id === this.userId) throw new Meteor.Error('unknown-member', 'Enter the address of another member of this team.')
    await Meteor.callAsync(CONSTANTS.methods.slateAccess.configureMember, {
      slateId: access.slate._id, memberId: member._id, permission: level,
    })
    return true
  },
})

Meteor.publish('workshops.room', async function publishRoom(shareId) {
  const userId = this.userId
  if (!validId(shareId) || !userId) { this.ready(); return }
  const initial = await WorkshopRooms.findOneAsync(shareId, { fields: { slateId: 1 } })
  if (!initial) { this.ready(); return }
  let stopped = false, initialized = false, running = false, published = false, version = 0
  const handles = []
  this.onStop(() => { stopped = true; handles.forEach(handle => handle.stop()) })
  const refresh = async () => {
    version++
    if (!initialized || running || stopped) return
    running = true
    try {
      while (!stopped) {
        const pass = version
        const access = await accessTo(shareId, userId)
        if (stopped) return
        if (pass !== version) continue
        if (access) {
          const fields = { model: access.room.model, revision: access.room.revision,
            canEdit: access.edit, owner: access.owner, team: access.sameTeam,
            canUndo: Boolean(access.edit && access.room.undo?.by === userId) }
          if (published) this.changed('workshopRooms', shareId, fields)
          else this.added('workshopRooms', shareId, fields)
          published = true
        } else if (published) {
          this.removed('workshopRooms', shareId)
          published = false
        }
        this.ready()
        break
      }
    } catch { if (!stopped) this.error(unavailable()) }
    finally { running = false }
  }
  const cursors = [
    WorkshopRooms.find(shareId, { fields: { revision: 1 } }),
    Slates.find(initial.slateId, { fields: slateFields }),
    SlateAccess.find({ slateId: initial.slateId, userId, type: 'private' }, { fields: { slateAccessPermissionId: 1 } }),
    Meteor.users.find(userId, { fields: { orgId: 1, isMasterUser: 1 } }),
    Permissions.find({ userId, claimId: CONSTANTS.claims.admin._id }, { fields: { claimId: 1 } }),
  ]
  try {
    for (const cursor of cursors) {
      if (stopped) return
      const handle = await cursor.observeChangesAsync({ added: refresh, changed: refresh, removed: refresh })
      if (stopped) { await handle.stop(); return }
      handles.push(handle)
    }
    initialized = true
    await refresh()
  } catch { if (!stopped) this.error(unavailable()) }
})
