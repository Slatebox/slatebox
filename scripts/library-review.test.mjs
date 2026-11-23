// The hostile review of the library (L1+L2) and the rulebook (D1) on the app side: each finding as a
// test, written before its fix. The engine's half is slateboxjs tests/unit/workshop-behaviour-review.test.ts.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { applyWorkshopEdits, validateWorkshop } from 'slateboxjs/workshops/model'
import { samplePipeline } from 'slateboxjs/workshops/rules'
import 'slateboxjs/workshops/behaviour'
import { catalog, catalogPreset } from 'slateboxjs/catalog'
import { proposeLaneReply } from '../web/app/imports/api/common/lane-conversation.mjs'
import '../web/app/imports/api/common/board-chat.mjs'
import { libraryTurn, newSlateTurn } from '../web/app/imports/api/common/library.mjs'
import { nativeRequestKind } from '../web/app/imports/api/common/native-canvas-conversation.mjs'
import { recordedUndo, replaceWorkshop, notTheBoards } from '../web/app/server/methods/workshop-replace.mjs'
import { playWorkshopChanges, readWorkshopChanges } from '../web/app/server/methods/workshop-play.mjs'

const app = path => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const tim = { by: 'Tim' }
const say = (board, message, selection = null) => proposeLaneReply(board, message, selection, tim)
// The Team board preset with Search in To do.
const team = validateWorkshop({ ...catalogPreset('team-board'), cards: [
  { id: 'billing', label: 'Billing', laneId: 'todo' }, { id: 'search', label: 'Search', laneId: 'todo' }, { id: 'export', label: 'Export', laneId: 'doing' },
] })
const copy = value => JSON.parse(JSON.stringify(value))
const save = (stored, next, extra = {}) => replaceWorkshop(stored, next, { revision: 4, current: 4, userId: 'tim', actor: { by: 'Tim' }, ...extra })

test('finding 1: a whole save cannot remove the rules and break them at once; the server stamps the audit line', () => {
  const broken = { ...copy(team), behaviour: { version: 1, rev: 99, rules: [] } }
  broken.cards.find(card => card.id === 'search').laneId = 'done'
  assert.equal(save(team, broken).refused.reason, 'Change the rules on their own, then move cards.')
  // A rule edit kept from the chat is made again on the server, with the saver's audit line, whatever the page sent.
  const kept = say(team, 'Review holds 2').workshop
  const forged = copy(kept)
  forged.behaviour.rules.at(-1).set = { by: 'Someone else', at: '2020-01-01T00:00:00.000Z', via: 'preset' }
  const result = save(team, forged, { actor: { by: 'Ana' } })
  assert.deepEqual({ by: result.workshop.behaviour.rules.at(-1).set.by, via: result.workshop.behaviour.rules.at(-1).set.via }, { by: 'Ana', via: 'chat' })
  assert.notEqual(result.workshop.behaviour.rules.at(-1).set.at, '2020-01-01T00:00:00.000Z')
  // A save that changes no rule keeps the stored rulebook, audit lines included.
  const moved = copy(team)
  moved.cards.find(card => card.id === 'billing').laneId = 'doing'
  moved.behaviour.rules[0].set = { by: 'Mallory', at: '2020-01-01T00:00:00.000Z', via: 'chat' }
  assert.deepEqual(save(team, moved).workshop.behaviour, team.behaviour)
  // A rule edit the reducer would not make (a rule changed under the same id) is refused.
  const swapped = copy(team)
  swapped.behaviour = { ...swapped.behaviour, rev: 1, rules: swapped.behaviour.rules.map(rule => rule.kind === 'capacity' ? { ...rule, where: 'review' } : rule) }
  assert.equal(save(team, swapped).refused.reason, notTheBoards)
})

test('finding 2: a rule made in chat on the pipeline is kept by a whole save', () => {
  const pipeline = validateWorkshop(samplePipeline())
  const made = say(pipeline, 'Qualified needs an amount').workshop
  const result = save(pipeline, made)
  assert.ok(result.workshop, result.refused?.reason)
  assert.equal(result.workshop.behaviour.rules[0].kind, 'gate')
  assert.equal(result.workshop.behaviour.rules[0].set.by, 'Tim')
  // A business board's own edit still goes through its own replay.
  const priced = say(pipeline, 'Make Acme $40k').workshop
  assert.equal(save(pipeline, priced).workshop.cards.find(card => card.id === 'acme').amount, 40000)
})

