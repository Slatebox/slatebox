// G1 Living architecture (catalog acceptance criteria), against a GitHub that answers as GitHub
// does (scripts/fakes/github-api.mjs) and the recipe context of design B.7. The recipe says what the
// project should hold (a DesiredSet): these tests read it. Reconcile's own rules (positions, person
// edits, locks) are the runtime's and are tested there.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-github-architecture.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import recipe from '../enterprise/recipes/github-architecture/index.mjs'
import { FILES, PUSH_NEW_EDGE, REPO } from '../enterprise/recipes/_github-code/fixtures/acme-monorepo.mjs'
import { createFakeGithub } from './fakes/github-api.mjs'
import { createTestContext, memoryLedger, testBudget } from './fakes/github-recipe-context.mjs'

const NOW = Date.parse('2026-11-27T12:00:00Z')
const CONFIG = { repos: [REPO], labels: false }

function world() {
  const github = createFakeGithub()
  const root = github.addRepo(REPO, { files: FILES })
  return { github, root, ledger: memoryLedger() }
}
const slate = (out, role, key) => out.desired.slates.find((s) => s.role === role && (key === undefined || s.key === key))
const keys = (list) => list.map((x) => x.key).sort()

test('a first run reads the sample monorepo with one tarball call and keeps every slate', async () => {
  const w = world()
  const { ctx, events } = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, now: () => NOW })
  const out = await recipe.run(ctx)
  const gets = w.github.calls.map((c) => `${c.method} ${c.path}`)
  assert.deepEqual(gets, [`GET /repos/${REPO}`, `GET /repos/${REPO}/branches/main`, `GET /repos/${REPO}/tarball/${w.root}`])
  assert.deepEqual(out.desired.slates.map((s) => `${s.role}:${s.key}`), ['service-map:service-map', `modules:${REPO}`, `api:${REPO}`, 'changes:changes'])

  const map = slate(out, 'service-map')
  assert.deepEqual(keys(map.graph.nodes), ['svc:acme/platform:compose:api', 'svc:acme/platform:compose:postgres', 'svc:acme/platform:compose:redis', 'svc:acme/platform:compose:worker'])
  const shapes = Object.fromEntries(map.graph.nodes.map((n) => [n.key.split(':').pop(), n.shape]))
  assert.deepEqual(shapes, { api: 'roundedrectangle', postgres: 'ellipse', redis: 'ellipse', worker: 'roundedrectangle' })
  assert.deepEqual(map.graph.edges.map((e) => `${e.from.split(':').pop()}->${e.to.split(':').pop()}:${e.label}`).sort(), ['api->postgres:sql', 'api->redis:redis', 'worker->postgres:sql', 'worker->redis:redis'])
  assert.deepEqual(map.graph.frames, [{ key: `repo:${REPO}`, text: REPO, members: keys(map.graph.nodes) }])
  assert.equal(map.graph.layout, 'layered')

  const mods = slate(out, 'modules')
  assert.deepEqual(mods.graph.nodes.map((n) => n.text).sort(), ['@acme/api', '@acme/ledger', '@acme/worker'])
  assert.deepEqual(mods.graph.edges.map((e) => `${e.from}->${e.to}`), ['mod:acme/platform:packages/worker->mod:acme/platform:packages/ledger'])
  // CODEOWNERS colors: ledger (payments) differs from the others (platform).
  const color = Object.fromEntries(mods.graph.nodes.map((n) => [n.text, n.colors.borderColor]))
  assert.notEqual(color['@acme/ledger'], color['@acme/api'])
  assert.equal(color['@acme/api'], color['@acme/worker'])

  const api = slate(out, 'api')
  assert.deepEqual(api.graph.nodes.filter((n) => n.key.startsWith('api:')).map((n) => n.text).sort(), ['GET /health', 'GET /invoices', 'GET /invoices/{id}', 'POST /invoices'])
  assert.deepEqual(api.graph.frames.map((f) => f.text).sort(), ['health', 'invoices'])
  assert.match(api.graph.nodes.find((n) => n.text === 'GET /invoices/{id}').link.url, new RegExp(`^https://github.com/${REPO}/blob/main/openapi.yaml#L13$`))
  assert.deepEqual(slate(out, 'changes').boards[0].cards, [], 'a first scan is not a change')
  assert.deepEqual(events, [])
  // The ledger holds paths and names, never a file's body.
  const stored = JSON.stringify([...w.ledger.rows.values()])
  assert.ok(!stored.includes('select * from entries'), 'no source in the ledger')
  assert.ok(!stored.includes('secret@postgres'), 'no connection strings in the ledger')
})

