// Diagrams as code (G3) switched on, end to end through the real recipes runtime (queue, scheduler,
// runner, permissions, webhooks, the slate save listener; scripts/fakes/recipe-world.mjs) and the
// real GitHub vendor (App installation tokens, the signed webhook route) over the recorded GitHub
// (scripts/fakes/github-api.mjs) and the sample monorepo of scripts/recipe-github-runtime.test.mjs:
//   a person's own slate put in the sync map; without the permission an approval card and the .mmd
//   to download, and no write to GitHub
//   Save to repo now: one commit on slatebox/architecture and one pull request, at once
//   editing the slate: one commit after the (test) quiet time from the slate's last save, with a
//   minimal diff; saves coalesce; the recipe's own saves never count
//   moving a note: a run, and no commit
//   our merged pull request: nothing; a merged edit to the file: the slate updated in place
//   the same label changed on the canvas and in the file: the canvas wins, a conflict note, a line in
//   the pull request
//   Living architecture changing a mapped slate: a recipe_event run, at once, that exports it
//   mermaid.sync.* reach an outbound webhook, signed, for developers
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-github-mermaid-runtime.test.mjs
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import G1 from '../enterprise/recipes/github-architecture/index.mjs'
import G3 from '../enterprise/recipes/github-mermaid-sync/index.mjs'
import { FILES, PUSH_NEW_EDGE, REPO } from '../enterprise/recipes/_github-code/fixtures/acme-monorepo.mjs'
import { memoryCollection } from '../enterprise/server/recipes/vendors/github/store.mjs'
import { createVendor } from '../enterprise/server/recipes/vendors/github/index.mjs'
import { githubSignature } from '../enterprise/server/recipes/vendors/github/verify.mjs'
import { verifySignature } from '../enterprise/server/recipes/webhooks/sign.mjs'
import { createSlateSaveListener } from '../enterprise/server/recipes/slate-saves.mjs'
import { createRecipeQueue, createScheduler } from '../enterprise/server/recipes/queue.mjs'
import { createRecipeStore } from '../enterprise/server/recipes/store.mjs'
import { checkTriggers, watchSlatesFor } from '../enterprise/server/recipes/service.mjs'
import { defaultTriggers, validateManifest } from '../enterprise/common/recipes/manifest.mjs'
import { CATALOG } from '../enterprise/common/recipes/catalog.mjs'
import {
  configFields, createdInstance, defaultTriggers as defaultTriggersUI, downloadName, grantsOf, instanceName, optionalTriggers, permissionRows, syncPaths, syncedLine, syncedState, withoutEmptyMaps,
} from '../enterprise/client/recipes/recipesModel.mjs'
import { validate } from '../web/app/server/actions/schema.mjs'
import { createMemoryDb } from './fakes/mongo-memory.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { diagramPlans, parseMermaid } from '../web/app/imports/api/common/mermaid/index.mjs'
import { createFakeGithub } from './fakes/github-api.mjs'
import { createRecipeWorld } from './fakes/recipe-world.mjs'

const APP_SECRET = 'whsec_github_app_test'
const FILE = 'docs/architecture/checkout.mmd'
const BRANCH = 'slatebox/architecture'
const QUIET = 60_000 // the test's quiet time after a save (10 minutes in the manifest)

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

function delivery(event, body, id) {
  const raw = Buffer.from(JSON.stringify(body))
  const req = { headers: { 'x-github-event': event, 'x-github-delivery': id, 'x-hub-signature-256': githubSignature(APP_SECRET, raw) }, rawBody: raw }
  const res = { statusCode: 0, status(code) { this.statusCode = code; return this }, end() { return this }, setHeader() {} }
  return { req, res }
}

const why = (outcome) => JSON.stringify({ state: outcome?.state, error: outcome?.error || outcome?.run?.error || null, log: outcome?.run?.log || null })

