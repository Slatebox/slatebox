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
//
// A style never loses anything (owner, 2026-11-25). Wearing, switching or removing a style may add
// the style's art and restyle notes, but it never deletes a note that carries content: a note
// somebody made, a note somebody changed (its words, picture, outline, colors, size, place or lock),
// a note with a line. What a style made and nobody touched (its seal, options.styleSeal, and what it
// made, options.styleMade, still hold) is the style's own: the next style restyles it in place where
// it has the same art, and otherwise takes it away (so its words do not pile up over the slate).
// Art somebody changed keeps every change: restyled in place with their words, picture and outline
// where only those changed, else kept as their own note. And the first time a slate wears a style,
// the slate as it was is kept (options.styleOriginal), so "Revert to original" brings it back
// (revertToOriginal).
import * as shapes from 'slateboxjs/shapes'
import { composeDeck, engineTextHeight, fitNoteFont, frameBox, localDirection, normalizeDirection, showsOn } from './presentationCompose.mjs'
import { PRESENTATION_STYLES_MARKER, STYLES, cleanStyleRef, darkText, resolveStyle, textOn } from './presentationStyles.mjs'
import { layoutOfNodes } from '../../../api/common/slate-layout-core.mjs'
import { readBackground, withBackground } from './presentationBackground.mjs'

/** The version of the deck a worn style plays: steps over the slate's own notes. */
export const BAKED_DECK_VERSION = 5
/** The styles' version the bake used (presentationStyles' marker). */
export const STYLES_VERSION = Number(PRESENTATION_STYLES_MARKER.replace(/^\D+/, '')) || 4
/** The version of the original a slate keeps when it first wears a style (options.styleOriginal). */
export const STYLE_ORIGINAL_VERSION = 1

/** What part each note a style adds plays (options.styleRole), from the composer's kinds. */
const ROLE_OF = {
  image: 'image', scrim: 'backdrop', highlight: 'backdrop', polaroid: 'backdrop', title: 'title', subtitle: 'subtitle',
  kicker: 'kicker', caption: 'caption', headline: 'headline', heading: 'headline', number: 'number', bar: 'underline',
  rule: 'underline', underline: 'underline', label: 'label', 'fine-print': 'label', 'quote-marks': 'quoteMark',
  quote: 'quote', attribution: 'attribution', bubble: 'bubble', brace: 'brace', sticker: 'sticker', bolt: 'decor',
  tape: 'decor', ribbon: 'ribbon', route: 'route', cta: 'cta', deco: 'decor',
}
export const STYLE_ROLES = Object.freeze([...new Set(Object.values(ROLE_OF))])
/** Roles that only decorate: locked (unlock to edit) and drawn behind. Untouched, the next style replaces them. */
export const DECOR_ROLES = Object.freeze(['decor', 'backdrop', 'underline', 'quoteMark', 'brace', 'route', 'ribbon'])
const DECOR = new Set(DECOR_ROLES)

// The composer's bookkeeping, never stored on a note.
// A searched picture's credit is the deck's (the player names it where the picture shows), never a note option.
const STAGE_ONLY = new Set(['kind', 'steps', 'p', 'deco', 'detail', 'behind', 'why', 'art', 'w', 'h', 'caption', 'x', 'y', 'credit'])
// What a style's art note is marked with; a note that is no longer the style's loses them all.
const ART_MARKS = ['styleRole', 'styleSeal', 'styleMade']

const clone = (value) => JSON.parse(JSON.stringify(value))
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const parse = (slateJSON) => (typeof slateJSON === 'string' ? JSON.parse(slateJSON) : clone(slateJSON || {}))
const idOf = (node) => (node?.options?.id == null ? '' : String(node.options.id))

/** A note's words as people read them (markup and spacing aside). */
export const wordsOf = (text) => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

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

// FNV-1a over a string, as a short base-36 word: a seal, not a secret.
function hashOf(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}
/**
 * A style art note's seal: its id, role, words, picture and outline as the style made them. A note
 * whose seal no longer matches was changed by somebody (its words, its picture, its outline), and a
 * copy of one has another id, so neither is ever the style's to take away. Where it sits and how
 * big it is are left out: the engine may settle those on load.
 */
export const sealOf = (options = {}) => hashOf(JSON.stringify([
  String(options.id ?? ''), String(options.styleRole ?? ''), wordsOf(options.text),
  typeof options.image === 'string' ? options.image : '', typeof options.vectorPath === 'string' ? options.vectorPath : '',
]))

