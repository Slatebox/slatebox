// The interview's server turns, without Meteor (server/methods/interview.js wires the real
// dependencies; the tests use stand-ins):
//   start(userId)                     the agent's first question, planned from what is known
//   turn(userId, { message, history }) the agent's next question, and the facts it proposes
//   keep(userId, facts)               the facts the person chose to keep, saved as from the interview
// One turn is one call and the transcript is text: the page holds it and sends the last few
// exchanges (imports/api/common/interview.mjs historyFor), so a voice mode can later drive the same
// turns. A proposed fact is never saved here; only keep saves, and only what the person sent back.
//
// Before any model is asked, in this order: a saved account (guests are asked to sign up), the
// person's own settings (personalization on, and the interview as a source), the administrator's
// switch for the surface, a model to answer it (none on a self-hosted install without keys: Admin ›
// AI), the meter, and one turn at a time per person. Every model call goes through `request` (req,
// feature 'interview': the interview surface in AI control) inside `run` (runAIAction, metered under
// 'interview'), with registry prompts only.
import { FACT_KINDS } from '../../imports/api/common/personal-facts.mjs'
import {
  INTERVIEW_LIMITS, INTERVIEW_SOURCE, InterviewError, checkHistory, factsToKeep, promptValues, proposedFacts, readAnswer, settingsRefusal, toolLines,
} from '../../imports/api/common/interview.mjs'
import { promptText } from '../ai-control/prompts/index.mjs'

export const REMEMBER_TOOL_NAME = 'remember'

// The remember tool's arguments. Its description is a registry prompt (tool.remember), built per call.
export const REMEMBER_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['facts', 'reply'],
  properties: {
    facts: {
      type: 'array',
      maxItems: INTERVIEW_LIMITS.proposed,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text'],
        properties: {
          kind: { type: 'string', enum: [...FACT_KINDS] },
          text: { type: 'string', minLength: 1, maxLength: 280 },
        },
      },
    },
    reply: { type: 'string', minLength: 1, maxLength: INTERVIEW_LIMITS.reply },
  },
})

/** The remember tool as a request sends it: its description the published tool.remember, read now. */
export const interviewTool = (text = promptText) => ({
  name: REMEMBER_TOOL_NAME,
  description: text('tool.remember', { kinds: FACT_KINDS.join(', ') }),
  parameters: REMEMBER_PARAMETERS,
})

const textOf = (message) => (typeof message?.content === 'string' ? message.content : message?.content?.find?.((part) => part?.type === 'text')?.text) || ''

/**
 * The request one turn sends: the system text with what is known and what is connected (as data),
 * the opening instruction as the first user turn (so the agent's questions and the person's answers
 * alternate after it), the earlier exchanges, and the person's new words (none for the first
 * question). `text` is the registry's promptText (a test run passes its own renderer).
 */
export function interviewRequest({ facts = '', tools = '', history = [], message = null, text = promptText } = {}) {
  const values = promptValues({ facts, tools })
  const tool = interviewTool(text)
  return {
    feature: 'interview',
    sdkChat: true,
    system: text('interview.system', values),
    prompts: [
      { role: 'user', content: text('interview.opening', { hasFacts: values.hasFacts, hasTools: values.hasTools }) },
      ...history.map(({ role, content }) => ({ role, content })),
      ...(message ? [{ role: 'user', content: message }] : []),
    ],
    functions: [tool],
    allowPlainText: true,
    maxResponseValidationRetries: 1,
    // a usable turn: a short question as plain text, or a remember call with a reply
    validateResponse: ({ message: answer, toolCall }) => {
      try {
        readAnswer({ toolCall, text: textOf(answer) }, { toolName: tool.name })
        return null
      } catch {
        return { code: 'invalid-interview-turn', retryPrompt: text('interview.retry') }
      }
    },
  }
}

// What a person is told, in plain words.
export const WORDS = Object.freeze({
  guest: 'Sign up to talk with Slatebox about your work. The agent only gets to know people with an account.',
  off: 'Talks with the agent are off on this server.',
  noModel: 'No agent model is set up on this server yet, so the agent cannot talk right now. An administrator chooses one in Admin › AI.',
  busy: 'The agent is still answering. Try again in a moment.',
  failed: 'The agent could not answer just now. Try again.',
  message: `Write up to ${INTERVIEW_LIMITS.message.toLocaleString('en-US')} characters.`,
})
const DEFAULT_OFF = 'This feature is turned off by your administrator.'

/**
 * Whether the route req() would take for the interview (ai-settings-core.mjs resolveFor) has no
 * model on the server: no route chosen for the surface, or its provider without an active key (a
 * self-hosted install with no keys yet). Then the person is told an administrator chooses one,
 * before the meter. A person's own connection that cannot be used, a capability gap, a part turned
 * off, or no route at all (a feature that is not a model choice) are not this: req() says those in
 * its own words.
 */
export const routeHasNoModel = (route) => Boolean(route && !route.disabled && route.scope === 'server' && !route.connection && route.error)

/** The administrator's switch, said as talks being off here, with their own words when they wrote some. */
export const offWords = (message) => (message && message !== DEFAULT_OFF && message !== WORDS.off ? `${WORDS.off} ${message}` : WORDS.off)

