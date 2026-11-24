// How a board looks, said in a sentence and read with no AI call (board-appearance.mjs): every kind of board, the builder's
// chat and any board's, one set_appearance edit each (the engine's own reducer), and two or three looks to choose from
// when a sentence could mean more than one. Owner, 2026-11-24: "this kind of edit should be doable in the smart
// component that i'm building", after "can you make the columns in impact x effort more pronounced?" was refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { nightTransfer, validateWorkshop } from 'slateboxjs/workshops/model'
import 'slateboxjs/workshops/behaviour'
import 'slateboxjs/workshops/rules'
import { catalogSamples } from 'slateboxjs/workshops/samples'
import { appearanceEdits, emphasisChoices, proposeAppearance } from '../web/app/imports/api/common/board-appearance.mjs'
import { proposeLaneReply } from '../web/app/imports/api/common/lane-conversation.mjs'
import { proposeDirectMapEdit } from '../web/app/imports/api/common/map-direct-edits.mjs'
import '../web/app/imports/api/common/board-chat.mjs'

const matrix = () => validateWorkshop(catalogSamples['impact-effort']())
const team = () => validateWorkshop({ version: 1, title: 'Team', lanes: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'Doing' }, { id: 'done', label: 'Done' }],
  cards: [{ id: 'a', label: 'Ship it', laneId: 'todo' }] })
const edits = (board, message, selection) => appearanceEdits(board, message, selection)

test('the owner’s sentence on Impact × effort changes the board, with no AI call', () => {
  const board = matrix()
  const made = proposeLaneReply(board, 'can you make the columns in impact x effort more pronounced?')
  assert.deepEqual(made.workshop.appearance, { borders: 'strong', headers: 'strong', fill: 'strong' })
  assert.equal(made.reply, 'The board now has stronger column borders, bolder headers and deeper column colors.')
  // Nothing else on the board changes: the cards and their scores stay.
  assert.deepEqual(made.workshop.cards, board.cards)
})

test('the common phrasings, each one look', () => {
  const board = team()
  const cases = {
    'make the columns more pronounced': { emphasis: 'strong' },
    'bolder columns': { emphasis: 'strong' },
    'Stronger lane borders': { borders: 'strong' },
    'make the column borders thicker': { borders: 'strong' },
    'Make the headers bigger, please': { headerSize: 'large' },
    'bigger headers': { headerSize: 'large' },
    'make the headers bold': { headers: 'strong' },
    'softer background': { fill: 'soft' },
    'make the background softer': { fill: 'soft' },
    'darker column colors': { fill: 'strong' },
    'show grid lines': { lines: true },
    'show quadrant lines': { lines: true },
    'hide the grid lines': { lines: false },
    'compact cards': { density: 'compact' },
    'make the cards smaller': { density: 'compact' },
    'roomier cards': { density: 'normal' },
    'make the columns subtler': { emphasis: 'subtle' },
    'make the columns in the sprint board more pronounced': { emphasis: 'strong' },
    'reset the look': { emphasis: 'normal', headerSize: 'normal', lines: false, density: 'normal' },
  }
  for (const [said, fields] of Object.entries(cases)) assert.deepEqual(edits(board, said), [{ kind: 'set_appearance', ...fields }], said)
})

test('a column’s color by its name, a 2 by 2’s quadrant by its name, and the column selected', () => {
  const board = team()
  assert.deepEqual(edits(board, 'color the Doing column green'), [{ kind: 'set_appearance', lane: { id: board.lanes[1].id }, color: 'green' }])
  assert.deepEqual(edits(board, 'make Done blue'), [{ kind: 'set_appearance', lane: { id: board.lanes[2].id }, color: 'blue' }])
  assert.deepEqual(edits(board, 'change the color of To do to grey'), [{ kind: 'set_appearance', lane: { id: board.lanes[0].id }, color: 'gray' }])
  assert.deepEqual(edits(board, 'color this column red', { kind: 'lane', id: board.lanes[0].id }), [{ kind: 'set_appearance', lane: { id: board.lanes[0].id }, color: 'red' }])
  const square = matrix()
  const made = proposeLaneReply(square, 'color the Do now column green')
  assert.deepEqual(made.workshop.appearance, { colors: { 'q-do-now': 'green' } })
  assert.equal(made.reply, 'The board now has Do now in green.')
  assert.deepEqual(proposeLaneReply(made.workshop, 'make Do now its own color').workshop.appearance, undefined)
})

