// Boards S2a (plan 2026-11-22): the gear, "Change this board", puts today's single board in focus
// for the chat. These are written before the code: the "this board" phrasings in the existing
// grammar, a board as the chat's selection (client and server), the board's own suggestions and
// the placeholder, the request ladder (a rule this board knows, then a checked catalogue
// recommendation, then the AI turn with a checked `recommend`) and exec's workshop.can.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import 'slateboxjs/workshops/behaviour'
import { catalogPreset } from 'slateboxjs/catalog'
import { proposeLaneReply, laneObjectSelection } from '../web/app/imports/api/common/lane-conversation.mjs'
import '../web/app/imports/api/common/board-chat.mjs'
import { boardSuggestions, focusPlaceholder, editingLabel, focusContext, asksWhatElse, MAIN_BOARD } from '../web/app/imports/api/common/board-focus.mjs'
import { boardCan, catalogSuggest, recommendTurn } from '../web/app/imports/api/common/library.mjs'
import { laneChangeTool, laneInstructions, prepareLaneReply } from '../web/app/server/methods/lane-chat.mjs'

const app = path => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const tim = { by: 'Tim' }
const board = { kind: 'board', id: 'main' }
const say = (model, message, selection = board) => proposeLaneReply(model, message, selection, tim)
const retro = validateWorkshop({ ...catalogPreset('retro'), cards: [
  { id: 'ship', label: 'Shipped on time', laneId: catalogPreset('retro').lanes[0].id },
  { id: 'meet', label: 'Too many meetings', laneId: catalogPreset('retro').lanes[1].id },
  { id: 'pair', label: 'Pair on reviews', laneId: catalogPreset('retro').lanes[1].id },
] })
const labels = model => model.lanes.map(lane => lane.label)
// A lane board with no rules yet: Doing is the busiest lane.
const week = validateWorkshop({ version: 1, title: 'Team week',
  lanes: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'Doing' }, { id: 'done', label: 'Done' }],
  cards: [{ id: 'a', label: 'Call Sam', laneId: 'todo' }, { id: 'b', label: 'Write the brief', laneId: 'doing' }, { id: 'c', label: 'Book the room', laneId: 'doing' }] })

test('the main board is board "main" (the one place a slate keeps it today)', () => {
  assert.deepEqual(MAIN_BOARD, 'main')
})

test('"this board" phrasings read as the grammar already reads the board', () => {
  const added = say(retro, 'add a column called Blocked')
  assert.deepEqual(labels(added.workshop), [...labels(retro), 'Blocked'])
  assert.deepEqual(labels(say(retro, 'Add a column called Blocked to this board').workshop), [...labels(retro), 'Blocked'])
  assert.deepEqual(labels(say(retro, 'On this board, add a column called Blocked').workshop), [...labels(retro), 'Blocked'])
  assert.equal(say(week, 'on this board, limit Doing to 3 cards').workshop.lanes[1].capacity, 3)
  assert.equal(say(retro, 'Rename this to Sprint 12 retro').workshop.title, 'Sprint 12 retro')
  assert.equal(say(retro, 'call it Sprint 12 retro').workshop.title, 'Sprint 12 retro')
  assert.equal(say(retro, 'Call this board Sprint 12 retro').workshop.title, 'Sprint 12 retro')
  // With nothing but the board in focus, "this" still means the board, never one of its lanes.
  assert.throws(() => say(retro, 'Rename this lane to Kudos'), /Select a lane on the canvas first, or use its name\./)
  // Naming a lane or a card while the board is in focus asks for it to be selected; it never renames the board.
  assert.throws(() => say(retro, 'call this lane Doing'), /Select a lane on the canvas first, or use its name\./)
  assert.throws(() => say(retro, 'title this column Blocked'), /Select a lane on the canvas first, or use its name\./)
  assert.throws(() => say(retro, 'name this card Foo'), /Select a card on the canvas first, or use its name\./)
  for (const words of ['name this lane', 'call it a day']) {
    assert.throws(() => say(retro, words), error => error.code === 'not-understood', words + ' renames nothing')
  }
  // A lane named for removal goes, as it does without focus.
  const empty = retro.lanes.find(lane => !retro.cards.some(card => card.laneId === lane.id))
  assert.deepEqual(labels(say(retro, 'remove the ' + empty.label + ' column').workshop), labels(retro).filter(label => label !== empty.label))
  // Without focus, "rename this to …" is not read as the board.
  assert.throws(() => say(retro, 'Rename this to Sprint 12 retro', null))
})

