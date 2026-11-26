// For you, without Meteor (server/personal/meteor.js wires the real dependencies; the tests use
// stand-ins). Each person's ideas are one row of personalIdeas ({ _id: userId, userId, ideas,
// factsKey, createdAt, dismissed, refreshes }):
//   list(principal)              the ideas kept for them, whether About you changed since (stale),
//                                and the empty state when there is nothing to suggest from
//   refresh(principal)           new ideas: one model call (personal.suggest), metered
//   dismiss(principal, ideaId)   "Not for me": gone, and never suggested again
//   build(principal, ideaId)     the idea drafted through workshops.draft's path (draftForYou), held
//                                to the quality gate, saved as their private library draft and opened
//                                on a new private slate (add_component with op.library)
//
// Before any model is asked, in this order: personalization on (off: the empty state, no call),
// something known (no visible facts and no connected tool: the empty state, no call), the
// administrator's switch for the surface, a model to answer it, the person's hourly refreshes, the
// meter, and one request at a time per person. Every model call goes through `request` (req,
// feature 'personal.suggest') inside `run` (runAIAction, metered under 'personal.suggest'), with
// registry prompts only; the profile facts, the connected tools' names and the ideas the person
// turned down reach it as data.
import { createHash } from 'node:crypto'
import { tidyText } from '../../imports/api/common/personal-facts.mjs'
import {
  IDEA_KINDS, IDEA_LIMITS, IDEA_WORDS, PersonalIdeaError, emptyState, factsForIdeas, ideaKey, ideaSummary, ideasFrom, ideasProblem, ideasRefusal, readIdeasCall, suggestValues, toolNames,
} from '../../imports/api/common/personal-ideas.mjs'
import { componentQuality, repairComponent } from '../../imports/api/common/builder-freeform.mjs'
import { gridQuality } from '../../imports/api/common/builder-grid.mjs'
import { promptText } from '../ai-control/prompts/index.mjs'

export const SUGGEST_TOOL_NAME = 'suggest_ideas'

const ideaItem = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'kind', 'why', 'brief'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: IDEA_LIMITS.title },
    kind: { type: 'string', enum: [...IDEA_KINDS] },
    why: { type: 'string', minLength: 1, maxLength: IDEA_LIMITS.why },
    brief: { type: 'string', minLength: IDEA_LIMITS.briefMin, maxLength: IDEA_LIMITS.brief },
    tools: { type: 'array', maxItems: IDEA_LIMITS.tools, items: { type: 'string', minLength: 1, maxLength: 60 } },
  },
}

// The suggest_ideas tool's arguments. Its description is a registry prompt (tool.suggest_ideas), built per call.
export const SUGGEST_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['ideas'],
  properties: { ideas: { type: 'array', minItems: IDEA_LIMITS.min, maxItems: IDEA_LIMITS.max, items: ideaItem } },
})

const bounds = { min: IDEA_LIMITS.min, max: IDEA_LIMITS.max }

/** The suggest_ideas tool as a request sends it: its description the published tool.suggest_ideas, read now. */
export const suggestTool = (text = promptText) => ({
  name: SUGGEST_TOOL_NAME,
  description: text('tool.suggest_ideas', { ...bounds, kinds: IDEA_KINDS.join(', ') }),
  parameters: SUGGEST_PARAMETERS,
})

/** The ideas a person turned down, as the ask names them (data): their titles, one a line. */
export const dismissedLines = (titles = []) => (Array.isArray(titles) ? titles : []).slice(-20).map((title) => `- ${tidyText(title, IDEA_LIMITS.title)}`).filter((line) => line.length > 2).join('\n')

/**
 * The request one suggestion sends: the system text with what is known and what is connected (as
 * data), the ask (with the ideas they turned down, as data), one forced suggest_ideas call and its
 * check. `onIdeas(ideas)` hears the usable ideas of every answer, so the best of them is kept when
 * the retry still falls short. `text` is the registry's promptText (a test run passes its own).
 */
