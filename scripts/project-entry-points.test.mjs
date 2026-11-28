// Every door of the slate rule gives a project's people its role on the project's slates, and stops
// once they are unshared:
//   1 common/slate-access.js       canReadSlate, canCommentSlate, canEditSlate (Meteor: read in source)
//   2 methods/native-slate-save.mjs canEditNativeSlate, and a first save into a project (saveNativeSlate)
//   3 common/slate-open-role.mjs   openSlateRole, with a drive link's key; the relay through it
//   4 api-token-core.mjs           authorizeTokenForSlate (user and team grants only)
//   5 methods/users.js             getSlateAccessUrl (Meteor: read in source)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canEditNativeSlate, saveNativeSlate } from '../web/app/server/methods/native-slate-save.mjs'
import { openSlateRole } from '../web/app/server/common/slate-open-role.mjs'
import { relayAccess } from '../web/app/server/common/relay-access.mjs'
import { createApiTokenService } from '../web/app/server/api-token-core.mjs'
import { checkPlacement } from '../web/app/server/projects/place.mjs'
import { fakeCollection, projectWorld } from './project-test-stores.mjs'

const KEY = 'L'.repeat(24)

async function world() {
  const w = projectWorld()
  const drive = await w.core.create(w.person('ana'), { name: 'Platform' })
  const folder = await w.core.create(w.person('ana'), { name: 'Services', parentId: drive.projectId })
  const slate = await w.slate('s1', 'ana', folder.projectId)
  const slateAccess = fakeCollection()
  const guestViews = fakeCollection()
  const projectRoleOf = (board, user, { projectKey = null, token = false } = {}) => w.access.slateProjectRole(board, user, { linkKey: projectKey, token })
  const stores = {
    access: slateAccess,
    guestViews,
    isTeamAdmin: async (userId) => w.claims.has(`${userId}:admin`),
    projectRoleOf,
    // the open rule's stores (slate-open-role.mjs)
    findSlate: (query) => w.slates.findOne(query),
    findGrant: (query) => slateAccess.findOne(query),
    listGrants: (query) => slateAccess.find(query).toArray(),
  }
  const share = (userId, role) => w.core.share(w.person('ana'), drive.projectId, { userId, role })
  const link = async (role) => {
    await w.core.share(w.person('ana'), drive.projectId, { link: role })
    await w.projectAccess.updateOne({ _id: `link_${drive.projectId}` }, { $set: { accessKey: KEY } })
  }
  return { w, drive, folder, slate, stores, share, link, slateAccess }
}

const user = (id, orgId = 't1') => ({ _id: id, orgId })

test('door 2: canEditNativeSlate lets a project editor save, a commenter not, and nobody once unshared', async () => {
  const { slate, stores, share } = await world()
  assert.equal(await canEditNativeSlate(stores, user('ben'), slate), false)
  await share('ben', 'editor')
  assert.equal(await canEditNativeSlate(stores, user('ben'), slate), true)
  await share('ben', 'commenter')
  assert.equal(await canEditNativeSlate(stores, user('ben'), slate), false)
  await share('ben', 'none')
  assert.equal(await canEditNativeSlate(stores, user('ben'), slate), false)
  // without the project input (a store that does not pass it) only the slate's own sharing counts
  await share('ben', 'editor')
  assert.equal(await canEditNativeSlate({ ...stores, projectRoleOf: null }, user('ben'), slate), false)
})

test('door 2: a drive link edits for a signed-in person with the key; never for a guest', async () => {
  const { slate, stores, link } = await world()
  await link('editor')
  assert.equal(await canEditNativeSlate(stores, user('zed', null), slate, undefined, undefined, { projectKey: KEY }), true)
  assert.equal(await canEditNativeSlate(stores, user('zed', null), slate), false)
  assert.equal(await canEditNativeSlate(stores, null, slate, 'visitor-1', undefined, { projectKey: KEY }), false)
})

