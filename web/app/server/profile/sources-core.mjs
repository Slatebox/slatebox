// Learning from a connected tool (About you › "Use <tool> to personalize", S3, 2026-11-26), without
// Meteor (server/methods/profile-sources.js wires the real dependencies; the tests use stand-ins):
//   list(userId)                 the tools that can be used to personalize, with each switch
//   read(userId, { ref })        a look around one of them, and the facts the agent proposes from it
//   keep(userId, { ref, facts }) the facts the person chose to keep, saved as from that tool
// The look itself is the integrations code's (enterprise/, through the profile integrations seam
// server/profile/integration-hooks.mjs): a few read-only lookups, each answer quarantined and capped.
// Here its sample is only read by one model call, wrapped as data. A proposed fact is never saved:
// only keep saves, and only what the person sent back.
//
// Before anything is read, in this order: a saved account, personalization on, the tool connected and
// its own switch on (off until the person turns it on), the administrator's switch for the surface, a
// model to answer it, the meter, and one look at a time per person. The look and the model call run
// inside `run` (runAIAction, metered under 'profile.sources'), with registry prompts only.
import {
  SOURCE_FACT_KINDS, SOURCES_LIMITS, SourcesError, integrationSource, proposedSourceFacts, sampleText, sourceFactsToKeep, sourceRefusal, toolRows,
} from '../../imports/api/common/profile-sources.mjs'
import { tidyText } from '../../imports/api/common/personal-facts.mjs'
import { promptText } from '../ai-control/prompts/index.mjs'

export const PROPOSE_TOOL_NAME = 'propose_facts'

// The propose_facts tool's arguments. Its description is a registry prompt (profile.sources.tool), built per call.
export const PROPOSE_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      maxItems: SOURCES_LIMITS.proposed,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text'],
        properties: {
          kind: { type: 'string', enum: [...SOURCE_FACT_KINDS] },
          text: { type: 'string', minLength: 1, maxLength: 280 },
        },
      },
    },
  },
})

/** The propose_facts tool as a request sends it: its description the published profile.sources.tool, read now. */
export const sourcesTool = (text = promptText) => ({
  name: PROPOSE_TOOL_NAME,
  description: text('profile.sources.tool', { kinds: SOURCE_FACT_KINDS.join(', ') }),
  parameters: PROPOSE_PARAMETERS,
})

const readJSON = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

/** The facts a propose_facts call carries (not yet checked: proposedSourceFacts does that). Throws for anything else. */
export function readProposal(toolCall) {
  if (!toolCall || toolCall.name !== PROPOSE_TOOL_NAME) throw new SourcesError('invalid-answer', 'The agent did not propose facts.')
  const args = readJSON(toolCall.arguments)
  const facts = readJSON(args?.facts)
  if (!args || typeof args !== 'object' || (facts !== undefined && !Array.isArray(facts))) throw new SourcesError('invalid-answer', 'The facts were not a list.')
  return (facts || []).map((fact) => readJSON(fact))
}

/**
 * The request one look sends: the system text with the tool's name and what is known (as data), the
 * sample as the user turn (as data), and the propose_facts tool. `text` is the registry's promptText
 * (a test run passes its own renderer).
 */
export function sourcesRequest({ toolName = '', sample = '', facts = '', text = promptText } = {}) {
  const known = typeof facts === 'string' ? facts.trim() : ''
  const tool = sourcesTool(text)
  return {
    feature: 'profile.sources',
    sdkChat: true,
    system: text('profile.sources.facts', { hasFacts: Boolean(known), tool: tidyText(toolName, SOURCES_LIMITS.name) || 'a connected tool', ...(known && { facts: known }) }),
    prompts: [{ role: 'user', content: text('profile.sources.sample', { sample }) }],
    functions: [tool],
    maxResponseValidationRetries: 1,
    // a usable answer: one propose_facts call with a list (an empty one is an answer)
    validateResponse: ({ toolCall }) => {
      try {
        readProposal(toolCall)
        return null
      } catch {
        return { code: 'invalid-profile-sources', retryPrompt: text('profile.sources.retry') }
      }
    },
  }
}

// What a person is told, in plain words.
export const WORDS = Object.freeze({
  guest: 'Sign up to use your tools to personalize Slatebox. About you is for saved accounts.',
  off: 'Learning from your tools is off on this server.',
  noModel: 'No agent model is set up on this server yet, so Slatebox cannot read your tools right now. An administrator chooses one in Admin › AI.',
  busy: 'Slatebox is still looking around one of your tools. Try again in a moment.',
  failed: 'Slatebox could not read that just now. Try again.',
  notConnected: 'That tool is not connected, or Slatebox has nothing to read from it. Connect it on the Integrations page.',
  nothing: (name) => `Slatebox found nothing in ${name} to learn from.`,
})
const DEFAULT_OFF = 'This feature is turned off by your administrator.'
const offWords = (message) => (message && message !== DEFAULT_OFF && message !== WORDS.off ? `${WORDS.off} ${message}` : WORDS.off)

