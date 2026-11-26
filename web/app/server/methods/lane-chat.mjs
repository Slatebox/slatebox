import { catalogEntry } from 'slateboxjs/catalog'
import { laneEditFormats, proposeLaneReply } from '../../imports/api/common/lane-conversation.mjs'
import { gridEditFormats } from '../../imports/api/common/grid-chat.mjs'
import { codePromptText, promptText } from '../ai-control/prompts/index.mjs'

// The description is a prompt (tool.propose_workshop_edits); laneTool() sends the published one.
export const laneChangeTool = {
  name:'propose_workshop_edits',
  description:codePromptText('tool.propose_workshop_edits'),
  parameters:{
    type:'object', additionalProperties:false, required:['reply'],
    properties:{
      reply:{type:'string', minLength:1, maxLength:1200},
      commands:{type:'array', minItems:1, maxItems:12, items:{type:'string',minLength:1,maxLength:1000}},
      // A request this board can't do that another kind of board does: named, never forced (Boards S2a).
      recommend:{type:'object', additionalProperties:false, required:['component','why'], properties:{
        component:{type:'string', minLength:1, maxLength:60, description:'A catalogue component id, such as sales-pipeline, budget, team-board or launch-plan.'},
        why:{type:'string', minLength:1, maxLength:300},
      }},
    },
  },
}

export const laneTool = () => ({ ...laneChangeTool, description: promptText('tool.propose_workshop_edits') })

// The lane chat's instructions (workshop.lane.system): the command formats are the reader's own.
// A grid sheet's are its own (grid-chat.mjs gridEditFormats): a page, a grid, tiles in cells, pages, rules and print.
export const laneSystemValues = (board) => ({ editFormats: (board?.kind === 'grid' ? gridEditFormats : laneEditFormats).join('; ') })
export const laneInstructions = (board) => promptText('workshop.lane.system', laneSystemValues(board))

// A component the AI named: kept only when it is a catalogue entry (an unknown id is dropped).
function recommendOf(input) {
  const named = input?.recommend
  if (!named || typeof named.component !== 'string' || typeof named.why !== 'string' || !named.why.trim() || named.why.length > 300) return null
  return catalogEntry(named.component) ? { component: named.component, why: named.why.trim() } : null
}

export function prepareLaneReply(input, workshop, selection) {
  const recommend = recommendOf(input)
  const commands = input?.commands
  if (typeof input?.reply !== 'string' || !input.reply.trim() || input.reply.length > 1200 ||
      (commands !== undefined && (!Array.isArray(commands) || commands.length < 1 || commands.length > 12))) throw Error('Invalid workshop proposal.')
  // A reply that only recommends another kind of board: words and the component, no proposal.
  if (commands === undefined) {
    if (!input?.recommend) throw Error('Invalid workshop proposal.')
    return { reply: input.reply.trim(), workshop: null, ...(recommend && { recommend }) }
  }
  let next = workshop
  let override = null
  // A grid sheet's print command is an action the page runs (gridPrint.js), not a change of the board.
  let action = null
  for (const command of commands) {
    const made = proposeLaneReply(next, command, selection)
    if (made.action) action = made.action
    if (made.workshop) next = made.workshop
    if (made.override) override = made
  }
  if (action && next === workshop) return { reply: input.reply.trim(), workshop: null, action, ...(recommend && { recommend }) }
  // A move the rules refuse, offered as "Move anyway": said in the board's words, alone (move-anyway.mjs).
  if (override) {
    if (commands.length > 1) throw Error(override.reply)
    return { reply: override.reply, workshop: next, override: override.override, ...(recommend && { recommend }) }
  }
  return { reply: input.reply.trim(), workshop: next, ...(action && { action }), ...(recommend && { recommend }) }
}
