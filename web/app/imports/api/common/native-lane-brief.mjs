import {createLaneWorkshop, validateWorkshop} from 'slateboxjs/workshops/model'
import {proposeLaneEdit} from './lane-conversation.mjs'

const instructions = 'Name two to five lanes, for example “Make a workshop with Ideas and Pilot, limit Pilot to two cards”.'
const quantity = ['zero','one','two','three','four','five','six','seven','eight','nine','ten']

// Parse explicit author-supplied labels and constraints only. Other requests can
// be drafted by the configured provider and must pass the same model validator.
export function workshopFromLaneBrief(text) {
  const match = /^(?:make|create|build|start|add) (?:an? )?(?:interactive )?(?:lane )?workshop (?:with|using) (?:lanes?[: ]+)?(.+?)\s*[.]?$/iu.exec(text.trim())
  if (!match) throw Error(instructions)
  const [laneText,...rules] = match[1].split(/\s*[,;.]\s*(?=limit\s)/iu)
  const labels = laneText.split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+)\s*/iu).map(label=>label.trim())
  if(labels.length<2 || labels.length>5 || labels.some(label=>!label) || new Set(labels.map(label=>label.toLowerCase())).size!==labels.length) throw Error(instructions)
  const board=createLaneWorkshop()
  board.title=labels.join(' · ').slice(0,120)
  board.lanes=labels.map((label,index)=>({id:'lane-'+(index+1),label}))
  return rules.reduce((model,rule)=>{
    const cap=/^limit\s+(.+?)\s+to\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+cards?)?$/iu.exec(rule)
    if(!cap) throw Error(instructions)
    const number=/^\d+$/.test(cap[2])?Number(cap[2]):quantity.indexOf(cap[2].toLowerCase())
    return proposeLaneEdit(model,'Set capacity of '+cap[1]+' to '+number)
  },validateWorkshop(board))
}