export function suggestRequest({ facts = '', tools = [], dismissed = [], dismissedTitles = [], text = promptText, onIdeas = () => {} } = {}) {
  const values = suggestValues({ facts, tools })
  const tool = suggestTool(text)
  const turnedDown = dismissedLines(dismissedTitles)
  return {
    feature: 'personal.suggest',
    system: text('personal.suggest.system', { ...bounds, ...values }),
    prompts: [{ role: 'user', content: text('personal.suggest.ask', { hasDismissed: Boolean(turnedDown), ...(turnedDown && { dismissed: turnedDown }) }) }],
    functions: [tool],
    function_call: { name: tool.name },
    maxResponseValidationRetries: 1,
    validateResponse: ({ toolCall }) => {
      let problem
      try {
        const read = ideasFrom(readIdeasCall(toolCall, { toolName: tool.name }), { facts, tools, dismissed })
        onIdeas(read.ideas)
        if (read.ideas.length >= IDEA_LIMITS.min) return null
        problem = ideasProblem(read)
      } catch (error) {
        problem = String(error?.message || 'The call could not be read.')
      }
      return { code: 'weak-ideas', retryPrompt: text('personal.suggest.retry', { ...bounds, problem }) }
    },
  }
}

const sha = (value) => createHash('sha256').update(value).digest('hex')
/** The key of what a suggestion used: the person's visible facts and their connected tools' names. */
export const factsKeyOf = (facts, tools) => sha(JSON.stringify([String(facts || '').trim(), toolNames(tools)])).slice(0, 32)
/** An idea's id among a person's ideas: from its kind and title, so the same idea keeps its id. */
export const ideaIdOf = (userId, idea) => 'i' + sha(`${userId}\u0000${ideaKey(idea)}`).slice(0, 15)
const hourOf = (ms) => Math.floor(ms / 3_600_000)

/** An idea as people and agents read it. */
export const publicIdea = (idea) => ({
  id: idea.id, title: idea.title, kind: idea.kind, why: idea.why, brief: idea.brief, tools: [...(idea.tools || [])],
  ...(idea.built && { built: { shareId: idea.built.shareId, itemId: idea.built.itemId } }),
})

/**
 * The quality gate a drafted board meets before it is kept (the drafting's own retry already asked
 * for it): a smart component passes componentQuality, a page gridQuality, against the idea's brief.
 * → [problem]
 */
export function buildProblems(workshop, kind, brief) {
  if (kind === 'grid') return workshop?.kind === 'grid' ? gridQuality(workshop, { message: brief }) : ['It is not a printable page.']
  if (workshop?.kind || workshop?.experience) return ['It is not a board of plain lanes.']
  return componentQuality(repairComponent(workshop, { message: brief }).workshop, { message: brief })
}

const fail = (status, code, message, details) => Object.assign(new PersonalIdeaError(code, message, status), details !== undefined ? { details } : {})

// The words an administrator wrote when turning the surface off, beside ours.
export const offWords = (message) => (message && message !== IDEA_WORDS.turnedOff && message !== 'This feature is turned off by your administrator.' ? `${IDEA_WORDS.turnedOff} ${message}` : IDEA_WORDS.turnedOff)

/**
 * deps: {
 *   ideas                         the personalIdeas collection (MongoDB driver)
 *   loadUser(userId)              → { _id, isAnonymous? } | null
 *   profile                       About you's store: getSettings(userId), forPrompt(userId)
 *   connectedTools(userId)        → [{ name, cardId, kind }] (the profile integrations seam)
 *   surfaceOff(userId)            → null | { message }   the administrator's switch for personal.suggest
 *   modelMissing(userId)          → boolean              no model answers it here
 *   allowed(user)                 → throws the meter's refusal (with status), or resolves
 *   lock(userId)                  → release() | null     one request at a time per person
 *   run(userId, fn)               runAIAction({ feature: 'personal.suggest', userId }, fn)
 *   request(opts)                 → req()'s answer
 *   draft({ userId, brief, format, personal }) → the drafted board (workshops.js draftForYou)
 *   library                       saveMade(principal, { workshop, title, summary, madeFor }) → { itemId }
 *   open({ principal, itemId, key }) → { shareId }      open-slate.mjs openOnNewSlate
 *   now?(), text?
 * }
 */
