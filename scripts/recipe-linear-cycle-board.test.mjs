// LIN-L2 Cycle board from Linear, through the real recipes runtime with the real Linear vendor over
// a faked Linear GraphQL: a 30-issue cycle splits by assignee onto 2 boards; blocked issues are
// amber notes with lines from their blockers (another team's framed, a done one grey); the scope note
// says "+3"; a state change in Linear moves exactly one card; a person's move becomes one status
// change in Linear only under the permission (else an approval card); a new cycle is a new slate and
// the old one is left as it was.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-linear-cycle-board.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import L2 from '../enterprise/recipes/linear-cycle-board/index.mjs'
import { validateManifest } from '../enterprise/common/recipes/manifest.mjs'
import { createVendor } from '../enterprise/server/recipes/vendors/linear/index.mjs'
import { firstStateOf, cycleLaneOf } from '../enterprise/recipes/_linear/workgraph.mjs'
import { cycleName, packByAssignee } from '../enterprise/recipes/linear-cycle-board/render.mjs'
import { CYCLE, CYCLE_ISSUES, ORG, STATES, STATE_IDS, TEAMS, NOW } from '../enterprise/recipes/_linear/fixtures/acme.mjs'
import { fakeLinear } from './fakes/linear-api.mjs'
import { createRecipeWorld } from './fakes/recipe-world.mjs'

const ENG = TEAMS.ENG.id

function setup({ issues = structuredClone(CYCLE_ISSUES), cycle = structuredClone(CYCLE) } = {}) {
  const box = { issues, cycle }
  const fake = fakeLinear({ get cycleIssues() { return box.issues }, get cycle() { return box.cycle } })
  const vendor = createVendor({ accountOf: async () => ({ status: 'active', organizationId: ORG }), tokenFor: async () => 'tok', fetch: fake.fetch, deliveries: { claim: async () => true }, later: (fn) => fn() })
  const w = createRecipeWorld({ recipes: [L2], realVendors: { linear: vendor }, now: NOW })
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'Engineering' })
  const ana = w.person('ana')
  let id = null
  const start = async (config = {}) => {
    const { recipe } = await w.service.create(ana, drive, { recipeId: 'linear-cycle-board', config: { teams: [ENG], ...config } })
    id = recipe.instanceId
    await w.service.activate(ana, id)
    return (await w.drain())[0]
  }
  const again = async () => {
    w.advance(60_000)
    await w.service.runNow(ana, id)
    return (await w.drain())[0]
  }
  const slateMap = async () => (await w.store.instances.findOne({ _id: id })).slateMap
  return { w, fake, box, ana, start, again, slateMap, id: () => id }
}
const boardsOf = (w, slateId) => [...w.slates.boards.entries()].filter(([k]) => k.startsWith(`${slateId}:`)).map(([k, b]) => ({ key: k.slice(slateId.length + 1), ...b }))
const laneOf = (board, card) => board.lanes.find((l) => l.id === card.laneId)?.label

test('the manifest is valid and offers one write: an issue\'s status, scoped to teams', () => {
  assert.equal(validateManifest(L2.manifest), null)
  assert.deepEqual(L2.manifest.writes.map((w) => w.kind), ['linear.update_item'])
  assert.match(L2.manifest.writes[0].describe({ teams: [ENG] }), /never any other field/)
})

test('lanes from Linear\'s status types; write-back moves to the first status of a lane', () => {
  assert.equal(cycleLaneOf('backlog'), 'todo')
  assert.equal(cycleLaneOf('triage'), 'todo')
  assert.equal(cycleLaneOf('started'), 'started')
  assert.equal(firstStateOf(STATES, 'started').name, 'In Progress', 'the lowest position of the lane\'s types')
  assert.equal(firstStateOf(STATES, 'todo').name, 'Todo', 'To do is Todo (unstarted), not Backlog')
  const withTriage = [{ id: 'tr', name: 'Triage', type: 'triage', position: -1 }, ...STATES]
  assert.equal(firstStateOf(withTriage, 'todo').name, 'Todo', 'never the Triage inbox')
  assert.equal(firstStateOf(STATES.filter((x) => x.type !== 'unstarted'), 'todo').name, 'Backlog', 'Backlog only when the team has no unstarted status')
  const packed = packByAssignee(CYCLE_ISSUES.map((i) => ({ ...i, assignee: i.assignee.name })))
  assert.deepEqual(packed.map((b) => b.issues.length), [20, 10])
  assert.deepEqual(packed.map((b) => b.people), [['Ana', 'Ben', 'Cy', 'Dee'], ['Eli', 'Fay']])
})

