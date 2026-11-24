// The refine AI: a reviewer asks for a change to a library item ("Tighten the rules", "Write a
// clearer one-line summary") and gets a proposal back, never a change. The core (core.mjs refine)
// checks the proposal, shows it as a diff, and applies it only when the reviewer keeps it.
//
//   createRefineAI({ request, meter, canUseAI, refusal, config }) → refineWithAI
//   refineWithAI({ item, board, message, history, principal }) → { reply, meta?, edits?, check?, ai? }
//
// `request` is req (server/methods/ai/req.js) in the app: it picks the connection
// settings.ai.use.library names, which falls back to use.chat, then use.default
// (connections.mjs USE_FALLBACK), with built-in defaults under "library" in ai-defaults.json. No model
// is named here. `meter` is runAIAction({ feature: 'library-refine', userId }), so every turn is
// counted like a chat turn. `ai` in the answer is what the event log keeps: the connection's ref,
// never a key.
//
// Keep applies exactly the proposal the reviewer previewed: the core stores each preview with the
// item (core.mjs refine, refinePreviews) and Keep names it, so it holds on any server process and
// after a restart. This module only asks the AI.
//
// Everything the author wrote (titles, lane labels, cards, rules made from them) travels in the user
// turn as one data block, never in the system prompt; and warnings about personal data come from a
// scan of the item on the server too (personalDataChecks), not from the AI alone.
import { CATEGORY_LABELS, KIND_LABELS, LIBRARY_CATEGORIES, LIBRARY_LIMITS, categoryLabel, libraryError } from '../../imports/api/common/library-model.mjs'
import { describeWorkshopEdits, rulebook, validateWorkshop } from 'slateboxjs/workshops/model'
import 'slateboxjs/workshops/behaviour'
import { promptText } from '../ai-control/prompts/index.mjs'

export const REFINE_TOOL_NAME = 'propose_library_refinement'

const metaSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Only the details that should change. Leave out any field that stays as it is.',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: LIBRARY_LIMITS.title },
    summary: { type: 'string', minLength: 1, maxLength: LIBRARY_LIMITS.summary, description: 'One plain line: what it is and what it holds.' },
    description: { type: 'string', maxLength: LIBRARY_LIMITS.description },
    category: { type: 'string', enum: [...LIBRARY_CATEGORIES] },
    synonyms: { type: 'array', maxItems: LIBRARY_LIMITS.synonyms, items: { type: 'string', minLength: 1, maxLength: LIBRARY_LIMITS.synonym } },
  },
}

/** The edits a board takes, from the engine's own table (describeWorkshopEdits), for the tool's schema. */
export function acceptedEdits(board) {
  if (!board) return []
  try {
    return describeWorkshopEdits(validateWorkshop(board)).filter((edit) => edit.accepted)
  } catch {
    return []
  }
}

/** The one tool the AI must call. Board edits are offered only for a smart component with a board. */
export function refineTool(item, board) {
  const edits = item?.kind === 'component' ? acceptedEdits(board) : []
  return {
    name: REFINE_TOOL_NAME,
    description: promptText('tool.propose_library_refinement'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['reply'],
      properties: {
        reply: { type: 'string', minLength: 1, maxLength: 1200, description: 'What you propose and why, or the answer to a question, in a few plain sentences.' },
        meta: metaSchema,
        ...(edits.length && {
          edits: {
            type: 'array', maxItems: 20,
            description: 'Edits to the board on the review copy, applied in order, all or none. Use ids from the board.',
            items: { oneOf: edits.map((edit) => edit.schema) },
          },
        }),
        check: {
          type: 'array', maxItems: 12,
          description: 'Things the reviewer should look at before publishing: anything that looks like personal data or private company figures, rules that read unclearly, a title that promises more than the board does.',
          items: { type: 'string', minLength: 1, maxLength: 300 },
        },
      },
    },
  }
}

const sentenceList = (lines) => (lines.length ? lines.map((line) => '- ' + line).join('\n') : '- none')

