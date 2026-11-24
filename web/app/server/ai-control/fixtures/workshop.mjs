// Test-run samples for board chat (surface workshop): a lane board and a map board, as
// workshops.js chatTurn sends them. parses() is the board's own check (prepareLaneReply,
// prepareMapReply) on a proposal, or a short plain reply.
import { laneSystemValues, laneChangeTool, prepareLaneReply } from '../../methods/lane-chat.mjs'
import { mapChangeTool, prepareMapReply } from '../../methods/map-chat.mjs'
import { textOf, toolCallOf, verdict } from './answer.mjs'

export const LANES = { version: 1, title: 'Pick a venue', lanes: [{ id: 'ideas', label: 'Ideas' }, { id: 'shortlist', label: 'Shortlist', capacity: 2 }],
  cards: [{ id: 'hall', label: 'Town hall', laneId: 'ideas' }, { id: 'barn', label: 'Old barn', laneId: 'ideas' }, { id: 'park', label: 'City park', laneId: 'ideas' }] }
export const MAP = { version: 1, title: 'Trip', lanes: [
  { id: 'station-1', label: 'Start', station: { column: 0, row: 0, next: ['station-2'], outcome: 'Set off.' } },
  { id: 'station-2', label: 'Summit', station: { column: 1, row: 0, next: [], outcome: 'At the top.' } }],
cards: [{ id: 'walker', label: 'Walker', laneId: 'station-1' }] }

const values = {
  'workshop.lane.system': laneSystemValues(),
  'workshop.chat.retry': { reason: '' },
}
const sample = (id, title, map, message) => ({ id, title, map, board: map ? MAP : LANES, message, values })

export default {
  surface: 'workshop',
  samples: [
    sample('lanes-move', 'Lane board: move a card', false, 'move the old barn to the shortlist'),
    sample('lanes-question', 'Lane board: a question', false, 'which venue is cheapest to book?'),
    sample('map-add', 'Map board: add a station', true, 'add a station after the summit called camp'),
  ],
  toolFor: (s) => (s.map ? mapChangeTool.name : laneChangeTool.name),
  request: async (s, render) => ({
    sdkChat: true,
    system: await render(s.map ? 'workshop.map.system' : 'workshop.lane.system'),
    prompts: [{ role: 'user', content: JSON.stringify({ [s.map ? 'currentMap' : 'currentWorkshop']: s.board, message: s.message }) }],
    functions: [s.map ? { ...mapChangeTool, description: await render('tool.propose_map_edits') } : { ...laneChangeTool, description: await render('tool.propose_workshop_edits') }],
    allowPlainText: true,
  }),
  parses: (response, s) => verdict(() => {
    const call = toolCallOf(response)
    if (!call) {
      const reply = textOf(response).trim()
      return reply && reply.length <= 1200 ? null : 'Neither a proposal nor a short reply came back.'
    }
    if (call.name !== (s.map ? mapChangeTool.name : laneChangeTool.name)) return `It called ${call.name}.`
    if (s.map) prepareMapReply(call.arguments, s.board)
    else prepareLaneReply(call.arguments, s.board, null)
    return null
  }),
}
