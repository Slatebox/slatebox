// The Slack, Google and webhook recipes run through the real recipes runtime (queue, runner,
// reconcile, boards, suggestions; scripts/fakes/recipe-world.mjs), with the real Slack and Google
// sessions over fake vendor APIs: what each recipe asks for lands as real notes and boards, a rerun
// with nothing new is zero operations, a person's move on a board stays theirs, and the same post to
// the webhook twice changes nothing.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-slack-google-runtime.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import S1 from '../enterprise/recipes/slack-decision-log/index.mjs'
import W1 from '../enterprise/recipes/google-sheet-board/index.mjs'
import X1 from '../enterprise/recipes/webhook-render/index.mjs'
import { CHANNEL, MESSAGES, TEAM, tsAt } from '../enterprise/recipes/_slack-ledger/fixtures/checkout.mjs'
import { createRecipeWorld } from './fakes/recipe-world.mjs'
import { slackWorld } from './fakes/slack-recipe-world.mjs'
import { googleWorld, roster } from './fakes/google-recipe-world.mjs'

// The runtime's slateMap is keyed role/key.
const slateOf = async (w, instanceId, role) => Object.entries((await w.store.instances.findOne({ _id: instanceId })).slateMap).find(([k]) => k === role || k.startsWith(role + '/'))?.[1]

test('the decision log through the runtime: its board, lanes and cards; a rerun is zero operations; a person\'s move stays', async () => {
  const sw = slackWorld()
  sw.addInstance('probe', 'slack-decision-log', { channels: [CHANNEL.id] })
  await sw.deliver(MESSAGES)
  const w = createRecipeWorld({ recipes: [S1], vendors: { slack: () => sw.vendor.session({ _id: 'probe', ownerId: 'owner1', match: {} }) } })
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'Checkout' })
  const ana = w.person('ana')
  const { recipe } = await w.service.create(ana, drive, { recipeId: 'slack-decision-log', config: { channels: [CHANNEL.id], teamId: TEAM } })
  assert.deepEqual(recipe.triggers.map((t) => t.kind), ['vendor', 'schedule'])
  const made = await w.store.instances.findOne({ _id: recipe.instanceId })
  assert.deepEqual(made.match, { slack: { teamId: TEAM, channels: [CHANNEL.id] } }, 'Slack events find it by workspace and channel')
  await w.service.activate(ana, recipe.instanceId)
  const [first] = await w.drain()
  assert.equal(first.state, 'partial', 'the world\'s model refuses: the deterministic read, marked partial')
  const slateId = await slateOf(w, recipe.instanceId, 'decisions')
  assert.equal(w.projects.slates.get(slateId).projectId, drive)
  const board = w.slates.boards.get(`${slateId}:board:log`)
  assert.equal(board.component, 'team-board')
  const lane = (id) => board.lanes.find((l) => l.id === id).label
  assert.deepEqual(board.lanes.map((l) => l.label), ['Maybe', 'Decided', 'Revisited', 'Reversed'])
  assert.deepEqual(board.cards.map((c) => lane(c.laneId)).sort(), ['Decided', 'Decided', 'Decided', 'Reversed'])

  w.advance(60_000)
  await w.service.runNow(ana, recipe.instanceId)
  const [again] = await w.drain()
  assert.equal(again.result.stats.ops, 0, 'nothing new: no operations')

  // A person moves the Datadog card to Maybe; then the thread is revisited in Slack.
  const datadog = board.cards.find((c) => /Datadog/.test(c.label))
  const maybe = board.lanes.find((l) => l.label === 'Maybe')
  w.slates.personMoveCard(slateId, 'board:log', datadog.id, maybe.id)
  const thread = MESSAGES.find((m) => /Going with Datadog/.test(m.text)).ts
  await sw.deliver([{ ts: tsAt(20000), threadTs: thread, user: 'U0RAJ', text: "Let's revisit Datadog, the bill doubled" }])
  w.advance(60_000)
  await w.service.runNow(ana, recipe.instanceId)
  await w.drain()
  const after = w.slates.boards.get(`${slateId}:board:log`)
  assert.equal(after.cards.find((c) => c.id === datadog.id).laneId, maybe.id, 'the person\'s move stays: the agent never moves that card again')
})

