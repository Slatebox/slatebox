// W1, the sheet-backed live board (enterprise/recipes/google-sheet-board), against the catalog's
// acceptance criteria: a 30-row roster gives an org chart with the right manager connectors; one
// changed title changes exactly one note; a deleted row's card is gone from what the recipe wants
// (reconcile deletes it, or marks it removed when a person touched it); with no write grant, zero
// write calls; only drive.file is used to read. Plus: columns matched by name (the model only when
// a needed column has no match), boards split past 24 cards, "changed in sheet" when the sheet
// changes a row again, and write-back proposed for a card a person moved.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-google-sheet-board.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import W1 from '../enterprise/recipes/google-sheet-board/index.mjs'
import { guessColumns, sheetDay } from '../enterprise/recipes/google-sheet-board/map.mjs'
import { fakeAi } from './fakes/recipe-lite-context.mjs'
import { googleWorld, roster } from './fakes/google-recipe-world.mjs'

const SHEET = 'sheet0123456789abc'
const sheet = (tabs) => ({ [SHEET]: { name: 'Team roster', mimeType: 'application/vnd.google-apps.spreadsheet', version: 1, tabs } })

test('a 30-row roster: an org chart, a note per person, a connector from each manager, a frame per department', async () => {
  const w = googleWorld({ files: sheet({ People: roster() }) })
  const instance = w.addInstance('w1', 'google-sheet-board', { fileId: SHEET, template: 'org-chart' })
  const run = await w.run(W1, instance)
  const [slate] = run.result.desired.slates
  assert.equal(slate.name, 'Team roster — People')
  assert.equal(slate.graph.layout, 'tree')
  assert.equal(slate.graph.nodes.length, 30)
  assert.equal(slate.graph.edges.length, 29, 'everyone but the CEO has a manager')
  const key = (name) => slate.graph.nodes.find((n) => n.text.startsWith(name + '\n')).key
  assert.ok(slate.graph.edges.some((e) => e.from === key('Mara Chen') && e.to === key('Ivan Ortiz')))
  assert.ok(slate.graph.edges.some((e) => e.from === key('Engineering Manager 1') && e.to === key('Engineering Person 1.3')))
  assert.deepEqual(slate.graph.frames.map((f) => f.text), ['Leadership', 'Engineering', 'Sales', 'Operations'])
  assert.deepEqual(w.state.calls, { 'files.get': 1, 'spreadsheets.get': 1, 'values.get': 1 })
  assert.equal(run.events[0].event, 'sheet.synced')
  assert.deepEqual(run.events[0].data, { fileId: SHEET, tab: 'People', added: 30, changed: 0, removed: 0 })
})

test('one changed title changes exactly one note; a deleted row\'s note is no longer wanted; no other key moves', async () => {
  const rows = roster()
  const w = googleWorld({ files: sheet({ People: rows }) })
  const instance = w.addInstance('w1', 'google-sheet-board', { fileId: SHEET, tab: 'People', template: 'org-chart' })
  const first = (await w.run(W1, instance)).result.desired.slates[0].graph
  rows[5][1] = 'Senior Manager'
  rows.splice(30, 1)
  w.state.files[SHEET].version++
  const second = await w.run(W1, instance)
  const next = second.result.desired.slates[0].graph
  const before = new Map(first.nodes.map((n) => [n.key, n.text]))
  const changed = next.nodes.filter((n) => before.get(n.key) !== n.text)
  assert.equal(changed.length, 1)
  assert.match(changed[0].text, /Senior Manager/)
  assert.equal(next.nodes.length, 29)
  assert.ok(next.nodes.every((n) => before.has(n.key)), 'every remaining row keeps its note')
  assert.deepEqual(second.events[0].data, { fileId: SHEET, tab: 'People', added: 0, changed: 1, removed: 1 })
})

