// A task's days in plain words, on every board where a card's width is time (a launch plan, a customer
// go-live, a hiring plan): its length and its start, with the task selected or named. Read locally (no AI),
// made by the engine's one edit reducer, so a sentence, a grip on the canvas and exec make the same edit.
// A phrase whose object is a number of days is never a rename, and "the duration" is never a lane.
import assert from 'node:assert/strict'
import test from 'node:test'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { goLiveSample, hiringPlanSample, launchPlanSample, scheduleLaunch } from 'slateboxjs/workshops/rules'
import 'slateboxjs/workshops/behaviour'
import { proposeLaneReply } from '../web/app/imports/api/common/lane-conversation.mjs'
import '../web/app/imports/api/common/board-chat.mjs'
import { workshopStarters } from '../web/app/imports/api/common/workshop-starters.mjs'

const today = '2026-11-21' // plans start Monday 23 Nov
const tim = { by: 'Tim' }
const goLive = () => validateWorkshop(goLiveSample(today))
const configure = { kind: 'card', id: 'configure' }
const say = (board, message, selection = null) => proposeLaneReply(board, message, selection, tim)
const task = (board, id) => board.cards.find(card => card.id === id)
const labels = board => board.cards.map(card => card.label)

test('with Configure selected, the owner’s two phrases make it 3 days (never a rename, never a lane called duration)', () => {
  const plan = goLive()
  for (const phrase of ['change this to 3 days', 'change the duration to 3 days']) {
    const result = say(plan, phrase, configure)
    assert.equal(task(result.workshop, 'configure').duration, 3, phrase)
    assert.deepEqual(labels(result.workshop), labels(plan), phrase + ' renames nothing')
    assert.equal(result.reply, '“Configure” now takes 3 days.', phrase)
  }
})

test('every way of saying a task’s length or start, with it selected or named', () => {
  const plan = goLive()
  const cases = [
    ['make it 3 days', configure, { configure: { duration: 3 } }],
    ['3 days', configure, { configure: { duration: 3 } }],
    ['Make this 3 days', configure, { configure: { duration: 3 } }],
    ['set the length to 4 days', configure, { configure: { duration: 4 } }],
    ['it takes 2 days', configure, { configure: { duration: 2 } }],
    ['shorten Configure to 3 days', null, { configure: { duration: 3 } }],
    ['Shorten Configure by 2 days', null, { configure: { duration: 3 } }],
    ['change the duration of Configure to 3 days', null, { configure: { duration: 3 } }],
    // "Kick-off" for the task called Kickoff.
    ['extend Kick-off by 2 days', null, { kickoff: { duration: 3 } }],
    // A week is five working days where weekends don't count.
    ['make it a week', { kind: 'card', id: 'kickoff' }, { kickoff: { duration: 5 } }],
    // Configure can first start Fri 27 Nov (when Send data ends): the Monday after is one working day later.
    ['start it on Monday', configure, { configure: { lag: 1, duration: 5 } }],
    ['move it 2 days later', configure, { configure: { lag: 2, duration: 5 } }],
    ['push Configure back a day', null, { configure: { lag: 1, duration: 5 } }],
  ]
  for (const [phrase, selection, want] of cases) {
    const result = say(plan, phrase, selection)
    for (const [id, fields] of Object.entries(want)) {
      const card = task(result.workshop, id)
      for (const [field, value] of Object.entries(fields)) assert.equal(card[field] ?? 0, value, phrase + ': ' + id + ' ' + field)
    }
    assert.deepEqual(labels(result.workshop), labels(plan), phrase + ' renames nothing')
  }
  // Earlier again: back to where it can first start.
  const later = say(plan, 'move it 2 days later', configure).workshop
  assert.equal(task(say(later, 'move it a day earlier', configure).workshop, 'configure').lag, 1)
})

test('the board’s rules decide: past go-live is refused in its sentence, and a slip pushes what waits', () => {
  const plan = goLive()
  assert.throws(() => say(plan, 'make it 14 days', configure), /^Error: Sign-off would run until Mon 21 Dec; go-live is Fri 18 Dec\.$/)
  const longer = say(plan, 'extend it by 1 day', configure).workshop
  assert.equal(scheduleLaunch(longer).get('train').start, scheduleLaunch(plan).get('train').start + 1)
})

