import { addMapToken, applyMapObjectEdit } from '../../imports/api/common/map-object-edits.mjs'
import { addWorkshopBranch, validateWorkshop, workshopCandidate } from 'slateboxjs/workshops/model'
import { moveAnywayProposal } from '../../imports/api/common/move-anyway.mjs'

const short = (maxLength = 80) => ({ type: 'string', minLength: 1, maxLength })
const action = (type, fields) => ({
  type: 'object', additionalProperties: false, required: ['type', ...Object.keys(fields)],
  properties: { type: { type: 'string', enum: [type] }, ...fields },
})
export const mapChangeTool = {
  name: 'propose_map_edits', description: 'Prepare changes to the saved map for the editor to review.',
  parameters: { type: 'object', additionalProperties: false, required: ['reply', 'edits'],
    properties: { reply: short(1200), edits: { type: 'array', minItems: 1, maxItems: 16, items: { anyOf: [
      action('position', {id:short(), column:{type:'integer',minimum:0,maximum:2},row:{type:'integer',minimum:0,maximum:2}}),
      action('capacity', {id:short(), capacity:{type:'integer',minimum:1,maximum:24}}), action('clearCapacity',{id:short()}),
      action('image',{id:short(),src:short(2048),alt:short(240)}), action('imageDescription',{id:short(),text:short(240)}),
      action('clearImage',{id:short()}), action('moveToken',{id:short(),to:short()}),
      action('addToken',{at:short(),label:short()}),
      action('title', { text: short(120) }), action('renameStation', { id: short(), text: short() }),
      action('outcome', { id: short(), text: short(160) }), action('renameToken', { id: short(), text: short() }),
      action('addBranch', { from: short(), label: short(), outcome: short(160) }),
      action('setPresentationOrder', { laneIds: { type: 'array', items: short(), minItems: 2, maxItems: 5 } }),
      action('connect', { from: short(), to: short() }), action('disconnect', { from: short(), to: short() }),
    ] } } } },
}
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit
export function mapChatHistory(history) {
  if (!Array.isArray(history) || history.length > 12 || history.some(turn =>
    !['user', 'assistant'].includes(turn?.role) || !text(turn.content, 1200))) throw new Error('Invalid conversation history.')
  return history.map(({role, content}) => ({role, content}))
}
export function prepareMapReply(input, original) {
  let map = validateWorkshop(original)
  if (!map.lanes.every(lane => lane.station) || !text(input?.reply, 1200) || !Array.isArray(input.edits) ||
    !input.edits.length || input.edits.length > 16) throw new Error('Invalid map proposal.')
  const station = id => {
    const lane = map.lanes.find(item => item.id === id)
    if (!lane?.station) throw new Error('Unknown station.')
    return lane
  }
  for (const edit of input.edits) {
    switch (edit.type) {
      case 'position': case 'capacity': case 'clearCapacity': case 'image': case 'clearImage': case 'imageDescription':
        map = applyMapObjectEdit(map, {kind:'lane', id:edit.id}, edit); break
      case 'moveToken': {
        // A step the rules close (no path to it from where the token is): one move alone is offered as "Move
        // anyway", with the rule's sentence (move-anyway.mjs); the server marks who and when as it is kept.
        const anyway = input.edits.length === 1 && map.cards.some(card => card.id === edit.id) && map.lanes.some(lane => lane.id === edit.to) &&
          !workshopCandidate(map, edit.id, edit.to) ? moveAnywayProposal(map, edit.id, edit.to) : null
        if (anyway) return anyway
        map = applyMapObjectEdit(map, {kind:'card', id:edit.id}, edit)
        break
      }
      case 'addToken': map = addMapToken(map,edit.at,edit.label); break
      case 'title': map.title = edit.text; break
      case 'renameStation': station(edit.id).label = edit.text; break
      case 'outcome': station(edit.id).station.outcome = edit.text; break
      case 'renameToken': {
        const card = map.cards.find(item => item.id === edit.id)
        if (!card) throw new Error('Unknown token.')
        card.label = edit.text
        break
      }
      case 'addBranch': map = addWorkshopBranch(map, edit.from, {label: edit.label, outcome: edit.outcome}); break
      case 'setPresentationOrder':
        if (!Array.isArray(edit.laneIds)) throw new Error('Provide the ordered list of scene IDs.')
        map = validateWorkshop({ ...map, presentationOrder: edit.laneIds })
        break
      case 'connect': {
        const next = station(edit.from).station.next
        if (!next.includes(edit.to)) next.push(station(edit.to).id)
        break
      }
      case 'disconnect': {
        const target = station(edit.from).station
        if (!target.next.includes(edit.to)) throw new Error('Unknown connection.')
        target.next = target.next.filter(id => id !== edit.to)
        break
      }
      default: throw new Error('Unknown map edit.')
    }
  }
  return { reply: input.reply.trim(), workshop: validateWorkshop(map) }
}
