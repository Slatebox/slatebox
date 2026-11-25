// A style worn by the slate itself. The slate IS the presentation: everything a style adds (the
// canvas background, the notes' outlines, fills, fonts and colors, the lines, and the style's art:
// title cards, kickers, numbers, quotes, bolts, bursts, ribbons, stars, grids, captions) is
// written onto the slate as real slate fields and real notes, visible and editable on the canvas.
// Present then only frames, flies, dims and reveals those notes (deck version 5: steps of a box,
// what is lit and what each step reveals), and draws nothing of its own.
//
// wearStyle(slateJSON, styleRef, { direction }) → { slate, deck }: the styled slate (a new JSON
// object, never the one given) and the deck that plays it. Pure and deterministic: the browser
// (Wear this style), the server (agents, the showcase seed) and the site's player share it, so
// the same slate wears the same style the same way everywhere.
import * as shapes from 'slateboxjs/shapes'
import { composeDeck, engineTextHeight, fitNoteFont, frameBox, localDirection, normalizeDirection, showsOn } from './presentationCompose.mjs'
import { PRESENTATION_STYLES_MARKER, STYLES, cleanStyleRef, resolveStyle } from './presentationStyles.mjs'
import { layoutOfNodes } from '../../../api/common/slate-layout-core.mjs'

/** The version of the deck a worn style plays: steps over the slate's own notes. */
export const BAKED_DECK_VERSION = 5
/** The styles' version the bake used (presentationStyles' marker). */
export const STYLES_VERSION = Number(PRESENTATION_STYLES_MARKER.replace(/^\D+/, '')) || 4

/** What part each note a style adds plays (options.styleRole), from the composer's kinds. */
const ROLE_OF = {
  image: 'image', scrim: 'backdrop', highlight: 'backdrop', polaroid: 'backdrop', title: 'title', subtitle: 'subtitle',
  kicker: 'kicker', caption: 'caption', headline: 'headline', heading: 'headline', number: 'number', bar: 'underline',
  rule: 'underline', underline: 'underline', label: 'label', 'fine-print': 'label', 'quote-marks': 'quoteMark',
  quote: 'quote', attribution: 'attribution', bubble: 'bubble', brace: 'brace', sticker: 'sticker', bolt: 'decor',
  tape: 'decor', ribbon: 'ribbon', route: 'route', cta: 'cta', deco: 'decor',
}
export const STYLE_ROLES = Object.freeze([...new Set(Object.values(ROLE_OF))])
/** Roles that only decorate: locked (unlock to edit), drawn behind, taken away when the style changes. */
export const DECOR_ROLES = Object.freeze(['decor', 'backdrop', 'underline', 'quoteMark', 'brace', 'route', 'ribbon'])
const DECOR = new Set(DECOR_ROLES)

// The composer's bookkeeping, never stored on a note.
// A searched picture's credit is the deck's (the player names it where the picture shows), never a note option.
const STAGE_ONLY = new Set(['kind', 'steps', 'p', 'deco', 'detail', 'behind', 'why', 'art', 'w', 'h', 'caption', 'x', 'y', 'credit'])

const clone = (value) => JSON.parse(JSON.stringify(value))
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const parse = (slateJSON) => (typeof slateJSON === 'string' ? JSON.parse(slateJSON) : clone(slateJSON || {}))

/** Whether a note was added by a style (any role). */
export const isStyleArt = (node) => typeof node?.options?.styleRole === 'string' && node.options.styleRole !== ''
/** Whether the slate wears a style (its record). */
export const wornStyle = (slateJSON) => {
  const doc = typeof slateJSON === 'string' ? JSON.parse(slateJSON) : slateJSON
  const style = doc?.options?.style
  return style && typeof style === 'object' && typeof style.id === 'string' ? style : null
}

/** The record a slate keeps of the style it wears. */
export function styleRecord(styleRef) {
  const ref = cleanStyleRef(styleRef)
  return { id: ref.id, ...(ref.overrides ? { overrides: ref.overrides } : {}), v: STYLES_VERSION }
}

const angleOf = (rotate) => Number(typeof rotate === 'object' && rotate ? rotate.rotationAngle : rotate) || 0
/**
 * A note back at the size and turn it had before a style grew or tilted it (options.styleBase),
 * around its centre as it is now (so a note moved since stays where it was put). A note resized or
 * turned by hand since keeps what it was given.
 */