test('ambiguous or unknown: a short question, never a guess', () => {
  const plan = goLive()
  for (const phrase of ['change this to 3 days', 'make it 3 days', '3 days', 'change the duration to 3 days', 'start it on Monday']) {
    assert.throws(() => say(plan, phrase), /^Error: Which task\? Select it on the canvas, or name it: “Make Configure 3 days”\.$/, phrase)
    // A team selected is not a task.
    assert.throws(() => say(plan, phrase, { kind: 'lane', id: 'us' }), /^Error: Which task\?/, phrase)
  }
  assert.throws(() => say(plan, 'shorten Deploy to 3 days'), /^Error: There is no task called “Deploy” here\. The tasks are /)
  assert.throws(() => say(plan, 'start it on Thursday the 40th', configure), /^Error: Which day\? Say a date, such as “start it on Mon 30 Nov”\.$/)
})

test('a number of days is never a name, on any board', () => {
  // A plain lanes board: no days to change, so it says so instead of renaming the card “3 days”.
  const lanes = validateWorkshop({ version: 1, title: 'Now next later', lanes: [{ id: 'now', label: 'Now' }, { id: 'next', label: 'Next' }],
    cards: [{ id: 'c1', label: 'Call Sam', laneId: 'now' }] })
  for (const phrase of ['change this to 3 days', 'rename this to 2 weeks', 'Change Call Sam to 3 days']) {
    assert.throws(() => say(lanes, phrase, { kind: 'card', id: 'c1' }), /^Error: Only a plan’s tasks take days\. To make “(?:3 days|2 weeks)” a name, put it in quotes\.$/, phrase)
  }
  // In quotes it is a name, as meant.
  assert.equal(say(lanes, 'Rename this to “3 days”', { kind: 'card', id: 'c1' }).workshop.cards[0].label, '3 days')
  // “The duration” is not a lane on any board.
  assert.throws(() => say(lanes, 'change the duration to 3 days', { kind: 'card', id: 'c1' }), /^Error: Only a plan’s tasks take days\./)
})

test('a launch plan and a hiring plan read the same words; a hiring plan counts weeks', () => {
  const launch = validateWorkshop(launchPlanSample(today))
  assert.equal(task(say(launch, 'make this 3 days', { kind: 'card', id: 'design' }).workshop, 'design').duration, 3)
  const hiring = validateWorkshop(hiringPlanSample(today))
  const designer = { kind: 'card', id: 'designer' }
  assert.equal(task(say(hiring, 'make it 4 weeks', designer).workshop, 'designer').duration, 28)
  // Recruiting is counted in whole weeks: three days is refused in the plan's words, and never a rename.
  assert.throws(() => say(hiring, 'change this to 3 days', designer), /^Error: Recruiting takes 1 to 20 weeks\.$/)
  assert.throws(() => say(hiring, 'change this to 10 days', designer), /^Error: Hires snap to whole weeks\.$/)
  // On a plan a number of days asked as a name says how to change the days instead.
  assert.throws(() => say(goLive(), 'rename this to 3 days', configure), /^Error: A task’s name can’t be a number of days\. To make it 3 days, say “Make this 3 days”\.$/)
})

test('a selected task on a time board offers “Make this 3 days”-style starters, each of which works', () => {
  const plan = goLive()
  const configured = workshopStarters(plan, configure).map(item => item.text)
  assert.equal(configured[0], 'Make this 3 days')
  const kickoff = workshopStarters(plan, { kind: 'card', id: 'kickoff' }).map(item => item.text)
  assert.equal(kickoff[0], 'Make this 2 days')
  const hiring = validateWorkshop(hiringPlanSample(today))
  assert.equal(workshopStarters(hiring, { kind: 'card', id: 'designer' })[0].text, 'Make this 4 weeks')
  for (const text of configured) assert.ok(say(plan, text, configure).workshop, text)
})