/**
 * deps: {
 *   loadUser(userId) → { _id, isAnonymous? } | null
 *   profile: the About you store (server/profile/store.mjs): getSettings, list, forPrompt, addFrom
 *   sources(userId) → [{ ref, name, kind }]       the tools that can be read (the profile integrations seam)
 *   lookAround(userId, ref) → { name, sample: [{ tool, text }] }   the bounded, quarantined read (the seam)
 *   surfaceOff(userId) → null | { message }        the administrator's switch for the surface
 *   modelMissing(userId) → boolean                 no model answers the surface here
 *   allowed(user) → throws the meter's refusal, or resolves
 *   lock(userId) → release() | null                one look at a time per person
 *   run(userId, fn)                                runAIAction({ feature: 'profile.sources', userId }, fn)
 *   request(opts) → req()'s answer
 *   text?                                          promptText
 * }
 */
export function createProfileSources(deps) {
  const text = deps.text || promptText

  async function member(userId) {
    const user = userId ? await deps.loadUser(userId) : null
    if (!user || user.isAnonymous) throw new SourcesError('sign-up', WORDS.guest)
    return user
  }

  async function toolsOf(userId) {
    const list = await deps.sources(userId).catch((error) => {
      console.warn('[profile.sources] tools could not be read:', error?.message)
      return []
    })
    return toolRows(list, null)
  }

  async function toolFor(userId, ref) {
    if (typeof ref !== 'string' || !/^[a-z0-9]{1,40}$/.test(ref)) throw new SourcesError('not-connected', WORDS.notConnected)
    const tool = (await toolsOf(userId)).find((row) => row.ref === ref)
    if (!tool) throw new SourcesError('not-connected', WORDS.notConnected)
    return tool
  }

  return {
    /** The tools About you offers a switch for, with each switch. → { tools: [{ ref, name, on }] } */
    async list(userId) {
      await member(userId)
      const settings = await deps.profile.getSettings(userId)
      return { tools: toolRows(await deps.sources(userId).catch(() => []), settings) }
    },

    /** A look around one tool and the facts the agent proposes from it. → { name, proposed: [{ kind, text }], say? } */
    async read(userId, input = {}) {
      const user = await member(userId)
      const tool = await toolFor(userId, input?.ref)
      const refusal = sourceRefusal(await deps.profile.getSettings(userId), tool)
      if (refusal) throw new SourcesError(refusal.code, refusal.message)
      const off = await deps.surfaceOff(userId)
      if (off) throw new SourcesError('turned-off', offWords(off.message))
      if (await deps.modelMissing(userId)) throw new SourcesError('no-model', WORDS.noModel)
      await deps.allowed(user)
      const release = await deps.lock(userId)
      if (!release) throw new SourcesError('busy', WORDS.busy)
      try {
        return await deps.run(userId, async () => {
          let look
          try {
            look = await deps.lookAround(userId, tool.ref)
          } catch (error) {
            // The integrations code's own refusal (needs sign-in, tools changed) in its own words.
            if (error?.code && typeof error.message === 'string' && error.message) throw new SourcesError(String(error.code).replace(/_/g, '-'), error.message)
            throw error
          }
          const sample = sampleText(look?.sample)
          if (!sample) return { name: tool.name, proposed: [], say: WORDS.nothing(tool.name) }
          const [facts, listed] = await Promise.all([deps.profile.forPrompt(userId), deps.profile.list(userId)])
          const answer = await deps.request({ ...sourcesRequest({ toolName: tool.name, sample, facts, text }), userId })
          if (answer?.abort) {
            if (answer.disabled) throw new SourcesError('turned-off', offWords(answer.abortMessage))
            if (answer.unusable && !answer.chosenLabel) throw new SourcesError('no-model', WORDS.noModel)
            if ((answer.capability || answer.unusable) && answer.abortMessage) throw new SourcesError('reply-unavailable', answer.abortMessage)
            throw new SourcesError('reply-unavailable', WORDS.failed)
          }
          let raw
          try {
            raw = readProposal(answer?.toolCall || null)
          } catch {
            throw new SourcesError('reply-unavailable', WORDS.failed)
          }
          const { proposed } = proposedSourceFacts(raw, { sample, toolName: tool.name, known: listed?.facts || [] })
          return { name: tool.name, proposed, ...(!proposed.length && { say: WORDS.nothing(tool.name) }) }
        })
      } finally {
        await release()
      }
    },

    /**
     * The facts the person chose to keep, saved as from that tool (addFactsFrom: refused when
     * personalization or that tool's switch is off; the same fact again is skipped; nothing past the
     * cap is kept; anything sensitive is refused). → { added, same, overCap, invalid, refused }
     */
    async keep(userId, input = {}) {
      await member(userId)
      const tool = await toolFor(userId, input?.ref)
      const { facts, refused } = sourceFactsToKeep(input?.facts)
      const refusal = sourceRefusal(await deps.profile.getSettings(userId), tool)
      if (refusal) throw new SourcesError(refusal.code, refusal.message)
      if (!facts.length) return { added: 0, same: 0, overCap: 0, invalid: 0, refused }
      try {
        return { ...(await deps.profile.addFrom(userId, integrationSource(tool), facts)), refused }
      } catch (error) {
        if (error?.code === 'registration_required') throw new SourcesError('sign-up', WORDS.guest)
        if (error?.code === 'personalization_off' || error?.code === 'source_off') {
          const again = sourceRefusal(await deps.profile.getSettings(userId), tool)
          throw new SourcesError(again?.code || 'source-off', again?.message || error.message)
        }
        throw error
      }
    },
  }
}
