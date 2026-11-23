import { workshopToSlate } from 'slateboxjs/workshops/model'

/*
 * What a conversation preview draws on the canvas, before anything is kept.
 *
 * The server's draft says what Keep would add: notes and connectors for a drawing (typed steps,
 * pasted lines or an AI draft), or a workshop model (lanes, or an interactive route). This turns
 * it into the notes a page draws as a preview: the same notes in the same places, each under a
 * `preview-` id, outlined as provisional, with a caption that says it is a preview. The page
 * draws them as notes the slate never saves (see useConversationPreview).
 *
 * A connector is stored on the note it starts from, and a saved note must never carry a line to
 * a preview. So every preview connector is held by a preview note: one that starts at a new note
 * is held by it; one that starts at an existing note is held by a see-through preview note laid
 * exactly over that note, so the line still leaves from its edge.
 */

export const PREVIEW_PREFIX = 'preview-'
export const PREVIEW_CAPTION = PREVIEW_PREFIX + 'caption'
export const PREVIEW_CAPTION_TEXT = 'Preview · not kept yet'
const accent = '#2f5fd0'
const provisional = { borderStyle: 'dashed', borderWidth: 2, borderColor: accent, opacity: 0.72 }
const finite = value => (Number.isFinite(Number(value)) ? Number(value) : 0)
const frame = options => ({ x: finite(options.xPos), y: finite(options.yPos), width: finite(options.width), height: finite(options.height) })
const previewId = id => PREVIEW_PREFIX + id

/**
 * What the canvas needs from a server draft (nativeCanvasDraft) to show it: the notes and
 * connectors Keep would add, or the workshop Keep would attach. Plain data, sent with the preview.
 */
export function previewCanvasOf(draft) {
  if (draft.mode === 'play') return { workshop: draft.workshop, ...(draft.origin && { origin: draft.origin }) }
  return { nodes: draft.nodes, links: draft.links ?? [] }
}

/** Where a workshop with no saved place is drawn: past the right of what the slate holds (as attachWorkshop does). */
export function besideExisting(existing) {
  if (!existing.length) return { x: 40, y: 40 }
  let right = -Infinity, top = Infinity
  for (const note of existing) {
    right = Math.max(right, finite(note.x) + finite(note.width))
    top = Math.min(top, finite(note.y))
  }
  return { x: Math.round(right + 80), y: Math.round(top) }
}