test('finding 5: Undo of a rule edit puts the rules back under a newer revision; a stale page hears it is stale', () => {
  const kept = save(team, say(team, 'Review holds 2').workshop).workshop
  const undo = recordedUndo(team, 5, 'tim')
  assert.deepEqual(undo, { revision: 5, by: 'tim', workshop: team })
  const back = save(kept, copy(team), { undo, revision: 5, current: 5 })
  assert.equal(back.undone, true)
  assert.deepEqual(back.workshop.behaviour.rules, team.behaviour.rules)
  assert.ok(back.workshop.behaviour.rev > kept.behaviour.rev)
  // A save made on an older revision is stale before it is anything else.
  assert.deepEqual(save(kept, copy(team), { revision: 3, current: 5 }), { stale: true })
  // The play path records an Undo for a board with rules too.
  assert.ok(recordedUndo(kept, 6, 'tim'))
  assert.equal(recordedUndo({ version: 1, title: 'Week', lanes: [], cards: [] }, 3, 'tim'), null)
})

test('finding 9: removing a lane that has a rule takes the rule with it, said in the diff', () => {
  const kept = say(team, "Remove the Won't do lane")
  assert.equal(kept.workshop.lanes.some(lane => lane.id === 'wont'), false)
  assert.equal(kept.workshop.behaviour.rules.some(rule => rule.kind === 'bin'), false)
  assert.deepEqual(kept.diff.lines, ['- Won\'t do archives cards: they stay on the board, never deleted.'])
  // And the whole save that keeps it is accepted (a lane removed takes its rules; that is not a rule edit).
  assert.ok(save(team, kept.workshop).workshop)
})

test('finding 16: “Remove the Doing limit” removes the limit only; “Remove the Doing rules” removes them all', () => {
  const path = say(team, 'From Doing, cards go only to Review').workshop
  const limitless = say(path, 'Remove the Doing limit').workshop
  assert.equal(limitless.behaviour.rules.some(rule => rule.kind === 'capacity' && rule.where === 'doing'), false)
  assert.equal(limitless.behaviour.rules.some(rule => rule.kind === 'path' && rule.from === 'doing'), true)
  const ruleless = say(path, 'Remove the Doing rules').workshop
  assert.equal(ruleless.behaviour.rules.some(rule => rule.where === 'doing' || rule.from === 'doing'), false)
})

test('finding 3: ordinary messages reach the drawing and the rule grammar, not the catalogue', () => {
  for (const message of ['I want a flow chart of our onboarding', 'I need a diagram of the sales process', 'we need a timeline for the launch',
    'we need to limit Doing', 'I want to move Search to Done']) assert.equal(libraryTurn(message), null, message)
  assert.equal(libraryTurn('I need a board to track deals').entries[0], 'sales-pipeline')
  // The conversation on a board asks the board's grammar before the catalogue.
  const source = app('imports/ui/components/workshop/WorkshopConversation.jsx')
  assert.ok(source.indexOf('proposeLaneReply(model') < source.indexOf('libraryTurn(message)'), 'the lane reply is asked first')
})

test('finding 4: a contradiction said in chat is refused with its sentence', () => {
  assert.throws(() => say(team, 'Make that a rule: From Doing, cards go only to Done'),
    /Cards move one lane at a time, so cards in Doing could never reach Done\./)
})

test('finding 6: add_rule over exec cannot forge the audit line or the id', () => {
  const result = applyWorkshopEdits(team, [{ kind: 'add_rule', rule: { kind: 'capacity', where: 'review', max: 2, id: 'zz', on: false, set: { by: 'Tim (owner)', at: '2020-01-01', via: 'preset' } } }])
  assert.equal(result.refused.code, 'invalid_edit')
  const contract = JSON.parse(app('server/actions/generated/contract.json'))
  const text = JSON.stringify(contract)
  // The rule's body only: its kinds (the lane rules, the plans' time rules, the nested boards' rules, and those of the 2 by 2, the
  // org chart and goals & owners), then severity; never an id, on or set.
  assert.match(text, /"kind":\{"enum":\["capacity","path","gate","bin","deadline","overlap","snap","workdays","blackout","cascade","locked","nests","children","depth","rank","emptyDrop","quadrant","parent","contains","sameOwnerAs"\]\},"severity"/)
})