const low = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value ?? null)
const boxOf = (options) => [num(options.xPos ?? options.x), num(options.yPos ?? options.y), num(options.width), num(options.height)].map((v) => Math.round(v * 10) / 10)
/**
 * What the style made of an art note beyond its seal: its words, picture and outline (as seals, to
 * tell which of them somebody changed), its fill, ink and lock, and its box. A box that wordless art
 * kept within a few units is the one the style made (the engine may round it on load); art with words
 * keeps only its left edge and width (the engine grows it to fit its words).
 */
export function madeOf(options = {}) {
  return {
    w: hashOf(wordsOf(options.text)),
    i: hashOf(typeof options.image === 'string' ? options.image : ''),
    p: hashOf(typeof options.vectorPath === 'string' ? options.vectorPath : ''),
    bg: low(options.backgroundColor),
    fc: low(options.fontColor ?? options.foregroundColor),
    lock: options.isLocked === true,
    box: boxOf(options),
  }
}
const NEAR = 4
/** What somebody changed on a style's art note since the style made it (all false: nothing). */
export function changesOf(options = {}) {
  const made = options.styleMade
  if (!made || typeof made !== 'object') {
    // Art made before styleMade was written: its seal alone says whether it was changed.
    const changed = options.styleSeal !== undefined && options.styleSeal !== sealOf(options)
    return { words: changed, image: changed, path: changed, look: false, unknown: changed }
  }
  const now = madeOf(options)
  const box = Array.isArray(made.box) ? made.box : []
  const worded = Boolean(wordsOf(options.text))
  const moved = box.length === 4 && [0, 1, 2, 3].some((at) => (!worded || at === 0 || at === 2) && Math.abs(now.box[at] - box[at]) > NEAR)
  const recolored = (made.bg !== undefined && now.bg !== made.bg) || (made.fc !== undefined && made.fc !== null && now.fc !== made.fc)
  return {
    words: now.w !== made.w,
    image: now.i !== made.i,
    path: now.p !== made.p,
    look: moved || recolored || now.lock !== Boolean(made.lock),
    unknown: false,
  }
}
/** Whether a note on the slate is the style's own art, exactly as the style made it. */
export const isUntouchedArt = (node) => {
  if (!isStyleArt(node)) return false
  // Art worn before seals were written: only its wordless decoration is the style's.
  if (node.options.styleSeal === undefined) return !wordsOf(node.options.text)
  if (node.options.styleSeal !== sealOf(node.options)) return false
  const change = changesOf(node.options)
  return !change.look
}

// Every note id a line touches (lines are kept on either end's note).
function linkedIds(nodes) {
  const out = new Set()
  for (const node of nodes || []) {
    for (const assoc of node?.relationships?.associations || []) {
      if (assoc?.parentId != null && assoc?.childId != null && String(assoc.parentId) !== String(assoc.childId)) {
        out.add(String(assoc.parentId))
        out.add(String(assoc.childId))
      }
    }
  }
  return out
}

// The ids of the notes the slate had before it first wore a style here (its original; a slate that
// keeps none has worn nothing here, so everything on it is as it came: a library copy's art too).
function originalIds(doc) {
  const original = doc?.options?.styleOriginal
  if (!original || original.v !== STYLE_ORIGINAL_VERSION || !Array.isArray(original.nodes)) return null
  return new Set(original.nodes.map(idOf))
}
/**
 * Whether a style may take an art note away: its own art exactly as it made it (nobody changed its
 * words, picture, outline, colors, size, place or lock), with no line to it, and either wordless
 * or words a style wrote on this slate since its original (a title or caption made from the slate's
 * notes, made again by the next style). Words the slate came with (a library copy's quotes and
 * numbers) are content, whoever drew them.
 */
function mayTake(node, linked, original) {
  if (!isUntouchedArt(node) || linked.has(idOf(node))) return false
  if (!wordsOf(node.options.text)) return true
  return Boolean(original) && !original.has(idOf(node))
}
/**
 * What a style may take away from the slate (mayTake). Everything else on the slate is content
 * and stays; Revert to original still has the slate from before its first style.
 */