test('the sheet board through the runtime: the org chart as notes; one changed cell is one updated note', async () => {
  const rows = roster()
  const SHEET = 'sheet0123456789abc'
  const gw = googleWorld({ files: { [SHEET]: { name: 'Team roster', mimeType: 'application/vnd.google-apps.spreadsheet', version: 1, tabs: { People: rows } } } })
  const w = createRecipeWorld({ recipes: [W1], vendors: { google: () => gw.vendor.session({ _id: 'probe', ownerId: 'owner1' }) } })
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'People' })
  const ana = w.person('ana')
  const { recipe } = await w.service.create(ana, drive, { recipeId: 'google-sheet-board', config: { fileId: SHEET, tab: 'People', template: 'org-chart' } })
  assert.deepEqual((await w.store.instances.findOne({ _id: recipe.instanceId })).match, { google: { fileIds: [SHEET] } })
  await w.service.activate(ana, recipe.instanceId)
  const [first] = await w.drain()
  assert.equal(first.state, 'done')
  const slateId = await slateOf(w, recipe.instanceId, 'board')
  w.slates.keepAll(slateId)
  const notes = w.slates.notesOf(slateId)
  assert.ok(notes.some((n) => n.text === 'Mara Chen\nCEO'))
  assert.ok(notes.length >= 30)
  // The kept first run is seen on the next run; then the owner opts into applying updates directly.
  w.advance(60_000)
  await w.service.runNow(ana, recipe.instanceId)
  await w.drain()
  await w.service.update(ana, recipe.instanceId, { applyMode: 'auto' })
  rows[5][1] = 'Senior Manager'
  w.advance(60_000)
  await w.service.runNow(ana, recipe.instanceId)
  const [second] = await w.drain()
  assert.equal(second.result.stats.updated, 1)
  assert.equal(second.result.stats.added, 0)
  assert.ok(w.slates.notesOf(slateId).some((n) => /Senior Manager/.test(n.text)))
})

test('the webhook through the runtime: posted data becomes notes; the same post twice changes nothing; a bad payload is refused before a run', async () => {
  const w = createRecipeWorld({ recipes: [X1] })
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'Platform' })
  const ana = w.person('ana')
  const { recipe } = await w.service.create(ana, drive, { recipeId: 'webhook-render', config: { name: 'CI dependencies' } })
  await w.service.activate(ana, recipe.instanceId)
  await w.drain()
  const graph = (keys) => ({ key: 'deps', graph: { nodes: keys.map((key) => ({ key, label: key })), edges: keys.slice(1).map((key, i) => ({ from: keys[i], to: key })) } })
  w.advance(60_000)
  await w.service.runNow(ana, recipe.instanceId, { data: graph(['web', 'api', 'db']) })
  const [posted] = await w.drain()
  assert.ok(['done', 'partial'].includes(posted.state), posted.state)
  const slateId = await slateOf(w, recipe.instanceId, 'render')
  w.slates.keepAll(slateId)
  assert.deepEqual(w.slates.notesOf(slateId).map((n) => n.text).filter((t) => ['web', 'api', 'db'].includes(t)).sort(), ['api', 'db', 'web'])
  w.advance(60_000)
  await w.service.runNow(ana, recipe.instanceId, { data: graph(['web', 'api', 'db']) })
  const [same] = await w.drain()
  assert.equal(same.result.stats.ops, 0, 'the same post: no operations')
  await assert.rejects(w.service.runNow(ana, recipe.instanceId, { data: { graph: { nodes: [{ key: 'a', label: 7 }] } } }), { code: 'bad_payload' })
})
