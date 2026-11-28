// The Slack channel ledger shared by the Slack recipes (enterprise/recipes/_slack-ledger): dates
// people commit to, resolved against the message's day; the cheap first pass (noise, threads,
// scores); and the fold: one model call at most, over the threads that score, rows keyed so a
// re-fold is idempotent, reversals, moved dates and "done" found, deleted messages taking their rows,
// quotes capped at 280 characters, and the whole answer still there with the model off.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-slack-ledger.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveDue, daysBetween } from '../enterprise/recipes/_slack-ledger/dates.mjs'
import { commitmentWhat, decisionParts, isNoise, isQuestion, scoreThread, slackPlain, threadsOf } from '../enterprise/recipes/_slack-ledger/signals.mjs'
import { FOLD_LIMITS, foldChannel, ledgerKey, permalinkOf } from '../enterprise/recipes/_slack-ledger/fold.mjs'
import { ACCOUNT, CHANNEL, foldModel, MESSAGES, tsAt } from '../enterprise/recipes/_slack-ledger/fixtures/checkout.mjs'
import { fakeAi } from './fakes/recipe-lite-context.mjs'

const TUESDAY = Date.parse('2026-11-24T15:00:00Z')
const NOW = Date.parse('2026-11-27T18:00:00Z')

test('dates: the day a message names, resolved against the day it was sent', () => {
  const cases = [
    ['API frozen by Dec 5', '2026-12-05'],
    ['signed next Friday', '2026-12-04'],
    ['by Friday', '2026-11-27'],
    ['12/15', '2026-12-15'],
    ['in 3 days', '2026-11-27'],
    ['end of month', '2026-11-30'],
    ['tomorrow', '2026-11-25'],
    ['ship 2026-12-01', '2026-12-01'],
    ['EOW', '2026-11-27'],
    ['Jan 4', '2027-01-04'],
    ['5th of December', '2026-12-05'],
  ]
  for (const [text, due] of cases) assert.equal(resolveDue(text, TUESDAY)?.due, due, text)
  assert.deepEqual(resolveDue('next sprint', TUESDAY), { vague: 'next sprint' })
  assert.equal(resolveDue('we sat on it for a while', TUESDAY), null)
  assert.equal(resolveDue('the 1/2 measure', TUESDAY)?.due, '2027-01-02', 'a bare m/d is a date')
  // The owner's time zone decides "tomorrow" late in the UTC day.
  assert.equal(resolveDue('tomorrow', Date.parse('2026-11-25T03:00:00Z'), { tz: 'America/Los_Angeles' }).due, '2026-11-25')
  assert.equal(daysBetween('2026-11-27', '2026-12-09'), 12)
})

test('signals: noise drops; threads group; decisions, commitments and questions read without a model', () => {
  assert.ok(isNoise({ ts: '1.000001', text: 'ok' }))
  assert.ok(isNoise({ ts: '1.000001', text: 'Deploy done', bot: true }))
  assert.ok(isNoise({ ts: '1.000001', text: 'x joined', subtype: 'channel_join' }))
  assert.ok(!isNoise({ ts: '1.000001', text: 'Deploy done', bot: true }, { keepBots: true }))
  assert.ok(!isNoise({ ts: '1.000001', text: 'We decided to ship Friday' }))
  assert.equal(slackPlain('<@U0DANA> see <#C0CHECKOUT1|proj-checkout> and <https://x.example.com|the doc> &amp; more', new Map([['U0DANA', 'Dana']])), '@Dana see #proj-checkout and the doc & more')
  assert.deepEqual(decisionParts("Agreed: let's go with Adyen for EU because 3DS2 coverage matters more than fees"), { title: 'Adyen for EU', rationale: '3DS2 coverage matters more than fees' })
  assert.equal(decisionParts('Decision: retry soft declines once after 2 seconds').title, 'Retry soft declines once after 2 seconds')
  assert.equal(commitmentWhat('@Dana will have the PSP contract signed next Friday', 'next Friday'), 'PSP contract signed')
  assert.equal(commitmentWhat("I'll set up the Datadog dashboards by Friday", 'by Friday'), 'Set up the Datadog dashboards')
  assert.ok(isQuestion('Does anyone know when the PCI audit is scheduled?'))
  assert.ok(!isQuestion('Lunch at the taco place?'), 'small talk with a question mark is not an open question')
  const threads = threadsOf(MESSAGES.filter((m) => !isNoise(m)), CHANNEL.id)
  const psp = threads.find((t) => /Adyen or Stripe/.test(t.messages[0].text))
  assert.equal(psp.messages.length, 5, 'the root and its replies (the "nice" is noise)')
  assert.ok(scoreThread(psp).score >= FOLD_LIMITS.minScore)
  const chatter = threads.find((t) => /Standup notes/.test(t.messages[0].text))
  assert.equal(scoreThread(chatter).score, 0)
})