export function createPersonalIdeas(deps) {
  const text = deps.text || promptText
  const now = deps.now || Date.now
  const { ideas: rows } = deps

  async function person(principal) {
    const user = principal?.userId ? await deps.loadUser(principal.userId) : null
    if (!user || user.isAnonymous) throw fail(403, 'registration_required', IDEA_WORDS.guest)
    return user
  }

  // What the ideas would be made from now: the visible facts (none that hold something sensitive) and the connected tools.
  async function known(userId) {
    const [settings, facts, tools] = await Promise.all([deps.profile.getSettings(userId), deps.profile.forPrompt(userId), deps.connectedTools(userId)])
    return { settings, facts: factsForIdeas(facts || ''), tools: Array.isArray(tools) ? tools : [] }
  }

  const answer = (row, { settings, facts, tools }) => {
    const empty = emptyState({ settings, facts, tools: toolNames(tools).join('\n') })
    if (empty) return { on: empty.code !== 'personalization-off', ideas: [], empty, stale: false, createdAt: null, canRefresh: false }
    const list = (row?.ideas || []).map(publicIdea)
    return {
      on: true,
      ideas: list,
      empty: null,
      stale: Boolean(row?.ideas?.length && row.factsKey !== factsKeyOf(facts, tools)),
      createdAt: row?.createdAt ? new Date(row.createdAt).toISOString() : null,
      canRefresh: true,
    }
  }

  async function list(principal) {
    await person(principal)
    const [row, state] = await Promise.all([rows.findOne({ _id: principal.userId }), known(principal.userId)])
    return answer(row, state)
  }

  async function refresh(principal) {
    const user = await person(principal)
    const userId = user._id
    const state = await known(userId)
    const row = await rows.findOne({ _id: userId })
    // Nothing to suggest from, or personalization off: the empty state, and no model is asked.
    if (emptyState({ settings: state.settings, facts: state.facts, tools: toolNames(state.tools).join('\n') })) return answer(row, state)
    const off = await deps.surfaceOff(userId)
    if (off) throw fail(403, 'turned_off', offWords(off.message))
    if (await deps.modelMissing(userId)) throw fail(409, 'no_model', IDEA_WORDS.noModel)
    const hour = hourOf(now())
    const used = row?.refreshes?.hour === hour ? row.refreshes.count || 0 : 0
    if (used >= IDEA_LIMITS.refreshesPerHour) throw Object.assign(fail(429, 'rate_limited', IDEA_WORDS.tooMany), { retryAfter: Math.max(1, Math.ceil(((hour + 1) * 3_600_000 - now()) / 1000)) })
    await deps.allowed(user)
    const release = await deps.lock(userId)
    if (!release) throw fail(409, 'busy', IDEA_WORDS.busy)
    try {
      await rows.updateOne({ _id: userId }, { $set: { userId, refreshes: { hour, count: used + 1 } } }, { upsert: true })
      const dismissed = row?.dismissed || []
      let best = []
      const ideas = await deps.run(userId, async () => {
        const opts = suggestRequest({
          facts: state.facts, tools: state.tools, dismissed: dismissed.map((d) => d.key), dismissedTitles: dismissed.map((d) => d.title), text,
          onIdeas: (found) => { if (found.length > best.length) best = found },
        })
        const got = await deps.request({ ...opts, userId })
        if (got?.abort) {
          if (got.disabled) throw fail(403, 'turned_off', offWords(got.abortMessage))
          if (got.unusable && !got.chosenLabel) throw fail(409, 'no_model', IDEA_WORDS.noModel)
          // The retry still fell short: keep the best usable ideas it gave, if any, even fewer than IDEA_LIMITS.min.
          // Deliberate: the request was paid for, and one or two ideas tied to the person beat an error. (The eval
          // still counts fewer than the minimum as a failure: the prompt asks for at least that many.)
          if (got.shape && best.length) return best
          if ((got.capability || got.unusable) && got.abortMessage) throw fail(409, 'suggest_unavailable', got.abortMessage)
          throw fail(409, 'suggest_unavailable', IDEA_WORDS.failed)
        }
        const read = ideasFrom(readIdeasCall(got?.toolCall, { toolName: SUGGEST_TOOL_NAME }), { facts: state.facts, tools: state.tools, dismissed: dismissed.map((d) => d.key) })
        if (!read.ideas.length) throw fail(409, 'suggest_unavailable', IDEA_WORDS.failed)
        return read.ideas
      })
      // The same idea suggested again keeps what building it already made (its slate, its library draft), so it is
      // neither drafted nor charged twice.
      const latest = await rows.findOne({ _id: userId })
      const before = new Map((latest?.ideas || []).map((item) => [item.id, item]))
      const kept = (idea) => {
        const id = ideaIdOf(userId, idea)
        const prior = before.get(id)
        return { ...idea, id, ...(prior?.built && { built: prior.built }), ...(prior?.saved && { saved: prior.saved }) }
      }
      const made = { ideas: ideas.map(kept), factsKey: factsKeyOf(state.facts, state.tools), createdAt: new Date(now()) }
      await rows.updateOne({ _id: userId }, { $set: { userId, ...made } }, { upsert: true })
      return answer({ ...row, ...made }, state)
    } finally {
      await release()
    }
  }

  async function dismiss(principal, { ideaId }) {
    await person(principal)
    const row = await rows.findOne({ _id: principal.userId })
    const idea = row?.ideas?.find((item) => item.id === ideaId)
    if (!idea) throw fail(404, 'not_found', IDEA_WORDS.notFound)
    const dismissed = [...(row.dismissed || []).filter((d) => d.key !== ideaKey(idea)), { key: ideaKey(idea), title: idea.title }].slice(-IDEA_LIMITS.dismissed)
    await rows.updateOne({ _id: principal.userId }, { $set: { ideas: row.ideas.filter((item) => item.id !== ideaId), dismissed } })
    return { ideaId, dismissed: true }
  }

  async function build(principal, { ideaId }) {
    const user = await person(principal)
    const userId = user._id
    const state = await known(userId)
    const refusal = ideasRefusal(state.settings)
    if (refusal) throw fail(403, 'personalization_off', refusal.message)
    const row = await rows.findOne({ _id: userId })
    const idea = row?.ideas?.find((item) => item.id === ideaId)
    if (!idea) throw fail(404, 'not_found', IDEA_WORDS.notFound)
    // Built already: the slate it opened on, not a second draft (and a second charge).
    if (idea.built) return { ideaId, kind: idea.kind, title: idea.title, itemId: idea.built.itemId, shareId: idea.built.shareId, built: false }
    // An idea from what About you said before: a fact since hidden or removed would still reach the draft through it.
    const markIdea = async (patch) => {
      const latest = await rows.findOne({ _id: userId })
      await rows.updateOne({ _id: userId }, { $set: { ideas: (latest?.ideas || []).map((item) => (item.id === ideaId ? { ...item, ...patch } : item)) } })
    }
    const release = await deps.lock(userId)
    if (!release) throw fail(409, 'busy', IDEA_WORDS.busy)
    try {
      // Drafted and saved already, but the slate did not open: open that draft, with no second draft (and no second charge).
      let itemId = idea.saved?.itemId
      if (!itemId) {
        // An idea from what About you said before: a fact since hidden or removed would still reach the draft through it.
        if (row.factsKey !== factsKeyOf(state.facts, state.tools)) throw fail(409, 'ideas_stale', IDEA_WORDS.stale)
        if (!IDEA_KINDS.includes(idea.kind)) throw fail(409, 'not_buildable', 'That kind of idea cannot be built yet.')
        const connected = new Set(toolNames(state.tools).map((name) => name.toLowerCase()))
        const tools = (idea.tools || []).filter((name) => connected.has(String(name).toLowerCase())).map((name) => `- ${name}`).join('\n')
        const workshop = await deps.draft({ userId, brief: idea.brief, format: idea.kind, personal: { facts: state.facts, why: idea.why, tools } })
        const problems = buildProblems(workshop, idea.kind, idea.brief)
        // the gate's words are written for the agent: the person reads plain ones, the detail stays in details
        if (problems.length) throw fail(422, 'weak_draft', IDEA_WORDS.weakDraft, { problems })
        const board = idea.kind === 'grid' ? workshop : repairComponent(workshop, { message: idea.brief }).workshop
        const saved = await deps.library.saveMade(principal, { workshop: { ...board, title: idea.title }, title: idea.title, summary: ideaSummary(idea), madeFor: idea.id })
        itemId = saved.itemId
        await markIdea({ saved: { itemId } })
      }
      const opened = await deps.open({ principal, itemId, key: `for-you-${idea.id}-${itemId}` })
      const built = { shareId: opened.shareId, itemId, at: new Date(now()) }
      await markIdea({ built })
      return { ideaId, kind: idea.kind, title: idea.title, itemId, shareId: opened.shareId, built: true }
    } finally {
      await release()
    }
  }

  return { list, refresh, dismiss, build }
}

/** The account is going: its ideas too (server/profile/store.mjs removeAll calls this through its `ideas`). */
export const removeIdeas = (rows, userId) => rows.deleteOne({ _id: userId })
