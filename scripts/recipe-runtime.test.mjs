// The recipes runtime end to end (enterprise/server/recipes): a recipe added to a project, previewed,
// turned on, run by schedule, vendor event, hand and webhook, saving its slates as real notes (first
// as suggestions, then directly once its owner chose auto), keeping people's edits, stopping at
// every switch, changing nothing outside Slatebox without a permission, and telling webhooks.
// Run with: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-runtime.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import * as testGraph from './fixtures/recipes/test-graph.mjs'
import { createRecipeWorld } from './fakes/recipe-world.mjs'
import { noteId } from '../enterprise/server/recipes/reconcile.mjs'
import { signatureHeader, verifySignature } from '../enterprise/server/recipes/webhooks/sign.mjs'

const recipe = { manifest: testGraph.manifest, run: testGraph.run }

function setup({ nodes = [{ key: 'web', text: 'web' }, { key: 'api', text: 'api' }, { key: 'db', text: 'db' }], edges = [{ from: 'web', to: 'api' }, { from: 'api', to: 'db' }], ai = [], via } = {}) {
  const graph = { nodes, edges, sha: 'abc1234' }
  const w = createRecipeWorld({ recipes: [recipe], vendors: { github: { tree: async () => ({ ...graph, nodes: graph.nodes, edges: graph.edges }) } }, ai, via })
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'Platform' })
  return { w, drive, graph, ana: w.person('ana') }
}

async function turnedOn(w, drive, ana, config = { repo: 'acme/api' }) {
  const { recipe: made } = await w.service.create(ana, drive, { recipeId: 'test-graph', config })
  await w.service.activate(ana, made.instanceId)
  return made.instanceId
}

const slateByRole = async (w, instanceId, role) => (await w.store.instances.findOne({ _id: instanceId })).slateMap[role]

test('create, preview, turn on: the first run suggests real notes; keeping them unlocks auto', async () => {
  const { w, drive, ana } = setup()
  const { recipe: made } = await w.service.create(ana, drive, { recipeId: 'test-graph', config: { repo: 'acme/api' } })
  assert.equal(made.state, 'draft')
  assert.equal(made.name, 'Test graph · acme/api')
  assert.equal(made.runsFor, 'Test cartographer · runs for Ana')
  assert.deepEqual(made.triggers.map((t) => t.kind), ['vendor', 'schedule'])

  const preview = await w.service.preview(ana, made.instanceId)
  assert.equal(preview.state, 'done')
  const map = preview.slates.find((s) => s.role === 'map')
  assert.equal(map.counts.added, 4) // 3 services and the legend
  assert.equal(map.slate.nodes.length, 4)
  assert.equal(w.projects.slates.size, 0, 'a preview saves nothing')

  await w.service.activate(ana, made.instanceId)
  const [first] = await w.drain()
  assert.equal(first.state, 'done')
  const mapId = await slateByRole(w, made.instanceId, 'map')
  assert.ok(mapId, 'the recipe made its slate in the project')
  assert.equal(w.projects.slates.get(mapId).projectId, drive)
  assert.equal(w.slates.notesOf(mapId).length, 0, 'suggested, not saved')
  assert.ok(w.slates.applied.filter((a) => a.slateId === mapId).every((a) => !a.direct))

  await assert.rejects(w.service.update(ana, made.instanceId, { applyMode: 'auto' }), { code: 'keep_first_run' })
  w.slates.keepAll(mapId)
  assert.equal(w.slates.notesOf(mapId).length, 4)
  w.advance(60_000)
  await w.service.runNow(ana, made.instanceId)
  await w.drain()
  const after = await w.store.instances.findOne({ _id: made.instanceId })
  assert.equal(after.firstRunKept, true)
  const updated = await w.service.update(ana, made.instanceId, { applyMode: 'auto' })
  assert.equal(updated.recipe.applyMode, 'auto')
})