test('fold: one model call over the threads that score (≤ 16k in), rows keyed by channel and thread, links to each message', async () => {
  const ai = fakeAi(foldModel)
  const out = await foldChannel({ channel: CHANNEL, messages: MESSAGES, ai, account: ACCOUNT, now: NOW })
  assert.equal(ai.calls.length, 1)
  assert.ok(ai.calls[0].tokensIn <= 16000 && ai.calls[0].maxIn === 16000 && ai.calls[0].maxOut === 2000)
  assert.ok(out.stats.candidates <= FOLD_LIMITS.threads && out.stats.candidates < out.stats.threads, 'only threads that score go to the model')
  const decisions = out.upserts.filter((r) => r.kind === 'decision')
  assert.deepEqual(decisions.map((r) => r.data.status).sort(), ['decided', 'decided', 'decided', 'reversed'])
  for (const d of decisions) {
    assert.match(d.key, /^dec:C0CHECKOUT1:\d+\.\d+$/)
    assert.match(d.data.permalink, /^https:\/\/acme\.slack\.com\/archives\/C0CHECKOUT1\/p\d+/)
  }
  const reversed = decisions.find((r) => r.data.status === 'reversed')
  assert.match(reversed.data.title, /No automatic retries/)
  const commitments = Object.fromEntries(out.upserts.filter((r) => r.kind === 'commitment').map((r) => [r.data.what, r.data]))
  assert.equal(commitments['PSP contract signed'].due, '2026-12-09', 'the later message moved the date')
  assert.deepEqual(commitments['PSP contract signed'].dueHistory.map((h) => h.due), ['2026-11-27', '2026-12-09'])
  assert.equal(commitments['PSP contract signed'].slipDays, 12)
  assert.equal(commitments['3DS2 challenge flow shipped'].done, true)
  const questions = out.upserts.filter((r) => r.kind === 'question')
  assert.equal(questions.find((q) => /PCI audit/.test(q.data.text)).data.answered, false)
  assert.equal(questions.find((q) => /staging password/.test(q.data.text)).data.answered, true)
  const psp = out.upserts.find((r) => r.key === ledgerKey.concept(CHANNEL.id, 'PSP'))
  assert.equal(psp.data.definition, 'payment service provider, for anyone new here')
  assert.ok(psp.data.mentions >= 4)
  assert.equal(permalinkOf(ACCOUNT, 'C1', '1.000002', '1.000001'), 'https://acme.slack.com/archives/C1/p1000002?thread_ts=1.000001&cid=C1')
})

