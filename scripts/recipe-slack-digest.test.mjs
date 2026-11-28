// S4, the weekly channel digest (enterprise/recipes/slack-digest), against the catalog's acceptance
// criteria: one slate (and its presentation) per week, a rerun the same week the same slate; the
// digest reads the ledger only, with zero Slack history or search calls; with the model off the
// sections still stand; a post is only ever proposed (the runtime sends it under the owner's grant
// for that one channel, or after its card is approved: vendor tests cover the refusal).
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-slack-digest.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import S1 from '../enterprise/recipes/slack-decision-log/index.mjs'
import S4 from '../enterprise/recipes/slack-digest/index.mjs'
import { weekOf } from '../enterprise/recipes/slack-digest/run.mjs'
import { CHANNEL, foldModel, MESSAGES, OTHER_CHANNEL } from '../enterprise/recipes/_slack-ledger/fixtures/checkout.mjs'
import { fakeAi } from './fakes/recipe-lite-context.mjs'
import { slackWorld } from './fakes/slack-recipe-world.mjs'

const MONDAY = Date.parse('2026-11-23T07:30:00Z')
const summaryModel = (prompt, schema, purpose) => (purpose === 'summary' ? { channels: [{ id: CHANNEL.id, summary: 'The team chose Adyen and froze the payments API for Dec 5. Retrying soft declines was dropped. The PSP contract slipped to Dec 9.' }] } : foldModel(prompt))

async function digestWorld(config = {}) {
  const w = slackWorld()
  w.clock.at = MONDAY
  const s1 = w.addInstance('s1', 'slack-decision-log', { channels: [CHANNEL.id] })
  const s4 = w.addInstance('s4', 'slack-digest', { channels: [CHANNEL.id], ...config })
  await w.deliver(MESSAGES)
  await w.run(S1, s1, { ai: fakeAi(foldModel) })
  return { w, s4 }
}

test('the week: the Monday of the week holding yesterday, in the owner\'s time zone', () => {
  assert.equal(weekOf(MONDAY, 'UTC'), '2026-11-16')
  assert.equal(weekOf(Date.parse('2026-11-27T18:00:00Z'), 'UTC'), '2026-11-23')
  assert.equal(weekOf(Date.parse('2026-11-30T04:00:00Z'), 'America/Los_Angeles'), '2026-11-23', 'still Sunday night there')
})

test('one slate for the week: a frame per channel with decisions, slips, open questions, terms and the summary; a presentation from it', async () => {
  const { w, s4 } = await digestWorld()
  const before = { ...w.fake.counts }
  const ai = fakeAi(summaryModel)
  const run = await w.run(S4, s4, { ai, trigger: { kind: 'schedule' } })
  const [slate] = run.result.desired.slates
  assert.equal(slate.role, 'digest')
  assert.equal(slate.key, '2026-11-16')
  assert.equal(slate.name, 'Week of Nov 16')
  assert.deepEqual(slate.folder, ['Digests'])
  assert.deepEqual(slate.presentation, { title: 'Week of Nov 16: #proj-checkout', from: 'frames' })
  const frame = slate.graph.frames[0]
  assert.equal(frame.text, '#proj-checkout')
  const texts = slate.graph.nodes.map((n) => n.text)
  assert.ok(texts[0].startsWith('The team chose Adyen'), 'the summary first')
  assert.equal(texts.filter((t) => t.startsWith('Decided:')).length, 3)
  assert.equal(texts.filter((t) => t.startsWith('Reversed:')).length, 1)
  assert.ok(texts.includes('Slipped: PSP contract signed, Nov 27 → Dec 9 (Dana)'))
  assert.ok(texts.some((t) => t === 'Open: Does anyone know when the PCI audit is scheduled? (Sam, 3 days)'))
  assert.ok(texts.some((t) => t.startsWith('Most used terms: PSP')))
  assert.ok(slate.graph.nodes.filter((n) => /^(Decided|Reversed|Slipped|Open)/.test(n.text)).every((n) => /^https:\/\/acme\.slack\.com\//.test(n.link)))
  assert.deepEqual(frame.members, slate.graph.nodes.map((n) => n.key))
  // Reads only the ledger: no history, replies or search call; one model call (the summary).
  for (const method of ['conversations.history', 'conversations.replies', 'search.messages']) assert.equal(w.fake.counts[method] || 0, before[method] || 0, method)
  assert.deepEqual(ai.calls.map((c) => [c.purpose, c.maxIn, c.maxOut]), [['summary', 8000, 1500]])
  assert.deepEqual(run.events, [{ event: 'digest.published', data: { week: '2026-11-16', channels: [CHANNEL.id], decisions: 4, slips: 1, questions: 1, postProposed: false } }])
  assert.deepEqual(run.result.writes, [], 'no post set up: nothing proposed')
})

test('a rerun the same week updates the same slate; the next week is a new one', async () => {
  const { w, s4 } = await digestWorld()
  const ai = fakeAi(summaryModel)
  const first = await w.run(S4, s4, { ai, trigger: { kind: 'schedule' } })
  w.clock.at += 3 * 3600000
  const again = await w.run(S4, s4, { ai, trigger: { kind: 'manual' } })
  assert.equal(again.result.desired.slates[0].key, first.result.desired.slates[0].key)
  assert.deepEqual(again.result.desired.slates[0].graph.nodes.map((n) => n.key), first.result.desired.slates[0].graph.nodes.map((n) => n.key))
  w.clock.at = MONDAY + 7 * 86400000
  const next = await w.run(S4, s4, { ai, trigger: { kind: 'schedule' } })
  assert.equal(next.result.desired.slates[0].key, '2026-11-23')
  assert.ok(next.result.desired.slates[0].graph.nodes.some((n) => n.text === 'No decisions recorded this week.'))
})

test('the model off: the sections without the summary note, marked partial', async () => {
  const { w, s4 } = await digestWorld()
  const ai = fakeAi(summaryModel)
  ai.off = true
  const run = await w.run(S4, s4, { ai, trigger: { kind: 'schedule' } })
  const texts = run.result.desired.slates[0].graph.nodes.map((n) => n.text)
  assert.ok(!texts.some((t) => t.startsWith('The team chose')))
  assert.equal(texts.filter((t) => t.startsWith('Decided:')).length, 3)
  assert.equal(run.result.desired.partial, 'ai_refused')
})

test('a post set up: one slack.post proposed for the chosen channel, keyed per week, with the slate to link', async () => {
  const { w, s4 } = await digestWorld({ post: { channel: OTHER_CHANNEL.id, format: 'bullets' }, presentation: false })
  const run = await w.run(S4, s4, { ai: fakeAi(summaryModel), trigger: { kind: 'schedule' } })
  assert.equal(run.result.writes.length, 1)
  const [write] = run.result.writes
  assert.equal(write.kind, 'slack.post')
  assert.deepEqual(write.target, { channel: OTHER_CHANNEL.id })
  assert.equal(write.key, 'digest:2026-11-16')
  assert.deepEqual(write.body.slateRef, { role: 'digest', key: '2026-11-16' })
  const [head, ...bullets] = write.body.text.split('\n')
  assert.equal(head, 'Week of Nov 16 digest for #proj-checkout: 4 decisions, 1 slipped, 1 open question.')
  assert.equal(bullets.length, 5)
  assert.ok(!('presentation' in run.result.desired.slates[0]))
  assert.equal(run.events[0].data.postProposed, true)
  assert.equal(w.api.posted.length, 0, 'the recipe itself never posts')
})
