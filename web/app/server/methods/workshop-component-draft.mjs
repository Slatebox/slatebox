// Drafting a smart component from a description (workshops.draft, format 'component'; builder-freeform.mjs): the
// lane board tool (draft_workshop) with the rules a board of plain lanes takes, the instructions with worked examples
// (workshop.draft.component, an administrator's to edit), and a check that holds a draft to the quality gate
// (componentQuality) as well as the board's own (validateWorkshop): a draft of "Piece 1 … Piece 6" in generic lanes, or
// one with no behavior at all, is asked again, naming what is wrong.
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { codePromptText, promptText } from '../ai-control/prompts/index.mjs'
import { componentQuality, repairComponent } from '../../imports/api/common/builder-freeform.mjs'
import { authorTool, normalizeLaneDraft } from './workshop-lane-draft.mjs'

const identifier = { type: 'string', pattern: '^[a-z][a-z0-9-]*$' }

/** The tool: draft_workshop's board, and the rules (behavior as data) a board of plain lanes takes. */
export const componentAuthorTool = {
  name: authorTool.name,
  description: codePromptText('tool.draft_component'),
  parameters: {
    ...authorTool.parameters,
    properties: {
      ...authorTool.parameters.properties,
      rules: {
        type: 'array', maxItems: 8,
        description: 'How cards may move. one-step: cards move one lane at a time, in lane order. path: cards in lane from may go only to the lanes in to. archive: lane is where finished or discarded cards are filed.',
        items: {
          type: 'object', additionalProperties: false, required: ['kind'],
          properties: {
            kind: { type: 'string', enum: ['one-step', 'path', 'archive'] },
            from: identifier,
            to: { type: 'array', minItems: 1, maxItems: 4, items: identifier },
            lane: identifier,
          },
        },
      },
    },
  },
}
/** The tool as a request sends it: its description the published prompt (tool.draft_component). */
export const componentTool = () => ({ ...componentAuthorTool, description: promptText('tool.draft_component') })

const readJSON = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

/**
 * A component draft's rules as the board's rulebook: one-step (cards move one lane at a time), path (cards in `from`
 * may go only to `to`), archive (a lane where cards are filed away). Set by the agent, from the chat. Throws the
 * rulebook's own sentence for a rule it does not take.
 */
export function componentRules(rules, { now = new Date(), by = 'Slatebox agent' } = {}) {
  const list = readJSON(rules)
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw new Error('Rules are a list.')
  const set = { by, at: new Date(now).toISOString(), via: 'chat' }
  const base = { on: true, severity: 'refuse', set }
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const rule = readJSON(raw)
    if (!rule || typeof rule !== 'object') throw new Error('A rule is an object.')
    let made
    if (rule.kind === 'one-step') made = { id: 'one-step', kind: 'path', from: 'any', noSkip: true }
    else if (rule.kind === 'path') made = { id: `path-${rule.from}`, kind: 'path', from: rule.from, to: readJSON(rule.to) }
    else if (rule.kind === 'archive') made = { id: `archive-${rule.lane}`, kind: 'bin', lane: rule.lane }
    else throw new Error('A rule is one-step, path or archive.')
    if (seen.has(made.id)) continue
    seen.add(made.id)
    out.push({ ...made, ...base })
  }
  return out
}

/**
 * A component draft as a board: its slips repaired (normalizeLaneDraft), its rules made its rulebook, checked by
 * validateWorkshop, then its unambiguous quality slips repaired (repairComponent). Throws what is wrong.
 */
export function parseComponentDraft(args, { now } = {}) {
  const draft = normalizeLaneDraft(args)
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return validateWorkshop(draft)
  const { rules, ...board } = draft
  const behaviour = componentRules(rules, { now })
  const workshop = validateWorkshop(behaviour.length ? { ...board, behaviour: { version: 1, rev: 1, rules: behaviour } } : board)
  return repairComponent(workshop).workshop
}

/**
 * The check a component draft's answer gets (req's validateResponse): null when it is a board that passes the
 * quality gate, else what to ask again, naming the problem. `message`: the person's words (what the board is checked
 * against: a card that is only their words and a number is a placeholder).
 */
export function componentDraftCheck(toolCall, { tool = componentTool(), message = '' } = {}) {
  let problem
  try {
    if (toolCall?.name !== tool.name) throw new Error('Call the requested tool.')
    const args = normalizeLaneDraft(toolCall.arguments)
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.values(args).every((value) => value === undefined)) throw new Error(`The ${tool.name} call came with no board: send the whole board in its arguments.`)
    const workshop = parseComponentDraft(toolCall.arguments)
    if (workshop.kind || workshop.experience || workshop.lanes.some((lane) => lane.station)) throw new Error('Draft a board of plain lanes: no kind, experience or stations.')
    const { workshop: repaired } = repairComponent(workshop, { message })
    const quality = componentQuality(repaired, { message })
    if (!quality.length) return null
    problem = quality.join(' ')
    return { code: 'weakComponentDraft', retryPrompt: promptText('workshop.draft.retry', { problem }) }
  } catch (error) {
    problem = String(error.message)
    return { code: 'invalidWorkshopDraft', retryPrompt: promptText('workshop.draft.retry', { problem }) }
  }
}
