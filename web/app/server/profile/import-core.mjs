// Learning from a data export the person uploads (About you › "Learn from a data export", S3,
// 2026-11-26), without Meteor (server/methods/profile-import.js wires the real dependencies; the tests
// use stand-ins):
//   list(userId)                   the uploads they kept facts from, with each one's switch
//   read(userId, { data })         the export read (bounded, server/profile/import-archive.mjs) and the
//                                  facts the agent proposes from a few of its fields
//   keep(userId, { ref, facts })   the facts the person chose to keep, saved as from that upload
// Nothing from the file is kept: its bytes are read in memory and dropped, the sample goes to one model
// call wrapped as data, and a proposed fact is never saved: only keep saves, and only what the person
// sent back. Keeping switches that upload's facts on for personalization (the person chose them).
//
// Before anything is read, in this order: a saved account, personalization on, a file within the cap,
// the administrator's switch for the surface, a model to answer it, the meter, and one upload at a
// time per person. The model call runs inside `run` (runAIAction, metered under 'profile.import'), with
// registry prompts only.
import {
  IMPORT_FACT_KINDS, IMPORT_KINDS, IMPORT_LABELS, IMPORT_LIMITS, ImportError, checkUpload, importFactsToKeep, importRefusal, importSwitchKey,
  proposedImportFacts, uploadRows, uploadSource,
} from '../../imports/api/common/profile-import.mjs'
import { promptText } from '../ai-control/prompts/index.mjs'
import { parseExport } from './import-archive.mjs'

export const PROPOSE_TOOL_NAME = 'propose_facts'

// The propose_facts tool's arguments. Its description is a registry prompt (profile.import.tool), built per call.
export const PROPOSE_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      maxItems: IMPORT_LIMITS.proposed,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text'],
        properties: {
          kind: { type: 'string', enum: [...IMPORT_FACT_KINDS] },
          text: { type: 'string', minLength: 1, maxLength: 280 },
        },
      },
    },
  },
})

/** The propose_facts tool as a request sends it: its description the published profile.import.tool, read now. */
export const importTool = (text = promptText) => ({
  name: PROPOSE_TOOL_NAME,
  description: text('profile.import.tool', { kinds: IMPORT_FACT_KINDS.join(', ') }),
  parameters: PROPOSE_PARAMETERS,
})

const readJSON = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

/** The facts a propose_facts call carries (not yet checked: proposedImportFacts does that). Throws for anything else. */
export function readProposal(toolCall) {
  if (!toolCall || toolCall.name !== PROPOSE_TOOL_NAME) throw new ImportError('invalid-answer', 'The agent did not propose facts.')
  const args = readJSON(toolCall.arguments)
  const facts = readJSON(args?.facts)
  if (!args || typeof args !== 'object' || (facts !== undefined && !Array.isArray(facts))) throw new ImportError('invalid-answer', 'The facts were not a list.')
  return (facts || []).map((fact) => readJSON(fact))
}

/**
 * The request one upload sends: the system text with the export's name and what is known (as data),
 * the sample as the user turn (as data), and the propose_facts tool. `text` is the registry's
 * promptText (a test run passes its own renderer).
 */
export function importRequest({ kind = 'linkedin', sample = '', facts = '', text = promptText } = {}) {
  const known = typeof facts === 'string' ? facts.trim() : ''
  const site = IMPORT_LABELS[kind] || 'a site'
  return {
    feature: 'profile.import',
    sdkChat: true,
    system: text('profile.import.facts', { site, hasFacts: Boolean(known), ...(known && { facts: known }) }),
    prompts: [{ role: 'user', content: text('profile.import.sample', { site, sample }) }],
    functions: [importTool(text)],
    maxResponseValidationRetries: 1,
    // a usable answer: one propose_facts call with a list (an empty one is an answer)
    validateResponse: ({ toolCall }) => {
      try {
        readProposal(toolCall)
        return null
      } catch {
        return { code: 'invalid-profile-import', retryPrompt: text('profile.import.retry') }
      }
    },
  }
}

// What a person is told, in plain words.
export const WORDS = Object.freeze({
  guest: 'Sign up to learn from your data exports. About you is for saved accounts.',
  off: 'Learning from data exports is off on this server.',
  noModel: 'No agent model is set up on this server yet, so Slatebox cannot read your export right now. An administrator chooses one in Admin › AI.',
  busy: 'Slatebox is still reading your last upload. Try again in a moment.',
  failed: 'Slatebox could not read that just now. Try again.',
  unknown: 'That upload is not one About you knows.',
  nothing: (name) => `Slatebox found nothing in your ${name} export to learn from.`,
})
const DEFAULT_OFF = 'This feature is turned off by your administrator.'
const offWords = (message) => (message && message !== DEFAULT_OFF && message !== WORDS.off ? `${WORDS.off} ${message}` : WORDS.off)

