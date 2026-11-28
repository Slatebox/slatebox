/* eslint-disable no-underscore-dangle */
// A slate card names the slate's owner, never the viewer: on a shared project the cards used to read
// the viewer's own name (DisplaySlates' UserName called getUserName, which ignores its argument and
// names Meteor.user()). The server now names each slate's owner (slate-authors.mjs) by the library's
// author rule: the profile name only, never another person's email address.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { AUTHOR_FIELDS, GUEST_AUTHOR, authorNameOf, withAuthorNames } from '../web/app/server/common/slate-authors.mjs'
import { slateAuthorLabel } from '../web/app/imports/ui/components/slateAuthorLabel.mjs'
import { UNNAMED_AUTHOR } from '../web/app/imports/api/common/library-model.mjs'

const app = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')

const viewer = { _id: 'viewer', profile: { firstName: 'Vera', lastName: 'Viewer' }, emails: [{ address: 'vera@example.com' }] }
const owner = { _id: 'owner', profile: { firstName: 'Olga', lastName: 'Owner' }, emails: [{ address: 'olga@example.com' }] }
const noName = { _id: 'quiet', profile: {}, emails: [{ address: 'quiet.person@example.com' }] }
const guest = { _id: 'guest1', isAnonymous: true, profile: { firstName: 'Shown' } }

const lookup = (people) => {
  const calls = []
  const findUsers = async (ids, fields) => { calls.push({ ids, fields }); return people.filter((u) => ids.includes(u._id)) }
  return { findUsers, calls }
}

test('a shared project lists each slate under its owner, not the viewer', async () => {
  const { findUsers, calls } = lookup([viewer, owner])
  const slates = [{ shareId: 'a', userId: 'owner' }, { shareId: 'b', userId: 'viewer' }, { shareId: 'c', userId: 'owner' }]
  const named = await withAuthorNames(slates, { viewerId: 'viewer', findUsers })
  assert.deepEqual(named.map((s) => s.authorName), ['Olga Owner', 'Vera Viewer', 'Olga Owner'])
  // One lookup for the page, each owner once, names only.
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].ids.sort(), ['owner', 'viewer'])
  assert.deepEqual(calls[0].fields, AUTHOR_FIELDS)
  assert.equal(slates[0].authorName, undefined, 'the input slates are not changed')
})

test('another person is never named by their email address', () => {
  assert.equal(authorNameOf(noName, 'viewer'), UNNAMED_AUTHOR)
  assert.ok(!authorNameOf(noName, 'viewer').includes('quiet'))
  // Only the viewer's own slate may use the start of their own address, as their cards always did.
  assert.equal(authorNameOf(noName, 'quiet'), 'quiet.person')
})

test('guests, missing owners and blank names', async () => {
  assert.equal(authorNameOf(guest, 'viewer'), GUEST_AUTHOR)
  assert.equal(authorNameOf(null, 'viewer'), GUEST_AUTHOR)
  assert.equal(authorNameOf({ _id: 'x', profile: { firstName: '  ', lastName: 'Solo' } }), 'Solo')
  const { findUsers } = lookup([])
  const named = await withAuthorNames([{ shareId: 'gone', userId: 'deleted' }], { viewerId: 'viewer', findUsers })
  assert.equal(named[0].authorName, UNNAMED_AUTHOR)
  const none = lookup([])
  assert.deepEqual(await withAuthorNames([], { viewerId: 'viewer', findUsers: none.findUsers }), [])
  assert.equal(none.calls.length, 0, 'an empty page looks nobody up')
})

test('the card shows the server name and never gives someone else’s slate the viewer’s name', () => {
  const own = () => 'Vera Viewer'
  assert.equal(slateAuthorLabel({ userId: 'owner', authorName: 'Olga Owner' }, 'viewer', own), 'Olga Owner')
  assert.equal(slateAuthorLabel({ userId: 'owner' }, 'viewer', own), '')
  assert.equal(slateAuthorLabel({ userId: 'viewer' }, 'viewer', own), 'Vera Viewer')
})

test('the list method names owners and the card reads that name', () => {
  const method = app('server/methods/slates.js')
  assert.match(method, /withAuthorNames\(slates, \{\s*viewerId: user\._id,/)
  assert.match(method, /return \{ slates: named, counts: \{ total: cnt \} \}/)
  const cards = app('imports/ui/components/DisplaySlates.jsx')
  assert.match(cards, /slateAuthorLabel\(slate, Meteor\.userId\(\), getUserName\)/)
  assert.doesNotMatch(cards, /getUserName\(slateUserId\)/, 'getUserName names the viewer, whatever it is passed')
  assert.doesNotMatch(cards, /function UserName\(/)
})
