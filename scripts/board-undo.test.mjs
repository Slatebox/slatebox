// One person's undo and redo of a board change, made again on the board as it stands now: what they
// changed goes back, and what someone else changed since stays (web/app/imports/api/common/board-undo.mjs).
import assert from 'node:assert/strict'
import test from 'node:test'
import { BOARD_STEP_SAID, boardStepLabel, drawingOwnsBoardChange, rebaseBoardStep } from '../web/app/imports/api/common/board-undo.mjs'

const board = (cards, extra = {}) => ({
  title: 'Sprint',
  lanes: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'Doing', limit: 2 }, { id: 'done', label: 'Done' }],
  cards,
  ...extra,
})
const card = (id, laneId, label = id) => ({ id, laneId, label })

test('undo of a move nobody else touched puts the card back where it was, in its place', () => {
  const before = board([card('a', 'todo'), card('b', 'todo'), card('c', 'doing')])
  const after = board([card('b', 'todo'), card('c', 'doing'), card('a', 'doing')])
  const { board: undone, changed, conflicts } = rebaseBoardStep({ from: after, to: before, current: after })
  assert.equal(changed, true)
  assert.equal(conflicts, 0)
  assert.deepEqual(undone, before)
})

test("undo of my move keeps a teammate's later move of another card and their rename of a lane", () => {
  const before = board([card('a', 'todo'), card('b', 'todo')])
  const mine = board([card('b', 'todo'), card('a', 'doing')])
  // A teammate then moves b to Done and renames Done.
  const current = { ...board([card('a', 'doing'), card('b', 'done')]), lanes: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'Doing', limit: 2 }, { id: 'done', label: 'Shipped' }] }
  const { board: undone, conflicts } = rebaseBoardStep({ from: mine, to: before, current })
  assert.equal(conflicts, 0)
  assert.deepEqual(undone.cards.find((c) => c.id === 'a'), card('a', 'todo'))
  assert.deepEqual(undone.cards.find((c) => c.id === 'b'), card('b', 'done'))
  assert.equal(undone.lanes[2].label, 'Shipped')
})

test('a card a teammate moved again since stays where they put it: nothing of mine to undo, and it is said', () => {
  const before = board([card('a', 'todo')])
  const mine = board([card('a', 'doing')])
  const current = board([card('a', 'done')])
  const result = rebaseBoardStep({ from: mine, to: before, current })
  assert.equal(result.changed, false)
  assert.equal(result.conflicts, 1)
  assert.deepEqual(result.board, current)
  assert.match(BOARD_STEP_SAID.overwritten, /Someone else changed that on the board since/)
})

test('part overwritten: my rename stays theirs, my move goes back', () => {
  const before = board([card('a', 'todo', 'Audit')])
  const mine = board([card('a', 'doing', 'Audit log')]) // one change: moved and renamed
  const current = board([card('a', 'doing', 'Audit trail')]) // a teammate renamed it since
  const { board: undone, changed, conflicts } = rebaseBoardStep({ from: mine, to: before, current })
  assert.equal(changed, true)
  assert.equal(conflicts, 1)
  assert.deepEqual(undone.cards[0], card('a', 'todo', 'Audit trail'))
})

test('undo of an added card removes it unless a teammate changed it since; a removed card comes back in its place', () => {
  const before = board([card('a', 'todo'), card('b', 'todo')])
  const added = board([card('a', 'todo'), card('b', 'todo'), card('n', 'todo', 'New hire')])
  assert.deepEqual(rebaseBoardStep({ from: added, to: before, current: added }).board, before)
  const renamed = board([card('a', 'todo'), card('b', 'todo'), card('n', 'todo', 'Priya')])
  const kept = rebaseBoardStep({ from: added, to: before, current: renamed })
  assert.equal(kept.changed, false)
  assert.equal(kept.conflicts, 1)

  const removed = board([card('b', 'todo')])
  const back = rebaseBoardStep({ from: removed, to: before, current: removed })
  assert.deepEqual(back.board.cards.map((c) => c.id), ['a', 'b'])
})

test("redo makes the step again on the board as it stands: a rule override and a teammate's new card both stay", () => {
  const before = board([card('a', 'todo'), card('b', 'doing'), card('c', 'doing')])
  // Moved anyway past Doing's limit (a confirmed rule override): the board records it.
  const after = { ...board([card('b', 'doing'), card('c', 'doing'), card('a', 'doing')]), overrides: [{ cardId: 'a', laneId: 'doing', rule: 'limit' }] }
  const current = board([card('a', 'todo'), card('b', 'doing'), card('c', 'doing'), card('t', 'todo', 'Theirs')])
  const { board: redone, conflicts } = rebaseBoardStep({ from: before, to: after, current })
  assert.equal(conflicts, 0)
  assert.deepEqual(redone.cards.map((c) => c.id + '@' + c.laneId), ['b@doing', 'c@doing', 'a@doing', 't@todo'])
  assert.deepEqual(redone.overrides, after.overrides)
})

test('labels name the change, and the drawing keeps the steps it puts back itself', () => {
  const shown = board([card('a', 'todo', 'Audit log')])
  assert.equal(boardStepLabel([{ cardId: 'a', laneId: 'doing' }], shown), 'Move Audit log to Doing')
  assert.equal(boardStepLabel([{ rename: { laneId: 'done', label: 'Shipped' } }], shown), 'Rename Done')
  assert.equal(boardStepLabel([{ rename: { title: 'Q3' } }], shown), 'Rename the board')
  assert.equal(boardStepLabel([{ cardId: 'a', laneId: 'doing' }, { cardId: 'b', laneId: 'done' }], shown), 'Board change')
  for (const change of [{ noteToCard: {} }, { cardToNote: {} }, { line: {} }, { rename: { cardId: 'a' } }, { cardId: 'a', via: 'undo' }])
    assert.equal(drawingOwnsBoardChange(change), true)
  for (const change of [{ cardId: 'a', laneId: 'doing' }, { rename: { laneId: 'done' } }, { edits: [] }])
    assert.equal(drawingOwnsBoardChange(change), false)
})
