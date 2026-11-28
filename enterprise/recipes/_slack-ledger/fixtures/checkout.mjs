// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A recorded-style #proj-checkout week (fixture for the Slack recipes' tests): 60 messages as the
// Events API and search.messages deliver them. Four decision threads (one later reversed), dated
// commitments (one moved, one done), questions (one answered, one not), vocabulary (PSP, 3DS2,
// soft decline), and noise (joins, bots, acknowledgments, chatter).

export const TEAM = 'T0ACME0001'
export const CHANNEL = { id: 'C0CHECKOUT1', name: 'proj-checkout' }
export const OTHER_CHANNEL = { id: 'C0PLATFORM1', name: 'proj-platform' }
export const USERS = { U0ANA: 'Ana', U0DANA: 'Dana', U0RAJ: 'Raj', U0LEE: 'Lee', U0SAM: 'Sam' }
export const ACCOUNT = { url: 'https://acme.slack.com/', teamId: TEAM }

const BASE = Date.UTC(2026, 10, 20, 15, 0, 0) / 1000 // Friday Nov 20 2026, 15:00 UTC
let seq = 0
/** A Slack ts minutes after the base (unique). */
export const tsAt = (minutes) => `${BASE + minutes * 60}.${String(++seq).padStart(6, '0')}`

const m = (minutes, user, text, extra = {}) => ({ ts: tsAt(minutes), user, text, ...extra })

