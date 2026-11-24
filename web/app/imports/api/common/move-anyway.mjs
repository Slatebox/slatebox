import { workshopOverrideCandidate, workshopRefusal } from 'slateboxjs/workshops/model'
import { said } from './plain-words.mjs'

// Moving a card anyway (owner, 2026-11-23: "dropping the card where it shouldn't go should be possible with a
// confirmation ... standard in the smart components"). A move the board's rules refuse, asked in the chat, is not an
// error: it is a proposal the person confirms ("Move anyway") or cancels, with the rule's sentence. The board it
// shows is the engine's (workshopOverrideCandidate); the server marks who and when as it saves it
// (workshopStampOverrides). A hard limit (the engine's workshopHardLimit) is still refused: null here.

/**
 * The proposal for a refused move made anyway: `{ workshop, reply, override: { cardId, laneId, card, lane, sentence } }`,
 * or null when the move needs no override or is a hard limit.
 */
export function moveAnywayProposal(board, cardId, laneId) {
  const card = board.cards.find(item => item.id === cardId), lane = board.lanes.find(item => item.id === laneId)
  if (!card || !lane) return null
  const workshop = workshopOverrideCandidate(board, cardId, laneId, { by: 'You', at: new Date().toISOString() })
  if (!workshop) return null
  const sentence = workshopRefusal(board, cardId, laneId) ?? 'That move is not available.'
  return {
    workshop,
    reply: moveAnywaySentence(card.label, lane.label, sentence),
    override: { cardId, laneId, card: card.label, lane: lane.label, sentence },
  }
}

/** What the chat says of a move it can make only anyway: the rule it breaks, and the question. */
export function moveAnywaySentence(card, lane, sentence) {
  return said(card) + ' can’t move to ' + said(lane) + ' by this board’s rules. ' + sentence + ' Move it anyway?'
}
