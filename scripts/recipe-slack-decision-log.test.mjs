// S1, the decision log (enterprise/recipes/slack-decision-log), against the recipes catalog's
// acceptance criteria: a fixture channel (60 messages, 3 decision threads, 1 reversal, noise) gives
// exactly 3 Decided cards and 1 Reversed, with permalinks, in one run and one model call (≤ 16k in);
// a rerun with nothing new makes no model call and asks for the same slates (so reconcile has no
// operations); card keys are the ledger's, so a person's moves and edits stay with the same card;
// a 25th decision rolls the oldest onto the month's archive; nothing stored or logged holds more
// than a 280-character quote.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-slack-decision-log.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import S1 from '../enterprise/recipes/slack-decision-log/index.mjs'
import { LOG_LIMITS } from '../enterprise/recipes/slack-decision-log/render.mjs'
import { CHANNEL, foldModel, MESSAGES, OTHER_CHANNEL, TEAM, tsAt } from '../enterprise/recipes/_slack-ledger/fixtures/checkout.mjs'
import { fakeAi } from './fakes/recipe-lite-context.mjs'
import { slackWorld } from './fakes/slack-recipe-world.mjs'

const lanes = (slate) => slate.boards[0].cards.reduce((n, c) => ({ ...n, [c.lane]: (n[c.lane] || 0) + 1 }), {})

async function firstRun() {
  const w = slackWorld()
  const instance = w.addInstance('i1', 'slack-decision-log', { channels: [CHANNEL.id] })
  await w.deliver(MESSAGES)
  const ai = fakeAi(foldModel)
  const run = await w.run(S1, instance, { ai })
  return { w, instance, ai, run }
}

test('a fixture channel: exactly 3 Decided and 1 Reversed, each linked to its thread, one model call', async () => {
  const { w, ai, run } = await firstRun()
  const [log] = run.result.desired.slates
  assert.equal(log.role, 'decisions')
  assert.equal(log.name, 'Decision log — #proj-checkout')
  assert.equal(log.boards[0].component, 'team-board')
  assert.deepEqual(log.boards[0].lanes.map((l) => l.label), ['Maybe', 'Decided', 'Revisited', 'Reversed'])
  assert.deepEqual(lanes(log), { decided: 3, reversed: 1 })
  for (const card of log.boards[0].cards) {
    assert.match(card.link, /^https:\/\/acme\.slack\.com\/archives\/C0CHECKOUT1\/p\d+/)
    assert.match(card.key, /^dec:C0CHECKOUT1:/)
  }
  const adyen = log.boards[0].cards.find((c) => /Adyen/.test(c.label))
  assert.deepEqual(adyen.fields, { why: '3DS2 coverage matters more than fees', by: 'Ana', date: '2026-11-20' })
  assert.equal(ai.calls.length, 1)
  assert.ok(ai.calls[0].tokensIn <= 16000)
  assert.equal(w.fake.counts['conversations.history'] || 0, 0, 'no history read: events, search and gated replies only')
  assert.deepEqual(run.events.map((e) => e.event).sort(), ['decision.recorded', 'decision.recorded', 'decision.recorded', 'decision.reversed'])
  assert.equal(run.result.summary, '4 decisions on the log, 0 archived, from 1 channel')
})

test('a rerun with nothing new: no model call, no Slack history, the same slates (zero operations), no events', async () => {
  const { w, instance, ai, run } = await firstRun()
  const callsBefore = { ...w.fake.counts }
  const again = await w.run(S1, instance, { ai })
  assert.equal(ai.calls.length, 1, 'still the one call from the first run')
  assert.deepEqual(again.result.desired.slates, run.result.desired.slates)
  assert.deepEqual(again.events, [])
  assert.equal(w.fake.counts['search.messages'], callsBefore['search.messages'], 'no second backfill')
})

