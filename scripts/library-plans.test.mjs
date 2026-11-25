// The plans in the chat (dragology final.md D2 and D3): a launch plan's and a go-live's rules said in
// plain words (a soft line, stop instead of push, a freeze, overlap, locks, snap, working days, dates),
// a what-if answered without a change, and a hiring plan's runway floor, band costs, round and hires.
// Every phrase runs the engine's own edits, and every rule phrase changes the next drag.
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyWorkshopEdits, validateWorkshop } from 'slateboxjs/workshops/model'
import { goLiveSample, hiringPlanSample, launchPlanSample, legalRuns, runwayMonths, scheduleLaunch } from 'slateboxjs/workshops/rules'
import { catalogSamples } from 'slateboxjs/workshops/samples'
import { behaviourLines } from 'slateboxjs/workshops/behaviour'
import { catalogEntry } from 'slateboxjs/catalog'
import { proposeLaneReply } from '../web/app/imports/api/common/lane-conversation.mjs'
import '../web/app/imports/api/common/board-chat.mjs'
import { boardMoves, catalogSample, dragsDiffer, entryOfBoard, startersFor } from '../web/app/imports/api/common/library.mjs'
import { readWorkshop } from '../web/app/server/workshop-read.mjs'

const today = '2026-11-21' // plans start Monday Nov 23
const tim = { by: 'Tim' }
const say = (board, message) => proposeLaneReply(board, message, null, tim)
const launch = () => validateWorkshop(launchPlanSample(today))
const hiring = () => validateWorkshop(hiringPlanSample(today))
const rules = board => board.behaviour.rules.map(rule => rule.kind + (rule.severity === 'warn' ? ':warn' : '') + (rule.onConflict ? ':' + rule.onConflict : ''))

test('a launch plan’s rules in plain words: soft line, stop, freeze, overlap, lock, snap, working days', () => {
  const plan = launch()
  const soft = say(plan, 'Let things slip past launch but show them in red')
  assert.deepEqual(soft.diff.lines, ['~ Launch is a hard line: every task ends by Fri, Dec 11. → Launch is a soft line: a task may slip past it, shown in red.'])
  assert.equal(say(soft.workshop, 'Make launch a hard line').workshop.behaviour.rules.find(rule => rule.kind === 'deadline').severity, 'refuse')
  const stop = say(plan, 'Stop me instead of pushing dependent tasks').workshop
  assert.ok(rules(stop).includes('cascade:stop'))
  assert.throws(() => say(stop, 'Start Design 1 day later'), /Design would end after Build starts on Fri, Nov 27\./)
  assert.ok(rules(say(stop, 'Push dependent tasks when I slip something').workshop).includes('cascade:push'))
  const frozen = say(plan, 'Nothing ships in code freeze, Nov 26 to Nov 27')
  assert.deepEqual(frozen.diff.lines, ['+ Nothing ships in code freeze, Nov 26 – Nov 27.'])
  assert.throws(() => say(frozen.workshop, 'Start Copy 3 days later'), /Copy would run into code freeze \(Nov 26 – Nov 27\)\./)
  // Dates across the new year: the end is the next Jan 3 after the start.
  const winter = say(plan, 'Nothing ships in holiday freeze, Dec 20 to Jan 3').workshop.behaviour.rules.at(-1)
  assert.deepEqual([winter.start, winter.end, winter.label], ['2026-12-20', '2027-01-03', 'holiday freeze'])
  assert.ok(rules(say(plan, 'Engineering’s tasks can’t overlap').workshop).includes('overlap'))
  const locked = say(plan, 'Lock QA, the agency booked it').workshop
  assert.deepEqual(locked.behaviour.rules.at(-1).cards, ['qa'])
  assert.throws(() => say(locked, 'Start Design 1 day later'), /QA is locked: it stays on Mon, Dec 7\./)
  assert.equal(say(locked, 'Unlock QA').workshop.behaviour.rules.some(rule => rule.kind === 'locked'), false)
  // A lock an agent set on two tasks at once: unlocking one keeps the other locked.
  const both = applyWorkshopEdits(plan, [{ kind: 'add_rule', rule: { kind: 'locked', cards: ['QA', 'Copy'] } }], { actor: { by: 'Agent', via: 'exec' } }).workshop
  const one = say(both, 'Unlock QA').workshop.behaviour.rules.filter(rule => rule.kind === 'locked')
  assert.deepEqual(one.map(rule => rule.cards), [['copy']])
  assert.throws(() => say(say(both, 'Unlock QA').workshop, 'Start Copy 1 day later'), /Copy is locked/)
  assert.ok(rules(say(plan, 'Snap to weeks').workshop).includes('snap'))
  assert.equal(say(plan, 'Weekends count').workshop.behaviour.rules.find(rule => rule.kind === 'workdays').on, false)
})