test('a board is a selection the chat may send (client check and the server\'s)', () => {
  assert.deepEqual(laneObjectSelection(retro, { kind: 'board', id: 'main' }), { kind: 'board', id: 'main', label: retro.title })
  assert.throws(() => laneObjectSelection(retro, { kind: 'board', id: 'b2' }), /Select an existing board/)
  assert.deepEqual(laneObjectSelection(retro, { kind: 'lane', id: retro.lanes[0].id }), { kind: 'lane', id: retro.lanes[0].id, label: retro.lanes[0].label })
  // The AI path reads its commands with the board as the selection.
  const reply = prepareLaneReply({ reply: 'Added Blocked.', commands: ['Add lane Blocked'] }, retro, laneObjectSelection(retro, board))
  assert.deepEqual(labels(reply.workshop), [...labels(retro), 'Blocked'])
  // nativeCanvas.preview takes a board selection too.
  assert.match(app('server/methods/native-conversation.js'), /\['card','lane','board'\]\.includes\(selection\.kind\)/)
})

test('the board\'s own suggestions: each one parses on the board as it stands, the column first', () => {
  const offered = boardSuggestions(week, tim)
  assert.deepEqual(offered.map(item => item.text), ['Add a column called Blocked', 'Limit Doing to 3 cards', 'Rename this board to Team week 2', 'What else can this board do?'])
  assert.deepEqual(offered[0].select, [20, 27])
  for (const item of offered.slice(0, -1)) assert.ok(say(week, item.text).workshop, item.text)
  // A retro's lanes all have their limit already: no limit is offered again.
  assert.deepEqual(boardSuggestions(retro, tim).map(item => item.text), ['Add a column called Blocked', 'Rename this board to Retro 2', 'What else can this board do?'])
  // Five lanes: no column is offered.
  const full = validateWorkshop({ ...week, lanes: [...week.lanes, { id: 'x', label: 'Blocked' }, { id: 'y', label: 'Parked' }] })
  assert.ok(!boardSuggestions(full, tim).some(item => item.text.startsWith('Add a column')))
  const ruled = say(week, 'limit Doing to 3 cards').workshop
  assert.ok(!boardSuggestions(ruled, tim).some(item => item.text.startsWith('Limit Doing')))
  // A column called Blocked already there: the next free name.
  assert.equal(boardSuggestions(say(week, 'add a column called Blocked').workshop, tim)[0].text, 'Add a column called Review')
})

test('the placeholder is a concrete example the board takes', () => {
  assert.equal(focusPlaceholder(retro, tim), 'Add a column called Blocked')
  const full = validateWorkshop({ ...retro, lanes: [...retro.lanes, { id: 'x', label: 'Blocked' }, { id: 'y', label: 'Parked' }] })
  assert.ok(say(full, focusPlaceholder(full, tim)).workshop)
})

test('the "Editing:" chip and the chat\'s context with the board in focus', () => {
  assert.equal(editingLabel(retro), 'Editing: ' + retro.title)
  const lane = retro.lanes[0]
  assert.equal(editingLabel(retro, { kind: 'lane', id: lane.id }), 'Editing: ' + retro.title + ' › ' + lane.label)
  assert.deepEqual(focusContext(retro, 'main', null), { kind: 'board', id: 'main' })
  // A lane selected while the board is in focus: "this" is the lane, the board stays in focus.
  assert.deepEqual(focusContext(retro, 'main', { kind: 'lane', id: lane.id }), { kind: 'lane', id: lane.id })
  assert.equal(focusContext(retro, null, null), null)
  assert.ok(asksWhatElse('What else can this board do?') && asksWhatElse('what can this board do') && asksWhatElse('What can this do?'))
  assert.ok(!asksWhatElse('what is this board about'))
})

