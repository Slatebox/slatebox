// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The cheap, deterministic first pass over a channel's messages (recipes catalog, "Slack ingest"):
// drop noise, group into threads, score each thread for decisions, dates, assignments, questions and
// reactions, and read what can be read without a model. The model pass (fold.mjs) sees only the
// threads that score, and only their trimmed text; when it is off or over budget, what this file
// reads is the whole answer (marked lower confidence).
import { resolveDue } from './dates.mjs'
import { normalKey, plain } from '../_shared/text.mjs'

export const QUOTE_CHARS = 280

const NOISE_SUBTYPES = new Set(['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name', 'channel_archive', 'channel_unarchive', 'group_join', 'group_leave', 'pinned_item', 'unpinned_item', 'reminder_add', 'huddle_thread'])
const ACK = /^(ok(ay)?|k|thanks?( you)?|thx|ty|lol|haha|nice|cool|great|awesome|sounds good|sgtm|lgtm|yep|yup|yes|no|nope|sure|done|\+1|:[a-z0-9_+-]+:|👍|🙏|🎉)[.! ]*$/i
const POSITIVE = new Set(['white_check_mark', 'heavy_check_mark', 'ballot_box_with_check', '+1', 'thumbsup', 'dart', 'pushpin', '100', 'raised_hands'])
const DONE_REACTIONS = new Set(['white_check_mark', 'heavy_check_mark', 'ballot_box_with_check'])

