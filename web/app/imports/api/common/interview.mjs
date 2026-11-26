// The interview: a person talks with Slatebox's agent about their work, so later slices can suggest
// boards and slates made for them. One turn is one method call (interview.start for the agent's first
// question, interview.turn for each answer) and the transcript is text, so a voice mode can later sit
// on the same composer and the same server turns.
//
// Pure rules only (no Meteor, no database), shared by the server (server/interview/core.mjs) and the
// About you tab (imports/ui/components/profile/Interview.jsx): the bounds, the history a turn sends,
// what the agent's remember call may propose (kinds, words, grounded in what the person said, never
// anything sensitive), the refusals personalSettings give, the connected tools as the prompt reads
// them, and the summary "Done for now" shows. Nothing here saves a fact: the person keeps each one.
import { FACT_KINDS, LIMITS, factKey, personalizationOn, sourceOn, tidyText } from './personal-facts.mjs'

export const INTERVIEW_LIMITS = Object.freeze({
  // what the person writes in one turn, and what the agent says in one
  message: 1200,
  reply: 1200,
  // the earlier turns a turn sends: the last six exchanges (the agent's question and the answer)
  historyEntries: 12,
  // facts one turn may propose, and facts one Keep may save
  proposed: 5,
  keep: 20,
  // connected tools the prompt names, and the characters of one tool's name
  tools: 20,
  toolName: 60,
})

// The source every fact from the interview is kept under (personal-facts.mjs SOURCE_TYPES).
export const INTERVIEW_SOURCE = Object.freeze({ type: 'interview' })

export class InterviewError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const said = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max

/**
 * The earlier turns as a turn sends them: { role: 'user' | 'assistant', content }, alternating, the
 * agent's opening question first and its latest question last (the new message answers it). Throws
 * InterviewError('invalid-history') for anything else, so a page that lost its place reloads.
 */
export function checkHistory(history) {
  if (!Array.isArray(history) || history.length > INTERVIEW_LIMITS.historyEntries)
    throw new InterviewError('invalid-history', 'Close this talk and start a new one.')
  const out = []
  for (const [index, turn] of history.entries()) {
    const role = index % 2 === 0 ? 'assistant' : 'user'
    const max = role === 'assistant' ? INTERVIEW_LIMITS.reply : INTERVIEW_LIMITS.message
    if (turn?.role !== role || !said(turn.content, max)) throw new InterviewError('invalid-history', 'Close this talk and start a new one.')
    out.push({ role, content: turn.content })
  }
  if (out.length && out.at(-1).role !== 'assistant') throw new InterviewError('invalid-history', 'Close this talk and start a new one.')
  return out
}

/**
 * The history a page sends from its whole transcript ([{ role, content }], the agent first): the
 * newest exchanges that fit the bound, still starting with an agent's turn and ending with its
 * latest question.
 */
export function historyFor(transcript) {
  const turns = (Array.isArray(transcript) ? transcript : []).filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' && turn.content.trim())
  let end = turns.length
  while (end > 0 && turns[end - 1].role !== 'assistant') end -= 1
  let start = Math.max(0, end - INTERVIEW_LIMITS.historyEntries)
  while (start < end && turns[start].role !== 'assistant') start += 1
  return turns.slice(start, end).map(({ role, content }) => ({ role, content }))
}

// ---- what must never be asked for or kept ------------------------------------------------------

