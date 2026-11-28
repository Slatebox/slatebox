// X2, the project index (enterprise/recipes/project-index): after each change the index lists exactly
// the project's slates (never itself), newest first, a frame per folder, with which recipe keeps each
// and the ones gone stale; 0 tokens, 0 vendor calls.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-project-index.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import X2 from '../enterprise/recipes/project-index/index.mjs'
import { fakeAi, recipeContext } from './fakes/recipe-lite-context.mjs'

const NOW = Date.parse('2026-11-27T18:00:00Z')
const slate = (_id, name, daysAgo, projectId = 'proj1') => ({ _id, shareId: 's' + _id, name, userId: 'u1', projectId, lastSaved: new Date(NOW - daysAgo * 86400000), url: `https://app.slatebox.com/canvas/s${_id}` })

function project(slates) {
  return {
    listSlates: async () => slates,
    recipes: async () => [{ id: 'x2', name: 'Project index', agentName: 'Project librarian', slateMap: { 'index:index': 'idx' } }, { id: 's1', name: 'Decision log', agentName: 'Decision keeper', slateMap: { 'decisions:C0CHECKOUT1': 'a' } }],
    folders: async () => [{ _id: 'f1', name: 'Pull requests' }],
  }
}

test('exactly the project\'s slates, newest first, by folder, with their keepers; never the index itself', async () => {
  const slates = [slate('a', 'Decision log — #proj-checkout', 0), slate('b', 'Roadmap', 2), slate('c', 'PR 42', 1, 'f1'), slate('idx', 'Project index', 0), slate('d', 'Old notes', 45)]
  const ai = fakeAi()
  const { ctx } = recipeContext({ instance: { _id: 'x2', config: {}, projectId: 'proj1' }, ai, project: project(slates), now: NOW })
  const run = await X2.run(ctx)
  const [index] = run.desired.slates
  assert.equal(index.name, 'Project index')
  assert.deepEqual(index.graph.nodes.map((n) => n.text), [
    'Decision log — #proj-checkout · changed Nov 27 · kept by Decision keeper',
    'PR 42 · changed Nov 26',
    'Roadmap · changed Nov 25',
    'Old notes · changed Oct 13 · not changed in 45 days',
  ])
  assert.ok(index.graph.nodes.every((n) => n.link.startsWith('https://app.slatebox.com/canvas/')))
  assert.deepEqual(index.graph.frames.map((f) => [f.text, f.members.length]), [['In this project', 3], ['Pull requests', 1]])
  assert.equal(ai.calls.length, 0)
  // A slate added and one removed: the index follows exactly.
  const changed = [...slates.filter((s) => s._id !== 'b'), slate('e', 'Launch plan', 0)]
  const next = await X2.run(recipeContext({ instance: { _id: 'x2', config: {}, projectId: 'proj1' }, project: project(changed), now: NOW }).ctx)
  assert.deepEqual(next.desired.slates[0].graph.nodes.map((n) => n.key).sort(), ['slate:a', 'slate:c', 'slate:d', 'slate:e'])
})
