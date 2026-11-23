import { createHash } from 'node:crypto'
import { Accounts } from 'meteor/accounts-base'
import { Meteor } from 'meteor/meteor'
import { GuestViews, Slates, SlateAccess } from '../../imports/api/common/models'
import { rememberJoinedSlate } from './joined-slates'
import { createGuestAccount } from '../common/accounts'
import { slateVisibility } from './slate-role.mjs'

const denied = () => new Meteor.Error('keep-unavailable', 'This invitation can no longer be kept.')
const day = 86400000
const retryWindow = 120000

async function admittedEdit(connection, key, proof) {
  const admission = connection?.slateboxGuestAdmission
  if (!admission || typeof key !== 'string' || !/^[a-zA-Z0-9]{1,40}$/.test(key) ||
      typeof proof !== 'string' || !/^[a-f0-9]{48}$/.test(proof)) return null
  const board = await Slates.findOneAsync(admission.slateId, {
    fields: { shareId: 1, userId: 1, options: 1, 'creative.model.kind': 1 },
  })
  if (!board || board.creative || key === board.shareId || key === board.options?.url_name) return null
  const type = slateVisibility(board)
  if (type === 'private' || !await SlateAccess.findOneAsync({
    slateId: board._id, type, accessKey: key, userId: null, slateAccessPermissionId: 'EDIT',
  }, { fields: { _id: 1 } })) return null
  return {
    slateId: board._id, guestCollaboratorId: admission.visitor, actualGuest: true, userId: null,
    $expr: { $gt: [{ $ifNull: ['$passStartedAt', '$timestamp'] }, Date.now() - day] },
    nativeEditProof: createHash('sha256').update(proof).digest('hex'), nativeEditKey: key,
  }
}

// This hook runs only after the authorized native snapshot has been written.
export async function recordNativeGuestEdit(connection, board, visitor, key, proof) {
  if (connection?.slateboxGuestAdmission?.slateId !== board._id ||
      connection.slateboxGuestAdmission.visitor !== visitor) return false
  const source = await admittedEdit(connection, key, proof)
  if (!source) return false
  const { nativeEditProof, nativeEditKey, ...receipt } = source
  return Boolean(await GuestViews.updateAsync({ ...receipt, joinedUserId: null }, {
    $set: { nativeEditProof, nativeEditKey },
  }))
}

const activeClaim = () => ({ $or: [{ joinedUserId: null }, { nativeKeepRetryUntil: { $gt: Date.now() } }] })

Meteor.methods({
  async 'slates.canKeepNativeEdit'(key, proof) {
    if (this.userId) return false
    const source = await admittedEdit(this.connection, key, proof)
    return Boolean(source && await GuestViews.findOneAsync({ ...source, ...activeClaim() }, { fields: { _id: 1 } }))
  },
})

// A Meteor login result delivers a normal resumable guest session; it never exposes a guest password.
Accounts.registerLoginHandler('native-slate-contribution', async function keepNativeEdit(options) {
  if (!options?.keepNativeEdit) return undefined
  if (this.userId) throw denied()
  const { key, proof } = options.keepNativeEdit
  const source = await admittedEdit(this.connection, key, proof)
  if (!source) throw denied()
  const receipt = await GuestViews.findOneAsync({ ...source, ...activeClaim() }, { fields: { _id: 1, joinedUserId: 1 } })
  if (!receipt) throw denied()
  let guestId = receipt.joinedUserId
  if (!guestId) {
    const guest = { _id: (await createGuestAccount()).userId }
    const linked = await GuestViews.updateAsync({ ...source, _id: receipt._id, joinedUserId: null }, {
      $set: { joinedUserId: guest._id, nativeKeepRetryUntil: Date.now() + retryWindow },
    })
    if (linked) guestId = guest._id
    else {
      await Meteor.users.removeAsync({ _id: guest._id, isAnonymous: true })
      guestId = (await GuestViews.findOneAsync({ ...source, _id: receipt._id, nativeKeepRetryUntil: { $gt: Date.now() } }))?.joinedUserId
    }
  }
  if (!guestId || !await Meteor.users.findOneAsync({ _id: guestId, isAnonymous: true }, { fields: { _id: 1 } }) ||
      !await admittedEdit(this.connection, key, proof)) throw denied()
  await rememberJoinedSlate(guestId, source.slateId, key)
  return { userId: guestId }
})
