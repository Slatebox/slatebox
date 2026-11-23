import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { sampleLaunchPlan, samplePipeline } from 'slateboxjs/workshops/rules'
import { shapeNotice, shapeName, withShapeNotice } from '../web/app/imports/api/common/shape-notice.mjs'
import { playWorkshopChanges, readWorkshopChanges } from '../web/app/server/methods/workshop-play.mjs'
import { portableWorkshopSlate } from '../web/app/imports/api/common/portableWorkshopSlate.mjs'

// Boards S1 (plan 2026-11-22, owner): a note dropped on a board becomes the board's card with a short
// notice, and dragged off it gets its shape back with another. A rectangle or rounded rectangle looks
// the same either way and gets none; an undo or redo is quiet.

const drop = (shape, label = 'Pick vendor', extra = {}) => ({ cardId: 'n1', laneId: 'todo', noteToCard: { noteId: 'n1', label, asNote: { shape } }, ...extra })
const leave = (shape, text = 'Pick vendor', extra = {}) => ({ cardId: 'n1', cardToNote: { noteId: 'n1', note: { options: { id: 'n1', text, shape } } }, ...extra })

test('a diamond dropped on a lane board: it is a card now, the board draws rounded boxes, and dragging it off brings the diamond back', () => {
  assert.equal(shapeNotice(drop('diamond'), { round: true }),
    '‘Pick vendor’ is a card now: cards on a board are rounded boxes. Drag it off to get its diamond back.')
  assert.equal(shapeNotice(drop('diamond'), { round: false }),
    '‘Pick vendor’ is a card now: cards on a board are boxes. Drag it off to get its diamond back.')
})

test('dragged off, it says the shape is back, with "an" before a vowel', () => {
  assert.equal(shapeNotice(leave('diamond')), '‘Pick vendor’ is a diamond again.')
  assert.equal(shapeNotice(leave('ellipse')), '‘Pick vendor’ is an oval again.')
  assert.equal(shapeNotice(leave('octagon')), '‘Pick vendor’ is an octagon again.')
  assert.equal(shapeNotice(leave('rarrow')), '‘Pick vendor’ is an arrow again.')
  // A note saved by an older reader names its shape as shapeHint.
  assert.equal(shapeNotice({ cardId: 'n1', cardToNote: { noteId: 'n1', note: { options: { id: 'n1', text: 'Pick vendor', shapeHint: 'diamond' } } } }), '‘Pick vendor’ is a diamond again.')
  assert.equal(shapeNotice(drop('ellipse'), { round: true }),
    '‘Pick vendor’ is a card now: cards on a board are rounded boxes. Drag it off to get its oval back.')
})

test('a rectangle, a rounded rectangle or no shape at all: nothing visible changes, so no notice', () => {
  for (const shape of ['rectangle', 'roundedrectangle', 'RoundedRectangle', undefined]) {
    assert.equal(shapeNotice(drop(shape), { round: true }), null, String(shape))
    assert.equal(shapeNotice(leave(shape)), null, String(shape))
  }
  assert.equal(shapeNotice({ cardId: 'n1', laneId: 'todo', noteToCard: { noteId: 'n1', label: 'Plain' } }, { round: true }), null)
  assert.equal(shapeNotice({ cardId: 'n1', cardToNote: { noteId: 'n1' } }), null)
  // A move or a rename is no trade at all.
  assert.equal(shapeNotice({ cardId: 'n1', laneId: 'doing' }), null)
  assert.equal(shapeNotice(null), null)
})

test('an undo or a redo puts a trade back quietly', () => {
  assert.equal(shapeNotice(drop('diamond', 'Pick vendor', { via: 'undo' }), { round: true }), null)
  assert.equal(shapeNotice(leave('diamond', 'Pick vendor', { via: 'undo' })), null)
})

test('each board says what its cards are: tasks on a plan are bars, deals and line items are rows', () => {
  assert.equal(shapeNotice(drop('diamond'), { kind: 'launch-plan' }),
    '‘Pick vendor’ is a task now: tasks on a plan are bars. Drag it off to get its diamond back.')
  assert.equal(shapeNotice(drop('diamond'), { kind: 'hiring-plan' }),
    '‘Pick vendor’ is a hire now: hires on a plan are bars. Drag it off to get its diamond back.')
  assert.equal(shapeNotice(drop('diamond'), { kind: 'pipeline' }),
    '‘Pick vendor’ is a deal now: deals in a pipeline are rows. Drag it off to get its diamond back.')
  assert.equal(shapeNotice(drop('diamond'), { kind: 'budget' }),
    '‘Pick vendor’ is a line item now: line items in a budget are rows. Drag it off to get its diamond back.')
  assert.equal(shapeNotice(drop('diamond'), { kind: 'nest', round: false }),
    '‘Pick vendor’ is a card now: cards on a board are boxes. Drag it off to get its diamond back.')
  // The way back reads the same on every board, by the card's own name: a task's note says its days
  // ("Pick vendor · 2 days"), but the notice names it as the board did.
  assert.equal(shapeNotice(leave('diamond'), { kind: 'pipeline' }), '‘Pick vendor’ is a diamond again.')
  assert.equal(shapeNotice(leave('diamond', 'Pick vendor · 2 days'), { kind: 'launch-plan', label: 'Pick vendor' }), '‘Pick vendor’ is a diamond again.')
})

