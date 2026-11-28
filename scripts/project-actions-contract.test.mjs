// The projects actions (server/actions/projects-*.mjs) are one surface: a Meteor method, an /api/v1
// route, an exec call, an MCP tool and a CLI command each, with their scopes; the generated contract
// holds all nine; what widens access or deletes is held in a script; and each runs the projects core
// through the registry with its checks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { API_TOKEN_SCOPES } from '../web/app/server/api-token-core.mjs'
import { ACTION_AUDIT } from '../web/app/server/audit/action-specs.mjs'
import { tokenPermissions } from '../web/app/imports/api/common/token-permissions.mjs'
import { checkPlacement } from '../web/app/server/projects/place.mjs'
import { projectWorld } from './project-test-stores.mjs'

const generated = (name) => JSON.parse(readFileSync(new URL(`../web/app/server/actions/generated/${name}`, import.meta.url), 'utf8'))

const EXPECTED = {
  'projects.list': ['read', 'projects:read', 'GET /api/v1/projects', 'list_projects'],
  'projects.get': ['read', 'projects:read', 'GET /api/v1/projects/{projectId}', 'get_project'],
  'projects.create': ['write', 'projects:write', 'POST /api/v1/projects', 'create_project'],
  'projects.update': ['write', 'projects:write', 'PATCH /api/v1/projects/{projectId}', 'update_project'],
  'projects.delete': ['write', 'projects:write', 'DELETE /api/v1/projects/{projectId}', 'delete_project'],
  'projects.slates': ['read', 'projects:read', 'GET /api/v1/projects/{projectId}/slates', 'list_project_slates'],
  'projects.moveSlate': ['write', 'projects:write', 'POST /api/v1/slates/{shareId}/project', 'move_slate_to_project'],
  'projects.access': ['read', 'projects:share', 'GET /api/v1/projects/{projectId}/access', 'get_project_sharing'],
  'projects.share': ['write', 'projects:share', 'POST /api/v1/projects/{projectId}/access', 'share_project'],
}

test('the contract holds the nine projects actions, with their scopes, routes and tools', () => {
  const contract = generated('contract.json')
  const ids = contract.actions.filter((action) => action.id.startsWith('projects.')).map((action) => action.id).sort()
  assert.deepEqual(ids, Object.keys(EXPECTED).sort())
  for (const [id, [kind, scope, route, tool]] of Object.entries(EXPECTED)) {
    const action = contract.actions.find((item) => item.id === id)
    assert.equal(action.readOnly, kind === 'read', id)
    assert.equal(action.scope, scope, id)
    assert.equal(`${action.http.method} ${action.http.path}`, route, id)
    assert.equal(action.tool.name, tool, id)
    assert.deepEqual(action.principals.filter((p) => p !== 'guest'), ['person', 'agent'], id)
  }
  for (const scope of ['projects:read', 'projects:write', 'projects:share']) {
    assert.ok(API_TOKEN_SCOPES.includes(scope), scope)
    assert.ok(contract.scopes.some((item) => (item.scope || item) === scope || item.name === scope), `contract lists ${scope}`)
    assert.ok(tokenPermissions.some((item) => item.scope === scope), `the token form names ${scope}`)
  }
})

test('the exec client and the MCP tools carry the projects methods', () => {
  const client = generated('client.json')
  const names = (manifest) => manifest.methods.map((method) => method.name).filter((name) => name.startsWith('projects.')).sort()
  const methods = names(client)
  assert.deepEqual(methods, Object.keys(EXPECTED).sort())
  const mcp = JSON.parse(readFileSync(new URL('../packages/slatebox-mcp/generated/client.json', import.meta.url), 'utf8'))
  assert.deepEqual(names(mcp), methods, 'the MCP package has the same client')
  assert.match(readFileSync(new URL('../web/app/server/actions/generated/slatebox.d.ts', import.meta.url), 'utf8'), /moveSlate/)
})

