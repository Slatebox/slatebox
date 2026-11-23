// The review panel's refine chat, as data: what history goes with the next question, and whether an
// answer proposes a change (a diff card with Keep) or is a reply only. Pure.
import { LIBRARY_LIMITS } from '../../../../api/common/library-model.mjs'

/** The turns sent as history: the last six questions and replies, as { role, text }. */
export function refineHistory(turns = []) {
  return turns
    .filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string' && turn.text.trim() && turn.state !== 'error')
    .slice(-LIBRARY_LIMITS.history)
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 2000) }))
}

/** Whether an answer of library.review.refine proposes a change to keep (details or board edits). */
export function proposalChanges(answer) {
  const proposal = answer?.proposal
  return Boolean(proposal && (Object.keys(proposal.meta || {}).length || (proposal.edits || []).length))
}
