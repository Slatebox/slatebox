import { DEFAULT_NOTE_STYLE, workshopCardLookOf } from 'slateboxjs/workshops/model'

// How a workshop's lanes are drawn on the app's canvas: the family, size and corners of the
// note a new slate starts with (createSlate.js), with dark text because lanes keep the
// workshop's own pale fills. Cards are drawn as the slate's own notes (workshopStyle below).
export const workshopNoteStyle = {
  fontFamily: 'Manrope',
  fontSize: 18,
  laneFontSize: 20,
  captionFontSize: 14,
  textColor: '#1d2b2a',
  borderColor: '#c5ccc4',
  borderWidth: 1,
  cornerRadius: 10,
}

const lanePitch = 244

// How many lanes sit side by side on a canvas this wide. One to a row on a phone, so card text
// stays at its full size; on a wider canvas as many as fit at 70% or more. A map keeps its
// stations where its author put them.
export function lanesPerRow(width, workshop) {
  const lanes = workshop.lanes.length
  if (workshop.lanes[0].station) return undefined
  if (width < 600) return 1
  const fit = Math.floor(width / (lanePitch * 0.7))
  return fit >= lanes ? undefined : Math.max(2, fit)
}

// Where the workshop sits on a slate that has not recorded a place for it: to the right of the
// slate's own notes, level with their top, or near the corner of an empty slate. The same rule
// attachWorkshop applies on the canvas.
export function workshopOrigin(options, nodes) {
  const saved = options?.workshopOrigin
  if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return { x: saved.x, y: saved.y }
  const notes = (nodes ?? []).filter(node => Number.isFinite(node?.options?.xPos) && Number.isFinite(node?.options?.yPos))
  if (!notes.length) return { x: 40, y: 40 }
  const right = Math.max(...notes.map(({ options: o }) => o.xPos + (Number(o.width) || 0)))
  const top = Math.min(...notes.map(({ options: o }) => o.yPos))
  return { x: Math.round(right + 80), y: Math.round(top) }
}

// A note's type size as the canvas reads it: a number of pixels, or "14pt" as createSlate stores it.
function pixels(size) {
  if (typeof size === 'number') return size
  const match = /^([\d.]+)\s*(pt|px)?$/.exec(String(size ?? '').trim())
  if (!match) return undefined
  return Math.round(Number(match[1]) * (match[2] === 'pt' ? 4 / 3 : 1))
}

// What a card looks like on this slate: the slate's own first note with words on it (the note a
// new slate starts with, say), so a card and a note side by side are the same kind of thing. A
// slate with no notes yet draws its cards as the canvas draws a note made there by a double-click.
// Accepts stored notes (xPos, foregroundColor, vectorPath) and live ones (x, fontColor, shape).
export function workshopCardLook(nodes) {
  const note = (nodes ?? []).map(node => node?.options ?? {}).find(o => String(o.text ?? '').trim() && !o.isComment && !o.image)
  if (!note) {
    const plain = DEFAULT_NOTE_STYLE
    // At the app's reading size, so a card on a phone stays readable at 100%.
    return { backgroundColor: plain.backgroundColor, textColor: plain.fontColor, fontFamily: plain.fontFamily, fontSize: workshopNoteStyle.fontSize,
      borderColor: plain.borderColor, borderWidth: plain.borderWidth, cornerRadius: 0 }
  }
  const rounded = [note.vectorPath, note.shape, note.shapeHint].some(value => /rounded/i.test(String(value ?? '')))
  const look = workshopCardLookOf({
    backgroundColor: note.backgroundColor, textColor: note.fontColor ?? note.foregroundColor, fontFamily: note.fontFamily,
    fontSize: pixels(note.fontSize), borderColor: note.borderColor, borderWidth: note.borderWidth,
  })
  return look || rounded ? { ...look, cornerRadius: rounded ? workshopNoteStyle.cornerRadius : 0 } : undefined
}

// The style a workshop is drawn in on a slate holding `nodes`: the lanes in the app's lane style,
// the cards as the slate's own notes.
export function workshopStyle(nodes) {
  const card = workshopCardLook(nodes)
  return card ? { ...workshopNoteStyle, card } : workshopNoteStyle
}