function build() {
  seq = 0
  const out = []
  const push = (msg) => {
    out.push(msg)
    return msg
  }
  // Noise first: people joining, a bot, small talk.
  push(m(0, 'U0SAM', '<@U0SAM> has joined the channel', { subtype: 'channel_join' }))
  push(m(1, 'U0LEE', '<@U0LEE> has joined the channel', { subtype: 'channel_join' }))
  push(m(2, null, 'Deploy #4412 to staging succeeded', { subtype: 'bot_message', bot: true }))

  // A: the PSP decision (a question, a discussion, a decision with reactions).
  const a = push(m(10, 'U0ANA', 'Which PSP should we use for EU checkout, Adyen or Stripe?'))
  push(m(12, 'U0RAJ', 'Adyen has better 3DS2 coverage in Germany and the Netherlands', { threadTs: a.ts }))
  push(m(14, 'U0LEE', 'Stripe fees are a bit lower though', { threadTs: a.ts }))
  push(m(15, 'U0DANA', 'PSP means payment service provider, for anyone new here', { threadTs: a.ts }))
  push(m(20, 'U0ANA', "Agreed: let's go with Adyen for EU because 3DS2 coverage matters more than fees", { threadTs: a.ts, reactions: [{ name: 'white_check_mark', count: 3 }] }))
  push(m(21, 'U0RAJ', 'nice', { threadTs: a.ts }))

  // B: the API freeze (a decision with a date: also a commitment).
  const b = push(m(30, 'U0RAJ', 'We decided to freeze the payments API on Dec 5 so QA has a week', { reactions: [{ name: '+1', count: 2 }] }))
  push(m(31, 'U0LEE', 'makes sense', { threadTs: b.ts }))
  push(m(32, 'U0ANA', 'thanks', { threadTs: b.ts }))

  // C: soft declines: decided, then reversed in the same thread.
  const c = push(m(40, 'U0LEE', 'Decision: retry soft declines once after 2 seconds'))
  push(m(42, 'U0RAJ', 'How do soft declines show up in the dashboard?', { threadTs: c.ts }))
  push(m(44, 'U0DANA', 'They show as code 05 in the Adyen report', { threadTs: c.ts }))
  push(m(300, 'U0LEE', "Actually, scratch that. We're going with no automatic retries, decided to show the soft decline to the shopper instead because retries hurt approval rates", { threadTs: c.ts }))

  // D: logging, with a dated commitment in the thread.
  const d = push(m(60, 'U0DANA', 'Going with Datadog for checkout logs, the team already knows it', { reactions: [{ name: '+1', count: 1 }] }))
  push(m(61, 'U0RAJ', '+1', { threadTs: d.ts }))
  push(m(62, 'U0LEE', "I'll set up the Datadog dashboards by Friday", { threadTs: d.ts }))

  // E: a commitment with an owner and a date, moved later; F: one done.
  const e = push(m(80, 'U0ANA', '<@U0DANA> will have the PSP contract signed next Friday'))
  push(m(81, 'U0DANA', 'on it', { threadTs: e.ts }))
  push(m(90, 'U0RAJ', "I'll ship the 3DS2 challenge flow by Dec 1"))
  push(m(4000, 'U0RAJ', '3DS2 challenge flow is shipped and live now', { reactions: [{ name: 'white_check_mark', count: 2 }] }))
  push(m(2000, 'U0DANA', 'Pushing the PSP contract signing to Dec 9, legal needs more time'))

  // Questions: one answered, one left open.
  const q1 = push(m(100, 'U0SAM', 'Who has the staging password for the Adyen sandbox?'))
  push(m(102, 'U0LEE', 'It is in the team vault under checkout-sandbox', { threadTs: q1.ts }))
  push(m(110, 'U0SAM', 'Does anyone know when the PCI audit is scheduled?'))

  // Chatter and acknowledgments to fill the week.
  const chatter = [
    'Standup notes are in the doc', 'lol', 'ok', 'thanks!', 'Lunch at the taco place?', 'yep', 'Heads up, the office wifi is flaky today',
    'Reviewing the checkout copy with design this afternoon', 'sounds good', 'The soft decline copy needs a second look', 'Pairing with Raj on the webhook handler',
    'Updated the runbook for refunds', 'cool', 'Coffee?', 'Merged the currency formatting fix', 'Retro is moved to Thursday this week', '+1', 'great',
    'Demo went well with the EU team', 'Notes from the PSP call are pinned', 'Adyen sandbox keys rotated', 'Checkout funnel dashboard looks healthy',
    'New hire Sam starts on the risk rules next week', 'Please review my PR for the address form', 'Holiday freeze calendar is up', 'Remember to log time', 'thx', 'Shared the latency graphs in the doc', 'Who wants to pair on the receipts email', 'ok cool', 'Design review moved to 3pm',
  ]
  chatter.forEach((text, i) => push(m(500 + i * 37, ['U0ANA', 'U0DANA', 'U0RAJ', 'U0LEE', 'U0SAM'][i % 5], text)))
  push(m(1500, null, 'Weekly uptime report: 99.98%', { subtype: 'bot_message', bot: true }))
  push(m(1600, 'U0ANA', '<@U0ANA> set the channel topic: EU checkout launch', { subtype: 'channel_topic' }))
  return out.sort((x, y) => Number(x.ts) - Number(y.ts))
}

export const MESSAGES = build()

/** The messages as search.messages returns them (with permalinks and the channel). */
export function searchMatches(messages = MESSAGES, channel = CHANNEL) {
  return messages.filter((x) => !x.subtype || x.subtype === 'bot_message').map((x) => ({
    ts: x.ts, user: x.user, text: x.text, channel: { id: channel.id, name: channel.name },
    permalink: `https://acme.slack.com/archives/${channel.id}/p${x.ts.replace('.', '')}${x.threadTs ? `?thread_ts=${x.threadTs}&cid=${channel.id}` : ''}`,
    ...(x.bot && { bot_id: 'B0BOT', subtype: 'bot_message' }),
  }))
}

/**
 * A fake model's answer for the fold (as a structured-output model would read these threads):
 * finds each thread by what it says and answers in FOLD_SCHEMA's shape.
 */
