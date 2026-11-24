// The library (library final.md L1+L2) and the rulebook (dragology final.md D1), as the chat and
// the panel use them: rule phrases, the business boards' phrases, "How does this board behave?",
// "Why can't I move X?", catalogue adds read locally, chips that are checked to parse, and the
// listing gate (an entry is listed only when every edit it offers has a phrase that parses).
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyWorkshopEdits, validateWorkshop } from 'slateboxjs/workshops/model'
import { sampleBudget, sampleLaunchPlan, samplePipeline } from 'slateboxjs/workshops/rules'
import { catalogSamples as samples } from 'slateboxjs/workshops/samples'
import 'slateboxjs/workshops/behaviour'
import { catalog, catalogPreset } from 'slateboxjs/catalog'
import { proposeLaneReply } from '../web/app/imports/api/common/lane-conversation.mjs'
import '../web/app/imports/api/common/board-chat.mjs'
import { proposeDirectMapEdit } from '../web/app/imports/api/common/map-direct-edits.mjs'
import { boardMoves, catalogSample, freshRename, libraryTurn, listedEntries, startersFor } from '../web/app/imports/api/common/library.mjs'
import { nativeCanvasDraft, nativeRequestKind } from '../web/app/imports/api/common/native-canvas-conversation.mjs'
import { workshopStarters } from '../web/app/imports/api/common/workshop-starters.mjs'

const tim = { by: 'Tim' }
// A team board with three cards in Review, as a team has it the day they agree "Review holds 2".
const team = (() => {
  const board = catalogPreset('team-board')
  const cards = [['billing', 'Billing', 'todo'], ['search', 'Search', 'doing'], ['export', 'Export', 'review'], ['auth', 'Auth', 'review'], ['docs', 'Docs', 'review']]
  return validateWorkshop({ ...board, cards: cards.map(([id, label, laneId]) => ({ id, label, laneId })) })
})()
const say = (board, message, selection = null) => proposeLaneReply(board, message, selection, tim)
// A move a rule refuses is not made: offered as "Move anyway" with the rule's sentence (move-anyway.mjs), the card
// marked with that rule, the board asked about unchanged.
function refusedButOffered(board, message, sentence) {
  const before = JSON.stringify(board)
  const made = say(board, message)
  assert.ok(made.override, message + ': offered as Move anyway')
  assert.equal(made.override.sentence, sentence)
  assert.ok(made.reply.includes(' by this board’s rules. ' + sentence + ' Move it anyway?'), made.reply)
  assert.equal(made.workshop.cards.find(card => card.id === made.override.cardId).override.sentence, sentence)
  assert.equal(JSON.stringify(board), before)
  return made
}
// The same board before anyone set a rule.
const bare = validateWorkshop({ ...team, behaviour: { version: 1, rev: 0, rules: [] } })

test('“make that a rule” adds a rule that moves nothing: Review shows 3 of 2, and the next arrival is refused', () => {
  const kept = say(team, 'Make that a rule: Review holds 2')
  const rule = kept.workshop.behaviour.rules.at(-1)
  assert.deepEqual({ kind: rule.kind, where: rule.where, max: rule.max, by: rule.set.by, via: rule.set.via }, { kind: 'capacity', where: 'review', max: 2, by: 'Tim', via: 'chat' })
  assert.equal(kept.workshop.cards.filter(card => card.laneId === 'review').length, 3)
  assert.deepEqual(kept.diff, { from: 0, to: 1, lines: ['+ Review holds 2.'], over: ['Review shows 3 of 2.'] })
  assert.match(kept.reply, /^New rule: Review holds 2\./)
  refusedButOffered(kept.workshop, 'Move Search to Review', 'Review holds 2. It has 3.')
  // On a board with a rulebook, "Let Review hold 3" changes the rule, not the lane.
  const raised = say(kept.workshop, 'Let Review hold 3')
  assert.equal(raised.workshop.behaviour.rules.at(-1).max, 3)
  assert.equal(raised.workshop.lanes.find(lane => lane.id === 'review').capacity, undefined)
})

