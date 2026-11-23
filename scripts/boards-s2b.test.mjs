// Boards S2b (owner addenda, 2026-11-22), the app's side:
// 1. Notes ALWAYS convert on boards, a map's own included: the canvas's note-to-card trade is saved on a map as a
//    card at that station, free of the paths (the token stays the only piece they constrain); leaving restores it.
// 2. A map's paths are fixed outside focus and changed on purpose: on the canvas in focus (the path edits the
//    engine sends), in the chat ("connect Option B to Decide", "remove the path from Option A") and by exec
//    (workshop_edits connect_stations / disconnect_stations; add_card with free on a map). One change each.
// 3. The plan's span in focus is in timeline-chat.test.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { applyWorkshopEdits, validateWorkshop } from 'slateboxjs/workshops/model'
import { catalogPreset } from 'slateboxjs/catalog'
import { playWorkshopChanges, readWorkshopChanges } from '../web/app/server/methods/workshop-play.mjs'
import { proposeDirectMapEdit } from '../web/app/imports/api/common/map-direct-edits.mjs'
import { boardSuggestions, focusPlaceholder } from '../web/app/imports/api/common/board-focus.mjs'

const app = path => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const decision = () => validateWorkshop(catalogPreset('decision-path'))
const paths = model => model.lanes.flatMap(lane => lane.station.next.map(to => lane.id + '>' + to))