export function replaceableArt(slateJSON) {
  const doc = typeof slateJSON === 'string' ? JSON.parse(slateJSON) : slateJSON || {}
  const linked = linkedIds(doc.nodes)
  const original = originalIds(doc)
  return new Set((doc.nodes || []).filter((node) => mayTake(node, linked, original)).map(idOf))
}

/** Whether the slate keeps an original to go back to (options.styleOriginal). */
export const hasStyleOriginal = (slateJSON) => {
  const doc = typeof slateJSON === 'string' ? JSON.parse(slateJSON) : slateJSON
  const original = doc?.options?.styleOriginal
  return Boolean(original && typeof original === 'object' && original.v === STYLE_ORIGINAL_VERSION && Array.isArray(original.nodes))
}

// The slate fields a style changes, and so the ones its original keeps.
const LOOK_OPTIONS = ['containerStyle', 'defaultLineColor', 'style']

/**
 * The slate with its original kept (options.styleOriginal) unless it keeps one already: its notes
 * exactly as they are, the look of the slate (background, line color, the style it wears), and the
 * presentation it plays ({ style, direction, deck }) when the caller knows it. Every change of style
 * goes through here first, so "Revert to original" is always there once a style has been worn.
 */
export function keepOriginal(doc, { presentation = null } = {}) {
  doc.options = { ...(doc.options || {}) }
  if (hasStyleOriginal(doc)) return doc
  const options = {}
  for (const key of LOOK_OPTIONS) if (doc.options[key] !== undefined && doc.options[key] !== null) options[key] = clone(doc.options[key])
  const kept = presentation && typeof presentation === 'object' ? clone({ style: presentation.style ?? null, direction: presentation.direction ?? null, deck: presentation.deck ?? null }) : null
  doc.options.styleOriginal = { v: STYLE_ORIGINAL_VERSION, nodes: clone(doc.nodes || []), options, ...(kept ? { presentation: kept } : {}) }
  return doc
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

// What a note made since the original looked like before any style restyled it (options.styleWas):
// `look`, the note's own value of every option a style changed (null: it had none), and `lines`,
// the same for each line it draws that the original did not have (by lineKeys: the line's own id,
// so two lines between the same notes keep a look each). Written the
// first time a style changes a key and never overwritten by the next style, so it is always the
// note's own look. The original's notes need none (Revert brings them back from the original).
const LOOK_SKIP = new Set(['styleBase', 'styleWas'])
// What a line is, never part of its look: a style never changes it and Revert never writes it.
const LINE_SKIP = new Set(['id', 'parentId', 'childId'])
const lineEnds = (assoc) => `${assoc.parentId}->${assoc.childId}`
const hasLineId = (assoc) => assoc?.id !== undefined && assoc?.id !== null && assoc?.id !== ''
// Each line's key on a note: its own id (the engine keeps lines by it); a line with none, its two
// ends and its place among the note's lines with the same ends and no id.
function lineKeys(associations) {
  const seen = new Map()
  return (associations || []).map((assoc) => {
    if (hasLineId(assoc)) return `id:${assoc.id}`
    const ends = lineEnds(assoc)
    const n = seen.get(ends) || 0
    seen.set(ends, n + 1)
    return `ends:${ends}#${n}`
  })
}
// Which of a note's lines `now` the original's same note (`was`) did not have: a line the original
// had is the same id, or (an original line with no id) the same two ends, each original line once.
// A line restyled since is the same line; a second line between the same notes is a line of its own.
function linesSince(was, now) {
  const ids = new Set((was || []).filter(hasLineId).map((assoc) => String(assoc.id)))
  const loose = new Map()
  for (const assoc of was || []) if (!hasLineId(assoc)) loose.set(lineEnds(assoc), (loose.get(lineEnds(assoc)) || 0) + 1)
  const since = (now || []).map((assoc) => !(hasLineId(assoc) && ids.has(String(assoc.id))))
  ;(now || []).forEach((assoc, at) => {
    const left = loose.get(lineEnds(assoc)) || 0
    if (!since[at] || !left) return
    since[at] = false
    loose.set(lineEnds(assoc), left - 1)
  })
  return since
}
function remembered(was, before = {}, after = {}, skip = LOOK_SKIP) {
  const out = { ...(was && typeof was === 'object' ? was : {}) }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (skip.has(key) || Object.hasOwn(out, key)) continue
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[key] = before[key] === undefined ? null : clone(before[key])
  }
  return out
}
function withLook(target, look, skip = null) {
  const out = { ...target }
  for (const [key, value] of Object.entries(look || {})) {
    if (skip?.has(key)) continue
    if (value === null) delete out[key]
    else out[key] = clone(value)
  }
  return out
}
/**
 * A note made since the original as it was before a style restyled it: its own outline, fill,
 * fonts, colors, place and size again (its words are its own and stay), the record cleared. Its
 * lines made since get their own look back too (`lines`, from styleWas.lines).
 */
