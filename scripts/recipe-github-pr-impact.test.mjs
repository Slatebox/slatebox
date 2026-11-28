// G2 Pull request impact (catalog acceptance criteria) against a GitHub that answers as GitHub
// does. The comment goes out only through the vendor's perform (after the runtime's permission
// check); the recipe itself never writes to GitHub.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-github-pr-impact.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import recipe from '../enterprise/recipes/github-pr-impact/index.mjs'
import { FILES, PR_REFUNDS, REPO } from '../enterprise/recipes/_github-code/fixtures/acme-monorepo.mjs'
import { performWrite } from '../enterprise/server/recipes/vendors/github/perform.mjs'
import { createGithubClient } from '../enterprise/server/recipes/vendors/github/client.mjs'
import { parseMermaid } from '../web/app/imports/api/common/mermaid/index.mjs'
import { createFakeGithub } from './fakes/github-api.mjs'
import { createTestContext, memoryLedger } from './fakes/github-recipe-context.mjs'

const NOW = Date.parse('2026-11-27T12:00:00Z')
const CONFIG = { repos: [REPO] }

function world() {
  const github = createFakeGithub()
  github.addRepo(REPO, { files: FILES })
  github.repos.get(REPO).branches.set('refunds', github.repos.get(REPO).branches.get('main'))
  github.commit(REPO, { branch: 'refunds', changes: PR_REFUNDS, message: 'Add refunds API' })
  github.openPull(REPO, { number: 482, title: 'Add refunds API', body: 'Refunds, end to end.', head: 'refunds' })
  return { github, ledger: memoryLedger() }
}
const prTrigger = (action = 'opened') => ({ kind: 'vendor', event: 'github.pull_request', repo: REPO, number: 482, action })
const kinds = (slate) => Object.fromEntries(slate.graph.nodes.filter((n) => n.key.startsWith('mod:')).map((n) => [n.key.split('/').pop(), n.text.split('\n')[1]]))
const summarize = () => ({ bullets: ['Adds a refunds package that posts ledger entries.', 'The API calls refunds.', 'New endpoint POST /refunds.'] })

test('a pull request adding refunds: refunds green, api and ledger amber, worker grey, 2 new edges, one endpoint', async () => {
  const w = world()
  const { ctx, events, aiCalls } = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, trigger: prTrigger(), ai: summarize, now: () => NOW })
  const out = await recipe.run(ctx)
  assert.equal(out.desired.slates.length, 1)
  const slate = out.desired.slates[0]
  assert.equal(slate.key, `${REPO}#482`)
  assert.equal(slate.name, '#482 Add refunds API')
  assert.deepEqual(slate.folder, ['Pull requests'])
  assert.deepEqual(kinds(slate), { refunds: 'added', api: 'changed', ledger: 'changed', worker: 'depends on a change' })
  const added = slate.graph.edges.filter((e) => e.style.lineColor === '#16a34a').map((e) => `${e.from.split('/').pop()}->${e.to.split('/').pop()}`).sort()
  assert.deepEqual(added, ['api->refunds', 'refunds->ledger'])
  assert.deepEqual(slate.graph.frames.find((f) => f.key === 'endpoints').members, ['api:acme/platform:POST /refunds'])
  assert.ok(slate.notes.some((n) => n.key === 'summary' && n.text.startsWith('- Adds a refunds package')))
  assert.equal(slate.notes.find((n) => n.key === 'pr').link.url, `https://github.com/${REPO}/pull/482`)
  assert.equal(aiCalls.length, 1)
  assert.ok(aiCalls[0].maxIn <= 4000 && aiCalls[0].maxOut <= 250)
  // The comment it proposes: Mermaid GitHub draws, which Slatebox's own reader accepts.
  assert.equal(out.writes.length, 1)
  const write = out.writes[0]
  assert.deepEqual({ kind: write.kind, target: write.target, key: write.key }, { kind: 'github.pr_comment', target: { repo: REPO, number: 482 }, key: `pr-comment:${REPO}#482` })
  const mermaid = write.body.markdown.match(/```mermaid\n([\s\S]*?)\n```/)[1]
  const read = parseMermaid(mermaid)
  assert.equal(read.type, 'flowchart')
  assert.equal(read.nodes.length, 4)
  assert.equal(read.edges.length, 3)
  assert.deepEqual(events.map((e) => e.event).sort(), ['pr_impact.new_dependency', 'pr_impact.new_dependency', 'pr_impact.ready', 'pr_impact.service_changed'])
  assert.deepEqual(w.github.writes(), [], 'the recipe never writes to GitHub itself')
})