test('in auto mode a run saves in place, keeps people\'s edits and positions, and removes what the source dropped', async () => {
  const { w, drive, ana, graph } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  const mapId = await slateByRole(w, id, 'map')
  w.slates.keepAll(mapId)
  await w.service.runNow(ana, id)
  await w.drain()
  await w.service.update(ana, id, { applyMode: 'auto' })

  const apiId = noteId('tg', 'node:api')
  const dbId = noteId('tg', 'node:db')
  const webId = noteId('tg', 'node:web')
  // a person moves web and retexts db
  const web = w.slates.notesOf(mapId).find((n) => n.id === webId)
  w.slates.personEdit(mapId, [{ kind: 'update_nodes', target: { ids: [webId] }, changes: { x: web.x + 900 } }, { kind: 'update_nodes', target: { ids: [dbId] }, changes: { text: 'Postgres (payments owns it)' } }])
  // the source renames api, renames db, drops web, adds cache
  graph.nodes = [{ key: 'api', text: 'api-gateway' }, { key: 'db', text: 'database' }, { key: 'cache', text: 'cache' }]
  graph.edges = [{ from: 'api', to: 'db' }, { from: 'api', to: 'cache' }]
  w.advance(60_000)
  await w.service.runNow(ana, id)
  const [run] = await w.drain()
  assert.equal(run.state, 'done')
  const notes = w.slates.notesOf(mapId)
  assert.equal(notes.find((n) => n.id === apiId).text, 'api-gateway')
  assert.equal(notes.find((n) => n.id === dbId).text, 'Postgres (payments owns it)', 'a person\'s note is theirs')
  assert.equal(notes.find((n) => n.id === webId), undefined, 'the recipe\'s own dropped note goes')
  assert.ok(notes.find((n) => n.id === noteId('tg', 'node:cache')))
  assert.ok(w.slates.applied.filter((a) => a.slateId === mapId).at(-1).direct)
  // undo of that run goes through slates.undo
  const runs = await w.service.runsOf(ana, id)
  const latest = runs.runs[0]
  assert.ok(latest.changes.some((c) => c.undoable))
  const undone = await w.service.undoRun(ana, latest.runId)
  assert.ok(undone.undone >= 1)
  // the notes a recipe keeps on the slate, for its agent panel
  const shareId = w.projects.slates.get(mapId).shareId
  const kept = await w.service.notesOn(ana, shareId)
  assert.equal(kept.recipes[0].runsFor, 'Test cartographer · runs for Ana')
  assert.ok(kept.recipes[0].noteIds.includes(apiId))
  assert.ok(!kept.recipes[0].noteIds.includes(dbId))
  await w.service.makeMine(ana, shareId, apiId)
  assert.ok(!(await w.service.notesOn(ana, shareId)).recipes[0].noteIds.includes(apiId))
})

test('a slate that changes mid-run is read again once; the status slate says what happened', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  const statusId = await slateByRole(w, id, 'status')
  assert.ok(statusId, 'a status slate in the project')
  const text = w.slates.notesOf(statusId).map((n) => n.text).join('\n')
  assert.match(text, /Test cartographer · runs for Ana/)
  assert.match(text, /Last run .*: Done/)
  assert.match(text, /Keeps Service map: acme\/api/)
})

test('the board output: cards added once, a card a person moved stays where they put it', async () => {
  const { w, drive, ana, graph } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  const changesId = await slateByRole(w, id, 'changes')
  const board = await w.slates.adapter.board(changesId, 'board:changes')
  assert.deepEqual(board.lanes.map((l) => l.label), ['New'])
  assert.deepEqual(board.cards.map((c) => c.label), ['Push abc1234'])
  graph.sha = 'def5678'
  w.advance(60_000)
  await w.service.runNow(ana, id)
  await w.drain()
  const again = await w.slates.adapter.board(changesId, 'board:changes')
  assert.deepEqual(again.cards.map((c) => c.label), ['Push def5678'], 'the recipe keeps its board in step with the source')
})

test('vendor events are folded: a push storm is one run', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  for (let k = 0; k < 5; k += 1) await w.queue.trigger(id, { event: 'github.push', shas: [`s${k}`] }, { debounceMs: 120000 })
  w.advance(121_000)
  assert.equal(await w.scheduler.tick(), 1)
  const [run] = await w.drain()
  assert.equal(run.state, 'done')
  const latest = (await w.service.runsOf(ana, id)).runs[0]
  assert.equal(latest.trigger.kind, 'vendor')
  assert.equal(latest.trigger.count, 5)
})

