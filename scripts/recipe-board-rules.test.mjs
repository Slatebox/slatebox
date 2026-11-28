// A recipe's board follows a source outside Slatebox (a sheet, Linear): the component's own working
// rules must not refuse the source's truth, and a card a person only moved follows the source again
// once the source changes that item. Checked against the engine's own board reducer.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-board-rules.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyWorkshopEdits } from 'slateboxjs/workshops/model'
import 'slateboxjs/workshops/behaviour'
import { catalogSamples as samples } from 'slateboxjs/workshops/samples'
import { componentAddition } from '../web/app/imports/api/common/component-add.mjs'
import { reconcileBoard, matchNewItems } from '../enterprise/server/recipes/reconcile.mjs'
import { flipTouched } from '../enterprise/server/recipes/ownership.mjs'

const view = (w) => ({ lanes: w.lanes.map((l) => ({ id: l.id, label: l.label })), cards: w.cards.map((c) => ({ id: c.id, label: c.label, laneId: c.laneId })), rules: (w.behaviour?.rules || []).map((r) => ({ id: r.id, kind: r.kind })) })
const apply = (w, edits) => {
  const made = applyWorkshopEdits(w, edits.map(({ key: _key, ...e }) => e), {})
  if (made.refused) throw new Error(made.refused.reason)
  return made.workshop
}
const LANES = [{ key: 'todo', label: 'To do' }, { key: 'started', label: 'In progress' }, { key: 'done', label: 'Done' }, { key: 'canceled', label: 'Canceled' }]
const cards = (n, lane = 'started') => Array.from({ length: n }, (_, i) => ({ key: `c${i}`, label: `Card ${i}`, lane }))

function firstRun(desired) {
  const board = componentAddition({ nodes: [], revision: 0 }, { component: 'team-board', topic: 'Cycle' }, samples).workshop
  assert.ok(board.behaviour.rules.some((r) => r.kind === 'capacity'), 'a team board starts with a three-card limit on Doing')
  const out = reconcileBoard({ desired, current: view(board), instanceId: 'i1', slateId: 's1' })
  const after = apply(board, out.edits)
  const owned = new Map(out.ownedUpdates.map((r) => [r.noteId, r]))
  for (const made of matchNewItems(out.edits, view(board), view(after))) owned.set(made.id, { _id: made.id, noteId: made.id, key: made.key, kind: made.kind, owner: 'recipe', personProps: [], hash: null, gone: false })
  return { board: after, out, owned }
}

test('a board a recipe adds drops its component\'s rules, so six cards in progress is not refused', () => {
  const { board, out } = firstRun({ key: 'b', component: 'team-board', title: 'Cycle', lanes: LANES, cards: cards(6) })
  assert.ok(out.edits.some((e) => e.kind === 'remove_rule'))
  assert.equal(board.cards.filter((c) => c.laneId === board.lanes[1].id).length, 6)
  assert.deepEqual(board.lanes.map((l) => l.label), ['To do', 'In progress', 'Done', 'Canceled'])
  assert.deepEqual(board.behaviour?.rules || [], [])
})

test('keepRules leaves the component\'s rules (and the engine then refuses a fourth card in Doing)', () => {
  const board = componentAddition({ nodes: [], revision: 0 }, { component: 'team-board', topic: 'Cycle' }, samples).workshop
  const out = reconcileBoard({ desired: { key: 'b', component: 'team-board', title: 'Cycle', lanes: LANES, cards: cards(4), keepRules: true }, current: view(board), instanceId: 'i1', slateId: 's1' })
  assert.ok(!out.edits.some((e) => e.kind === 'remove_rule'))
  assert.throws(() => apply(board, out.edits), /holds 3/)
})

test('rules are dropped only on a fresh board: one a person added later stays', () => {
  const { board, owned } = firstRun({ key: 'b', component: 'team-board', title: 'Cycle', lanes: LANES, cards: cards(2) })
  const withRule = { ...view(board), rules: [{ id: 'rule-9', kind: 'capacity' }] }
  const again = reconcileBoard({ desired: { key: 'b', component: 'team-board', title: 'Cycle', lanes: LANES, cards: cards(2) }, current: withRule, owned, instanceId: 'i1', slateId: 's1' })
  assert.ok(!again.edits.some((e) => e.kind === 'remove_rule'))
})

test('a card a person moved stays until the source changes it; then it follows the source again', () => {
  const desired = { key: 'b', component: 'team-board', title: 'Cycle', lanes: LANES, cards: cards(2) }
  const { board, owned } = firstRun(desired)
  const card = board.cards.find((c) => c.label === 'Card 0')
  const moved = apply(board, [{ kind: 'move_card', card: { id: card.id }, lane: { id: board.lanes[2].id } }])
  flipTouched(owned, new Map([[card.id, new Set(['lane'])]]), new Set(moved.cards.map((c) => c.id)))
  assert.equal(owned.get(card.id).owner, 'person')
  // the source did not change it: the person's lane stays
  const kept = reconcileBoard({ desired, current: view(moved), owned, instanceId: 'i1', slateId: 's1' })
  assert.ok(!kept.edits.some((e) => e.card === card.id))
  assert.equal(kept.stats.keptByPerson, 1)
  // the source changed it (reclaim): the card is the recipe's again and moves to the source's lane
  const changed = { ...desired, cards: [{ key: 'c0', label: 'Card 0 · changed in Linear', lane: 'todo', reclaim: true }, desired.cards[1]] }
  const back = reconcileBoard({ desired: changed, current: view(moved), owned, instanceId: 'i1', slateId: 's1' })
  assert.ok(back.edits.some((e) => e.kind === 'move_card' && e.card === card.id && e.lane === board.lanes[0].id))
  assert.ok(back.edits.some((e) => e.kind === 'rename_card' && e.card === card.id))
  assert.equal(back.ownedUpdates.find((r) => r.noteId === card.id).owner, 'recipe')
})

test('a card a person renamed is theirs for good, even when the source changes it', () => {
  const desired = { key: 'b', component: 'team-board', title: 'Cycle', lanes: LANES, cards: cards(1) }
  const { board, owned } = firstRun(desired)
  const card = board.cards[0]
  flipTouched(owned, new Map([[card.id, new Set(['label', 'lane'])]]), new Set([card.id]))
  const out = reconcileBoard({ desired: { ...desired, cards: [{ key: 'c0', label: 'New', lane: 'done', reclaim: true }] }, current: view(board), owned, instanceId: 'i1', slateId: 's1' })
  assert.equal(out.edits.filter((e) => e.card === card.id).length, 0)
  assert.equal(out.stats.keptByPerson, 1)
})