/**
 * The system prompt: the reviewer's job, the category set, the limits and the edits the board takes
 * (from the engine's table, never the author's words). The item itself, its board and its rules are in
 * the user turn (refineRequest). The text is a prompt an administrator can edit
 * (library.refine.system, server/ai-control/prompts/library.mjs).
 */
export function refinePrompt(item, board) {
  const componentBoard = item.kind === 'component' && Boolean(board)
  const edits = componentBoard ? acceptedEdits(board) : []
  return promptText('library.refine.system', {
    kind: String(KIND_LABELS[item.kind] || item.kind),
    categories: LIBRARY_CATEGORIES.map((id) => `${CATEGORY_LABELS[id]} (${id})`).join(', '),
    titleMax: LIBRARY_LIMITS.title,
    summaryMax: LIBRARY_LIMITS.summary,
    descriptionMax: LIBRARY_LIMITS.description,
    synonymsMax: LIBRARY_LIMITS.synonyms,
    categoryLocked: Boolean(item.categoryLocked && item.category),
    ...(item.categoryLocked && item.category && { categoryLabel: String(categoryLabel(item.category)) }),
    componentBoard,
    hasEdits: edits.length > 0,
    edits: sentenceList(edits.map((edit) => `${edit.kind}: ${edit.summary}`)),
    notComponent: item.kind !== 'component',
  })
}

/** What the AI is told about the item and asked, as one user turn: one data block, the author's words fenced inside it. */
export function refineRequest({ item, board, message }) {
  let rules = []
  if (board) { try { rules = rulebook().lines(validateWorkshop(board)) } catch { rules = [] } }
  const shown = {
    kind: item.kind, title: item.title, summary: item.summary,
    ...(item.description && { description: item.description }),
    ...(item.category && { category: item.category }),
    synonyms: item.synonyms || [], authorName: item.authorName,
    ...(board && { board: { kind: board.kind, title: board.title, lanes: board.lanes, cards: board.cards, behaviour: board.behaviour, rules } }),
  }
  const fence = '`'.repeat(3)
  return promptText('library.refine.request', { data: JSON.stringify({ item: shown, message }).replaceAll(fence, "'''") })
}

// What the server itself flags before publishing, whatever the AI says: email addresses, phone numbers
// and long digit runs (account or card numbers) in the item's words or on its board.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE = /(?:\+?\d[\s().-]?){9,}\d/g
const TEXT_KEYS = new Set(['text', 'title', 'label', 'name', 'body', 'note', 'description', 'summary', 'lanes', 'cards'])
/** → the reviewer's check lines for personal data found in the item and its board ([] when none). */
export function personalDataChecks(item, board) {
  const texts = [item?.title, item?.summary, item?.description, ...(item?.synonyms || [])]
  // Only the words people wrote (titles, labels, card text), never ids or positions.
  const walk = (value, key = 'text') => {
    if (typeof value === 'string') { if (TEXT_KEYS.has(key)) texts.push(value) }
    else if (Array.isArray(value)) value.forEach((entry) => walk(entry, key))
    else if (value && typeof value === 'object') Object.entries(value).forEach(([field, entry]) => walk(entry, field))
  }
  if (board) walk({ title: board.title, lanes: board.lanes, cards: board.cards })
  const all = texts.filter((text) => typeof text === 'string').join('\n')
  const out = []
  const emails = [...new Set(all.match(EMAIL) || [])]
  if (emails.length) out.push(`It holds ${emails.length === 1 ? 'an email address' : `${emails.length} email addresses`}: ${emails.slice(0, 3).join(', ')}. Remove personal data before publishing.`)
  const numbers = [...new Set((all.replace(EMAIL, ' ').match(PHONE) || []).map((text) => text.trim()))]
  if (numbers.length) out.push(`It holds ${numbers.length === 1 ? 'a long number' : `${numbers.length} long numbers`} (a phone or account number?): ${numbers.slice(0, 3).join(', ')}. Check before publishing.`)
  return out
}

