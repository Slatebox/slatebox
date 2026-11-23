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
import { boardMoves, catalogSample, libraryTurn, listedEntries, startersFor } from '../web/app/imports/api/common/library.mjs'
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
// The same board before anyone set a rule.
const bare = validateWorkshop({ ...team, behaviour: { version: 1, rev: 0, rules: [] } })

test('“make that a rule” adds a rule that moves nothing: Review shows 3 of 2, and the next arrival is refused', () => {
  const kept = say(team, 'Make that a rule: Review holds 2')
  const rule = kept.workshop.behaviour.rules.at(-1)
  assert.deepEqual({ kind: rule.kind, where: rule.where, max: rule.max, by: rule.set.by, via: rule.set.via }, { kind: 'capacity', where: 'review', max: 2, by: 'Tim', via: 'chat' })
  assert.equal(kept.workshop.cards.filter(card => card.laneId === 'review').length, 3)
  assert.deepEqual(kept.diff, { from: 0, to: 1, lines: ['+ Review holds 2.'], over: ['Review shows 3 of 2.'] })
  assert.match(kept.reply, /^New rule: Review holds 2\./)
  assert.throws(() => say(kept.workshop, 'Move Search to Review'), /Review holds 2\. It has 3\./)
  // On a board with a rulebook, "Let Review hold 3" changes the rule, not the lane.
  const raised = say(kept.workshop, 'Let Review hold 3')
  assert.equal(raised.workshop.behaviour.rules.at(-1).max, 3)
  assert.equal(raised.workshop.lanes.find(lane => lane.id === 'review').capacity, undefined)
})

test('the D1 phrases: one lane at a time, a path, a bin, warn instead, off, removed', () => {
  const step = say(bare, 'Cards move one lane at a time').workshop
  assert.throws(() => say(step, 'Move Billing to Review'), /Cards move one lane at a time\. Billing is in To do, so Doing comes first\./)
  const path = say(bare, 'From Doing, cards go only to Review').workshop
  assert.equal(path.behaviour.rules.at(-1).kind, 'path')
  assert.throws(() => say(path, 'Move Search to Done'), /From Doing, cards go only to Review\./)
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
  assert.equal(how.reply, 'How this board behaves:\n• Cards move one lane at a time.\n• Doing holds 3.\n• Won\'t do archives cards: they stay on the board, never deleted.\n• Review holds 2.')
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

test('the rules travel through the one door: a whole-board save that breaks them is refused', () => {
  const kept = say(team, 'Review holds 2').workshop
  const result = applyWorkshopEdits(kept, [{ kind: 'move_card', card: 'Search', lane: 'Review' }])
  assert.equal(result.refused.reason, 'Review holds 2. It has 3.')
})