function lookBack(node) {
  const was = node.options?.styleWas
  // Its words are its own, newer than any look: never taken back.
  const options = { ...withLook(node.options || {}, was?.look), text: node.options?.text }
  if (options.text === undefined) delete options.text
  delete options.styleWas
  delete options.styleBase
  return { ...node, options, relationships: { ...(node.relationships || {}), associations: linesBack(node.relationships?.associations, was?.lines) } }
}
// Lines with the look they had before a style restyled them (styleWas.lines of the note they are on,
// each by its own key), their ids and ends untouched.
function linesBack(associations, lines) {
  const keys = lineKeys(associations)
  return (associations || []).map((assoc, at) => (lines?.[keys[at]] ? withLook(assoc, lines[keys[at]], LINE_SKIP) : assoc))
}

// A note that is no longer the style's: the style's marks off, unlocked if the style locked it.
function plainOptions(options) {
  const out = { ...options }
  if (DECOR.has(out.styleRole)) delete out.isLocked
  for (const key of ART_MARKS) delete out[key]
  return out
}
// Art kept in another style with no place in it. Untouched (words the slate came with, or art with
// a line), it stays the style's art in the new style's faces and colors, its words, picture, place
// and size its own, and is sealed again as the new style made it. Somebody's (they changed it), it
// stays exactly as they left it, still marked as a style's art (so it is never laid out or restyled
// as one of the slate's notes, and what the style made still shows what they changed): only words
// that would no longer read on the new background (no fill of their own) take the ink that reads.
function keptInStyle(node, style) {
  if (isUntouchedArt(node) && node.options.styleSeal !== undefined) {
    const out = { ...node.options }
    const fill = typeof out.backgroundColor === 'string' && out.backgroundColor !== 'transparent' && !out.image
    if (fill) out.backgroundColor = String(style.palette[0])
    const ink = textOn(fill ? out.backgroundColor : style.bg)
    out.fontColor = ink
    out.foregroundColor = ink
    out.fontFamily = style.fonts?.display || out.fontFamily
    return sealed(out)
  }
  const out = { ...node.options }
  const now = out.fontColor ?? out.foregroundColor
  if (wordsOf(out.text) && drawsOnBackground(out) && !(hex6(now) && darkText(now) !== darkText(style.bg))) {
    out.fontColor = textOn(style.bg)
    out.foregroundColor = out.fontColor
  }
  return out
}

/**
 * The slate with its style removed, nothing lost: the style's untouched wordless decoration taken
 * away and the record cleared. Art that holds words, or that somebody changed, stays as a plain
 * note; the slate's own notes keep their colors, fonts and outlines (what they wear is theirs now),
 * at the size and turn they had before the style grew or tilted them. The original is kept first.
 */
export function takeOffStyle(slateJSON) {
  const doc = keepOriginal(parse(slateJSON))
  const gone = replaceableArt(doc)
  doc.nodes = dropLinesTo((doc.nodes || []).filter((node) => !gone.has(idOf(node))), gone)
    .map((node) => ({ ...node, options: isStyleArt(node) ? plainOptions(node.options) : unworn(node.options || {}) }))
  delete doc.options.style
  return doc
}

/**
 * The slate exactly as it was before it first wore a style (options.styleOriginal): its notes, its
 * background, its line color and the style it wore then (a library copy's original is the slate as
 * copied). Nothing made since is lost: a note added since stays, and so do the words of a note
 * changed since (they are newer than the original's). The original is used up (the slate is that
 * original again). → { slate, presentation } where presentation is the deck look kept with it, or null.
 */