test('what widens access is held for a yes; deleting is destructive; every write says what the log keeps', () => {
  const registry = createAppRegistry()
  assert.equal(registry.get('projects.share').confirm, true)
  assert.equal(registry.get('projects.moveSlate').confirm, true)
  assert.equal(registry.get('projects.delete').destructive, true)
  assert.deepEqual(registry.get('projects.delete').modes, ['save', 'preview'])
  for (const id of ['projects.create', 'projects.update', 'projects.delete', 'projects.moveSlate', 'projects.share']) {
    assert.ok(ACTION_AUDIT[id]?.inside, `${id} is recorded by the projects core`)
  }
  // the existing slate actions take a project
  assert.ok(registry.get('slates.list').input.properties.scope.enum.includes('project'))
  for (const id of ['slates.create', 'slates.importMermaid', 'slates.copy', 'slates.list']) assert.ok(registry.get(id).input.properties.projectId, `${id} takes projectId`)
})

function registryWorld() {
  const w = projectWorld()
  const deps = {
    projects: w.core,
    appOrigin: () => 'https://app.example',
    loadUser: (userId) => w.users.findOne({ _id: userId }),
    placeSlate: (user, projectId, options) => checkPlacement({ access: w.access }, user, projectId, options),
  }
  const built = createAppRegistry({ deps })
  // what the action answered (run gives { status, body, meta })
  const registry = { run: async (...args) => (await built.run(...args)).body }
  const token = (userId, scopes = ['projects:read', 'projects:write', 'projects:share']) => ({ kind: 'agent', userId, tokenId: `tok-${userId}`, tokenName: 't', scopes })
  return { w, registry, token, deps }
}

test('through the registry: a token makes a project and a folder, lists them and its slates', async () => {
  const { w, registry, token } = registryWorld()
  const drive = await registry.run(token('ana'), 'projects.create', { name: 'Platform' })
  assert.equal(drive.mode, 'save')
  const folder = await registry.run(token('ana'), 'projects.create', { name: 'Services', parentId: drive.projectId })
  assert.equal(folder.kind, 'folder')
  const listed = await registry.run(token('ana'), 'projects.list', {})
  assert.deepEqual(listed.projects.map((p) => p.name), ['Platform'])
  const got = await registry.run(token('ana'), 'projects.get', { projectId: folder.projectId })
  assert.deepEqual(got.path.map((p) => p.name), ['Platform'])
  await w.slate('a1', 'ana', folder.projectId)
  const slates = await registry.run(token('ana'), 'projects.slates', { projectId: drive.projectId })
  assert.deepEqual(slates.slates.map((s) => [s.shareId, s.owner, s.url]), [['s-a1', 'you', 'https://app.example/canvas/s-a1']])
})

test('through the registry: scopes are required; a missing role answers 404; the share form is checked first', async () => {
  const { registry, token } = registryWorld()
  await assert.rejects(registry.run(token('ana', ['projects:read']), 'projects.create', { name: 'x' }), { status: 403, code: 'insufficient_scope' })
  const drive = await registry.run(token('ana'), 'projects.create', { name: 'Platform' })
  await assert.rejects(registry.run(token('ben'), 'projects.get', { projectId: drive.projectId }), { status: 404 })
  await assert.rejects(registry.run(token('ana', ['projects:read', 'projects:write']), 'projects.share', { projectId: drive.projectId, userId: 'ben', role: 'viewer' }), { status: 403, code: 'insufficient_scope' })
  await assert.rejects(registry.run(token('ana'), 'projects.share', { projectId: drive.projectId, userId: 'ben' }), { status: 400 })
  await assert.rejects(registry.run(token('ana'), 'projects.share', { projectId: drive.projectId, userId: 'ben', email: 'b@example.com', role: 'viewer' }), { status: 400 })
  await assert.rejects(registry.run(token('ana'), 'projects.share', { projectId: drive.projectId, link: 'viewer', role: 'viewer' }), { status: 400 })
  const shared = await registry.run(token('ana'), 'projects.share', { projectId: drive.projectId, userId: 'ben', role: 'viewer' })
  assert.equal(shared.grants[0].role, 'viewer')
  const access = await registry.run(token('ana'), 'projects.access', { projectId: drive.projectId })
  assert.equal(access.owner.userId, 'ana')
  await assert.rejects(registry.run(token('ana'), 'projects.create', { name: 'x', extra: 1 }), { status: 400 })
})

