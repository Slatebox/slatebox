// The one rule for a person's role in a project (server/projects/project-role.mjs), what it gives on
// the project's slates (methods/slate-role.mjs resolveSlateRole's projectRole), and the loader every
// door asks (server/projects/project-access.mjs): owner, each grant kind, a team's admin, a link, a
// guest, a token, the higher of a slate's own sharing and its project's, a folder answering for its
// drive, and a removed person losing access.
import test from 'node:test'
import assert from 'node:assert/strict'
import { maxSlateRole, projectRoleToSlateRole, resolveProjectRole } from '../web/app/server/projects/project-role.mjs'
import { resolveSlateRole } from '../web/app/server/methods/slate-role.mjs'
import { atLeast, highestGrantable, projectCan, PROJECT_CAPABILITIES } from '../web/app/imports/api/common/project-roles.mjs'
import { projectWorld } from './project-test-stores.mjs'

const drive = { _id: 'd1', rootId: 'd1', ownerId: 'ana', orgId: 't1', parentId: null }
const personal = { _id: 'd2', rootId: 'd2', ownerId: 'fay', orgId: null, parentId: null }
const user = (role, extra = {}) => ({ projectId: 'd1', kind: 'user', userId: 'ben', role, ...extra })
const team = (role, orgId = 't1') => ({ projectId: 'd1', kind: 'team', orgId, role })
const link = (role, accessKey = 'k'.repeat(24)) => ({ projectId: 'd1', kind: 'link', accessKey, role })
const KEY = 'k'.repeat(24)

// [case, drive, user, grants, options, expected]
const ROLE_TABLE = [
  ['the owner', drive, { _id: 'ana' }, [], {}, 'owner'],
  ['a stranger with no grant', drive, { _id: 'zed' }, [], {}, null],
  ['a person granted viewer', drive, { _id: 'ben' }, [user('viewer')], {}, 'viewer'],
  ['a person granted commenter', drive, { _id: 'ben' }, [user('commenter')], {}, 'commenter'],
  ['a person granted editor', drive, { _id: 'ben' }, [user('editor')], {}, 'editor'],
  ['a person granted manager', drive, { _id: 'ben' }, [user('manager')], {}, 'manager'],
  ['a grant of none gives nothing', drive, { _id: 'ben' }, [user('none')], {}, null],
  ["another person's grant", drive, { _id: 'cy' }, [user('editor')], {}, null],
  ["another drive's grant", drive, { _id: 'ben' }, [user('editor', { projectId: 'other' })], {}, null],
  ['a team grant, for a member', drive, { _id: 'ben' }, [team('editor')], { memberOrgIds: ['t1'] }, 'editor'],
  ['a team grant, for someone outside the team', drive, { _id: 'eve' }, [team('editor')], { memberOrgIds: ['t2'] }, null],
  ['a team viewer who is also a named manager', drive, { _id: 'ben' }, [team('viewer'), user('manager')], { memberOrgIds: ['t1'] }, 'manager'],
  ["the drive team's admin manages it", drive, { _id: 'dee' }, [], { memberOrgIds: ['t1'], teamAdmin: true }, 'manager'],
  ["another team's admin", drive, { _id: 'eve' }, [], { memberOrgIds: ['t2'], teamAdmin: true }, null],
  ['an admin flag without membership of the drive team', drive, { _id: 'dee' }, [], { memberOrgIds: [], teamAdmin: true }, null],
  ['a team admin named viewer stays manager', drive, { _id: 'ben' }, [user('viewer')], { memberOrgIds: ['t1'], teamAdmin: true }, 'manager'],
  ['a link key that matches a viewer link', drive, { _id: 'zed' }, [link('viewer')], { linkKey: KEY }, 'viewer'],
  ['a link key that does not match', drive, { _id: 'zed' }, [link('viewer')], { linkKey: 'x'.repeat(24) }, null],
  ['a guest (no account) with an editor link', drive, null, [link('editor')], { linkKey: KEY }, 'editor'],
  ['a link never manages', drive, { _id: 'zed' }, [link('manager')], { linkKey: KEY }, 'editor'],
  ['a link grant without the key', drive, { _id: 'zed' }, [link('editor')], {}, null],
  ['a link viewer who is a named editor', drive, { _id: 'ben' }, [link('viewer'), user('editor')], { linkKey: KEY }, 'editor'],
  ['no drive', null, { _id: 'ana' }, [], {}, null],
  ['the owner with a link key', drive, { _id: 'ana' }, [link('viewer')], { linkKey: KEY }, 'owner'],
  ['a grant naming a role that does not exist', drive, { _id: 'ben' }, [user('owner')], {}, null],
  ["a personal drive has no team admin", personal, { _id: 'dee' }, [], { memberOrgIds: ['t1'], teamAdmin: true }, null],
]

