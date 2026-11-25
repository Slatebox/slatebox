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
// the style's art and restyle notes, but it never deletes a note that carries content: a note with
// words, a note somebody made or changed, a note with a line. Switching removes only the previous
// style's own decoration that nobody touched (its seal, options.styleSeal, still matches); art that
// carries words is restyled in the new style or kept as a plain note with its words. And the first
// time a slate wears a style, the slate as it was is kept (options.styleOriginal), so "Revert to
// original" always gives it back exactly (revertToOriginal).
import * as shapes from 'slateboxjs/shapes'
import { composeDeck, engineTextHeight, fitNoteFont, frameBox, localDirection, normalizeDirection, showsOn } from './presentationCompose.mjs'
import { PRESENTATION_STYLES_MARKER, STYLES, cleanStyleRef, resolveStyle, textOn } from './presentationStyles.mjs'
import { layoutOfNodes } from '../../../api/common/slate-layout-core.mjs'

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
const ART_MARKS = ['styleRole', 'styleSeal']

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

/** Whether a note on the slate is the style's own art, exactly as the style made it. */
export const isUntouchedArt = (node) => isStyleArt(node) && (node.options.styleSeal === undefined
  // Art worn before seals were written: only its wordless decoration is the style's.
  ? !wordsOf(node.options.text)
  : node.options.styleSeal === sealOf(node.options))

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

/**
 * What a style may take away from the slate: its own art that nobody changed, that holds no words
 * and has no line. Everything else on the slate is content and stays.
 */
export function replaceableArt(slateJSON) {
  const doc = typeof slateJSON === 'string' ? JSON.parse(slateJSON) : slateJSON || {}
  const linked = linkedIds(doc.nodes)
  return new Set((doc.nodes || []).filter((node) => isUntouchedArt(node) && !wordsOf(node.options.text) && !linked.has(idOf(node))).map(idOf))
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

// A note that is no longer the style's: the style's marks off, unlocked if the style locked it.
function plainOptions(options) {
  const out = { ...options }
  if (DECOR.has(out.styleRole)) delete out.isLocked
  for (const key of ART_MARKS) delete out[key]
  return out
}
// A note that was the style's, kept with its words in another style: the style's faces and colors
// on it, its words, picture, place and size its own. Untouched, it stays the style's art (sealed as it
// was: the seal holds no colors or faces); changed by somebody, it is a plain note of theirs.
function keptInStyle(node, style) {
  const out = isUntouchedArt(node) ? { ...node.options } : plainOptions(node.options)
  const fill = typeof out.backgroundColor === 'string' && out.backgroundColor !== 'transparent' && !out.image
  if (fill) out.backgroundColor = String(style.palette[0])
  const ink = textOn(fill ? out.backgroundColor : style.bg)
  out.fontColor = ink
  out.foregroundColor = ink
  out.fontFamily = style.fonts?.display || out.fontFamily
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
  // The original's notes as they were, with any words written since and any line drawn since to a
  // note made since.
  const nodes = original.nodes.map((node) => {
    const current = now.get(idOf(node))
    if (!current) return node
    const newer = wordsOf(current.options?.text) && wordsOf(current.options?.text) !== wordsOf(node.options?.text)
    const lines = (current.relationships?.associations || []).filter((a) => !ids.has(String(a.parentId)) || !ids.has(String(a.childId)))
    if (!newer && !lines.length) return node
    return {
      ...node,
      options: newer ? { ...node.options, text: current.options.text } : node.options,
      relationships: { ...(node.relationships || {}), associations: [...(node.relationships?.associations || []), ...lines] },
    }
  })
  // Notes made since: kept, all but the art a style added that nobody changed or drew a line to.
  const linked = linkedIds(doc.nodes)
  const added = (doc.nodes || []).filter((node) => !ids.has(idOf(node)) && !(isUntouchedArt(node) && !linked.has(idOf(node))))
    .map((node) => ({ ...node, options: isStyleArt(node) ? plainOptions(node.options) : { ...node.options } }))
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

/**
 * The slate's background set by hand (a hex color), as part of its style: the background the
 * style wears from now on (its record's overrides.bg), so wearing it again keeps it and "Revert to
 * original" takes it back. The original is kept first.
 */
export function setSlateBackground(slateJSON, color) {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color.trim())) throw new Error('Choose a color like #1a2b3c.')
  const bg = color.trim().toLowerCase()
  const doc = keepOriginal(parse(slateJSON))
  const cs = { ...(doc.options.containerStyle || {}), backgroundColor: bg, backgroundColorAsGradient: false }
  delete cs.backgroundImage
  delete cs.backgroundEffect
  doc.options.containerStyle = cs
  const worn = wornStyle(doc)
  if (worn) doc.options.style = styleRecord({ id: worn.id, overrides: { ...(worn.overrides || {}), bg } })
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
  options.styleSeal = sealOf(options)
  return { options, relationships: { associations: [] } }
}