test('door 2: a first save into a project needs an editor of it, and the slate is the project\'s team\'s', async () => {
  const { w, folder, stores, share } = await world()
  const made = []
  const deps = {
    ...stores,
    slates: w.slates,
    saveCore: { create: async ({ row }) => { made.push(row); return { created: true } } },
    placeSlate: (u, projectId) => checkPlacement({ access: w.access }, u, projectId),
    rememberInvitedEdit: async () => {},
    recordGuestEdit: async () => false,
    denied: () => Object.assign(new Error('denied'), { code: 'save-denied' }),
  }
  const request = (id) => ({ slate: { shareId: `new-${id}`, options: { id, name: 'New' }, nodes: [] }, projectId: folder.projectId })
  await assert.rejects(saveNativeSlate(deps, { _id: 'eve', orgId: 't2' }, request('n1')), { code: 'save-denied' })
  await share('eve', 'editor')
  await saveNativeSlate(deps, { _id: 'eve', orgId: 't2' }, request('n2'))
  assert.deepEqual([made[0].userId, made[0].orgId, made[0].projectId], ['eve', 't1', folder.projectId])
  // no placement store: a save naming a project is refused rather than made outside it
  await assert.rejects(saveNativeSlate({ ...deps, placeSlate: null }, { _id: 'eve', orgId: 't2' }, request('n3')), { code: 'save-denied' })
})

test('door 3: openSlateRole opens a private project slate at the project role, and through a drive link', async () => {
  const { slate, stores, share, link } = await world()
  assert.equal(await openSlateRole(stores, slate.shareId, user('ben')), null)
  await share('ben', 'viewer')
  assert.equal((await openSlateRole(stores, slate.shareId, user('ben'))).accessLevel, 'READ')
  await share('ben', 'commenter')
  assert.equal((await openSlateRole(stores, slate.shareId, user('ben'))).accessLevel, 'COMMENT')
  await share('ben', 'manager')
  assert.equal((await openSlateRole(stores, slate.shareId, user('ben'))).accessLevel, 'EDIT')
  await share('ben', 'none')
  assert.equal(await openSlateRole(stores, slate.shareId, user('ben')), null)
  // ?p=<key>: the link's role for a person, a viewer's for someone with no account
  await link('commenter')
  assert.equal((await openSlateRole(stores, slate.shareId, user('zed', null), { projectKey: KEY })).accessLevel, 'COMMENT')
  assert.equal((await openSlateRole(stores, slate.shareId, null, { projectKey: KEY })).accessLevel, 'READ')
  assert.equal(await openSlateRole(stores, slate.shareId, null), null)
  assert.equal(await openSlateRole(stores, slate.shareId, null, { projectKey: 'x'.repeat(24) }), null)
})

test('door 3: the collaboration relay lets a project editor write and a viewer read', async () => {
  const { slate, stores, share } = await world()
  assert.equal((await relayAccess(stores, { user: user('ben'), shareId: slate.shareId })).code, 'no-access')
  await share('ben', 'viewer')
  assert.equal((await relayAccess(stores, { user: user('ben'), shareId: slate.shareId })).role, 'read')
  await share('ben', 'editor')
  assert.equal((await relayAccess(stores, { user: user('ben'), shareId: slate.shareId })).role, 'write')
})

test('door 4: a token\'s account gets its project role on the slate, through its own and its team\'s grants only', async () => {
  const { w, drive, slate, share, link } = await world()
  const meteorLike = (collection) => ({
    findOneAsync: (query) => collection.findOne(query),
    find: (query) => ({ fetchAsync: () => collection.find(query).toArray() }),
  })
  const service = createApiTokenService({
    apiTokens: meteorLike(fakeCollection()),
    users: meteorLike(w.users),
    slates: meteorLike(w.slates),
    slateAccess: meteorLike(fakeCollection()),
    projectRoleOf: (board, u) => w.access.slateProjectRole(board, u, { token: true }),
  })
  const authorize = (userId, write) => service.authorizeTokenForSlate({ userId }, slate.shareId, write)
  assert.equal((await authorize('ben', false)).authorized, false)
  await share('ben', 'viewer')
  assert.equal((await authorize('ben', false)).authorized, true)
  assert.equal((await authorize('ben', false)).access.role, 'READ')
  assert.equal((await authorize('ben', true)).authorized, false)
  await share('ben', 'commenter')
  assert.equal((await authorize('ben', false)).access.role, 'COMMENT')
  await share('ben', 'editor')
  assert.equal((await authorize('ben', true)).authorized, true)
  await share('ben', 'none')
  assert.equal((await authorize('ben', false)).authorized, false)
  // a team grant counts; a team admin's manager rights and a drive link never do through a token
  await w.core.share(w.person('dee'), drive.projectId, { orgId: 't1', role: 'viewer' })
  assert.equal((await authorize('cy', false)).access.role, 'READ')
  assert.equal((await authorize('dee', true)).authorized, false)
  await link('editor')
  assert.equal((await authorize('zed', false)).authorized, false)
  // a workshop slate takes an editor of its project as an explicit collaborator
  await w.slates.updateOne({ _id: slate._id }, { $set: { creative: { model: { kind: 'workshop' } } } })
  await share('ben', 'editor')
  assert.equal((await authorize('ben', true)).authorized, true)
})