test('a kanban: lanes in the sheet\'s order, a card per row, boards of 24 grouped by a column; the sheet changing a moved card again wins', async () => {
  const rows = [['Task', 'Status', 'Owner', 'Due', 'Team']]
  for (let i = 1; i <= 30; i++) rows.push([`Task ${i}`, ['Todo', 'Doing', 'Done'][i % 3], 'Ana', `12/${i % 28 + 1}/2026`, i <= 15 ? 'Web' : 'Mobile'])
  const w = googleWorld({ files: sheet({ Board: rows }) })
  const instance = w.addInstance('w1', 'google-sheet-board', { fileId: SHEET, template: 'kanban', groupBy: 'Team' })
  const run = await w.run(W1, instance)
  const [slate] = run.result.desired.slates
  assert.deepEqual(slate.boards.map((b) => [b.title, b.cards.length, b.component]), [['Web', 15, 'team-board'], ['Mobile', 15, 'team-board']])
  assert.deepEqual(slate.boards[0].lanes.map((l) => l.label), ['Doing', 'Done', 'Todo'])
  const card = slate.boards[0].cards[0]
  assert.deepEqual(card, { key: 'r:task 1#1', label: 'Task 1', lane: 'doing', due: '2026-12-02', owner: 'Ana', fields: { row: '2' } })
  rows[1][1] = 'Done'
  const again = await w.run(W1, instance)
  const moved = again.result.desired.slates[0].boards[0].cards[0]
  assert.equal(moved.lane, 'done')
  assert.equal(moved.reclaim, true, 'the sheet wins: the card follows it even if a person moved it')
  assert.equal(moved.fields.note, 'changed in sheet')
  const boardWins = googleWorld({ files: sheet({ Board: rows }) })
  const keep = boardWins.addInstance('w2', 'google-sheet-board', { fileId: SHEET, template: 'kanban', winner: 'board' })
  await boardWins.run(W1, keep)
  rows[1][1] = 'Todo'
  const kept = (await boardWins.run(W1, keep)).result.desired.slates[0].boards[0].cards[0]
  assert.ok(!kept.reclaim, 'the board wins: a person\'s move stays')
})

test('write-back: a card a person moved proposes one cell write in the lane column; nothing without a board change', async () => {
  const rows = [['Task', 'Status'], ['Ship it', 'Doing'], ['Test it', 'Todo']]
  const w = googleWorld({ files: sheet({ Board: rows }) })
  const instance = w.addInstance('w1', 'google-sheet-board', { fileId: SHEET, template: 'kanban', tab: 'Board' })
  const none = await w.run(W1, instance, { boardState: async () => [{ boardKey: 'b:board', key: 'b:board', cards: [{ key: 'r:ship it#1', lane: 'doing', owner: 'recipe' }] }] })
  assert.deepEqual(none.result.writes, [])
  const moved = await w.run(W1, instance, { boardState: async () => [{ key: 'b:board', cards: [{ key: 'r:ship it#1', lane: 'todo', owner: 'person' }] }] })
  assert.deepEqual(moved.result.writes, [{ kind: 'google.write_sheet', target: { fileId: SHEET, range: "'Board'!B2" }, body: { values: [['Todo']] }, key: `cell:${SHEET}:ship it#1:todo` }])
  assert.equal(w.state.calls['values.update'] || 0, 0, 'the recipe proposes; it never writes')
})

test('columns: matched by name with no model call; the model asked once (≤ 2k tokens) only when a needed column has no match', async () => {
  assert.deepEqual(guessColumns(['Full name', 'Job title', 'Reports to', 'Dept'], 'org-chart'), { name: 'Full name', title: 'Job title', manager: 'Reports to', department: 'Dept' })
  assert.equal(sheetDay('Dec 5, 2026'), '2026-12-05')
  assert.equal(sheetDay('2/30/2026'), null)
  const rows = [['Opening', 'Where'], ['Designer', 'Onsite'], ['Engineer', 'Phone screen']]
  const w = googleWorld({ files: sheet({ Hiring: rows }) })
  const instance = w.addInstance('w1', 'google-sheet-board', { fileId: SHEET, template: 'hiring-plan' })
  const ai = fakeAi(() => ({ columns: { role: 'Opening', stage: 'Where', count: 'Nope' } }))
  const run = await w.run(W1, instance, { ai })
  assert.equal(ai.calls.length, 1)
  assert.ok(ai.calls[0].maxIn <= 2000)
  assert.equal(run.result.desired.slates[0].boards[0].component, 'hiring-plan')
  assert.deepEqual(instance.cursor.columns, { role: 'Opening', stage: 'Where' }, 'a header that is not there is dropped')
  await w.run(W1, instance, { ai })
  assert.equal(ai.calls.length, 1, 'kept: asked once')
  const lost = googleWorld({ files: sheet({ Hiring: [['A', 'B'], ['x', 'y']] }) })
  const li = lost.addInstance('w2', 'google-sheet-board', { fileId: SHEET, template: 'hiring-plan' })
  await assert.rejects(lost.run(W1, li, { ai: fakeAi(() => null) }), { code: 'invalid_config', message: /Say which column holds role and stage/ })
})

test('only drive.file reads: Drive, Sheets and Docs hosts only; a file that is not a sheet is refused in plain words', async () => {
  const w = googleWorld({ files: { ...sheet({ People: roster() }), doc0123456789abcd: { name: 'Notes', mimeType: 'application/vnd.google-apps.document', version: 1 } } })
  await assert.rejects(w.run(W1, w.addInstance('w1', 'google-sheet-board', { fileId: 'doc0123456789abcd', template: 'kanban' })), { message: 'That file is not a Google Sheet. Pick a sheet.' })
  const s = await w.vendor.session(w.addInstance('w2', 'google-sheet-board', { fileId: SHEET, template: 'org-chart' }))
  assert.ok(!('writeValues' in s), 'a recipe\'s session cannot write')
})
