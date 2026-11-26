import { validateWorkshop } from 'slateboxjs/workshops/model'
import { codePromptText, promptText } from '../ai-control/prompts/index.mjs'

// The tool a new lane board is drafted with (workshops.js draftWorkshop). Its description is a
// prompt (tool.draft_workshop): the request sends the published one.
const identifier = { type: 'string', pattern: '^[a-z][a-z0-9-]*$' }
const label = { type: 'string', minLength: 1, maxLength: 80 }
export const authorTool = {
  name: 'draft_workshop',
  description: codePromptText('tool.draft_workshop'),
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'title', 'lanes', 'cards'],
    properties: {
      version: { type: 'integer', enum: [1] },
      title: { type: 'string', minLength: 1, maxLength: 120 },
      lanes: {
        type: 'array', minItems: 2, maxItems: 5,
        items: {
          type: 'object', required: ['id', 'label'], additionalProperties: false,
          properties: { id: identifier, label, capacity: { type: 'integer', minimum: 1, maximum: 24 } },
        },
      },
      signals: {
        type: 'array', maxItems: 24,
        description: 'A visible change caused by placing one specific card in one lane. Include outcomes the brief asks the team to observe.',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'label', 'cardId', 'laneId', 'whenPresent', 'whenAbsent'],
          properties: {
            id: identifier, label, cardId: identifier, laneId: identifier,
            whenPresent: { type: 'string', minLength: 1, maxLength: 160 },
            whenAbsent: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
      },
      cards: {
        type: 'array', minItems: 1, maxItems: 24,
        items: {
          type: 'object', required: ['id', 'label', 'laneId'], additionalProperties: false,
          properties: {
            id: identifier, label, laneId: identifier,
            allowedLaneIds: { type: 'array', minItems: 1, maxItems: 5, items: identifier },
          },
        },
      },
    },
  },
}

// ---- Reading a drafted lane board (workshops.js draftWorkshop: the format 'lanes') ----

const WHOLE = /^\s*-?\d+\s*$/
const readJSON = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}
const wholeNumber = (value) => (typeof value === 'string' && WHOLE.test(value) ? Number(value) : value)
const withoutNulls = (item, keys) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  const out = { ...item }
  for (const key of keys) if (out[key] === null) delete out[key]
  return out
}

/**
 * A draft's unambiguous slips, repaired before the board's own check (as normalizePlan does for operation plans):
 * the arguments, or a list of lanes, cards or signals, sent as JSON text are read as JSON; a whole number written as
 * text (version, a lane's capacity) is that number; an optional field sent as null (capacity, allowedLaneIds,
 * signals) is left out. Nothing else is touched and nothing is invented: a capacity below its cards, an unknown lane
 * or a missing label is still refused by validateWorkshop and asked again.
 */
export function normalizeLaneDraft(input) {
  const draft = readJSON(input)
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return draft
  const out = withoutNulls({ ...draft, version: wholeNumber(draft.version) }, ['signals'])
  for (const key of ['lanes', 'cards', 'signals']) if (out[key] !== undefined) out[key] = readJSON(out[key])
  if (Array.isArray(out.lanes)) out.lanes = out.lanes.map((lane) => {
    const kept = withoutNulls(lane, ['capacity'])
    return kept && typeof kept === 'object' && kept.capacity !== undefined ? { ...kept, capacity: wholeNumber(kept.capacity) } : kept
  })
  if (Array.isArray(out.cards)) out.cards = out.cards.map((card) => {
    const kept = withoutNulls(card, ['allowedLaneIds'])
    return kept && typeof kept === 'object' && kept.allowedLaneIds !== undefined ? { ...kept, allowedLaneIds: readJSON(kept.allowedLaneIds) } : kept
  })
  return out
}

/** A drafted lane board as the board's own check reads it, its slips repaired first. Throws what is wrong. */
export const parseLaneDraft = (args) => validateWorkshop(normalizeLaneDraft(args))

/**
 * The check a lane draft's answer gets (req's validateResponse): null when it is a board, else what to ask again,
 * naming the problem (the board's own sentence) so the retry can fix it.
 */
export function laneDraftCheck(toolCall, { tool = authorTool, parse = parseLaneDraft } = {}) {
  try {
    if (toolCall?.name !== tool.name) throw new Error('Call the requested tool.')
    const args = normalizeLaneDraft(toolCall.arguments)
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.values(args).every((value) => value === undefined)) throw new Error(`The ${tool.name} call came with no board: send the whole board in its arguments.`)
    parse(toolCall.arguments)
    return null
  } catch (error) {
    const problem = String(error.message)
    return { code: 'invalidWorkshopDraft', retryPrompt: promptText('workshop.draft.retry', { problem }) }
  }
}
