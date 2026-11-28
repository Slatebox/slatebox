// LIN-L1 Live roadmap from Linear, through the real recipes runtime (queue, runner, reconcile,
// boards; scripts/fakes/recipe-world.mjs) with the real Linear vendor over a faked Linear GraphQL
// (scripts/fakes/linear-api.mjs): the boards, lanes and cards; the dependency map's edges and counts;
// the health cards; a 9-day slip changes one card and nothing else; a person's move stays until
// Linear changes that project again; a person's sticky survives; no write ever reaches Linear.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-linear-roadmap.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import L1 from '../enterprise/recipes/linear-roadmap/index.mjs'
import { validateManifest } from '../enterprise/common/recipes/manifest.mjs'
import { createVendor } from '../enterprise/server/recipes/vendors/linear/index.mjs'
import { roadmapLane, quarterOf, collapseBlockers, todayIso } from '../enterprise/recipes/_linear/workgraph.mjs'
import { ORG, P, PROJECTS, TEAMS, NOW } from '../enterprise/recipes/_linear/fixtures/acme.mjs'
import { projectOf } from '../enterprise/server/recipes/vendors/linear/session.mjs'
import { fakeLinear } from './fakes/linear-api.mjs'
import { createRecipeWorld } from './fakes/recipe-world.mjs'

const slateOf = async (w, instanceId, role) => (await w.store.instances.findOne({ _id: instanceId })).slateMap[role]
const ALL_TEAMS = Object.values(TEAMS).map((t) => t.id)

function setup({ config = {}, fakeOpts = {}, ai = [] } = {}) {
  const projects = structuredClone(PROJECTS)
  const fake = fakeLinear({ projects, ...fakeOpts })
  const vendor = createVendor({ accountOf: async () => ({ status: 'active', organizationId: ORG }), tokenFor: async () => 'tok', fetch: fake.fetch, deliveries: { claim: async () => true }, later: (fn) => fn() })
  const w = createRecipeWorld({ recipes: [L1], realVendors: { linear: vendor }, now: NOW, ai })
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'Acme roadmap' })
  const ana = w.person('ana')
  const start = async () => {
    const { recipe } = await w.service.create(ana, drive, { recipeId: 'linear-roadmap', config: { teams: ALL_TEAMS, ...config } })
    await w.service.activate(ana, recipe.instanceId)
    const [first] = await w.drain()
    return { recipe, first }
  }
  const again = async () => {
    w.advance(60_000)
    const instanceId = (await w.store.instances.find({}).toArray())[0]._id
    await w.service.runNow(ana, instanceId)
    const [out] = await w.drain()
    return out
  }
  return { w, fake, projects, ana, start, again }
}
const boardsOf = (w, slateId) => [...w.slates.boards.entries()].filter(([k]) => k.startsWith(`${slateId}:`)).map(([k, b]) => ({ key: k.slice(slateId.length + 1), ...b }))
const laneOf = (board, card) => board.lanes.find((l) => l.id === card.laneId)?.label

test('the manifest is valid, Linear-only, read-only and names its events', () => {
  assert.equal(validateManifest(L1.manifest), null)
  assert.equal(L1.manifest.integration, 'linear')
  assert.deepEqual(L1.manifest.writes, [])
  assert.deepEqual(L1.manifest.triggers.filter((t) => t.default).map((t) => t.event || t.kind), ['linear.project', 'schedule'])
})

test('lanes by target date against today, quarters as Linear\'s calendar has them', () => {
  const today = '2026-11-27'
  assert.equal(roadmapLane('2026-11-15', today), 'overdue')
  assert.equal(roadmapLane('2026-12-31', today), 'this-quarter')
  assert.equal(roadmapLane('2027-03-31', today), 'next-quarter')
  assert.equal(roadmapLane('2027-04-01', today), 'later')
  assert.equal(roadmapLane(null, today), 'no-date')
  assert.deepEqual(quarterOf('2026-11-27'), { year: 2026, q: 4, label: 'Q4 2026', start: '2026-10-01', end: '2026-12-31' })
})

