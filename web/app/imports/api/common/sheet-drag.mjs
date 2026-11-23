// Below 1000px wide, Ask Slatebox sits under the canvas and, on a phone, covers half of it. A note or a
// card carried on the canvas minimises it to the bar under the canvas, so the drop has the room
// (fix/phone-sheet-canvas). Let go where the sheet won't cover it, the sheet comes back; let go in the
// sheet's room, it stays down so the note is seen where it landed, and the bar's "Ask Slatebox" brings it
// back with what it held. Never while a proposal waits for Keep or Discard (the board refuses moves then).

// A board's own parts (its steps, lanes, captions) and its grips are not carried: a step pressed is a pan,
// and a grip is edited where it is (a map in focus, a plan's length).
const boardParts = /^(column|lane|caption|handle)-/
export const carried = (id) => Boolean(id) && !boardParts.test(id)

// Past this a press is a drag, not a tap that wobbled.
export const DRAG_START = 8
// A note let go reaches about this far below the pointer.
export const NOTE_REACH = 48

/** Whether the sheet comes back after a note is let go at `at`: only when the note stays in sight above it. */
export const sheetBackAfterDrop = (at, sheetTop) =>
  Number.isFinite(sheetTop) && Number.isFinite(at?.y) && at.y + NOTE_REACH <= sheetTop

/**
 * Calls `onCarry` once each time a note or card is pressed on `root` and moved past `threshold` px by the
 * same pointer, and then `onDrop({ x, y })` where it is let go (a cancelled pointer drops nothing). Listens
 * in the capture phase, ahead of the engine's own handlers; `moves` hears the pointer anywhere on the page
 * (the document). Returns the function that stops listening.
 */
export function watchNoteDrag(root, onCarry, { moves = root, threshold = DRAG_START, onDrop = null } = {}) {
  const capture = { capture: true }
  let start = null
  let carrying = null
  const down = (event) => {
    start = null
    carrying = null
    if (event.isPrimary === false || (event.button ?? 0) !== 0) return
    const id = event.target?.closest?.('[data-node-id]')?.getAttribute('data-node-id')
    if (carried(id)) start = { x: event.clientX, y: event.clientY, pointer: event.pointerId }
  }
  const move = (event) => {
    if (!start || event.pointerId !== start.pointer) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < threshold) return
    carrying = start.pointer
    start = null
    onCarry()
  }
  const up = (event) => {
    const dropped = carrying !== null && event.pointerId === carrying
    start = null
    carrying = null
    if (dropped) onDrop?.({ x: event.clientX, y: event.clientY })
  }
  const cancel = () => { start = null; carrying = null }
  root.addEventListener('pointerdown', down, capture)
  moves.addEventListener('pointermove', move, capture)
  moves.addEventListener('pointerup', up, capture)
  moves.addEventListener('pointercancel', cancel, capture)
  return () => {
    root.removeEventListener('pointerdown', down, capture)
    moves.removeEventListener('pointermove', move, capture)
    moves.removeEventListener('pointerup', up, capture)
    moves.removeEventListener('pointercancel', cancel, capture)
  }
}
