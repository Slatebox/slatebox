// For you: smart components and printable pages Slatebox proposes for one person's work, from what
// they keep in About you (factsForPrompt) and the names of the tools they connected (the profile
// integrations seam), each built in a click (server/personal/core.mjs).
//
// Pure rules only (no Meteor, no database), shared by the server and the For you cards
// (imports/ui/components/personal/ForYou.jsx): the kinds an idea may be, the bounds, what the
// agent's suggest_ideas call may propose (tied to something the person said or connected, never
// generic, never a repeat or one they turned down, never for a tool they did not connect, never
// anything sensitive), the empty states, and the words people read.
//
// Kinds in v1 (2026-11-26): a smart component (a board of lanes, drafted by workshops.draft format
// 'component') and a printable page (a grid sheet, format 'grid'). A whole starter slate is left for
// a later slice: the first-slate builder makes its boards from fixed plans and keywords, so a slate
// "made for you" would be a generic one with their title on it. An idea is only offered when Build
// it can make it.
import { factKey, personalizationOn, tidyText } from './personal-facts.mjs'
import { grounded, sensitive } from './interview.mjs'

export const IDEA_KINDS = Object.freeze(['component', 'grid'])
export const IDEA_KIND_LABELS = Object.freeze({ component: 'Smart component', grid: 'Printable page' })

export const IDEA_LIMITS = Object.freeze({
  // what one suggestion gives: at least three ideas, at most six
  min: 3,
  max: 6,
  // an idea's words: a title the size of a library title, a why the size of its one-line summary,
  // and a brief well under the drafting brief's 1,200 characters (workshops.draft)
  title: 80,
  why: 160,
  briefMin: 20,
  brief: 800,
  // connected tools one idea may name
  tools: 3,
  // titles of ideas a person turned down ("Not for me"), kept so they do not come back
  dismissed: 100,
  // fresh suggestions a person may ask for in an hour (each is one metered model call)
  refreshesPerHour: 10,
})

export class PersonalIdeaError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

// What a person reads, in plain words.
export const IDEA_WORDS = Object.freeze({
  off: 'Personalization is off, so there are no ideas made for you. Turn it on in About you to see them.',
  nothingKnown: 'Tell Slatebox a little about your work and it suggests boards made for you. Add something in About you, or talk with Slatebox about your work.',
  noIdeasYet: 'Slatebox can suggest boards made for your work, from what you keep in About you.',
  stale: 'About you changed since these ideas were made. Get new ideas to see ones that fit what it says now.',
  guest: 'Sign up to get ideas made for you. Slatebox only suggests them for people with an account.',
  busy: 'Slatebox is still working on your last request. Try again in a moment.',
  tooMany: `You asked for new ideas ${IDEA_LIMITS.refreshesPerHour} times this hour. Try again later.`,
  failed: 'Slatebox could not suggest ideas just now. Try again.',
  buildFailed: 'That could not be built just now. Try again.',
  // a draft the quality gate turned down: the gate's own words are written for the agent, so they stay in details
  weakDraft: 'That draft did not come out well. Try again.',
  buildOff: 'Building boards made for you is off on this server. An administrator can turn it on.',
  notFound: 'That idea is no longer here. Get new ideas to see what fits now.',
  noModel: 'No agent model is set up on this server yet, so Slatebox cannot suggest ideas right now. An administrator chooses one in Admin › AI.',
  turnedOff: 'Ideas made for you are off on this server.',
})

/**
 * Why a person's own settings mean no ideas at all, or null. With personalization off nothing in
 * About you is used, so nothing is suggested and nothing is built from it.
 */
export function ideasRefusal(settings) {
  if (!personalizationOn(settings)) return { code: 'personalization-off', message: IDEA_WORDS.off }
  return null
}

/**
 * What the For you section shows when there is nothing to suggest from, without asking a model:
 * personalization off, or nothing known about the person (no visible facts and no connected tool).
 * → null | { code: 'personalization-off' | 'nothing-known', message }
 */
export function emptyState({ settings, facts = '', tools = '' } = {}) {
  const refusal = ideasRefusal(settings)
  if (refusal) return refusal
  if (!String(facts || '').trim() && !String(tools || '').trim()) return { code: 'nothing-known', message: IDEA_WORDS.nothingKnown }
  return null
}

/**
 * The tools a person connected, as the suggestion names them: their names only (tidied, bounded,
 * each once). The kind and gallery card stay with the code. → [name]
 * (A deliberate departure from "names and kinds": a tool's kind is only mcp or native, which says
 * nothing about the person's work, so the model is given names alone.)
 */
