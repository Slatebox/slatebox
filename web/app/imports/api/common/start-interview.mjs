// The use-case interview on the start page (/new, "Talk it through with Slatebox"): the person says
// what they want Slatebox to make, the agent asks a few specific questions (who, how often, the
// stages, the numbers, the rules), one at a time, and ends with a plan: a title, a one-line blurb,
// an icon from the start page's set, and one to four boards, each a smart component or a printable
// page with its brief and why. The plan is kept as the person's own tile (personal-tiles.mjs), so
// they can make the same slate again whenever they like.
//
// Pure rules only (no Meteor, no database), shared by the server (server/start/interview-core.mjs)
// and the start page (imports/ui/components/start/StartInterview.jsx): the bounds, the history a
// turn sends, reading the agent's ask and propose_plan calls, and the plan's checks (kinds, bounds,
// the icon set, nothing sensitive). One turn is one call and the transcript is text, so a voice mode
// can later drive the same turns from the same composer.
import { tidyText } from './personal-facts.mjs'
import { sensitive, questionCount } from './interview.mjs'

export const START_LIMITS = Object.freeze({
  // what the person writes in one answer, and what the agent asks in one question
  message: 1200,
  question: 400,
  // answers in one talk: from planBy the agent is asked for the plan, and no answer past `answers` is taken
  planBy: 6,
  answers: 8,
  // the earlier turns a turn sends (the person's first answer first, the agent's latest question last)
  historyEntries: 15,
  // a plan
  title: 60,
  blurb: 140,
  summary: 1200,
  boards: 4,
  boardNameMin: 3,
  boardName: 40,
  briefMin: 20,
  brief: 1200,
  why: 200,
})

/** The kinds of board a plan holds: a smart component (lanes and cards), or a printable page (a grid sheet). */
export const BOARD_KINDS = Object.freeze(['component', 'grid'])
export const BOARD_KIND_LABELS = Object.freeze({ component: 'Smart component', grid: 'Printable page' })

/**
 * The start page's icon set (FirstSlate.jsx draws each one), with what each stands for, as the
 * agent chooses from it for a plan's tile: the eight jobs' own icons, so a tile sits among them, and
 * a few general ones for whatever else a person makes (a league, a club, a checklist, a hobby).
 */
export const TILE_ICONS = Object.freeze({
  ship: 'a rocket: a launch, a deadline, shipping something by a date',
  week: 'columns of cards: running a week, a queue, a team board',
  deals: 'a rising line: a pipeline, a target, a score or standings',
  golive: 'a handshake: working with a client, a customer or a partner',
  feedback: 'a quote mark: feedback, notes, ideas, voices',
  lookback: 'a clock turning back: a review, a retro, a look back',
  money: 'a wallet: a budget, money, costs, hires',
  plan: 'a calendar page: a plan, a schedule, a season, a term',
  trophy: 'a trophy: a league, a game, a contest, a draft, a tournament',
  group: 'a group of people: a club, a class, a household, a crew, members',
  checklist: 'a checklist: steps to tick off, chores, a routine, an inspection',
  leaf: 'a leaf: a garden, a hobby, the outdoors, care for something living',
})
export const TILE_ICON_IDS = Object.freeze(Object.keys(TILE_ICONS))
export const DEFAULT_TILE_ICON = 'plan'

/** The question the start page opens the talk with (the agent's first turn, shown before any model is asked). */
export const START_OPENING = 'What do you want Slatebox to make? A board for your fantasy football league, your team’s launch calendar, a weekly review: anything.'

export const ASK_TOOL_NAME = 'ask'
export const PLAN_TOOL_NAME = 'propose_plan'

export class StartError extends Error {
  constructor(code, message, status = 400, details) {
    super(message)
    this.code = code
    this.status = status
    if (details !== undefined) this.details = details
  }
}

const said = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max

// What a plan may hold that the shared check (interview.mjs sensitive) reads as a person's own: a team's or a
// group's numbers ("our income statement", "our savings target", "our debt and cash runway", "pay-per-click",
// "operating income", "the winner gets paid $400"). A plan is about the thing the person runs, so these are
// read as that thing's; a person's own pay, debts, accounts, cards, sign-in details, health and identity numbers
// ("my salary", "my bank password", "your medication") still are not kept.
const GROUP_WORDS = [
  [/\bour\b/gi, 'the'],
  [/\bpay-per-[a-z]+\b/gi, 'ad spend'],
  [/\b(?:income|cash[- ]flow|profit and loss|p&l) statements?\b/gi, 'statement'],
  [/\b(?:operating|net|gross|business|company|team|quarterly|annual|monthly) (?:income|savings|debts?|loans?)\b/gi, 'figure'],
  [/\bdebt covenants?\b/gi, 'covenant'],
  [/\b(?:savings|revenue|cost|spend|budget) targets?\b/gi, 'target'],
  [/\b(?:winners?|managers?|teams?|players?|members?|everyone|places?|first|second|third|champions?|runners?-up)\s+(?:gets?|are|is|will be)\s+paid\b/gi, 'wins'],
  [/\bpaid (?:out|back) to\b/gi, 'given to'],
]
/** Whether a plan's words hold something sensitive of the person's own (the shared check, with a group's numbers read as the group's). */
export function planSensitive(text) {
  let value = String(text ?? '')
  for (const [pattern, plain] of GROUP_WORDS) value = value.replace(pattern, plain)
  return sensitive(value)
}
const STALE = 'Close this talk and start a new one.'