test('a 30-issue cycle: 2 boards split by assignee, 3 blocked amber notes (2 by another team), a done blocker grey, scope +3', async () => {
  const s = setup()
  const first = await s.start()
  assert.equal(first.state, 'done', JSON.stringify(first.run?.log))
  const map = await s.slateMap()
  assert.ok(map['cycle/ENG-48'], 'one slate for the cycle, keyed by team and number')
  const slateId = map['cycle/ENG-48']
  const slate = s.w.projects.slates.get(slateId)
  assert.equal(slate.name, 'ENG cycle 48 (Nov 24 – Dec 7)')
  const boards = boardsOf(s.w, slateId)
  assert.deepEqual(boards.map((b) => [b.title, b.cards.length]).sort(), [['Ana, Ben, Cy, Dee', 20], ['Eli, Fay', 10]])
  for (const b of boards) assert.deepEqual(b.lanes.map((l) => l.label), ['To do', 'In progress', 'Done', 'Canceled'])
  const all = boards.flatMap((b) => b.cards.map((c) => ({ label: c.label, lane: laneOf(b, c) })))
  assert.ok(all.some((c) => c.label === 'ENG-200 Cycle task 1 · Ana · 1 pt · blocked' && c.lane === 'To do'))
  assert.equal(all.filter((c) => c.label.endsWith('· blocked')).length, 3)

  s.w.slates.keepAll(slateId)
  const notes = s.w.slates.notesOf(slateId)
  const nodes = s.w.projects.slates.get(slateId).nodes
  const colorOf = (prefix) => nodes.find((n) => String(n.options.text).startsWith(prefix))?.options.backgroundColor
  assert.equal(colorOf('ENG-200'), '#ffe8a3', 'blocked: amber')
  assert.equal(colorOf('ENG-201'), '#ffe8a3')
  assert.equal(colorOf('ENG-202'), '#ffe8a3')
  assert.equal(colorOf('ENG-150'), '#dee2e6', 'a blocker already done: grey')
  assert.ok(notes.some((n) => n.text === 'PAY (another team)'), 'another team\'s blockers in their frame')
  assert.ok(notes.some((n) => n.text === 'Scope: 27 issues planned at the start, +3 added after it started.'))
  assert.equal(s.fake.mutations.length, 0)
  assert.equal(s.fake.calls.length, 1, 'one Linear call for a 30-issue cycle')
})

test('a status change in Linear moves exactly one card', async () => {
  const s = setup()
  await s.start()
  const slateId = (await s.slateMap())['cycle/ENG-48']
  const before = structuredClone(boardsOf(s.w, slateId))
  const done = STATES.find((x) => x.type === 'completed')
  s.box.issues[7].state = { id: done.id, type: 'completed', name: 'Done' }
  const out = await s.again()
  assert.equal(out.state, 'done')
  const moved = []
  for (const b of boardsOf(s.w, slateId)) for (const c of b.cards) {
    const was = before.find((x) => x.key === b.key).cards.find((x) => x.id === c.id)
    if (was.laneId !== c.laneId || was.label !== c.label) moved.push([c.label, laneOf(b, c)])
  }
  assert.deepEqual(moved, [['ENG-207 Cycle task 8 · Ben · 2 pts', 'Done']])
})

