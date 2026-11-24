// Who may change whom in a team (web/app/server/team-guard.mjs): removing a member and changing a
// member's claims are refused by the server for the owner, for yourself, and for admins unless the
// caller is an admin; giving the admin claim keeps slate claims and the server administrator claim.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { removalRefusal, roleChangeRefusal, clearedByAdmin, PEOPLE_CLAIMS } from '../web/app/server/team-guard.mjs'
import { roleChanges, roleOf } from '../web/app/imports/ui/components/teams/team-roles.mjs'

const app = new URL('../web/app/', import.meta.url).pathname
const read = (file) => readFileSync(app + file, 'utf8')

const owner = { _id: 'o', orgId: 'T', isOrgOwner: true, isAdmin: true }
const admin = { _id: 'a', orgId: 'T', isOrgOwner: false, isAdmin: true }
const manager = { _id: 'm', orgId: 'T', isOrgOwner: false, isAdmin: false }
const member = { _id: 'p', orgId: 'T', isOrgOwner: false, isAdmin: false }
const stranger = { _id: 's', orgId: 'X', isOrgOwner: false, isAdmin: false }

test('removing a member: never the owner, never yourself, an admin only by an admin', () => {
  const as = (who, canRemove = true) => ({ ...who, canRemove })
  assert.equal(removalRefusal(as(manager), member), null)
  assert.equal(removalRefusal(as(admin), member), null)
  assert.equal(removalRefusal(as(owner), admin), null)
  assert.equal(removalRefusal(as(admin), { ...admin, _id: 'a2' }), null)
  assert.match(removalRefusal(as(manager), owner), /owner/)
  assert.match(removalRefusal(as(admin), owner), /owner/)
  assert.match(removalRefusal(as(manager), admin), /Only an admin/)
  assert.match(removalRefusal(as(manager), manager), /yourself/)
  assert.match(removalRefusal(as(manager, false), member), /permission/)
  assert.match(removalRefusal(as(manager), stranger), /your team/)
  assert.match(removalRefusal(as(manager), null), /your team/)
  assert.match(removalRefusal(null, member), /your team/)
})

test('changing claims: never the owner, never yourself, the admin claim only by an admin, never uberMensch', () => {
  const add = (claimIds) => ({ claimIds, action: 'add' })
  const del = (claimIds) => ({ claimIds, action: 'delete' })
  assert.equal(roleChangeRefusal(manager, member, add([...PEOPLE_CLAIMS])), null)
  assert.equal(roleChangeRefusal(manager, member, del(['canViewUsers'])), null)
  assert.equal(roleChangeRefusal(admin, member, add(['admin'])), null)
  assert.equal(roleChangeRefusal(admin, { ...admin, _id: 'a2' }, del(['admin'])), null)
  assert.match(roleChangeRefusal(manager, manager, add(['admin'])), /your own/, 'a manager cannot raise themselves')
  assert.match(roleChangeRefusal(admin, admin, del(['admin'])), /your own/)
  assert.match(roleChangeRefusal(manager, member, add(['admin'])), /Only an admin/)
  assert.match(roleChangeRefusal(manager, admin, del(['admin'])), /Only an admin/)
  assert.match(roleChangeRefusal(manager, admin, add(['canCopyTeamSlates'])), /Only an admin/, 'an admin\'s claims are an admin\'s to change')
  assert.match(roleChangeRefusal(admin, owner, del(['admin'])), /owner/)
  assert.match(roleChangeRefusal(admin, member, add(['uberMensch'])), /cannot be given/)
  assert.match(roleChangeRefusal(admin, member, del(['uberMensch'])), /cannot be given/)
  assert.match(roleChangeRefusal(admin, null, add(['canViewUsers'])), /not in your team/)
})

// the Permissions rows users.changeRoles writes, as in server/methods/users.js
function apply(rows, entries) {
  let held = [...rows]
  for (const { claimIds, action } of entries) {
    if (action === 'add') {
      if (claimIds[0] === 'admin') held = held.filter((c) => !clearedByAdmin().includes(c))
      for (const c of claimIds) if (!held.includes(c)) held.push(c)
    } else held = held.filter((c) => !claimIds.includes(c))
  }
  return held
}

test('Member with slate claims -> Admin -> Manager -> Member keeps the slate claims and uberMensch', () => {
  let rows = ['canCopyTeamSlates', 'canAddSlates', 'uberMensch']
  rows = apply(rows, roleChanges(rows, 'admin'))
  assert.equal(roleOf({ claimIds: rows }).id, 'admin')
  assert.deepEqual(rows.filter((c) => c !== 'admin').sort(), ['canAddSlates', 'canCopyTeamSlates', 'uberMensch'])
  rows = apply(rows, roleChanges(rows, 'manager'))
  assert.equal(roleOf({ claimIds: rows }).id, 'manager')
  assert.ok(rows.includes('canCopyTeamSlates') && rows.includes('canAddSlates') && rows.includes('uberMensch'))
  rows = apply(rows, roleChanges(rows, 'member'))
  assert.deepEqual(rows.sort(), ['canAddSlates', 'canCopyTeamSlates', 'uberMensch'])
  // Manager -> Admin clears the people claims the admin claim includes
  rows = apply([...PEOPLE_CLAIMS, 'canRemoveComments'], roleChanges([...PEOPLE_CLAIMS], 'admin'))
  assert.deepEqual(rows.sort(), ['admin', 'canRemoveComments'])
})

test('the server uses these rules, and no browser removes an account', () => {
  const users = read('server/methods/users.js')
  const changeRoles = users.slice(users.indexOf('method[CONSTANTS.methods.users.changeRoles]'), users.indexOf('// Who may ask how often'))
  assert.match(changeRoles, /roleChangeRefusal\(caller, member, u\)/)
  assert.match(changeRoles, /claimId: \{ \$in: clearedByAdmin\(\) \}/)
  assert.doesNotMatch(changeRoles, /Permissions\.removeAsync\(team\)/, 'no wipe of every row')
  const removal = read('server/methods/team-member-slates.js')
  assert.match(removal, /'organizations\.removeMember'/)
  assert.match(removal, /removalRefusal\(caller, member\)/)
  assert.doesNotMatch(removal, /removeMemberSlates/)
  const permissions = read('server/permissions.js')
  const allow = permissions.slice(permissions.indexOf('Meteor.users.allow({'), permissions.indexOf('})\n', permissions.indexOf('Meteor.users.allow({')))
  assert.doesNotMatch(allow, /remove/)
  assert.match(read('server/common/team-person.js'), /isOrgOwner === true \|\|/)
})