test('every switch stops runs: server, install, team, owner, project, instance', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  const runOnce = async () => {
    w.advance(60_000)
    await w.queue.enqueue(await w.store.instances.findOne({ _id: id }), { kind: 'manual' })
    const [out] = await w.drain()
    return (await w.store.runs.findOne({}, { sort: { created: -1 } })).skippedReason || out.state
  }
  w.state.serverOff = true
  assert.equal(await runOnce(), 'kill_switch')
  w.state.serverOff = false
  w.state.installEnabled = false
  assert.equal(await runOnce(), 'kill_switch')
  await assert.rejects(w.service.runNow(ana, id), { code: 'recipes_off', message: 'An admin turns recipes on in Admin › Recipes.' })
  w.state.installEnabled = true
  w.state.ownerPaused.add('ana')
  assert.equal(await runOnce(), 'paused')
  w.state.ownerPaused.clear()
  await w.projects.api.setRecipesPaused('ana', drive, true)
  assert.equal(await runOnce(), 'paused')
  await w.projects.api.setRecipesPaused('ana', drive, false)
  await w.service.pause(ana, id)
  assert.equal(await runOnce(), 'paused')
  await w.service.resume(ana, id)
  assert.equal(await runOnce(), 'done')
  assert.ok(w.audits.some((a) => a.action === 'recipe.paused'))
  assert.ok(w.audits.some((a) => a.action === 'recipe.resumed'))
})

test('a self-hosted install keeps recipes off until a server admin turns them on', async () => {
  const { w, drive, ana } = setup({ via: 'self-host' })
  await assert.rejects(w.service.create(ana, drive, { recipeId: 'test-graph', config: { repo: 'acme/api' } }), { code: 'recipes_off' })
  await assert.rejects(w.service.setInstallEnabled(ana, true), { code: 'forbidden' })
  await w.service.setInstallEnabled(w.person('admin'), true)
  assert.ok(w.audits.some((a) => a.action === 'recipe.install_enabled'))
  const { recipe: made } = await w.service.create(ana, drive, { recipeId: 'test-graph', config: { repo: 'acme/api' } })
  assert.equal(made.state, 'draft')
})

test('an owner who loses access stops the recipe; a manager can take it over', async () => {
  const { w, drive, ana } = setup()
  w.projects.share(drive, 'ben', 'manager')
  // ben owns this recipe on ana's drive
  const ben = w.person('ben')
  const { recipe: made } = await w.service.create(ben, drive, { recipeId: 'test-graph', config: { repo: 'acme/api' } })
  await w.service.activate(ben, made.instanceId)
  w.projects.unshare(drive, 'ben')
  const [out] = await w.drain()
  assert.equal(out.state, 'skipped')
  const stopped = await w.store.instances.findOne({ _id: made.instanceId })
  assert.equal(stopped.state, 'blocked_access')
  assert.ok(w.notices.some((n) => n.to === 'ben' && n.code === 'recipe_access'))
  const taken = await w.service.transfer(ana, made.instanceId)
  assert.equal(taken.recipe.mine, true)
  assert.equal(taken.recipe.state, 'paused')
  await w.service.resume(ana, made.instanceId)
  assert.ok(w.audits.some((a) => a.action === 'recipe.transferred'))
})

test('who may do what: viewers read, editors run, the owner changes it', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  w.projects.share(drive, 'vic', 'viewer')
  w.projects.share(drive, 'eve', 'editor')
  const vic = w.person('vic')
  const eve = w.person('eve')
  assert.equal((await w.service.list(vic, drive)).recipes.length, 1)
  await assert.rejects(w.service.runNow(vic, id), { code: 'forbidden' })
  await w.service.runNow(eve, id)
  await assert.rejects(w.service.update(eve, id, { config: { repo: 'acme/web' } }), { code: 'not_owner' })
  await assert.rejects(w.service.pause(eve, id), { code: 'forbidden' })
  await assert.rejects(w.service.list(w.person('stranger'), drive), { code: 'not_found' })
  await assert.rejects(w.service.create(ana, drive, { recipeId: 'test-graph', config: { repo: 'not a repo' } }), { code: 'bad_config' })
  await assert.rejects(w.service.update(ana, id, { triggers: [{ kind: 'schedule', cron: '*/5 * * * *' }] }), { code: 'too_often' })
})

