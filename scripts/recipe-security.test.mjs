// The recipes runtime against someone trying to get more than they were given: switches and lost
// access stop a run already under way, a person who lost their role keeps no hook, a captured
// inbound call cannot be sent again, a hook that is not the owner's never rewrites an outside
// change, a hook's address is not shown to every viewer, and a change outside Slatebox goes only
// where the person picked.
// Run with: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-security.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import * as testGraph from './fixtures/recipes/test-graph.mjs'
import { createRecipeWorld } from './fakes/recipe-world.mjs'
import { signatureHeader } from '../enterprise/server/recipes/webhooks/sign.mjs'
import { createPermissions, hardLimit } from '../enterprise/server/recipes/permissions.mjs'
import { createVendor } from '../enterprise/server/recipes/vendors/github/index.mjs'
import { memoryCollection } from '../enterprise/server/recipes/vendors/github/store.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'

const recipe = { manifest: testGraph.manifest, run: testGraph.run }
const GRAPH = { nodes: [{ key: 'web', text: 'web' }, { key: 'api', text: 'api' }], edges: [{ from: 'web', to: 'api' }], sha: 'abc1234' }

function setup({ during = () => {} } = {}) {
  const box = {}
  const w = createRecipeWorld({ recipes: [recipe], vendors: { github: { tree: async () => { await during(box.w); return { ...GRAPH } } } } })
  box.w = w
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'Platform' })
  return { w, drive, ana: w.person('ana') }
}

async function turnedOn(w, drive, owner, config = { repo: 'acme/api', propose: true }) {
  const { recipe: made } = await w.service.create(owner, drive, { recipeId: 'test-graph', config })
  await w.service.activate(owner, made.instanceId)
  return made.instanceId
}

const mapOf = async (w, id) => (await w.store.instances.findOne({ _id: id })).slateMap?.map

test('a kill switch turned while a run is under way stops it before it saves or changes anything outside', async () => {
  let flip = false
  const { w, drive, ana } = setup({ during: (world) => { if (flip) world.state.serverOff = true } })
  const id = await turnedOn(w, drive, ana)
  await w.service.grant(ana, id, { kind: 'github.pr_comment', scope: { repos: ['acme/api'] } })
  await w.drain()
  const performedBefore = w.performed.length
  const mapId = await mapOf(w, id)
  const savesBefore = w.slates.applied.filter((a) => a.slateId === mapId).length
  flip = true
  w.advance(60_000)
  await w.service.runNow(ana, id)
  const [out] = await w.drain()
  assert.equal(out.state, 'skipped')
  assert.equal(out.run.skippedReason, 'kill_switch')
  assert.equal(w.performed.length, performedBefore, 'no change outside Slatebox after the switch')
  assert.equal(w.slates.applied.filter((a) => a.slateId === mapId).length, savesBefore, 'nothing saved after the switch')
})

test('pausing a project mid-run, or the owner losing access mid-run, stops the run before its outside writes', async () => {
  let act = null
  const { w, drive, ana } = setup({ during: async () => act?.() })
  w.projects.share(drive, 'ben', 'editor')
  const ben = w.person('ben')
  const id = await turnedOn(w, drive, ben)
  await w.service.grant(ben, id, { kind: 'github.pr_comment', scope: { repos: ['acme/api'] } })
  await w.drain()
  const before = w.performed.length

  act = () => w.projects.unshare(drive, 'ben')
  w.advance(60_000)
  await w.service.runNow(ben, id).catch(() => {})
  await w.store.instances.updateOne({ _id: id }, { $set: { state: 'active' } })
  await w.queue.enqueue(await w.store.instances.findOne({ _id: id }), { kind: 'manual', by: 'ben' })
  const [out] = await w.drain()
  assert.equal(out.state, 'skipped')
  assert.equal(out.run.skippedReason, 'blocked_access')
  assert.equal(w.performed.length, before)
  assert.equal((await w.store.instances.findOne({ _id: id })).state, 'blocked_access')

  // the project's own pause
  w.projects.share(drive, 'ben', 'editor')
  await w.store.instances.updateOne({ _id: id }, { $set: { state: 'active', pausedReason: null } })
  act = async () => { await w.projects.api.setRecipesPaused('ana', drive, true) }
  w.advance(60_000)
  await w.service.runNow(ben, id)
  const [paused] = await w.drain()
  assert.equal(paused.state, 'skipped')
  assert.equal(paused.run.skippedReason, 'paused')
  assert.equal(w.performed.length, before)
})

test('stopping a recipe asks its run under way to stop (the heartbeat aborts it)', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  await w.store.runs.insertOne({ _id: 'r_live', instanceId: id, ownerId: 'ana', state: 'running', mode: 'run', worker: 'b', created: new Date(w.clock()) })
  await w.service.adminPauseAll(w.person('admin'))
  assert.equal((await w.store.runs.findOne({ _id: 'r_live' })).cancelRequested, true)
})