test('a card’s color stays a card’s: "make Billing green" colors the card, not a column', () => {
  const board = validateWorkshop({ ...team(), cards: [{ id: 'billing', label: 'Billing', laneId: team().lanes[0].id }] })
  assert.equal(edits(board, 'make Billing green'), null)
  const made = proposeLaneReply(board, 'make Billing green')
  assert.equal(made.workshop.appearance, undefined)
  assert.ok(made.workshop.cards[0].look?.backgroundColor)
})

test('a sentence that could mean more than one look offers two or three to choose from, never a refusal', () => {
  for (const said of ['make it pop', 'make it stand out more', 'more contrast', 'can you make this more pronounced?']) {
    assert.throws(() => proposeLaneReply(team(), said), error => error.code === 'appearance-choices' && error.choices === emphasisChoices && /stand out/.test(error.message), said)
  }
  assert.ok(emphasisChoices.length >= 2 && emphasisChoices.length <= 3)
  // Each choice is a sentence the chat reads as it is, to the look it names.
  assert.deepEqual(emphasisChoices.map(choice => edits(team(), choice.say)[0]), [
    { kind: 'set_appearance', borders: 'strong' }, { kind: 'set_appearance', headers: 'strong' }, { kind: 'set_appearance', emphasis: 'strong' }])
})

test('every kind of board: a launch plan, a pipeline, a budget, a decision path', () => {
  for (const id of ['launch-plan', 'pipeline', 'budget', 'hiring-plan', 'sort-evidence']) {
    const made = proposeAppearance(validateWorkshop(catalogSamples[id]()), 'make the columns more pronounced')
    assert.deepEqual(made.workshop.appearance, { borders: 'strong', headers: 'strong', fill: 'strong' }, id)
  }
  const map = validateWorkshop(nightTransfer)
  const made = proposeDirectMapEdit(map, 'show grid lines')
  assert.deepEqual(made.workshop.appearance, { lines: true })
  assert.deepEqual(proposeDirectMapEdit(map, 'color Last train green').workshop.appearance, { colors: { platform: 'green' } })
})

test('other sentences are not about the look: they go on to the board’s own sentences', () => {
  const board = team()
  for (const said of ['Add a column called Later', 'Move it to Done', 'Let Doing hold 2', 'Rename the board to Sprint', 'what can this do?']) {
    assert.equal(edits(board, said), null, said)
  }
  assert.equal(proposeLaneReply(board, 'Add a column called Later').workshop.appearance, undefined)
})

test('the look is data on the board: a library version and a fork carry it, and the AI turn’s edits are the same sentences', async () => {
  const { snapshotWorkshop, snapshotSlate } = await import('../web/app/server/library/snapshot.mjs')
  const board = proposeLaneReply(matrix(), 'make the columns more pronounced').workshop
  assert.deepEqual(snapshotWorkshop(board).appearance, board.appearance)
  assert.deepEqual(validateWorkshop(snapshotWorkshop(board)).appearance, board.appearance, 'a fork reads it back as it was')
  const slate = snapshotSlate({ _id: 's', shareId: 's', options: { name: 'B' }, nodes: [], creative: { revision: 3, model: { version: 1, kind: 'workshop', workshop: board } } })
  assert.deepEqual(slate.creative.model.workshop.appearance, board.appearance)
  // Canvas AI writes its edits as sentences this chat reads (prepareLaneReply): a look it asks for is the same edit.
  const { prepareLaneReply } = await import('../web/app/server/methods/lane-chat.mjs')
  const made = prepareLaneReply({ reply: 'Done.', commands: ['Make the headers bigger', 'color Do now green'] }, matrix(), null)
  assert.deepEqual(made.workshop.appearance, { headerSize: 'large', colors: { 'q-do-now': 'green' } })
})