/**
 * The earlier turns as a turn sends them: { role: 'user' | 'assistant', content }, alternating, the
 * person's first answer first (the page asked the opening question) and the agent's latest question
 * last (the new message answers it). [] for the first answer. Throws StartError('invalid-history').
 */
export function checkStartHistory(history) {
  if (!Array.isArray(history) || history.length > START_LIMITS.historyEntries) throw new StartError('invalid-history', STALE)
  const out = []
  for (const [index, turn] of history.entries()) {
    const role = index % 2 === 0 ? 'user' : 'assistant'
    const max = role === 'assistant' ? START_LIMITS.question : START_LIMITS.message
    if (turn?.role !== role || !said(turn.content, max)) throw new StartError('invalid-history', STALE)
    out.push({ role, content: turn.content })
  }
  if (out.length && out.at(-1).role !== 'assistant') throw new StartError('invalid-history', STALE)
  return out
}

/** The history a page sends from its transcript ([{ role, content }], the person's first answer first). */
export function startHistoryFor(transcript) {
  const turns = (Array.isArray(transcript) ? transcript : []).filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' && turn.content.trim())
  let end = turns.length
  while (end > 0 && turns[end - 1].role !== 'assistant') end -= 1
  let start = Math.max(0, end - START_LIMITS.historyEntries)
  while (start < end && turns[start].role !== 'user') start += 1
  return turns.slice(start, end).map(({ role, content }) => ({ role, content }))
}

/** How many answers a turn makes, counting the new one. */
export const answersSoFar = (history) => (Array.isArray(history) ? history.filter((turn) => turn?.role === 'user').length : 0) + 1

/** Whether this turn must end with the plan: the person asked for it, or the talk reached START_LIMITS.planBy answers. */
export const mustPlan = (history, planNow = false) => Boolean(planNow) || answersSoFar(history) >= START_LIMITS.planBy

const readJSON = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}
const oneLine = (value, max) => tidyText(typeof value === 'string' ? value.replace(/\s*\n+\s*/g, ' ') : value, max)

/**
 * A plan as the agent proposed it, checked: { plan: { title, blurb, icon, boards: [{ kind, name, brief, why }] },
 * summary, problems }. `problems` says, in words for the agent's retry, what made it unusable (an empty
 * list: it is usable). Nothing sensitive is ever kept in a plan: a plan that holds any is a problem.
 */
export function readPlan(args) {
  const raw = readJSON(args)
  const problems = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { plan: null, summary: '', problems: ['The plan was not an object.'] }
  const title = oneLine(raw.title, START_LIMITS.title)
  const blurb = oneLine(raw.blurb, START_LIMITS.blurb)
  const summary = tidyText(raw.summary, START_LIMITS.summary)
  if (!title) problems.push(`Give the plan a title of up to ${START_LIMITS.title} characters.`)
  if (!blurb) problems.push(`Give the plan a one-line blurb of up to ${START_LIMITS.blurb} characters.`)
  if (!summary) problems.push(`Sum up what the person said in up to ${START_LIMITS.summary} characters.`)
  const icon = typeof raw.icon === 'string' ? raw.icon.trim() : ''
  if (!TILE_ICON_IDS.includes(icon)) problems.push(`Choose the icon from ${TILE_ICON_IDS.join(', ')}.`)
  const list = readJSON(raw.boards)
  const boards = []
  if (!Array.isArray(list) || !list.length || list.length > START_LIMITS.boards) problems.push(`Give 1 to ${START_LIMITS.boards} boards.`)
  for (const item of Array.isArray(list) ? list.slice(0, START_LIMITS.boards) : []) {
    const board = readJSON(item)
    const kind = BOARD_KINDS.includes(board?.kind) ? board.kind : null
    const name = oneLine(board?.name, START_LIMITS.boardName + 1)
    const brief = tidyText(board?.brief, START_LIMITS.brief)
    const why = oneLine(board?.why, START_LIMITS.why)
    if (!kind) { problems.push(`Each board's kind is ${BOARD_KINDS.join(' or ')}.`); continue }
    if (!name || name.length < START_LIMITS.boardNameMin || name.length > START_LIMITS.boardName) { problems.push(`Each board has a name of ${START_LIMITS.boardNameMin} to ${START_LIMITS.boardName} characters in the person's words, such as Draft board or Weekly lineup.`); continue }
    if (!brief || brief.length < START_LIMITS.briefMin) { problems.push(`Each board's brief says what to build in ${START_LIMITS.briefMin} to ${START_LIMITS.brief} characters.`); continue }
    if (!why) { problems.push('Each board has a why: one line on what the person said that it fits.'); continue }
    boards.push({ kind, name, brief, why })
  }
  // The retry names each field that holds something of the person's own, so the agent can leave just that out.
  const fields = [['the title', title], ['the blurb', blurb], ['the summary', summary],
    ...boards.flatMap((board, index) => [[`board ${index + 1}'s name`, board.name], [`board ${index + 1}'s brief`, board.brief], [`board ${index + 1}'s why`, board.why]])]
  const held = fields.filter(([, text]) => planSensitive(text)).map(([label]) => label)
  if (held.length) problems.push(`Leave out anything sensitive of the person's own (sign-in details, health, their own pay, debts, bank accounts or cards, identity numbers): ${held.join(', ')} ${held.length === 1 ? 'mentions' : 'mention'} some. A team's or a group's numbers (revenue, budgets, targets, dues, prizes) are fine.`)
  if (problems.length) return { plan: null, summary: '', problems: [...new Set(problems)] }
  return { plan: { title, blurb, icon, boards }, summary, problems: [] }
}