function setup() {
  let at = Date.UTC(2026, 10, 27, 12)
  const gh = githubWorld(() => at)
  const w = createRecipeWorld({ recipes: [G1, G3], realVendors: { github: gh.vendor }, now: at, saveLimits: { cacheMs: 30_000, throttleMs: 5_000, cacheSize: 100 } })
  const tick = (ms) => { at += ms; w.advance(ms) }
  const repo = () => gh.github.repos.get(REPO)
  const branchFile = (path = FILE) => repo().commits.get(repo().branches.get(BRANCH))?.files.get(path) ?? null
  const mainFile = (path = FILE) => repo().commits.get(repo().branches.get('main')).files.get(path) ?? null
  const branchCommits = () => {
    const out = []
    for (let sha = repo().branches.get(BRANCH); sha && sha !== repo().branches.get('main') && repo().commits.get(sha); sha = repo().commits.get(sha).parents[0]) {
      out.push(repo().commits.get(sha))
      if (out.length > 50) break
    }
    return out
  }
  // The App's webhook, as GitHub calls it: a matching recipe gets a debounced trigger.
  const route = gh.vendor.routes().find((r) => r.path === '/integrations/github/events')
  const hooks = {
    trigger: async (match, event) => {
      for (const instance of await w.store.instances.find({ ...gh.vendor.matchInstances(match), state: 'active' }).toArray()) {
        const spec = instance.triggers.find((t) => t.kind === 'vendor' && t.event === event.event)
        if (spec) await w.queue.trigger(instance._id, event, { debounceMs: spec.debounceMs })
      }
    },
  }
  let deliveries = 0
  async function push(changes, message) {
    const before = repo().branches.get('main')
    const after = gh.github.commit(REPO, { changes, message })
    const body = { ref: 'refs/heads/main', before, after, repository: { full_name: REPO, default_branch: 'main' }, installation: { id: 42 }, commits: [{ id: after, message, modified: Object.keys(changes) }] }
    const sent = delivery('push', body, `d-${++deliveries}`)
    await route.handler(sent.req, sent.res, hooks)
    for (const fn of gh.later.splice(0)) await fn()
    assert.equal(sent.res.statusCode, 202)
    return after
  }
  return { w, gh, tick, repo, branchFile, mainFile, branchCommits, push, now: () => at }
}

/** A person's slate in the project, drawn as people draw (the engine's own plans), saved as theirs. */
async function personSlate(w, drive) {
  const made = await w.projects.api.createSlate('ana', drive, { name: 'Checkout flow' })
  const drawn = diagramPlans(parseMermaid('flowchart LR\n  web["Web"]\n  api["Checkout API"]\n  pay(["Payments"])\n  web --> api\n  api -->|"charge"| pay'), { origin: { x: 0, y: 0 } })
  for (const plan of drawn.plans) w.slates.personEdit(made.slateId, plan.operations, 'ana')
  await w.slates.settle()
  return made
}

const geometry = (w, slateId) => Object.fromEntries(w.slates.notesOf(slateId).map((n) => [n.id, [n.x, n.y]]))
const instanceOf = (w, id) => w.store.instances.findOne({ _id: id })
const SCOPE = { repos: [REPO], branchPrefix: 'slatebox/', paths: ['docs/architecture/**'] }
const TRIGGERS = [{ kind: 'vendor', event: 'github.push' }, { kind: 'slate_saved', debounceMs: QUIET }, { kind: 'recipe_event', event: 'architecture.updated' }, { kind: 'manual' }]

