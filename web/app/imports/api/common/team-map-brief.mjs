import { createWorkshopMap, encodeWorkshopFragment, validateWorkshop } from 'slateboxjs/workshops/model'
import { mapFromQuestion, proposeDirectMapEdit } from './map-direct-edits.mjs'

// A brief is saved as authored words on a station. Only explicitly connected
// steps create a route; prose alone never infers a team's approval policy.
export function readTeamMapBrief(hash) {
  if (!hash) return { fragment: encodeWorkshopFragment(createWorkshopMap()), brief: '' }
  if (!hash.startsWith('#') || hash.length > 2048) throw new Error('Invalid team brief.')
  const params = [...new URLSearchParams(hash.slice(1))]
  const brief = params[0]?.[1]?.trim()
  if (params.length !== 1 || params[0][0] !== 'brief') {
    throw new Error('Use 1–160 characters of plain text for the brief.')
  }
  return { fragment: encodeWorkshopFragment(workshopFromTeamBrief(brief)), brief }
}

export function workshopFromTeamBrief(input) {
  const brief = typeof input === 'string' ? input.trim() : ''
  if (!brief || brief.length > 160 || /[<>\u0000-\u001f\u007f]/u.test(brief)) throw new Error('Use 1–160 characters of plain text for the brief.')
  const starter = createWorkshopMap()
  let board
  if (brief.includes('→')) {
    try { board = proposeDirectMapEdit(starter, brief).workshop } catch {
      // Arrows in a question or a repeated step are still valid authored words.
    }
  }
  if (!board) return mapFromQuestion(brief)
  board.cards[0].label = 'Team'
  board.lanes[0].station.outcome = brief
  return validateWorkshop(board)
}