test('on a slate of several boards the owner’s sentence names its board: "the columns in impact x effort"', async () => {
  const { pickBoard } = await import('../web/app/imports/api/common/board-pick.mjs')
  const boards = [{ boardId: 'main', model: team() }, { boardId: 'b2', model: matrix() }]
  const picked = pickBoard(boards, 'can you make the columns in impact x effort more pronounced?')
  assert.equal(picked.board.boardId, 'b2')
  assert.deepEqual(proposeLaneReply(matrix(), picked.message).workshop.appearance, { borders: 'strong', headers: 'strong', fill: 'strong' })
  // A message that names no board in that place still asks which.
  assert.ok(pickBoard(boards, 'make the columns more pronounced').ask)
})

test('keeping a look on a business board saves: the server makes the whole save again as its set_appearance edits', async () => {
  const { replaceWorkshop } = await import('../web/app/server/methods/workshop-replace.mjs')
  const board = matrix()
  const next = proposeLaneReply(board, 'can you make the columns in impact x effort more pronounced?').workshop
  const saved = replaceWorkshop(board, next, { revision: 3, current: 3, userId: 'u1', actor: { by: 'Bea' } })
  assert.ok(saved.workshop, JSON.stringify(saved.refused))
  assert.deepEqual(saved.workshop.appearance, { borders: 'strong', headers: 'strong', fill: 'strong' })
  const plan = validateWorkshop(catalogSamples['launch-plan']())
  const colored = proposeAppearance(plan, 'color ' + plan.lanes[0].label + ' green').workshop
  assert.deepEqual(replaceWorkshop(plan, colored, { revision: 1, current: 1, userId: 'u1' }).workshop.appearance, { colors: { [plan.lanes[0].id]: 'green' } })
})

// Review fixes (2026-11-24): words about the wording are the agent's, a column named is asked about, colors clear.
test('a request about the words is not read as a look: it goes on to the agent', () => {
  for (const said of ['make the notes shorter', 'make the tasks shorter', 'make the labels clearer', 'make the names clearer', 'make the steps clearer',
    'make the board darker', 'highlight the teams', 'make this clearer', 'clearer', 'bold']) {
    assert.equal(edits(team(), said), null, said)
    assert.equal(edits(matrix(), said), null, said)
  }
  // The looks themselves still read.
  assert.deepEqual(edits(team(), 'make the labels bolder'), [{ kind: 'set_appearance', headers: 'strong' }])
  assert.deepEqual(edits(team(), 'make the cards shorter'), [{ kind: 'set_appearance', density: 'compact' }])
})

test('"reset the colors" takes every column color away, and "reset the look" does too', () => {
  const colored = proposeLaneReply(proposeLaneReply(team(), 'color Doing green').workshop, 'color Done blue').workshop
  const shown = proposeLaneReply({ ...colored, appearance: { ...colored.appearance, borders: 'strong' } }, 'reset the colors')
  assert.deepEqual(shown.workshop.appearance, { borders: 'strong' })
  assert.deepEqual(proposeLaneReply(colored, 'clear the colours').workshop.appearance, undefined)
  assert.deepEqual(proposeLaneReply({ ...colored, appearance: { ...colored.appearance, lines: true } }, 'reset the look').workshop.appearance, undefined)
  // Nothing to clear is said, with no board to keep.
  const none = proposeLaneReply(team(), 'reset the colors')
  assert.equal(none.workshop, undefined)
  assert.match(none.reply, /already have their own colors/)
})

