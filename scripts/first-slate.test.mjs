import { strict as assert } from 'node:assert'
import test from 'node:test'
import 'slateboxjs/workshops/behaviour'
import { validateWorkshop, encodeWorkshopFragment } from 'slateboxjs/workshops/model'
import { catalogAddRequest, catalogEntry } from 'slateboxjs/catalog'
import { catalogSamples } from 'slateboxjs/workshops/samples'
import { scheduleLaunch, weekdayAt } from 'slateboxjs/workshops/rules'
import '../web/app/imports/api/common/board-chat.mjs'
import {
  JOBS, STEP_TWO, PLAN_KEYS, BRIEF_OPENER, firstSlatePlan, firstTextPlan, resolveFirstText, hasStarted, worksOnLine, startGroup,
} from '../web/app/imports/api/common/first-slate.mjs'
import { firstRunStarters, firstStarterWorks } from '../web/app/imports/api/common/first-slate-starters.mjs'
import { firstSlateContent, firstWorkshop } from '../web/app/server/first-slate-board.mjs'
import { businessBoardFromBrief } from '../web/app/imports/api/common/business-board-brief.mjs'
import { launchPlanOpener } from '../web/app/imports/api/common/launch-plan-brief.mjs'
import { pipelineOpener } from '../web/app/imports/api/common/pipeline-brief.mjs'
import { budgetOpener } from '../web/app/imports/api/common/budget-brief.mjs'
import { nativeDiagramSources, readCreationBrief } from '../web/app/imports/api/common/native-diagram-brief.mjs'
import { nativeBriefPaths } from '../web/app/imports/api/common/native-diagram-brief.mjs'

// A Wednesday: next Monday is 2026-11-30.
const today = '2026-11-25'

/** Every one-click answer: each job with each of its chips, or alone, plus Skip. */
const answers = [
  ...JOBS.flatMap(job => STEP_TWO[job.id] ? STEP_TWO[job.id].chips.map(chip => ({ job: job.id, with: chip.id })) : [{ job: job.id }]),
  { job: 'skip-me' },
]
const texts = [
  'Plan a launch for day 20: Design 4 days, Build 8 days after Design, QA 3 days after Build',
  'Make a sales pipeline with Initech 30k, Hooli 50k, target 200k',
  'Split a 500k budget across Design, Build and Support',
  'Make a workshop with Ideas, Pilot and Done',
  'columns: Backlog, This week, Shipped',
  'Request comes in → Triage → Close',
  'Sort our customer interview notes',
  'Write up the outage from Tuesday',
  'Sprint retro for the mobile team',
  'Plan our hiring for next year',
  'Our marketing budget',
  'Onboarding for Acme Corp',
  'Study for the biology exam',
  'Fix login bug\nUpdate the docs\nCall the printer',
  'Groceries, laundry, taxes',
  'Write the quarterly letter',
]
const plans = [...answers.map(answer => firstSlatePlan(answer)), ...texts.map(text => firstTextPlan(text))]

const sameStarter = (model, item) => {
  if (item.kind === 'brief') return Boolean(businessBoardFromBrief(item.text))
  if (item.kind === 'add') return Boolean(catalogAddRequest(item.text))
  if (item.kind === 'steps') return nativeBriefPaths(item.text.replace(/^add\s+(.+)\s+after\s+(.+)$/i, '$2 → $1')).length > 0
  return firstStarterWorks(model, item)
}

test('every answer, Skip and every own-words route builds a board that passes the model gate', () => {
  assert.equal(answers.length, 3 + 3 + 1 + 1 + 1 + 3 + 3 + 2 + 1)
  for (const plan of plans) {
    const content = firstSlateContent(plan, { today })
    if (plan.board.kind === 'steps') { assert.equal(content.creative, undefined); assert.ok(content.nodes.length >= 2); continue }
    const workshop = validateWorkshop(content.creative.model.workshop)
    assert.ok(workshop.cards.length > 0 || workshop.kind === 'budget' || plan.board.kind === 'lanes', plan.key + ' has cards')
    assert.equal(content.nodes.length, 1, plan.key + ' has its note')
    assert.match(content.nodes[0].options.text, /^How this board works\n/)
    assert.equal(content.options.firstRun.v, 1)
    assert.equal(content.options.firstRun.starters.length, 3)
    assert.ok(new TextEncoder().encode(JSON.stringify(content)).length < 64 * 1024, plan.key + ' is under 64 KB')
    assert.ok(encodeWorkshopFragment(workshop).length < 64 * 1024)
  }
})

test('every plan key is reachable and named in the visitor’s terms', () => {
  const reached = new Set(answers.map(answer => firstSlatePlan(answer).key))
  assert.deepEqual([...reached].sort(), [...PLAN_KEYS].sort())
  assert.equal(firstSlatePlan({ job: 'ship', with: 'team' }).title, 'Launch plan')
  assert.equal(firstWorkshop(firstSlatePlan({ job: 'golive' }), { today }).title, 'Customer go-live')
  assert.equal(firstWorkshop(firstTextPlan('Write up the outage from Tuesday'), { today }).title, 'Write up the outage from Tuesday')
})