test('the D1 phrases: one lane at a time, a path, a bin, warn instead, off, removed', () => {
  const step = say(bare, 'Cards move one column at a time').workshop
  refusedButOffered(step, 'Move Billing to Review', 'Cards move one column at a time. Billing is in To do, so Doing comes first.')
  const path = say(bare, 'From Doing, cards go only to Review').workshop
  assert.equal(path.behaviour.rules.at(-1).kind, 'path')
  refusedButOffered(path, 'Move Search to Done', 'From Doing, cards go only to Review.')
  const binned = say(team, 'Make Done a bin').workshop
  assert.deepEqual(binned.behaviour.rules.at(-1).lane, 'done')
  const capped = say(team, 'Review holds 2').workshop
  const warned = say(capped, 'Just warn me when Review is full').workshop
  assert.equal(warned.behaviour.rules.at(-1).severity, 'warn')
  assert.equal(say(warned, 'Move Search to Review').workshop.cards.find(card => card.id === 'search').laneId, 'review')
  const off = say(capped, 'Turn the Review limit off').workshop
  assert.equal(off.behaviour.rules.at(-1).on, false)
  const gone = say(capped, 'Remove the Review rule').workshop
  assert.equal(gone.behaviour.rules.some(rule => rule.where === 'review'), false)
  // A phrase the rulebook can't express yet gets the honest boundary answer.
  assert.throws(() => say(team, 'Bugs can skip Review'), /I can’t make that a rule yet\. I can make a path, such as “From Doing, cards go only to Review”\./)
})

test('“How does this board behave?” and “Why can’t I move X?” are answered locally, with who set the rule', () => {
  const kept = say(team, 'Review holds 2').workshop
  const how = say(kept, 'How does this board behave?')
  assert.equal(how.workshop, undefined)
  assert.equal(how.reply, 'How this board behaves:\n• Cards move one column at a time.\n• Doing holds 3.\n• Won\'t do archives cards: they stay on the board, never deleted.\n• Review holds 2.')
  const why = say(kept, 'Why can’t I move Search to Review?')
  assert.match(why.reply, /^Review holds 2\. It has 3\. Tim set that rule on \d{1,2} [A-Z][a-z]{2}\. Search can go to To do instead\.$/)
  assert.equal(say(kept, 'Why can’t I move Billing to Doing?').reply, 'Billing can move to Doing.')
})

test('the business boards’ phrases run the engine’s own edits', () => {
  const launch = validateWorkshop(sampleLaunchPlan())
  assert.equal(say(launch, 'Make Copy 3 days').workshop.cards.find(card => card.label === 'Copy').duration, 3)
  assert.equal(say(launch, 'Move launch to day 20').workshop.launch.day, 20)
  const pipeline = validateWorkshop(samplePipeline())
  assert.equal(say(pipeline, 'Make Acme $40k').workshop.cards.find(card => card.label === 'Acme').amount, 40000)
  assert.equal(say(pipeline, 'Set the target to $300k').workshop.forecast.target, 300000)
  const gated = say(pipeline, 'Qualified needs an amount').workshop
  assert.equal(gated.behaviour.rules[0].kind, 'gate')
  const budget = validateWorkshop(sampleBudget())
  const lanes = budget.lanes.map(lane => lane.label)
  const shifted = say(budget, `Move $10k from ${lanes[0]} to ${lanes[1]}`).workshop
  assert.notEqual(shifted.lanes[0].allocation, budget.lanes[0].allocation)
})

test('a catalogue add is read locally, and drafted from the preset with its rules', () => {
  assert.equal(nativeRequestKind('Add a retro'), 'component')
  assert.equal(nativeRequestKind('Add a retro about the Q3 launch'), 'component')
  assert.equal(nativeRequestKind('Make a workshop with Now, Next and Later'), 'lanes')
  const draft = nativeCanvasDraft({ nodes: [] }, 'Add a retro about the Q3 launch', 'a'.repeat(17), undefined, samples)
  assert.equal(draft.mode, 'play')
  assert.equal(draft.format, 'lanes')
  assert.equal(draft.component, 'retro')
  assert.equal(draft.workshop.title, 'Retro: the Q3 launch')
  assert.equal(draft.workshop.behaviour.rules.length, 3)
  const pipeline = nativeCanvasDraft({ nodes: [] }, 'Add a sales pipeline', 'a'.repeat(17), undefined, samples)
  assert.equal(pipeline.format, 'pipeline')
  const path = nativeCanvasDraft({ nodes: [] }, 'Add a decision path', 'a'.repeat(17), undefined, samples)
  assert.equal(path.mode, 'play')
  assert.ok(path.workshop.lanes[0].station)
})