test('the request ladder: a rule this board knows first, then a checked catalogue recommendation', () => {
  // 1. A rule this board's family knows: "make X hold at most 2" is a limit, previewed.
  const rule = say(retro, 'make ' + retro.lanes[1].label + ' hold at most 2')
  assert.ok(rule.workshop)
  // 2. Something another component does: recommended, never forced, and only from the catalogue.
  assert.equal(catalogSuggest('track deal amounts', retro)?.id, 'sales-pipeline')
  assert.equal(catalogSuggest('split our money across teams', retro)?.id, 'budget')
  assert.equal(catalogSuggest('run a retro', retro), null, 'the board\'s own kind is never recommended for itself')
  assert.equal(catalogSuggest('make it nicer', retro), null)
  // A question, or a request to read the board back, is about this board: it goes to the AI turn,
  // never to a recommendation, whatever words it shares with another component.
  const team = validateWorkshop(catalogPreset('team-board')), triage = validateWorkshop(catalogPreset('triage'))
  for (const model of [team, retro, triage]) {
    for (const question of ['why is Doing so full?', 'what should we decide first?', 'explain the flow of this board',
      'summarise the feedback on this board', 'who owns the launch cards?', 'list the costs', 'Can you track deal amounts?']) {
      assert.equal(catalogSuggest(question, model), null, question + ' on ' + model.title)
    }
    assert.equal(catalogSuggest('track deal amounts', model)?.id, 'sales-pipeline', 'a request still is recommended on ' + model.title)
  }
  const turn = recommendTurn(retro, catalogSuggest('track deal amounts', retro))
  // Many boards on a slate (S4a): the recommendation is added beside the board, never on a new slate.
  assert.equal(turn.content, '“' + retro.title + '” can’t do that. A Sales pipeline does: move deals through stages toward a target. Add it beside this board?')
  assert.deepEqual(turn.catalog, ['sales-pipeline'])
  assert.equal(turn.adds, 'Add a sales pipeline')
  assert.equal(turn.opens, undefined)
})

test('the AI turn may name a component; the server keeps only real catalogue ids', () => {
  assert.ok(laneChangeTool.parameters.properties.recommend)
  assert.deepEqual(laneChangeTool.parameters.required, ['reply'])
  assert.match(laneInstructions, /recommend/)
  assert.match(laneInstructions, /kind board/)
  const kept = prepareLaneReply({ reply: 'A Sales pipeline tracks deal amounts.', recommend: { component: 'sales-pipeline', why: 'It tracks deal amounts.' } }, retro, null)
  assert.deepEqual(kept, { reply: 'A Sales pipeline tracks deal amounts.', workshop: null, recommend: { component: 'sales-pipeline', why: 'It tracks deal amounts.' } })
  const unknown = prepareLaneReply({ reply: 'Try a CRM.', recommend: { component: 'salesforce', why: 'x' } }, retro, null)
  assert.deepEqual(unknown, { reply: 'Try a CRM.', workshop: null })
  // A reply with neither commands nor a real recommendation is not a proposal.
  assert.throws(() => prepareLaneReply({ reply: 'Hmm.' }, retro, null), /Invalid workshop proposal/)
  // Commands and a recommendation together: the commands are the proposal; the recommendation rides along.
  const both = prepareLaneReply({ reply: 'Added Blocked.', commands: ['Add lane Blocked'], recommend: { component: 'team-board', why: 'Limits.' } }, retro, null)
  assert.deepEqual(labels(both.workshop), [...labels(retro), 'Blocked'])
  assert.deepEqual(both.recommend, { component: 'team-board', why: 'Limits.' })
})

test('exec: workshop.can is what this board takes, each with a phrase that does it', () => {
  const can = boardCan(retro)
  assert.ok(can.length >= 3)
  for (const item of can) {
    assert.deepEqual(Object.keys(item).sort(), ['say', 'words'])
    assert.ok(say(retro, item.say, null).workshop, item.say)
  }
  assert.match(app('server/slate-read.mjs'), /can: boardCan\(/)
  assert.match(app('server/actions/slate-schemas.mjs'), /can: \{/)
})