test('Diagrams as code, on: card without the permission, Save now, edits after the quiet time, moves, merges, a merged file edit, a conflict', async () => {
  const { w, gh, tick, branchFile, mainFile, branchCommits, push, repo } = setup()
  const ana = w.person('ana')
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'Payments' })
  w.projects.share(drive, 'bo', 'viewer')
  await gh.vendor.stores.installations.upsert('42', { account: 'acme', repos: [REPO], allRepos: false, suspended: false })
  await gh.vendor.stores.installations.linkUser('42', 'ana')
  const slate = await personSlate(w, drive)

  // It is offered, and a sync map names only slates of its own project.
  assert.ok((await w.service.catalog(ana)).recipes.some((r) => r.id === 'github-mermaid-sync'))
  const elsewhere = w.projects.addDrive({ ownerId: 'ana', name: 'Elsewhere' })
  const foreign = await w.projects.api.createSlate('ana', elsewhere, { name: 'Not here' })
  await assert.rejects(w.service.create(ana, drive, { recipeId: 'github-mermaid-sync', config: { repo: REPO, maps: [{ shareId: foreign.shareId }] } }), { status: 400, code: 'bad_config' })
  assert.deepEqual((await w.service.pickerOptions(ana, 'github-mermaid-sync', 'slates', drive)).options.map((o) => o.value), [slate.shareId])

  const { recipe } = await w.service.create(ana, drive, { recipeId: 'github-mermaid-sync', config: { repo: REPO, maps: [{ shareId: slate.shareId, file: FILE }] }, triggers: TRIGGERS })
  assert.equal(recipe.name, `Diagrams as code · ${REPO}`)
  const id = recipe.instanceId
  assert.deepEqual((await instanceOf(w, id)).watchSlates, [slate.shareId])

  // An outbound hook for developers: the mermaid.sync events, signed.
  const received = []
  w.routes.set('https://hooks.acme.example/slatebox', (init) => { received.push(init); return { status: 200 } })
  const hook = await w.service.hooksAdd(ana, { instanceId: id, direction: 'outbound', url: 'https://hooks.acme.example/slatebox', events: [] })

  // Turned on without the permission: the first run proposes the file as an approval card, writes
  // nothing to GitHub, and puts the "Synced with" note on the slate.
  const writesBefore = gh.github.writes().length
  await w.service.activate(ana, id)
  const [first] = await w.drain()
  assert.equal(first.state, 'done', why(first))
  assert.deepEqual(first.run.writes.map((x) => x.state), ['card'])
  assert.equal(gh.github.writes().length, writesBefore, 'no POST or PATCH to GitHub without the permission')
  const waiting = (await w.service.get(ana, id)).waiting
  assert.equal(waiting.length, 1)
  assert.equal(waiting[0].files[0].path, FILE)
  assert.match(waiting[0].files[0].content, new RegExp(`^%% slatebox:${slate.shareId} rev:\\d+ hash:[0-9a-f]{16}\\nflowchart LR\\n`), 'the .mmd to download')
  const head = repo().branches.get('main')
  const legend = w.slates.notesOf(slate.slateId).find((n) => /^Synced with /.test(n.text))
  assert.equal(legend?.text, `Synced with ${REPO} ${FILE} @ ${head.slice(0, 7)}`)
  await w.slates.settle()
  assert.deepEqual((await instanceOf(w, id)).slateSaves, [], 'the recipe\'s own save is not an edit to export')
  const synced = await w.service.syncedOn(ana, slate.shareId)
  assert.deepEqual(synced.synced.map((s) => [s.repo, s.path, s.commit, s.pending, s.canSave]), [[REPO, FILE, head, true, true]])
  assert.equal((await w.service.syncedOn(w.person('bo'), slate.shareId)).synced[0].canSave, false, 'a viewer sees the line, not the button')
  await assert.rejects(w.service.saveNow(w.person('bo'), id, { shareId: slate.shareId }), { status: 403 })

  // Ana lets it open pull requests; Save to repo now commits at once, on slatebox/architecture only.
  await w.service.grant(ana, id, { kind: 'github.pull_request', scope: SCOPE })
  await w.service.saveNow(ana, id, { shareId: slate.shareId })
  const [saved] = await w.drain()
  assert.equal(saved.state, 'done', why(saved))
  assert.equal(saved.run.trigger.reason, 'Save to repo now')
  assert.deepEqual(saved.run.writes.map((x) => x.state), ['done'])
  assert.equal(branchCommits().length, 1, 'one commit on the branch')
  assert.match(branchCommits()[0].message, new RegExp(`Slatebox-Recipe-Run: ${saved.run._id}$`))
  assert.equal(repo().branches.get('main'), head, 'main never moves')
  assert.equal(repo().pulls.size, 1)
  assert.equal([...repo().pulls.values()][0].head.ref, BRANCH)
  const unrev = (text) => text.replace(/ rev:\d+ /, ' ')
  assert.equal(unrev(branchFile()), unrev(waiting[0].files[0].content), 'what waited for approval is what went out (the header names the slate revision it read)')
  assert.deepEqual((await w.service.get(ana, id)).waiting, [], 'the card it replaced is gone')

  // A person edits the slate: a note and a line, then a second edit seconds later. One commit, after
  // the quiet time from the last save, with a 2-line diff.
  const beforeEdit = branchFile()
  w.slates.personEdit(slate.slateId, [{ kind: 'add_nodes', count: 1, ids: ['fraud'], shape: 'rectangle', text: 'Fraud check', x: 0, y: 600 }], 'ana')
  await w.slates.settle()
  tick(20_000)
  w.slates.personEdit(slate.slateId, [{ kind: 'connect_nodes', from: { ids: ['api'] }, to: { ids: ['fraud'] }, ids: ['api->fraud'] }], 'ana')
  await w.slates.settle()
  assert.equal((await instanceOf(w, id)).slateSaves.length, 1, 'one due time per slate')
  tick(QUIET - 10_000)
  await w.scheduler.tick()
  assert.deepEqual(await w.drain(), [], 'nothing runs inside the quiet time after the last save')
  tick(10_001)
  await w.scheduler.tick()
  const edited = await w.drain()
  assert.equal(edited.length, 1, 'the saves are one run')
  assert.equal(edited[0].run.trigger.kind, 'slate_saved')
  assert.deepEqual(edited[0].run.trigger.shareIds, [slate.shareId])
  assert.equal(branchCommits().length, 2, 'one more commit')
  const was = beforeEdit.split('\n').slice(1)
  const now = branchFile().split('\n').slice(1)
  assert.deepEqual(now.filter((l) => !was.includes(l)), ['  fraud["Fraud check"]', '  api --> fraud'])
  assert.deepEqual(was.filter((l) => !now.includes(l)), [])
  assert.equal(repo().pulls.size, 1, 'the open pull request is updated, not a second one')

  // Moving notes: a run after the quiet time, and no commit.
  w.slates.personEdit(slate.slateId, [{ kind: 'update_nodes', target: { ids: ['web', 'pay'] }, changes: { x: 900, y: 400 } }], 'ana')
  await w.slates.settle()
  tick(QUIET + 1)
  await w.scheduler.tick()
  const [moved] = await w.drain()
  assert.equal(moved.run.trigger.kind, 'slate_saved')
  assert.deepEqual(moved.run.writes, [], 'a move is not a change')
  assert.equal(branchCommits().length, 2)

  // The pull request is merged: our own body comes back on a push and changes nothing.
  const merged = await push({ [FILE]: branchFile() }, `Merge pull request #1 from acme/${BRANCH}\n\nUpdate architecture diagrams`)
  gh.github.closePull(REPO, 1, true)
  tick(121_000)
  await w.scheduler.tick()
  const [own] = await w.drain()
  assert.equal(own.run.trigger.event, 'github.push')
  assert.deepEqual(own.run.writes, [])
  assert.ok(!own.run.log.some((l) => l.code === 'slate_changed'))
  assert.equal(w.slates.notesOf(slate.slateId).find((n) => /^Synced with /.test(n.text)).text, `Synced with ${REPO} ${FILE} @ ${merged.slice(0, 7)}`)

  // An engineer edits the file in a merged pull request: a label and a new line. The slate is
  // updated in place: nothing moves, the person's own note stays.
  const places = geometry(w, slate.slateId)
  const edit = mainFile().replace('"Payments"', '"Payments service"') + '  web --> pay\n'
  await push({ [FILE]: edit }, 'Merge pull request #2 from acme/docs\n\nName the payments service')
  tick(121_000)
  await w.scheduler.tick()
  const [imported] = await w.drain()
  assert.equal(imported.state, 'done', why(imported))
  const notes = w.slates.notesOf(slate.slateId)
  assert.equal(notes.find((n) => n.id === 'pay').text, 'Payments service')
  for (const [noteId, at] of Object.entries(places)) assert.deepEqual(geometry(w, slate.slateId)[noteId], at, `${noteId} did not move`)
  assert.ok(notes.some((n) => n.id === 'fraud'), 'the person-added note survives')
  const slateNow = w.projects.slates.get(slate.slateId)
  assert.ok(slateNow.nodes.find((n) => n.options.id === 'web').relationships.associations.some((a) => a.childId === 'pay'), 'the new line is drawn')
  await w.slates.settle()
  assert.deepEqual((await instanceOf(w, id)).slateSaves, [], 'the import is the recipe\'s own save: it does not loop back')

  // The same label changed on the canvas and in the file: the canvas wins, with a conflict note and
  // a line in the pull request.
  await push({ [FILE]: mainFile().replace('"Checkout API"', '"Orders API"') }, 'Merge pull request #3 from acme/docs\n\nRename the API')
  tick(30_000)
  w.slates.personEdit(slate.slateId, [{ kind: 'update_nodes', target: { ids: ['api'] }, changes: { text: 'Checkout gateway' } }], 'ana')
  await w.slates.settle()
  tick(91_001)
  await w.scheduler.tick()
  const drained = await w.drain()
  const conflicted = drained[0]
  assert.equal(conflicted.run.trigger.event, 'github.push', why(conflicted))
  assert.ok(drained.some((o) => o.run.trigger.kind === 'slate_saved'), 'the person\'s save ran right after it (and the conflict note below outlived that run)')
  assert.equal(w.slates.notesOf(slate.slateId).find((n) => n.id === 'api').text, 'Checkout gateway')
  assert.ok(w.slates.notesOf(slate.slateId).some((n) => /Changed in both places: “Checkout gateway” here, “Orders API” in docs\/architecture\/checkout\.mmd\. The canvas version is kept\./.test(n.text)), 'a conflict note on the slate')
  const pr = [...repo().pulls.values()].find((p) => p.state === 'open')
  assert.ok(pr, 'a new pull request for the canvas version')
  assert.match(pr.body, /Changed in both places[\s\S]*note api/)
  assert.match(branchFile(), /api\["Checkout gateway"\]/)
  tick(QUIET)
  await w.scheduler.tick()
  const after = await w.drain()
  assert.ok(after.every((o) => !o.run.writes.length), 'the person\'s save, already exported, makes no second commit')

  // Developers' hooks got the mermaid.sync events, signed.
  await w.outbound.deliverDue()
  const types = received.map((r) => JSON.parse(r.body).type)
  for (const type of ['mermaid.sync.pr_opened', 'mermaid.sync.pr_updated', 'mermaid.sync.imported', 'mermaid.sync.conflict']) assert.ok(types.includes(type), `${type} in ${types}`)
  const opened = received.map((r) => JSON.parse(r.body)).find((e) => e.type === 'mermaid.sync.pr_opened')
  assert.deepEqual([opened.data.repo, opened.data.number, opened.data.files], [REPO, 1, [FILE]])
  for (const r of received) assert.equal(verifySignature(r.headers['Slatebox-Signature'] || r.headers['slatebox-signature'], [{ plain: hook.secret }], r.body, w.clock()), true)
})

