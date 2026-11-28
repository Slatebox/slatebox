// G3 Diagrams as code (catalog acceptance criteria): slate → repository as one pull request on a
// slatebox/ branch, a merged file edit → the slate in place, three-way merge per element, loop
// prevention, and the hard limits no grant lifts. The slate store applies the recipe's plans the way
// the runtime does (the engine's own applier); GitHub answers as GitHub does.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-github-mermaid-sync.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import recipe from '../enterprise/recipes/github-mermaid-sync/index.mjs'
import { checkHardLimits, performWrite } from '../enterprise/server/recipes/vendors/github/perform.mjs'
import { createGithubClient } from '../enterprise/server/recipes/vendors/github/client.mjs'
import { diagramPlans, parseMermaid } from '../web/app/imports/api/common/mermaid/index.mjs'
import { createFakeGithub } from './fakes/github-api.mjs'
import { createTestContext, memoryLedger } from './fakes/github-recipe-context.mjs'

const { applyPlanToJSON } = createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/operations')
const REPO = 'acme/api'
const FILE = 'docs/architecture/service-map.mmd'
const NOW = Date.parse('2026-11-27T12:00:00Z')

const apply = (slate, plans, message = 'edit') => plans.reduce((s, plan) => applyPlanToJSON(s, { message, ...plan }, { userMessage: message, requireMatches: true }).slate, slate)

function world() {
  const github = createFakeGithub()
  github.addRepo(REPO, { files: { 'README.md': '# api\n' } })
  const drawn = diagramPlans(parseMermaid('flowchart LR\n  api["Api"]\n  ledger["Ledger"]\n  db(["Postgres"])\n  api --> ledger\n  ledger -->|"sql"| db'), { origin: { x: 0, y: 0 } })
  const store = { slate: apply({ shareId: 'svcmap', options: { name: 'Service map' }, nodes: [] }, drawn.plans), revision: 3 }
  const slates = {
    async read(which) {
      return which?.shareId === 'svcmap' ? { slate: structuredClone(store.slate), revision: store.revision, slateId: 'slate-1', metaNoteIds: [] } : null
    },
  }
  const client = createGithubClient({ fetch: github.fetch, installationId: '42', token: async () => 't' })
  return { github, store, slates, client, cursor: {}, ledger: memoryLedger() }
}
const CONFIG = { repo: REPO, maps: [{ shareId: 'svcmap', file: FILE }] }

/** One run as the runtime does it: the plans applied to the slate, the cursor kept. */
async function runOnce(w, trigger, { runId = 'run-1' } = {}) {
  const t = createTestContext({ github: w.github, config: CONFIG, cursor: w.cursor, trigger, slates: w.slates, ledger: w.ledger, runId, now: () => NOW })
  const out = await recipe.run(t.ctx)
  for (const s of out.desired.slates) if (s.plans.length) {
    w.store.slate = apply(w.store.slate, s.plans, 'sync')
    w.store.revision += 1
  }
  w.cursor = t.state.cursor
  return { out, events: t.events, log: t.log }
}
const geometry = (slate) => Object.fromEntries(slate.nodes.map((n) => [n.options.id, [n.options.xPos, n.options.yPos]]))
const mergeBranch = (w, title = 'Update architecture diagrams') => {
  const repo = w.github.repos.get(REPO)
  const files = repo.commits.get(repo.branches.get('slatebox/architecture')).files
  return w.github.commit(REPO, { changes: { [FILE]: files.get(FILE) }, message: `Merge pull request #1 from acme/slatebox/architecture\n\n${title}` })
}

test('first run: the file is proposed as one pull request on slatebox/architecture, never the default branch', async () => {
  const w = world()
  const { out } = await runOnce(w, { kind: 'manual' })
  assert.equal(out.writes.length, 1)
  const write = out.writes[0]
  assert.equal(write.kind, 'github.pull_request')
  assert.deepEqual(write.target, { repo: REPO, branch: 'refs/heads/slatebox/architecture' })
  assert.equal(write.body.files.length, 1)
  assert.equal(write.body.files[0].path, FILE)
  assert.match(write.body.files[0].content, /^%% slatebox:svcmap rev:3 hash:[0-9a-f]{16}\nflowchart LR\n/)
  assert.equal(write.body.trailer, 'Slatebox-Recipe-Run: run-1')
  assert.deepEqual(w.github.writes(), [], 'nothing is written by the recipe itself (no grant: an action card)')
  // With the grant, the vendor writes the branch and the pull request, and only there.
  const done = await performWrite(w.client, write, { grant: { scope: { repos: [REPO], branchPrefix: 'slatebox/', paths: ['docs/architecture/**'] } } })
  assert.equal(done.opened, true)
  const repo = w.github.repos.get(REPO)
  assert.equal(repo.branches.get('main'), [...repo.commits.keys()][0], 'main never moves')
  assert.match(repo.commits.get(repo.branches.get('slatebox/architecture')).message, /Slatebox-Recipe-Run: run-1$/)
  const refWrites = w.github.writes().filter((c) => c.path.includes('/git/refs'))
  assert.ok(refWrites.every((c) => (c.body?.ref ?? c.path).includes('slatebox/architecture')))
  assert.ok(w.github.writes().every((c) => c.body?.force !== true), 'never forced')
})

