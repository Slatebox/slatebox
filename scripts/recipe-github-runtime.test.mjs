// The living architecture recipe (G1) end to end through the real recipes runtime (queue, runner,
// reconcile, suggestions, webhooks, switches; scripts/fakes/recipe-world.mjs) and the real GitHub
// vendor (App installation tokens, the read-only session, the signed webhook route, resolveMatch)
// over a GitHub that answers as GitHub does (scripts/fakes/github-api.mjs), with the sample monorepo:
//   a project shared with a second person, who sees its recipe and cannot change it
//   the first run suggests the diagrams as real notes; kept, they are the project's slates
//   a push through the App's signed webhook is one debounced run that updates in place, while a
//     person's edit to a note survives and the person's own note is never touched
//   an outbound hook gets each event signed; an inbound hook runs the webhook recipe with data
//   the project index runs on its schedule
//   the kill switch, a project pause and "pause all my recipes" stop runs; the activity log has it all
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-github-runtime.test.mjs
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { test } from 'node:test'
import G1 from '../enterprise/recipes/github-architecture/index.mjs'
import X1 from '../enterprise/recipes/webhook-render/index.mjs'
import X2 from '../enterprise/recipes/project-index/index.mjs'
import { FILES, PUSH_NEW_EDGE, REPO } from '../enterprise/recipes/_github-code/fixtures/acme-monorepo.mjs'
import { memoryCollection } from '../enterprise/server/recipes/vendors/github/store.mjs'
import { createVendor } from '../enterprise/server/recipes/vendors/github/index.mjs'
import { githubSignature } from '../enterprise/server/recipes/vendors/github/verify.mjs'
import { signatureHeader, verifySignature } from '../enterprise/server/recipes/webhooks/sign.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { createFakeGithub } from './fakes/github-api.mjs'
import { createRecipeWorld } from './fakes/recipe-world.mjs'

const APP_SECRET = 'whsec_github_app_test'

function githubWorld(clock) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const github = createFakeGithub({ now: clock })
  const root = github.addRepo(REPO, { files: FILES })
  const collections = { installations: memoryCollection(), deliveries: memoryCollection(), appSettings: memoryCollection(), flows: memoryCollection() }
  const settings = { appId: '123', slug: 'slatebox', clientId: 'Iv1.abc', clientSecret: 'cs_test', privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }), webhookSecret: APP_SECRET }
  const later = []
  const vendor = createVendor({
    collections, master: loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }), settings: () => settings,
    fetch: github.fetch, now: clock, origin: () => 'https://app.test', later: (fn) => later.push(fn),
  })
  return { github, root, vendor, later }
}

/** A request and response as Express hands the route (the raw body already read by the runtime). */
function delivery(event, body, id) {
  const raw = Buffer.from(JSON.stringify(body))
  const req = { headers: { 'x-github-event': event, 'x-github-delivery': id, 'x-hub-signature-256': githubSignature(APP_SECRET, raw) }, rawBody: raw }
  const res = { statusCode: 0, status(code) { this.statusCode = code; return this }, end() { return this }, setHeader() {} }
  return { req, res }
}

// What a run that did not finish said (its error and log lines), for an assertion message.
const why = (outcome) => JSON.stringify({ state: outcome?.state, error: outcome?.error?.message || outcome?.run?.error || null, log: outcome?.run?.log || outcome?.result?.log || null })
const slateOf = async (w, instanceId, role) => Object.entries((await w.store.instances.findOne({ _id: instanceId })).slateMap).find(([k]) => k === role || k.startsWith(role + '/'))?.[1]

