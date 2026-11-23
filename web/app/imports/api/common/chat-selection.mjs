// What is selected on the canvas, as the in-app chat receives it. A workshop's card or lane and a
// line came first; plain notes are { kind: 'notes', ids, count }: "these notes" and "this note"
// are exactly them. The browser sends at most MAX_SELECTED_NOTES ids and how many were selected;
// the server keeps only ids on the slate and gives the model each with its text.
export const MAX_SELECTED_NOTES = 50
const MAX_COUNT = 10000
const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_TEXT = 240

// The browser: the selected notes' ids → the selection the chat sends (null when none).
export function noteSelection(ids) {
  if (!Array.isArray(ids)) return null
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && NOTE_ID.test(id)))]
  if (!unique.length) return null
  return { kind: 'notes', ids: unique.slice(0, MAX_SELECTED_NOTES), count: Math.min(MAX_COUNT, unique.length) }
}

// The server: a selection in one of its checked shapes, or null.
export function validSelection(selection) {
  if (selection === null) return true
  if (!selection || typeof selection !== 'object') return false
  if (selection.kind === 'notes') {
    const { ids, count } = selection
    return Array.isArray(ids) && ids.length >= 1 && ids.length <= MAX_SELECTED_NOTES &&
      ids.every((id) => typeof id === 'string' && NOTE_ID.test(id)) &&
      Number.isInteger(count) && count >= ids.length && count <= MAX_COUNT
  }
  if (!['card', 'lane', 'line'].includes(selection.kind) || typeof selection.label !== 'string' || selection.label.length > 120) return false
  return selection.kind !== 'line' || (typeof selection.id === 'string' && Boolean(selection.id) && selection.id.length <= 200)
}

// The model's view of a notes selection: the selected notes on this slate, by id and text.
// → { kind: 'notes', notes: [{ id, text }], count, notListed? } or null when none is on the slate.
export function selectedNotesContext(board, selection) {
  if (selection?.kind !== 'notes' || !Array.isArray(selection.ids)) return null
  const byId = new Map((board?.nodes || []).map((node) => [node?.options?.id, node]).filter(([id]) => typeof id === 'string'))
  const notes = selection.ids.filter((id) => byId.has(id)).slice(0, MAX_SELECTED_NOTES).map((id) => ({
    id, text: String(byId.get(id).options.text ?? '').replace(/[<>]/g, '').trim().slice(0, MAX_TEXT),
  }))
  if (!notes.length) return null
  // How many were selected, counting those past the cap (ids not on this slate are not counted).
  const dropped = selection.ids.length - notes.length
  const count = Math.max(notes.length, (Number.isInteger(selection.count) ? selection.count : selection.ids.length) - dropped)
  return { kind: 'notes', notes, count, ...(count > notes.length && { notListed: count - notes.length }) }
}