test('brief paths parse with the same readers Ask Slatebox uses', () => {
  for (const plan of plans.filter(item => item.board.kind === 'brief')) assert.ok(businessBoardFromBrief(plan.board.brief), plan.key)
  // The page's pattern agrees with the readers' openers.
  for (const text of ['Plan a launch for day 4', 'make a launch plan', 'Make a pipeline', 'Make a sales pipeline with A', 'Make a budget', 'Split the 4k budget across A and B']) {
    assert.equal(BRIEF_OPENER.test(text), launchPlanOpener.test(text) || pipelineOpener.test(text) || budgetOpener.test(text), text)
  }
})

test('dated plans start next Monday and run on workdays, with their launch line clear of the tasks', () => {
  for (const key of ['ship.team', 'ship.me', 'ship.client', 'golive', 'money.hires']) {
    const [job, withId] = key.split('.')
    const workshop = firstWorkshop(firstSlatePlan({ job, with: withId }), { today })
    assert.equal(workshop.clock.origin, '2026-11-30', key)
    if (workshop.kind !== 'launch-plan') continue
    assert.ok(workshop.behaviour.rules.some(rule => rule.kind === 'workdays'), key + ' counts workdays')
    for (const task of scheduleLaunch(workshop).values()) {
      assert.ok(task.to <= workshop.launch.day, key + ' ends by launch')
      assert.ok(![0, 6].includes(weekdayAt(workshop.clock.origin, task.from)), key + ' starts on a workday')
    }
  }
  // Injected today moves the plan: a Monday counts from itself.
  assert.equal(firstWorkshop(firstSlatePlan({ job: 'ship', with: 'me' }), { today: '2026-12-07' }).clock.origin, '2026-12-07')
})

test('every seeded starter can be sent on its board', () => {
  for (const plan of plans) {
    const content = firstSlateContent(plan, { today })
    if (!content.creative) continue
    const model = content.creative.model.workshop
    for (const item of plan.starters) assert.ok(sameStarter(model, item), plan.key + ': ' + item.text)
    const offered = firstRunStarters(model, plan.starters)
    assert.equal(offered.length, 3, plan.key)
    assert.equal(offered[0].text, plan.starters[0].text)
  }
  // A selected part is the words a person swaps for their own.
  const ship = firstSlatePlan({ job: 'ship', with: 'team' })
  const [from, to] = ship.starters[0].select
  assert.equal(ship.starters[0].text.slice(from, to), 'Design 4 days, Build 6 days after Design, QA 2 days after Build')
})

test('starter 2 falls back to the board’s own move once the planned one no longer works', () => {
  const plan = firstSlatePlan({ job: 'week', with: 'team' })
  const model = firstWorkshop(plan, { today })
  // The card was renamed: the planned move names nothing now.
  const renamed = { ...model, cards: model.cards.map(card => card.label === 'Prep the demo' ? { ...card, label: 'Demo day' } : card) }
  const offered = firstRunStarters(validateWorkshop(renamed), plan.starters)
  assert.notEqual(offered[1].text, 'Move Prep the demo to Doing')
  assert.equal(offered.length, 3)
  // Doing full: a move the rules refuse is not offered.
  const full = { ...model, cards: [...model.cards, ...['a', 'b'].map(id => ({ id, label: 'Busy ' + id, laneId: 'doing' }))] }
  assert.ok(!firstRunStarters(validateWorkshop(full), plan.starters).some(item => item.text === 'Move Prep the demo to Doing'))
})

test('Skip opens This week, with Doing holding 3', () => {
  const plan = firstSlatePlan({})
  assert.equal(plan.key, 'skip')
  const model = firstWorkshop(plan, { today })
  assert.equal(model.title, 'This week')
  assert.equal(model.cards.length, 4)
  assert.ok(model.behaviour.rules.some(rule => rule.kind === 'capacity' && rule.where === 'doing' && rule.max === 3))
  assert.equal(firstSlatePlan({ job: 'nope' }).key, 'skip')
  assert.equal(firstSlatePlan({ job: 'ship', with: 'aliens' }).key, 'skip')
})

test('own words route first-match-wins', () => {
  const route = text => resolveFirstText(text)
  assert.equal(route('Plan a launch for day 20: Design 4 days').route, 'brief')
  assert.equal(route('Make a workshop with Ideas and Done').route, 'lanes')
  assert.equal(route('A -> B -> C').route, 'steps')
  assert.equal(route('Interview notes from Friday').key, 'text.feedback')
  assert.equal(route('The site broke at 2am').key, 'text.lookback.broke')
  assert.equal(route('Retro for sprint 12').key, 'text.lookback.team')
  assert.equal(route('Runway after two hires').key, 'text.money.hires')
  assert.equal(route('Q3 budget').key, 'text.money.team')
  assert.equal(route('Customer onboarding').key, 'text.golive')
  assert.equal(route('Homework this week').key, 'text.plan.school')
  assert.equal(route('one\ntwo').route, 'list')
  assert.equal(route('a, b, c').route, 'list')
  assert.equal(route('Write the quarterly letter').route, 'phrase')
  assert.equal(route('x'.repeat(80)).title.length <= 60, true)
  assert.throws(() => route(''))
  assert.throws(() => route('x'.repeat(1201)))
  assert.equal(firstTextPlan('Sort our customer interview notes').creationBrief, 'Sort our customer interview notes')
})