test('the launch or go-live is the plan’s line, never a task that shares the word', () => {
  const launch = validateWorkshop(launchPlanSample(today))
  // “Launch post” shares the word: ask which is meant instead of moving the task.
  for (const phrase of ['move the launch 2 days later', 'push launch back a week', 'start the launch on Friday', 'push the launch to Friday', 'extend the launch by 2 days']) {
    assert.throws(() => say(launch, phrase), /^Error: Do you mean the launch line or the task “Launch post”\? To move the line, say “Move launch to Fri 18 Dec”; for the task, name it: “Move Launch post 2 days later”\.$/, phrase)
  }
  // The line's own grammar still moves the line, and the task by its full name still moves the task.
  assert.equal(say(launch, 'move launch to Fri 18 Dec').workshop.launch.day, 25)
  assert.equal(task(say(launch, 'move Launch post 2 days later').workshop, 'post').lag, 5)
  // A go-live with no task of that name says how to move the line, not “there is no task called go-live”.
  const plan = goLive()
  for (const phrase of ['start go-live on Friday', 'begin the go-live day on Friday', 'make go-live 3 days']) {
    assert.throws(() => say(plan, phrase), /^Error: To move go-live, say its day: “Move go-live to Fri 25 Dec”\.$/, phrase)
  }
  assert.equal(say(plan, 'move go-live to Dec 18').reply, 'Go-live is now Fri 18 Dec.')
  // A move to a team is still the lane conversation's, in both start forms.
  assert.equal(task(say(plan, 'move Configure to Customer').workshop, 'configure').laneId, 'customer')
})

test('“start it on Monday” is the coming Monday from where the task starts now, never weeks earlier', () => {
  const plan = goLive()
  // Configure moved to start Tue 1 Dec (two working days after it can first start, Fri 27 Nov).
  const later = say(plan, 'move it 2 days later', configure).workshop
  assert.equal(task(say(later, 'start it on Monday', configure).workshop, 'configure').lag, 6) // Mon 7 Dec
  assert.equal(task(say(later, 'start it on Friday', configure).workshop, 'configure').lag, 5) // Fri 4 Dec
  // A hire already waiting 8 weeks keeps its start; it is not pulled back to the first Monday.
  const hiring = validateWorkshop(hiringPlanSample(today))
  const designer = say(hiring, 'start it on Monday', { kind: 'card', id: 'designer' }).workshop
  assert.equal(task(designer, 'designer').lag, 56)
  // A launch-plan task that already waits keeps waiting at least as long.
  const launch = validateWorkshop(launchPlanSample(today))
  assert.equal(task(say(launch, 'start it on Monday', { kind: 'card', id: 'post' }).workshop, 'post').lag, 3)
})

test('go-live by a date or by an amount: one set_launch_day, landing on a working day where weekends don’t count', () => {
  const plan = goLive() // go-live Fri 18 Dec (day 25)
  const line = (phrase, board = plan) => say(board, phrase)
  // By a date.
  assert.equal(line('move go-live to 23 Dec').workshop.launch.day, 30)
  assert.equal(line('move go-live to 23 Dec').reply, 'Go-live is now Wed 23 Dec.')
  assert.equal(line('push go-live to Dec 23').workshop.launch.day, 30)
  // A Saturday, coming later, is the Monday after; coming earlier, the Friday before.
  assert.equal(line('move go-live to Sat 19 Dec').workshop.launch.day, 28)
  assert.equal(line('move go-live to Sat 19 Dec').reply, 'Go-live is now Mon 21 Dec: Sat 19 Dec is a weekend, and weekends don’t count on this plan.')
  assert.equal(line('move go-live to Sat 12 Dec').workshop.launch.day, 18)
  // By an amount: a week is Friday to Friday; days are working days.
  for (const [phrase, day] of [['push go-live back a week', 32], ['push the deadline back a week', 32], ['move go-live 2 weeks later', 39],
    ['push go-live out by a week', 32], ['move go-live 1 day later', 28], ['move go-live 3 days later', 30], ['pull go-live forward 2 days', 23], ['bring go-live in by a week', 18]]) {
    const result = line(phrase)
    assert.equal(result.workshop.launch.day, day, phrase)
    assert.deepEqual(result.workshop.cards, plan.cards, phrase + ' moves only the line')
  }
  // Earlier than the tasks end: refused in the board’s sentence, with the earliest go-live that fits.
  assert.throws(() => line('pull go-live forward 2 weeks'), /^Error: Sign-off would run until Tue 8 Dec; go-live is Fri 4 Dec\. The earliest go-live that fits is Wed 9 Dec\.$/)
  // A launch plan whose task shares the word still asks which is meant.
  assert.throws(() => say(validateWorkshop(launchPlanSample(today)), 'push launch back a week'), /^Error: Do you mean the launch line/)
})

