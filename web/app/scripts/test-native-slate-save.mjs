import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { resolveSlateRole } from '../server/methods/slate-role.mjs'
import { saveNativeSlate, sharedSaveConditions } from '../server/methods/native-slate-save.mjs'
import { createSlateSaveCore } from '../server/slate-save-core.mjs'
import { searchFieldsOf } from '../server/slate-search-fields.mjs'

const require = createRequire(import.meta.url)
const { MongoClient } = require(process.env.MONGODB_DRIVER || 'mongodb')
const endpoint = process.env.NATIVE_SAVE_TEST_MONGO
if (!endpoint || !['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname)) {
  throw new Error('Set NATIVE_SAVE_TEST_MONGO to an isolated local test MongoDB.')
}
const client = new MongoClient(endpoint)
const db = client.db('slatebox_native_save_test_' + randomUUID().replaceAll('-', ''))
const slates = db.collection('slates')
const access = db.collection('access')
const guestViews = db.collection('guests')
const events = db.collection('events')
const now = Date.now()
const history = []
// Restated (P05a): saves go through the save core, over the same collection.
const deps = { slates, saveCore: createSlateSaveCore({ slates, events }), access, guestViews, now,
  rememberInvitedEdit: async (userId, board, routeKey) => {
    const saved = await slates.findOne({ _id: board._id })
    history.push({ userId, routeKey, nodes: saved.nodes })
  },
  denied: () => Error('save-denied'),
  isTeamAdmin: async id => id.startsWith('admin-') }
const owner = { _id: 'owner', orgId: 'home' }
const editor = { _id: 'editor', orgId: 'other' }
const initial = { userId: 'wrong', orgId: 'wrong', shareId: 'native-share', nodes: [],
  options: { id: 'native', name: 'First draft', isPrivate: true, isPublic: false, isUnlisted: false } }
const save = (user, slate = initial, guestCollaboratorId) => saveNativeSlate(deps, user, { slate, guestCollaboratorId })
const deny = action => assert.rejects(action, /save-denied/)
try {
  await deny(save(null))
  await Promise.all(Array.from({length: 6}, () => save(owner)))
  assert.equal(await slates.countDocuments(), 1)
  const created = await slates.findOne({ _id: 'native' })
  assert.equal(created.userId, owner._id)
  assert.equal(created.orgId, owner.orgId)
  await deny(save(editor))
  for (const role of ['READ', 'COMMENT', 'NONE', 'EDIT']) {
    await access.updateOne({ slateId: 'native', userId: 'editor', type: 'private' }, { $set: { slateAccessPermissionId: role } }, { upsert: true })
    if (role === 'EDIT') await save(editor)
    else await deny(save(editor))
  }
  await deny(save({ _id: 'admin-away', orgId: 'other' }))
  await save({ _id: 'admin-home', orgId: 'home' })
  await slates.updateOne({ _id: 'native' }, { $set: { 'options.isPrivate': false, 'options.isUnlisted': true, workshop: { version: 1 } } })
  const stale = { ...initial, shareId: 'changed', workshop: null, options: { ...initial.options, url_name: 'other-url', allowCollaboration: true, name: 'Revised' } }
  await save(owner, stale)
  const stored = await slates.findOne({ _id: 'native' })
  // Restated (P05a): the server now also stores the search fields, built from what it saved.
  const { searchName, searchDescription, searchText, ...settings } = stored.options
  assert.deepEqual(settings, { ...initial.options, isPrivate: false, isUnlisted: true, name: 'Revised' })
  assert.deepEqual({ searchName, searchDescription, searchText }, searchFieldsOf(stored))
  assert.equal(stored.shareId, 'native-share')
  assert.equal(stored.created, created.created)
  assert.deepEqual(stored.workshop, { version: 1 })
  await deny(save(editor)) // Previous private edit grant no longer applies.
  await access.insertOne({ slateId: 'native', type: 'unlisted', slateAccessPermissionId: 'EDIT' })
  const view = { guestCollaboratorId: 'visitor', slateId: 'other', actualGuest: true, timestamp: now }
  await guestViews.insertOne(view)
  await deny(save(null, stale, 'visitor'))
  await guestViews.updateOne({ guestCollaboratorId: 'visitor' }, { $set: { slateId: 'native', timestamp: now-90000000 } })
  await deny(save(null, stale, 'visitor'))
  await guestViews.updateOne({ guestCollaboratorId: 'visitor' }, { $set: { timestamp: now } })
  await save(null, stale, 'visitor')
  await access.updateOne({ type: 'unlisted' }, { $set: { slateAccessPermissionId: 'COMMENT' } })
  await deny(save(null, stale, 'visitor'))
  await slates.updateOne({ _id: 'native' }, { $set: { 'options.isUnlisted': false, 'options.isPublic': true } })
  await save(editor)
  await deny(save(null, stale, 'visitor')) // Unsigned public default is read-only.
  await access.insertOne({ slateId: 'native', type: 'public', slateAccessPermissionId: 'READ' })
  await deny(save(editor))
  await access.updateOne({ type: 'public' }, { $set: { slateAccessPermissionId: 'EDIT' } })
  await save(null, stale, 'visitor')

  // Pause immediately before the conditional write, after permission has been checked.
  // Same-visibility EDIT → READ must reject stale writes, even on boards predating sharingRevision.
  for (const revision of [null, 7]) {
    await slates.updateOne({ _id: 'native' }, revision === null
      ? { $unset: { sharingRevision: '' } } : { $set: { sharingRevision: revision } })
    await access.updateOne({ type: 'public' }, { $set: { slateAccessPermissionId: 'EDIT' } })
    const before = await slates.findOne({ _id: 'native' })
    const race = {
      findOne: slates.findOne.bind(slates),
      updateOne: async (selector, change) => {
        await access.updateOne({ type: 'public' }, { $set: { slateAccessPermissionId: 'READ' } })
        await slates.updateOne({ _id: 'native' }, { $inc: { sharingRevision: 1 } })
        return slates.updateOne(selector, change)
      },
    }
    const raced = { ...deps, slates: race, saveCore: createSlateSaveCore({ slates: race, events }) }
    await deny(saveNativeSlate(raced, editor, { slate: stale, hasLocalEdit: true }))
    assert.equal(history.length, 0, 'a rejected save cannot add a recently joined board')
    // Creative saves pair the same permission snapshot with their own model revision.
    const creative = { _id: 'native', ...sharedSaveConditions(before, editor._id), 'creative.revision': 0 }
    await slates.updateOne({ _id: 'native' }, { $set: { 'creative.revision': 0 } })
    assert.equal((await slates.updateOne(creative, { $inc: { 'creative.revision': 1 } })).matchedCount, 0)
    assert.equal((await slates.findOne({ _id: 'native' })).creative.revision, 0)
    // Owner edits do not depend on their board's link grant.
    await saveNativeSlate(raced, owner, { slate: stale })
    assert.equal((await slates.updateOne({ _id: 'native', ...sharedSaveConditions(before, owner._id),
      'creative.revision': 0 }, { $inc: { 'creative.revision': 1 } })).matchedCount, 1)
    assert.equal((await slates.updateOne({ _id: 'native', 'creative.revision': 0 },
      { $inc: { 'creative.revision': 1 } })).matchedCount, 0)
  }

  // Two persisted invitations for an older board may intentionally have different roles.
  const legacy = { _id: 'legacy', userId: owner._id, orgId: owner.orgId, shareId: 'legacy-board',
    options: { id: 'legacy', isUnlisted: true, url_name: 'legacy-slug' }, nodes: [] }
  await slates.insertOne(legacy)
  const invites = ['READ', 'COMMENT', 'EDIT'].map(role => ({
    slateId: legacy._id, type: 'unlisted', accessKey: 'legacy-' + role, slateAccessPermissionId: role,
  }))
  await access.insertMany(invites)
  await guestViews.insertOne({ guestCollaboratorId: 'visitor', timestamp: now, actualGuest: true, slateId: legacy._id })
  const saveVia = (user, routeKey, guestCollaboratorId) =>
    saveNativeSlate(deps, user, { slate: legacy, routeKey, guestCollaboratorId })
  const grantRows = () => access.find({ slateId: legacy._id }).toArray()
  const readVia = async (user, key) => resolveSlateRole(legacy, user, false, await grantRows(), key)
  for (const role of ['READ', 'COMMENT', 'EDIT']) {
    const key = 'legacy-' + role
    for (const user of [editor, null]) {
      assert.equal(await readVia(user, key), role)
      if (role === 'EDIT') await saveVia(user, key, 'visitor')
      else await deny(saveVia(user, key, 'visitor'))
    }
  }
  assert.equal(history.length, 0, 'saving a viewport does not record a contribution')
  const changedNotes = [{ options: { id: 'witness', text: 'First retry at the gateway' } }]
  await saveNativeSlate(deps, editor, { slate: { ...legacy, nodes: changedNotes },
    hasLocalEdit: true, routeKey: 'legacy-EDIT' })
  assert.deepEqual(history, [{ userId: editor._id, routeKey: 'legacy-EDIT', nodes: changedNotes }])
  const nativeGuestProof = { slate: { ...legacy, nodes: [{ options: { text: 'Saved contribution' } }] },
    guestCollaboratorId: 'visitor', routeKey: 'legacy-EDIT', keepProof: 'synthetic-proof', hasLocalEdit: true }
  let savedGuestEdits = 0
  const guestDeps = { ...deps, recordGuestEdit: async (board, visitor, key, proof) => {
    assert.equal(board._id, legacy._id)
    assert.equal(visitor, 'visitor')
    assert.equal(key, nativeGuestProof.routeKey)
    assert.equal(proof, nativeGuestProof.keepProof)
    assert.deepEqual((await slates.findOne({ _id: board._id })).nodes, nativeGuestProof.slate.nodes)
    savedGuestEdits++
    return true
  } }
  assert.deepEqual(await saveNativeSlate(guestDeps, null, nativeGuestProof), { savedAt: now, canKeep: true })
  assert.equal(await saveNativeSlate(guestDeps, null, { ...nativeGuestProof, hasLocalEdit: false }), now)
  await deny(saveNativeSlate(guestDeps, null, { ...nativeGuestProof, routeKey: 'legacy-READ' }))
  await deny(saveNativeSlate(guestDeps, null, { ...nativeGuestProof, guestCollaboratorId: 'another-visitor' }))
  assert.equal(savedGuestEdits, 1)

  await deny(saveVia(null, 'legacy-EDIT', 'unadmitted'))
  await deny(saveVia(editor, 'retired-key'))
  await deny(saveVia(editor, legacy.shareId))
  await deny(saveVia(editor, legacy.options.url_name))
  assert.equal(await readVia(editor), null)
  await access.insertOne({ slateId: legacy._id, type: 'unlisted', userId: editor._id,
    accessKey: 'member-key', slateAccessPermissionId: 'READ' })
  assert.equal(await readVia(editor, 'legacy-EDIT'), 'READ')
  assert.equal(await readVia({ _id: 'another-member' }, 'member-key'), null)
  await deny(saveVia(editor, 'legacy-EDIT'))
  await saveVia(owner, legacy.shareId)
  await access.updateMany({ slateId: legacy._id }, { $set: { type: 'public' } })
  await slates.updateOne({ _id: legacy._id }, { $set: { 'options.isPublic': true, 'options.isUnlisted': false } })
  legacy.options.isPublic = true
  legacy.options.isUnlisted = false
  assert.equal(await readVia(null), 'READ')
  await deny(saveVia(null, legacy.shareId, 'visitor'))
  assert.equal(await readVia({ _id: 'another-member' }, 'legacy-READ'), 'READ')
  await deny(saveVia({ _id: 'another-member' }, 'legacy-READ'))
  await saveVia({ _id: 'another-member' }, 'legacy-EDIT')
  await access.deleteOne({ slateId: legacy._id, accessKey: 'legacy-EDIT' })
  assert.equal(await readVia({ _id: 'another-member' }, 'legacy-EDIT'), null)
  await deny(saveVia({ _id: 'another-member' }, 'legacy-EDIT'))
  console.log('PASS persisted legacy invitation roles, named restrictions, active guest admission, canonical routes and retired grants')

  const copy = { ...initial, _id: 'copy', userId: editor._id, orgId: editor.orgId, shareId: 'new-copy',
    options: { ...initial.options, id: 'copy' } }
  await slates.insertOne(copy) // Existing copySlate inserts first, then opens the editor.
  await save(editor, { ...copy, nodes: [{ options: { text: 'New copy content' } }] })
  assert.equal((await slates.findOne({ _id: 'copy' })).nodes.length, 1)
  const authored = { shareId: 'authored-share', nodes: [], options: {
    id: 'authored', isTemplate: true, templateApproved: true, isFeatured: true, isPublic: true, isPrivate: false,
  } }
  await save(owner, authored)
  const draft = await slates.findOne({ _id: 'authored' })
  assert.equal(draft.options.isTemplate, true)
  assert.equal(draft.options.isPublic, true)
  assert.ok(!draft.options.templateApproved && !draft.options.isFeatured)
  console.log('PASS native saves, concurrent creation, retries, stale identity and visibility, copy, private and public grants, and board-bound guest access')
  // An old browser snapshot cannot erase notes appended by a newer conversation.
  await slates.updateOne({_id:'native'},{$set:{nativeConversationRevision:1}})
  await deny(save(owner,initial))
  await saveNativeSlate(deps,owner,{slate:initial,nativeConversationRevision:1})
  assert.equal((await slates.findOne({_id:'native'})).nativeConversationRevision,1)
} finally {
  await db.dropDatabase()
  await client.close()
}