for (const [name, d, u, grants, options, expected] of ROLE_TABLE) {
  test(`project role: ${name} -> ${expected}`, () => {
    assert.equal(resolveProjectRole(d, u, grants, options), expected)
  })
}

// [case, project role, slate role it gives]
const SLATE_ROLE_TABLE = [
  ['manager', 'manager', 'EDIT'],
  ['editor', 'editor', 'EDIT'],
  ['commenter', 'commenter', 'COMMENT'],
  ['viewer', 'viewer', 'READ'],
  ['no role', null, null],
]
for (const [name, role, expected] of SLATE_ROLE_TABLE) {
  test(`a project ${name} gets ${expected} on its slates`, () => {
    assert.equal(projectRoleToSlateRole(role), expected)
  })
}

const privateSlate = { _id: 's1', userId: 'ana', orgId: 't1', projectId: 'd1', options: { isPrivate: true } }
const unlistedSlate = { _id: 's2', userId: 'ana', orgId: 't1', projectId: 'd1', options: { isUnlisted: true } }
const named = (role, slate = privateSlate, type = 'private') => ({ slateId: slate._id, type, userId: 'ben', slateAccessPermissionId: role })

// [case, slate, user, grants, invitation, project role, expected]
const MAX_TABLE = [
  ['a stranger who is a project viewer reads a private slate', privateSlate, { _id: 'zed' }, [], undefined, 'viewer', 'READ'],
  ['a slate reader who is a project editor edits', privateSlate, { _id: 'ben' }, [named('READ')], undefined, 'editor', 'EDIT'],
  ['a slate editor who is a project viewer still edits', privateSlate, { _id: 'ben' }, [named('EDIT')], undefined, 'viewer', 'EDIT'],
  ['no slate grant and no project role', privateSlate, { _id: 'zed' }, [], undefined, null, null],
  ['a wrong invitation is refused, but the project role still opens it', unlistedSlate, { _id: 'zed' }, [], 'nope', 'commenter', 'COMMENT'],
  ['the slate owner edits whatever their project role', privateSlate, { _id: 'ana' }, [], undefined, 'viewer', 'EDIT'],
]
for (const [name, slate, u, grants, invitation, projectRole, expected] of MAX_TABLE) {
  test(`slate rule: ${name}`, () => {
    assert.equal(resolveSlateRole(slate, u, false, grants, invitation, projectRole), expected)
  })
}

test('maxSlateRole: EDIT > COMMENT > READ > null', () => {
  assert.equal(maxSlateRole('READ', 'EDIT'), 'EDIT')
  assert.equal(maxSlateRole('COMMENT', 'READ'), 'COMMENT')
  assert.equal(maxSlateRole(null, 'READ'), 'READ')
  assert.equal(maxSlateRole(null, null), null)
})

test('the capability table: owner > manager > editor > commenter > viewer, and a link never shares', () => {
  for (const what of PROJECT_CAPABILITIES) assert.ok(projectCan('owner', what), `owner may ${what}`)
  assert.ok(projectCan('manager', 'share') && !projectCan('manager', 'deleteProject'))
  assert.ok(projectCan('editor', 'createFolder') && !projectCan('editor', 'share') && !projectCan('editor', 'moveFolder'))
  assert.ok(projectCan('commenter', 'comment') && !projectCan('commenter', 'editSlates'))
  assert.ok(projectCan('viewer', 'open') && !projectCan('viewer', 'comment'))
  assert.equal(highestGrantable('manager'), 'manager')
  assert.equal(highestGrantable('editor'), null)
  assert.ok(atLeast('manager', 'editor') && !atLeast('viewer', 'editor'))
  assert.throws(() => projectCan('owner', 'fly'))
})