test('the fixture workspace: a board per team, 9 projects in their lanes, 4 blocking edges with counts, 9 health cards', async () => {
  const s = setup()
  const { recipe, first } = await s.start()
  assert.equal(first.state, 'done', JSON.stringify(first.run?.log))
  const made = await s.w.store.instances.findOne({ _id: recipe.instanceId })
  assert.deepEqual(made.match, { linear: { organizationId: ORG, teams: ALL_TEAMS } }, 'Linear events find it by workspace and team')

  const roadmapId = await slateOf(s.w, recipe.instanceId, 'roadmap')
  const boards = boardsOf(s.w, roadmapId)
  assert.deepEqual(boards.map((b) => b.title).sort(), ['Engineering', 'Payments', 'Web'])
  for (const b of boards) assert.deepEqual(b.lanes.map((l) => l.label), ['Overdue', 'This quarter', 'Next quarter', 'Later', 'No target date'])
  const cards = boards.flatMap((b) => b.cards.map((c) => [c.label, laneOf(b, c)]))
  assert.equal(cards.length, 9)
  const lane = (name) => cards.find(([label]) => label.startsWith(name))[1]
  assert.equal(lane('Fraud rules'), 'Overdue')
  assert.equal(lane('Checkout v2'), 'This quarter')
  assert.equal(lane('Tax engine'), 'Next quarter')
  assert.equal(lane('Usage analytics'), 'Later')
  assert.equal(lane('Pricing page'), 'No target date')
  assert.ok(cards.some(([label]) => label === 'Checkout v2 · Dec 19 · at risk'))
  assert.ok(cards.some(([label]) => label === 'Ledger v3 · Dec 5 · off track'))
  assert.ok(cards.some(([label]) => label === 'Tax engine · Feb 15, 2027'), 'another year is named')

  const depsId = await slateOf(s.w, recipe.instanceId, 'dependencies')
  s.w.slates.keepAll(depsId)
  const depNotes = s.w.slates.notesOf(depsId)
  assert.ok(depNotes.some((n) => n.text === 'Checkout v2\nAt risk · target Dec 19'))
  const depsSlate = s.w.projects.slates.get(depsId)
  const lines = (depsSlate.nodes || []).flatMap((n) => (n.relationships?.associations || []).map((a) => a.label || ''))
  assert.deepEqual(lines.sort(), ['1 issue', '1 issue', '1 issue', '3 issues'])
  assert.equal(depNotes.filter((n) => ['Engineering', 'Payments', 'Web'].includes(n.text)).length, 3, 'a frame per team')

  const healthId = await slateOf(s.w, recipe.instanceId, 'health')
  s.w.slates.keepAll(healthId)
  const cardsOfHealth = s.w.slates.notesOf(healthId).filter((n) => /\n/.test(n.text) && !/^Each open project/.test(n.text))
  assert.equal(cardsOfHealth.length, 9)
  assert.ok(cardsOfHealth[0].text.startsWith('Ledger v3\nOff track'), 'worst health first')
  assert.ok(cardsOfHealth.some((n) => /^Ledger v3\nOff track · Updated 25 days ago · Stale update/.test(n.text)))
  assert.ok(cardsOfHealth.some((n) => /^Pricing page\nNo health yet · No update yet/.test(n.text)))
  assert.equal(s.fake.mutations.length, 0, 'it never writes to Linear')
  assert.ok(s.fake.calls.length <= 3, `first run reads in at most 3 calls (${s.fake.calls.length})`)
})

test('a Linear target date moved 9 days changes one card (same lane, "slipped +9d") and nothing else on the roadmap', async () => {
  const s = setup()
  const { recipe } = await s.start()
  const roadmapId = await slateOf(s.w, recipe.instanceId, 'roadmap')
  const before = structuredClone(boardsOf(s.w, roadmapId))
  const quiet = await s.again()
  assert.equal(quiet.result.stats.added + quiet.result.stats.updated + quiet.result.stats.removed, 0, 'nothing changed in Linear: no changes')

  s.projects.find((p) => p.id === P.p1).targetDate = '2026-12-28'
  const slip = await s.again()
  assert.equal(slip.state, 'done')
  const after = boardsOf(s.w, roadmapId)
  const changed = []
  for (const b of after) for (const c of b.cards) {
    const was = before.find((x) => x.key === b.key).cards.find((x) => x.id === c.id)
    if (!was || was.label !== c.label || was.laneId !== c.laneId) changed.push({ was, now: c, board: b })
  }
  assert.equal(changed.length, 1)
  assert.equal(changed[0].now.label, 'Checkout v2 · Dec 28 · at risk · slipped +9d')
  assert.equal(changed[0].now.laneId, changed[0].was.laneId, 'still this quarter')
  const events = (await s.w.store.runs.findOne({ _id: slip.run._id })) && slip.result.emitted
  assert.deepEqual(events.filter((e) => e.type === 'roadmap.slipped').map((e) => e.data), [{ project: P.p1, from: '2026-12-19', to: '2026-12-28', url: 'https://linear.app/acme/project/p1' }])
})

