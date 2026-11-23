import assert from 'node:assert/strict'
import test from 'node:test'
import { presentPeople } from '../web/app/imports/api/common/presence.mjs'
import { guestNameFor, personColour } from '../web/app/imports/api/common/guest-name.mjs'
import { personKeyFor } from '../web/app/server/common/person-key.mjs'

// A peer as the relay reports it, named as the server names them (collaborators.init).
const guest = (clientID, key) => ({ clientID, key, userName: guestNameFor(key), color: personColour(key) })
const named = (clientID, key, userName) => ({ clientID, key, userName, color: personColour(key) })

test('one person on several tabs is one person; this person\'s own other tabs are never someone else', () => {
  const people = presentPeople([guest(2, 'me'), guest(3, 'me'), named(4, 'ada', 'Ada Lovelace'), named(5, 'ada', 'Ada Lovelace')], 'me')
  assert.deepEqual(people.map((p) => p.userName), ['Ada Lovelace'])
  assert.deepEqual(people[0].clientIDs, [4, 5])
  assert.equal(people[0].key, 'ada')
  assert.equal(people[0].guest, false)
})

test('a guest has the same name for every viewer, whatever order each saw them in, and it is the name on their pointer', () => {
  const a = guest(1, 'key-a')
  const b = guest(2, 'key-b')
  const c = guest(3, 'key-c')
  // Three viewers, each seeing the others in a different order (the reproduction in the review).
  const fromA = presentPeople([b, c], 'key-a')
  const fromB = presentPeople([c, a], 'key-b')
  const fromD = presentPeople([b, a, c], 'key-d')
  const nameOf = (people, key) => people.find((p) => p.key === key).userName
  assert.equal(nameOf(fromA, 'key-c'), nameOf(fromB, 'key-c'))
  assert.equal(nameOf(fromA, 'key-c'), nameOf(fromD, 'key-c'))
  assert.equal(nameOf(fromB, 'key-a'), nameOf(fromD, 'key-a'))
  // The name each viewer shows is the presence name itself, which the engine draws on the pointer.
  assert.equal(nameOf(fromD, 'key-c'), c.userName)
  assert.match(c.userName, /^[A-Z][a-z]+ [A-Z][a-z]+ \(guest\)$/)
  assert.ok(fromD.every((p) => p.guest))
})

test('an account named "You" or "Guest" keeps its name and is not taken for a guest', () => {
  const people = presentPeople([named(2, 'k1', 'You'), named(3, 'k2', 'Guest')], 'me')
  assert.deepEqual(people.map((p) => [p.userName, p.guest]), [['You', false], ['Guest', false]])
})

test('a person whose tabs disagree is shown by their account name, whichever tab came first', () => {
  for (const order of [[guest(2, 'k'), named(3, 'k', 'Sam Ray')], [named(3, 'k', 'Sam Ray'), guest(2, 'k')]]) {
    const [person] = presentPeople(order, 'me')
    assert.equal(person.userName, 'Sam Ray')
    assert.equal(person.guest, false)
    assert.deepEqual([...person.clientIDs].sort(), [2, 3])
  }
})

test('a peer with no person key counts once per client', () => {
  const people = presentPeople([{ clientID: 2 }, { clientID: 3 }], 'me')
  assert.equal(people.length, 2)
})

test('the person key is the same on every tab of one account on a slate, differs between people and slates, and does not show the account id', () => {
  const secret = 'test-secret'
  const a1 = personKeyFor({ userId: 'user-a', visitorId: 'tab-1', slate: 's1' }, secret)
  const a2 = personKeyFor({ userId: 'user-a', visitorId: 'tab-2', slate: 's1' }, secret)
  const b = personKeyFor({ userId: 'user-b', slate: 's1' }, secret)
  const v = personKeyFor({ visitorId: 'cookie-1', slate: 's1' }, secret)
  assert.equal(a1, a2)
  assert.notEqual(a1, b)
  assert.notEqual(v, personKeyFor({ visitorId: 'cookie-2', slate: 's1' }, secret))
  // The same person on two slates cannot be linked by their key.
  assert.notEqual(a1, personKeyFor({ userId: 'user-a', slate: 's2' }, secret))
  assert.notEqual(v, personKeyFor({ visitorId: 'cookie-1', slate: 's2' }, secret))
  assert.ok(!a1.includes('user-a'))
  assert.match(a1, /^[A-Za-z0-9_-]{16}$/)
  // A person's colour and a guest's name follow from their key: the same on each of their tabs.
  assert.equal(personColour(a1), personColour(a2))
  assert.equal(guestNameFor(a1), guestNameFor(a2))
  assert.match(personColour(a1), /^#[0-9a-f]{6}$/)
})

test('guest names spread: 200 keys give well over a hundred names', () => {
  const names = new Set(Array.from({ length: 200 }, (_, i) => guestNameFor(`key-${i}`)))
  assert.ok(names.size > 120, `only ${names.size} names`)
})