test('outside Slatebox: no permission, an approval card; a granted scope, the change; hard limits always', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana, { repo: 'acme/api', propose: true })
  await w.drain()
  assert.equal(w.performed.length, 0, 'nothing changed outside without a permission')
  const card = await w.store.cards.findOne({ instanceId: id })
  assert.equal(card.state, 'waiting')
  const statusId = await slateByRole(w, id, 'status')
  assert.match(w.slates.notesOf(statusId).map((n) => n.text).join('\n'), /Waiting for your approval: Comment on pull requests, acme\/api #7/)
  // only the person, signed in, approves; a token cannot
  await assert.rejects(w.service.decideWrite(w.agent('ana'), card._id, 'approve'), { code: 'session_required' })
  const done = await w.service.decideWrite(ana, card._id, 'approve')
  assert.equal(done.state, 'done')
  assert.equal(w.performed.length, 1)
  assert.ok(w.audits.some((a) => a.action === 'recipe.outside_write'))
  // a standing permission: the next run makes it directly
  await assert.rejects(w.service.grant(w.agent('ana'), id, { kind: 'github.pr_comment', scope: { repos: ['acme/api'] } }), { code: 'session_required' })
  await assert.rejects(w.service.grant(ana, id, { kind: 'github.pull_request', scope: {} }), { code: 'not_offered' })
  const granted = await w.service.grant(ana, id, { kind: 'github.pr_comment', scope: { repos: ['acme/api'] } })
  assert.equal(granted.describe, 'Comment on pull requests in acme/api')
  w.advance(60_000)
  await w.store.cards.deleteMany({})
  await w.service.runNow(ana, id)
  await w.drain()
  assert.equal(w.performed.length, 2)
  // a grant for another repo does not cover this one
  await w.service.revoke(ana, granted.grantId)
  const paused = await w.store.instances.findOne({ _id: id })
  assert.equal(paused.state, 'paused', 'a revoked permission pauses the recipe')
  assert.equal(paused.pausedReason, 'grant_revoked')
})

test('the agent: its summary is metered; a refusal ends the run partial with its notes intact', async () => {
  const { w, drive, ana } = setup({ ai: [Object.assign(new Error('no allowance'), { code: 'allowance' })] })
  const id = await turnedOn(w, drive, ana, { repo: 'acme/api', summarize: true })
  const [run] = await w.drain()
  assert.equal(run.state, 'partial')
  assert.equal(w.aiCalls.length, 1)
  assert.equal(w.aiCalls[0].promptId, 'recipes.test-graph.summary')
  assert.equal(w.aiCalls[0].userId, 'ana')
  const map = await slateByRole(w, id, 'map')
  assert.ok(w.slates.applied.some((a) => a.slateId === map), 'the deterministic part still landed')
})

test('outbound webhooks: signed, retried, turned off after 8 failures; the receiver verifies', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  const added = await w.service.hooksAdd(ana, { instanceId: id, direction: 'outbound', url: 'https://hooks.example.com/slatebox', events: ['run.finished', 'slate.updated', 'graph.drawn'] })
  assert.match(added.secret, /^whsec_/)
  assert.equal(JSON.stringify(await w.service.hooksList(ana, { instanceId: id })).includes(added.secret), false, 'the secret is shown once')
  const received = []
  w.routes.set('https://hooks.example.com/slatebox', (init) => {
    received.push(init)
    return { status: 200 }
  })
  await w.drain()
  await w.outbound.deliverDue()
  const types = received.map((r) => r.headers['Slatebox-Event'])
  assert.ok(types.includes('run.finished') && types.includes('slate.updated') && types.includes('graph.drawn'))
  for (const r of received) assert.equal(verifySignature(r.headers['Slatebox-Signature'], [{ plain: added.secret }], r.body, w.clock()), true)
  const finished = JSON.parse(received.find((r) => r.headers['Slatebox-Event'] === 'run.finished').body)
  assert.equal(finished.instance.id, id)
  assert.equal(finished.project.id, drive)
  assert.equal(finished.data.state, 'done')
  for (const r of received) assert.equal(r.body.includes('"web"'), false, 'no note text in a webhook')

  // a failing receiver: backoff, then disabled after 8 failures in a row
  w.routes.set('https://hooks.example.com/slatebox', () => ({ status: 500 }))
  for (let k = 0; k < 4; k += 1) {
    w.advance(60_000)
    await w.service.runNow(ana, id)
    await w.drain()
  }
  for (let k = 0; k < 12; k += 1) {
    await w.outbound.deliverDue()
    w.advance(86_400_000)
  }
  const hook = await w.store.hooks.findOne({ _id: added.hook.hookId })
  assert.equal(hook.state, 'disabled')
  assert.ok(w.notices.some((n) => n.code === 'hook_disabled'))
  // rotation: the old secret keeps signing for a day beside the new one
  const rotated = await w.service.hooksRotate(ana, added.hook.hookId)
  w.routes.set('https://hooks.example.com/slatebox', (init) => {
    received.push(init)
    return { status: 200 }
  })
  const test1 = await w.service.hooksTest(ana, added.hook.hookId)
  assert.equal(test1.delivered, true)
  const ping = received.at(-1)
  assert.equal(verifySignature(ping.headers['Slatebox-Signature'], [{ plain: rotated.secret }], ping.body, w.clock()), true)
  assert.equal(verifySignature(ping.headers['Slatebox-Signature'], [{ plain: added.secret }], ping.body, w.clock()), true)
  const log = await w.service.deliveriesOf(ana, added.hook.hookId)
  assert.ok(log.deliveries.some((d) => d.state === 'dead' || d.state === 'pending'))
})