export const DECISION = /\b(?:we (?:have )?decided|decided (?:to|on|that)|let'?s go with|we'?ll go with|going with|agreed(?: on| to| that)?|we'?re going (?:with|to)|approved|signed off|settled on|the call is)\b|\b(?:decision(?: is)?|final(?:ly)?):/i
export const REVERSAL = /\b(actually[, ]|scratch that|change of plan|revers(e|ing|ed)|revert(ing|ed)?|no longer|instead of|rolling back|roll back|switching (to|back)|we'?re not going (with|to)|undo(ing)? the decision|backing out)\b/i
export const REVISIT = /\b(revisit(ing)?|re-?open(ing)?|reconsider(ing)?|second thoughts|let'?s rethink)\b/i
const COMMIT = /\b(will (have|ship|land|send|finish|deliver|get|do|be done|freeze|cut|sign|merge|deploy|launch)|i'?ll|we'?ll|i will|we will|eta|due|deadline|by (the )?(end|eod|eow)|freeze|frozen|ship(s|ping)?|launch(es|ing)?|go[- ]live|cutoff|code complete)\b/i
const MOVE = /\b(push(ing|ed)?|mov(e|ing|ed)|slip(ping|ped|s)?|delay(ing|ed)?|postpon(e|ing|ed)|bump(ing|ed)?|shift(ing|ed)?|now|new date|re-?schedul(e|ing|ed))\b[^.?!]*\b(to|until|till|for)\b/i
const DONE = /\b(done|shipped|merged|landed|completed|finished|signed|live now|is live|went live|closed out)\b/i
const QUESTION_START = /^(who|what|when|where|why|how|should|could|can|do|does|did|is|are|will|would|any(one|body)?)\b/i

/**
 * A Slack message's text as plain words: <@U…> as the person's name, <#C…|name> as #name, <url|label>
 * as its label, entities decoded. names: Map(userId → name).
 */
export function slackPlain(raw, names = new Map()) {
  return plain(String(raw || '')
    .replace(/<@([UW][A-Z0-9]+)(\|[^>]*)?>/g, (_, id) => '@' + (names.get(id) || 'someone'))
    .replace(/<#([CG][A-Z0-9]+)\|([^>]*)>/g, (_, __, name) => '#' + name)
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), 4000, { lines: true })
}

/** The people a message assigns ("@dana will…", "<@U1> to…"), as Slack user ids. */
export function assignees(raw) {
  const out = []
  for (const m of String(raw || '').matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>\s*(will|to|is going to|can you|please|owns?|'ll)\b/gi)) out.push(m[1])
  return [...new Set(out)]
}

/** Whether a message is noise: joins and topic changes, bots (unless kept), short acknowledgments. */
export function isNoise(message, { keepBots = false } = {}) {
  if (!message || typeof message.ts !== 'string') return true
  if (message.subtype && NOISE_SUBTYPES.has(message.subtype)) return true
  if (!keepBots && (message.bot || message.subtype === 'bot_message')) return true
  const text = String(message.text || '').trim()
  return !text || text.length < 3 || ACK.test(text)
}

/** Messages grouped into threads (a top-level message with no replies is its own thread), oldest first. */
export function threadsOf(messages, channel) {
  const byRoot = new Map()
  for (const message of messages) {
    const root = message.threadTs || message.ts
    if (!byRoot.has(root)) byRoot.set(root, { channel, ts: root, messages: [] })
    byRoot.get(root).messages.push(message)
  }
  const threads = [...byRoot.values()]
  for (const thread of threads) thread.messages.sort((a, b) => Number(a.ts) - Number(b.ts))
  return threads.sort((a, b) => Number(a.ts) - Number(b.ts))
}

const reactionCount = (message, set = POSITIVE) => (message.reactions || []).reduce((sum, r) => sum + (set.has(r.name) ? r.count || r.users?.length || 1 : 0), 0)

/** How likely a thread holds a decision, a dated commitment or an open question (0 = nothing to read). */
export function scoreThread(thread) {
  let score = 0
  const signals = new Set()
  const replies = thread.messages.length - 1
  score += Math.min(replies, 6)
  for (const message of thread.messages) {
    const text = String(message.text || '')
    if (DECISION.test(text)) { score += 5; signals.add('decision') }
    if (REVERSAL.test(text) && DECISION.test(text)) { score += 3; signals.add('reversal') }
    if (REVISIT.test(text)) { score += 2; signals.add('revisit') }
    const due = resolveDue(text, tsMillis(message.ts))
    if (due?.due && COMMIT.test(text)) { score += 3; signals.add('commitment') }
    if (MOVE.test(text) && due?.due) { score += 3; signals.add('moved') }
    if (DONE.test(text) || reactionCount(message, DONE_REACTIONS)) signals.add('done')
    if (assignees(text).length) { score += 3; signals.add('assignment') }
    if (isQuestion(text)) { score += 1; signals.add('question') }
    score += Math.min(reactionCount(message) * 2, 6)
  }
  return { score, signals: [...signals] }
}

export const tsMillis = (ts) => Math.round(Number(ts) * 1000)
export const isQuestion = (text) => {
  const t = String(text || '').trim()
  return t.length >= 8 && t.includes('?') && (QUESTION_START.test(t) || /\b(anyone|anybody|someone|somebody)\b/i.test(t))
}

// A decision's title and its reason: the clause after the last decision phrase ("Agreed: let's go
// with Adyen for EU because…" → "Adyen for EU"), the reason after because / since / so.
const DECISION_ALL = new RegExp(DECISION.source, 'gi')
const REASON = /\s*(?:,\s*)?\b(because|since|so that|so|as|given that|due to)\b\s+/i
export function decisionParts(text) {
  const t = plain(text, 400)
  let end = -1
  for (const m of t.matchAll(DECISION_ALL)) end = m.index + m[0].length
  const after = (end >= 0 ? t.slice(end) : t).replace(/^[\s:,-]+/, '')
  const sentence = (after || t).split(/(?<=[.!?])\s/)[0].replace(/[.!]+$/, '')
  const reason = sentence.match(REASON)
  const head = reason ? sentence.slice(0, reason.index) : sentence
  const title = plain(head.replace(/^(to|that|on)\s+/i, ''), 90)
  return { title: title ? title[0].toUpperCase() + title.slice(1) : plain(t, 90), rationale: reason ? plain(sentence.slice(reason.index + reason[0].length), 140) : '' }
}

/**
 * What a thread says without a model: decisions (with reversals and revisits in the same thread),
 * commitments with their dates, questions and whether they were answered. Each row carries its
 * source message ts, so the fold can build its permalink. confidence is lower than the model's.
 */
export function readThread(thread, { names = new Map(), tz = 'UTC', known = false } = {}) {
  const rows = { decisions: [], commitments: [], questions: [] }
  const msgs = thread.messages
  const decisionsAt = msgs.filter((m) => DECISION.test(String(m.text || '')))
  // known: the ledger already holds this thread's decision, so new replies may reverse or revisit it.
  if (known && !decisionsAt.length) {
    const revisit = msgs.find((m) => REVISIT.test(String(m.text || '')))
    if (revisit) rows.decisions.push({ title: '', rationale: '', decidedBy: [], ts: revisit.ts, quote: plain(slackPlain(revisit.text, names), QUOTE_CHARS), status: 'revisited', confidence: 0.6 })
  }
  if (decisionsAt.length) {
    const first = decisionsAt[0]
    const last = decisionsAt[decisionsAt.length - 1]
    const reversed = (decisionsAt.length > 1 || known) && REVERSAL.test(String(last.text || ''))
    const revisited = !reversed && msgs.some((m) => (known || Number(m.ts) > Number(first.ts)) && REVISIT.test(String(m.text || '')))
    const source = reversed ? last : first
    const text = slackPlain(source.text, names)
    const parts = decisionParts(text)
    const later = msgs.find((m) => Number(m.ts) > Number(source.ts) && /\b(because|since|so that|due to)\b/i.test(m.text || ''))
    rows.decisions.push({
      title: parts.title,
      rationale: parts.rationale || (later ? plain(slackPlain(later.text, names), 140) : ''),
      decidedBy: [...new Set(decisionsAt.map((m) => m.user).filter(Boolean))],
      ts: source.ts,
      quote: plain(text, QUOTE_CHARS),
      status: reversed ? 'reversed' : revisited ? 'revisited' : 'decided',
      ...(reversed && { reversedTitle: decisionParts(slackPlain(first.text, names)).title }),
      confidence: reactionCount(source) > 0 || msgs.length > 2 ? 0.75 : 0.6,
    })
  }
  for (const m of msgs) {
    const text = String(m.text || '')
    const due = resolveDue(text, tsMillis(m.ts), { tz })
    const moved = MOVE.test(text) && Boolean(due?.due)
    if ((COMMIT.test(text) || moved) && (due || assignees(text).length)) {
      const owner = assignees(text)[0] || (/\b(i'?ll|i will)\b/i.test(text) ? m.user : null)
      rows.commitments.push({ what: commitmentWhat(slackPlain(text, names), due?.phrase || due?.vague), owner, due: due?.due || null, vague: due?.vague || null, moved, ...(!COMMIT.test(text) && { moveOnly: true }), ...(afterOf(text) && { after: afterOf(text) }), ts: m.ts, done: false })
    }
    if ((DONE.test(text) && !COMMIT.test(text)) || reactionCount(m, DONE_REACTIONS)) rows.commitments.push({ what: commitmentWhat(slackPlain(text, names)), owner: m.user || null, due: null, moved: false, ts: m.ts, done: true, doneOnly: true })
    if (isQuestion(text)) {
      const answered = msgs.some((r) => Number(r.ts) > Number(m.ts) && r.user && r.user !== m.user && !isNoise(r))
      rows.questions.push({ text: plain(slackPlain(text, names), 200), askedBy: m.user || null, ts: m.ts, answered })
    }
  }
  return rows
}

// What a commitment is about: its sentence without the date, the promise words or filler
// ("@dana will have the PSP contract signed next Friday" → "PSP contract signed").
export function commitmentWhat(text, phrase = null) {
  let sentence = plain(text, 300).split(/(?<=[.!?])\s/).find((s) => COMMIT.test(s) || MOVE.test(s)) || plain(text, 300)
  if (phrase) {
    const at = sentence.toLowerCase().indexOf(String(phrase).toLowerCase())
    if (at >= 0) sentence = (sentence.slice(0, at).replace(/\b(by|on|before|until|till|due|for|to|at|from)\s*$/i, '') + sentence.slice(at + phrase.length)).replace(/\s+([,.;])/g, '$1')
  }
  const what = sentence
    .replace(/^@\S+\s+(will|is going to|to)\s+(have\s+)?/i, '')
    .replace(/^(i'?ll|we'?ll|i will|we will|i'?m going to|we'?re going to)\s+(have\s+)?/i, '')
    .replace(/^(we (have )?decided to|let'?s|plan is to|the plan is to)\s+/i, '')
    .replace(/^(pushing|moving|slipping|bumping|delaying|postponing)\s+/i, '')
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/,\s.*$/, '')
    .replace(/\s+(so|because|since)\s.*$/i, '')
    .replace(/[.!,;:\s]+$/, '')
  const out = plain(what, 90) || plain(text, 90)
  return out[0].toUpperCase() + out.slice(1)
}

/** What a commitment waits on ("…after the API freeze lands" → "API freeze"), or null. */
export function afterOf(raw) {
  const m = String(raw || '').match(/\b(?:after|once|when)\s+(?:the\s+)?([a-z0-9][\w -]{2,60}?)(?:\s+(?:is|are|lands?|ships?|goes|merges?|is done|is in)\b|[,.;]|$)/i)
  return m ? plain(m[1], 60) : null
}

/** Words two commitment texts share (0–1), to match "pushing API freeze to Dec 9" with "API frozen by Dec 5". */
export function overlap(a, b) {
  const stem = (w) => w.replace(/(ing|en|ed|es|s)$/, '')
  const words = (t) => new Set(normalKey(t).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem))
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  let same = 0
  for (const w of x) if (y.has(w)) same++
  return same / Math.min(x.size, y.size)
}
const STOP = new Set(['the', 'and', 'for', 'will', 'have', 'with', 'this', 'that', 'next', 'from', 'pushing', 'moving', 'our', 'are', 'was', 'been', 'into', 'out'])

/** Terms a message uses that read like vocabulary: acronyms (PSP, 3DS2), quoted terms, "X means Y". */
export function conceptsIn(raw) {
  const text = String(raw || '').replace(/<[^>]+>/g, ' ')
  const terms = []
  for (const m of text.matchAll(/\b([A-Z0-9]{0,3}[A-Z][A-Z0-9]{1,6})\b/g)) if (!/^\d+$/.test(m[1]) && !COMMON_CAPS.has(m[1])) terms.push({ term: m[1] })
  for (const m of text.matchAll(/["“]([A-Za-z][\w -]{2,30})["”]/g)) terms.push({ term: m[1].trim() })
  for (const m of text.matchAll(/\b([A-Za-z][\w-]{1,30}(?: [\w-]{2,20})?)\s+(?:means|is short for|stands for|=)\s+([^.?!\n]{3,140})/g)) terms.push({ term: m[1].trim(), definition: plain(m[2], 140) })
  return terms
}
const COMMON_CAPS = new Set(['OK', 'OKAY', 'FYI', 'ASAP', 'EOD', 'EOW', 'EOM', 'TBD', 'TODO', 'LGTM', 'SGTM', 'PR', 'AM', 'PM', 'US', 'UTC', 'PST', 'EST', 'IMO', 'IIRC', 'AFAIK', 'BTW', 'THX', 'WIP', 'ETA', 'QA', 'I', 'A'])