test('a person\'s lane stays until Linear changes that project; then Linear wins again. A person\'s sticky survives.', async () => {
  const s = setup()
  const { recipe } = await s.start()
  const roadmapId = await slateOf(s.w, recipe.instanceId, 'roadmap')
  const web = boardsOf(s.w, roadmapId).find((b) => b.title === 'Web')
  const card = web.cards.find((c) => c.label.startsWith('Checkout v2'))
  const later = web.lanes.find((l) => l.label === 'Later')
  s.w.slates.personMoveCard(roadmapId, web.key, card.id, later.id)
  s.w.slates.personEdit(roadmapId, [{ kind: 'add_nodes', count: 1, ids: ['sticky1'], shape: 'rectangle', text: 'CEO promised Jan 15', x: 2000, y: 2000 }])

  await s.again()
  const kept = boardsOf(s.w, roadmapId).find((b) => b.title === 'Web').cards.find((c) => c.id === card.id)
  assert.equal(kept.laneId, later.id, 'Linear did not change it: the person\'s lane stays')

  s.projects.find((p) => p.id === P.p1).targetDate = '2026-12-22'
  await s.again()
  const back = boardsOf(s.w, roadmapId).find((b) => b.title === 'Web')
  const moved = back.cards.find((c) => c.id === card.id)
  assert.equal(laneOf(back, moved), 'This quarter', 'Linear changed the date: the card follows Linear')
  assert.equal(moved.label, 'Checkout v2 · Dec 22 · at risk · slipped +3d')
  assert.ok(s.w.slates.notesOf(roadmapId).some((n) => n.text === 'CEO promised Jan 15'), 'the sticky is the person\'s')
})

test('a project canceled in Linear leaves the roadmap; a completed one too', async () => {
  const s = setup()
  const { recipe } = await s.start()
  const roadmapId = await slateOf(s.w, recipe.instanceId, 'roadmap')
  s.projects.find((p) => p.id === P.p9).status = { type: 'canceled', name: 'Canceled' }
  s.projects.find((p) => p.id === P.p6).status = { type: 'completed', name: 'Completed' }
  const out = await s.again()
  assert.equal(out.result.stats.removed, 2)
  const left = boardsOf(s.w, roadmapId).flatMap((b) => b.cards.map((c) => c.label))
  assert.equal(left.length, 7)
  assert.ok(!left.some((label) => /^(Usage analytics|Referral program)/.test(label)))
})

test('by initiative when Linear allows it; by team, said plainly, when it does not', async () => {
  const s = setup({ config: { groupBy: 'initiative' } })
  const { recipe } = await s.start()
  const titles = boardsOf(s.w, await slateOf(s.w, recipe.instanceId, 'roadmap')).map((b) => b.title).sort()
  assert.deepEqual(titles, ['Checkout 2027', 'Growth'])
  const t = setup({ config: { groupBy: 'initiative' }, fakeOpts: { noInitiatives: true } })
  const { recipe: r2, first } = await t.start()
  assert.deepEqual(boardsOf(t.w, await slateOf(t.w, r2.instanceId, 'roadmap')).map((b) => b.title).sort(), ['Engineering', 'Payments', 'Web'])
  assert.ok(first.run.log.some((l) => l.code === 'no_initiatives'))
})

test('the weekly summary: one agent call over update excerpts, at most once a week; off by default', async () => {
  const s = setup({ config: { summary: true }, ai: [{ summary: 'Checkout is at risk; ledger is off track.' }] })
  const { recipe } = await s.start()
  assert.equal(s.w.aiCalls.length, 1)
  assert.ok(JSON.stringify(s.w.aiCalls[0].prompt).length < 6000 * 4)
  const healthId = await slateOf(s.w, recipe.instanceId, 'health')
  s.w.slates.keepAll(healthId)
  assert.ok(s.w.slates.notesOf(healthId).some((n) => n.text === 'This week: Checkout is at risk; ledger is off track.'))
  await s.again()
  assert.equal(s.w.aiCalls.length, 1, 'the same week: no second call')
  const off = setup()
  await off.start()
  assert.equal(off.w.aiCalls.length, 0, '0 tokens by default')
})