test('an approval card is not made while recipes are off or paused, nor once its owner lost access', async () => {
  const { w, drive, ana } = setup()
  w.projects.share(drive, 'ben', 'editor')
  const ben = w.person('ben')
  const id = await turnedOn(w, drive, ben)
  await w.drain()
  const card = await w.store.cards.findOne({ instanceId: id, state: 'waiting' })
  assert.ok(card, 'a change waits for approval')
  w.state.serverOff = true
  await assert.rejects(w.service.decideWrite(ben, card._id, 'approve'), { code: 'recipes_off' })
  w.state.serverOff = false
  w.state.ownerPaused.add('ben')
  await assert.rejects(w.service.decideWrite(ben, card._id, 'approve'), { code: 'recipes_paused' })
  w.state.ownerPaused.delete('ben')
  w.projects.share(drive, 'ben', 'viewer')
  await assert.rejects(w.service.decideWrite(ben, card._id, 'approve'), { code: 'forbidden' })
  assert.equal(w.performed.length, 0)
  // declining is always allowed
  assert.equal((await w.service.decideWrite(ben, card._id, 'decline')).state, 'declined')
  void ana
})

test('a captured inbound call sent again with a new delivery header is a replay, not a second run', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana, { repo: 'acme/api' })
  await w.drain()
  const { hook, secret } = await w.service.hooksAdd(ana, { instanceId: id, direction: 'inbound' })
  const raw = Buffer.from(JSON.stringify({ data: { nodes: [{ key: 'x', text: 'x' }] } }))
  const signature = signatureHeader([{ plain: secret }], raw, Math.floor(w.clock() / 1000))
  const first = await w.inbound.handle({ hookId: hook.hookId, rawBody: raw, headers: { 'slatebox-signature': signature, 'slatebox-delivery': 'd-1' } })
  assert.equal(first.status, 202)
  for (const delivery of ['d-2', 'd-3', null]) {
    const again = await w.inbound.handle({ hookId: hook.hookId, rawBody: raw, headers: { 'slatebox-signature': signature, ...(delivery && { 'slatebox-delivery': delivery }) } })
    assert.equal(again.status, 200)
    assert.equal(again.body.duplicate, true)
    assert.equal(again.body.runId, first.body.runId)
  }
  assert.equal(await w.store.runs.countDocuments({ instanceId: id, 'trigger.kind': 'inbound' }), 1)
})

test('a manager who is unshared keeps no hook: no events, no intercepts, no inbound calls', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana, { repo: 'acme/api' })
  await w.drain()
  w.projects.share(drive, 'mo', 'manager')
  const mo = w.person('mo')
  await w.service.hooksAdd(mo, { projectId: drive, direction: 'outbound', url: 'https://mo.example.com/events' })
  await w.service.hooksAdd(mo, { instanceId: id, direction: 'intercept', url: 'https://mo.example.com/graph', point: 'graph.ready' })
  const { hook: inboundHook, secret } = await w.service.hooksAdd(mo, { instanceId: id, direction: 'inbound' })
  w.routes.set('https://mo.example.com/events', () => ({ status: 200, body: '' }))
  w.routes.set('https://mo.example.com/graph', () => ({ status: 200, body: { add: { nodes: [{ key: 'evil', text: 'Injected by mo' }] } } }))

  w.projects.unshare(drive, 'mo')
  w.fetched.length = 0
  w.advance(60_000)
  await w.service.runNow(ana, id)
  await w.drain()
  await w.outbound.deliverDue()
  assert.equal(w.fetched.filter((f) => String(f.url).startsWith('https://mo.example.com')).length, 0, 'nothing sent to the former manager')
  const mapId = await mapOf(w, id)
  w.slates.keepAll(mapId)
  assert.ok(!w.slates.notesOf(mapId).some((n) => n.text === 'Injected by mo'))
  const raw = Buffer.from(JSON.stringify({ data: { nodes: [{ key: 'x', text: 'x' }] } }))
  const sent = await w.inbound.handle({ hookId: inboundHook.hookId, rawBody: raw, headers: { 'slatebox-signature': signatureHeader([{ plain: secret }], raw, Math.floor(w.clock() / 1000)) } })
  assert.equal(sent.status, 404)

  // shared again as a manager, the same hooks work again
  w.projects.share(drive, 'mo', 'manager')
  w.advance(60_000)
  await w.service.runNow(ana, id)
  await w.drain()
  await w.outbound.deliverDue()
  assert.ok(w.fetched.some((f) => f.url === 'https://mo.example.com/events'))
})