test('copy: no all-caps tokens, American spelling', () => {
  const words = JSON.stringify([JOBS, STEP_TWO, plans])
  assert.doesNotMatch(words, /[A-Z]{3,}(\s[A-Z]{3,})+/)
  assert.doesNotMatch(words, /\b(?:colour|behaviour|organis|favourite|analys(?:e|ing)|centre|cancelled|labelled|prioritis|realis|catalogue)\w*/i)
})

test('remembering the answer', () => {
  assert.equal(hasStarted(null, null), false)
  assert.equal(hasStarted(null, JSON.stringify({ job: 'ship', v: 1 })), true)
  assert.equal(hasStarted(null, 'not json'), false)
  assert.equal(hasStarted({ job: 'week' }, null), true)
  assert.equal(worksOnLine({ job: 'deals' }), 'Works on: tracking deals')
  assert.equal(worksOnLine({}), null)
  assert.equal(startGroup({ job: 'lookback' }), 'meetings')
})

test('catalogue ids the plans use exist in the engine', () => {
  for (const id of ['team-board', 'retro', 'now-next-later', 'customer-go-live', 'hiring-plan', 'sort-evidence', 'incident-review', 'break-down-problem']) {
    assert.ok(catalogEntry(id), id)
  }
  for (const sample of ['go-live', 'hiring-plan', 'sort-evidence', 'incident-review', 'break-down']) assert.equal(typeof catalogSamples[sample], 'function', sample)
})

test('the Friday launch seed is gone', () => {
  assert.ok(!nativeDiagramSources.includes('friday-launch'))
  assert.throws(() => readCreationBrief('#brief=x&source=friday-launch'))
})

test('routing: what /new opens', async () => {
  const { creationRoute } = await import('../web/app/imports/api/common/first-slate-route.mjs')
  assert.equal(creationRoute({ hash: '#brief=x&source=friday-launch' }), 'retired')
  assert.equal(creationRoute({ hash: '#brief=x&source=sign-in-outage' }), 'brief')
  assert.equal(creationRoute({ hash: '#brief=Draw%20a%20flow' }), 'brief')
  assert.equal(creationRoute({ hash: '#build' }), 'brief')
  assert.equal(creationRoute({}), 'first')
  assert.equal(creationRoute({ profileStart: { job: 'ship', v: 1 } }), 'blank')
  assert.equal(creationRoute({ stored: JSON.stringify({ job: 'ship', v: 1 }) }), 'blank')
  assert.equal(creationRoute({ search: '?again=1', profileStart: { job: 'ship', v: 1 } }), 'first')
  assert.equal(creationRoute({ search: '?job=ship&with=team', profileStart: { job: 'week', v: 1 } }), 'first')
  assert.equal(creationRoute({ member: true }), 'blank')
  assert.equal(creationRoute({ member: true, search: '?again=1' }), 'first')
  assert.equal(creationRoute({ search: '?empty=1' }), 'blank')
  assert.equal(creationRoute({ search: '?template=proConScaffold' }), 'blank')
  assert.equal(creationRoute({ search: '?templateId=tplprocon001&topic=x' }), 'blank')
})

test('Make it yours: a same-kind brief rebuilds an untouched first-run board in place', async () => {
  const { firstRunReplace } = await import('../web/app/server/first-slate-board.mjs')
  const content = firstSlateContent(firstSlatePlan({ job: 'ship', with: 'team' }), { today })
  const slate = { ...content, creative: { ...content.creative } }
  const theirs = businessBoardFromBrief('Plan a launch for day 30: Spec 3 days, Build 9 days after Spec, Ship 1 day after Build')
  const rebuilt = firstRunReplace(slate, theirs)
  assert.equal(rebuilt.title, 'Launch plan')
  assert.deepEqual(rebuilt.cards.map(card => card.label), ['Spec', 'Build', 'Ship'])
  assert.equal(rebuilt.clock.origin, '2026-11-30')
  assert.ok(rebuilt.behaviour.rules.some(rule => rule.kind === 'cascade'))
  // Not once the board has been changed, not for another kind, not on a slate that was not a first run.
  assert.equal(firstRunReplace({ ...slate, creative: { ...slate.creative, revision: 1 } }, theirs), null)
  assert.equal(firstRunReplace(slate, businessBoardFromBrief('Make a sales pipeline with A 1k')), null)
  assert.equal(firstRunReplace({ ...slate, options: { ...slate.options, firstRun: undefined } }, theirs), null)
})
