// The team page's plain-language roles (web/app/imports/ui/components/teams/team-roles.mjs): read
// from the stored claims, changed through the same users.changeRoles entries, never renaming a claim.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PEOPLE_CLAIMS, ROLES, assignableRoles, claimWords, displayName, extraClaims, guessName, holds, initials, invitesReady,
  memberStatus, readInvites, roleChanges, roleOf, sortClaims,
} from '../web/app/imports/ui/components/teams/team-roles.mjs'

const app = new URL('../web/app/', import.meta.url).pathname
const read = (file) => readFileSync(app + file, 'utf8')

test('roles are read from the stored claims', () => {
  assert.equal(roleOf({ isOrgOwner: true, claimIds: [] }).id, 'owner')
  assert.equal(roleOf({ isOrgOwner: true, claimIds: ['admin'] }).id, 'owner')
  assert.equal(roleOf({ claimIds: ['admin'] }).id, 'admin')
  assert.equal(roleOf({ claimIds: ['admin', 'canViewUsers'] }).id, 'admin')
  assert.equal(roleOf({ claimIds: [...PEOPLE_CLAIMS] }).id, 'manager')
  assert.equal(roleOf({ claimIds: [...PEOPLE_CLAIMS, 'canCopyTeamSlates'] }).id, 'manager', 'slate claims sit beside the role')
  assert.equal(roleOf({ claimIds: [] }).id, 'member')
  assert.equal(roleOf({ claimIds: ['canCopyTeamSlates', 'canAddSlates'] }).id, 'member')
  assert.equal(roleOf({ claimIds: ['canViewUsers'] }).id, 'custom')
  assert.equal(roleOf({ claimIds: ['canAddUsers', 'canViewUsers'] }).id, 'custom')
  assert.equal(roleOf().id, 'member')
})

test('a role change is the users.changeRoles entries the old checkboxes sent, and keeps slate claims', () => {
  assert.deepEqual(roleChanges([], 'admin'), [{ claimIds: ['admin'], action: 'add' }])
  assert.deepEqual(roleChanges(['canCopyTeamSlates'], 'manager'), [{ claimIds: [...PEOPLE_CLAIMS], action: 'add' }])
  assert.deepEqual(roleChanges(['admin'], 'manager'), [{ claimIds: ['admin'], action: 'delete' }, { claimIds: [...PEOPLE_CLAIMS], action: 'add' }])
  assert.deepEqual(roleChanges([...PEOPLE_CLAIMS, 'canCopyTeamSlates'], 'member'), [{ claimIds: [...PEOPLE_CLAIMS], action: 'delete' }])
  assert.deepEqual(roleChanges(['admin'], 'member'), [{ claimIds: ['admin'], action: 'delete' }])
  assert.deepEqual(roleChanges(['canViewUsers', 'canAddUsers'], 'member'), [{ claimIds: ['canViewUsers', 'canAddUsers'], action: 'delete' }])
  assert.deepEqual(roleChanges(['canCopyTeamSlates'], 'member'), [], 'already a member')
  assert.deepEqual(roleChanges(['admin'], 'admin'), [])
  assert.throws(() => roleChanges([], 'owner'), /No such role/)
  // never the server administrator claim, never a renamed claim
  for (const to of ['admin', 'manager', 'member']) {
    for (const entry of roleChanges(['canViewUsers'], to)) assert.ok(!entry.claimIds.includes('uberMensch'))
  }
})

test('Admin is offered only to an admin; the words are display only', () => {
  assert.deepEqual(assignableRoles({ viewerIsAdmin: true }).map((r) => r.id), ['admin', 'manager', 'member'])
  assert.deepEqual(assignableRoles({ viewerIsAdmin: false }).map((r) => r.id), ['manager', 'member'])
  const constants = read('imports/api/common/constants.js')
  for (const id of ['admin', ...PEOPLE_CLAIMS, 'canAddSlates', 'canCopyTeamSlates', 'canRemoveComments', 'uberMensch']) {
    assert.match(constants, new RegExp(`_id: '${id}'`), `${id} is a stored claim`)
    assert.ok(claimWords({ _id: id }).label, id)
  }
  // a claim the page does not know shows what is stored
  assert.deepEqual(claimWords({ _id: 'canDoNew', label: 'Do New', description: 'Stored words' }), { label: 'Do New', description: 'Stored words' })
  assert.deepEqual(sortClaims([{ _id: 'canRemoveComments' }, { _id: 'canViewUsers' }, { _id: 'zzz' }, { _id: 'admin' }]).map((c) => c._id),
    ['admin', 'canViewUsers', 'canRemoveComments', 'zzz'])
  for (const role of Object.values(ROLES)) assert.match(role.blurb, /\.$/)
})