test('the plan’s first day and a hiring plan’s weeks in words: one set_plan_start or set_plan_weeks, every task keeping its dates', () => {
  const plan = goLive() // starts Mon 23 Nov
  const dates = board => Object.fromEntries([...scheduleLaunch(board)].map(([id, t]) => [id, new Date(Date.parse(board.clock.origin) + t.from * 864e5).toISOString().slice(0, 10)]))
  for (const [phrase, origin] of [['start the plan on Nov 16', '2026-11-16'], ['move the start date to Nov 16', '2026-11-16'], ['move the plan’s first day to 16 Nov', '2026-11-16'],
    ['start the plan a week earlier', '2026-11-16'], ['start a week earlier', '2026-11-16'], ['start the plan on 1 Dec', '2026-12-01'], ['move the start 3 days later', '2026-11-26'], ['start the plan on Sun 22 Nov', '2026-11-20']]) {
    const result = say(plan, phrase)
    assert.equal(result.workshop.clock.origin, origin, phrase)
    if (origin < plan.clock.origin) assert.deepEqual(dates(result.workshop), dates(plan), phrase + ' keeps every date')
  }
  assert.equal(say(plan, 'start the plan a week earlier').reply, 'The plan now starts Mon 16 Nov.')
  assert.throws(() => say(plan, 'start the plan 3 weeks later'), /The latest first day that fits is Wed 2 Dec\.$/)
  // A task called by its name still starts where it is asked to.
  assert.equal(task(say(plan, 'start Configure on Monday').workshop, 'configure').lag, 1)
  assert.equal(task(say(plan, 'start it a week later', configure).workshop, 'configure').lag, 5)
  const hiring = validateWorkshop(hiringPlanSample(today))
  assert.equal(say(hiring, 'run the plan 60 weeks').workshop.hiring.weeks, 60)
  assert.equal(say(hiring, 'extend the plan by 4 weeks').workshop.hiring.weeks, 56)
  assert.throws(() => say(hiring, 'shorten the plan by 30 weeks'), /^Error: AE #2 starts Mon 10 May, after the plan’s last week\.$/)
})

// Boards S2b (owner addendum, 2026-11-22): with the plan in focus (the gear's "Change this board"), the chat takes
// the span in words: "move go-live to 23 Dec", "start on 1 Dec", "make this a 3-week plan". The same edits as a
// grip (set_launch_day, set_plan_start, set_plan_weeks), decided by the plan's rules.
test('in focus, the plan’s span in words: go-live, its first day and how many weeks it runs', () => {
  const plan = goLive() // starts Mon 23 Nov, go-live Fri 18 Dec (day 25)
  const board = { kind: 'board', id: 'main' }
  assert.equal(say(plan, 'move go-live to 23 Dec', board).workshop.launch.day, 30)
  const start = say(plan, 'start on 1 Dec', board)
  assert.equal(start.workshop.clock.origin, '2026-12-01')
  assert.equal(say(plan, 'Start on Mon 30 Nov', board).workshop.clock.origin, '2026-11-30')
  // A 3-week plan goes live on the last working day of its third week: Fri 11 Dec (day 18).
  const three = say(plan, 'make this a 3-week plan', board)
  assert.equal(three.workshop.launch.day, 18)
  assert.equal(three.reply, 'Go-live is now Fri 11 Dec.')
  assert.deepEqual(three.workshop.cards, plan.cards)
  for (const phrase of ['make it a three week plan', 'make the plan 3 weeks long', 'make this plan 3 weeks']) assert.equal(say(plan, phrase, board).workshop.launch.day, 18, phrase)
  assert.equal(say(plan, 'make this a 5-week plan', board).workshop.launch.day, 32)
  // Too short for the tasks: refused in the board’s sentence, with the earliest go-live that fits.
  assert.throws(() => say(plan, 'make this a 2-week plan', board), /The earliest go-live that fits is Wed 9 Dec\.$/)
  // A hiring plan runs a number of weeks.
  const hiring = validateWorkshop(hiringPlanSample(today))
  assert.equal(say(hiring, 'make this a 40-week plan', board).workshop.hiring.weeks, 40)
  // With a task selected, "start on Monday" is still the task's.
  assert.equal(task(say(plan, 'start it on Monday', configure).workshop, 'configure').lag, 1)
})