test('blockers inside a project or onto a done issue are not edges; more than 24 projects in a team split into boards', () => {
  const edges = collapseBlockers([
    { fromProject: 'a', toProject: 'b', issue: 'X-1' }, { fromProject: 'a', toProject: 'b', issue: 'X-2' }, { fromProject: 'a', toProject: 'b', issue: 'X-2' },
    { fromProject: 'a', toProject: 'a', issue: 'X-3' }, { fromProject: 'a', toProject: 'c', issue: 'X-4', blockedDone: true }, { fromProject: 'a', toProject: 'z', issue: 'X-5' },
  ], ['a', 'b', 'c'])
  assert.deepEqual(edges, [{ from: 'a', to: 'b', count: 2, issues: ['X-1', 'X-2'] }])
})

test('more than 24 open projects in one team are split into boards of 24', async () => {
  const many = Array.from({ length: 30 }, (_, n) => ({ ...structuredClone(PROJECTS[0]), id: `00000000-0000-4000-8000-0000000${String(300 + n).padStart(5, '0')}`, name: `Project ${n + 1}` }))
  const s = setup({ fakeOpts: { projects: many, blockers: [] } })
  const { recipe } = await s.start()
  const boards = boardsOf(s.w, await slateOf(s.w, recipe.instanceId, 'roadmap'))
  assert.deepEqual(boards.map((b) => [b.title, b.cards.length]).sort(), [['Web (1)', 24], ['Web (2)', 6]])
})

const many = (n, { from = 0, status = 'started', target = (k) => `2027-0${1 + (k % 9)}-15` } = {}) => Array.from({ length: n }, (_, k) => ({ ...structuredClone(PROJECTS[0]), id: `00000000-0000-4000-8000-0000000${String(300 + from + k).padStart(5, '0')}`, name: `Project ${from + k + 1}`, targetDate: target(k), state: status, status: { type: status, name: status } }))

test('closed projects are never fetched, so they never push open ones past the 200 cap', async () => {
  const projects = [...many(180, { status: 'completed' }), ...many(40, { from: 180 })]
  const s = setup({ fakeOpts: { projects, blockers: [], pageSize: 50 } })
  const { recipe, first } = await s.start()
  assert.equal(first.state, 'done')
  assert.ok(!first.run.log.some((l) => l.code === 'many_projects'))
  const cards = boardsOf(s.w, await slateOf(s.w, recipe.instanceId, 'roadmap')).flatMap((b) => b.cards)
  assert.equal(cards.length, 40, 'every open project drawn')
  assert.ok(s.fake.calls.filter((c) => c.op === 'Projects').length <= 1, 'one page: the 180 closed ones are not read')
})

test('a 25th project sorting in first never moves the 24 cards (or a person\'s move) to another board', async () => {
  const projects = many(24, { target: (k) => `2027-02-${String(k + 1).padStart(2, '0')}` })
  const s = setup({ fakeOpts: { projects, blockers: [] } })
  const { recipe } = await s.start()
  const roadmapId = await slateOf(s.w, recipe.instanceId, 'roadmap')
  const [board] = boardsOf(s.w, roadmapId)
  const ids = board.cards.map((c) => c.id).sort()
  const moved = board.cards[0]
  const later = board.lanes.find((l) => l.label === 'Later').id
  s.w.slates.personMoveCard(roadmapId, board.key, moved.id, later)
  await s.again()
  projects.push(...many(1, { from: 24, target: () => '2026-12-01' }))
  const out = await s.again()
  assert.equal(out.state, 'done')
  const after = boardsOf(s.w, roadmapId)
  const same = after.find((b) => b.key === board.key)
  assert.deepEqual(same.cards.map((c) => c.id).sort(), ids)
  assert.equal(same.cards.find((c) => c.id === moved.id).laneId, later, 'the person\'s move stays')
  assert.deepEqual(after.filter((b) => b.key !== board.key).map((b) => b.cards.map((c) => c.label.split(' · ').slice(0, 2).join(' · '))), [['Project 25 · Dec 1']])
})

test('today is the team\'s day: a project due today is not overdue on a Pacific evening', () => {
  const evening = Date.UTC(2026, 10, 28, 1) // Nov 27, 5 pm in Los Angeles
  assert.equal(todayIso(evening), '2026-11-28')
  assert.equal(todayIso(evening, 'America/Los_Angeles'), '2026-11-27')
  assert.equal(roadmapLane('2026-11-27', todayIso(evening, 'America/Los_Angeles')), 'this-quarter')
  const p = projectOf({ ...structuredClone(PROJECTS[0]), teams: { nodes: [{ ...TEAMS.WEB, timezone: 'America/Los_Angeles' }, { ...TEAMS.ENG, timezone: 'x"; drop' }] } })
  assert.deepEqual(p.teams.map((t) => t.timezone), ['America/Los_Angeles', null], 'Linear\'s team zone is read, a malformed one is not')
})