const source = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')
const between = (text, from, to) => text.slice(text.indexOf(from), to ? text.indexOf(to, text.indexOf(from)) : undefined)

test('door 1: canReadSlate, canCommentSlate and canEditSlate pass the project role to the rule', () => {
  const text = source('server/common/slate-access.js')
  assert.match(text, /import \{ slateProjectRoleOf \} from '\.\.\/projects\/access-meteor'/)
  assert.match(between(text, 'export async function canReadSlate', 'export async function canCommentSlate'), /resolveSlateRole\(slate, user, isAdmin, grants, undefined, await projectRoleFor\(slate, user\)\)/)
  assert.match(between(text, 'export async function canCommentSlate', 'export async function canEditSlate'), /resolveSlateRole\(slate, user, isAdmin, grants, undefined, await projectRoleFor\(slate, user\)\)/)
  assert.match(between(text, 'export async function canEditSlate', 'export async function requireEditableSlate'), /projectRoleOf: slateProjectRoleOf/)
  assert.match(text, /projectId: 1 \}/, 'findSlate reads the slate\'s project')
})

test('door 5: getSlateAccessUrl asks the rule with the project role instead of its own copy', () => {
  const text = between(source('server/methods/users.js'), 'getSlateAccessUrl(opts)', '// Server-only')
  assert.match(text, /const projectRole = await slateProjectRoleOf\(slate, user\)/)
  assert.match(text, /resolveSlateRole\(slate, user, isAdmin, grants, undefined, projectRole\)/)
  assert.match(text, /!projectRole/)
})

test('every Meteor wiring of the rule hands it the project input', () => {
  const slates = source('server/methods/slates.js')
  assert.match(between(slates, 'export const slateOpenStores', 'const method'), /projectRoleOf: slateProjectRoleOf/)
  assert.match(between(slates, 'method[CONSTANTS.methods.slates.update]', 'method[CONSTANTS.methods.slates.get]'), /projectRoleOf: slateProjectRoleOf[\s\S]*placeSlate/)
  assert.match(slates, /openSlateRole\(slateOpenStores, opts\.shareId, user, \{ projectKey: opts\.projectKey \|\| null \}\)/)
  assert.match(source('server/methods/creative-slates.js'), /projectRoleOf: slateProjectRoleOf/)
  assert.match(source('server/api-token-auth.mjs'), /projectRoleOf: \(slate, user\) => slateProjectRoleOf\(slate, user, \{ token: true \}\)/)
  // the relay's stores are the open rule's (collaborators.js and mount.js spread slateOpenStores)
  assert.match(source('server/methods/collaborators.js'), /\.\.\.slateOpenStores/)
})

test('the owner-only slate actions a project\'s owner and managers may also take: snapshots, the slate\'s own link', () => {
  const slates = source('server/methods/slates.js')
  assert.match(between(slates, 'method[CONSTANTS.methods.slates.createSnapshot]', 'method[CONSTANTS.methods.slates.getSnapshots]'), /projectCan\(await slateProjectRoleOf\(slate, await Meteor\.userAsync\(\)\), 'snapshotSlates'\)/)
  const access = source('server/methods/slateAccess.js')
  assert.match(between(access, 'async function linkOwnerFor', 'method[CONSTANTS.methods.slateAccess.get]'), /projectCan\(await slateProjectRoleOf\(board, user\), 'share'\) \? board\.userId : null/)
  assert.match(between(access, 'method[CONSTANTS.methods.slateAccess.configureLink]', 'method[CONSTANTS.methods.slateAccess.configureMember]'), /const ownerId = await linkOwnerFor\(slateId, this\.userId\)[\s\S]*changeSharing\(slateId, ownerId/)
  // member grants on a slate stay its owner's own
  assert.match(between(access, 'method[CONSTANTS.methods.slateAccess.configureMember]'), /const ownerId = this\.userId/)
})