test('holds reads like AuthManager.userHasClaim on the client: admin counts for every claim', () => {
  assert.equal(holds(['admin'], 'canRemoveUsers'), true)
  assert.equal(holds(['canAddUsers'], ['canEditUsers', 'canAddUsers']), true)
  assert.equal(holds(['canAddUsers'], 'canEditUsers'), false)
  assert.equal(holds([], 'canViewUsers'), false)
  assert.deepEqual(extraClaims(['admin', 'canViewUsers', 'canCopyTeamSlates', 'uberMensch']), ['canCopyTeamSlates'])
})

test('status, names and initials', () => {
  assert.equal(memberStatus({ emails: [{ address: 'a@x.test', verified: true }] }).id, 'active')
  assert.equal(memberStatus({ emails: [{ address: 'a@x.test', verified: false }] }).label, 'Invited · not accepted yet')
  assert.equal(memberStatus({ emails: [] }).id, 'not-invited')
  assert.equal(memberStatus({}).id, 'not-invited')
  assert.equal(displayName({ profile: { firstName: 'Ada', lastName: 'Lovelace' } }), 'Ada Lovelace')
  assert.equal(displayName({ profile: {}, emails: [{ address: 'a@x.test' }] }), 'a@x.test')
  assert.equal(initials({ profile: { firstName: 'ada', lastName: 'lovelace' } }), 'AL')
  assert.equal(initials({ emails: [{ address: 'zed@x.test' }] }), 'Z')
})

test('several invitations at once: addresses read, names guessed, the list checked', () => {
  assert.deepEqual(guessName('jane.doe@x.test'), { firstName: 'Jane', lastName: 'Doe' })
  assert.deepEqual(guessName('sam+team@x.test'), { firstName: 'Sam', lastName: '' })
  assert.deepEqual(guessName('j2000@x.test'), { firstName: '', lastName: '' })
  const { people, problems } = readInvites('jane.doe@x.test, Sam <SAM@x.test>;\nnope@\nme@x.test\nada@x.test jane.doe@x.test',
    { taken: ['ada@x.test'], own: ['me@x.test'] })
  assert.deepEqual(people.map((p) => p.email), ['jane.doe@x.test', 'sam@x.test'])
  assert.equal(problems.length, 4)
  assert.ok(problems.some((p) => /your own address/.test(p)))
  assert.ok(problems.some((p) => /already on the team/.test(p)))
  assert.equal(invitesReady(people), false, 'Sam has no last name yet')
  assert.equal(invitesReady([{ email: 'a@x.test', firstName: 'A', lastName: 'B' }]), true)
  assert.equal(invitesReady([]), false)
})

test('the team page calls the same server methods, and states no Business amount', () => {
  const page = read('imports/ui/components/teams/ManageOrganization.jsx') + read('imports/ui/components/teams/MemberDialogs.jsx') +
    read('imports/ui/components/teams/InvitePeopleDialog.jsx')
  for (const call of ['methods.users.update', 'methods.users.changeRoles', 'methods.users.invite', 'methods.users.resendEnrollment',
    'methods.users.get', "'organizations.removeMember'"]) {
    assert.ok(page.includes(call), call)
  }
  assert.doesNotMatch(page, /\$\d/)
  assert.doesNotMatch(page, /Uber Alles|Is Admin/)
  // no account is removed from the browser: removal is the one server call that checks who is removed
  assert.doesNotMatch(page, /Meteor\.users\.removeAsync|removeMemberSlates/)
})
