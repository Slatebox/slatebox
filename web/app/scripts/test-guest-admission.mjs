// Guests are never limited: every guest is admitted and gets a 24-hour receipt.
// Needs a disposable local MongoDB (NATIVE_SAVE_TEST_MONGO=mongodb://127.0.0.1:<port>/).
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { recordGuestAdmission } from '../server/methods/guest-admission.mjs'

const endpoint = process.env.NATIVE_SAVE_TEST_MONGO
if (!endpoint || !['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname)) {
  throw Error('Set NATIVE_SAVE_TEST_MONGO to a disposable local MongoDB.')
}
const require = createRequire(import.meta.url)
const { MongoClient } = require(process.env.MONGODB_DRIVER || 'mongodb')
const client = new MongoClient(endpoint)
const db = client.db('slatebox_guest_test_' + randomUUID().replaceAll('-', ''))
const views = db.collection('guestViews')
const messages = db.collection('messages')
const now = Date.UTC(2026, 10, 8, 12)
const day = 86400000
const board = { _id: 'atlas', userId: 'alice', options: { isUnlisted: true } }
const admit = (visitor, at = now, viewer = null, slate = board) => recordGuestAdmission({ views }, slate, viewer, visitor, at)

try {
  // 500 distinct guests on one unlisted slate in one month: all admitted
  for (let i = 0; i < 500; i++) assert.equal(await admit('guest-' + i, now + i * 60000), true)
  assert.equal(await views.countDocuments({ slateId: 'atlas' }), 500)
  assert.equal(await messages.countDocuments({}), 0, 'nobody is told a guest was turned away')

  // each receipt carries its 24-hour pass
  const first = await views.findOne({ guestCollaboratorId: 'guest-0' })
  assert.equal(first.passStartedAt, now)
  assert.equal(typeof first.passId, 'string')
  assert.equal(first.actualGuest, true)
  assert.equal(first.userId, null)

  // a return within 24 hours keeps the pass; after it, a new pass starts
  await admit('guest-0', now + 3 * 3600000)
  const again = await views.findOne({ guestCollaboratorId: 'guest-0' })
  assert.deepEqual([again.passStartedAt, again.passId, again.timestamp], [now, first.passId, now + 3 * 3600000])
  await admit('guest-0', now + day + 1)
  const renewed = await views.findOne({ guestCollaboratorId: 'guest-0' })
  assert.equal(renewed.passStartedAt, now + day + 1)
  assert.notEqual(renewed.passId, first.passId)
  assert.equal(await views.countDocuments({ guestCollaboratorId: 'guest-0' }), 1)

  // readers' query (creative-slates.js) finds a live receipt
  const live = await views.findOne({
    slateId: 'atlas', guestCollaboratorId: 'guest-1', userId: null, actualGuest: true, joinedUserId: null,
    $expr: { $gt: [{ $ifNull: ['$passStartedAt', '$timestamp'] }, now + 2 * 60000 - day] },
  })
  assert.ok(live)

  // a signed-in viewer gets their own receipt; odd visitor ids are stored as values
  assert.equal(await admit('$weird.id', now, { _id: 'viewer', orgId: 'team' }), true)
  const viewer = await views.findOne({ userId: 'viewer' })
  assert.deepEqual([viewer.guestCollaboratorId, viewer.actualGuest, viewer.orgId], ['$weird.id', false, 'team'])
  assert.equal(await admit('', now), false)
  assert.equal(await admit('x'.repeat(129), now), false)
  console.log('guest admission: unlimited, receipts kept')
} finally {
  await db.dropDatabase().catch(() => {})
  await client.close()
}