export function foldModel(prompt) {
  const threads = []
  for (const section of prompt.split(/\n## /).slice(1)) {
    const id = section.split('\n')[0].trim()
    const lines = section.split('\n').slice(1).filter((l) => /^\d+\. /.test(l))
    const find = (re) => lines.findIndex((l) => re.test(l))
    const entry = { id, decisions: [], commitments: [], questions: [], concepts: [] }
    if (find(/Adyen or Stripe/) >= 0 && find(/Agreed/) >= 0) {
      entry.decisions.push({ title: 'Use Adyen as the EU PSP', rationale: '3DS2 coverage matters more than fees', decidedBy: ['U0ANA'], status: 'decided', confidence: 0.92, message: find(/Agreed/) })
      entry.concepts.push({ term: 'PSP', definition: 'Payment service provider', relatedTerms: ['Adyen', 'Stripe'] }, { term: '3DS2', definition: null, relatedTerms: ['PSP'] })
    }
    if (find(/freeze the payments API/) >= 0) {
      entry.decisions.push({ title: 'Freeze the payments API on Dec 5', rationale: 'QA gets a week', decidedBy: ['U0RAJ'], status: 'decided', confidence: 0.88, message: find(/freeze the payments API/) })
      entry.commitments.push({ what: 'Payments API frozen', owner: 'U0RAJ', due: '2026-12-05', status: 'open', message: find(/freeze the payments API/) })
    }
    if (find(/retry soft declines/) >= 0) {
      const reversal = find(/scratch that/)
      if (reversal >= 0) entry.decisions.push({ title: 'No automatic retries; show the soft decline to the shopper', rationale: 'Retries hurt approval rates', decidedBy: ['U0LEE'], status: 'reversed', confidence: 0.9, message: reversal })
      else entry.decisions.push({ title: 'Retry soft declines once after 2 seconds', rationale: '', decidedBy: ['U0LEE'], status: 'decided', confidence: 0.8, message: find(/retry soft declines/) })
      entry.concepts.push({ term: 'soft decline', definition: 'A decline the issuer may approve on retry', relatedTerms: ['PSP'] })
      if (find(/How do soft declines/) >= 0) entry.questions.push({ text: 'How do soft declines show up in the dashboard?', answered: true, message: find(/How do soft declines/) })
    }
    if (find(/Datadog for checkout logs/) >= 0) {
      entry.decisions.push({ title: 'Use Datadog for checkout logs', rationale: 'The team already knows it', decidedBy: ['U0DANA'], status: 'decided', confidence: 0.85, message: find(/Datadog for checkout logs/) })
      if (find(/Datadog dashboards/) >= 0) entry.commitments.push({ what: 'Datadog dashboards set up', owner: 'U0LEE', due: '2026-11-27', status: 'open', message: find(/Datadog dashboards/) })
    }
    const known = section.match(/Already recorded: decision "([^"]+)"/)?.[1]
    if (known && find(/revisit/i) >= 0) entry.decisions.push({ title: known, rationale: '', decidedBy: [], status: 'revisited', confidence: 0.8, message: find(/revisit/i) })
    if (find(/PSP contract signed next Friday/) >= 0) entry.commitments.push({ what: 'PSP contract signed', owner: 'U0DANA', due: '2026-11-27', status: 'open', message: find(/PSP contract signed/) })
    if (find(/Pushing the PSP contract/) >= 0) entry.commitments.push({ what: 'PSP contract signed', owner: 'U0DANA', due: '2026-12-09', status: 'moved', message: find(/Pushing the PSP contract/) })
    if (find(/3DS2 challenge flow by Dec 1/) >= 0) entry.commitments.push({ what: '3DS2 challenge flow shipped', owner: 'U0RAJ', due: '2026-12-01', status: 'open', message: find(/challenge flow by/) })
    if (find(/challenge flow is shipped/) >= 0) entry.commitments.push({ what: '3DS2 challenge flow shipped', owner: 'U0RAJ', due: null, status: 'done', message: find(/challenge flow is shipped/) })
    if (find(/staging password/) >= 0) entry.questions.push({ text: 'Who has the staging password for the Adyen sandbox?', answered: true, message: find(/staging password/) })
    if (find(/PCI audit/) >= 0) entry.questions.push({ text: 'When is the PCI audit scheduled?', answered: false, message: find(/PCI audit/) })
    threads.push(entry)
  }
  return { threads }
}
