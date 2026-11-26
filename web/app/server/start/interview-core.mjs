// The use-case interview's server turns, without Meteor (server/start/meteor.js wires the real
// dependencies; the tests use stand-ins):
//   turn(principal, { message, history, planNow }) the agent's next question, or its plan, kept as
//                                                   the person's own tile (tiles-core.mjs saveFromTalk)
// The start page asks the opening question itself (START_OPENING), so the first model call answers
// the person's first message. One turn is one call and the transcript is text: the page holds it and
// sends the earlier turns (start-interview.mjs startHistoryFor), so a voice mode can later drive the
// same turns from the same composer.
//
// Before any model is asked, in this order: an account (a guest's is enough: /new is the guest-facing
// page), room for one more tile, the administrator's switch for the surface, a model to answer it,
// the meter (a guest's turns come from the guest allowance, metering/allowance.mjs), and one turn at
// a time per person. Every model call goes through `request` (req, feature 'start.interview') inside
// `run` (runAIAction, metered under 'start.interview'), with registry prompts only. The person's
// answers go in wrapped as data, and so do the agent's earlier questions (the page sends the talk back,
// so they are the page's words, not Slatebox's); what they keep in About you and the names of the tools
// they connected only when they are signed in with personalization on (never for a guest), as data.
// A talk whose plan is already kept may go on to change it (input.tileId, before it is built): the next
// plan replaces that tile's, so changing a plan never adds a tile.
import { factsForIdeas } from '../../imports/api/common/personal-ideas.mjs'
import { toolLines } from '../../imports/api/common/interview.mjs'
import { personalizationOn } from '../../imports/api/common/personal-facts.mjs'
import {
  ASK_TOOL_NAME, BOARD_KINDS, PLAN_TOOL_NAME, START_LIMITS, START_OPENING, START_WORDS, StartError, TILE_ICON_IDS, checkStartHistory, iconLines, mustPlan, readStartTurn,
} from '../../imports/api/common/start-interview.mjs'
import { TILE_WORDS, validTileId } from '../../imports/api/common/personal-tiles.mjs'
import { promptText } from '../ai-control/prompts/index.mjs'
import { wrapData } from '../ai-control/render.mjs'

// The ask tool's arguments. Its description is a registry prompt (tool.ask), built per call.
export const ASK_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: { question: { type: 'string', minLength: 1, maxLength: START_LIMITS.question } },
})

// The propose_plan tool's arguments. Its description is a registry prompt (tool.propose_plan), built per call.
export const PLAN_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['title', 'blurb', 'icon', 'summary', 'boards'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: START_LIMITS.title },
    blurb: { type: 'string', minLength: 1, maxLength: START_LIMITS.blurb },
    icon: { type: 'string', enum: [...TILE_ICON_IDS] },
    summary: { type: 'string', minLength: 1, maxLength: START_LIMITS.summary },
    boards: {
      type: 'array',
      minItems: 1,
      maxItems: START_LIMITS.boards,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'name', 'brief', 'why'],
        properties: {
          kind: { type: 'string', enum: [...BOARD_KINDS] },
          name: { type: 'string', minLength: START_LIMITS.boardNameMin, maxLength: START_LIMITS.boardName },
          brief: { type: 'string', minLength: START_LIMITS.briefMin, maxLength: START_LIMITS.brief },
          why: { type: 'string', minLength: 1, maxLength: START_LIMITS.why },
        },
      },
    },
  },
})

/** The two tools as a request sends them: their descriptions the published tool.ask and tool.propose_plan, read now. */
export const startTools = (text = promptText) => ({
  ask: { name: ASK_TOOL_NAME, description: text('tool.ask'), parameters: ASK_PARAMETERS },
  plan: { name: PLAN_TOOL_NAME, description: text('tool.propose_plan', { icons: TILE_ICON_IDS.join(', '), maxBoards: START_LIMITS.boards, kinds: BOARD_KINDS.join(', ') }), parameters: PLAN_PARAMETERS },
})

/** The values start.interview.system renders with: the bounds, the icons, and what is known (as data). */
export function startValues({ facts = '', tools = '' } = {}) {
  const known = typeof facts === 'string' ? facts.trim() : ''
  const connected = typeof tools === 'string' ? tools.trim() : ''
  return {
    maxBoards: START_LIMITS.boards, planBy: START_LIMITS.planBy, icons: iconLines(),
    hasFacts: Boolean(known), hasTools: Boolean(connected), ...(known && { facts: known }), ...(connected && { tools: connected }),
  }
}

const textOf = (message) => (typeof message?.content === 'string' ? message.content : message?.content?.find?.((part) => part?.type === 'text')?.text) || ''
/** The person's words as the request carries them: data, never instructions. */
export const answerData = (words) => wrapData('answer', words)
/** An earlier question as the request carries it: the page sent it back, so it is data too, never instructions. */
export const questionData = (words) => wrapData('question', words)

/**
 * The request one turn sends: the system text (with what is known, as data), the talk so far with
 * the person's answers and the agent's earlier questions (as the page sent them back) wrapped as data, and the new
 * answer; when the plan is due (planNow, or START_LIMITS.planBy answers), start.interview.plan
 * after it and propose_plan forced. `text` is the registry's promptText (a test run passes its own).
 */
