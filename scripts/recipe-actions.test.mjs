// recipes.* in the action registry (enterprise/server/recipes/actions.mjs): every one is accepted
// by the app's registry, the scopes recipes need are exactly what these actions check, the
// permission and admin ones are people-only Meteor methods, literal routes come before
// /recipes/{instanceId}, and the service's refusals reach callers with their codes.
// Run with: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-actions.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { recipeActions } from '../enterprise/server/recipes/actions.mjs'
import { auditEntry, registerRecipes } from '../enterprise/server/recipes/index.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { ENTERPRISE_ONLY_SCOPES } from '../web/app/server/api-token-core.mjs'
import { isNeverBound, boundActions } from '../web/app/server/actions/exec-binding.mjs'
import { buildEntry } from '../web/app/server/audit/events.mjs'
import { createEnterpriseHost } from '../web/app/server/enterprise-loader.mjs'
import * as testGraph from './fixtures/recipes/test-graph.mjs'
import { createRecipeWorld } from './fakes/recipe-world.mjs'

const build = (service = () => ({})) => createAppRegistry({ extraActions: recipeActions(service) })

test('every recipes action is accepted, with the scopes recipes add', () => {
  const registry = build()
  const ours = registry.list().filter((a) => a.id.startsWith('recipes.'))
  // 27 of the runtime, plus the switches the Recipes UI sets (project, owner, team, server) and its
  // pickers, plus a synced slate's line and its "Save to repo now"
  assert.equal(ours.length, 36)
  for (const id of ['recipes.pauseProject', 'recipes.mine', 'recipes.pauseMine', 'recipes.team.get', 'recipes.team.set', 'recipes.pickerOptions', 'recipes.admin.pauseAll', 'recipes.saveNow', 'recipes.syncedOn']) assert.ok(registry.get(id), id)
  const scopes = new Set(ours.map((a) => a.scope))
  for (const scope of ENTERPRISE_ONLY_SCOPES) assert.ok(scopes.has(scope), scope)
  assert.deepEqual(registry.neededScopes().filter((s) => s.startsWith('recipes:')), [...ENTERPRISE_ONLY_SCOPES])
})

test('permissions outside Slatebox, approvals and the server switch: people only, in the app', () => {
  const registry = build()
  for (const id of ['recipes.grant', 'recipes.revoke', 'recipes.decideWrite', 'recipes.admin.setEnabled', 'recipes.admin.status', 'recipes.admin.pauseAll', 'recipes.pauseMine', 'recipes.team.set']) {
    const action = registry.get(id)
    assert.deepEqual(action.principals, ['person'], id)
    assert.equal(action.mounts.http, null, id)
    assert.ok(isNeverBound(id), id)
  }
  const bound = boundActions(registry).map((a) => a.id).filter((id) => id.startsWith('recipes.'))
  assert.ok(bound.includes('recipes.run') && bound.includes('recipes.hooks.add') && !bound.includes('recipes.grant'))
  for (const action of boundActions(registry)) if (action.kind === 'write') assert.ok(['optional', 'required'].includes(action.idempotency), action.id)
})

test('literal routes come before /recipes/{instanceId}', () => {
  const paths = recipeActions(() => ({})).filter((a) => a.mounts.http).map((a) => `${a.mounts.http.method} ${a.mounts.http.path}`)
  assert.ok(paths.indexOf('GET /recipes/catalog') < paths.indexOf('GET /recipes/{instanceId}'))
  assert.ok(paths.indexOf('GET /recipes/hooks') < paths.indexOf('GET /recipes/{instanceId}'))
  assert.ok(paths.indexOf('GET /recipes/mine') < paths.indexOf('GET /recipes/{instanceId}'))
  assert.ok(paths.indexOf('GET /recipes/picker-options') < paths.indexOf('GET /recipes/{instanceId}'))
})

test('a token runs a recipe through the registry; refusals keep their codes; grant needs a person', async () => {
  const w = createRecipeWorld({ recipes: [{ manifest: testGraph.manifest, run: testGraph.run }], vendors: { github: { tree: async () => ({ sha: 's', nodes: [{ key: 'a', text: 'a' }], edges: [] }) } } })
  const drive = w.projects.addDrive({ ownerId: 'ana' })
  const registry = build(() => w.service)
  const token = { kind: 'agent', userId: 'ana', tokenId: 't1', scopes: ['recipes:read', 'recipes:write', 'recipes:run'] }
  const made = await registry.run(token, 'recipes.create', { projectId: drive, recipeId: 'test-graph', config: { repo: 'acme/api' } })
  const instanceId = made.body.recipe.instanceId
  await registry.run(token, 'recipes.activate', { instanceId })
  const ran = await registry.run(token, 'recipes.run', { instanceId, data: { nodes: [{ key: 'x', text: 'x' }] } })
  assert.equal(ran.body.state, 'queued')
  await assert.rejects(registry.run(token, 'recipes.run', { instanceId, data: { nodes: 'no' } }), { status: 400, code: 'bad_payload' })
  await assert.rejects(registry.run({ ...token, scopes: ['recipes:read'] }, 'recipes.run', { instanceId }), { status: 403, code: 'insufficient_scope' })
  await assert.rejects(registry.run(token, 'recipes.grant', { instanceId, kind: 'github.pr_comment', scope: { repos: ['acme/api'] } }), { status: 403, code: 'session_required' })
  const listed = await registry.run(token, 'recipes.list', { projectId: drive })
  assert.equal(listed.body.recipes[0].runsFor, 'Test cartographer · runs for Ana')
})

test('what the runtime records reads as a valid activity log entry', () => {
  const instance = { _id: 'inst1', name: 'Living architecture · acme/api', orgId: 'org1' }
  for (const [action, details] of [['recipe.created', { instanceId: 'inst1', recipeId: 'github-architecture' }], ['recipe.run', { instanceId: 'inst1', runId: 'r1', outcome: 'done', count: 2 }], ['recipe.outside_write', { kind: 'github.pull_request', instanceId: 'inst1', runId: 'r1', outcome: 'grant' }], ['recipe.hook_added', { hookId: 'rh_1', kind: 'outbound' }]]) {
    const entry = buildEntry({ scope: 'org1', at: new Date(), via: 'system', actor: { kind: 'integration', label: 'GitHub architect' }, ...auditEntry({ action, instance, details }) })
    assert.equal(entry.action, action)
    assert.equal(entry.target.type, 'recipe')
  }
  const server = buildEntry({ scope: 'server', at: new Date(), via: 'app', actor: { kind: 'person', userId: 'admin' }, ...auditEntry({ action: 'recipe.install_enabled', server: true, details: { outcome: 'on' } }) })
  assert.equal(server.scope, 'server')
})

test('settings.recipes.off adds nothing: no actions, no routes', () => {
  const host = createEnterpriseHost()
  registerRecipes(host.api, { settings: { recipes: { off: true } } })
  assert.equal(host.isEmpty(), true)
  const on = createEnterpriseHost()
  registerRecipes(on.api, { settings: {} })
  assert.ok(on.actions.some((a) => a.id === 'recipes.run'))
  assert.ok(on.routes.some((r) => r.method === 'POST' && r.path === '/hooks/recipes/:hookId'))
})