test('Living architecture changing a slate in the sync map is a recipe_event run, at once, that exports it', async () => {
  const { w, gh, tick, branchFile, push } = setup()
  const ana = w.person('ana')
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'Platform architecture' })
  await gh.vendor.stores.installations.upsert('42', { account: 'acme', repos: [REPO], allRepos: false, suspended: false })
  await gh.vendor.stores.installations.linkUser('42', 'ana')
  const { recipe: g1 } = await w.service.create(ana, drive, { recipeId: 'github-architecture', config: { repos: [REPO], labels: false } })
  await w.service.activate(ana, g1.instanceId)
  const [built] = await w.drain()
  assert.equal(built.state, 'done', why(built))
  const modulesId = Object.entries((await instanceOf(w, g1.instanceId)).slateMap).find(([k]) => k.startsWith('modules/'))[1]
  w.slates.keepAll(modulesId)
  tick(60_000)
  await w.service.runNow(ana, g1.instanceId)
  await w.drain()
  await w.service.update(ana, g1.instanceId, { applyMode: 'auto' })
  const modules = w.projects.slates.get(modulesId)

  const { recipe: g3 } = await w.service.create(ana, drive, { recipeId: 'github-mermaid-sync', config: { repo: REPO, maps: [{ shareId: modules.shareId }] }, triggers: TRIGGERS })
  await w.service.grant(ana, g3.instanceId, { kind: 'github.pull_request', scope: SCOPE })
  await w.service.activate(ana, g3.instanceId)
  const [first] = await w.drain()
  assert.equal(first.state, 'done', why(first))
  const path = first.run.writes.length ? 'docs/architecture/' + `${modules.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.mmd' : null
  assert.ok(path && branchFile(path), `the module graph is a file on the branch (${path})`)
  const before = branchFile(path)

  // A push adds an import api -> ledger: G1 updates the module graph in place and says so; G3 runs
  // right after it (no quiet time), named after G1's run, and commits the new line.
  await push(PUSH_NEW_EDGE, 'api reads ledger entries')
  tick(121_000)
  await w.scheduler.tick()
  const outcomes = await w.drain()
  const g1Run = outcomes.find((o) => o.run.instanceId === g1.instanceId)
  assert.equal(g1Run?.state, 'done', why(g1Run))
  const event = outcomes.find((o) => o.run.instanceId === g3.instanceId && o.run.trigger.kind === 'recipe_event')
  assert.ok(event, `a recipe_event run: ${JSON.stringify(outcomes.map((o) => [o.run.instanceId, o.run.trigger]))}`)
  assert.equal(event.run._id, `${g3.instanceId}:re:${g1Run.run._id}`)
  assert.deepEqual([event.run.trigger.event, event.run.trigger.from], ['architecture.updated', g1.instanceId])
  assert.notEqual(branchFile(path), before, 'the change is committed')
  assert.ok(branchFile(path).split('\n').filter((l) => !before.split('\n').includes(l)).some((l) => / --> /.test(l)), 'a new line in the file')
  await w.slates.settle()
  assert.deepEqual((await instanceOf(w, g3.instanceId)).slateSaves, [], 'G1\'s saves are not a person\'s edits')
})

test('the save listener: a slate no recipe watches costs one lookup, then none; a watched one is pushed out at most once per throttle', async () => {
  const lookups = []
  const instances = {
    find: (query) => ({ toArray: async () => { lookups.push(query.watchSlates); return query.watchSlates === 'watched' ? [{ _id: 'i1', triggers: [{ kind: 'slate_saved', debounceMs: 600000 }] }] : [] } }),
  }
  const pushed = []
  let at = 0
  const listener = createSlateSaveListener({ store: { instances }, queue: { slateSaved: async (id, shareId, o) => { pushed.push([id, shareId, o.debounceMs]); return true } }, clock: () => at })
  for (let k = 0; k < 20; k += 1) { assert.equal(await listener.slateSaved({ shareId: 'plain', actor: { kind: 'person' } }), 0); at += 1000 }
  assert.equal(lookups.filter((x) => x === 'plain').length, 1, 'cached: one query for twenty saves')
  at = 0
  for (let k = 0; k < 20; k += 1) { await listener.slateSaved({ shareId: 'watched', actor: { kind: 'person' } }); at += 1000 }
  assert.deepEqual(pushed, [['i1', 'watched', 600000], ['i1', 'watched', 600000]], 'twenty saves in twenty seconds: two pushes (15 s throttle)')
  assert.equal(await listener.slateSaved({ shareId: 'watched', actor: { kind: 'agent', tokenId: 'recipe:i1' } }), 0, 'a recipe\'s own save never counts')
  listener.forget(['plain'])
  await listener.slateSaved({ shareId: 'plain' })
  assert.equal(lookups.filter((x) => x === 'plain').length, 2, 'a changed sync map is read again')
})

test('saves are debounced per slate: a slate edited all along never holds back another one', async () => {
  const db = createMemoryDb()
  const store = createRecipeStore((name) => db[name])
  let at = Date.UTC(2026, 10, 27, 12)
  const queue = createRecipeQueue({ store, clock: () => at, randomId: (() => { let n = 0; return () => `r${++n}` })() })
  const scheduler = createScheduler({ store, clock: () => at, queue })
  await store.instances.insertOne({ _id: 'i1', ownerId: 'ana', projectId: 'p1', recipeId: 'github-mermaid-sync', state: 'active', rev: 0, watchSlates: ['a', 'b'], slateSaves: [], savesDueAt: null })
  await queue.slateSaved('i1', 'a', { debounceMs: 600000 })
  for (let k = 0; k < 12; k += 1) {
    at += 60000
    await queue.slateSaved('i1', 'b', { debounceMs: 600000 })
    await scheduler.tick()
  }
  const runs = await store.runs.find({}).toArray()
  assert.equal(runs.length, 1, 'a went out 10 minutes after its last save')
  assert.deepEqual([runs[0].trigger.kind, runs[0].trigger.shareIds], ['slate_saved', ['a']])
  assert.deepEqual((await store.instances.findOne({ _id: 'i1' })).slateSaves.map((s) => s.shareId), ['b'], 'b still waits for its own quiet time')
  at += 600001
  await scheduler.tick()
  const later = (await store.runs.find({}).toArray()).map((r) => r.trigger.shareIds)
  assert.deepEqual(later, [['a'], ['b']])
  assert.equal((await store.instances.findOne({ _id: 'i1' })).savesDueAt, null)
  // A paused instance takes no saves.
  await store.instances.updateOne({ _id: 'i1' }, { $set: { state: 'paused' } })
  assert.equal(await queue.slateSaved('i1', 'a', { debounceMs: 1 }), false)
})

test('the manifest: G3 validates with its slate_saved and recipe_event triggers; a recipe_event names another recipe\'s own event', () => {
  assert.equal(validateManifest(G3.manifest), null)
  assert.ok(CATALOG.some((m) => m.id === 'github-mermaid-sync'), 'offered in the gallery')
  assert.deepEqual(defaultTriggers(G3.manifest), [{ kind: 'vendor', event: 'github.push', debounceMs: 120000 }, { kind: 'slate_saved', debounceMs: 600000 }, { kind: 'recipe_event', event: 'architecture.updated' }])
  const base = { ...G3.manifest, triggers: [{ kind: 'manual' }] }
  assert.match(validateManifest({ ...base, triggers: [{ kind: 'recipe_event' }] }), /another recipe/)
  assert.match(validateManifest({ ...base, triggers: [{ kind: 'recipe_event', event: 'run.finished' }] }), /another recipe/)
  assert.match(validateManifest({ ...base, triggers: [{ kind: 'slate_saved', debounceMs: 7 * 3600e3 }] }), /debounceMs/)
  assert.deepEqual(checkTriggers(G3.manifest, [{ kind: 'slate_saved', debounceMs: 5000 }, { kind: 'recipe_event' }]), [{ kind: 'slate_saved', debounceMs: 5000 }, { kind: 'recipe_event', event: 'architecture.updated' }])
  assert.throws(() => checkTriggers(G3.manifest, [{ kind: 'recipe_event', event: 'pr.impact' }]), { code: 'bad_triggers' })
  assert.deepEqual(watchSlatesFor(G3.manifest, { maps: [{ shareId: 'a' }, { shareId: 'a' }, { shareId: 'b' }] }), ['a', 'b'])
  assert.deepEqual(watchSlatesFor(G1.manifest, { maps: [{ shareId: 'a' }] }), [], 'a recipe without save triggers watches nothing')
})

test('the setup form and the synced slate: repository, folder, slates and files, branch; the exact permission; the line on the slate', () => {
  const fields = Object.fromEntries(configFields(G3.manifest.configSchema).map((f) => [f.key, f]))
  assert.deepEqual([fields.repo.kind, fields.repo.multiple], ['repos', false])
  assert.equal(fields.maps.kind, 'slatemaps')
  assert.equal(fields.branch.default, 'slatebox/architecture')
  assert.equal(fields.folder.default, 'docs/architecture/')
  const config = { repo: 'acme/api', folder: 'docs/architecture/', maps: [{ shareId: 's1' }, { shareId: 's2', file: 'README.md' }] }
  const [row] = permissionRows(G3.manifest, config, [])
  assert.deepEqual(row.scope, { repos: ['acme/api'], branchPrefix: 'slatebox/', paths: ['docs/architecture/**', 'README.md'] })
  assert.equal(row.text, 'Open pull requests in acme/api on branches named slatebox/…, changing only docs/architecture/** and README.md')
  assert.equal(validate(G3.manifest.writes[0].scopeSchema, row.scope), null, 'the scope the form grants is one the server takes')
  assert.deepEqual(syncPaths({ maps: [] }), ['docs/architecture/**'])
  assert.equal(instanceName(G3.manifest, config), 'Diagrams as code · acme/api')
  assert.deepEqual(withoutEmptyMaps({ maps: [{ shareId: 's1' }, { shareId: '' }, {}] }).maps, [{ shareId: 's1' }])
  assert.deepEqual(defaultTriggersUI(G3.manifest).map((t) => t.kind), ['vendor', 'slate_saved', 'recipe_event', 'manual'])
  assert.deepEqual(optionalTriggers(G3.manifest).map((t) => t.label), ['On every push', 'When someone edits a synced slate (10 minutes after the last edit)', 'After Living architecture changes a synced slate'])
  assert.equal(syncedLine({ repo: 'acme/api', path: 'docs/architecture/checkout.mmd', commit: '1a2b3c4d5e6f' }), 'Synced with acme/api docs/architecture/checkout.mmd @ 1a2b3c4')
  assert.equal(syncedState({ state: 'active', pending: true }), 'Changes wait in the pull request for a review.')
  assert.equal(syncedState({ state: 'active', savesDueAt: new Date(Date.now() + 5 * 60000).toISOString() }), 'Your edits go to the repository in 5 min.')
  assert.equal(createdInstance({ recipe: { instanceId: 'i1', name: 'x' } })._id, 'i1', 'the dialog keeps the server\'s answer')
  assert.deepEqual(grantsOf({ permissions: [{ grantId: 'g1', kind: 'github.pull_request' }] }).map((g) => g._id), ['g1'])
  assert.equal(downloadName('docs/architecture/check out.mmd'), 'check-out.mmd')
})

test('the UI: Save to repo now on the card and on the synced slate, approvals with the .mmd to download, the app tells recipes of saves', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  const card = read('enterprise/client/recipes/ProjectRecipes.jsx')
  assert.match(card, /recipesApi\.saveNow\(\{ instanceId: instance\._id \}\)/)
  assert.match(card, />Save to repo now</)
  assert.match(card, /recipesApi\.decideWrite\(\{ cardId, decision \}\)/)
  assert.match(card, /Download \{downloadName\(f\.path\)\}/)
  const synced = read('enterprise/client/recipes/SyncedWithRepo.jsx')
  assert.match(synced, /recipesApi\.syncedOn\(\{ shareId \}\)/)
  assert.match(synced, /recipesApi\.saveNow\(\{ instanceId: s\.instanceId, shareId \}\)/)
  assert.match(read('enterprise/client/index.jsx'), /api\.fill\('canvas\.recipes', CanvasRecipes\)/)
  assert.match(read('enterprise/client/recipes/ConfigForm.jsx'), /f\.kind === 'slatemaps'/)
  assert.match(read('enterprise/client/recipes/AddRecipeDialog.jsx'), /projectId=\{projectId\}/)
  for (const f of ['SyncedWithRepo.jsx', 'CanvasRecipes.jsx']) {
    const src = read(`enterprise/client/recipes/${f}`)
    assert.doesNotMatch(src, /\bAI\b/, f)
    assert.doesNotMatch(src, /colour|organis|behaviour|licence|favourite/i, f)
  }
  assert.match(read('web/app/server/slate-save.js'), /recipeHooks\.slateSaved\(\{ shareId: change\.slate\.shareId, actor: change\.actor \|\| null \}\)/)
})