test('“what can I add?” is a catalogue turn, with no AI call', () => {
  assert.deepEqual(libraryTurn('What can I add?'), { kind: 'catalog', all: true, entries: listedEntries().map(entry => entry.id) })
  assert.deepEqual(libraryTurn('something to track deals').entries[0], 'sales-pipeline')
  assert.equal(libraryTurn('Move Billing to Done'), null)
})

test('the listing gate: every edit an entry offers has a phrase that parses on its sample, and every rule kind changes the next drag', () => {
  for (const entry of catalog) {
    const sample = catalogSample(entry.id, samples)
    const offered = startersFor(entry, sample, null, { all: true })
    for (const edit of entry.edits) {
      const phrase = offered.find(item => item.edit === edit)
      assert.ok(phrase, entry.id + ': no phrase for ' + edit)
    }
    for (const item of offered) {
      if (sample.lanes[0].station) proposeDirectMapEdit(sample, item.text)
      else say(item.on ?? sample, item.text)
    }
    for (const kind of entry.rules) {
      const phrase = offered.find(item => item.rule === kind)
      assert.ok(phrase, entry.id + ': no phrase for the rule ' + kind)
      const ruled = say(sample, phrase.text).workshop
      assert.ok(phrase.changes(sample, ruled), entry.id + ': “' + phrase.text + '” changes no drag')
    }
  }
  assert.deepEqual(listedEntries().map(entry => entry.id), catalog.map(entry => entry.id))
})

test('chips are real: at most three, each parses as it stands, for a board, a lane and a card', () => {
  const selections = [null, { kind: 'lane', id: 'review' }, { kind: 'card', id: 'search' }]
  for (const selection of selections) {
    const chips = workshopStarters(team, selection)
    assert.ok(chips.length > 0 && chips.length <= 3)
    for (const chip of chips) say(team, chip.text, selection)
  }
  const moves = boardMoves(team)
  assert.ok(moves.length >= 3)
  assert.ok(moves.every(move => typeof move.words === 'string' && typeof move.text === 'string'))
  for (const move of moves) say(team, move.text)
})

// aicontrol fixes (2026-11-24): the item page's "Say it like this" never suggests a rename to a name the
// board already has; the example is made from the board's real lanes, cards and title.
test('a rename example never gives a column, a card or the board a name it already has', () => {
  const blocked = validateWorkshop({ ...catalogPreset('team-board'), title: 'Team review',
    lanes: [{ id: 'todo', label: 'To do' }, { id: 'blocked', label: 'Blocked' }, { id: 'onhold', label: 'On hold' }, { id: 'done', label: 'Done' }],
    cards: [{ id: 'a', label: 'Review notes', laneId: 'todo' }, { id: 'b', label: 'Billing', laneId: 'blocked' }], behaviour: undefined })
  const moves = boardMoves(blocked)
  const lanes = blocked.lanes.map(lane => lane.label.toLowerCase())
  const cards = blocked.cards.map(card => card.label.toLowerCase())
  const renames = moves.map(move => /^Rename (.+) to (.+)$/.exec(move.text)).filter(Boolean)
  assert.ok(renames.length >= 2, 'the board still has rename examples')
  for (const [text, from, to] of renames) {
    assert.notEqual(to.toLowerCase(), from.toLowerCase(), text)
    if (from === 'the board') assert.notEqual(to.toLowerCase(), blocked.title.toLowerCase(), text)
    else if (lanes.includes(from.toLowerCase())) assert.ok(!lanes.includes(to.toLowerCase()), text + ': a column already has that name')
    else assert.ok(!cards.includes(to.toLowerCase()), text + ': a card already has that name')
  }
  assert.ok(moves.some(move => move.text === 'Rename To do to Waiting'), moves.map(move => move.text).join(' | '))
  for (const move of moves) say(blocked, move.text)
  // Where the catalogue's own name is free, the example stays as it was.
  assert.equal(freshRename('Rename To do to Blocked', team, 'rename_lane'), 'Rename To do to Blocked')
  assert.equal(freshRename('Rename the board to Team review', team, 'rename_workshop'), 'Rename the board to Team review')
  assert.equal(freshRename('Move Billing to Done', blocked, 'move_card'), 'Move Billing to Done')
})

test('the rules travel through the one door: a whole-board save that breaks them is refused', () => {
  const kept = say(team, 'Review holds 2').workshop
  const result = applyWorkshopEdits(kept, [{ kind: 'move_card', card: 'Search', lane: 'Review' }])
  assert.equal(result.refused.reason, 'Review holds 2. It has 3.')
})
