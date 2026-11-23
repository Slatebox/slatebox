// Many boards on one slate (boards S4a, work-multiboard plan §2.4). Pure: how a slate stores its
// boards, and the paths a write takes for one of them. No migration: the slate's first board stays
// where it always was (creative, with options.workshopOrigin) as board "main"; each further board is
// boards.<id> = { revision, model, trades?, undo?, origin, createdAt }, with ids b2, b3, … from a
// counter (boardSeq) that is written in the same guarded write as the board, so two people adding a
// board at once never both get b2, and an id is never used again.
//
// Revisions: every board has its own (creative.revision for main, boards.<id>.revision for the rest),
// which previews, Keep, "Undo last change" and the AI turn check, so a change on one board never
// makes another board's preview stale. A slate of many boards also keeps one counter for all of them
// (boardsRevision): the revision its note and card trades are recorded at, which the canvas's
// collaborators and its autosave read. Both go up in the same write. A slate of one board has no such
// field: its counter is creative.revision, as it always was.

import { workshopOrigin } from './workshop-look.mjs'

export const MAIN_BOARD = 'main'
/** The most boards one slate holds, for now (the engine's maxBoardsPerSlate, owner 2026-11-22). */
export const MAX_BOARDS = 8
export const boardIdPattern = /^[a-z0-9]{1,12}$/

const finite = value => Number.isFinite(value)
const isBoard = record => record?.model?.kind === 'workshop' && Boolean(record.model.workshop)
const order = id => Number(/^b(\d+)$/.exec(id)?.[1] ?? Infinity)