test('only the owner\'s own hook may rewrite an outside change; a manager\'s may approve, veto or defer', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.service.grant(ana, id, { kind: 'github.pr_comment', scope: { repos: ['acme/api'] } })
  w.projects.share(drive, 'mo', 'manager')
  const mo = w.person('mo')
  await w.service.hooksAdd(mo, { instanceId: id, direction: 'intercept', url: 'https://mo.example.com/wb', point: 'writeback.proposed' })
  w.routes.set('https://mo.example.com/wb', () => ({ status: 200, body: { decision: 'approve', body: { text: 'Rewritten by mo' } } }))
  await w.drain()
  assert.equal(w.performed.at(-1).body.text, 'Architecture changed', 'the manager\'s body is not used')

  const [own] = (await w.service.hooksList(ana, { instanceId: id })).hooks
  await w.service.hooksRemove(ana, own.hookId)
  await w.service.hooksAdd(ana, { instanceId: id, direction: 'intercept', url: 'https://ana.example.com/wb', point: 'writeback.proposed' })
  w.routes.set('https://ana.example.com/wb', () => ({ status: 200, body: { decision: 'approve', body: { text: 'Edited by Ana' } } }))
  w.advance(60_000)
  await w.service.runNow(ana, id)
  await w.drain()
  assert.equal(w.performed.at(-1).body.text, 'Edited by Ana')
})

test('a hook\'s address is shown whole only to the person who added it and the project\'s managers', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana, { repo: 'acme/api' })
  await w.service.hooksAdd(ana, { instanceId: id, direction: 'outbound', url: 'https://hooks.example.com/services/T0/B0/secret-path-token' })
  w.projects.share(drive, 'vic', 'viewer')
  const seen = await w.service.hooksList(w.person('vic'), { instanceId: id })
  assert.equal(seen.hooks[0].host, 'hooks.example.com')
  assert.ok(!JSON.stringify(seen).includes('secret-path-token'))
  assert.ok(!JSON.stringify(await w.service.get(w.person('vic'), id)).includes('secret-path-token'))
  assert.ok(JSON.stringify(await w.service.hooksList(ana, { instanceId: id })).includes('secret-path-token'))
})

test('a pull request only from a slatebox/ branch, as the target names it (ref or branch)', () => {
  const pr = (target) => ({ kind: 'github.pull_request', target: { repo: 'a/b', ...target }, body: { files: [] } })
  assert.equal(hardLimit(pr({ branch: 'refs/heads/slatebox/architecture' })), null, 'the mermaid sync\'s own target')
  assert.equal(hardLimit(pr({ branch: 'slatebox/architecture' })), null)
  assert.equal(hardLimit(pr({ ref: 'refs/heads/slatebox/architecture' })), null)
  assert.equal(hardLimit(pr({ branch: 'refs/heads/main' })), 'refused')
  assert.equal(hardLimit(pr({ ref: 'refs/heads/slatebox/x', branch: 'main' })), 'refused', 'the branch pushed to is checked too')
  assert.equal(hardLimit(pr({})), 'refused')
  assert.equal(hardLimit({ kind: 'github.pull_request', target: { repo: 'a/b' }, body: { ref: 'refs/heads/slatebox/x' } }), 'refused', 'the body never names the branch')
})

test('GitHub: a change goes only to a repository the person picked for the recipe', async () => {
  const collections = { installations: memoryCollection(), deliveries: memoryCollection(), appSettings: memoryCollection(), flows: memoryCollection() }
  let calls = 0
  const vendor = createVendor({ collections, master: loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }), settings: () => ({}), fetch: async () => { calls += 1; return new Response('{}') }, now: () => Date.now(), origin: () => 'https://slate.example.com' })
  const instance = { ownerId: 'ana', match: { github: { installationId: '42', repos: ['acme/api'] } } }
  const write = { kind: 'github.pr_comment', target: { repo: 'acme/payroll', number: 1 }, body: { markdown: 'hi' }, key: 'k' }
  assert.deepEqual(await vendor.perform(write, { instance, grant: { scope: { repos: ['acme/payroll'] } } }), { refused: 'repo_not_picked' })
  assert.equal(calls, 0)
})

test('a vendor\'s refusal is not logged as a change made', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.service.grant(ana, id, { kind: 'github.pr_comment', scope: { repos: ['acme/api'] } })
  const instance = await w.store.instances.findOne({ _id: id })
  const refusing = { perform: async () => ({ refused: 'protected_branch' }), checkHardLimits: () => null }
  const audits = []
  const p = createPermissions({ store: w.store, clock: w.clock, audit: async (e) => { audits.push(e) }, manifestOf: () => testGraph.manifest, vendorOf: () => refusing })
  const out = await p.perform(instance, { kind: 'github.pr_comment', target: { repo: 'acme/api', number: 7 }, body: { text: 'x' }, key: 'pr:7' }, { _id: 'r1' })
  assert.equal(out.state, 'refused')
  assert.ok(!audits.some((a) => a.action === 'recipe.outside_write'))
})

test('losing a role re-checks each recipe: one still editable through another grant keeps running', async () => {
  const { w, drive, ana } = setup()
  w.projects.share(drive, 'ben', 'editor')
  const ben = w.person('ben')
  const id = await turnedOn(w, drive, ben, { repo: 'acme/api' })
  await w.service.ownerLostAccess('ben', drive)
  assert.equal((await w.store.instances.findOne({ _id: id })).state, 'active', 'ben still edits')
  w.projects.share(drive, 'ben', 'viewer')
  await w.service.ownerLostAccess(null, drive) // a team's grant changed: every recipe there is checked
  assert.equal((await w.store.instances.findOne({ _id: id })).state, 'blocked_access')
  void ana
})