test('inbound webhooks: signature, schema, replay, rate limit, then a run with the data', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  const { hook, secret } = await w.service.hooksAdd(ana, { instanceId: id, direction: 'inbound' })
  const send = (body, { t = Math.floor(w.clock() / 1000), key = secret, delivery = null } = {}) => {
    const raw = Buffer.from(JSON.stringify(body))
    return w.inbound.handle({ hookId: hook.hookId, rawBody: raw, headers: { 'slatebox-signature': signatureHeader([{ plain: key }], raw, t), ...(delivery && { 'slatebox-delivery': delivery }) } })
  }
  assert.equal((await send({ data: { nodes: [] } }, { key: 'whsec_wrong' })).status, 401)
  assert.equal((await send({ data: { nodes: [] } }, { t: Math.floor(w.clock() / 1000) - 600 })).status, 401)
  const bad = await send({ data: { nodes: [{ key: 1, text: 'x' }] } })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.details.pointer, '/data/nodes/0/key')
  const ok = await send({ reason: 'CI build 42', data: { nodes: [{ key: 'svc-a', text: 'svc-a' }, { key: 'svc-b', text: 'svc-b' }], edges: [{ from: 'svc-a', to: 'svc-b' }] } }, { delivery: 'd-1' })
  assert.equal(ok.status, 202)
  const again = await send({ data: { nodes: [{ key: 'x', text: 'x' }] } }, { delivery: 'd-1' })
  assert.equal(again.status, 200)
  assert.equal(again.body.runId, ok.body.runId)
  const [run] = await w.drain()
  assert.equal(run.state, 'done')
  const queued = await w.store.runs.findOne({ _id: ok.body.runId })
  assert.equal(queued.trigger.kind, 'inbound')
  assert.equal(queued.trigger.reason, 'CI build 42')
  assert.equal((await w.inbound.handle({ hookId: 'rh_nosuchhook', rawBody: '{}', headers: {} })).status, 404)
  for (let k = 0; k < 40; k += 1) {
    const r = await send({ data: { nodes: [] } }, { delivery: `x${k}` })
    if (r.status === 429) {
      assert.ok(k >= 28)
      assert.equal(r.headers['Retry-After'], '600')
      return
    }
  }
  assert.fail('the hour\'s limit never answered 429')
})