async function loaderWorld() {
  const w = projectWorld()
  await w.projects.insertOne({ _id: 'd1', rootId: 'd1', parentId: null, depth: 0, ownerId: 'ana', orgId: 't1', name: 'Drive' })
  await w.projects.insertOne({ _id: 'f1', rootId: 'd1', parentId: 'd1', depth: 1, ownerId: 'ana', orgId: 't1', name: 'Folder' })
  await w.projects.insertOne({ _id: 'f2', rootId: 'd1', parentId: 'f1', depth: 2, ownerId: 'ana', orgId: 't1', name: 'Sub' })
  await w.projectAccess.insertOne({ _id: 'user_ben_d1', projectId: 'd1', kind: 'user', userId: 'ben', role: 'editor' })
  await w.projectAccess.insertOne({ _id: 'link_d1', projectId: 'd1', kind: 'link', accessKey: KEY, role: 'commenter' })
  await w.projectAccess.insertOne({ _id: 'team_t2_d1', projectId: 'd1', kind: 'team', orgId: 't2', role: 'viewer' })
  return w
}

test('loader: a folder, at any depth, answers with its drive\'s people', async () => {
  const { access } = await loaderWorld()
  assert.equal(await access.roleFor({ _id: 'ben' }, 'f2'), 'editor')
  assert.equal((await access.driveOf('f2'))._id, 'd1')
  assert.deepEqual(await access.folderIds('d1'), ['d1', 'f1', 'f2'])
  assert.deepEqual(await access.folderIds('f1', { nested: false }), ['f1'])
})

test('loader: a team grant reads the team from the account when the caller passes only an id', async () => {
  const { access } = await loaderWorld()
  assert.equal(await access.roleFor({ _id: 'eve' }, 'd1'), 'viewer')
})

test('loader: a token gets no team admin rights and never uses a link', async () => {
  const { access } = await loaderWorld()
  assert.equal(await access.roleFor({ _id: 'dee', orgId: 't1' }, 'd1'), 'manager')
  assert.equal(await access.roleFor({ _id: 'dee', orgId: 't1' }, 'd1', { token: true }), null)
  assert.equal(await access.roleFor({ _id: 'zed' }, 'd1', { linkKey: KEY }), 'commenter')
  assert.equal(await access.roleFor({ _id: 'zed' }, 'd1', { linkKey: KEY, token: true }), null)
  assert.equal(await access.roleFor({ _id: 'ben' }, 'd1', { token: true }), 'editor')
})

test('loader: someone with no account opens through a link as a viewer at most', async () => {
  const { access } = await loaderWorld()
  const slate = { _id: 's1', projectId: 'f1' }
  assert.equal(await access.slateProjectRole(slate, null, { linkKey: KEY }), 'viewer')
  assert.equal(await access.slateProjectRole(slate, null), null)
  assert.equal(await access.slateProjectRole({ _id: 's2', projectId: null }, { _id: 'ben' }), null)
})

test('loader: a removed person loses access at once', async () => {
  const w = await loaderWorld()
  assert.equal(await w.access.roleFor({ _id: 'ben' }, 'f1'), 'editor')
  await w.projectAccess.deleteOne({ _id: 'user_ben_d1' })
  assert.equal(await w.access.roleFor({ _id: 'ben' }, 'f1'), null)
})

test('loader: the drives in a person\'s sidebar', async () => {
  const w = await loaderWorld()
  await w.projects.insertOne({ _id: 'd9', rootId: 'd9', parentId: null, depth: 0, ownerId: 'cy', orgId: 't1', name: 'Cy\'s' })
  assert.deepEqual((await w.access.readableDriveIds({ _id: 'ana' })).sort(), ['d1'])
  assert.deepEqual((await w.access.readableDriveIds({ _id: 'ben' })).sort(), ['d1'])
  assert.deepEqual((await w.access.readableDriveIds({ _id: 'eve' })).sort(), ['d1'])
  // the team's admin sees every drive of the team
  assert.deepEqual((await w.access.readableDriveIds({ _id: 'dee' })).sort(), ['d1', 'd9'])
  assert.deepEqual(await w.access.readableDriveIds({ _id: 'zed' }), [])
  assert.deepEqual(await w.access.readableDriveIds(null), [])
})