test('new replies: a revisit moves the card to Revisited (same key, so a person\'s edits stay with it); a person\'s confirmed card keeps its key', async () => {
  const { w, instance, ai, run } = await firstRun()
  const datadog = run.result.desired.slates[0].boards[0].cards.find((c) => /Datadog/.test(c.label))
  const thread = datadog.key.split(':').slice(2).join(':')
  w.clock.at += 3600000
  await w.deliver([{ ts: tsAt(10000), threadTs: thread, user: 'U0RAJ', text: "Let's revisit Datadog, the bill doubled" }])
  const later = await w.run(S1, instance, { ai })
  const card = later.result.desired.slates[0].boards[0].cards.find((c) => c.key === datadog.key)
  assert.equal(card.lane, 'revisited')
  assert.equal(card.label, datadog.label)
  assert.deepEqual(later.events.map((e) => e.event), ['decision.revisited'])
  assert.equal(later.events[0].data.key, datadog.key)
  assert.equal(ai.calls.length, 2, 'one more fold, one more call')
})

test('two channels: a log each and "All decisions"; a channel the owner left is skipped and logged by id only', async () => {
  const w = slackWorld()
  w.api.channels.find((c) => c.id === OTHER_CHANNEL.id).members.push('U0ANA')
  const instance = w.addInstance('i1', 'slack-decision-log', { channels: [CHANNEL.id, OTHER_CHANNEL.id] })
  await w.deliver(MESSAGES)
  const run = await w.run(S1, instance, { ai: fakeAi(foldModel) })
  assert.deepEqual(run.result.desired.slates.map((s) => s.role), ['decisions', 'decisions', 'all'])
  assert.equal(run.result.desired.slates[2].boards[0].cards.length, 4)
  assert.ok(run.result.desired.slates[2].boards[0].cards.every((c) => c.key.startsWith('all:') && c.fields.channel === '#proj-checkout'))
  // The owner leaves #proj-platform.
  w.api.channels.find((c) => c.id === OTHER_CHANNEL.id).members = ['U0RAJ']
  const left = await w.run(S1, instance, { ai: fakeAi(foldModel) })
  assert.deepEqual(left.result.desired.slates.map((s) => s.role), ['decisions'])
  assert.deepEqual(left.logs, [{ level: 'warn', code: 'not_in_channel', msg: `Skipped ${OTHER_CHANNEL.id}: the owner is not in it.` }])
})

test('a 25th decision rolls the oldest onto the month\'s archive; the board stays at 24', async () => {
  const w = slackWorld({ messages: [] })
  const instance = w.addInstance('i1', 'slack-decision-log', { channels: [CHANNEL.id] })
  const many = Array.from({ length: 25 }, (_, i) => ({ ts: tsAt(i * 60), user: 'U0ANA', text: `We decided to adopt standard number ${i + 1} for checkout` }))
  await w.deliver(many)
  const ai = fakeAi(foldModel)
  ai.off = true
  const run = await w.run(S1, instance, { ai })
  const [log, archive] = run.result.desired.slates
  assert.equal(log.boards[0].cards.length, LOG_LIMITS.boardCards)
  assert.equal(archive.role, 'archive')
  assert.equal(archive.name, 'Decision log — #proj-checkout — Nov 2026')
  assert.deepEqual(archive.folder, ['Decision archive'])
  assert.equal(archive.boards[0].cards.length, 1)
  assert.match(archive.boards[0].cards[0].label, /number 1 for checkout/)
  assert.equal(log.notes.find((n) => n.key === 'contents').text, 'Archive: Nov 2026 (1)')
  assert.equal(run.result.desired.partial, 'ai_refused', 'the model off: the deterministic read, marked partial')
})

test('privacy: no stored row holds more than a 280-character quote of a message; logs and events hold ids, titles and links only', async () => {
  const { w, run } = await firstRun()
  const long = MESSAGES.find((m) => m.text.length > 120).text
  for (const row of w.stores.ledger._rows.values()) {
    assert.equal(row.teamId, TEAM)
    for (const value of Object.values(row.data)) if (typeof value === 'string') assert.ok(value.length <= 280)
  }
  const out = JSON.stringify({ logs: run.logs, events: run.events })
  assert.ok(!out.includes(long), 'no message body in logs or events')
  assert.ok(!out.includes('xoxp-'), 'no token anywhere')
})