export function toolNames(tools, max = 20) {
  const names = []
  const seen = new Set()
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (names.length >= max) break
    const name = tidyText(typeof tool === 'string' ? tool : tool?.name, 60)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    names.push(name)
  }
  return names
}

/** The values personal.suggest.system renders with: what is known and what is connected (as data). */
export function suggestValues({ facts = '', tools = [] } = {}) {
  const known = typeof facts === 'string' ? facts.trim() : ''
  const lines = toolNames(tools).map((name) => `- ${name}`).join('\n')
  return {
    hasFacts: Boolean(known),
    hasTools: Boolean(lines),
    ...(known && { facts: known }),
    ...(lines && { tools: lines }),
  }
}

// Titles anyone would get: a board's shape with nothing of the person's in it. An idea called only
// this is generic, whatever its why says.
const GENERIC_TITLES = new Set([
  'kanban', 'kanban board', 'task board', 'task tracker', 'task list', 'to do list', 'todo list', 'to dos', 'todos', 'project board', 'project tracker',
  'project plan', 'planner', 'weekly planner', 'daily planner', 'habit tracker', 'goal tracker', 'brainstorm', 'brainstorm board', 'idea board', 'ideas board',
  'retro', 'retro board', 'retrospective', 'pros and cons', 'decision matrix', 'priority matrix', 'eisenhower matrix', 'mind map', 'checklist', 'notes',
  'sticky notes', 'board', 'component', 'smart component', 'page', 'printable page', 'worksheet', 'flashcards', 'calendar', 'schedule', 'workflow', 'pipeline', 'roadmap',
].map((title) => factKey(title)))
const filler = /^(?:(?:my|our|your|a|an|the|simple|basic|team|personal|custom|smart)\s+)+/
export const genericTitle = (title) => {
  const key = factKey(title).replace(filler, '').trim()
  return !key || GENERIC_TITLES.has(key)
}

/**
 * What is known about the person as the ideas and their drafts use it: their visible About you
 * lines, without any that hold something sensitive (a fact added by hand in About you is not
 * checked when it is kept, so a line like "My salary is 52,000 a year" is left out here, before any
 * prompt sees it).
 */
export function factsForIdeas(facts) {
  if (typeof facts !== 'string') return ''
  return facts.split('\n').filter((line) => line.trim() && !sensitive(line)).join('\n').trim()
}

/** What the For you section's live region says when ideas arrive: "1 idea made for you." */
export const ideasMadeLine = (count) => (count === 1 ? '1 idea made for you.' : `${count} ideas made for you.`)

/** The key an idea is known by among a person's ideas (and their turned-down ones): its kind and title. */
export const ideaKey = (idea) => `${idea?.kind}\u0000${factKey(idea?.title)}`

const readJSON = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

/**
 * The ideas a suggest_ideas call proposes, checked and bounded:
 *   kinds from IDEA_KINDS; a title, why and brief within the bounds (tidied);
 *   nothing sensitive in any of their words;
 *   tied to the person: the why uses something they said (`facts`, their About you lines) or a
 *     tool they connected (`tools`, its name), and the title and brief use their words too;
 *   not generic (a board's shape alone as its title);
 *   tools only from those connected (an idea naming one they did not connect is dropped whole);
 *   no repeats, none they turned down (`dismissed`: ideaKey values), at most IDEA_LIMITS.max.
 * → { ideas: [{ title, kind, why, brief, tools }], dropped: { shape, sensitive, ungrounded, generic,
 *     tools, repeated, dismissed, over } }
 */
