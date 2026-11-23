// Adding a library component to a slate (library final.md §2.8, phase 2): one door for the chat's
// Keep (nativeCanvas.keep), exec and agents (slates.applyOperations add_component). Pure: what
// the slate stores and where the board sits. The server saves it; the page draws it live.
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { catalogEntry, catalogFits, catalogPreset } from 'slateboxjs/catalog'
import { besideExisting } from './conversation-preview.mjs'
import { MAIN_BOARD, besideBoards, boardBoxes, furtherBoardSet, mainOriginSet, nextBoardId, slateBoards } from './slate-boards.mjs'
// Server only (the chat's Keep and exec): the room a board keeps needs the business boards' kits.
import { boardRoom } from '../../../server/board-room.mjs'

const finite = value => (Number.isFinite(Number(value)) ? Number(value) : null)

/** The slate's own notes as frames (world units): every note with a place and a size. */
export function noteFrames(nodes = []) {
  const frames = []
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const o = node?.options ?? {}
    const x = finite(o.xPos), y = finite(o.yPos)
    if (x === null || y === null) continue
    frames.push({ x, y, width: Math.max(0, finite(o.width) ?? 0), height: Math.max(0, finite(o.height) ?? 0) })
  }
  return frames
}

/**
 * Where a component's board sits on a slate: past the right of everything the slate holds, level
 * with its top, so it covers no note (the same place a preview shows it). On a slate that already
 * holds a board, past every note and every board's room (`room`: the room a board keeps, see
 * board-room.mjs), 160 to the right of the rightmost, on the first board's row (slate-boards.mjs).
 */
export function componentPlace(nodes = [], slate = null, room = boardRoom) {
  const boards = slate ? slateBoards(slate) : []
  if (!boards.length) return besideExisting(noteFrames(nodes))
  return besideBoards(noteFrames(nodes), boardBoxes(slate, room))
}

/** Whether a box overlaps any of the frames (used by the tests and the e2e proof). */
export function overlapsAny(box, frames) {
  return frames.some(f => box.x < f.x + f.width && f.x < box.x + box.width && box.y < f.y + f.height && f.y < box.y + box.height)
}

/** A component request as exec sends it: `{ component, topic? }`, checked. Throws an Error with `code`. */
export function readComponentRequest(input) {
  const fail = (message) => Object.assign(new Error(message), { code: 'invalid_component' })
  if (!input || typeof input !== 'object') throw fail('Name the component to add.')
  const { component, topic } = input
  if (typeof component !== 'string' || !catalogEntry(component)) throw fail('There is nothing called ' + String(component).slice(0, 60) + ' in the library. components.list names what can be added.')
  if (topic !== undefined && (typeof topic !== 'string' || !topic.trim() || topic.length > 100 || /[<>\x00-\x1f]/.test(topic))) throw fail('A topic is up to 100 characters of plain text.')
  return { component, ...(topic !== undefined && { topic: topic.replace(/\s+/g, ' ').trim() }) }
}

/**
 * What adding `component` to `slate` stores: `{ workshop, origin, boardId, set }`, or `{ refused: reason }`
 * when the slate holds the most boards one slate holds (8 for now: the honest sentence). A slate's first
 * board is its board "main" (creative); each further one is boards.<id> beside the others (slate-boards.mjs).
 * Read the slate as it stands at the write: the place and the id are computed again there. `samples` are the
 * business boards' samples (slateboxjs/workshops/samples).
 */
export function componentAddition(slate, { component, topic }, samples = {}, room = boardRoom) {
  const held = slateBoards(slate).length
  // A slate of another creative kind (not a workshop) holds no board, and takes none.
  if (slate?.creative && !held) return { refused: 'This slate can’t hold a board.' }
  const fits = catalogFits(component, { hasBoard: held > 0, many: true, boards: held })
  if (!fits.ok) return { refused: fits.reason }
  const workshop = validateWorkshop(catalogPreset(component, topic, samples))
  return { workshop, ...componentPlacing(slate, workshop, room) }
}

/** Where a board goes on `slate` as it stands, its id there, and the fields that store it. */
export function componentPlacing(slate, workshop, room = boardRoom) {
  const origin = componentPlace(slate?.nodes, slate, room)
  if (!slateBoards(slate).length) return { origin, boardId: MAIN_BOARD, set: componentSet(workshop, origin) }
  const boardId = nextBoardId(slate)
  return { origin, boardId, set: { nativeCanvasDrawing: true, ...mainOriginSet(slate), ...furtherBoardSet(slate, boardId, workshop, origin) } }
}

/** Whether a slate's name is one nobody gave it: none, or the name a new slate starts with. */
export const untitledSlateName = name => typeof name !== 'string' || !name.trim() || /^untitled( slate)?$/i.test(name.trim())

/**
 * A board added to a slate nobody has named names the slate (a hiring plan kept from Ask Slatebox onto an
 * untitled slate is "Hiring plan" in My slates, not "Untitled slate"). A name the person gave stays.
 * The field to set, or none.
 */
export function boardNamesSlate(slate, workshop) {
  const title = typeof workshop?.title === 'string' ? workshop.title.replace(/\s+/g, ' ').trim().slice(0, 100) : ''
  return title && untitledSlateName(slate?.options?.name) ? { 'options.name': title } : {}
}

/** The fields a slate gains with its first board at `origin` (its drawing keeps its notes beside it). */
export function componentSet(workshop, origin) {
  return {
    nativeCanvasDrawing: true,
    creative: { revision: 0, model: { version: 1, kind: 'workshop', workshop } },
    'options.workshopOrigin': { x: origin.x, y: origin.y },
  }
}