test('moving notes gives no commit; adding a note and a line gives one commit with a 2-line diff', async () => {
  const w = world()
  const first = await runOnce(w, { kind: 'manual' })
  await performWrite(w.client, first.out.writes[0])
  w.store.slate = apply(w.store.slate, [{ operations: [{ kind: 'update_nodes', target: { ids: ['api'] }, changes: { x: 900, y: 400 } }] }])
  w.store.revision += 1
  const moved = await runOnce(w, { kind: 'slate_saved' })
  assert.deepEqual(moved.out.writes, [], 'a move is not a change')
  w.store.slate = apply(w.store.slate, [{ operations: [{ kind: 'add_nodes', count: 1, ids: ['cache'], shape: 'rectangle', text: 'Cache', x: 0, y: 600 }, { kind: 'connect_nodes', from: { ids: ['api'] }, to: { ids: ['cache'] }, ids: ['api->cache'] }] }])
  w.store.revision += 1
  const grown = await runOnce(w, { kind: 'slate_saved' }, { runId: 'run-3' })
  assert.equal(grown.out.writes.length, 1)
  const before = first.out.writes[0].body.files[0].content.split('\n').slice(1)
  const after = grown.out.writes[0].body.files[0].content.split('\n').slice(1)
  assert.deepEqual(after.filter((l) => !before.includes(l)), ['  cache["Cache"]', '  api --> cache'])
  assert.deepEqual(before.filter((l) => !after.includes(l)), [])
  // The pull request body says what the pull request changes against the default branch (no file there yet).
  assert.match(grown.out.writes[0].body.body, /service-map\.mmd`: \+4 notes, \+3 lines/)
  const done = await performWrite(w.client, grown.out.writes[0])
  assert.equal(done.opened, false, 'the open pull request is updated, not a second one')
  assert.equal(w.github.repos.get(REPO).pulls.size, 1)
})

test('our own merged pull request moves the base and changes nothing (no import, no new commit)', async () => {
  const w = world()
  const first = await runOnce(w, { kind: 'manual' })
  await performWrite(w.client, first.out.writes[0])
  const sha = mergeBranch(w)
  const { out, events } = await runOnce(w, { kind: 'vendor', event: 'github.push', repo: REPO, after: sha, paths: [FILE] })
  assert.deepEqual(out.writes, [])
  assert.ok(out.desired.slates.every((s) => !s.plans.length))
  assert.deepEqual(events, [])
})

test('a merged edit to the file (relabel, new line) updates the slate in place: 1 update_nodes, 1 connect_nodes, no moves', async () => {
  const w = world()
  const first = await runOnce(w, { kind: 'manual' })
  await performWrite(w.client, first.out.writes[0])
  await runOnce(w, { kind: 'vendor', event: 'github.push', repo: REPO, after: mergeBranch(w), paths: [FILE] })
  // A person adds a note of their own on the slate.
  w.store.slate = apply(w.store.slate, [{ operations: [{ kind: 'add_nodes', count: 1, ids: ['mine'], shape: 'rectangle', text: 'Ask payments first', x: 0, y: 900 }] }])
  const places = geometry(w.store.slate)
  const repo = w.github.repos.get(REPO)
  const text = repo.commits.get(repo.branches.get('main')).files.get(FILE)
  const edited = text.replace('"Ledger"', '"Ledger service"') + '  api --> db\n'
  const sha = w.github.commit(REPO, { changes: { [FILE]: edited }, message: 'Merge pull request #7 from acme/docs\n\nRename the ledger' })
  const { out, events } = await runOnce(w, { kind: 'vendor', event: 'github.push', repo: REPO, after: sha, paths: [FILE] })
  const plans = out.desired.slates.find((s) => s.key === 'svcmap').plans
  assert.deepEqual(plans.flatMap((p) => p.operations).map((op) => op.kind).sort(), ['connect_nodes', 'update_nodes'])
  for (const [id, at] of Object.entries(places)) assert.deepEqual(geometry(w.store.slate)[id], at, `${id} did not move`)
  assert.equal(w.store.slate.nodes.find((n) => n.options.id === 'ledger').options.text, 'Ledger service')
  assert.ok(w.store.slate.nodes.some((n) => n.options.id === 'mine'), 'the person-added note survives')
  assert.ok(events.some((e) => e.event === 'mermaid.sync.imported' && e.data.changed === 1 && e.data.added === 0))
  // The person's note is on the canvas and not in the file: the file follows the canvas in the pull request.
  assert.equal(out.writes.length, 1)
  assert.match(out.writes[0].body.files[0].content, /\n {2}mine\["Ask payments first"\]\n/)
})

test('the same label changed on the canvas and in the file keeps the canvas label, with a conflict note and a line in the PR body', async () => {
  const w = world()
  const first = await runOnce(w, { kind: 'manual' })
  await performWrite(w.client, first.out.writes[0])
  await runOnce(w, { kind: 'vendor', event: 'github.push', repo: REPO, after: mergeBranch(w), paths: [FILE] })
  w.store.slate = apply(w.store.slate, [{ operations: [{ kind: 'update_nodes', target: { ids: ['api'] }, changes: { text: 'Public API' } }] }])
  const repo = w.github.repos.get(REPO)
  const text = repo.commits.get(repo.branches.get('main')).files.get(FILE)
  const sha = w.github.commit(REPO, { changes: { [FILE]: text.replace('"Api"', '"Gateway"') } })
  const { out, events } = await runOnce(w, { kind: 'vendor', event: 'github.push', repo: REPO, after: sha, paths: [FILE] })
  assert.equal(w.store.slate.nodes.find((n) => n.options.id === 'api').options.text, 'Public API')
  const entry = out.desired.slates.find((s) => s.key === 'svcmap')
  assert.ok(entry.notes.some((n) => n.key === `conflict:${FILE}:note:api` && n.text.includes('The canvas version is kept')))
  assert.ok(events.some((e) => e.event === 'mermaid.sync.conflict'))
  assert.match(out.writes[0].body.body, /Changed in both places[\s\S]*note api/)
  assert.match(out.writes[0].body.files[0].content, /api\["Public API"\]/)
})

test('hard limits: no write to the default branch, a protected branch, outside slatebox/ or the granted paths; never a merge', async () => {
  const files = [{ path: FILE, content: 'flowchart LR\n' }]
  const ok = { kind: 'github.pull_request', target: { repo: REPO, branch: 'refs/heads/slatebox/architecture' }, body: { files }, key: 'k' }
  assert.equal(checkHardLimits(ok), null)
  assert.equal(checkHardLimits({ ...ok, target: { repo: REPO, branch: 'refs/heads/main' } }).reason, 'branch_outside_slatebox')
  assert.equal(checkHardLimits({ ...ok, target: { repo: REPO, branch: 'main' } }).reason, 'branch_outside_slatebox')
  assert.equal(checkHardLimits({ ...ok, body: { files, merge: true } }).reason, 'merge_or_delete')
  assert.equal(checkHardLimits({ ...ok, body: { files: [{ path: '../etc/passwd', content: '' }] } }).reason, 'bad_files')
  const grant = { scope: { repos: [REPO], branchPrefix: 'slatebox/', paths: ['docs/architecture/**'] } }
  assert.equal(checkHardLimits({ ...ok, body: { files: [{ path: 'src/index.ts', content: 'x' }] } }, grant).reason, 'path_outside_grant')
  assert.equal(checkHardLimits({ ...ok, target: { repo: 'acme/other', branch: 'slatebox/x' } }, grant).reason, 'repo_outside_grant')
  // GitHub's own answers are checked too: a protected slatebox branch, or one that is the default.
  const w = world()
  w.github.repos.get(REPO).branches.set('slatebox/architecture', w.github.repos.get(REPO).branches.get('main'))
  w.github.repos.get(REPO).protected.add('slatebox/architecture')
  assert.deepEqual(await performWrite(w.client, ok), { refused: 'protected_branch' })
  w.github.repos.get(REPO).defaultBranch = 'slatebox/architecture'
  assert.deepEqual(await performWrite(w.client, ok), { refused: 'default_branch' })
  assert.deepEqual(w.github.writes(), [])
})

test('a person who pushed to the slatebox branch keeps their commit: the next commit goes on top', async () => {
  const w = world()
  const first = await runOnce(w, { kind: 'manual' })
  await performWrite(w.client, first.out.writes[0])
  const human = w.github.commit(REPO, { branch: 'slatebox/architecture', changes: { 'docs/architecture/README.md': 'Notes by a person\n' }, message: 'Add notes' })
  w.store.slate = apply(w.store.slate, [{ operations: [{ kind: 'add_nodes', count: 1, ids: ['cache'], shape: 'rectangle', text: 'Cache', x: 0, y: 600 }] }])
  const again = await runOnce(w, { kind: 'slate_saved' })
  const done = await performWrite(w.client, again.out.writes[0])
  const repo = w.github.repos.get(REPO)
  const tip = repo.commits.get(repo.branches.get('slatebox/architecture'))
  assert.equal(tip.sha, done.commit)
  assert.deepEqual(tip.parents, [human])
  assert.equal(tip.files.get('docs/architecture/README.md'), 'Notes by a person\n')
})
