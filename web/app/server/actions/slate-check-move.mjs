import { defineAction } from './registry.mjs'
import { loadSlate } from './slate-access.mjs'
import { problem } from './errors.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { rulebook } from 'slateboxjs/workshops/model'
import { checkNestMove } from 'slateboxjs/workshops/rules'
import 'slateboxjs/workshops/behaviour'
import { boardIdInput } from './slate-schemas.mjs'
import { chooseBoard, slateAsBoard } from '../../imports/api/common/slate-boards.mjs'

const refInput = { type: 'string', minLength: 1, maxLength: 200, description: 'An id, or what a person calls it.' }

// check_move (dragology final.md §4.2): whether a card may move to a lane on a slate's board (on a nested
// board: under another card, or to the top of an area), read-only, with the verdict a drag gets: ok (and any
// warning), or the one rule that refuses it, who set it, and the nearest lane (or card) it may go to instead.
export function checkMove(stored, input) {
  // Which board (boardId; the only one when the slate holds one): a slate of several asks to be told.
  let slate = stored
  if (stored?.creative?.model?.kind === 'workshop') {
    try { slate = slateAsBoard(stored, chooseBoard(stored, input.boardId).id) } catch (error) {
      throw problem(error.code === 'board_not_found' ? 404 : 400, error.code, error.message, { details: { boards: error.boards } })
    }
  }
  const workshop = slate?.creative?.model?.kind === 'workshop' ? slate.creative.model.workshop : null
  if (!workshop) throw problem(409, 'not_a_board', 'This slate holds no board.')
  const head = { revision: slate.creative.revision ?? 0, rev: workshop.behaviour?.rev ?? 0 }
  if (workshop.kind === 'nest') {
    if (!input.under && !input.lane) throw problem(400, 'invalid_input', 'Name the card it goes under (under), or the area it goes to (lane).')
    return { ...head, ...checkNestMove(workshop, input.card, input.under ? { under: input.under } : { lane: input.lane }) }
  }
  if (!input.lane) throw problem(400, 'invalid_input', 'Name the lane it goes to.')
  return { ...head, ...rulebook().move(workshop, input.card, input.lane) }
}

export default defineAction({
  id: 'slates.checkMove',
  title: 'Check move',
  description:
    'Whether a card may move to a lane on one of the slate\'s boards (boardId; required on a slate of several boards, 400 board_required lists them), without moving it: the same verdict a drag gets. On a nested board (piles, a tree) the move names the card it goes under instead (under), or the area it goes to (lane). Answers {ok: true, warnings} or {refused: {sentence, ruleId, nearest, set, overridable}}: the one rule that refuses it (ruleId null for the board\'s own kind rule), who set it, the nearest lane (or card) it may go to, and whether the person may agree to move it anyway (overridable: move_workshop_card with override true, held for them to confirm; false only for a hard limit). rev is the rulebook\'s revision. Cards and lanes are named by id or by name.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent'],
  mounts: { http: { method: 'GET', path: '/slates/{shareId}/check-move', operationId: 'checkMove' } },
  input: { type: 'object', properties: { shareId: shareIdInput, boardId: boardIdInput, card: refInput, lane: refInput, under: { ...refInput, description: 'Nested board: the card it goes under (an id, or what a person calls it).' } },
    required: ['shareId', 'card'], additionalProperties: false },
  output: { type: 'object', properties: { revision: { type: 'integer' }, rev: { type: 'integer' }, ok: { type: 'boolean' }, warnings: { type: 'array', items: { type: 'string' } }, refused: { type: 'object' } }, required: ['revision', 'rev'] },
  load: loadSlate(false),
  tool: { name: 'check_board_move', title: 'Check a move on a board', description: 'Check whether a card may move to a lane on a slate\'s board (pipeline, budget, hiring plan and others), without moving it, and why not. On a slate with several boards, name the board.' },
  handler: (_principal, input, { resource: slate }) => checkMove(slate, input),
})
