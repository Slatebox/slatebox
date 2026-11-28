// Someone who reaches a project only through its link (/p/<key>) sees the slates the link grants.
// The bug: the project page's list (slates.get, DisplaySlates) sent the link's key as linkKey while
// the server read only projectKey, and projects.slates took no key at all, so a link holder opened
// the project (projects.get took the key) and saw an empty slate list. Now both lists take the key:
//   1 projectAccess.listableProjectIds  what slates.get lists for the project page
//   2 projects.slates                   the action (Meteor method, /api/v1, exec, MCP), linkKey input
// and each listed slate opens through the slate rule at the link's role, or higher when the slate's
// own sharing gives the person more.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { openSlateRole } from '../web/app/server/common/slate-open-role.mjs'
import { principalFromUser } from '../web/app/server/actions/principal.mjs'
import { checkPlacement } from '../web/app/server/projects/place.mjs'
import { fakeCollection, projectWorld } from './project-test-stores.mjs'

const source = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')
const between = (text, start, end) => {
  const from = text.indexOf(start)
  assert.ok(from >= 0, `${start} is in the source`)
  const to = text.indexOf(end, from + start.length)
  return text.slice(from, to < 0 ? undefined : to)
}

// ana's drive with a folder; ana's and ben's slates in it; one slate of ana's in another drive.
// fay is in no team and has no grant: she has only the link.
async function linkWorld(role = 'viewer') {
  const w = projectWorld()
  const drive = await w.core.create(w.person('ana'), { name: 'Platform' })
  const folder = await w.core.create(w.person('ana'), { name: 'Services', parentId: drive.projectId })
  const other = await w.core.create(w.person('ana'), { name: 'Elsewhere' })
  await w.core.share(w.person('ana'), drive.projectId, { userId: 'ben', role: 'editor' })
  await w.slate('top', 'ana', drive.projectId, { lastSaved: 3 })
  await w.slate('bens', 'ben', drive.projectId, { lastSaved: 2 })
  await w.slate('deep', 'ana', folder.projectId, { lastSaved: 1 })
  await w.slate('away', 'ana', other.projectId)
  await w.slate('loose', 'ana')
  const shared = await w.core.share(w.person('ana'), drive.projectId, { link: role })
  const key = shared.link.url.split('/p/')[1]
  return { w, drive, folder, other, key }
}

const fay = { _id: 'fay', orgId: null }
// fay in the app (DDP): a session acts with the account's own rights (actions/principal.mjs)
const session = (userId) => principalFromUser({ _id: userId }, ['projects:read', 'projects:write', 'projects:share'])

test('slates.get for the project page: a link holder gets the drive, and its folders when nested', async () => {
  const { w, drive, folder, key } = await linkWorld()
  assert.deepEqual(await w.access.listableProjectIds(fay, drive.projectId, { linkKey: key }), [drive.projectId])
  assert.deepEqual(await w.access.listableProjectIds(fay, drive.projectId, { linkKey: key, nested: true }), [drive.projectId, folder.projectId])
  // a folder opened from the link lists that folder
  assert.deepEqual(await w.access.listableProjectIds(fay, folder.projectId, { linkKey: key }), [folder.projectId])
  // the owner and a named person need no key
  assert.deepEqual(await w.access.listableProjectIds({ _id: 'ana' }, drive.projectId), [drive.projectId])
  assert.deepEqual(await w.access.listableProjectIds({ _id: 'ben' }, drive.projectId), [drive.projectId])
})

test('slates.get for the project page: no key, a wrong key, another drive, a rotated or switched-off link, a token: nothing', async () => {
  const { w, drive, other, key } = await linkWorld()
  assert.deepEqual(await w.access.listableProjectIds(fay, drive.projectId), [])
  assert.deepEqual(await w.access.listableProjectIds(fay, drive.projectId, { linkKey: 'x'.repeat(24) }), [])
  assert.deepEqual(await w.access.listableProjectIds(fay, other.projectId, { linkKey: key }), [], 'a link opens its own drive only')
  assert.deepEqual(await w.access.listableProjectIds(fay, drive.projectId, { linkKey: key, token: true }), [], 'a token never uses a link')
  assert.deepEqual(await w.access.listableProjectIds(null, drive.projectId, { linkKey: key }), [], 'the list is for an account')
  assert.deepEqual(await w.access.listableProjectIds(fay, 'nope', { linkKey: key }), [])
  await w.core.share(w.person('ana'), drive.projectId, { link: 'viewer', rotate: true })
  assert.deepEqual(await w.access.listableProjectIds(fay, drive.projectId, { linkKey: key }), [], 'the old key stops listing')
  const fresh = (await w.core.getAccess(w.person('ana'), drive.projectId)).link.url.split('/p/')[1]
  assert.deepEqual(await w.access.listableProjectIds(fay, drive.projectId, { linkKey: fresh }), [drive.projectId])
  await w.core.share(w.person('ana'), drive.projectId, { link: 'none' })
  assert.deepEqual(await w.access.listableProjectIds(fay, drive.projectId, { linkKey: fresh }), [])
})