function unworn(options) {
  const base = options.styleBase
  const out = { ...options }
  delete out.styleBase
  if (!base || typeof base !== 'object') return out
  const w = num(options.width)
  const h = num(options.height)
  const same = Math.abs(w - num(base.worn?.width)) < 0.5 && Math.abs(h - num(base.worn?.height)) < 0.5 && Math.abs(angleOf(options.rotate) - num(base.worn?.angle)) < 0.01
  if (!same) return out
  const cx = num(options.xPos ?? options.x) + w / 2
  const cy = num(options.yPos ?? options.y) + h / 2
  out.width = num(base.width) || w
  out.height = num(base.height) || h
  out.xPos = cx - out.width / 2
  out.yPos = cy - out.height / 2
  if (base.rotate) out.rotate = base.rotate
  else delete out.rotate
  return out
}

/**
 * The slate with its style taken off: the style's art (every note with a styleRole) removed and
 * the record cleared. The notes keep their colors, fonts and outlines (what they wear is theirs
 * now), at the size and turn they had before the style grew or tilted them.
 */
export function takeOffStyle(slateJSON) {
  const doc = parse(slateJSON)
  doc.nodes = (doc.nodes || []).filter((node) => !isStyleArt(node)).map((node) => ({ ...node, options: unworn(node.options || {}) }))
  if (doc.options) delete doc.options.style
  return doc
}