test('dates and what-ifs on a launch plan', () => {
  const plan = launch()
  const moved = say(plan, 'Move launch to Fri 18 Dec')
  assert.equal(moved.workshop.launch.day, 25)
  assert.equal(moved.reply, 'Launch is now Fri, Dec 18.')
  assert.throws(() => say(plan, 'Move launch to Mon 7 Dec'), /QA would run until Tue, Dec 8; launch is Mon, Dec 7\./)
  // A what-if changes nothing: it says what would happen.
  assert.equal(say(plan, 'What breaks if Design slips a week?').reply, 'That breaks a rule: QA would run until Tue, Dec 15; launch is Fri, Dec 11.')
  assert.match(say(plan, 'What breaks if Copy slips 2 days?').reply, /^Nothing breaks\. “Copy” now takes 2 days and waits 2 days\.$/)
  assert.match(say(plan, 'How does this plan behave?').reply, /^How this board behaves:\n• Days are working days: weekends don’t count\.\n• Launch is a hard line/)
})

test('a go-live is a launch plan with its own line word', () => {
  const plan = validateWorkshop(goLiveSample(today))
  assert.equal(entryOfBoard(plan).id, 'customer-go-live')
  assert.equal(say(plan, 'Let things slip past go-live but show them in red').workshop.behaviour.rules.find(rule => rule.kind === 'deadline').severity, 'warn')
  assert.equal(say(plan, 'Move go-live to Dec 21').reply, 'Go-live is now Mon, Dec 21.')
})

test('a hiring plan: the runway floor, band costs, the round, moving and adding hires', () => {
  const plan = hiring()
  const floor = say(plan, 'Never let runway drop below 15 months')
  assert.deepEqual(floor.diff.lines, ['+ Runway stays above 15 months.'])
  assert.throws(() => say(floor.workshop, 'Push AE #2 to Dec 28'), /That takes runway to 14\.\d months\. Runway stays above 15 months\./)
  const may = say(plan, 'Push the designer to May')
  assert.match(may.reply, /^“Designer” now starts Mon, May 3, after 6 weeks of recruiting\. Runway with these hires: \d+\.\d months\.$/)
  assert.ok(runwayMonths(may.workshop) >= runwayMonths(plan))
  const pricier = say(plan, 'Senior eng costs $16k a month')
  assert.equal(pricier.workshop.hiring.bands.find(band => band.id === 'senior-eng').monthly, 16000)
  assert.equal(say(plan, 'What if the round closes in June?').workshop.hiring.funding.day, 190)
  assert.ok(runwayMonths(say(plan, 'What if the round slips to November?').workshop) < 10)
  const added = say(plan, 'Add a Sales AE in Q3').workshop.cards.at(-1)
  assert.deepEqual([added.label, added.band, added.laneId], ['Sales AE', 'ae', 'sales'])
  assert.ok(scheduleLaunch({ ...plan, cards: [...plan.cards, added] }).get(added.id).to >= 220)
  assert.equal(say(plan, 'Make recruiting for Designer 8 weeks').workshop.cards.find(card => card.id === 'designer').duration, 56)
  assert.ok(rules(say(plan, 'Stop me instead of pushing dependent hires').workshop).includes('cascade:stop'))
  assert.equal(behaviourLines(say(plan, 'Stop me instead of pushing dependent hires').workshop).at(-1), 'A slip stops at the hires that wait on it.')
})

test('the read model carries the plan’s dates, bands and runway (no per-person money)', () => {
  const plan = hiring()
  const read = readWorkshop(plan, { creative: { revision: 3 } })
  assert.equal(read.kind, 'hiring-plan')
  assert.equal(read.clock.origin, '2026-11-23')
  assert.equal(read.hiring.runway, 15.1)
  assert.deepEqual(Object.keys(read.cards[0]).filter(key => /salary|amount|cost|pay/.test(key)), [])
  assert.equal(read.cards.find(card => card.id === 'designer').to, 98)
})

test('the plans’ chips are real: each parses, and each rule phrase changes the next drag', () => {
  for (const id of ['launch-plan', 'customer-go-live', 'hiring-plan']) {
    const entry = catalogEntry(id)
    const sample = catalogSample(id, catalogSamples)
    const offered = startersFor(entry, sample, null, { all: true })
    assert.deepEqual([...new Set(offered.map(item => item.edit))].sort(), [...entry.edits].sort(), id)
    for (const item of offered.filter(item => item.rule)) assert.ok(dragsDiffer(sample, say(sample, item.text).workshop), id + ': ' + item.text)
    assert.ok(boardMoves(sample).length >= entry.edits.length - 1)
  }
  // A rule that changes nothing a drag can reach is not offered as one that does.
  const plan = launch()
  assert.equal(dragsDiffer(plan, say(plan, 'Rename Design to Discovery').workshop), false)
  assert.notDeepEqual(legalRuns(plan, 'copy', 'lag'), legalRuns(say(plan, 'Nothing ships in code freeze, Nov 26 to Nov 27').workshop, 'copy', 'lag'))
})