// Words that mark something sensitive about a person: credentials, health, money, identity numbers.
// The interview never asks for them and never proposes or keeps a fact that holds them. Work about
// these subjects ("Product manager at a health insurer", "Runs payroll for wages in 3 countries",
// "Reconciles bank accounts monthly", "Rotates API keys for the platform team", "Builds mental
// health apps") reads as work: the patterns need the person's own details (my/your, "is" and a
// value, an amount of money, "diagnosed with"), not just the field's words.
const OWN = String.raw`\b(?:my|your|our)\s+(?:own\s+|current\s+|personal\s+|home\s+|work\s+|bank\s+|email\s+|login\s+)?`
const own = (words) => new RegExp(`${OWN}(?:${words})\\b`, 'i')
const MONEY = String.raw`(?:[$€£¥]\s?\d|\b\d{2,3},\d{3}\b|\b\d+(?:[.,]\d+)?\s?(?:k|K|thousand|million|a year|per year|an hour|per hour|usd|eur|gbp)\b)`
const SENSITIVE = [
  // credentials: their own, or one given with its value
  own(String.raw`pass(?:word|code|phrase)s?|pins?|pin (?:code|number)s?|api keys?|secret keys?|private keys?|access tokens?|auth tokens?|credentials?|logins?|two[- ]factor codes?|2fa codes?|one[- ]time codes?`),
  /\b(?:pass(?:word|code|phrase)|pin|api key|secret|token|login)\s*(?:is|was|:|=)\s*\S/i,
  /\b(?:bank|email|account|wifi|wi-fi|phone|laptop|computer)\s+pass(?:word|code|phrase)s?\b(?!\s+(?:resets?|polic(?:y|ies)|managers?|rules?))/i,
  /\bpass(?:word|code|phrase)s?\s+(?=\S*\d)[^\s.,;]{4,}/i,
  /\b(?:two[- ]factor|2fa|one[- ]time) codes?\b[^.;]{0,24}\b(?:by|via|over) (?:text|sms|phone)\b/i,
  // identity numbers
  /\bsocial security(?: number)?\b|\bssn\b|\bpassport (?:number|no)\b|\bdriver'?s licen[cs]e (?:number|no)\b|\bnational id(?: number)?\b/i,
  // their own money, accounts and cards
  own(String.raw`(?:bank|checking|savings) accounts?|account numbers?|routing numbers?|iban|sort code|(?:credit|debit) cards?|card numbers?|cvv`),
  /\b(?:account|routing|card) numbers?\s*(?:is|was|:)/i,
  /\bbank account (?:at|with)\b/i,
  own(String.raw`salary|income|pay|wages|debts?|loans?|mortgage|savings|net worth|credit score`),
  /\b(?:salary|income|pay)\s+(?:is|was)\b/i,
  new RegExp(String.raw`\b(?:salary|income|earns?|earning|wages?|paid)\b[^.;]{0,24}${MONEY}`, 'i'),
  /\b(?:i am|i'm|im) (?:in debt|broke)\b/i,
  // their own health
  own(String.raw`illness|disease|condition|medications?|therapy|therapist|doctor|symptoms|disability|diagnosis|health|medical (?:conditions?|history)|pregnancy`),
  /\bdiagnosed with\b|\bi (?:was |am |'m |have been )?diagnosed\b/i,
  /\b(?:i take|takes|taking|i'm on|i am on) (?:medication|medicine|meds)\b/i,
  /\b(?:i am|i'm|is|am) pregnant\b|\bpregnant with\b/i,
  /\b(?:i am|i'm|i was|was) prescribed\b/i,
  /\bmental health days?\b/i,
  // their own beliefs and orientation
  own(String.raw`religion|religious beliefs?|faith|political (?:views|party|beliefs?)|politics|sexual orientation`),
  /\bpolitical views are\b|\bsexual orientation is\b/i,
]
// Shapes of numbers and keys: a card number, a US social security number, a key or token.
const SENSITIVE_SHAPES = [
  /\b(?:\d[ -]?){13,19}\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:sbx|slb)_[A-Za-z0-9]{24,}/,
]

/** Whether words hold something sensitive (a credential, health, money, an identity number). */
export function sensitive(text) {
  const value = String(text ?? '')
  return SENSITIVE.some((re) => re.test(value)) || SENSITIVE_SHAPES.some((re) => re.test(value))
}

// What asking for something sensitive sounds like (the eval reads the agent's questions with it):
// a question (a sentence ending in "?") that asks for the person's own details: "your" before the
// term ("What is your salary?"), "how much do you earn", "are you on any medication". Mentioning a
// field in passing ("No need to share your password.", "How much tech debt is your team
// carrying?", "What medical records system does the clinic use?", "What does your income statement
// review look like?") is not asking.
const ASKS_OWN = String.raw`pass(?:word|code|phrase)s?|pins?|credentials?|logins?|api keys?|access tokens?|salary|income|pay|wages|debts?|savings|net worth|credit score|bank(?: accounts?| details)?|account numbers?|(?:credit |debit )?cards?(?: numbers?| details)?|ssn|social security(?: number)?|passport(?: number)?|diagnosis|medications?|health|illness|conditions?|therapy|therapist|doctor|religion|religious beliefs?|faith|political (?:views|party|beliefs?)|politics|sexual orientation`
// a work noun right after the term makes it the field, not the person ("your income statement")
const FIELD = String.raw`statements?|reports?|reporting|systems?|software|tools?|team|teams|process(?:es)?|policy|policies|records?|reconciliations?|feeds?|apps?|insurers?|clients?|customers?|plans?|data|workflows?|pages?|resets?|managers?|rotation`
const ASKS = new RegExp(String.raw`\byour\s+(?:own\s+|current\s+|personal\s+|monthly\s+|annual\s+|home\s+)?(?:${ASKS_OWN})\b(?!\s+(?:${FIELD})\b)|\bhow much (?:do |did )?you (?:earn|make|get paid)\b|\bare you (?:on any medication|taking any medication|in debt|pregnant)\b|\bdo you have any (?:health|medical) (?:conditions?|issues?|problems?)\b`, 'i')
const questions = (reply) => (String(reply ?? '').match(/[^.!?。]*[?？]+/g) || [])
export const asksSensitive = (reply) => questions(reply).some((question) => ASKS.test(question))

/** How many questions a reply asks: its question marks, a run of them counted once. */
export const questionCount = (reply) => (String(reply ?? '').match(/[?？]+/g) || []).length

// ---- the remember call -------------------------------------------------------------------------

// Words that never ground a fact on their own ("I", "work", "use").
const COMMON = new Set(['work', 'works', 'working', 'job', 'team', 'role', 'tool', 'tools', 'project', 'projects', 'goal', 'goals', 'thing', 'things', 'lot', 'day', 'week', 'like', 'likes', 'also', 'just', 'really', 'very', 'some', 'most', 'every', 'each', 'about', 'from', 'into', 'over', 'their', 'they', 'them', 'this', 'that', 'what', 'when', 'where', 'which', 'have', 'has', 'had', 'been', 'being', 'does', 'doing', 'done', 'make', 'makes'])
const contentWords = (text) => factKey(text).split(' ').filter((word) => word.length >= 3 && !COMMON.has(word))
const stem = (word) => word.replace(/(?:ies|es|s|ing|ed)$/, '').replace(/(.)\1$/, '$1')

/**
 * Whether a fact comes from what the person said: at least one of its words (a name, a noun) is in
 * their own words, by stem ("Plans sprints" from "I plan our sprints"). A fact with nothing of theirs
 * in it is the agent's guess, and is never proposed.
 */
export function grounded(fact, saidText) {
  const theirs = new Set(contentWords(saidText).map(stem))
  if (!theirs.size) return false
  return contentWords(fact?.text).some((word) => theirs.has(stem(word)))
}

/**
 * What a remember call proposes, ready for the person to keep or skip: kinds from the fixed list,
 * words tidied and bounded, nothing sensitive, nothing the person did not say (`saidText`, their own
 * words in this talk), nothing they already keep (`known`, the facts' lines or texts), no repeats,
 * at most INTERVIEW_LIMITS.proposed. → { proposed: [{ kind, text }], dropped: { kind, sensitive,
 * ungrounded, known, repeated, over } }
 */
export function proposedFacts(facts, { saidText = '', known = [] } = {}) {
  const dropped = { kind: 0, sensitive: 0, ungrounded: 0, known: 0, repeated: 0, over: 0 }
  const list = Array.isArray(facts) ? facts : []
  const have = new Set(known.map((item) => (typeof item === 'string' ? item : `${item.kind}\u0000${factKey(item.text)}`)))
  const seen = new Set()
  const proposed = []
  for (const item of list) {
    const text = tidyText(item?.text, LIMITS.text)
    if (!FACT_KINDS.includes(item?.kind) || !text) { dropped.kind += 1; continue }
    if (sensitive(text)) { dropped.sensitive += 1; continue }
    if (!grounded({ text }, saidText)) { dropped.ungrounded += 1; continue }
    const id = `${item.kind}\u0000${factKey(text)}`
    if (have.has(id)) { dropped.known += 1; continue }
    if (seen.has(id)) { dropped.repeated += 1; continue }
    if (proposed.length >= INTERVIEW_LIMITS.proposed) { dropped.over += 1; continue }
    seen.add(id)
    proposed.push({ kind: item.kind, text })
  }
  return { proposed, dropped }
}

const readJSON = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

/**
 * A model's answer as a turn: plain words (its question), or a remember call ({ facts, reply }) with
 * the words it wrote beside the call as the reply when the call has none. Throws InterviewError
 * ('invalid-answer') for an answer with no usable reply, or a call to another tool.
 * → { reply, facts: [{ kind, text }] } (facts not yet checked: proposedFacts does that)
 */
export function readAnswer({ toolCall = null, text = '' } = {}, { toolName = 'remember' } = {}) {
  const plain = typeof text === 'string' ? text.trim() : ''
  if (!toolCall) {
    if (!said(plain, INTERVIEW_LIMITS.reply)) throw new InterviewError('invalid-answer', 'The agent gave no question.')
    return { reply: plain, facts: [] }
  }
  if (toolCall.name !== toolName) throw new InterviewError('invalid-answer', `The agent called ${String(toolCall.name).slice(0, 40)}.`)
  const args = readJSON(toolCall.arguments)
  const facts = readJSON(args?.facts)
  if (args === null || typeof args !== 'object' || (facts !== undefined && !Array.isArray(facts)))
    throw new InterviewError('invalid-answer', 'The facts were not a list.')
  const reply = typeof args.reply === 'string' && args.reply.trim() ? args.reply.trim() : plain
  if (!said(reply, INTERVIEW_LIMITS.reply)) throw new InterviewError('invalid-answer', 'The agent gave no question.')
  return { reply, facts: (facts || []).map((fact) => readJSON(fact)) }
}

/**
 * Facts the person chose to keep, as interview.keep receives them: a list of { kind, text }, at most
 * INTERVIEW_LIMITS.keep. Sensitive ones are refused (never saved, counted). Throws InterviewError
 * ('invalid-keep') for anything that is not such a list. → { facts, refused }
 */
export function factsToKeep(facts) {
  if (!Array.isArray(facts) || !facts.length || facts.length > INTERVIEW_LIMITS.keep)
    throw new InterviewError('invalid-keep', `Keep between 1 and ${INTERVIEW_LIMITS.keep} facts at once.`)
  const out = []
  let refused = 0
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object' || !FACT_KINDS.includes(fact.kind) || typeof fact.text !== 'string' || !fact.text.trim() || fact.text.length > LIMITS.text)
      throw new InterviewError('invalid-keep', `Each fact has a kind and up to ${LIMITS.text} characters.`)
    if (sensitive(fact.text)) refused += 1
    else out.push({ kind: fact.kind, text: tidyText(fact.text) })
  }
  return { facts: out, refused }
}

// ---- refusals and prompt values ----------------------------------------------------------------

/**
 * Why the person's own settings stop the interview, or null: personalization off, or the interview
 * switched off as a source. Said before any model is asked. → null | { code, message }
 */
export function settingsRefusal(settings) {
  if (!personalizationOn(settings))
    return { code: 'personalization-off', message: 'Personalization is off, so the agent is not getting to know you. Turn it on in About you to talk about your work.' }
  if (!sourceOn(settings, INTERVIEW_SOURCE))
    return { code: 'interview-off', message: 'Learning from talks with the agent is off in About you. Turn it on there to talk about your work.' }
  return null
}

/**
 * The tools a person connected, as the prompt names them: one line each, its name only (tidied,
 * bounded), the way the person would say it. The kind and gallery card stay with the code and are
 * never shown to the model, so it cannot repeat them ("the Linear MCP server", "card linear"). At
 * most INTERVIEW_LIMITS.tools, each name once. '' for none. The caller wraps it as data.
 */
export function toolLines(tools) {
  const lines = []
  const seen = new Set()
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (lines.length >= INTERVIEW_LIMITS.tools) break
    const name = tidyText(tool?.name, INTERVIEW_LIMITS.toolName)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    lines.push(`- ${name}`)
  }
  return lines.join('\n')
}

/** The values interview.system and interview.opening render with: what is known and what is connected. */
export function promptValues({ facts = '', tools = '' } = {}) {
  const known = typeof facts === 'string' ? facts.trim() : ''
  const connected = typeof tools === 'string' ? tools.trim() : ''
  return {
    hasFacts: Boolean(known),
    hasTools: Boolean(connected),
    ...(known && { facts: known }),
    ...(connected && { tools: connected }),
  }
}

/**
 * Proposals from a new turn that are not already a chip in this talk (kept, skipped or still open):
 * the model does not see its earlier remember calls, so it may propose the same fact again, and one
 * the person skipped never comes back. `turns` is the page's transcript ([{ proposed?: [{ kind,
 * text }] }]).
 */
export function freshProposals(proposed, turns) {
  const shown = new Set((Array.isArray(turns) ? turns : [])
    .flatMap((turn) => (Array.isArray(turn?.proposed) ? turn.proposed : []))
    .map((fact) => `${fact.kind}\u0000${factKey(fact.text)}`))
  return (Array.isArray(proposed) ? proposed : []).filter((fact) => !shown.has(`${fact.kind}\u0000${factKey(fact.text)}`))
}

/**
 * What a Keep came to, from interview.keep's answer ({ added, same, overCap, invalid, refused }):
 * 'kept', 'had' (already in About you), or an error the person reads beside the chip; only the first
 * two mark the chip kept and count in the summary. → { state: 'kept' | 'had' } | { error }
 */
export function keepOutcome(out) {
  if (out?.added > 0) return { state: 'kept' }
  if (out?.same > 0) return { state: 'had' }
  if (out?.refused > 0) return { error: 'That looks private, so it was not kept.' }
  if (out?.overCap > 0) return { error: 'About you is full. Remove something there to keep this.' }
  if (out?.invalid > 0) return { error: 'That could not be kept as it is. Edit it and try again.' }
  return { error: 'That could not be kept. Try again.' }
}

/**
 * What "Done for now" says: how many facts were kept in this talk, and which, and how many the
 * person did not decide on (still open above, not kept).
 */
export function keptSummary(kept, { open = 0 } = {}) {
  const list = Array.isArray(kept) ? kept : []
  const keptWords = !list.length
    ? 'Nothing was kept this time. What you said was not saved.'
    : `${list.length === 1 ? 'One thing' : `${list.length} things`} kept in About you: ${list.map((fact) => fact.text).join('; ')}.`
  if (!(open > 0)) return keptWords
  return `${keptWords} ${open === 1 ? 'One thing you did not decide on was' : `${open} things you did not decide on were`} not kept; you can still keep ${open === 1 ? 'it' : 'them'} above.`
}