test('a note dropped on a station is saved as a card there, free of the paths; off the map it is the note again', () => {
  const map = decision()
  const station = map.lanes[2] // Option B
  const played = playWorkshopChanges(map, readWorkshopChanges([{ cardId: 'node_1', laneId: station.id, noteToCard: { noteId: 'node_1', label: 'Cheaper, slower', asNote: { shape: 'diamond' } } }]), ['node_1'])
  const card = played.workshop.cards.find(item => item.id === 'node_1')
  assert.deepEqual(card, { id: 'node_1', label: 'Cheaper, slower', laneId: station.id, asNote: { shape: 'diamond' }, free: true })
  // It goes to any step: The question is not on a path from Option B.
  const moved = playWorkshopChanges(played.workshop, [{ cardId: 'node_1', laneId: map.lanes[0].id }])
  assert.equal(moved.workshop.cards.find(item => item.id === 'node_1').laneId, map.lanes[0].id)
  // The token still follows the paths.
  const token = map.cards[0]
  const far = playWorkshopChanges(played.workshop, [{ cardId: token.id, laneId: map.lanes[3].id }])
  assert.match(far.refused.reason, /can't be reached from/)
  // Off the map: the note again.
  const off = playWorkshopChanges(played.workshop, readWorkshopChanges([{ cardId: 'node_1', cardToNote: { noteId: 'node_1' } }]), [])
  assert.deepEqual(off.workshop.cards.map(item => item.id), [token.id])
  // The token never leaves.
  assert.equal(playWorkshopChanges(played.workshop, readWorkshopChanges([{ cardId: token.id, cardToNote: { noteId: token.id } }]), []).refused.reason, 'The token stays on the map.')
})

test('a map’s path changed on the canvas in focus is saved as the path edits; nothing else is played by edits on a map', () => {
  const map = decision()
  const [question, optionA, optionB, decide] = map.lanes.map(lane => lane.id)
  const removed = playWorkshopChanges(map, readWorkshopChanges([{ edits: [{ kind: 'disconnect_stations', from: { id: optionA }, to: { id: decide } }], laneId: optionA }]))
  assert.deepEqual(paths(removed.workshop), [question + '>' + optionA, question + '>' + optionB, optionB + '>' + decide])
  const rerouted = playWorkshopChanges(map, readWorkshopChanges([{ edits: [
    { kind: 'disconnect_stations', from: { id: optionA }, to: { id: decide } }, { kind: 'connect_stations', from: { id: optionA }, to: { id: optionB } }] }]))
  assert.deepEqual(paths(rerouted.workshop), [question + '>' + optionA, question + '>' + optionB, optionA + '>' + optionB, optionB + '>' + decide])
  const other = playWorkshopChanges(map, readWorkshopChanges([{ edits: [{ kind: 'rename_lane', lane: { id: decide }, label: 'Done' }] }]))
  assert.equal(other.refused.reason, 'This workshop is played by moves and renames.')
})

test('in words: connect two steps, remove the path from a step (or ask which), one change each', () => {
  const map = decision()
  const optionA = map.lanes[1], decide = map.lanes[3]
  const cut = proposeDirectMapEdit(map, 'remove the path from Option A')
  assert.equal(cut.reply, 'Removed the path from “Option A” to “Decide”.')
  assert.deepEqual(cut.workshop.lanes.find(lane => lane.id === optionA.id).station.next, [])
  // The owner's phrase, on the map once Option B's path is gone.
  const lone = validateWorkshop({ ...map, lanes: map.lanes.map(lane => lane.id === map.lanes[2].id ? { ...lane, station: { ...lane.station, next: [] } } : lane) })
  const joined = proposeDirectMapEdit(lone, 'connect Option B to Decide')
  assert.equal(joined.reply, 'Connected “Option B” to “Decide”.')
  assert.ok(joined.workshop.lanes.find(lane => lane.id === map.lanes[2].id).station.next.includes(decide.id))
  assert.throws(() => proposeDirectMapEdit(map, 'remove the path from The question'), /^Error: From “The question” paths lead to “Option A” and “Option B”\. Say which, such as “Remove the path from The question to Option A”\.$/)
  assert.throws(() => proposeDirectMapEdit(map, 'remove the path to Decide'), /Say which/)
  assert.throws(() => proposeDirectMapEdit(map, 'remove the path from Decide'), /^Error: No path leads on from “Decide”\.$/)
  assert.throws(() => proposeDirectMapEdit(map, 'connect Option B to Decide'), /already leads to/)
})

test('with a card made from a note on the map, “the token” is still the token', () => {
  const map = decision()
  const withNote = validateWorkshop({ ...map, cards: [...map.cards, { id: 'note-1', label: 'Idea', laneId: map.lanes[1].id, free: true }] })
  const moved = proposeDirectMapEdit(withNote, 'move the token to Option A')
  assert.equal(moved.workshop.cards.find(card => card.id === map.cards[0].id).laneId, map.lanes[1].id)
})

test('a map in focus offers its own suggestions (connect, remove a path, a step), each of which the chat takes', () => {
  const map = decision()
  const offered = boardSuggestions(map).map(item => item.text)
  assert.deepEqual(offered, ['Connect The question to Decide', 'Remove the path from Option A', 'Add Follow-up after Decide', 'What else can this board do?'])
  for (const text of offered.slice(0, 3)) assert.ok(proposeDirectMapEdit(map, text).workshop, text)
  assert.equal(focusPlaceholder(map), 'Connect The question to Decide')
})

test('exec: a card at a step as a drop makes it (add_card free), and the path edits, one change each', () => {
  const map = decision()
  const made = applyWorkshopEdits(map, [{ kind: 'add_card', lane: 'Option B', label: 'Ask legal', free: true }])
  assert.deepEqual(made.workshop.cards.at(-1), { id: 'card-1', label: 'Ask legal', laneId: map.lanes[2].id, free: true })
  const cut = applyWorkshopEdits(map, [{ kind: 'disconnect_stations', from: 'Option A', to: 'Decide' }])
  assert.equal(cut.report.edits[0].said, 'Removed the path from “Option A” to “Decide”.')
})

test('the canvas: a picked path shows the board’s bar with “Change this board”; the chat reads a map’s own words before the AI turn', () => {
  const bar = app('imports/ui/components/stylebar/StyleBar.jsx')
  assert.match(bar, /workshop\.selection\?\.kind === 'path'/)
  assert.match(bar, /what === 'path' && \(\s*<BoardBar/)
  assert.match(app('imports/ui/components/workshop/useWorkshopOnCanvas.js'), /selected\.path \? \{ kind: 'path'/)
  const chat = app('imports/ui/components/workshop/WorkshopConversation.jsx')
  assert.ok(chat.indexOf('proposeDirectMapEdit(model, message') < chat.indexOf("Meteor.callAsync('workshops.mapChat'"), 'the map’s own sentences first')
  assert.match(chat, /const starters = focus \? boardSuggestions\(model, actor\)/)
})

test('a dated plan in focus offers its span in words first, and the chat takes it', async () => {
  const { goLiveSample, hiringPlanSample } = await import('slateboxjs/workshops/rules')
  await import('slateboxjs/workshops/behaviour')
  await import('../web/app/imports/api/common/board-chat.mjs')
  const plan = validateWorkshop(goLiveSample('2026-11-21'))
  assert.equal(boardSuggestions(plan)[0].text, 'Make this a 5-week plan')
  assert.equal(focusPlaceholder(plan), 'Make this a 5-week plan')
  assert.equal(boardSuggestions(validateWorkshop(hiringPlanSample('2026-11-21')))[0].text, 'Make this a 56-week plan')
})

test('the chat colours a pipeline’s deal (a business board) and a card made from a note on a map; a map’s token keeps its colour', async () => {
  const { proposeLaneReply } = await import('../web/app/imports/api/common/lane-conversation.mjs')
  const { pipelineFromBrief } = await import('../web/app/imports/api/common/pipeline-brief.mjs')
  const pipeline = pipelineFromBrief('Make a sales pipeline with Northwind 40k, Acme 25k, target 250k')
  const coloured = proposeLaneReply(pipeline, 'colour Northwind red')
  assert.equal(coloured.reply, 'Coloured “Northwind” red.')
  assert.equal(coloured.workshop.cards.find(card => card.label === 'Northwind').look.backgroundColor, '#f4b6b6')
  const map = playWorkshopChanges(decision(), readWorkshopChanges([{ cardId: 'node_1', laneId: decision().lanes[2].id, noteToCard: { noteId: 'node_1', label: 'Ask legal' } }]), ['node_1']).workshop
  // A map's chat (its own): a card made from a note takes a colour, the token keeps its own.
  const blue = proposeDirectMapEdit(map, 'colour Ask legal blue')
  assert.equal(blue.reply, 'Coloured “Ask legal” blue.')
  assert.equal(blue.workshop.cards.find(card => card.id === 'node_1').look.backgroundColor, '#b9d4f1')
  assert.throws(() => proposeDirectMapEdit(map, 'colour ' + map.cards[0].label + ' blue'), /The token keeps its own colour/)
  // A release plan's features keep theirs, as before.
  const { releasePlan } = await import('slateboxjs/workshops/model')
  assert.throws(() => proposeLaneReply(releasePlan, 'colour ' + releasePlan.cards[0].label + ' red'), /keep their own colour/)
})

test('a release plan’s feature saves with the points written on its note, and comes back off the plan with them', async () => {
  const { releasePlan, workshopCardNoteText } = await import('slateboxjs/workshops/model')
  const lane = releasePlan.lanes.at(-1).id
  // The canvas sends the card's words with its points (workshopCardNoteText), as it does for a drop and an undo.
  const change = { cardId: 'node_9', laneId: lane, noteToCard: { noteId: 'node_9', label: 'Audit log · 3 points' } }
  const played = playWorkshopChanges(releasePlan, readWorkshopChanges([change]), ['node_9'])
  const card = played.workshop.cards.find(item => item.id === 'node_9')
  assert.deepEqual([card.label, card.points], ['Audit log', 3])
  assert.equal(workshopCardNoteText(played.workshop, card), 'Audit log · 3 points')
  // Delivered twice: the same card, not someone else's.
  const again = playWorkshopChanges(played.workshop, readWorkshopChanges([change]), ['node_9'])
  assert.equal(again.refused, undefined)
  assert.equal(again.workshop.cards.filter(item => item.id === 'node_9').length, 1)
  // Off the plan: the note says its points.
  const off = playWorkshopChanges(played.workshop, readWorkshopChanges([{ cardId: 'node_9', cardToNote: { noteId: 'node_9' } }]), [])
  assert.equal(off.refused, undefined)
  assert.ok(!off.workshop.cards.some(item => item.id === 'node_9'))
})

test('a map step’s limit counts tokens: a note on a full step is saved as a card there; exec adds a free card there too', () => {
  const map = decision()
  const decide = map.lanes[3].id
  const full = validateWorkshop({ ...map, lanes: map.lanes.map(lane => lane.id === decide ? { ...lane, capacity: 1 } : lane),
    cards: map.cards.map(card => ({ ...card, laneId: decide })) })
  const played = playWorkshopChanges(full, readWorkshopChanges([{ cardId: 'node_1', laneId: decide, noteToCard: { noteId: 'node_1', label: 'Ask legal' } }]), ['node_1'])
  assert.equal(played.refused, undefined)
  assert.deepEqual(played.workshop.cards.find(item => item.id === 'node_1'), { id: 'node_1', label: 'Ask legal', laneId: decide, free: true })
  const added = applyWorkshopEdits(full, [{ kind: 'add_card', lane: { id: decide }, label: 'Ask finance', free: true }])
  assert.ok(!('refused' in added), added.refused?.reason)
  const limit = applyWorkshopEdits(played.workshop, [{ kind: 'set_lane_capacity', lane: { id: decide }, capacity: 1 }])
  assert.ok(!('refused' in limit), limit.refused?.reason)
})
