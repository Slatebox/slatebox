// The move log (dragology final.md §6 D1b, server only): every save that moves a board's cards
// records which card went from which lane to which, on the slate's event row, with the row's time.
// From it, how long cards wait in each lane ("Cards waited 2.1 days in Review"), the line the
// board's AI reads for a retro. Nothing here reads a card's words: only ids and lanes.

const DAY = 86400000
// The most moves one event row keeps (a whole board added at once is its cards entering).
export const MOVES_PER_SAVE = 64

/** The workshop a save's `set` stores, or undefined when the save leaves the workshop alone. */
export function workshopInSet(set) {
  if (!set || typeof set !== 'object') return undefined
  if ('creative.model.workshop' in set) return set['creative.model.workshop'] ?? null
  if ('creative.model' in set) return set['creative.model']?.kind === 'workshop' ? set['creative.model'].workshop ?? null : null
  if ('creative' in set) return set.creative?.model?.kind === 'workshop' ? set.creative.model.workshop ?? null : null
  return undefined
}

/**
 * The cards that changed lane between two boards: `{ card, from, to }`, where `from` is null for a
 * card that came onto the board and `to` is null for one that left it.
 */
export function workshopMovesBetween(before, after) {
  const was = new Map((before?.cards ?? []).map(card => [card.id, card.laneId]))
  const now = new Map((after?.cards ?? []).map(card => [card.id, card.laneId]))
  const moves = []
  for (const [card, to] of now) if (was.get(card) !== to) moves.push({ card, from: was.get(card) ?? null, to })
  for (const [card, from] of was) if (!now.has(card)) moves.push({ card, from, to: null })
  return moves.slice(0, MOVES_PER_SAVE)
}

/** What the save core adds to a save's event row: its moves, when it moved any card. */
export function moveAnnotation(current, set) {
  const after = workshopInSet(set)
  if (after === undefined) return {}
  const before = current?.creative?.model?.kind === 'workshop' ? current.creative.model.workshop : null
  const moves = workshopMovesBetween(before, after)
  return moves.length ? { moves } : {}
}

/**
 * How long cards waited in each lane, from the move log (`entries`: `{ at, moves }` in the order
 * they were saved). A visit that is still going counts up to `now`. Each lane's average is its
 * waiting time over its visits; `{ laneId, visits, days }`, longest wait first. Only lanes cards
 * have moved on from count: a card in a lane nothing ever leaves is finished, not waiting.
 */
export function timeInLane(entries, now = Date.now()) {
  const since = new Map()
  const lanes = new Map()
  const close = (laneId, from, to) => {
    if (!laneId || !Number.isFinite(from) || to < from) return
    const lane = lanes.get(laneId) ?? { laneId, visits: 0, ms: 0 }
    lane.visits += 1
    lane.ms += to - from
    lanes.set(laneId, lane)
  }
  // A lane no card has ever moved on from to another lane is where cards end (Done, a retro's
  // columns): time there is not waiting, so it is left out.
  const movedOn = new Set()
  for (const { at, moves } of entries) {
    const time = at instanceof Date ? at.getTime() : Number(at)
    if (!Number.isFinite(time) || !Array.isArray(moves)) continue
    for (const { card, to } of moves) {
      const held = since.get(card)
      if (held) {
        close(held.laneId, held.at, time)
        if (to && to !== held.laneId) movedOn.add(held.laneId)
      }
      if (to) since.set(card, { laneId: to, at: time })
      else since.delete(card)
    }
  }
  for (const held of since.values()) close(held.laneId, held.at, now)
  return [...lanes.values()].filter(({ laneId }) => movedOn.has(laneId))
    .map(({ laneId, visits, ms }) => ({ laneId, visits, days: Math.round(ms / visits / DAY * 10) / 10 }))
    .sort((a, b) => b.days - a.days || a.laneId.localeCompare(b.laneId))
}

/** The line the AI reads: "Cards waited 2.1 days in Review, 0.5 days in Doing." Null with nothing worth saying. */
export function waitedLine(summary, board) {
  const named = summary.map(item => ({ ...item, label: board?.lanes?.find(lane => lane.id === item.laneId)?.label }))
    .filter(item => item.label && item.days >= 0.1).slice(0, 3)
  if (!named.length) return null
  const day = days => days + (days === 1 ? ' day' : ' days')
  return 'Cards waited ' + named.map(item => day(item.days) + ' in ' + item.label).join(', ') + '.'
}

/** The slate's move log, oldest first, from its event rows (the last `limit` saves that moved a card). */
export async function readMoveLog(events, slateId, limit = 500) {
  const rows = await events.find({ slateId, moves: { $exists: true } }, { projection: { at: 1, moves: 1, revision: 1 }, sort: { revision: -1 }, limit }).toArray()
  return rows.reverse().map(({ at, moves }) => ({ at, moves }))
}