// The slate's notes' boxes, by id, in canvas units.
function boxesOf(doc) {
  const out = new Map()
  for (const node of doc.nodes || []) {
    const o = node?.options || {}
    if (o.id == null) continue
    out.set(String(o.id), { x: num(o.xPos ?? o.x), y: num(o.yPos ?? o.y), width: num(o.width), height: num(o.height) })
  }
  return out
}
const union = (boxes) => {
  const valid = boxes.filter((b) => b && (b.width > 0 || b.height > 0))
  if (!valid.length) return null
  const x0 = Math.min(...valid.map((b) => b.x))
  const y0 = Math.min(...valid.map((b) => b.y))
  const x1 = Math.max(...valid.map((b) => b.x + b.width))
  const y1 = Math.max(...valid.map((b) => b.y + b.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

// The skin of one slate note written onto its stored options (same note, same id, same words).
function skinNote(options, look, origin) {
  const out = { ...options }
  if (look.vectorPath) {
    delete out.shapeHint
  }
  if (look.shape && !look.vectorPath) delete out.vectorPath
  delete out.backgroundImage
  const { x, y, rotate, ...rest } = look
  Object.assign(out, rest, {
    xPos: x + origin.x,
    yPos: y + origin.y,
    foregroundColor: look.fontColor ?? out.foregroundColor,
  })
  if (look.fontColor) out.fontColor = look.fontColor
  if (rotate) out.rotate = rotate
  if (look.shape === 'custom') out.shapeHint = 'custom'
  else if (look.shape) out.shapeHint = look.shape
  delete out.x
  delete out.y
  // A plain outline grows to fit its words when the engine draws it (a custom one shrinks its text
  // instead): stored that tall now, around its centre, so the canvas and the player draw the same box.
  if (out.shape !== 'custom' && !out.vectorPath && out.text) {
    const inset = out.textInset || {}
    const share = (v) => (Number.isFinite(Number(v)) ? Math.min(0.45, Math.max(0, Number(v))) : 0)
    const round = /circle|ellipse/i.test(String(out.shape || out.shapeHint || '')) ? 0.82 : 1
    const width = num(out.width) * round * (1 - share(inset.left) - share(inset.right))
    const need = engineTextHeight(out.text, Number(out.fontSize) || 14, width, out.fontFamily, out.fontWeight)
    if (need > num(out.height)) {
      out.yPos = num(out.yPos) - (need - num(out.height)) / 2
      out.height = need
    }
  }
  // What the note was before the style grew or turned it, so wearing another style (or taking it
  // off) starts from the note itself, never from the last style's growth.
  if (num(out.width) !== num(options.width) || num(out.height) !== num(options.height) || angleOf(out.rotate) !== angleOf(options.rotate)) {
    out.styleBase = {
      width: num(options.width), height: num(options.height), rotate: options.rotate ?? null,
      worn: { width: num(out.width), height: num(out.height), angle: angleOf(out.rotate) },
    }
  }
  return out
}

// A stage note of the composer as a real note on the slate.
function artNote(note, origin) {
  const role = ROLE_OF[note.kind] || (note.deco ? 'decor' : 'label')
  const options = { text: '', borderWidth: 0 }
  Object.entries(note).forEach(([key, value]) => { if (!STAGE_ONLY.has(key)) options[key] = value })
  Object.assign(options, {
    id: note.id,
    xPos: note.x + origin.x,
    yPos: note.y + origin.y,
    width: note.w,
    height: note.h,
    styleRole: role,
  })
  if (note.image) Object.assign(options, { imageOrigWidth: note.w, imageOrigHeight: note.h, imageFit: note.imageFit || 'cover' })
  if (options.shape === 'custom') options.shapeHint = 'custom'
  else if (options.shape) options.shapeHint = options.shape
  if (DECOR.has(role)) options.isLocked = true
  return { options, relationships: { associations: [] } }
}

/**
 * The slate wearing `styleRef`. With a `direction` (a deck's art direction: title, steps, words),
 * the deck's art is laid out on the slate once, clear of every note (no two steps' notes on top
 * of each other), and the deck that plays it comes back. Without one, Slatebox's own direction for
 * the slate is used (the one Present makes without the agent).
 * → { slate, deck } where deck is { version: 5, style, steps: [{ layout, box, lit, own, hide,
 *   decor, dim, deep, camera, reveal, duration, kicker, narrative }] }.
 */
export function wearStyle(slateJSON, styleRef, { direction = null, name = '', ambient = false } = {}) {
  const doc = takeOffStyle(slateJSON)
  doc.options = { ...(doc.options || {}) }
  const title = name || doc.options.name || ''
  const { layout, origin } = layoutOfNodes(doc.nodes || [])
  if (!layout.nodes.length) throw new Error('The slate has no notes to wear a style on.')
  const ref = cleanStyleRef(styleRef || direction?.style)
  const dir = direction?.steps ? normalizeDirection({ ...direction, style: ref }, layout, { name: title }) : localDirection(layout, { name: title, style: ref.id })
  const composed = composeDeck(layout, { ...dir, style: ref }, { style: ref, bake: true })
  const style = resolveStyle(ref)

  // 1. The slate's own notes in the style (same ids, same words; outlines, fills, fonts, places).
  const nodes = (doc.nodes || []).map((node) => {
    const id = String(node?.options?.id ?? '')
    const look = composed.skin[id]
    const associations = (node.relationships?.associations || []).map((assoc) => ({ ...assoc, ...(composed.lines[`${assoc.parentId}->${assoc.childId}`] || {}) }))
    return { ...node, options: look ? skinNote(node.options, look, origin) : { ...node.options }, relationships: { ...(node.relationships || {}), associations } }
  })
  // 2. The style's art as real notes: decoration and backdrops behind the slate, the rest on top.
  // Worn without a presentation (`ambient`, from the slate's settings) only the style's ambient
  // decoration comes: no title card or caption is invented for words nobody wrote.
  const art = composed.stageNotes.filter((note) => !ambient || note.deco).map((note) => ({ note, node: artNote(note, origin) }))
  const behind = art.filter(({ note }) => note.behind || note.deco).map(({ node }) => node)
  const front = art.filter(({ note }) => !(note.behind || note.deco)).map(({ node }) => node)
  doc.nodes = [...behind, ...nodes, ...front]
  // 3. The canvas background and the record of what the slate wears.
  const cs = { ...(doc.options.containerStyle || {}), backgroundColor: style.bg, backgroundColorAsGradient: false }
  delete cs.backgroundImage
  delete cs.backgroundEffect
  doc.options.containerStyle = cs
  doc.options.style = styleRecord(ref)
  doc.options.defaultLineColor = composed.lines[Object.keys(composed.lines)[0]]?.lineColor || doc.options.defaultLineColor

  // 4. The deck: a box per step, in canvas units, and what each step lights and reveals.
  const shift = (box) => (box ? { x: box.x + origin.x, y: box.y + origin.y, width: box.width, height: box.height } : null)
  if (ambient) return { slate: doc, direction: null, deck: null }
  const decorIds = composed.stageNotes.filter((note) => note.deco).map((note) => note.id)
  const credits = new Map(composed.stageNotes.filter((note) => note.credit).map((note) => [note.id, note.credit]))
  const steps = composed.steps.map((step, index) => {
    const own = composed.stageNotes.filter((note) => Array.isArray(note.steps) && note.steps.includes(index) && note.steps.length === 1).map((note) => note.id)
    const hide = composed.stageNotes.filter((note) => !note.deco && !showsOn(note, index)).map((note) => note.id)
    const pictures = [...new Set(composed.stageNotes.filter((note) => credits.has(note.id) && showsOn(note, index)).map((note) => credits.get(note.id)))]
    return {
      layout: step.layout,
      box: shift(frameBox(composed, step)),
      lit: step.lit === 'all' ? 'all' : [...new Set(step.lit)],
      own,
      hide,
      ...(step.dim !== undefined ? { dim: step.dim } : {}),
      ...(step.deep ? { deep: true } : {}),
      camera: { fill: step.camera.fill ?? 0.86, roll: step.camera.roll || 0, ...(step.camera.cover ? { cover: true } : {}), ...(step.camera.deep ? { deep: true } : {}), ...(step.camera.via ? { via: step.camera.via } : {}) },
      reveal: step.reveal,
      duration: step.duration,
      kicker: step.kicker || '',
      narrative: step.narrative || '',
      nodeIds: step.nodeIds,
      ...(pictures.length ? { credits: pictures } : {}),
    }
  })
  return {
    slate: doc,
    direction: { ...dir, style: ref },
    deck: { version: BAKED_DECK_VERSION, style: styleRecord(ref), decor: decorIds, steps },
  }
}

/**
 * The deck for a slate that wears no style (or a deck saved before styles were worn): the camera
 * over the slate's own notes, nothing added. Each step frames its notes and lights them.
 * `viewpoints` are the saved steps ({ nodeIds, narrative, duration }).
 */
export function cameraDeck(slateJSON, viewpoints = []) {
  const doc = parse(slateJSON)
  const boxes = boxesOf(doc)
  const all = [...boxes.keys()]
  const whole = union(all.map((id) => boxes.get(id)))
  // One step per saved step (the presenter counts them), each framing what it names on the slate
  // as it is now; a step whose notes are all gone frames the whole slate.
  const steps = (Array.isArray(viewpoints) ? viewpoints : []).filter((point) => point && typeof point === 'object').map((point) => {
    const ids = [point.nodeIds ?? []].flat().map(String).filter((id) => boxes.has(id))
    const box = union(ids.map((id) => boxes.get(id))) || whole
    return box ? { layout: point.layout || 'group', box, lit: ids.length ? ids : 'all', own: [], hide: [], camera: { fill: 0.86, roll: 0 }, reveal: 'fade', duration: point.duration || 3200, kicker: point.kicker || '', narrative: point.narrative || point.caption || '', nodeIds: ids } : null
  }).filter(Boolean)
  if (!steps.length && whole) steps.push({ layout: 'overview', box: whole, lit: 'all', own: [], hide: [], camera: { fill: 0.92, roll: 0 }, reveal: 'fade', duration: 3600, kicker: '', narrative: '', nodeIds: all })
  return { version: BAKED_DECK_VERSION, style: wornStyle(doc), decor: [], steps }
}

/** Whether a saved deck plays a worn style (version 5). */
export const isBakedDeck = (deck) => deck?.version === BAKED_DECK_VERSION && Array.isArray(deck.steps)

/**
 * The deck the player plays for a presentation as it is saved: a worn style's deck as is; any
 * older deck as the camera over the slate as drawn (the look it once had was drawn by the player,
 * which never happens now). → deck (version 5) or null.
 */
export function playableDeck({ deck = null, viewpoints = null, slateJSON = null } = {}) {
  if (isBakedDeck(deck)) return deck
  if (!slateJSON) return null
  return cameraDeck(slateJSON, viewpoints || deck?.steps || [])
}

/**
 * Every note's words fitted to its shape in the real faces (`measure`: (text, size, font, weight)
 * → px, from a canvas with the faces loaded): a smaller size where a word would otherwise break,
 * never a larger one. Run where a style is worn in a browser, so the fitted sizes are the slate's
 * own and the canvas and Present draw the same words. Without a way to measure, nothing changes.
 */
export function fitSlateWords(json, measure) {
  if (!measure) return json
  json.nodes.forEach((node) => {
    const size = fitNoteFont(node.options, measure)
    if (size) node.options.fontSize = size
  })
  return json
}

export { STYLES }