test('a push adding one import adds exactly one module edge and one change card (1 compare + 1 contents call)', async () => {
  const w = world()
  const first = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, now: () => NOW })
  const before = await recipe.run(first.ctx)
  const sha = w.github.commit(REPO, { changes: PUSH_NEW_EDGE, message: 'Read invoices from the ledger' })
  w.github.reset()
  const push = { kind: 'vendor', event: 'github.push', repo: REPO, before: w.root, after: sha }
  const { ctx, events } = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, cursor: first.state.cursor, trigger: push, now: () => NOW + 60000 })
  const after = await recipe.run(ctx)
  assert.deepEqual(w.github.calls.map((c) => `${c.method} ${c.path}`), [
    `GET /repos/${REPO}`, `GET /repos/${REPO}/branches/main`, `GET /repos/${REPO}/compare/${w.root}...${sha}`, `GET /repos/${REPO}/contents/packages/api/src/routes/invoices.ts`,
  ])
  const edges = (out) => slate(out, 'modules').graph.edges.map((e) => `${e.from}->${e.to}`)
  assert.deepEqual(edges(after).filter((e) => !edges(before).includes(e)), ['mod:acme/platform:packages/api->mod:acme/platform:packages/ledger'])
  // Nothing else on the module graph says anything different (the legend names the new commit).
  const said = (out) => JSON.stringify(slate(out, 'modules').graph.nodes)
  assert.equal(said(after), said(before))
  assert.deepEqual(slate(after, 'service-map').graph, slate(before, 'service-map').graph)
  const cards = slate(after, 'changes').boards[0].cards
  assert.equal(cards.length, 1)
  assert.equal(cards[0].label, 'New dependency @acme/api → @acme/ledger')
  assert.equal(cards[0].lane, 'this-week')
  assert.equal(cards[0].link.url, `https://github.com/${REPO}/commit/${sha}`)
  assert.deepEqual(events.map((e) => e.event).sort(), ['architecture.new_dependency', 'architecture.updated'])
})

test('a schedule run on the same commit reads nothing more and changes nothing', async () => {
  const w = world()
  const first = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, now: () => NOW })
  const one = await recipe.run(first.ctx)
  w.github.reset()
  const { ctx, events } = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, cursor: first.state.cursor, trigger: { kind: 'schedule' }, now: () => NOW + 3600000 })
  const two = await recipe.run(ctx)
  assert.equal(w.github.calls.length, 2, 'repo + branch only')
  assert.deepEqual(two.desired, one.desired)
  assert.deepEqual(events, [])
})

test('a module renamed in code is a rename (its person edits carry over), and an import cycle is flagged', async () => {
  const w = world()
  const first = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, now: () => NOW })
  await recipe.run(first.ctx)
  const moved = {
    'packages/ledger/package.json': null, 'packages/ledger/src/index.ts': null, 'packages/ledger/src/entries.ts': null,
    'packages/books/package.json': JSON.stringify({ name: '@acme/books' }),
    'packages/books/src/index.ts': "export { listEntries, postEntry } from './entries'\nimport '@acme/worker'\n",
    'packages/books/src/entries.ts': FILES['packages/ledger/src/entries.ts'],
    'packages/worker/src/index.ts': "import { Worker } from 'bullmq'\nimport { postEntry } from '@acme/books'\nnew Worker('ledger', async (job) => postEntry(job.data))\n",
  }
  const sha = w.github.commit(REPO, { changes: moved, message: 'Rename ledger to books' })
  const { ctx, events } = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, cursor: first.state.cursor, trigger: { kind: 'vendor', event: 'github.push', repo: REPO, after: sha }, now: () => NOW + 60000 })
  const out = await recipe.run(ctx)
  const books = slate(out, 'modules').graph.nodes.find((n) => n.key === 'mod:acme/platform:packages/books')
  assert.equal(books.carryFrom, 'mod:acme/platform:packages/ledger')
  assert.ok(events.some((e) => e.event === 'architecture.renamed' && e.data.from.endsWith('ledger') && e.data.to.endsWith('books')))
  assert.ok(events.some((e) => e.event === 'architecture.cycle_detected'))
  const cycleLines = slate(out, 'modules').graph.edges.filter((e) => e.style.lineColor === '#dc2626')
  assert.equal(cycleLines.length, 2)
  const labels = slate(out, 'changes').boards[0].cards.map((c) => c.label)
  assert.ok(labels.includes('Renamed module @acme/ledger → @acme/books'))
  assert.ok(labels.some((l) => l.startsWith('Import cycle introduced')))
  assert.ok(!labels.includes('Added module @acme/books'), 'a rename is not an add')
})