test('finding 7: a card in the bin is archived, never deleted, in chat', () => {
  const binned = say(team, "Move Export to Won't do").workshop
  assert.throws(() => say(binned, 'Remove Export'), /Won't do archives cards: they stay on the board, never deleted\./)
})

test('finding 8: a warn rule lets the drop land and says its sentence', () => {
  const warned = say(say(team, 'Let Doing hold 1').workshop, 'Just warn me when Doing is full').workshop
  const played = playWorkshopChanges(warned, readWorkshopChanges([{ cardId: 'billing', laneId: 'doing' }]))
  assert.equal(played.workshop.cards.find(card => card.id === 'billing').laneId, 'doing')
  assert.deepEqual(played.warnings, ['Doing holds 1. It has 1.'])
  const method = app('server/methods/creative-slates.js')
  assert.match(method, /warnings/)
  assert.match(app('imports/ui/components/workshop/useWorkshopOnCanvas.js'), /result\.warnings/)
})

test('finding 10: the loops stop for reduced motion, and the strip and + menu show stills', () => {
  for (const entry of catalog) {
    const loop = app('public/library/' + entry.id + '.svg')
    assert.match(loop, /@media \(prefers-reduced-motion:\s?reduce\)/, entry.id)
    const still = 'public/library/' + entry.id + '-still.svg'
    assert.ok(existsSync(new URL('../web/app/' + still, import.meta.url)), still)
    assert.doesNotMatch(app(still), /animation|@keyframes/, still)
  }
  // The strip, and the + menu's rows (their own lazy chunk, drawn by the desktop dock and the phone sheet).
  for (const file of ['imports/ui/components/library/AddStrip.jsx', 'imports/ui/components/library/BoardsRows.jsx']) {
    assert.match(app(file), /-still\.svg/, file)
  }
  for (const file of ['imports/ui/components/stylebar/AddTools.jsx', 'imports/ui/components/node/QuickNodeActions.jsx']) {
    assert.match(app(file), /React\.lazy\(\(\) => loadBoardsRows\(\)/, file)
  }
})

test('finding 11: no controls nested in options or buttons, and labelled regions have a role', () => {
  const view = app('imports/ui/components/library/LibraryView.jsx')
  assert.doesNotMatch(view, /role="option"/)
  assert.doesNotMatch(view, /role="listbox"/)
  assert.doesNotMatch(view, /<Box aria-label=/)
  const dock = app('imports/ui/components/node/QuickNodeActions.jsx')
  assert.doesNotMatch(dock.slice(dock.indexOf('function BoardsDock')), /role="button"/)
})

// Many boards on a slate (S4a): an entry is added beside the boards; only a slate holding 8 opens it on a new
// slate, and that still asks first and keeps a pending preview.
test('finding 13: an entry that opens on a new slate (a slate of 8 boards) asks first, and keeps a pending preview', () => {
  const turn = newSlateTurn(catalog.find(entry => entry.id === 'retro'))
  assert.deepEqual(turn, { role: 'assistant', content: 'This slate holds 8 boards, the most for now. Add a retro on a new slate?', opens: 'Add a retro' })
  const source = app('imports/ui/components/workshop/WorkshopConversation.jsx')
  assert.match(source, /if \(full\) \{ append\(newSlateTurn\(found\)\); return \}/)
  assert.match(source, /Keep or discard the preview first/)
  assert.doesNotMatch(source, /This slate has a board already/)
})

test('finding 15: an add request with real details is a brief', () => {
  assert.notEqual(nativeRequestKind('Create a team board for Platform: Todo, Doing, Done'), 'component')
  assert.equal(nativeRequestKind('Make a sales pipeline for Acme 40k, Globex 60k'), 'board')
})