export function ideasFrom(raw, { facts = '', tools = [], dismissed = [] } = {}) {
  const dropped = { shape: 0, sensitive: 0, ungrounded: 0, generic: 0, tools: 0, repeated: 0, dismissed: 0, over: 0 }
  const connected = new Map(toolNames(tools).map((name) => [name.toLowerCase(), name]))
  // their words: the facts without the kind each line starts with ("- routine: ..."), and the tools' names
  const theirs = [String(facts || '').replace(/^\s*-\s*[a-z]+:\s*/gm, ''), ...connected.values()].join('\n')
  const turnedDown = new Set(Array.isArray(dismissed) ? dismissed : [])
  const seen = new Set()
  const ideas = []
  const list = readJSON(raw)
  for (const item of Array.isArray(list) ? list.map(readJSON) : []) {
    const title = tidyText(item?.title, IDEA_LIMITS.title)
    const why = tidyText(item?.why, IDEA_LIMITS.why)
    const brief = tidyText(item?.brief, IDEA_LIMITS.brief)
    const named = readJSON(item?.tools)
    if (!item || typeof item !== 'object' || !IDEA_KINDS.includes(item.kind) || !title || !why || brief.length < IDEA_LIMITS.briefMin ||
      (named !== undefined && named !== null && !Array.isArray(named))) { dropped.shape += 1; continue }
    if ([title, why, brief].some((text) => sensitive(text))) { dropped.sensitive += 1; continue }
    const wanted = (Array.isArray(named) ? named : []).map((name) => tidyText(typeof name === 'string' ? name : '', 60)).filter(Boolean)
    if (wanted.length > IDEA_LIMITS.tools || wanted.some((name) => !connected.has(name.toLowerCase()))) { dropped.tools += 1; continue }
    if (!grounded({ text: why }, theirs) || !grounded({ text: `${title} ${brief}` }, theirs)) { dropped.ungrounded += 1; continue }
    if (genericTitle(title)) { dropped.generic += 1; continue }
    const key = ideaKey({ kind: item.kind, title })
    if (turnedDown.has(key)) { dropped.dismissed += 1; continue }
    if (seen.has(key) || seen.has(`brief\u0000${factKey(brief)}`)) { dropped.repeated += 1; continue }
    if (ideas.length >= IDEA_LIMITS.max) { dropped.over += 1; continue }
    seen.add(key)
    seen.add(`brief\u0000${factKey(brief)}`)
    ideas.push({ title, kind: item.kind, why, brief, tools: [...new Set(wanted.map((name) => connected.get(name.toLowerCase())))] })
  }
  return { ideas, dropped }
}

/**
 * A suggest_ideas call's ideas, before ideasFrom checks them. Throws PersonalIdeaError
 * ('invalid-ideas') for a call to another tool or arguments with no list of ideas.
 */
export function readIdeasCall(toolCall, { toolName = 'suggest_ideas' } = {}) {
  if (!toolCall || toolCall.name !== toolName) throw new PersonalIdeaError('invalid-ideas', `The answer was not a ${toolName} call.`)
  const args = readJSON(toolCall.arguments)
  const ideas = readJSON(args?.ideas)
  if (!Array.isArray(ideas)) throw new PersonalIdeaError('invalid-ideas', 'The ideas were not a list.')
  return ideas
}

/** What the retry tells the model about the ideas it gave, in a sentence (from ideasFrom's dropped counts). */
export function ideasProblem({ ideas, dropped }) {
  const parts = []
  if (dropped.ungrounded) parts.push(`${dropped.ungrounded} did not use what the person said or connected`)
  if (dropped.generic) parts.push(`${dropped.generic} had a title anyone would get`)
  if (dropped.tools) parts.push(`${dropped.tools} named a tool they did not connect`)
  if (dropped.repeated) parts.push(`${dropped.repeated} repeated another`)
  if (dropped.dismissed) parts.push(`${dropped.dismissed} had been turned down already`)
  if (dropped.sensitive) parts.push(`${dropped.sensitive} held something private`)
  if (dropped.shape) parts.push(`${dropped.shape} was missing a kind, title, why or brief`)
  const usable = `${ideas.length} of the ideas could be used`
  return parts.length ? `${usable}; ${parts.join(', ')}.` : `${usable}.`
}

/** A one-line summary of what an idea builds, for its library draft: its brief's first sentence, bounded. */
export function ideaSummary(idea) {
  const brief = tidyText(idea?.brief, IDEA_LIMITS.brief)
  const first = (brief.match(/^.*?[.!?](?=\s|$)/)?.[0] || brief).trim()
  return first.length <= IDEA_LIMITS.why ? first : `${first.slice(0, IDEA_LIMITS.why - 1).replace(/\s+\S*$/, '')}…`
}

/** What the Build it button and its progress say for an idea. */
export function buildingWords(idea) {
  const what = IDEA_KIND_LABELS[idea?.kind]?.toLowerCase() || 'board'
  return {
    button: `Build it: ${idea?.title || ''}`.trim(),
    // the name while it builds, matching the button's visible "Building…"
    building: `Building… ${idea?.title || ''}`.trim(),
    progress: `Building your ${what}. The agent drafts it from your words, then it opens on a new private slate…`,
  }
}