test('a column named in a look is asked about, not applied to the whole board; the board named is the board', () => {
  for (const [said, whole] of [['make the headers of Doing bolder', 'Make the headers bolder'], ['make the borders on Done stronger', 'Make the borders stronger']]) {
    assert.throws(() => edits(team(), said), error => error.code === 'appearance-choices' && error.choices[0].say === whole && /^Color D/.test(error.choices[1].say), said)
  }
  // Another board's name after the parts is not this one: not read as a look here.
  assert.equal(edits(team(), 'make the columns in Impact × effort more pronounced'), null)
  assert.deepEqual(edits(matrix(), 'make the columns in impact x effort more pronounced'), [{ kind: 'set_appearance', emphasis: 'strong' }])
  assert.deepEqual(edits({ ...matrix(), title: 'Q3 bets' }, 'make the columns in impact x effort more pronounced'), [{ kind: 'set_appearance', emphasis: 'strong' }])
})

test('looks that did nothing or cost an agent turn: bigger cards, every column a color, lines, one column standing out', () => {
  const same = proposeAppearance(team(), 'make the cards bigger')
  assert.equal(same.workshop, undefined, 'no preview of a board that does not change')
  assert.match(same.reply, /no larger size/)
  const blue = proposeAppearance(team(), 'make the columns blue')
  assert.deepEqual(blue.workshop.appearance, { colors: { todo: 'blue', doing: 'blue', done: 'blue' } })
  assert.equal(blue.reply, 'The board now has To do in blue, Doing in blue and Done in blue.')
  assert.deepEqual(proposeAppearance(matrix(), 'color the columns blue').workshop.appearance.colors, { 'q-do-now': 'blue', 'q-plan': 'blue', 'q-later': 'blue', 'q-skip': 'blue' })
  assert.throws(() => edits(team(), 'make the column headers blue'), error => error.code === 'appearance-choices' && error.choices[0].say === 'Color the columns blue')
  assert.deepEqual(edits(team(), 'make the lines thicker'), [{ kind: 'set_appearance', lines: true, borders: 'strong' }])
  assert.deepEqual(edits(team(), 'highlight Doing'), [{ kind: 'set_appearance', lane: { id: 'doing' }, color: 'yellow' }])
  assert.deepEqual(edits(matrix(), 'make Do now stand out'), [{ kind: 'set_appearance', lane: { id: 'q-do-now' }, color: 'yellow' }])
  assert.deepEqual(edits(team(), 'highlight the columns'), [{ kind: 'set_appearance', emphasis: 'strong' }])
})

test('"the cards in Backlog" goes to the board of the Backlog column, not to a board titled Backlog', async () => {
  const { pickBoard } = await import('../web/app/imports/api/common/board-pick.mjs')
  const backlog = validateWorkshop({ version: 1, title: 'Backlog', lanes: [{ id: 'ideas', label: 'Ideas' }, { id: 'later', label: 'Later' }], cards: [] })
  const sprint = validateWorkshop({ version: 1, title: 'Sprint', lanes: [{ id: 'backlog', label: 'Backlog' }, { id: 'doing', label: 'Doing' }], cards: [] })
  const boards = [{ boardId: 'main', model: backlog }, { boardId: 'b2', model: sprint }]
  const picked = pickBoard(boards, 'move the cards in Backlog to Doing')
  assert.notEqual(picked.board?.boardId, 'main')
  assert.ok(!picked.message || /in Backlog/.test(picked.message))
})

test('the library refine agent sees the board’s current look, so it can change it from what it is', async () => {
  const { refineData } = await import('../web/app/server/library/refine-ai.mjs')
  const board = proposeLaneReply(matrix(), 'color Do now green').workshop
  const shown = JSON.parse(refineData({ item: { kind: 'component', title: 'T', summary: 's' }, board, message: 'back to standard' }).data)
  assert.deepEqual(shown.item.board.appearance, { colors: { 'q-do-now': 'green' } })
  assert.equal(JSON.parse(refineData({ item: { kind: 'component', title: 'T', summary: 's' }, board: matrix(), message: 'x' }).data).item.board.appearance, undefined)
})