/**
 * deps: {
 *   loadUser(userId) → { _id, isAnonymous? } | null
 *   profile: the About you store (server/profile/store.mjs): getSettings, setSettings, list, forPrompt, addFrom
 *   surfaceOff(userId) → null | { message }        the administrator's switch for the surface
 *   modelMissing(userId) → boolean                 no model answers the surface here
 *   allowed(user) → throws the meter's refusal, or resolves
 *   lock(userId) → release() | null                one upload at a time per person
 *   run(userId, fn)                                runAIAction({ feature: 'profile.import', userId }, fn)
 *   request(opts) → req()'s answer
 *   parse?(bytes) → { kind, label, sample }        parseExport (tests may pass their own)
 *   text?                                          promptText
 * }
 */
export function createProfileImport(deps) {
  const text = deps.text || promptText
  const parse = deps.parse || parseExport

  async function member(userId) {
    const user = userId ? await deps.loadUser(userId) : null
    if (!user || user.isAnonymous) throw new ImportError('sign-up', WORDS.guest)
    return user
  }

  const kindOf = (ref) => {
    if (typeof ref !== 'string' || !IMPORT_KINDS.includes(ref)) throw new ImportError('unknown-upload', WORDS.unknown)
    return ref
  }

  return {
    /** The uploads About you lists a switch for. → { uploads: [{ ref, name, on, facts }] } */
    async list(userId) {
      await member(userId)
      const { settings, facts } = await deps.profile.list(userId)
      return { uploads: uploadRows(settings, facts) }
    },

    /** The export read, and the facts the agent proposes from it. → { ref, name, proposed: [{ kind, text }], say? } */
    async read(userId, input = {}) {
      const user = await member(userId)
      const refusal = importRefusal(await deps.profile.getSettings(userId))
      if (refusal) throw new ImportError(refusal.code, refusal.message)
      const bytes = checkUpload(input?.data)
      const off = await deps.surfaceOff(userId)
      if (off) throw new ImportError('turned-off', offWords(off.message))
      if (await deps.modelMissing(userId)) throw new ImportError('no-model', WORDS.noModel)
      await deps.allowed(user)
      const release = await deps.lock(userId)
      if (!release) throw new ImportError('busy', WORDS.busy)
      try {
        // read before the metered run: a file that is not an export costs nothing
        const parsed = parse(bytes)
        const out = { ref: parsed.kind, name: parsed.label }
        if (!parsed.sample) return { ...out, proposed: [], say: WORDS.nothing(parsed.label) }
        return await deps.run(userId, async () => {
          const [facts, listed] = await Promise.all([deps.profile.forPrompt(userId), deps.profile.list(userId)])
          const answer = await deps.request({ ...importRequest({ kind: parsed.kind, sample: parsed.sample, facts, text }), userId })
          if (answer?.abort) {
            if (answer.disabled) throw new ImportError('turned-off', offWords(answer.abortMessage))
            if (answer.unusable && !answer.chosenLabel) throw new ImportError('no-model', WORDS.noModel)
            if ((answer.capability || answer.unusable) && answer.abortMessage) throw new ImportError('reply-unavailable', answer.abortMessage)
            throw new ImportError('reply-unavailable', WORDS.failed)
          }
          let raw
          try {
            raw = readProposal(answer?.toolCall || null)
          } catch {
            throw new ImportError('reply-unavailable', WORDS.failed)
          }
          const { proposed } = proposedImportFacts(raw, { sample: parsed.sample, known: listed?.facts || [] })
          return { ...out, proposed, ...(!proposed.length && { say: WORDS.nothing(parsed.label) }) }
        })
      } finally {
        await release()
      }
    },

    /**
     * The facts the person chose to keep, saved as from that upload, whose switch Keep turns on
     * (addFactsFrom: refused when personalization is off; the same fact again is skipped; nothing past
     * the cap is kept; anything sensitive is refused). → { added, same, overCap, invalid, refused }
     */
    async keep(userId, input = {}) {
      await member(userId)
      const kind = kindOf(input?.ref)
      const { facts, refused } = importFactsToKeep(input?.facts)
      const refusal = importRefusal(await deps.profile.getSettings(userId))
      if (refusal) throw new ImportError(refusal.code, refusal.message)
      if (!facts.length) return { added: 0, same: 0, overCap: 0, invalid: 0, refused }
      try {
        await deps.profile.setSettings(userId, { sources: { [importSwitchKey(kind)]: true } })
        return { ...(await deps.profile.addFrom(userId, uploadSource(kind), facts)), refused }
      } catch (error) {
        if (error?.code === 'registration_required') throw new ImportError('sign-up', WORDS.guest)
        if (error?.code === 'personalization_off') {
          const again = importRefusal(await deps.profile.getSettings(userId))
          throw new ImportError(again?.code || 'personalization-off', again?.message || error.message)
        }
        throw error
      }
    },
  }
}