/** The box around some frames, or null for none. */
export function boundsOf(frames) {
  if (!frames.length) return null
  const left = Math.min(...frames.map(f => f.x)), top = Math.min(...frames.map(f => f.y))
  const right = Math.max(...frames.map(f => f.x + f.width)), bottom = Math.max(...frames.map(f => f.y + f.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The caption that marks a preview, set just above `bounds` (world units). */
export function previewCaption(bounds) {
  return { options: {
    id: PREVIEW_CAPTION, text: PREVIEW_CAPTION_TEXT, xPos: Math.round(bounds.x), yPos: Math.round(bounds.y - 52),
    width: 216, height: 36, fontSize: 15, foregroundColor: '#ffffff', backgroundColor: accent, borderWidth: 0,
  }, relationships: { associations: [] } }
}

/**
 * The preview artwork for a draft.
 *
 * @param canvas   the draft's `canvas` from nativeCanvas.preview: { nodes, links } or { workshop }
 * @param existing the slate's own notes as { id, x, y, width, height } in world units
 * @param style    the workshop note style, for a workshop draft
 * @returns { notes, links, bounds } where each note is a v1 note and each link is
 *   { holderId, targetId, association } (a v1 association held by a preview note)
 */
export function previewArtwork(canvas, existing = [], style = undefined) {
  const known = new Map(existing.map(note => [note.id, note]))
  let source, outside = []
  if (canvas?.workshop) {
    // A board added beside the slate's other boards is shown where Keep puts it (the server's `origin`).
    const origin = Number.isFinite(canvas.origin?.x) && Number.isFinite(canvas.origin?.y) ? canvas.origin : besideExisting(existing)
    source = workshopToSlate(canvas.workshop, { native: true, origin, style, beside: known.keys() }).nodes
  } else if (Array.isArray(canvas?.nodes)) {
    source = canvas.nodes
    outside = Array.isArray(canvas.links) ? canvas.links : []
  } else throw new Error('This draft has nothing to show on the canvas.')
  const fresh = new Set(source.map(node => node.options.id))
  const notes = source.map(node => ({
    options: { ...node.options, ...provisional, id: previewId(node.options.id) },
    relationships: { associations: [] },
  }))
  const links = []
  // A see-through preview note laid over an existing note, to hold the lines that start there.
  const over = id => {
    const holderId = previewId('over-' + id)
    if (!notes.some(note => note.options.id === holderId)) {
      const target = known.get(id)
      notes.push({ options: { id: holderId, text: '', xPos: finite(target.x), yPos: finite(target.y), width: finite(target.width), height: finite(target.height),
        backgroundColor: 'transparent', opacity: 0, borderWidth: 0 }, relationships: { associations: [] }, overlay: true })
    }
    return holderId
  }
  const add = (parentId, association) => {
    const childId = association.childId
    const targetId = fresh.has(childId) ? previewId(childId) : known.has(childId) ? childId : null
    const holderId = fresh.has(parentId) ? previewId(parentId) : known.has(parentId) ? over(parentId) : null
    if (!targetId || !holderId) return
    links.push({ holderId, targetId, association: { ...association, id: previewId(association.id ?? parentId + '->' + childId), parentId: holderId, childId: targetId } })
  }
  for (const node of source) for (const association of node.relationships?.associations ?? []) add(node.options.id, association)
  for (const { parentId, association } of outside) add(parentId, association)
  for (const link of links) Object.assign(link.association, { lineColor: accent, lineOpacity: 0.85 })
  const drawn = notes.filter(note => !note.overlay).map(note => frame(note.options))
  const bounds = boundsOf(drawn) ?? boundsOf(notes.map(note => frame(note.options)))
  return { notes, links, bounds }
}

/** The smallest scale at which a preview note's text can still be read (1 = 100%). */
export const READABLE_ZOOM = 0.6

/**
 * Where the canvas should look to show a preview (`box`, world units, caption included), given
 * the current `view` ({ x, y, width, height } in world units, `zoom` in screen pixels per unit).
 * Returns the new view box, or null when the preview is already in view.
 *
 * In view already: nothing moves. Just outside it: the shortest pan. Larger than the canvas: zoomed
 * out only as far as it needs, never below READABLE_ZOOM (and never in, for someone already further
 * out). If it still does not fit, the view shows its start, the caption and first steps, and the
 * rest is a pan away.
 */
export function previewView(box, view, { margin = 24, readable = READABLE_ZOOM } = {}) {
  if (!box || !view || !(view.width > 0) || !(view.height > 0) || !(view.zoom > 0)) return null
  const needW = box.width + margin * 2, needH = box.height + margin * 2
  if (needW <= view.width && needH <= view.height) {
    const shift = (start, size, from, extent) => start - margin < from ? start - margin - from
      : start + size + margin > from + extent ? start + size + margin - (from + extent) : 0
    const x = shift(box.x, box.width, view.x, view.width), y = shift(box.y, box.height, view.y, view.height)
    return x || y ? { x: view.x + x, y: view.y + y, width: view.width, height: view.height } : null
  }
  const pxW = view.width * view.zoom, pxH = view.height * view.zoom
  const fit = Math.min(pxW / needW, pxH / needH)
  const zoom = Math.min(view.zoom, Math.max(readable, fit))
  const width = pxW / zoom, height = pxH / zoom
  const x = needW <= width ? box.x + box.width / 2 - width / 2 : box.x - margin
  const y = needH <= height ? box.y + box.height / 2 - height / 2 : box.y - margin
  return { x, y, width, height }
}

/**
 * Which box to bring into view for a preview: `whole` (the preview and its caption), unless it
 * cannot be read whole on this canvas (`view` as for previewView) and `focus`, what the preview
 * changes, is known. `focus` is a box, or boxes from the most to the least context: the first that
 * can be read whole is shown, or else the last. A workshop proposal on a phone, where the lanes are
 * stacked, shows the cards it adds (with their lane's name when that fits) rather than the top of a
 * board too tall to read.
 */
export function previewShown(whole, focus, view, { margin = 24, readable = READABLE_ZOOM } = {}) {
  const choices = (Array.isArray(focus) ? focus : [focus]).filter(Boolean)
  if (!whole || !choices.length || !view || !(view.zoom > 0)) return whole
  const pxW = view.width * view.zoom, pxH = view.height * view.zoom
  const fits = box => {
    const zoom = Math.min(view.zoom, Math.max(readable, Math.min(pxW / (box.width + margin * 2), pxH / (box.height + margin * 2))))
    return (box.width + margin * 2) * zoom <= pxW + 0.5 && (box.height + margin * 2) * zoom <= pxH + 0.5
  }
  return [whole, ...choices].find(fits) ?? choices.at(-1)
}