test('module names come from the agent within budget; over budget the run is partial and earlier names stay', async () => {
  const w = world()
  const ai = (req) => ({ label: `The ${req.prompt.module.replace('@acme/', '')} service`, purpose: 'Does its job.' })
  const first = createTestContext({ github: w.github, config: { ...CONFIG, labels: true }, ledger: w.ledger, ai, now: () => NOW })
  const named = await recipe.run(first.ctx)
  assert.equal(first.aiCalls.length, 3)
  assert.ok(first.aiCalls.every((c) => c.maxIn <= 1500 && c.maxOut <= 80 && !JSON.stringify(c.prompt).includes('pool.query')), 'file names only, never code')
  assert.ok(slate(named, 'modules').graph.nodes.some((n) => n.text === 'The ledger service\n@acme/ledger'))
  assert.equal(named.desired.partial, undefined)

  const sha = w.github.commit(REPO, { changes: { 'packages/ledger/src/extra.ts': "import pg from 'pg'\n" }, message: 'More ledger' })
  const broke = createTestContext({ github: w.github, config: { ...CONFIG, labels: true }, ledger: w.ledger, cursor: first.state.cursor, ai: () => null, trigger: { kind: 'vendor', event: 'github.push', repo: REPO, after: sha }, now: () => NOW + 60000 })
  const out = await recipe.run(broke.ctx)
  assert.equal(out.desired.partial, 'ai_refused')
  assert.deepEqual(slate(out, 'modules').graph.nodes.map((n) => n.text).sort(), slate(named, 'modules').graph.nodes.map((n) => n.text).sort(), 'no label changed')
  assert.equal(slate(out, 'service-map').graph.nodes.length, 4, 'the deterministic slates are complete')
})

test('a run past its GitHub budget stops with code budget and writes nothing outside Slatebox', async () => {
  const w = world()
  const { ctx } = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, budget: testBudget({ vendorCalls: 2 }), now: () => NOW })
  await assert.rejects(recipe.run(ctx), (error) => error.code === 'budget')
  assert.deepEqual(w.github.writes(), [])
})

test('with the check permission asked for, a push proposes one neutral check (the runtime decides whether it goes out)', async () => {
  const w = world()
  const first = createTestContext({ github: w.github, config: { ...CONFIG, checkRun: true }, ledger: w.ledger, now: () => NOW })
  const none = await recipe.run(first.ctx)
  assert.deepEqual(none.writes, [], 'no check on a first scan')
  const sha = w.github.commit(REPO, { changes: PUSH_NEW_EDGE })
  const { ctx } = createTestContext({ github: w.github, config: { ...CONFIG, checkRun: true }, ledger: w.ledger, cursor: first.state.cursor, trigger: { kind: 'vendor', event: 'github.push', repo: REPO, after: sha }, now: () => NOW + 1 })
  const out = await recipe.run(ctx)
  assert.equal(out.writes.length, 1)
  assert.deepEqual({ kind: out.writes[0].kind, target: out.writes[0].target, key: out.writes[0].key }, { kind: 'github.check_run', target: { repo: REPO, headSha: sha }, key: `check:${REPO}:${sha}` })
  assert.match(out.writes[0].body.summary, /^0 modules changed, 1 new dependency, 0 cycles\.$/)
  assert.deepEqual(w.github.writes(), [], 'the recipe itself never writes to GitHub')
})

test('an inbound deploy call stamps the service map legend', async () => {
  const w = world()
  const { ctx } = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, trigger: { kind: 'inbound', input: { env: 'prod', version: 'v2.3' } }, now: () => NOW })
  const out = await recipe.run(ctx)
  assert.ok(slate(out, 'service-map').notes.some((n) => n.key === 'deploy:prod' && n.text.startsWith('Deployed v2.3 to prod')))
})

test('the manifest is complete and keys stay stable', () => {
  const m = recipe.manifest
  assert.equal(m.id, 'github-architecture')
  assert.equal(m.idPrefix, 'ga')
  assert.equal(m.agentName, 'GitHub architect')
  assert.deepEqual(m.triggers.map((t) => t.kind), ['vendor', 'schedule', 'manual', 'inbound'])
  assert.equal(m.triggers[0].debounceMs, 120000)
  assert.deepEqual(m.writes.map((x) => x.kind), ['github.check_run'])
  assert.equal(m.writes[0].describe({ repos: ['acme/api'] }), 'Add a neutral "Slatebox architecture" check to pushes in acme/api')
  assert.ok(Object.isFrozen(m))
})

test('history rewritten (the last commit is gone): the next run reads the repository again in full', async () => {
  const w = world()
  const first = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, now: () => NOW })
  await recipe.run(first.ctx)
  const repo = w.github.repos.get(REPO)
  repo.commits.delete(w.root)
  const fresh = 'f'.repeat(40)
  repo.commits.set(fresh, { sha: fresh, files: new Map(Object.entries(FILES)), message: 'Rewritten', parents: [] })
  repo.branches.set('main', fresh)
  w.github.reset()
  const { ctx } = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, cursor: first.state.cursor, trigger: { kind: 'schedule' }, now: () => NOW + 1 })
  const out = await recipe.run(ctx)
  assert.ok(w.github.calls.some((c) => c.path.includes('/tarball/')))
  assert.equal(slate(out, 'modules').graph.nodes.length, 3)
})
