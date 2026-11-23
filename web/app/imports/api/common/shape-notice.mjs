// What the canvas says when a shaped note becomes a board's card, and when it leaves the board
// again (boards S1, owner 2026-11-22): a dropped diamond becomes the board's card shape, and
// dragged off it is a diamond again. The engine keeps the shape on the card (asNote.shape) and
// puts it back on the way out, so the notice is only said where the shape really comes back.

// The everyday names of the slate's shapes (ShapeRegistry). A rectangle and a rounded rectangle
// look the same as a card, so they have none: nothing visible changes, nothing is said.
const names = {
  diamond: 'diamond', rhombus: 'diamond', ellipse: 'oval', oval: 'oval', circle: 'circle', star: 'star', triangle: 'triangle',
  pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon', trapezium: 'trapezium', parallelogram: 'parallelogram',
  rarrow: 'arrow', larrow: 'arrow', arrow: 'arrow', stickynote: 'sticky note',
}
const boxes = new Set(['rectangle', 'roundedrectangle'])

// What each kind of board calls its cards, and how it draws them. A board of plain lanes (and a
// nested board) draws boxes, rounded when the slate's notes are.
const kinds = {
  'launch-plan': { one: 'task', drawn: 'tasks on a plan are bars' },
  'hiring-plan': { one: 'hire', drawn: 'hires on a plan are bars' },
  pipeline: { one: 'deal', drawn: 'deals in a pipeline are rows' },
  budget: { one: 'line item', drawn: 'line items in a budget are rows' },
}

/** The everyday name of a slate shape; null for a box (no notice) or a shape with no such name. */
export function shapeName(shape) {
  const key = String(shape ?? '').toLowerCase()
  return boxes.has(key) ? null : names[key] ?? null
}

// Whether a note of this shape looks any different as a card.
const shaped = shape => typeof shape === 'string' && shape.trim() !== '' && !boxes.has(shape.toLowerCase())

const article = word => (/^[aeiou]/i.test(word) ? 'an ' : 'a ') + word

// The card's words in curly quotes, cut to 40 characters; "The note" when it has none.
function named(text) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!words) return 'The note'
  return `‘${words.length > 40 ? `${words.slice(0, 40).trimEnd()}…` : words}’`
}

/**
 * The notice for a change the canvas made (the engine's onChange event, as the hook sends it: a
 * card that became a note carries the note in `cardToNote.note`). `kind` is the board's kind
 * (workshop.kind: a plain lane board has none); `round` says the board draws its cards with
 * rounded corners; `label` is the card's name on the board, for a card that arrived or left (its
 * note's words may say more: "Pick vendor · 2 days"). Null when there is nothing to say: a move, a rename, a box-shaped note, or a
 * trade an undo or redo put back (`via: 'undo'`).
 */
export function shapeNotice(change, { kind, round = false, label } = {}) {
  if (!change || change.via === 'undo') return null
  if (change.noteToCard) {
    const shape = change.noteToCard.asNote?.shape
    if (!shaped(shape)) return null
    const board = kinds[kind] ?? { one: 'card', drawn: `cards on a board are ${round ? 'rounded boxes' : 'boxes'}` }
    const back = shapeName(shape)
    return `${named(label ?? change.noteToCard.label)} is ${article(board.one)} now: ${board.drawn}. Drag it off to get its ${back ?? 'shape'} back.`
  }
  if (change.cardToNote) {
    const note = change.cardToNote.note?.options
    // A saved note names its shape as the slate draws it (shape) and as older readers do (shapeHint).
    const shape = note?.shape ?? note?.shapeHint
    if (!shaped(shape)) return null
    const back = shapeName(shape)
    const name = named(label ?? note.text)
    return back ? `${name} is ${article(back)} again.` : `${name} has its shape back.`
  }
  return null
}

/** The board's own rule notice with the shape sentences of the same drop joined to it: one message, not two. */
export function withShapeNotice(text, sentences) {
  return [text, ...(sentences ?? [])].filter(Boolean).join(' ')
}