test('through the registry: move a slate in, preview and delete the project', async () => {
  const { w, registry, token } = registryWorld()
  const drive = await registry.run(token('ana'), 'projects.create', { name: 'Platform' })
  await w.slate('a1', 'ana')
  const moved = await registry.run(token('ana'), 'projects.moveSlate', { shareId: 's-a1', projectId: drive.projectId })
  assert.deepEqual([moved.projectId, moved.moved], [drive.projectId, true])
  const preview = await registry.run(token('ana'), 'projects.delete', { projectId: drive.projectId, mode: 'preview' })
  assert.deepEqual([preview.mode, preview.deleted, preview.deletedSlates], ['preview', false, 1])
  const out = await registry.run(token('ana'), 'projects.moveSlate', { shareId: 's-a1', projectId: null })
  assert.equal(out.projectId, null)
  const done = await registry.run(token('ana'), 'projects.delete', { projectId: drive.projectId })
  assert.deepEqual([done.deleted, done.deletedSlates], [true, 0])
})

test('through the registry: slates.copy into a project needs an editor of it', async () => {
  const { w, registry, token, deps } = registryWorld()
  const drive = await registry.run(token('ana'), 'projects.create', { name: 'Platform' })
  await w.slate('b1', 'ben', null, { options: { name: 'Ben\'s', isPublic: true } })
  const copyDeps = {
    resolveSlateForUser: async (shareId) => ({ slate: await w.slates.findOne({ shareId }), canRead: true, canEdit: false }),
    publishedPresentation: async () => null,
    generateShareId: async () => 'copy1',
    newId: () => 'copy1id',
    saveCore: { create: async ({ row }) => { await w.slates.insertOne(row); return { revision: 1 } } },
  }
  const built2 = createAppRegistry({ deps: { ...deps, ...copyDeps } })
  const registry2 = { run: async (...args) => (await built2.run(...args)).body }
  const scoped = { ...token('cy'), scopes: ['slates:write'] }
  await assert.rejects(registry2.run(scoped, 'slates.copy', { shareId: 's-b1', projectId: drive.projectId }), { status: 404 })
  await registry.run(token('ana'), 'projects.share', { projectId: drive.projectId, userId: 'cy', role: 'editor' })
  const copied = await registry2.run(scoped, 'slates.copy', { shareId: 's-b1', projectId: drive.projectId })
  const row = await w.slates.findOne({ shareId: copied.shareId })
  assert.deepEqual([row.userId, row.projectId, row.orgId], ['cy', drive.projectId, 't1'])
})

test('through the registry: a project\'s owner deletes a slate in it; a manager does not', async () => {
  const { w, registry, token, deps } = registryWorld()
  const drive = await registry.run(token('ana'), 'projects.create', { name: 'Platform' })
  await registry.run(token('ana'), 'projects.share', { projectId: drive.projectId, userId: 'ben', role: 'manager' })
  await w.slate('e1', 'eve', drive.projectId)
  const gone = []
  const built = createAppRegistry({ deps: {
    ...deps,
    authorizeTokenForSlate: async (_token, shareId) => ({ slate: await w.slates.findOne({ shareId }), authorized: true, access: { role: 'EDIT', canEdit: true, isOwner: false } }),
    deleteSlate: async (slate) => gone.push(slate.shareId),
  } })
  const remove = (userId) => built.run({ ...token(userId), scopes: ['slates:delete'] }, 'slates.delete', { shareId: 's-e1' })
  await assert.rejects(remove('ben'), { status: 403 })
  assert.equal((await remove('ana')).body.deleted, true)
  assert.deepEqual(gone, ['s-e1'])
})