export function startRequest({ facts = '', tools = '', history = [], message, planNow = false, text = promptText } = {}) {
  const planOnly = mustPlan(history, planNow)
  const { ask, plan } = startTools(text)
  const last = answerData(message) + (planOnly ? '\n\n' + text('start.interview.plan', { maxBoards: START_LIMITS.boards }) : '')
  return {
    feature: 'start.interview',
    sdkChat: true,
    system: text('start.interview.system', startValues({ facts, tools })),
    prompts: [
      ...history.map(({ role, content }) => ({ role, content: role === 'user' ? answerData(content) : questionData(content) })),
      { role: 'user', content: last },
    ],
    functions: planOnly ? [plan] : [ask, plan],
    ...(planOnly ? { function_call: { name: plan.name } } : { allowPlainText: true }),
    maxResponseValidationRetries: 1,
    // a usable turn: one short question (ask, or plain words), or a usable plan
    validateResponse: ({ message: answer, toolCall }) => {
      try {
        readStartTurn({ toolCall, text: textOf(answer) }, { planOnly })
        return null
      } catch (error) {
        const problem = typeof error?.message === 'string' ? error.message.slice(0, 400) : ''
        return { code: 'invalid-start-turn', retryPrompt: text('start.interview.retry', { planOnly, ...(problem && { problem }) }) }
      }
    },
  }
}

const DEFAULT_OFF = 'This feature is turned off by your administrator.'
export const offWords = (message) => (message && message !== DEFAULT_OFF && message !== START_WORDS.off ? `${START_WORDS.off} ${message}` : START_WORDS.off)

/**
 * deps: {
 *   loadUser(userId) → { _id, isAnonymous? } | null
 *   profile: About you's store (getSettings, forPrompt)
 *   connectedTools(userId) → [{ name, cardId, kind }]
 *   surfaceOff(userId) → null | { message }        the administrator's switch for start.interview
 *   modelMissing(userId) → boolean
 *   allowed(user) → throws the meter's refusal (a guest: the guest allowance), or resolves
 *   lock(userId) → release() | null                one turn at a time per person
 *   run(userId, fn)                                runAIAction({ feature: 'start.interview', userId }, fn)
 *   request(opts) → req()'s answer
 *   tiles: { full(userId) → boolean, revisable(principal, tileId) → throws unless the tile is theirs and not built yet,
 *            saveFromTalk(principal, { plan, summary, turns, tileId? }) → publicTile (tileId: that tile, revised) }
 *   text?
 * }
 */
export function createStartInterview(deps) {
  const text = deps.text || promptText

  async function known(user) {
    if (user.isAnonymous) return { facts: '', tools: '' }
    const settings = await deps.profile.getSettings(user._id)
    if (!personalizationOn(settings)) return { facts: '', tools: '' }
    const [facts, tools] = await Promise.all([deps.profile.forPrompt(user._id), deps.connectedTools(user._id)])
    return { facts: factsForIdeas(facts || ''), tools: toolLines(tools) }
  }

  return {
    opening: START_OPENING,

    /** The person's answer, and the agent's next question or its plan. → { reply } | { plan, tile } */
    async turn(principal, input = {}) {
      const message = input?.message
      if (typeof message !== 'string' || !message.trim() || message.length > START_LIMITS.message) throw new StartError('invalid-turn', START_WORDS.message)
      const history = checkStartHistory(input.history ?? [])
      if (history.filter((turn) => turn.role === 'user').length >= START_LIMITS.answers) throw new StartError('invalid-history', START_WORDS.done)
      const user = principal?.userId ? await deps.loadUser(principal.userId) : null
      if (!user) throw new StartError('sign-in', 'Open Slatebox again to talk it through.', 403)
      const planNow = input.planNow === true
      const tileId = input.tileId ?? null
      if (tileId !== null && !validTileId(tileId)) throw new StartError('invalid-turn', TILE_WORDS.notFound, 404)
      // Changing a kept plan revises that tile (theirs, not built yet); otherwise there must be room for the plan
      // this talk ends with (any turn may end it). Both are said before any model is asked.
      if (tileId) await deps.tiles.revisable(principal, tileId)
      else if (await deps.tiles.full(user._id)) throw new StartError('tiles-full', TILE_WORDS.full, 409)
      const off = await deps.surfaceOff(user._id)
      if (off) throw new StartError('turned-off', offWords(off.message), 403)
      if (await deps.modelMissing(user._id)) throw new StartError('no-model', START_WORDS.noModel, 409)
      await deps.allowed(user)
      const release = await deps.lock(user._id)
      if (!release) throw new StartError('busy', START_WORDS.busy, 409)
      try {
        const words = message.trim()
        const turn = await deps.run(user._id, async () => {
          const { facts, tools } = await known(user)
          const opts = startRequest({ facts, tools, history, message: words, planNow, text })
          const answer = await deps.request({ ...opts, userId: user._id })
          if (answer?.abort) {
            if (answer.disabled) throw new StartError('turned-off', offWords(answer.abortMessage), 403)
            if (answer.unusable && !answer.chosenLabel) throw new StartError('no-model', START_WORDS.noModel, 409)
            if ((answer.capability || answer.unusable) && answer.abortMessage) throw new StartError('reply-unavailable', answer.abortMessage, 409)
            throw new StartError('reply-unavailable', START_WORDS.failed, 409)
          }
          try {
            return readStartTurn({ toolCall: answer?.toolCall || null, text: textOf(answer?.message) }, { planOnly: mustPlan(history, planNow) })
          } catch {
            throw new StartError('reply-unavailable', START_WORDS.failed, 409)
          }
        })
        if (turn.kind === 'ask') return { reply: turn.question }
        const turns = [...history, { role: 'user', content: words }]
        const tile = await deps.tiles.saveFromTalk(principal, { plan: turn.plan, summary: turn.summary, turns, ...(tileId && { tileId }) })
        return { plan: turn.plan, tile }
      } finally {
        await release()
      }
    },
  }
}