test('a person\'s move waits as an approval card without the permission, and is made once with it, for that issue only', async () => {
  const s = setup()
  await s.start()
  const slateId = (await s.slateMap())['cycle/ENG-48']
  const board = boardsOf(s.w, slateId).find((b) => b.title === 'Ana, Ben, Cy, Dee')
  const card = board.cards.find((c) => c.label.startsWith('ENG-206'))
  const doneLane = board.lanes.find((l) => l.label === 'Done')
  s.w.slates.personMoveCard(slateId, board.key, card.id, doneLane.id)
  const first = await s.again()
  assert.deepEqual(first.result.writes.map((w) => w.state), ['card'], 'no permission: one approval card')
  assert.equal(s.fake.mutations.length, 0)
  const kept = boardsOf(s.w, slateId).find((b) => b.key === board.key).cards.find((c) => c.id === card.id)
  assert.equal(kept.laneId, doneLane.id, 'the card stays where the person put it')

  await s.w.service.grant(s.ana, s.id(), { kind: 'linear.update_item', scope: { teams: [ENG], fields: ['state'] } })
  const second = await s.again()
  assert.deepEqual(second.result.writes.map((w) => w.state), ['done'])
  assert.equal(s.fake.mutations.length, 1)
  assert.deepEqual(s.fake.mutations[0], { op: 'UpdateIssueState', variables: { id: CYCLE_ISSUES[6].id, stateId: STATE_IDS.Done } })
})

test('a permission names Linear teams by their ids; anything else is refused', async () => {
  const s = setup()
  await s.start()
  await assert.rejects(s.w.service.grant(s.ana, s.id(), { kind: 'linear.update_item', scope: { teams: ['not-an-id!'] } }))
})

test('a new cycle is a new slate; the closed cycle\'s slate is left as it was', async () => {
  const s = setup()
  await s.start()
  const oldId = (await s.slateMap())['cycle/ENG-48']
  const oldBoards = JSON.stringify(boardsOf(s.w, oldId))
  s.box.cycle = { ...CYCLE, id: '00000000-0000-4000-8000-000000000041', number: 49, startsAt: '2026-12-08T00:00:00.000Z', endsAt: '2026-12-21T23:59:59.000Z' }
  s.box.issues = CYCLE_ISSUES.slice(0, 10).map((i) => ({ ...structuredClone(i), addedToCycleAt: '2026-12-07T10:00:00.000Z' }))
  const out = await s.again()
  assert.equal(out.state, 'done')
  const map = await s.slateMap()
  assert.ok(map['cycle/ENG-49'])
  assert.equal(s.w.projects.slates.get(map['cycle/ENG-49']).name, 'ENG cycle 49 (Dec 8 – Dec 21)')
  assert.equal(JSON.stringify(boardsOf(s.w, oldId)), oldBoards, 'the old cycle is history: untouched')
  assert.deepEqual(boardsOf(s.w, map['cycle/ENG-49']).map((b) => b.cards.length), [10], 'ten issues: one board')
})

test('a team with no cycle running makes no slate and says so', async () => {
  const s = setup({ cycle: null })
  const first = await s.start()
  assert.equal(first.state, 'done')
  assert.ok(!(await s.slateMap())?.['cycle/ENG-48'])
  assert.ok(first.run.log.some((l) => l.code === 'no_cycle'))
})

const cardOf = (s, slateId, prefix) => {
  for (const b of boardsOf(s.w, slateId)) {
    const card = b.cards.find((c) => c.label.startsWith(prefix))
    if (card) return { board: b, card }
  }
  return null
}
const setState = (s, n, name) => {
  const st = STATES.find((x) => x.name === name)
  s.box.issues[n].state = { id: st.id, type: st.type, name: st.name }
}

test('a card a person renamed and moved: once Linear moves the issue again, the move is never pushed back over it', async () => {
  const s = setup()
  await s.start()
  await s.w.service.grant(s.ana, s.id(), { kind: 'linear.update_item', scope: { teams: [ENG], fields: ['state'] } })
  const slateId = (await s.slateMap())['cycle/ENG-48']
  const { board, card } = cardOf(s, slateId, 'ENG-206')
  s.w.slates.personRenameCard(slateId, board.key, card.id, 'ENG-206 refunds (my words)')
  s.w.slates.personMoveCard(slateId, board.key, card.id, board.lanes.find((l) => l.label === 'Done').id)
  const made = await s.again()
  assert.deepEqual(made.result.writes.map((w) => w.state), ['done'])
  assert.equal(s.fake.mutations.length, 1)
  setState(s, 6, 'Done') // Linear did as asked
  await s.again()
  setState(s, 6, 'In Progress') // a teammate reopens it in Linear
  for (let n = 0; n < 3; n += 1) {
    const out = await s.again()
    assert.equal(out.state, 'done')
    assert.deepEqual(out.result.writes, [], `run ${n + 1} after the reopen: no write`)
  }
  assert.equal(s.fake.mutations.length, 1, 'Linear wins: the reopen stays')
})