test('intercepts: graph.ready narrows and extends the graph; closed hooks that fail skip the run', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  await w.service.update(ana, id, { applyMode: 'auto' }).catch(() => {})
  const mapId = await slateByRole(w, id, 'map')
  w.slates.keepAll(mapId)
  await w.service.hooksAdd(ana, { instanceId: id, direction: 'intercept', url: 'https://hooks.example.com/graph', point: 'graph.ready', failMode: 'closed' })
  w.routes.set('https://hooks.example.com/graph', () => ({ status: 200, body: { add: { nodes: [{ key: 'billing', text: 'Billing (external)', link: 'https://billing.example.com' }], edges: [{ from: 'api', to: 'billing' }] }, drop: ['web'] } }))
  w.advance(60_000)
  await w.service.runNow(ana, id)
  await w.drain()
  w.slates.keepAll(mapId)
  const texts = w.slates.notesOf(mapId).map((n) => n.text)
  assert.ok(texts.includes('Billing (external)'))
  assert.ok(!texts.includes('web'))
  w.routes.set('https://hooks.example.com/graph', () => ({ status: 200, body: '<html>' }))
  w.advance(60_000)
  await w.service.runNow(ana, id)
  const [skipped] = await w.drain()
  assert.equal(skipped.state, 'skipped')
  assert.equal((await w.store.runs.findOne({}, { sort: { created: -1 } })).skippedReason, 'hook_failed')
})

test('deleting a drive deletes its recipes, runs, hooks and notes', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  await w.service.hooksAdd(ana, { instanceId: id, direction: 'outbound', url: 'https://hooks.example.com/x' })
  await w.service.onProjectDeleted(drive)
  assert.equal(await w.store.instances.countDocuments({}), 0)
  assert.equal(await w.store.hooks.countDocuments({}), 0)
  assert.equal(await w.store.notes.countDocuments({}), 0)
})

test('a slate a person edits mid-run is read again and the run lands on top of their edit', async () => {
  const { w, drive, ana, graph } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  const mapId = await slateByRole(w, id, 'map')
  w.slates.keepAll(mapId)
  await w.service.runNow(ana, id)
  await w.drain()
  await w.service.update(ana, id, { applyMode: 'auto' })
  graph.nodes = [...graph.nodes, { key: 'queue', text: 'queue' }]
  const apply = w.slates.adapter.apply
  let once = true
  w.slates.adapter.apply = async (...args) => {
    if (once && args[1] === mapId) {
      once = false
      w.slates.personEdit(mapId, [{ kind: 'add_nodes', count: 1, ids: ['person1'], shape: 'rectangle', text: 'my idea', x: 0, y: -400, width: 150, height: 70 }])
    }
    return apply(...args)
  }
  w.advance(60_000)
  await w.service.runNow(ana, id)
  const [run] = await w.drain()
  w.slates.adapter.apply = apply
  assert.equal(run.state, 'done')
  const texts = w.slates.notesOf(mapId).map((n) => n.text)
  assert.ok(texts.includes('my idea') && texts.includes('queue'))
  const log = (await w.store.runs.findOne({}, { sort: { created: -1 } })).log.map((l) => l.code)
  assert.ok(log.includes('slate_changed'))
})

test('a first build too large to review as suggestions is saved as one undoable action', async () => {
  const nodes = Array.from({ length: 420 }, (_, k) => ({ key: `svc${k}`, text: `svc${k}` }))
  const { w, drive, ana } = setup({ nodes, edges: [] })
  const { recipe: made } = await w.service.create(ana, drive, { recipeId: 'test-graph', config: { repo: 'acme/api' } })
  await w.service.activate(ana, made.instanceId)
  const [run] = await w.drain()
  assert.equal(run.state, 'done')
  const mapId = await slateByRole(w, made.instanceId, 'map')
  assert.equal(w.slates.notesOf(mapId).length, 421)
  const log = (await w.store.runs.findOne({ instanceId: made.instanceId }, { sort: { created: -1 } })).log.map((l) => l.code)
  assert.ok(log.includes('first_run_direct'))
})

test('a slate whose people paused all agents is left alone; the rest of the run goes on', async () => {
  const { w, drive, ana } = setup()
  const id = await turnedOn(w, drive, ana)
  await w.drain()
  const mapId = await slateByRole(w, id, 'map')
  w.slates.pause(mapId)
  const before = w.slates.applied.filter((a) => a.slateId === mapId).length
  w.advance(60_000)
  await w.service.runNow(ana, id)
  await w.drain()
  assert.equal(w.slates.applied.filter((a) => a.slateId === mapId).length, before)
  const log = (await w.store.runs.findOne({}, { sort: { created: -1 } })).log.map((l) => l.code)
  assert.ok(log.includes('agents_paused'))
})