export function revertToOriginal(slateJSON) {
  const doc = parse(slateJSON)
  if (!hasStyleOriginal(doc)) throw new Error('This slate has no original to go back to.')
  const original = clone(doc.options.styleOriginal)
  const ids = new Set(original.nodes.map(idOf))
  const now = new Map((doc.nodes || []).map((node) => [idOf(node), node]))
  // The original's notes as they were, with any words written since and any line drawn since (to
  // a note made since or between two of the original's notes).
  const nodes = original.nodes.map((node) => {
    const current = now.get(idOf(node))
    if (!current) return node
    // Words somebody wrote (a style's own words on art it made since are not theirs).
    const newer = !isUntouchedArt(current) && wordsOf(current.options?.text) && wordsOf(current.options?.text) !== wordsOf(node.options?.text)
    // Each with its own look again (a style restyled it since).
    // Every line the original had (a line restyled since is the same line: linesSince).
    const all = linesBack(current.relationships?.associations, current.options?.styleWas?.lines)
    const since = linesSince(node.relationships?.associations, current.relationships?.associations)
    const lines = all.filter((_, at) => since[at])
    if (!newer && !lines.length) return node
    return {
      ...node,
      options: newer ? { ...node.options, text: current.options.text } : node.options,
      relationships: { ...(node.relationships || {}), associations: [...(node.relationships?.associations || []), ...lines] },
    }
  })
  // Notes made since: kept, all but the art a style added that nobody changed or drew a line to,
  // each in its own look again (outline, fill, fonts, colors, place and size from before a style
  // restyled it, its lines too), with its words.
  const linked = linkedIds(doc.nodes)
  const added = (doc.nodes || []).filter((node) => !ids.has(idOf(node)) && !(isUntouchedArt(node) && !linked.has(idOf(node))))
    .map((node) => (isStyleArt(node) ? { ...node, options: plainOptions(node.options) } : lookBack(node)))
  const kept = new Set([...nodes, ...added].map(idOf))
  doc.nodes = [...nodes, ...added].map((node) => ({
    ...node,
    relationships: { ...(node.relationships || {}), associations: (node.relationships?.associations || []).filter((a) => kept.has(String(a.parentId)) && kept.has(String(a.childId))) },
  }))
  const options = { ...doc.options }
  for (const key of LOOK_OPTIONS) delete options[key]
  delete options.styleOriginal
  doc.options = { ...options, ...original.options }
  return { slate: doc, presentation: original.presentation || null }
}

// Whether a note draws no fill of its own behind its words (they sit on the canvas background).
const NO_FILL = /^(|transparent|none|rgba\([^)]*,\s*0(\.0+)?\s*\))$/i
export const drawsOnBackground = (options = {}) => !options.image && !options.backgroundImage
  && typeof options.backgroundColor === 'string' && NO_FILL.test(options.backgroundColor.trim())
const hex6 = (color) => /^#[0-9a-f]{6}$/i.test(String(color || '').trim())

/**
 * The slate's background set by hand, as part of its style: a color ('#1a2b3c' or { color }), a
 * gradient ({ gradient: { type, colors, angle? } }) or a picture ({ color?, picture: { url, fit,
 * dim } }; its color is laid over it by dim, and defaults to the slate's color now). It is the
 * background the style wears from now on (its record's overrides.bg and overrides.background), so
 * wearing it again keeps it and "Revert to original" takes it back. Words drawn straight on the
 * background (a note with no fill) that would no longer read on it (light on light, dark on dark)
 * take the ink that reads on its color. The original is kept first. Throws a plain sentence for a
 * background that is not safe (presentationBackground.mjs readBackground).
 */
export function setSlateBackground(slateJSON, value) {
  const doc = keepOriginal(parse(slateJSON))
  const { color: bg, background } = readBackground(value, { color: doc.options.containerStyle?.backgroundColor })
  doc.options.containerStyle = withBackground(doc.options.containerStyle, bg, background)
  const ink = textOn(bg)
  doc.nodes = (doc.nodes || []).map((node) => {
    const o = node?.options || {}
    if (!wordsOf(o.text) || !drawsOnBackground(o)) return node
    const now = o.fontColor ?? o.foregroundColor
    if (hex6(now) && darkText(now) !== darkText(bg)) return node
    const untouched = isUntouchedArt(node)
    const options = { ...o, fontColor: ink, foregroundColor: ink }
    // The style's own art, re-inked by the style: still exactly what the style made.
    if (untouched && options.styleMade) options.styleMade = { ...options.styleMade, fc: low(ink) }
    return { ...node, options }
  })
  const worn = wornStyle(doc)
  if (worn) {
    const overrides = { ...(worn.overrides || {}), bg }
    if (background) overrides.background = background
    else delete overrides.background
    doc.options.style = styleRecord({ id: worn.id, overrides })
  }
  return doc
}