/** The further boards a slate stores (boards.<id>), in the order they were added. */
function further(slate) {
  const stored = slate?.boards && typeof slate.boards === 'object' && !Array.isArray(slate.boards) ? slate.boards : {}
  return Object.entries(stored).filter(([id, record]) => boardIdPattern.test(id) && id !== MAIN_BOARD && isBoard(record))
    .sort(([a], [b]) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Every board on a slate, first board first: `{ id, revision, model, trades, undo, origin }`. A slate
 * with no board answers []. `origin` is where the board sits (world units). The first board's is where
 * the page draws it: options.workshopOrigin, or, when none is stored (a slate made by slates.create and
 * given its board later), beside the slate's notes as workshopOrigin works it out. A further board's
 * origin is null when not recorded.
 */
export function slateBoards(slate) {
  const out = []
  if (isBoard(slate?.creative)) out.push({ ...slate.creative, id: MAIN_BOARD, origin: workshopOrigin(slate.options, slate.nodes) })
  for (const [id, record] of further(slate)) {
    out.push({ ...record, id, origin: finite(record.origin?.x) && finite(record.origin?.y) ? { x: record.origin.x, y: record.origin.y } : null })
  }
  return out
}

/** Whether a slate holds more than its first board. */
export const holdsManyBoards = slate => further(slate).length > 0

/** The paths one board is stored under. */
export function boardPaths(id = MAIN_BOARD) {
  if (id === MAIN_BOARD) return { root: 'creative', model: 'creative.model', workshop: 'creative.model.workshop', kind: 'creative.model.kind',
    revision: 'creative.revision', trades: 'creative.trades', undo: 'creative.undo', origin: 'options.workshopOrigin' }
  if (!boardIdPattern.test(id)) throw new Error('A board id is 1 to 12 lowercase letters and digits.')
  const root = 'boards.' + id
  return { root, model: root + '.model', workshop: root + '.model.workshop', kind: root + '.model.kind', revision: root + '.revision',
    trades: root + '.trades', undo: root + '.undo', origin: root + '.origin' }
}

/**
 * The slate as one of its boards sees it: `creative` is that board's record and options.workshopOrigin
 * its place, so a reader written for a slate of one board reads any board. Null when there is no such board.
 */
export function slateAsBoard(slate, id = MAIN_BOARD) {
  const board = slateBoards(slate).find(item => item.id === id)
  if (!board) return null
  const { id: boardId, origin, ...record } = board
  return { ...slate, creative: record, boardId, options: { ...slate.options, ...(origin && { workshopOrigin: origin }) } }
}

/** What a board is called, for a person choosing one: its title, or what it is. */
export function boardTitle(board) {
  const workshop = board?.model?.workshop
  return String(workshop?.title || 'Board').slice(0, 120)
}

/** A board as a list names it (a refusal, slates.get, the chat's "Which board?"). */
export const boardSummary = board => ({ id: board.id, title: boardTitle(board), kind: board.model.workshop.kind ?? (board.model.workshop.lanes?.[0]?.station ? 'map' : 'lanes') })

/**
 * Which board a request means: `boardId` when it names one, the only board when there is one, and
 * otherwise a refusal (`code: board_required`, with the boards) so a call never edits the first board
 * by accident. `code: board_not_found` for an id the slate does not hold. Throws an Error with `code`
 * and `boards`; answers the board ({ id, … }) when it is clear.
 */
export function chooseBoard(slate, boardId) {
  const boards = slateBoards(slate)
  const fail = (code, message) => Object.assign(new Error(message), { code, boards: boards.map(boardSummary) })
  if (boardId !== undefined && boardId !== null) {
    const found = typeof boardId === 'string' && boards.find(board => board.id === boardId)
    if (!found) throw fail('board_not_found', 'That board is not on this slate. Use a boardId from slates.get (boards).')
    return found
  }
  if (boards.length === 1) return boards[0]
  if (!boards.length) throw fail('not_a_board', 'This slate holds no board.')
  throw fail('board_required', 'This slate holds ' + boards.length + ' boards: name the one to change (boardId): ' +
    boards.map(board => board.id + ' (' + boardTitle(board) + ')').join(', ') + '.')
}

/** The slate's counter for all its boards (see the top of this file). */
export const boardsCounter = slate => slate?.boardsRevision ?? slate?.creative?.revision ?? 0

/**
 * A write to one board raises the slate's counter for all boards too, on a slate of many: the field to
 * set and the condition that fences it (empty on a slate of one board, whose counter is the board's own).
 */
export function counterWrite(slate) {
  if (!holdsManyBoards(slate)) return { set: {}, conditions: {}, next: null }
  return { set: { boardsRevision: boardsCounter(slate) + 1 }, conditions: { boardsRevision: slate.boardsRevision ?? null }, next: boardsCounter(slate) + 1 }
}

/** The id the next board added to the slate takes (b2 for the second board, and never one used before). */
export const nextBoardId = slate => 'b' + (Math.max(1, Number.isSafeInteger(slate?.boardSeq) ? slate.boardSeq : 1,
  ...further(slate).map(([id]) => order(id)).filter(Number.isFinite)) + 1)

/** The gap between two boards side by side, in world units. */
export const BOARD_GAP = 160

/**
 * The room each board on a slate keeps (world units): its place and the widest it can become, as
 * `reserve(workshop)` says (the engine's workshopReserve, with the board's kit for a business board).
 * A board whose place or room can't be read is left out.
 */
export function boardBoxes(slate, reserve) {
  const out = []
  for (const board of slateBoards(slate)) {
    if (!board.origin) continue
    let room
    try { room = reserve(board.model.workshop) } catch { continue }
    if (!finite(room?.width) || !finite(room?.height)) continue
    out.push({ id: board.id, x: board.origin.x, y: board.origin.y, width: room.width, height: room.height })
  }
  return out
}

/**
 * Where a board added to a slate that already holds one goes: to the right of every note and every
 * board's room, BOARD_GAP past the rightmost, level with the first board (on the same row). `frames`
 * are the slate's notes (noteFrames), `boxes` its boards (boardBoxes).
 */
export function besideBoards(frames, boxes) {
  const all = [...frames, ...boxes].filter(box => [box.x, box.y, box.width, box.height].every(finite))
  // Nothing readable on the slate: where a first board goes on an empty slate (workshopOrigin's default).
  if (!all.length) return workshopOrigin(null, [])
  const right = Math.max(...all.map(box => box.x + box.width))
  const row = boxes.find(box => finite(box.y))?.y ?? Math.min(...all.map(box => box.y))
  return { x: Math.round(right + BOARD_GAP), y: Math.round(row) }
}

/**
 * The first board's place, to store with a write that adds a further board when the slate has none
 * stored yet ({} when it has), so the first board stays where it is drawn now even when its notes move.
 */
export function mainOriginSet(slate) {
  const saved = slate?.options?.workshopOrigin
  if (!isBoard(slate?.creative) || (finite(saved?.x) && finite(saved?.y))) return {}
  const origin = workshopOrigin(slate.options, slate.nodes)
  return { 'options.workshopOrigin': { x: origin.x, y: origin.y } }
}

/**
 * The fields a slate gains with a further board (`id`, from nextBoardId) at `origin`: the board, the
 * counter that named it, and the slate's counter for all its boards. Written on the slate as read
 * (the save core fences the write on the slate's revision, so it is computed again on a race).
 */
export function furtherBoardSet(slate, id, workshop, origin, now = Date.now()) {
  return {
    [boardPaths(id).root]: { revision: 0, model: { version: 1, kind: 'workshop', workshop }, origin: { x: origin.x, y: origin.y }, createdAt: now },
    boardSeq: order(id),
    boardsRevision: boardsCounter(slate) + 1,
  }
}

// The live record of one board, as the page draws it: the board's own record (its model, revision and
// trades) and where it sits. The first board's record keeps the slate's share id as its id, as it always
// has; a further board's is `<shareId>:<boardId>`. The slate's counter for all its boards (`through`, the
// revision its trades are settled through) is a record of its own (`<shareId>#through`), so a change to one
// board resends that board and the counter, never every board (plan §2.4).
export function boardRecordId(shareId, boardId) { return boardId === MAIN_BOARD ? shareId : shareId + ':' + boardId }
export const boardsCounterRecordId = shareId => shareId + '#through'
export function boardRecords(state, shareId) {
  const slate = state.slateBase
  if (!slate.creative) return []
  // Another creative kind (not a workshop) is one record, as it has always been.
  if (slate.creative.model?.kind !== 'workshop') return [[shareId, { ...slate.creative, canEdit: state.canEdit, canJoin: state.canJoin }]]
  return [...slateBoards(slate).map(({ id, origin, ...record }) => [boardRecordId(shareId, id),
    { ...record, boardId: id, shareId, origin, canEdit: state.canEdit, canJoin: state.canJoin }]),
  [boardsCounterRecordId(shareId), { shareId, through: boardsCounter(slate) }]]
}

/**
 * The write that stores one board's model (creativeSlates.save and play): fenced on that board's own
 * revision and, on a slate of many boards, on the slate's counter for all of them, which goes up in the
 * same write. Nothing of any other board is touched, so a card moved on Sprint leaves Retro's revision and
 * Undo as they were and a preview pending on Retro stays current (plan §2.4). `slate` is the slate as the
 * board sees it (slateAsBoard), `stored` the slate as stored. The caller adds who may write (shared
 * conditions) and the slate's name.
 */
export function boardSaveWrite(slate, stored, { model, revision, drawing = null, trades = null, undo = null }) {
  const paths = boardPaths(slate.boardId ?? MAIN_BOARD)
  const counter = counterWrite(stored)
  return {
    conditions: { userId: slate.userId, orgId: slate.orgId ?? null, [paths.revision]: revision, ...counter.conditions, ...(drawing && { lastSaved: drawing.lastSaved }) },
    set: { [paths.model]: model, ...((undo || slate.creative?.undo) && { [paths.undo]: undo }), ...(drawing && { nodes: drawing.nodes }), ...counter.set,
      ...(trades && Object.fromEntries(Object.entries(trades).map(([id, trade]) => [paths.trades + '.' + id, trade]))) },
    inc: { [paths.revision]: 1 },
  }
}