test('slates.get reads the key the project page sends (linkKey), and a canvas address\'s (projectKey)', () => {
  const slates = source('server/methods/slates.js')
  assert.match(slates, /for \(const key of \['projectKey', 'linkKey', 'projectId'\]\)/, 'linkKey is checked to be a string')
  const list = between(slates, "if (opts.type === 'project') {", 'const sFilter')
  assert.match(list, /projectAccess\.listableProjectIds\(user, opts\.projectId, \{/)
  assert.match(list, /linkKey: opts\.linkKey \|\| opts\.projectKey \|\| null/)
  assert.match(list, /if \(!projectIds\.length\) return \{ slates: \[\], counts: \{ total: 0 \} \}/)
  // what the page sends
  assert.match(source('imports/ui/components/DisplaySlates.jsx'), /\.\.\.\(type === 'project' && \{ projectId, \.\.\.\(linkKey && \{ linkKey \}\) \}\)/)
})

function registryWorld(w) {
  const deps = {
    projects: w.core,
    appOrigin: () => 'https://app.example',
    loadUser: (userId) => w.users.findOne({ _id: userId }),
    placeSlate: (user, projectId, options) => checkPlacement({ access: w.access }, user, projectId, options),
  }
  const built = createAppRegistry({ deps })
  return { run: async (...args) => (await built.run(...args)).body, registry: built }
}

test('projects.slates: a link holder lists the drive\'s slates, whoever owns them, and nothing outside it', async () => {
  const { w, drive, folder, key } = await linkWorld()
  const { run, registry } = registryWorld(w)
  assert.ok(registry.get('projects.slates').input.properties.linkKey, 'projects.slates takes linkKey')
  const listed = await run(session('fay'), 'projects.slates', { projectId: drive.projectId, linkKey: key })
  assert.deepEqual(listed.slates.map((s) => [s.shareId, s.owner]), [['s-top', 'someone'], ['s-bens', 'someone'], ['s-deep', 'someone']])
  const flat = await run(session('fay'), 'projects.slates', { projectId: drive.projectId, linkKey: key, nested: false })
  assert.deepEqual(flat.slates.map((s) => s.shareId), ['s-top', 's-bens'])
  const inFolder = await run(session('fay'), 'projects.slates', { projectId: folder.projectId, linkKey: key })
  assert.deepEqual(inFolder.slates.map((s) => s.shareId), ['s-deep'])
  // projects.get opens the same drive with the same key
  assert.equal((await run(session('fay'), 'projects.get', { projectId: drive.projectId, linkKey: key })).role, 'viewer')
})

test('projects.slates: without the key, with a wrong one or as a token, a link holder gets 404', async () => {
  const { w, drive, other, key } = await linkWorld()
  const { run } = registryWorld(w)
  await assert.rejects(run(session('fay'), 'projects.slates', { projectId: drive.projectId }), { status: 404 })
  await assert.rejects(run(session('fay'), 'projects.slates', { projectId: drive.projectId, linkKey: 'x'.repeat(24) }), { status: 404 })
  await assert.rejects(run(session('fay'), 'projects.slates', { projectId: other.projectId, linkKey: key }), { status: 404 })
  await assert.rejects(run(w.token('fay'), 'projects.slates', { projectId: drive.projectId, linkKey: key }), { status: 404 })
})

test('each listed slate opens with the link at the link\'s role, or the slate\'s own higher role', async () => {
  for (const [role, level] of [['viewer', 'READ'], ['commenter', 'COMMENT'], ['editor', 'EDIT']]) {
    const { w, drive, key } = await linkWorld(role)
    const slateAccess = fakeCollection()
    const stores = {
      findSlate: (query) => w.slates.findOne(query),
      findGrant: (query) => slateAccess.findOne(query),
      listGrants: (query) => slateAccess.find(query).toArray(),
      isTeamAdmin: async (userId) => w.claims.has(`${userId}:admin`),
      projectRoleOf: (board, user, { projectKey = null } = {}) => w.access.slateProjectRole(board, user, { linkKey: projectKey }),
    }
    // the slate's own sharing gives fay edit on one slate
    await slateAccess.insertOne({ _id: 'g1', slateId: 'bens', type: 'private', userId: 'fay', slateAccessPermissionId: 'EDIT' })
    const listed = await w.core.listSlates(w.person('fay'), drive.projectId, { linkKey: key })
    assert.equal(listed.length, 3, role)
    for (const row of listed) {
      const opened = await openSlateRole(stores, row.shareId, fay, { projectKey: key })
      assert.ok(opened, `${row.shareId} opens for the link holder (${role})`)
      assert.equal(opened.accessLevel, row._id === 'bens' ? 'EDIT' : level, `${row.shareId} as ${role}`)
    }
    // a slate outside the drive is neither listed nor opened by this link
    assert.equal(await openSlateRole(stores, 's-away', fay, { projectKey: key }), null)
  }
})

test('the browser passes the link\'s key to projects.slates too', () => {
  const client = source('imports/api/client/projects.js')
  assert.match(client, /slates: async \(\{ projectId, folders = true, linkKey = null \} = \{\}\)/)
  assert.match(client, /call\('projects\.slates', \{ projectId, nested: folders !== false, limit: 100, \.\.\.\(linkKey && \{ linkKey \}\) \}\)/)
})