/**
 * deps: {
 *   loadUser(userId) → { _id, isAnonymous? } | null
 *   profile: the About you store (server/profile/store.mjs): getSettings, list, forPrompt, addFrom
 *   connectedTools(userId) → [{ name, cardId, kind }] (the profile integrations seam)
 *   surfaceOff(userId) → null | { message }        the administrator's switch for the surface
 *   modelMissing(userId) → boolean                 no model answers the surface here
 *   allowed(user) → throws the meter's refusal, or resolves
 *   lock(userId) → release() | null                one turn at a time per person
 *   run(userId, fn)                                runAIAction({ feature: 'interview', userId }, fn)
 *   request(opts) → req()'s answer
 *   text?                                          promptText
 * }
 */
export function createInterview(deps) {
  const text = deps.text || promptText

  async function gate(userId) {
    const user = userId ? await deps.loadUser(userId) : null
    if (!user || user.isAnonymous) throw new InterviewError('sign-up', WORDS.guest)
    const refusal = settingsRefusal(await deps.profile.getSettings(userId))
    if (refusal) throw new InterviewError(refusal.code, refusal.message)
    const off = await deps.surfaceOff(userId)
    if (off) throw new InterviewError('turned-off', offWords(off.message))
    if (await deps.modelMissing(userId)) throw new InterviewError('no-model', WORDS.noModel)
    await deps.allowed(user)
    return user
  }

  // One model turn: the request, its answer read, nothing proposed that the person did not say.
  async function ask(userId, { history = [], message = null }) {
    const release = await deps.lock(userId)
    if (!release) throw new InterviewError('busy', WORDS.busy)
    try {
      return await deps.run(userId, async () => {
        const [facts, tools, listed] = await Promise.all([
          deps.profile.forPrompt(userId),
          deps.connectedTools(userId),
          message ? deps.profile.list(userId) : null,
        ])
        const opts = interviewRequest({ facts, tools: toolLines(tools), history, message, text })
        const answer = await deps.request({ ...opts, userId })
        if (answer?.abort) {
          if (answer.disabled) throw new InterviewError('turned-off', offWords(answer.abortMessage))
          if (answer.unusable && !answer.chosenLabel) throw new InterviewError('no-model', WORDS.noModel)
          if ((answer.capability || answer.unusable) && answer.abortMessage) throw new InterviewError('reply-unavailable', answer.abortMessage)
          throw new InterviewError('reply-unavailable', WORDS.failed)
        }
        let read
        try {
          read = readAnswer({ toolCall: answer?.toolCall || null, text: textOf(answer?.message) }, { toolName: REMEMBER_TOOL_NAME })
        } catch {
          throw new InterviewError('reply-unavailable', WORDS.failed)
        }
        // The first question proposes nothing: the person has not said anything yet.
        if (!message) return { reply: read.reply, proposed: [] }
        const saidText = [...history.filter((turn) => turn.role === 'user').map((turn) => turn.content), message].join('\n')
        const { proposed } = proposedFacts(read.facts, { saidText, known: listed?.facts || [] })
        return { reply: read.reply, proposed }
      })
    } finally {
      await release()
    }
  }

  return {
    /** The agent's first question. → { reply, proposed: [] } */
    async start(userId) {
      await gate(userId)
      return ask(userId, {})
    },

    /** The person's answer, and the agent's next question with the facts it proposes. → { reply, proposed: [{ kind, text }] } */
    async turn(userId, input = {}) {
      const message = input?.message
      if (typeof message !== 'string' || !message.trim() || message.length > INTERVIEW_LIMITS.message) throw new InterviewError('invalid-turn', WORDS.message)
      const history = checkHistory(input.history ?? [])
      if (!history.length) throw new InterviewError('invalid-history', 'Close this talk and start a new one.')
      await gate(userId)
      return ask(userId, { history, message: message.trim() })
    },

    /**
     * The facts the person chose to keep, saved as from the interview (addFactsFrom): the same fact
     * again is skipped, nothing past the cap is kept, and anything sensitive is refused, never saved.
     * → { added, same, overCap, invalid, refused }
     */
    async keep(userId, facts) {
      const user = userId ? await deps.loadUser(userId) : null
      if (!user || user.isAnonymous) throw new InterviewError('sign-up', WORDS.guest)
      const { facts: ready, refused } = factsToKeep(facts)
      const refusal = settingsRefusal(await deps.profile.getSettings(userId))
      if (refusal) throw new InterviewError(refusal.code, refusal.message)
      if (!ready.length) return { added: 0, same: 0, overCap: 0, invalid: 0, refused }
      try {
        const result = await deps.profile.addFrom(userId, INTERVIEW_SOURCE, ready)
        return { ...result, refused }
      } catch (error) {
        if (error?.code === 'registration_required') throw new InterviewError('sign-up', WORDS.guest)
        if (error?.code === 'personalization_off' || error?.code === 'source_off') {
          const again = settingsRefusal(await deps.profile.getSettings(userId))
          throw new InterviewError(again?.code || 'interview-off', again?.message || error.message)
        }
        throw error
      }
    },
  }
}
