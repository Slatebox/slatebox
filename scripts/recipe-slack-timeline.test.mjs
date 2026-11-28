// S3, the project timeline (enterprise/recipes/slack-timeline), against the catalog's acceptance
// criteria: dated commitments become launch-plan tasks (one moved later, one done); the moved task's
// due date changes, it shows the slip, and timeline.date_changed / timeline.slipped fire once; a
// commitment without a date goes to the Commitments board only; never more than 12 tasks; the
// folds the decision log already made are read, not repeated.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-slack-timeline.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import S1 from '../enterprise/recipes/slack-decision-log/index.mjs'
import S3 from '../enterprise/recipes/slack-timeline/index.mjs'
import { TIMELINE_LIMITS } from '../enterprise/recipes/slack-timeline/render.mjs'
import { CHANNEL, foldModel, MESSAGES, tsAt } from '../enterprise/recipes/_slack-ledger/fixtures/checkout.mjs'
import { fakeAi } from './fakes/recipe-lite-context.mjs'
import { slackWorld } from './fakes/slack-recipe-world.mjs'

// Before the PSP contract moved: the fixture without the "Pushing…" message.
const beforeMove = MESSAGES.filter((m) => !/Pushing the PSP contract/.test(m.text))
const move = MESSAGES.find((m) => /Pushing the PSP contract/.test(m.text))

test('commitments become tasks with owners, due dates and links; done shows done; the board holds every commitment', async () => {
  const w = slackWorld()
  const instance = w.addInstance('t1', 'slack-timeline', { channels: [CHANNEL.id] })
  await w.deliver(MESSAGES)
  const run = await w.run(S3, instance, { ai: fakeAi(foldModel) })
  const [slate] = run.result.desired.slates
  assert.equal(slate.name, 'Timeline — #proj-checkout')
  const [plan, board] = slate.boards
  assert.equal(plan.component, 'launch-plan')
  const tasks = Object.fromEntries(plan.cards.map((c) => [c.label, c]))
  assert.deepEqual(Object.keys(tasks).sort(), ['3DS2 challenge flow shipped', 'Datadog dashboards set up', 'PSP contract signed', 'Payments API frozen'])
  assert.equal(tasks['PSP contract signed'].due, '2026-12-09')
  assert.equal(tasks['PSP contract signed'].owner, 'Dana')
  assert.equal(tasks['PSP contract signed'].fields.slip, 'slipped +12d')
  assert.equal(tasks['PSP contract signed'].fields.status, 'slipped')
  assert.equal(tasks['3DS2 challenge flow shipped'].fields.status, 'done')
  assert.match(tasks['Payments API frozen'].link, /^https:\/\/acme\.slack\.com\//)
  assert.ok(plan.cards.every((c, i, all) => i === 0 || all[i - 1].due <= c.due), 'in date order')
  assert.ok(plan.lanes.some((l) => l.label === 'PSP'), 'lanes from the channel\'s most used terms its commitments name')
  assert.equal(tasks['PSP contract signed'].lane, 'psp')
  assert.equal(board.component, 'team-board')
  assert.deepEqual(board.lanes.map((l) => l.label), ['Open', 'Done', 'Slipped'])
  assert.equal(board.cards.find((c) => c.label === '3DS2 challenge flow shipped').lane, 'done')
  assert.ok(slate.notes.some((n) => n.key === 'today' && n.text === 'Today: Nov 27'))
})

test('a later message moves a date: the task moves, timeline.date_changed and timeline.slipped fire once; done fires timeline.done', async () => {
  const firstWeek = beforeMove.filter((m) => !/challenge flow is shipped/.test(m.text))
  const w = slackWorld({ messages: firstWeek })
  const instance = w.addInstance('t1', 'slack-timeline', { channels: [CHANNEL.id] })
  const ai = fakeAi(foldModel)
  await w.deliver(firstWeek)
  const first = await w.run(S3, instance, { ai })
  const psp = first.result.desired.slates[0].boards[0].cards.find((c) => c.label === 'PSP contract signed')
  assert.equal(psp.due, '2026-11-27')
  assert.deepEqual(first.events, [], 'a first run reports no changes')
  w.clock.at += 3600000
  await w.deliver([move, MESSAGES.find((m) => /challenge flow is shipped/.test(m.text))])
  const second = await w.run(S3, instance, { ai })
  const moved = second.result.desired.slates[0].boards[0].cards.find((c) => c.key === psp.key)
  assert.equal(moved.due, '2026-12-09')
  assert.equal(moved.fields.slip, 'slipped +12d')
  const events = second.events.map((e) => e.event).sort()
  assert.deepEqual(events, ['timeline.date_changed', 'timeline.done', 'timeline.slipped'])
  const changed = second.events.find((e) => e.event === 'timeline.date_changed').data
  assert.deepEqual([changed.from, changed.to, changed.key, changed.channelId], ['2026-11-27', '2026-12-09', psp.key, CHANNEL.id])
  assert.match(changed.permalink, /p\d+$/, 'links to the message that moved it')
  const third = await w.run(S3, instance, { ai })
  assert.deepEqual(third.events, [], 'once')
})

test('a commitment without a date goes to the Commitments board only', async () => {
  const w = slackWorld({ messages: [] })
  const instance = w.addInstance('t1', 'slack-timeline', { channels: [CHANNEL.id] })
  await w.deliver([{ ts: tsAt(10), user: 'U0ANA', text: '<@U0RAJ> will send the PSP contract to legal next sprint' }])
  const ai = fakeAi(() => null)
  const run = await w.run(S3, instance, { ai })
  const [plan, board] = run.result.desired.slates[0].boards
  assert.equal(plan.cards.length, 0)
  assert.equal(board.cards.length, 1)
  assert.equal(board.cards[0].fields.due, 'next sprint')
  assert.equal(board.cards[0].owner, 'Raj')
})

test('never more than 12 tasks: the rest are listed on the nearest task', async () => {
  const w = slackWorld({ messages: [] })
  const instance = w.addInstance('t1', 'slack-timeline', { channels: [CHANNEL.id], lanes: ['Payments', 'Launch'] })
  await w.deliver(Array.from({ length: 16 }, (_, i) => ({ ts: tsAt(i * 30), user: 'U0LEE', text: `I'll ship payments item ${i + 1} by Dec ${i + 1}` })))
  const run = await w.run(S3, instance, { ai: fakeAi(() => null) })
  const [plan] = run.result.desired.slates[0].boards
  assert.equal(plan.cards.length, TIMELINE_LIMITS.tasks)
  assert.deepEqual(plan.lanes.map((l) => l.label), ['Payments', 'Launch', 'Other'])
  assert.ok(plan.cards.every((c) => c.lane === 'payments'))
  assert.ok(plan.cards.some((c) => c.fields.also), 'the four past 12 are named on their nearest task')
})

test('the timeline reads the folds the decision log made: no second model call for the same messages', async () => {
  const w = slackWorld()
  const s1 = w.addInstance('s1', 'slack-decision-log', { channels: [CHANNEL.id] })
  const s3 = w.addInstance('s3', 'slack-timeline', { channels: [CHANNEL.id] })
  await w.deliver(MESSAGES)
  const ai = fakeAi(foldModel)
  await w.run(S1, s1, { ai })
  const run = await w.run(S3, s3, { ai })
  assert.equal(ai.calls.length, 1)
  assert.equal(run.result.desired.slates[0].boards[0].cards.length, 4)
  const row = [...w.stores.ledger._rows.values()].find((r) => r.kind === 'commitment')
  assert.deepEqual(row.instanceIds, ['s1'], 'written by the fold that ran')
})
