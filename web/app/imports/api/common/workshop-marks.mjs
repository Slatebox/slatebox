// A "Moved anyway by Sam · Nov 23" mark (a workshop card's `override`) is written by the server, from who made the
// move and when, never by a page. A board that comes from a page, an AI draft or an imported file starts with none:
// they are taken off before the board is read, so a board the rules would refuse without them is refused too.
export function withoutMoveMarks(board) {
  if (!board || typeof board !== 'object' || !Array.isArray(board.cards) || !board.cards.some(card => card && typeof card === 'object' && 'override' in card)) return board
  return { ...board, cards: board.cards.map(card => {
    if (!card || typeof card !== 'object' || !('override' in card)) return card
    const { override: _mark, ...plain } = card
    return plain
  }) }
}