test('a long label is cut at 40 characters with an ellipsis; an empty one is "The note"', () => {
  const long = 'Pick the vendor for the customer go-live migration and tell finance'
  assert.equal(shapeNotice(leave('diamond', long)), '‘Pick the vendor for the customer go-live…’ is a diamond again.')
  assert.equal(shapeNotice(drop('diamond', '  Pick\n  vendor  '), { round: true }).startsWith('‘Pick vendor’ is a card now'), true)
  assert.equal(shapeNotice(leave('diamond', '')), 'The note is a diamond again.')
  assert.equal(shapeNotice(drop('diamond', '   '), { round: true }),
    'The note is a card now: cards on a board are rounded boxes. Drag it off to get its diamond back.')
})

test('a shape with no everyday name is still brought back, in plain words', () => {
  assert.equal(shapeName('diamond'), 'diamond')
  assert.equal(shapeName('stickynote'), 'sticky note')
  assert.equal(shapeName('cloudish'), null)
  assert.equal(shapeNotice(drop('cloudish'), { round: true }),
    '‘Pick vendor’ is a card now: cards on a board are rounded boxes. Drag it off to get its shape back.')
  assert.equal(shapeNotice(leave('cloudish')), '‘Pick vendor’ has its shape back.')
})

test('when the board\'s own rule notice speaks for the same drop, the shape sentence joins it: one message', () => {
  assert.equal(withShapeNotice('Saved, with a warning: Doing holds 3; the limit is 2.', ['‘Pick vendor’ is a card now: cards on a board are rounded boxes. Drag it off to get its diamond back.']),
    'Saved, with a warning: Doing holds 3; the limit is 2. ‘Pick vendor’ is a card now: cards on a board are rounded boxes. Drag it off to get its diamond back.')
  assert.equal(withShapeNotice('Saved, with a warning: X.', []), 'Saved, with a warning: X.')
})

test('the canvas shows one notice, hidden from screen readers (they hear the engine\'s own sentence), top-centre on a phone, for 5 seconds', () => {
  const canvas = readFileSync(new URL('../web/app/imports/ui/pages/Canvas.jsx', import.meta.url), 'utf8')
  const hook = readFileSync(new URL('../web/app/imports/ui/components/workshop/useWorkshopOnCanvas.js', import.meta.url), 'utf8')
  const bar = canvas.slice(canvas.indexOf('<Snackbar'), canvas.indexOf('/>', canvas.indexOf('<Snackbar')))
  assert.match(bar, /data-shape-notice/)
  assert.match(bar, /aria-hidden/)
  assert.match(bar, /autoHideDuration=\{5000\}/)
  assert.match(bar, /vertical: phone \? 'top' : 'bottom'/)
  assert.match(hook, /from '\.\.\/\.\.\/\.\.\/api\/common\/shape-notice\.mjs'/)
  assert.match(hook, /withShapeNotice\(/)
})

test('the message box keeps 12px clear of what sits above it', () => {
  const panel = readFileSync(new URL('../web/app/imports/ui/components/ConversationPanel.jsx', import.meta.url), 'utf8')
  assert.match(panel, /\{extra && <Box data-composer-extra sx=\{\{ mb: 1\.5 \}\}>\{extra\}<\/Box>\}/)
})

test('the server keeps a dropped diamond\'s shape and look on a pipeline\'s deal and a launch plan\'s task, and a stored board keeps them', () => {
  const look = { backgroundColor: '#f0d399', borderWidth: 2 }
  for (const [board, laneId, label] of [[samplePipeline(), 'lead', 'Pick vendor $20k'], [sampleLaunchPlan(), 'product', 'Pick vendor 3 days']]) {
    // The canvas's change, with the undo marker a server never stores.
    const [change] = readWorkshopChanges([{ cardId: 'pick', laneId, noteToCard: { noteId: 'pick', label, look, asNote: { shape: 'diamond', width: 140, height: 90 } }, via: 'undo' }])
    assert.equal(change.via, undefined)
    const played = playWorkshopChanges(validateWorkshop(board), [change], ['pick'])
    const card = played.workshop.cards.find(item => item.id === 'pick')
    assert.deepEqual([card.look, card.asNote], [look, { shape: 'diamond', width: 140, height: 90 }])
    // As a slate stores and reads it back (config.normalize): kept.
    const stored = portableWorkshopSlate.normalize({ kind: 'workshop', version: 1, workshop: played.workshop })
    assert.deepEqual(stored.workshop.cards.find(item => item.id === 'pick').asNote.shape, 'diamond')
  }
})

test('a note that arrives on a plan is named as the board names its task, not by the words with its days', () => {
  // The canvas sends a note's words with its numbers ("Pick vendor · 2 days", boards S2b review); the notice names the task.
  assert.equal(shapeNotice(drop('diamond', 'Pick vendor · 2 days'), { kind: 'launch-plan', label: 'Pick vendor' }),
    '‘Pick vendor’ is a task now: tasks on a plan are bars. Drag it off to get its diamond back.')
})