test('a second push changes only what changed, and there is still exactly one comment (edited in place)', async () => {
  const w = world()
  const client = createGithubClient({ fetch: w.github.fetch, installationId: '42', token: async () => 't' })
  const one = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, trigger: prTrigger(), now: () => NOW })
  const first = await recipe.run(one.ctx)
  const posted = await performWrite(client, { ...first.writes[0], body: { ...first.writes[0].body, slateUrl: 'https://app.slatebox.com/canvas/abc' } })
  assert.equal(posted.created, true)
  w.github.commit(REPO, { branch: 'refunds', changes: { 'packages/refunds/src/audit.ts': "import { listEntries } from '@acme/ledger'\nexport const audit = () => listEntries()\n" }, message: 'Audit refunds' })
  const two = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, trigger: prTrigger('synchronize'), now: () => NOW + 120000 })
  const second = await recipe.run(two.ctx)
  assert.deepEqual(second.desired.slates[0].graph.nodes.map((n) => n.key), first.desired.slates[0].graph.nodes.map((n) => n.key), 'the same notes: reviewer notes on the slate are the runtime\'s to keep')
  const edited = await performWrite(client, second.writes[0])
  assert.equal(edited.ref, posted.ref, 'the same comment')
  const comments = w.github.repos.get(REPO).comments.get(482)
  assert.equal(comments.length, 1)
  assert.match(comments[0].body, /<!-- slatebox:pr-impact:inst-1 -->$/)
  assert.ok(!comments[0].body.includes('Open in Slatebox'), 'the second write named no slate address')
  const same = await performWrite(client, second.writes[0])
  assert.equal(same.unchanged, true, 'the same words are not written again')
})

test('the same head is not drawn again; a merge moves the slate to Merged, a close sets it to go in 14 days', async () => {
  const w = world()
  const one = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, trigger: prTrigger(), now: () => NOW })
  await recipe.run(one.ctx)
  const again = await recipe.run(createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, trigger: prTrigger('reopened'), now: () => NOW }).ctx)
  assert.deepEqual(again.desired.slates, [])
  w.github.closePull(REPO, 482, { merged: true })
  const merged = await recipe.run(createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, trigger: prTrigger('closed'), now: () => NOW }).ctx)
  assert.deepEqual(merged.desired.slates[0].folder, ['Pull requests', 'Merged'])
  assert.equal(merged.desired.slates[0].retention, undefined)
  assert.deepEqual(merged.writes, [])

  const v = world()
  await recipe.run(createTestContext({ github: v.github, config: CONFIG, ledger: v.ledger, trigger: prTrigger(), now: () => NOW }).ctx)
  v.github.closePull(REPO, 482, { merged: false })
  const closed = await recipe.run(createTestContext({ github: v.github, config: CONFIG, ledger: v.ledger, trigger: prTrigger('closed'), now: () => NOW }).ctx)
  assert.deepEqual(closed.desired.slates[0].folder, ['Pull requests'])
  assert.deepEqual(closed.desired.slates[0].retention, { deleteAfter: new Date(NOW + 14 * 86400000).toISOString(), unlessTouched: true })
})

test('the skip label, a draft and a small pull request give no slate and no comment', async () => {
  for (const change of ['label', 'draft', 'small']) {
    const w = world()
    const pr = w.github.repos.get(REPO).pulls.get(482)
    if (change === 'label') pr.labels = [{ name: 'no-slatebox' }]
    if (change === 'draft') pr.draft = true
    if (change === 'small') {
      w.github.repos.get(REPO).branches.set('tiny', w.github.repos.get(REPO).branches.get('main'))
      w.github.commit(REPO, { branch: 'tiny', changes: { 'packages/api/src/index.ts': `${FILES['packages/api/src/index.ts']}// tidy\n` } })
      w.github.openPull(REPO, { number: 483, title: 'Tidy', head: 'tiny' })
    }
    const trigger = change === 'small' ? { ...prTrigger(), number: 483 } : prTrigger()
    const { ctx, log } = createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, trigger, now: () => NOW })
    const out = await recipe.run(ctx)
    assert.deepEqual([out.desired.slates, out.writes], [[], []], change)
    assert.ok(log.some((l) => l.code.startsWith('skipped_')), change)
  }
})

test('with the model off the slate is the same without a summary; mode slate proposes no comment', async () => {
  const w = world()
  const { ctx, aiCalls } = createTestContext({ github: w.github, config: { ...CONFIG, summary: false, mode: 'slate' }, ledger: w.ledger, trigger: prTrigger(), ai: summarize, now: () => NOW })
  const out = await recipe.run(ctx)
  assert.equal(aiCalls.length, 0)
  assert.equal(out.desired.slates[0].notes.find((n) => n.key === 'summary').text, 'Changes shown on the diagram.')
  assert.deepEqual(out.writes, [])
  assert.deepEqual(kinds(out.desired.slates[0]), { refunds: 'added', api: 'changed', ledger: 'changed', worker: 'depends on a change' })
})

test('manual runs name a pull request; one outside the configured repositories is ignored', async () => {
  const w = world()
  const out = await recipe.run(createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, trigger: { kind: 'manual', input: { repo: REPO, number: 482 } }, now: () => NOW }).ctx)
  assert.equal(out.desired.slates.length, 1)
  const other = await recipe.run(createTestContext({ github: w.github, config: CONFIG, ledger: w.ledger, trigger: { kind: 'manual', input: { repo: 'acme/other', number: 1 } }, now: () => NOW }).ctx)
  assert.deepEqual(other.desired.slates, [])
})