/**
 * A model's answer as a turn: its next question (an ask call, or plain words), or its plan (a
 * propose_plan call). `planOnly`: the plan was asked for, so a question is not a usable turn.
 * Throws StartError('invalid-answer') for an answer that cannot be used.
 * → { kind: 'ask', question } | { kind: 'plan', plan, summary }
 */
export function readStartTurn({ toolCall = null, text = '' } = {}, { planOnly = false } = {}) {
  const plain = typeof text === 'string' ? text.trim() : ''
  const name = toolCall?.name
  if (name === PLAN_TOOL_NAME) {
    const read = readPlan(toolCall.arguments)
    if (!read.plan) throw new StartError('invalid-answer', read.problems.join(' '))
    return { kind: 'plan', plan: read.plan, summary: read.summary }
  }
  if (planOnly) throw new StartError('invalid-answer', `Call ${PLAN_TOOL_NAME} now.`)
  if (toolCall && name !== ASK_TOOL_NAME) throw new StartError('invalid-answer', `Call ${ASK_TOOL_NAME} or ${PLAN_TOOL_NAME}, not ${String(name).slice(0, 40)}.`)
  const args = toolCall ? readJSON(toolCall.arguments) : null
  const question = (toolCall ? (typeof args?.question === 'string' ? args.question.trim() : '') : plain) || (toolCall ? plain : '')
  if (!said(question, START_LIMITS.question)) throw new StartError('invalid-answer', `Ask one short question of up to ${START_LIMITS.question} characters.`)
  if (questionCount(question) > 1) throw new StartError('invalid-answer', 'Ask one question at a time, not two.')
  return { kind: 'ask', question }
}

/**
 * The plan as the talk's history carries it once it is proposed (the agent's own turn, so a revision turn
 * knows what it proposed): its title and each board's name, kind and why, in one bounded line.
 */
export function planTurnText(plan) {
  const boards = (plan?.boards || []).map((board) => `${board.name} (${BOARD_KIND_LABELS[board.kind] || board.kind}): ${board.why}`)
  return `I proposed this plan: ${plan?.title || 'your slate'}. Boards: ${boards.join('; ')}. What would you change?`.slice(0, START_LIMITS.question)
}

/** The icons as the prompt lists them: one '- id: what it stands for' a line. */
export const iconLines = () => TILE_ICON_IDS.map((id) => `- ${id}: ${TILE_ICONS[id]}`).join('\n')

/** The person's own words as one block of text (the eval and the tile read it): their answers, one a line. */
export const saidText = (history = [], message = '') => [...(Array.isArray(history) ? history : []).filter((turn) => turn?.role === 'user').map((turn) => turn.content), message || ''].filter(Boolean).join('\n')

/** What the page says while the agent answers, and once the plan is here. */
export const START_WORDS = Object.freeze({
  thinking: 'Slatebox is thinking of the next question…',
  planning: 'Slatebox is putting your plan together…',
  message: `Write up to ${START_LIMITS.message.toLocaleString('en-US')} characters.`,
  busy: 'Slatebox is still answering. Try again in a moment.',
  failed: 'Slatebox could not answer just now. Try again.',
  off: 'Talking it through with Slatebox is off on this server.',
  noModel: 'No agent model is set up on this server yet, so Slatebox cannot talk it through right now. An administrator chooses one in Admin › AI.',
  guestOnly: 'Save your account to talk it through with Slatebox on this server.',
  done: 'That is all the questions for this talk. Build it, or start over.',
  revise: 'Change anything? Say it here, or build it.',
})
