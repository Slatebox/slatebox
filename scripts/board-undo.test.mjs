// One person's undo and redo of a board change, made again on the board as it stands now: what they
// changed goes back, and what someone else changed since stays (web/app/imports/api/common/board-undo.mjs).
import assert from 'node:assert/strict'
import test from 'node:test'
import { BOARD_STEP_SAID, boardStepLabel, drawingOwnsBoardChange, rebaseBoardStep, settleBoardSide } from '../web/app/imports/api/common/board-undo.mjs'

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

test('a move made anyway is one step of its own, named as one, and the words that offer it name the canvas Undo', async () => {
  const { undoWords } = await import('../web/app/imports/api/common/undo-redo-keys.mjs')
  const sprint = board([{ id: 'a', label: 'Login', laneId: 'todo' }])
  assert.equal(boardStepLabel([{ cardId: 'a', laneId: 'doing', override: true, reason: 'Doing is full.' }], sprint), 'Move Login to Doing anyway')
  assert.equal(boardStepLabel([{ cardId: 'a', laneId: 'doing' }], sprint), 'Move Login to Doing')
  assert.equal(undoWords('MacIntel'), 'Undo (⌘Z)')
  assert.equal(undoWords('Win32'), 'Undo (Ctrl+Z)')
  assert.equal(undoWords('iPhone', true), 'Undo')
  const { readFile } = await import('node:fs/promises')
  const read = (path) => readFile(new URL('../web/app/imports/ui/components/' + path, import.meta.url), 'utf8')
  const hook = await read('workshop/useWorkshopOnCanvas.js')
  // Every change made anyway (a drop, the card bar's Move to, the server asking again) is queued as a step of its
  // own, and played alone, so a batch (one step) never holds a move made anyway with other changes.
  assert.equal((hook.match(/queue\.current\.push\(/g) || []).length, 1, 'only queueChange queues a change')
  assert.match(hook, /queueChange\(\{ cardId, laneId, override: true, reason: agreed \}\)/)
  assert.match(hook, /queueChange\(\{ \.\.\.again, reason: err\.reason \}\)/)
  assert.match(hook, /const alone = queue\.current\.findIndex\(change => change\.override\)/)
  assert.match(hook, /queue\.current\.splice\(0, alone === 0 \? 1 : alone > 0 \? alone : queue\.current\.length\)/)
  // The board's one-step "Undo last change" is gone: the dialog, the board's chat and the card bar name the canvas Undo.
  for (const path of ['workshop/MoveAnywayDialog.jsx', 'workshop/WorkshopConversation.jsx', 'stylebar/CardBar.jsx']) {
    const source = await read(path)
    assert.match(source, /undoWordsHere\(\)/, path)
    assert.doesNotMatch(source, /Undo last change/, path)
  }
})

test('a step made again ends where the server stored it: the next undo takes back a move made anyway that the server marked anew', () => {
  const before = board([{ id: 'a', label: 'Login', laneId: 'todo' }, { id: 'b', label: 'Docs', laneId: 'done' }])
  const after = board([{ id: 'a', label: 'Login', laneId: 'doing', override: { by: 'You', at: '2026-11-24T08:00:00Z', sentence: 'Doing is full.' } }, { id: 'b', label: 'Docs', laneId: 'done' }])
  // Redo saved it; the server stamped the mark itself, and a teammate has since renamed Docs.
  const saved = board([{ id: 'a', label: 'Login', laneId: 'doing', override: { by: 'Ada', at: '2026-11-24T08:05:00Z', sentence: 'Doing is full.' } }, { id: 'b', label: 'Docs 2', laneId: 'done' }])
  const settled = settleBoardSide({ from: before, to: after, saved })
  // Only what the step changes takes the server's form: Login with the server's mark; Docs stays as the step has it.
  assert.deepEqual(settled.cards, [saved.cards[0], after.cards[1]])
  // Undo from the settled side: Login goes back, unmarked, and the teammate's rename stays; nothing is in conflict.
  const undone = rebaseBoardStep({ from: settled, to: before, current: saved })
  assert.equal(undone.conflicts, 0)
  assert.deepEqual(undone.board.cards, [{ id: 'a', label: 'Login', laneId: 'todo' }, { id: 'b', label: 'Docs 2', laneId: 'done' }])
  // From the side the page sent, the old mark would be in conflict with the server's.
  assert.equal(rebaseBoardStep({ from: after, to: before, current: saved }).conflicts, 1)
  // A part the step takes away stays away, even if the server's copy still has it.
  const keptMark = board([{ ...before.cards[0], override: after.cards[0].override }, before.cards[1]])
  assert.deepEqual(settleBoardSide({ from: after, to: before, saved: keptMark }).cards, before.cards)
})