// Lines to notes that are gone, taken off the notes that stay.
function dropLinesTo(nodes, gone) {
  if (!gone.size) return nodes
  return nodes.map((node) => ({
    ...node,
    relationships: { ...(node.relationships || {}), associations: (node.relationships?.associations || []).filter((a) => !gone.has(String(a.parentId)) && !gone.has(String(a.childId))) },
  }))
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

// The skin of one slate note written onto its stored options (same note, same id, same words, and
// any picture of its own kept).
function skinNote(options, look, origin) {
  const out = { ...options }
  if (look.vectorPath) {
    delete out.shapeHint
  }
  if (look.shape && !look.vectorPath) delete out.vectorPath
  // A picture the note holds is its own: a style's picture (its art for the root note) is drawn only
  // on a note without one.
  const own = typeof options.image === 'string' && options.image !== '' && !options.styleImage
  if (!own) delete out.styleImage
  const { x, y, rotate, ...rest } = look
  if (own && rest.image) {
    delete rest.image
    delete rest.imageOrigWidth
    delete rest.imageOrigHeight
    delete rest.imageFit
  }
  Object.assign(out, rest, {
    xPos: x + origin.x,
    yPos: y + origin.y,
    foregroundColor: look.fontColor ?? out.foregroundColor,
  })
  if (!own && look.image) out.styleImage = true
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

// A stage note of the composer as a real note on the slate, sealed as the style made it.
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
  return { options: sealed(options), relationships: { associations: [] } }
}
// Art options sealed as the style makes them: its seal and what it made.
function sealed(options) {
  const out = { ...options }
  delete out.styleMade
  out.styleSeal = sealOf(out)
  out.styleMade = madeOf(out)
  return out
}

/**
 * The art the slate holds, matched to the new style's art. Art exactly as the style made it matches
 * the same note (same id) or the same words, and is restyled in place. Art somebody changed only in
 * its words, picture or outline matches only its own id, and is restyled in place with those kept.
 * → { matched: Map(stageId → old node), rest: [node] } (rest: art with no match, or changed in its
 * colors, size, place or lock, which is never restyled).
 */
function matchKeptArt(art, stageNotes) {
  const matched = new Map()
  const taken = new Set()
  const restylable = (old) => isUntouchedArt(old) || (!changesOf(old.options).look && !changesOf(old.options).unknown)
  const pass = (test) => {
    for (const old of art) {
      if (taken.has(old) || !restylable(old)) continue
      const hit = stageNotes.find((note) => !matched.has(note.id) && test(old, note))
      if (hit) {
        matched.set(hit.id, old)
        taken.add(old)
      }
    }
  }
  pass((old, note) => idOf(old) === note.id)
  pass((old, note) => isUntouchedArt(old) && wordsOf(old.options.text) !== '' && wordsOf(old.options.text) === wordsOf(note.text))
  return { matched, rest: art.filter((old) => !taken.has(old)) }
}

// Art restyled in place: the new style's note, with the old note's id, lines and words. Untouched,
// it stays exactly the style's (sealed again); changed by somebody, their words, picture and outline
// are laid over it and it stays theirs (what the style made is kept, so the change still shows).
function restyledArt(node, old) {
  const out = { ...node.options, text: old.options.text }
  const relationships = { ...(old.relationships || {}), associations: [...(old.relationships?.associations || [])] }
  if (isUntouchedArt(old)) return { options: sealed(out), relationships }
  const change = changesOf(old.options)
  const made = sealed(change.words ? { ...out, text: node.options.text } : out)
  const theirs = { ...made }
  if (change.words) theirs.text = old.options.text
  if (change.image) {
    for (const key of ['image', 'imageOrigWidth', 'imageOrigHeight', 'imageFit', 'styleImage']) {
      if (old.options[key] === undefined) delete theirs[key]
      else theirs[key] = old.options[key]
    }
  }
  if (change.path) {
    if (old.options.vectorPath === undefined) delete theirs.vectorPath
    else theirs.vectorPath = old.options.vectorPath
  }
  return { options: theirs, relationships }
}

/**
 * The slate wearing `styleRef`. With a `direction` (a deck's art direction: title, steps, words),
 * the deck's art is laid out on the slate once, clear of every note (no two steps' notes on top
 * of each other), and the deck that plays it comes back. Without one, Slatebox's own direction for
 * the slate is used (the one Present makes without the agent). `presentation` is the deck look the
 * slate plays now ({ style, direction, deck }), kept with the original the first time a style is worn.
 * → { slate, deck } where deck is { version: 5, style, steps: [{ layout, box, lit, own, hide,
 *   decor, dim, deep, camera, reveal, duration, kicker, narrative }] }.
 */
export function wearStyle(slateJSON, styleRef, { direction = null, name = '', ambient = false, presentation = null } = {}) {
  const doc = keepOriginal(parse(slateJSON), { presentation })
  const title = name || doc.options.name || ''
  // What the slate holds now: its own notes and the art an earlier style added.
  const own = (doc.nodes || []).filter((node) => !isStyleArt(node)).map((node) => ({ ...node, options: unworn(node.options || {}) }))
  const oldArt = (doc.nodes || []).filter(isStyleArt)
  const linked = linkedIds(doc.nodes)
  const { layout, origin } = layoutOfNodes(own)
  if (!layout.nodes.length) throw new Error('The slate has no notes to wear a style on.')
  // The same style worn again (another picture, the same chip) keeps what was set on it by hand.
  const worn = wornStyle(doc)
  const asked = cleanStyleRef(styleRef || direction?.style)
  const ref = !asked.overrides && worn?.id === asked.id && worn.overrides ? cleanStyleRef({ id: asked.id, overrides: worn.overrides }) : asked
  const dir = direction?.steps ? normalizeDirection({ ...direction, style: ref }, layout, { name: title }) : localDirection(layout, { name: title, style: ref.id })
  const composed = composeDeck(layout, { ...dir, style: ref }, { style: ref, bake: true })
  const style = resolveStyle(ref)

  // The earlier style's art: restyled in place where the new style has the same art; else taken
  // away if the style may take it (mayTake: its own decoration, or words a style wrote here, made
  // again by the new style), so they never pile up; else kept (content, or somebody's).
  const { matched, rest } = matchKeptArt(oldArt, composed.stageNotes)
  const original = originalIds(doc)
  const gone = new Set(rest.filter((node) => mayTake(node, linked, original)).map(idOf))
  const keptArt = rest.filter((node) => !gone.has(idOf(node)))

  // 1. The slate's own notes in the style (same ids, same words; outlines, fills, fonts, places).
  // A note or a line made since the original remembers its own look first (styleWas), so Revert
  // to original gives it back: the original's own are given back from the original.
  const originalLines = new Map((doc.options.styleOriginal?.nodes || []).map((node) => [idOf(node), node.relationships?.associations || []]))
  const nodes = own.map((node) => {
    const id = idOf(node)
    const look = composed.skin[id]
    const before = node.relationships?.associations || []
    const staying = before.filter((a) => !gone.has(String(a.parentId)) && !gone.has(String(a.childId)))
    const associations = staying.map((assoc) => ({ ...assoc, ...(composed.lines[lineEnds(assoc)] || {}) }))
    const options = look ? skinNote(node.options, look, origin) : { ...node.options }
    const was = options.styleWas && typeof options.styleWas === 'object' ? options.styleWas : {}
    const lines = { ...(was.lines || {}) }
    // Each line by its own key, against the same line before (never another between the same notes).
    const keys = lineKeys(associations)
    const since = originalLines.has(id) ? linesSince(originalLines.get(id), associations) : associations.map(() => true)
    associations.forEach((assoc, at) => {
      if (!since[at]) return
      const line = remembered(lines[keys[at]], staying[at], assoc, LINE_SKIP)
      if (Object.keys(line).length) lines[keys[at]] = line
    })
    const lookWas = original && !original.has(id) ? remembered(was.look, node.options, options) : was.look || {}
    if (Object.keys(lookWas).length || Object.keys(lines).length) {
      options.styleWas = { ...(Object.keys(lookWas).length ? { look: lookWas } : {}), ...(Object.keys(lines).length ? { lines } : {}) }
    }
    return { ...node, options, relationships: { ...(node.relationships || {}), associations } }
  })
  // 2. Art that is somebody's and has no place in the new style: their own note now, as they left it.
  const keptPlain = keptArt.map((node) => ({ ...node, options: keptInStyle(node, style) }))
  // Ids the slate holds, so a new note of the style never takes one.
  const taken = new Set([...nodes, ...keptPlain].map(idOf))
  const rename = new Map()
  for (const note of composed.stageNotes) {
    const old = matched.get(note.id)
    let id = old ? idOf(old) : note.id
    if (!old) for (let n = 2; taken.has(id); n += 1) id = `${note.id}-${n}`
    taken.add(id)
    rename.set(note.id, id)
  }
  const finalId = (id) => rename.get(id) ?? id
  // 3. The style's art as real notes: decoration and backdrops behind the slate, the rest on top.
  // Worn without a presentation (`ambient`, from the slate's settings) only the style's decoration
  // comes, and the art the slate keeps: no title card or caption is invented for words nobody wrote.
  const art = composed.stageNotes.filter((note) => !ambient || note.deco || matched.has(note.id)).map((note) => {
    const old = matched.get(note.id)
    const made = artNote({ ...note, id: finalId(note.id) }, origin)
    return { note, node: old ? restyledArt(made, old) : made }
  })
  const behind = art.filter(({ note }) => note.behind || note.deco).map(({ node }) => node)
  const front = art.filter(({ note }) => !(note.behind || note.deco)).map(({ node }) => node)
  doc.nodes = [...behind, ...nodes, ...keptPlain, ...front]
  // 4. The canvas background and the record of what the slate wears.
  // The style's color, or the gradient or picture set on it by hand (its record's overrides).
  doc.options.containerStyle = withBackground(doc.options.containerStyle, style.bg, style.background)
  doc.options.style = styleRecord(ref)
  doc.options.defaultLineColor = composed.lines[Object.keys(composed.lines)[0]]?.lineColor || doc.options.defaultLineColor

  // 5. The deck: a box per step, in canvas units, and what each step lights and reveals.
  const shift = (box) => (box ? { x: box.x + origin.x, y: box.y + origin.y, width: box.width, height: box.height } : null)
  if (ambient) return { slate: doc, direction: null, deck: null }
  const decorIds = composed.stageNotes.filter((note) => note.deco).map((note) => finalId(note.id))
  const credits = new Map(composed.stageNotes.filter((note) => note.credit).map((note) => [note.id, note.credit]))
  const steps = composed.steps.map((step, index) => {
    const stepOwn = composed.stageNotes.filter((note) => Array.isArray(note.steps) && note.steps.includes(index) && note.steps.length === 1).map((note) => finalId(note.id))
    const hide = composed.stageNotes.filter((note) => !note.deco && !showsOn(note, index)).map((note) => finalId(note.id))
    const pictures = [...new Set(composed.stageNotes.filter((note) => credits.has(note.id) && showsOn(note, index)).map((note) => credits.get(note.id)))]
    return {
      layout: step.layout,
      box: shift(frameBox(composed, step)),
      lit: step.lit === 'all' ? 'all' : [...new Set(step.lit.map(finalId))],
      own: stepOwn,
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

/** The slate's own notes (the style's art aside), at the size and turn they had before a style. */
export const ownNotesOf = (slateJSON) => {
  const doc = typeof slateJSON === 'string' ? JSON.parse(slateJSON) : slateJSON || {}
  return (doc.nodes || []).filter((node) => !isStyleArt(node)).map((node) => ({ ...node, options: unworn(node.options || {}) }))
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
 * What a saved presentation plays once its slate is back at its original (revertToOriginal): the
 * deck kept with the original if it was a worn style's deck (its art is back too), else the camera
 * over the slate as it is again, framing the steps played before the first style (`kept`), else
 * the steps given (`fallbackSteps`, in order of preference: a step whose notes are gone frames the
 * whole slate). → { deck, direction, style } for presentations.update { revert }.
 */
export function revertedPresentation(back, kept = null, ...fallbackSteps) {
  if (isBakedDeck(kept?.deck)) return { deck: kept.deck, direction: kept.direction ?? null, style: kept.style ?? kept.deck.style ?? null }
  const steps = [kept?.deck?.steps, ...fallbackSteps].find((list) => Array.isArray(list) && list.length) || []
  const deck = cameraDeck(back, steps)
  return { deck, direction: kept ? kept.direction ?? null : null, style: kept ? kept.style ?? null : wornStyle(back) }
}

/** Whether a saved presentation row plays a worn style's deck (so a revert of its slate must put it back). */
export const playsWornStyle = (row) => isBakedDeck(row?.deck) && Boolean(row.deck.style || row.style)

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