test('a project keeps its architecture: suggested, kept, updated in place on a push, people\'s edits kept, hooks signed, switches obeyed, all in the activity log', async () => {
  let at = Date.UTC(2026, 10, 27, 12)
  const gh = githubWorld(() => at)
  const w = createRecipeWorld({ recipes: [G1, X1, X2], realVendors: { github: gh.vendor }, now: at })
  const tick = (ms) => { at += ms; w.advance(ms) }
  const ana = w.person('ana')
  const bo = w.person('bo')

  // A project, shared with Bo as a viewer.
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'Platform architecture' })
  w.projects.share(drive, 'bo', 'viewer')

  // Ana installed the Slatebox GitHub App on acme (the install callback links her).
  await gh.vendor.stores.installations.upsert('42', { account: 'acme', repos: [REPO], allRepos: false, suspended: false })
  await gh.vendor.stores.installations.linkUser('42', 'ana')
  await assert.rejects(w.service.create(bo, drive, { recipeId: 'github-architecture', config: { repos: [REPO] } }), { status: 403 }, 'a viewer adds no recipes')
  const { recipe } = await w.service.create(ana, drive, { recipeId: 'github-architecture', config: { repos: [REPO], labels: false } })
  const instance = await w.store.instances.findOne({ _id: recipe.instanceId })
  assert.deepEqual(instance.match, { github: { installationId: '42', repos: [REPO] } }, 'the installation comes from the picked repository')
  assert.equal(recipe.runsFor, 'GitHub architect · runs for Ana')
  assert.equal((await w.service.list(bo, drive)).recipes.length, 1, 'Bo sees the project\'s recipe')
  await assert.rejects(w.service.pause(bo, recipe.instanceId), { status: 403 }, 'and cannot pause it')

  // An outbound hook on the project: every event, signed.
  const received = []
  w.routes.set('https://hooks.acme.example/slatebox', (init) => { received.push(init); return { status: 200 } })
  const hook = await w.service.hooksAdd(ana, { projectId: drive, direction: 'outbound', url: 'https://hooks.acme.example/slatebox', events: [] })
  assert.match(hook.secret, /^whsec_/)

  // First run: the diagrams arrive as suggestions (ghost notes), then Ana keeps them.
  await w.service.activate(ana, recipe.instanceId)
  const [first] = await w.drain()
  assert.equal(first.state, 'done', why(first))
  const mapId = await slateOf(w, recipe.instanceId, 'service-map')
  const modulesId = await slateOf(w, recipe.instanceId, `modules/${REPO}`)
  assert.ok(mapId && modulesId, 'a service map and a module graph')
  assert.equal(w.projects.slates.get(mapId).projectId, drive, 'the slates live in the project')
  assert.equal(w.slates.notesOf(mapId).length, 0, 'the first run only suggests')
  w.slates.keepAll(mapId)
  w.slates.keepAll(modulesId)
  const services = w.slates.notesOf(mapId).map((n) => n.text).sort()
  for (const name of ['api', 'postgres', 'redis', 'worker']) assert.ok(services.some((t) => t.includes(name)), `${name} on the service map: ${services}`)
  const modulesBefore = w.slates.notesOf(modulesId)
  assert.ok(modulesBefore.some((n) => n.text.includes('@acme/ledger')))

  // The kept run is seen; Ana lets future updates apply directly.
  tick(60_000)
  await w.service.runNow(ana, recipe.instanceId)
  const [kept] = await w.drain()
  assert.equal(kept.result.stats.ops, 0, 'nothing changed in the repository: no operations')
  await w.service.update(ana, recipe.instanceId, { applyMode: 'auto' })

  // A person rewords the api note and adds a note of their own.
  const apiNote = w.slates.notesOf(modulesId).find((n) => n.text.includes('@acme/api'))
  w.slates.personEdit(modulesId, [
    { kind: 'update_nodes', target: { ids: [apiNote.id] }, changes: { text: '@acme/api (the public edge, owned by Ana)' } },
    { kind: 'add_nodes', count: 1, ids: ['anas_note'], shape: 'rectangle', text: 'Split ledger next quarter?', x: 0, y: -600, width: 200, height: 80 },
  ])

  // A push to main adds an import api -> ledger; GitHub sends it to the App's webhook.
  const before = gh.github.calls.length
  const after = gh.github.commit(REPO, { changes: PUSH_NEW_EDGE, message: 'api reads ledger entries' })
  const route = gh.vendor.routes().find((r) => r.path === '/integrations/github/events')
  const triggered = []
  const hooks = { trigger: async (match, event) => triggered.push(await w.queue.trigger((await w.store.instances.find({ ...gh.vendor.matchInstances(match), state: 'active' }).toArray())[0]._id, event, { debounceMs: 120000 })) }
  const push = { ref: 'refs/heads/main', before: gh.root, after, repository: { full_name: REPO, default_branch: 'main' }, installation: { id: 42 }, commits: [{ id: after, message: 'api reads ledger entries', modified: Object.keys(PUSH_NEW_EDGE) }] }
  const sent = delivery('push', push, 'd-1')
  await route.handler(sent.req, sent.res, hooks)
  assert.equal(sent.res.statusCode, 202)
  const forged = delivery('push', push, 'd-2')
  forged.req.headers['x-hub-signature-256'] = 'sha256=00'
  await route.handler(forged.req, forged.res, hooks)
  assert.equal(forged.res.statusCode, 401, 'an unsigned delivery is refused')
  const again = delivery('push', push, 'd-1')
  await route.handler(again.req, again.res, hooks)
  for (const fn of gh.later.splice(0)) await fn()
  assert.equal(triggered.length, 1, 'the same delivery twice is one trigger')
  assert.equal((await w.drain()).length, 0, 'debounced: nothing runs inside the quiet time')
  tick(121_000)
  await w.scheduler.tick()
  const [pushed] = await w.drain()
  assert.equal(pushed.state, 'done', why(pushed))
  assert.equal(pushed.run.trigger.kind, 'vendor')
  assert.ok(gh.github.calls.slice(before).every((c) => c.method === 'GET' || c.path.endsWith('/access_tokens')), 'the recipe only read from GitHub')
  const modulesAfter = w.slates.notesOf(modulesId)
  assert.equal(modulesAfter.find((n) => n.id === apiNote.id).text, '@acme/api (the public edge, owned by Ana)', 'the person\'s words stay')
  assert.equal(modulesAfter.find((n) => n.id === 'anas_note').text, 'Split ledger next quarter?', 'the person\'s own note is never touched')
  assert.deepEqual(modulesAfter.filter((n) => n.id !== 'anas_note').map((n) => n.id).sort(), modulesBefore.map((n) => n.id).sort(), 'updated in place: the same notes, no duplicates')
  const changes = await slateOf(w, recipe.instanceId, 'changes')
  assert.ok(changes, 'a "What changed" board')

  // The outbound hook got every event, each verifiable with the secret Ana was shown once.
  await w.outbound.deliverDue()
  assert.ok(received.length >= 3, `deliveries: ${received.length}`)
  const types = received.map((r) => JSON.parse(r.body).type)
  for (const type of ['run.finished', 'slate.updated']) assert.ok(types.includes(type), `${type} in ${types}`)
  for (const r of received) assert.equal(verifySignature(r.headers['Slatebox-Signature'] || r.headers['slatebox-signature'], [{ plain: hook.secret }], r.body, at), true, 'signed')

  // An inbound hook runs the webhook recipe with data from CI.
  const { recipe: render } = await w.service.create(ana, drive, { recipeId: 'webhook-render', config: { name: 'CI dependency graph' } })
  await w.service.activate(ana, render.instanceId)
  await w.drain()
  const inbound = await w.service.hooksAdd(ana, { instanceId: render.instanceId, direction: 'inbound' })
  assert.match(inbound.url, /^\/hooks\/recipes\//)
  const body = JSON.stringify({ reason: 'CI build 812', data: { key: 'deps', graph: { nodes: [{ key: 'web', label: 'web' }, { key: 'api', label: 'api' }], edges: [{ from: 'web', to: 'api' }] } } })
  const t = Math.floor(at / 1000)
  const answer = await w.inbound.handle({ hookId: inbound.hook.hookId, rawBody: body, headers: { 'slatebox-signature': signatureHeader([{ plain: inbound.secret }], body, t), 'slatebox-delivery': 'ci-812' } })
  assert.equal(answer.status, 202, JSON.stringify(answer.body))
  const unsigned = await w.inbound.handle({ hookId: inbound.hook.hookId, rawBody: body, headers: { 'slatebox-signature': `t=${t},v1=00` } })
  assert.equal(unsigned.status, 401)
  const [rendered] = await w.drain()
  assert.equal(rendered.run.trigger.kind, 'inbound')
  const renderId = await slateOf(w, render.instanceId, 'render')
  w.slates.keepAll(renderId)
  assert.deepEqual(w.slates.notesOf(renderId).map((n) => n.text).filter((x) => ['web', 'api'].includes(x)).sort(), ['api', 'web'])

  // The project index, on its hourly schedule.
  const { recipe: index } = await w.service.create(ana, drive, { recipeId: 'project-index', config: {} })
  await w.service.activate(ana, index.instanceId)
  await w.drain()
  tick(3600_000)
  await w.scheduler.tick()
  const scheduled = (await w.drain()).find((o) => o.run.instanceId === index.instanceId)
  assert.equal(scheduled?.run.trigger.kind, 'schedule', 'the index ran on its schedule')
  const indexId = await slateOf(w, index.instanceId, 'index')
  w.slates.keepAll(indexId)
  assert.ok(w.slates.notesOf(indexId).some((n) => /kept by GitHub architect/.test(n.text)), 'the index says which agent keeps which slate')

  // Switches: the server's kill switch, the project's pause, "pause all my recipes".
  w.state.serverOff = true
  tick(60_000)
  await w.service.runNow(ana, recipe.instanceId).catch(() => null)
  await w.queue.enqueue(await w.store.instances.findOne({ _id: recipe.instanceId }), { kind: 'manual', by: 'ana' })
  const killed = await w.drain()
  assert.ok(killed.length && killed.every((o) => o.state === 'skipped' && o.run.skippedReason === 'kill_switch'), JSON.stringify(killed.map((o) => [o.state, o.run.skippedReason])))
  w.state.serverOff = false
  await w.service.pauseProject(ana, drive, true)
  await w.service.runNow(ana, recipe.instanceId)
  const [projectPaused] = await w.drain()
  assert.equal(projectPaused.run.skippedReason, 'paused')
  await w.service.pauseProject(ana, drive, false)
  await w.service.pauseMine(ana, true)
  assert.equal((await w.service.mine(ana)).paused, true)
  await w.service.runNow(ana, recipe.instanceId)
  const [ownerPaused] = await w.drain()
  assert.equal(ownerPaused.run.skippedReason, 'paused')
  await w.service.pauseMine(ana, false)

  // The activity log.
  const actions = new Set(w.audits.map((a) => a.action))
  for (const action of ['recipe.created', 'recipe.enabled', 'recipe.updated', 'recipe.run', 'recipe.hook_added', 'recipe.paused', 'recipe.resumed']) assert.ok(actions.has(action), `${action} in ${[...actions]}`)
})