test('a waiting approval card is retired when Linear moves the issue, so approving it later changes nothing', async () => {
  const s = setup()
  await s.start()
  const slateId = (await s.slateMap())['cycle/ENG-48']
  const { board, card } = cardOf(s, slateId, 'ENG-206')
  s.w.slates.personMoveCard(slateId, board.key, card.id, board.lanes.find((l) => l.label === 'Done').id)
  const waiting = await s.again()
  const cardId = waiting.result.writes[0].cardId
  assert.equal((await s.w.store.cards.findOne({ _id: cardId })).state, 'waiting')
  setState(s, 6, 'In Progress') // a teammate moves it in Linear meanwhile
  const out = await s.again()
  assert.deepEqual(out.result.writes, [])
  assert.equal((await s.w.store.cards.findOne({ _id: cardId })).state, 'superseded')
  await assert.rejects(s.w.service.decideWrite(s.ana, cardId, 'approve'), { code: 'already_decided' })
  assert.equal(s.fake.mutations.length, 0)
})

test('an issue taken out of the cycle and put back is not counted as removed', async () => {
  const s = setup()
  await s.start()
  const slateId = (await s.slateMap())['cycle/ENG-48']
  const out = s.box.issues.splice(7, 1)[0]
  await s.again()
  const cursor = async () => (await s.w.store.instances.findOne({ _id: s.id() })).cursor.cycles['ENG-48']
  assert.deepEqual((await cursor()).removed, ['ENG-207'])
  s.box.issues.splice(7, 0, out)
  await s.again()
  assert.deepEqual((await cursor()).removed, [], 'back in the cycle: not removed')
  s.w.slates.keepAll(slateId)
  const scope = s.w.slates.notesOf(slateId).find((n) => String(n.text).startsWith('Scope:'))
  assert.ok(!/removed/.test(scope.text), scope.text)
})

test('a 25th issue never moves the first 24 cards (or a person\'s move on them) to another board', async () => {
  const s = setup({ issues: structuredClone(CYCLE_ISSUES).slice(0, 24) })
  await s.start()
  const slateId = (await s.slateMap())['cycle/ENG-48']
  const [only] = boardsOf(s.w, slateId)
  assert.equal(only.cards.length, 24)
  const ids = only.cards.map((c) => c.id).sort()
  const { card } = cardOf(s, slateId, 'ENG-206')
  const done = only.lanes.find((l) => l.label === 'Done').id
  s.w.slates.personMoveCard(slateId, only.key, card.id, done)
  await s.again()
  s.box.issues = structuredClone(CYCLE_ISSUES)
  const out = await s.again()
  assert.equal(out.state, 'done')
  const after = boardsOf(s.w, slateId)
  const same = after.find((b) => b.key === only.key)
  assert.deepEqual(same.cards.map((c) => c.id).sort(), ids, 'the 24 stay on their board')
  assert.equal(same.cards.find((c) => c.id === card.id).laneId, done, 'the person\'s move stays')
  assert.deepEqual(after.filter((b) => b.key !== only.key).map((b) => b.cards.length), [6])
  assert.equal(out.result.writes.length, 1, 'one proposal for the moved card, no copy elsewhere')
})

test('cycle dates are the team\'s days (Linear\'s team time zone), not UTC\'s', () => {
  const tokyo = { key: 'ENG', timezone: 'Asia/Tokyo' }
  const cycle = { number: 48, startsAt: '2026-11-22T15:00:00.000Z', endsAt: '2026-12-06T15:00:00.000Z' }
  assert.equal(cycleName(tokyo, cycle, NOW), 'ENG cycle 48 (Nov 23 – Dec 7)', 'Monday 00:00 JST is Monday')
  assert.equal(cycleName({ key: 'ENG' }, cycle, NOW), 'ENG cycle 48 (Nov 22 – Dec 6)', 'no zone: UTC')
  assert.equal(cycleName({ key: 'ENG', timezone: 'Not/AZone' }, cycle, NOW), 'ENG cycle 48 (Nov 22 – Dec 6)', 'an unknown zone: UTC')
})