/**
 * The art the slate holds that a new style must keep (it holds words, somebody changed it, or a
 * line meets it), matched to the new style's art: the same note (same id) or the same words. A
 * match is restyled in place (the new style's look, the note's own id, words and lines); the rest
 * stay as plain notes in the new style. → { matched: Map(stageId → old node), plain: [node] }
 */
function matchKeptArt(kept, stageNotes) {
  const matched = new Map()
  const taken = new Set()
  const pass = (test) => {
    for (const old of kept) {
      if (taken.has(old)) continue
      const hit = stageNotes.find((note) => !matched.has(note.id) && test(old, note))
      if (hit) {
        matched.set(hit.id, old)
        taken.add(old)
      }
    }
  }
  pass((old, note) => idOf(old) === note.id)
  pass((old, note) => wordsOf(old.options.text) !== '' && wordsOf(old.options.text) === wordsOf(note.text))
  return { matched, plain: kept.filter((old) => !taken.has(old)) }
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
  // What the slate holds now: its own notes, the style's art it may replace, and the art it keeps.
  const gone = replaceableArt(doc)
  const own = (doc.nodes || []).filter((node) => !isStyleArt(node)).map((node) => ({ ...node, options: unworn(node.options || {}) }))
  const kept = (doc.nodes || []).filter((node) => isStyleArt(node) && !gone.has(idOf(node)))
  const { layout, origin } = layoutOfNodes(own)
  if (!layout.nodes.length) throw new Error('The slate has no notes to wear a style on.')
  // The same style worn again (another picture, the same chip) keeps what was set on it by hand.
  const worn = wornStyle(doc)
  const asked = cleanStyleRef(styleRef || direction?.style)
  const ref = !asked.overrides && worn?.id === asked.id && worn.overrides ? cleanStyleRef({ id: asked.id, overrides: worn.overrides }) : asked
  const dir = direction?.steps ? normalizeDirection({ ...direction, style: ref }, layout, { name: title }) : localDirection(layout, { name: title, style: ref.id })
  const composed = composeDeck(layout, { ...dir, style: ref }, { style: ref, bake: true })
  const style = resolveStyle(ref)

  // 1. The slate's own notes in the style (same ids, same words; outlines, fills, fonts, places).
  const nodes = own.map((node) => {
    const id = idOf(node)
    const look = composed.skin[id]
    const associations = (node.relationships?.associations || []).filter((a) => !gone.has(String(a.parentId)) && !gone.has(String(a.childId)))
      .map((assoc) => ({ ...assoc, ...(composed.lines[`${assoc.parentId}->${assoc.childId}`] || {}) }))
    return { ...node, options: look ? skinNote(node.options, look, origin) : { ...node.options }, relationships: { ...(node.relationships || {}), associations } }
  })
  // 2. The art the slate keeps: restyled in place where the new style has the same art, else a
  // plain note in the new style. Its id, its words and its lines are its own.
  const { matched, plain } = matchKeptArt(kept, composed.stageNotes)
  const keptPlain = plain.map((node) => ({ ...node, options: keptInStyle(node, style) }))
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
    const node = artNote({ ...note, id: finalId(note.id) }, origin)
    if (old) {
      node.options.text = old.options.text
      // Art somebody changed stays theirs in the new style: its seal never matches again.
      node.options.styleSeal = isUntouchedArt(old) ? sealOf(node.options) : 'changed'
      if (!isUntouchedArt(old) && old.options.isLocked !== true) delete node.options.isLocked
      node.relationships = { ...(old.relationships || {}), associations: [...(old.relationships?.associations || [])] }
    }
    return { note, node }
  })
  const behind = art.filter(({ note }) => note.behind || note.deco).map(({ node }) => node)
  const front = art.filter(({ note }) => !(note.behind || note.deco)).map(({ node }) => node)
  doc.nodes = [...behind, ...nodes, ...keptPlain, ...front]
  // 4. The canvas background and the record of what the slate wears.
  const cs = { ...(doc.options.containerStyle || {}), backgroundColor: style.bg, backgroundColorAsGradient: false }
  delete cs.backgroundImage
  delete cs.backgroundEffect
  doc.options.containerStyle = cs
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