/** The tool call's arguments as a proposal (unchecked: core.mjs checks every proposal). */
export function readRefinement(args) {
  if (!args || typeof args !== 'object') return null
  return {
    reply: typeof args.reply === 'string' ? args.reply : '',
    ...(args.meta && typeof args.meta === 'object' && { meta: args.meta }),
    ...(Array.isArray(args.edits) && args.edits.length && { edits: args.edits }),
    ...(Array.isArray(args.check) && { check: args.check }),
  }
}

const historyTurns = (history = []) =>
  history.filter((turn) => turn && typeof turn.text === 'string' && turn.text.trim())
    .slice(-LIBRARY_LIMITS.history)
    .map((turn) => ({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: turn.text.slice(0, 2000) }))

// Said when there is no reason more exact: the server has no AI for the library.
export const NO_AI_SENTENCE = 'AI is not set up on this server.'
const BY_HAND = ' Rename, recategorise or rewrite the summary by saying it ("rename it to …", "put it in Decide", "summary: …").'

/** A refusal ({ code, message, pay? } from the meter, or a Meteor.Error it threw) as the library's 403. */
function unavailable(refused) {
  const message = typeof refused?.message === 'string' && refused.message.trim() ? refused.message.trim() : NO_AI_SENTENCE
  const details = { ...(refused?.code && { reason: refused.code }), ...(refused?.pay && { pay: refused.pay }) }
  return libraryError(403, 'ai_unavailable', message + BY_HAND, Object.keys(details).length ? details : undefined)
}
// The meter's refusal thrown as it starts (a Meteor.Error: error is its code, reason its words, details.pay).
const meterRefusal = (error) => (error && typeof error.error === 'string' && typeof error.reason === 'string' && !error.status
  ? { code: error.error, message: error.reason, ...(error.details?.pay && { pay: error.details.pay }) } : null)

// `refusal(userId)` → { code, message, pay? } | null: why this person can't use AI now, in the meter's own
// words (Pro, balance, today's amount used, AI off). Without one, or with no reason, the server has no AI.
export function createRefineAI({ request, meter = (_opts, fn) => fn(), canUseAI = async () => true, refusal = async () => null, config = () => ({}) }) {
  return async function refineWithAI({ item, board, message, history = [], principal }) {
    const userId = principal?.userId ?? null
    if (!(await canUseAI(userId))) throw unavailable(await refusal(userId).catch(() => null))
    const tool = refineTool(item, board)
    const system = refinePrompt(item, board)
    const turn = await meter({ feature: 'library-refine', userId }, () => request({
      ...config(), sdkChat: true, feature: 'library-refine', userId,
      system,
      prompts: [...historyTurns(history), { role: 'user', content: refineRequest({ item, board, message }) }],
      functions: [tool], function_call: { name: REFINE_TOOL_NAME }, maxResponseValidationRetries: 1,
      validateResponse: ({ toolCall }) => (toolCall?.name === REFINE_TOOL_NAME && readRefinement(toolCall.arguments)?.reply
        ? null : { code: 'invalid-refinement', retryPrompt: promptText('library.refine.retry') }),
    })).catch((error) => {
      const refused = meterRefusal(error)
      throw refused ? unavailable(refused) : error
    })
    if (!turn || turn.abort) throw libraryError(502, 'refine_failed', turn?.abortMessage || 'The AI could not answer just now. Ask again.')
    const proposal = readRefinement(turn.toolCall?.arguments)
    if (!proposal?.reply) throw libraryError(502, 'refine_failed', 'The AI answer could not be read. Ask again.')
    return { ...proposal, ai: { feature: 'library-refine', ref: turn.chosen || 'builtin', request: message.slice(0, 2000), reply: proposal.reply.slice(0, 2000) } }
  }
}

// Until the app wires createRefineAI (meteor.js), and in tests that give no AI: a reply only.
export async function refineWithAI() {
  return {
    reply: 'I can rename it ("rename it to …"), move it to a category ("put it in Decide") or change its one-line summary ("summary: …"). Edit the board itself on the canvas.',
  }
}