test('fold: with the model off (or refusing) the same decisions, dates and questions, marked partial', async () => {
  const ai = fakeAi(foldModel)
  ai.off = true
  const out = await foldChannel({ channel: CHANNEL, messages: MESSAGES, ai, account: ACCOUNT, now: NOW })
  assert.equal(out.stats.partial, 'ai_refused')
  assert.deepEqual(out.upserts.filter((r) => r.kind === 'decision').map((r) => r.data.status).sort(), ['decided', 'decided', 'decided', 'reversed'])
  const commitments = Object.fromEntries(out.upserts.filter((r) => r.kind === 'commitment').map((r) => [r.data.what, r.data]))
  assert.equal(commitments['PSP contract signed'].due, '2026-12-09')
  assert.equal(commitments['Ship the 3DS2 challenge flow'].done, true)
  assert.equal(Object.keys(commitments).length, 4, '"Retro is moved to Thursday" is not a commitment')
  const none = await foldChannel({ channel: CHANNEL, messages: MESSAGES, ai: null, account: ACCOUNT, now: NOW })
  assert.equal(none.stats.partial, 'ai_off')
})

test('fold: idempotent; a later reply updates its row; a deleted message takes its rows; quotes stay ≤ 280 characters', async () => {
  const ai = fakeAi(foldModel)
  const first = await foldChannel({ channel: CHANNEL, messages: MESSAGES, ai, account: ACCOUNT, now: NOW })
  const again = await foldChannel({ channel: CHANNEL, messages: [], rows: first.upserts, ai, account: ACCOUNT, now: NOW })
  assert.equal(again.upserts.length, 0)
  assert.equal(ai.calls.length, 1, 'nothing new: no model call')

  // A revisit in the Datadog thread.
  const datadog = first.upserts.find((r) => r.kind === 'decision' && /Datadog/.test(r.data.title))
  const revisit = { ts: tsAt(9000), threadTs: datadog.sourceRef.threadTs, user: 'U0RAJ', text: "Let's revisit Datadog, the bill doubled" }
  const later = await foldChannel({ channel: CHANNEL, messages: [revisit], rows: first.upserts, ai: null, account: ACCOUNT, now: NOW })
  const row = later.upserts.find((r) => r.key === datadog.key)
  assert.equal(row.data.status, 'revisited')
  assert.equal(row.data.title, datadog.data.title, 'the title stays the decision')
  assert.deepEqual(row.data.history.map((h) => h.status), ['decided', 'revisited'])

  // The decision message deleted in Slack: its row goes.
  const gone = await foldChannel({ channel: CHANNEL, messages: [{ ts: datadog.sourceRef.ts, deleted: true }], rows: first.upserts, ai: null, account: ACCOUNT, now: NOW })
  assert.deepEqual(gone.removed, [datadog.key])

  // A long message: only its 280-character quote is kept.
  const long = { ts: tsAt(9100), user: 'U0ANA', text: 'We decided to move all EU traffic to Adyen ' + 'because of coverage and reliability '.repeat(20) }
  const quoted = await foldChannel({ channel: CHANNEL, messages: [long], ai: null, account: ACCOUNT, now: NOW })
  for (const r of quoted.upserts) for (const value of Object.values(r.data)) if (typeof value === 'string') assert.ok(value.length <= 280, `${r.kind} keeps ≤ 280 characters`)
})

test('fold: deciders limit who makes a decision; low confidence lands in Maybe', async () => {
  const ai = fakeAi((prompt) => {
    const out = foldModel(prompt)
    for (const t of out.threads) for (const d of t.decisions) if (/Datadog/.test(d.title)) d.confidence = 0.4
    return out
  })
  const out = await foldChannel({ channel: CHANNEL, messages: MESSAGES, ai, account: ACCOUNT, now: NOW })
  assert.equal(out.upserts.find((r) => r.kind === 'decision' && /Datadog/.test(r.data.title)).data.status, 'maybe')
  const only = await foldChannel({ channel: CHANNEL, messages: MESSAGES, ai: fakeAi(foldModel), account: ACCOUNT, now: NOW, config: { deciders: ['U0ANA'] } })
  assert.deepEqual(only.upserts.filter((r) => r.kind === 'decision').map((r) => r.data.title), ['Use Adyen as the EU PSP'])
})
