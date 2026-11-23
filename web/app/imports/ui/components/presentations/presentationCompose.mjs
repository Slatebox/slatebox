// A presentation deck, composed from the slate and an art direction. The direction says what
// the deck is (its style, title, the layout and words of each step, the pictures it wants) and
// comes from the AI or, without it, from localDirection. composeDeck turns it into what the
// presenter plays on the live canvas: the slate's own notes, skinned by the style; stage notes
// (titles, stickers, bubbles, braces, ribbons, masked pictures) placed in free canvas space; and
// steps with Prezi camera moves (frames, roll, deep zooms, a homecoming finale). Every stage note
// has a landscape and a portrait geometry. Pure and deterministic: shared by the presenter and
// the server, so a deck composed in either place is the same deck.
import * as P from './presentationPaths.mjs'
import { artImage } from './presentationArt.mjs'
import { DEFAULT_STYLE, STYLES, STYLE_IDS, cleanStyleRef, resolveStyle, textOn } from './presentationStyles.mjs'
import { groupNotes } from './presentationPlan.mjs'
import { rotatedBounds } from './presentationFraming.mjs'
import { phraseOf, voiceCaption, voiceKicker } from './presentationVoice.mjs'

export const DECK_VERSION = 4
export const LAYOUTS = ['title', 'overview', 'dive', 'hero', 'treeBuild', 'trace', 'sweep', 'group', 'bigNumber', 'quote', 'split', 'compare', 'cover', 'finale']
/** The layouts a direction's middle steps may use (the opening and the finale are the composer's). */
export const STEP_LAYOUTS = LAYOUTS.filter((layout) => !['title', 'cover', 'finale'].includes(layout))
export const SURPRISES = new Set(['bigNumber', 'quote', 'compare', 'trace'])
export const MAX_STEPS = 12
export const CAPTION_WORDS = 12
/** The most decoration notes (stars, rings, grid lines) a deck adds. */
export const MAX_DECOR = 40
const DEFAULT_CTA = 'Open the slate'
const HONEST_CLOSE = 'Every word you saw is a note you can move.'

// ─── words ──────────────────────────────────────────────────────────────────

const words = (text) => String(text || '').trim().split(/\s+/).filter(Boolean)
const firstLine = (text) => String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || ''
const short = (text, n = 60) => {
  const t = firstLine(text)
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}
// All-caps placeholder runs ("YOUR TOPIC HERE"): two or more capitalised words in a row.
const PLACEHOLDER = /\b[A-Z][A-Z0-9'’]{1,}(?:\s+[A-Z][A-Z0-9'’]{1,})+\b/g
const pad2 = (n) => String(n).padStart(2, '0')

/** A caption made safe: at most 12 words, no all-caps placeholder runs, plain spacing. */
export function cleanCaption(text, limit = CAPTION_WORDS) {
  const cleaned = String(text || '').replace(PLACEHOLDER, '').replace(/\s+/g, ' ').trim()
  const list = words(cleaned)
  if (list.length <= limit) return cleaned
  return `${list.slice(0, limit).join(' ').replace(/[,;:—–-]+$/, '')}…`
}

/**
 * Whether a caption only repeats a note: it contains a note's whole text (of three words or more)
 * and that note is most of what it says. A caption that names a note inside a sentence of its own
 * ("Chapter II: Free and open source") summarises; one that is the note again repeats.
 */
export function repeatsNote(caption, texts) {
  const c = String(caption || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!c) return false
  return texts.some((text) => {
    const t = firstLine(text).toLowerCase().replace(/\s+/g, ' ')
    return (words(t).length >= 3 || t.length >= 16) && c.includes(t) && t.replace(/[^a-z0-9]/g, '').length >= c.replace(/[^a-z0-9]/g, '').length * 0.75
  })
}

/** Text compared as words: lower case, plain quotes and spaces, no trailing ellipsis. */
const plainText = (text) => String(text || '').toLowerCase().replace(/[“”"‘’']/g, '').replace(/…$/, '').replace(/[.!?,;:]+$/, '').replace(/\s+/g, ' ').trim()
/** Whether `quote` is a note's own words: a run of words in one of `texts`. */
export function quoteOnSlate(quote, texts) {
  const q = plainText(quote)
  if (words(q).length < 2) return false
  return texts.some((text) => plainText(text).includes(q))
}

// ─── the slate as a graph ───────────────────────────────────────────────────

/**
 * The slate's notes as the composer reads them: boxes, text, connections, the main root and its
 * branches, a typical note size (`unit`) and the box everything is in.
 */
export function slateGraph(layout) {
  const notes = new Map()
  const stack = [...(layout?.nodes || [])].reverse().map((node) => ({ node, parent: null }))
  const seen = new Set()
  while (stack.length) {
    const { node, parent } = stack.pop()
    if (node?.nodeId == null) continue
    const id = String(node.nodeId)
    if (!notes.has(id)) {
      const bbox = node.metrics?.bbox
      const box = bbox && [bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)
        ? rotatedBounds(bbox, Number(node.metrics.rotation) || 0) : { x: 0, y: 0, width: 0, height: 0 }
      notes.set(id, { id, text: firstLine(node.description), box, parent: null, children: [] })
    }
    const entry = notes.get(id)
    if (parent && parent !== id && !entry.parent) {
      entry.parent = parent
      notes.get(parent)?.children.push(id)
    }
    if (seen.has(node)) continue
    seen.add(node)
    const kids = node.childrenNodes || []
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push({ node: kids[i], parent: id })
  }
  const list = [...notes.values()].filter((note) => note.box.width > 0 || note.box.height > 0)
  const heights = list.map((note) => Math.min(note.box.width, note.box.height) || note.box.height).sort((a, b) => a - b)
  const unit = Math.min(240, Math.max(24, heights[Math.floor(heights.length / 2)] || 56))
  const descendants = (id) => {
    let count = 0
    const todo = [...(notes.get(id)?.children || [])]
    while (todo.length) {
      const next = todo.pop()
      count += 1
      todo.push(...(notes.get(next)?.children || []))
    }
    return count
  }
  const roots = list.filter((note) => !note.parent)
  const main = roots.map((note) => ({ note, size: descendants(note.id) })).sort((a, b) => b.size - a.size)[0]
  const root = main && main.note.children.length >= 2 ? main.note.id : null
  // Branch index: which of the root's children a note grows from (else its group's index).
  const branchOf = new Map()
  if (root) {
    notes.get(root).children.forEach((child, index) => {
      const todo = [child]
      while (todo.length) {
        const next = todo.pop()
        branchOf.set(next, index)
        todo.push(...(notes.get(next)?.children || []))
      }
    })
  }
  const box = unionBoxes(list.map((note) => note.box))
  return { notes, list, root, branchOf, unit, box, edges: list.filter((note) => note.parent).length }
}

function unionBoxes(boxes) {
  const valid = boxes.filter(Boolean)
  if (!valid.length) return { x: 0, y: 0, width: 0, height: 0 }
  const x0 = Math.min(...valid.map((b) => b.x))
  const y0 = Math.min(...valid.map((b) => b.y))
  const x1 = Math.max(...valid.map((b) => b.x + b.width))
  const y1 = Math.max(...valid.map((b) => b.y + b.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
const overlaps = (a, b, gap = 0) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
const inflate = (b, d) => ({ x: b.x - d, y: b.y - d, width: b.width + d * 2, height: b.height + d * 2 })
const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

/**
 * The slate's groups, as steps show them: the root's branches (each with what grows from it), or
 * for a slate without one root, the notes grouped by connection and nearness.
 */
export function slateGroups(layout, graph = slateGraph(layout)) {
  const groups = []
  const taken = new Set()
  if (graph.root) {
    taken.add(graph.root)
    graph.notes.get(graph.root).children.forEach((child) => {
      const ids = []
      const todo = [child]
      while (todo.length) {
        const next = todo.shift()
        if (taken.has(next)) continue
        taken.add(next)
        ids.push(next)
        todo.push(...(graph.notes.get(next)?.children || []))
      }
      if (ids.length > 8) groupNotes(layout, { only: new Set(ids), max: 6 }).forEach((part) => groups.push(part))
      else if (ids.length) groups.push(ids)
    })
  }
  const rest = graph.list.map((note) => note.id).filter((id) => !taken.has(id))
  if (rest.length) {
    let parts = groupNotes(layout, { only: new Set(rest) })
    // A slate that is one group (a flow, a cluster) is shown in its branches, never all at once.
    if (!groups.length && parts.length === 1 && parts[0].length >= 3) parts = groupNotes(layout, { only: new Set(rest), max: Math.min(3, parts[0].length - 1) })
    parts.forEach((part) => groups.push(part))
  }
  return groups.map((ids) => {
    const lead = ids.find((id) => graph.notes.get(id)?.parent === graph.root) || ids[0]
    return { ids, lead, box: unionBoxes(ids.map((id) => graph.notes.get(id)?.box)), text: graph.notes.get(lead)?.text || '' }
  })
}

/** What kind of slate this is, from its shape and words. */
export function classifySlate(layout, name = '') {
  const graph = slateGraph(layout)
  const n = graph.list.length
  const texts = graph.list.map((note) => note.text).join(' \n ')
  const all = `${name} ${texts}`
  if (/\b(vs\.?|versus|pros?|cons?|compared?|comparison|before|after)\b/i.test(all) && n >= 4) return 'comparison'
  if (graph.root && graph.notes.get(graph.root).children.length >= 3) return n <= 7 ? 'launch' : 'tree'
  const chain = graph.list.filter((note) => note.children.length <= 1).length
  if (graph.edges >= n - 2 && n >= 3 && chain >= n * 0.8) {
    return /\b(q[1-4]|week|month|phase|milestone|roadmap|20\d\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(all) ? 'timeline' : 'flow'
  }
  const numeric = graph.list.filter((note) => /\d/.test(note.text)).length
  if (n && numeric / n >= 0.3) return 'data'
  if (graph.edges < n / 3) return 'cluster'
  return graph.root ? 'tree' : 'cluster'
}

const STYLE_FOR = { tree: 'voyage', launch: 'neon', flow: 'blueprint', timeline: 'journey', cluster: 'sketch', data: 'stage', comparison: 'editorial' }
/** The style Slatebox picks for a slate, from what kind it is. */
export const pickStyle = (layout, name = '') => STYLE_FOR[classifySlate(layout, name)] || DEFAULT_STYLE

// ─── numbers that are on the slate ──────────────────────────────────────────

const digitsOf = (text) => String(text || '').replace(/[^0-9.]/g, '').replace(/^\.+|\.+$/g, '')
/**
 * Whether a big number is honest: it is written on the slate, it is 0 on a slate that says
 * "free", or it counts the slate itself (its notes or its groups).
 */
export function numberOnSlate(number, layout, graph = slateGraph(layout)) {
  const digits = digitsOf(number)
  if (!digits) return false
  const texts = graph.list.map((note) => note.text).join(' ')
  if (Number(digits) === 0 && /\bfree\b/i.test(texts)) return true
  if ([graph.list.length, slateGroups(layout, graph).length].includes(Number(digits))) return true
  return (texts.match(/\d[\d,.]*/g) || []).some((found) => digitsOf(found) === digits)
}
/** The first number a group's notes state (or "0" for "free"). */
function numberIn(ids, graph) {
  for (const id of ids) {
    const text = graph.notes.get(id)?.text || ''
    const found = text.match(/[$£€]?\d[\d,.]*\s?%?/)
    if (found) return found[0].trim()
    if (/\bfree\b/i.test(text)) return '$0'
  }
  return null
}

// ─── the direction ──────────────────────────────────────────────────────────

// Words a step's caption is written from: the step's head note, a note under it, the second
// group (a pair), the slate's root, how many groups and notes the slate has.
function stepContext(ids, graph, groups, { number = null, i = 0 } = {}) {
  const set = new Set(ids)
  const parts = groups.filter((group) => group.ids.some((id) => set.has(id)))
  const lead = ids.find((id) => graph.root && graph.notes.get(id)?.parent === graph.root) || parts[0]?.lead || ids[0]
  const kids = ids.filter((id) => id !== lead && !parts.some((part) => part.lead === id)).map((id) => graph.notes.get(id)?.text).filter(Boolean)
  const second = parts.find((part) => !part.ids.includes(lead))
  return {
    head: phraseOf(graph.notes.get(lead)?.text),
    kid: phraseOf(kids[0], 6),
    k: kids.length,
    next: phraseOf(second?.text),
    root: phraseOf(graph.root ? graph.notes.get(graph.root)?.text : '', 4) || 'this slate',
    count: groups.length,
    notes: graph.list.length,
    number: number || '',
    i,
  }
}

/**
 * A caption from the slate's words, in the style's voice: never a line that would fit any slate.
 * Falls back through the voice's other ways of saying it, then to the head note's own phrase.
 */
function captionFor(styleId, layout, ids, graph, groups, texts, { index = 0, number = null } = {}) {
  const ctx = stepContext(ids, graph, groups, { number, i: index })
  const text = voiceCaption(styleId, layout, ctx, index, (caption) => repeatsNote(caption, texts))
  return cleanCaption(text || (ctx.head ? `${ctx.head}, closer.` : ''))
}

// Which layouts a step's notes can take: a number must be on them, a pair needs two groups, a
// trace a branch away from the root, a build three notes, a quote a note of four words.
function canTake(layout, ids, graph, groups) {
  const set = new Set(ids)
  const parts = groups.filter((group) => group.ids.some((id) => set.has(id)))
  if (layout === 'bigNumber') return Boolean(numberIn(ids, graph))
  if (layout === 'sweep' || layout === 'compare') return parts.length >= 2
  if (layout === 'trace') return Boolean(graph.root) && !ids.includes(graph.root)
  if (layout === 'treeBuild') return ids.length >= 3
  if (layout === 'quote') return ids.some((id) => words(graph.notes.get(id)?.text).length >= 4)
  if (layout === 'overview') return false
  return true
}

// A picture a step asks for, from its notes' words (never the slate's own name, which finds the
// product, not the idea): a query to search, a prompt to generate, and why it belongs there.
function pictureFor(ids, graph, style) {
  const lead = ids.find((id) => graph.notes.get(id)?.parent === graph.root) || ids[0]
  const head = graph.notes.get(lead)?.text || ''
  const kids = ids.filter((id) => id !== lead).map((id) => graph.notes.get(id)?.text).filter(Boolean)
  const content = (text) => words(text).filter((w) => w.length > 3 && !/^(with|from|that|this|your|their|into|over|about|right)$/i.test(w))
  const query = short([...content(head), ...content(kids[0] || '')].slice(0, 5).join(' ') || head, 80)
  if (!query) return null
  return {
    query,
    prompt: short(`${style?.imagePrompt || 'A bold editorial illustration'} of ${head}${kids.length ? `: ${kids.slice(0, 2).join(', ')}` : ''}. No text, no logos.`, 280),
    why: `pictures “${short(head, 40)}”`,
    role: 'hero',
  }
}

// The slate's honest quote for a step: the longest of its notes of four words or more.
function quoteFrom(ids, graph) {
  const quoted = ids.map((id) => graph.notes.get(id)?.text).filter((text) => words(text).length >= 4).sort((a, b) => b.length - a.length)[0]
  return quoted ? short(quoted, 120) : null
}

/**
 * The layouts of a direction's steps, chosen again for a style: its rhythm from the start, each
 * step the first layout its notes can take, its numbers, quotes, headings and pictures filled from
 * the slate. The steps keep their notes in their order; the words Slatebox wrote (a local
 * direction) are written again in the style's voice; the AI's words stay. → a direction
 */
export function remixDirection(direction, layout, styleRef, { name = '' } = {}) {
  const graph = slateGraph(layout)
  const groups = slateGroups(layout, graph)
  const texts = graph.list.map((note) => note.text)
  const styleId = STYLES[styleRef?.id || styleRef] ? (styleRef.id || styleRef) : pickStyle(layout, name)
  const def = STYLES[styleId]
  const source = Array.isArray(direction?.steps) ? direction.steps : []
  const local = direction?.local === true
  let rhythm = 0
  let detailUsed = !def.motion.deep
  let middle = 0
  const steps = source.map((step, index) => {
    const ids = [...new Set([step?.nodeIds ?? []].flat().map(String))].filter((id) => graph.notes.has(id))
    if (!ids.length) return null
    if (index === 0 && step.layout === 'overview') {
      return { ...step, nodeIds: ids, ...(local ? { kicker: voiceKicker(styleId, 0), caption: captionFor(styleId, 'overview', ids, graph, groups, texts) } : {}) }
    }
    middle += 1
    // A workshop lane and a step with a nested detail stay dives: every style keeps the deep zoom.
    let layoutId = step.lane || step.detail ? 'dive' : 'group'
    for (let k = 0; layoutId === 'group' && k < def.rhythm.length; k += 1) {
      const candidate = def.rhythm[(rhythm + k) % def.rhythm.length]
      if (canTake(candidate, ids, graph, groups)) {
        layoutId = candidate
        rhythm += k + 1
        break
      }
    }
    const out = { ...step, nodeIds: ids, layout: layoutId }
    delete out.lane
    delete out.number
    delete out.quote
    delete out.detail
    const ctx = stepContext(ids, graph, groups)
    if (layoutId === 'bigNumber') {
      out.number = numberIn(ids, graph)
      out.numberLabel = out.numberLabel || short(graph.notes.get(ids[0])?.text, 48)
    }
    if (layoutId === 'quote') out.quote = quoteFrom(ids, graph)
    if (layoutId === 'sweep' || layoutId === 'compare') {
      const set = new Set(ids)
      const parts = groups.filter((group) => group.ids.some((id) => set.has(id))).slice(0, 2)
      out.headlines = out.headlines?.length === 2 ? out.headlines : parts.map((part) => short(part.text, 32))
      if (layoutId === 'sweep' && !(out.images?.length >= 2)) out.images = parts.map((part, k) => step.images?.[k] || pictureFor(part.ids, graph, def)).filter(Boolean)
    }
    if (['dive', 'split', 'hero'].includes(layoutId) && !out.image) out.image = pictureFor(ids, graph, def) || undefined
    if (layoutId === 'trace' && local) out.headline = `Back to ${phraseOf(graph.notes.get(graph.root)?.text, 3)}`
    if (layoutId === 'hero' && local) {
      const child = graph.notes.get(ids.find((id) => graph.notes.get(id)?.parent && graph.notes.get(id).parent !== graph.root) || ids[0])
      out.headline = short(child?.text, 40)
    }
    if (step.detail) {
      out.detail = local ? { ...step.detail, caption: captionFor(styleId, 'deep', ids, graph, groups, texts) } : step.detail
      detailUsed = true
    } else if (!detailUsed && layoutId === 'dive' && !step.lane && ids.length >= 2) {
      const fine = ids.slice(1).map((id) => graph.notes.get(id)?.text).filter(Boolean).join(' · ')
      out.detail = { label: numberIn(ids, graph) || '★', fine: short(fine, 90), caption: captionFor(styleId, 'deep', ids, graph, groups, texts) }
      detailUsed = true
    }
    // A lane keeps the workshop's own words.
    if (local && !step.lane) {
      out.kicker = voiceKicker(styleId, middle, ctx.head, source.length - 1)
      out.caption = captionFor(styleId, layoutId, ids, graph, groups, texts, { index: middle, number: out.number })
    }
    return out
  }).filter(Boolean)
  const closing = local ? captionFor(styleId, 'finale', graph.list.map((note) => note.id), graph, groups, texts) || direction.closing : direction?.closing
  return normalizeDirection({ ...direction, closing, style: direction?.style?.overrides ? { id: styleId, overrides: direction.style.overrides } : styleId, steps }, layout, { name })
}

/**
 * The deck Slatebox composes without the AI: the style the slate's kind calls for, its title,
 * an overview, then the slate's groups in that style's rhythm of layouts (with a deep zoom into
 * a nested detail where the style flies), and the homecoming finale. Its captions and kickers are
 * the slate's own words in the style's voice. Deterministic.
 */
export function localDirection(layout, { name = '', scenes = [], style = null } = {}) {
  const graph = slateGraph(layout)
  const styleId = STYLES[style] ? style : pickStyle(layout, name)
  const def = STYLES[styleId]
  const groups = slateGroups(layout, graph)
  const texts = graph.list.map((note) => note.text)
  const rootText = graph.root ? graph.notes.get(graph.root).text : ''
  const title = short(name || rootText || 'This slate', 70)
  const kicker = rootText && !title.toLowerCase().includes(rootText.toLowerCase())
    ? short(rootText, 40) : `${groups.length} ideas · ${graph.list.length} notes`
  const allIds = graph.list.map((note) => note.id)
  const steps = [{ layout: 'overview', nodeIds: allIds, kicker: voiceKicker(styleId, 0), caption: captionFor(styleId, 'overview', allIds, graph, groups, texts) }]
  const lanes = scenes.filter((scene) => graph.notes.has(String(scene.nodeIds?.[0])))
  lanes.forEach((scene, index) => steps.push({
    layout: 'dive', nodeIds: scene.nodeIds.map(String).filter((id) => graph.notes.has(id)),
    kicker: `${pad2(index + 1)} · ${short(scene.label || scene.narrative, 40)}`, caption: cleanCaption(scene.narrative || ''), lane: true,
  }))
  const laneIds = new Set(lanes.flatMap((scene) => scene.nodeIds.map(String)))
  const left = groups.map((group) => ({ ...group, ids: group.ids.filter((id) => !laneIds.has(id)) })).filter((group) => group.ids.length)
  let rhythm = 0
  for (let i = 0; i < left.length && steps.length < MAX_STEPS; ) {
    const group = left[i]
    const next = left[i + 1]
    let layoutId = 'group'
    for (let k = 0; k < def.rhythm.length; k += 1) {
      const candidate = def.rhythm[(rhythm + k) % def.rhythm.length]
      const ids = (candidate === 'sweep' || candidate === 'compare') && next ? [...group.ids, ...next.ids] : group.ids
      if (canTake(candidate, ids, graph, groups)) {
        layoutId = candidate
        rhythm += k + 1
        break
      }
    }
    const pair = layoutId === 'sweep' || layoutId === 'compare'
    steps.push({ layout: layoutId, nodeIds: pair ? [...group.ids, ...next.ids] : group.ids, headline: short(group.text, 48) })
    i += pair ? 2 : 1
  }
  // The style's own layouts, numbers, quotes, pictures, detail, kickers and captions.
  const closing = captionFor(styleId, 'finale', allIds, graph, groups, texts) || HONEST_CLOSE
  return remixDirection({ style: styleId, title, kicker, cta: DEFAULT_CTA, closing, local: true, steps }, layout, styleId, { name })
}

const SAFE_IMAGE_URL = /^(https:\/\/[^\s"'<>]+|data:image\/svg\+xml[;,][^"<>]*)$/i
/** A picture link a deck may show: https, or the style's own drawn art (an SVG data URI). */
export const safeImageUrl = (url) => (typeof url === 'string' && url.length <= 200_000 && SAFE_IMAGE_URL.test(url) ? url : null)

const cleanImage = (image) => {
  if (!image || typeof image !== 'object') return null
  const query = short(image.query, 120)
  const prompt = short(image.prompt, 300)
  const why = short(image.why, 140)
  const url = safeImageUrl(image.url)
  const mask = P.MASK_NAMES.includes(image.mask) ? image.mask : null
  const role = ['backdrop', 'hero', 'icon'].includes(image.role) ? image.role : 'hero'
  const source = ['search', 'generated', 'upload'].includes(image.source) ? image.source : 'search'
  // No reason, no picture: an image the AI cannot tie to the slate is the style's own art.
  if (!why) return { art: true, query: query || prompt, role, mask }
  return { query, prompt, why, role, mask, ...(url ? { url, source, ...(typeof image.credit === 'string' ? { credit: short(image.credit, 120) } : {}) } : { art: !query && !prompt }) }
}

const queryKey = (query) => String(query || '').toLowerCase().replace(/\s+/g, ' ').trim()
/** Every picture slot a direction has: [{ image, set(patch) }] (the cover, each step's, a pair's). */
export function pictureSlots(direction) {
  const out = []
  if (direction?.cover) out.push({ image: direction.cover, set: (patch) => { direction.cover = { ...direction.cover, ...patch } } })
  ;(direction?.steps || []).forEach((step) => {
    if (step.image) out.push({ image: step.image, set: (patch) => { step.image = { ...step.image, ...patch } } })
    ;(step.images || []).forEach((image, k) => { if (image) out.push({ image, set: (patch) => { step.images[k] = { ...step.images[k], ...patch } } }) })
  })
  return out
}
/** How many pictures a direction still wants (a reason and a query, no picture yet). */
export const pendingImages = (direction) => pictureSlots(direction).filter(({ image }) => !image.url && image.why && (image.query || image.prompt)).length
/**
 * A direction with the pictures already found for it: each slot without a picture takes the one
 * `sources` (earlier directions, or lists of { query, url, source }) found for the same query.
 * A refine, a restyle or a later Present reuses pictures instead of paying for them again.
 */
export function carryImages(direction, sources = []) {
  const out = JSON.parse(JSON.stringify(direction || {}))
  const found = new Map()
  for (const source of [sources].flat()) {
    const list = Array.isArray(source) ? source : pictureSlots(JSON.parse(JSON.stringify(source || {}))).map(({ image }) => image)
    for (const image of list) {
      const url = safeImageUrl(image?.url)
      if (url && !url.startsWith('data:') && image.query && !found.has(queryKey(image.query))) found.set(queryKey(image.query), { url, source: image.source || 'search', ...(image.credit ? { credit: image.credit } : {}) })
    }
  }
  pictureSlots(out).forEach(({ image, set }) => {
    const hit = !image.url && image.why && found.get(queryKey(image.query))
    if (hit) set(hit)
  })
  return out
}

/**
 * A direction made safe to compose: a known style, the layouts in the vocabulary, only notes on
 * the slate, short captions that never repeat a note or shout placeholders, honest big numbers
 * and quotes, pictures with a reason and a safe link, and the variety rules (an overview first,
 * never one layout three times in a row, at least one surprising beat).
 */
export function normalizeDirection(raw, layout, { name = '' } = {}) {
  const graph = slateGraph(layout)
  const groups = slateGroups(layout, graph)
  const known = (id) => graph.notes.has(String(id))
  const texts = graph.list.map((note) => note.text)
  const styleId = STYLES[raw?.style?.id || raw?.style] ? (raw.style.id || raw.style) : pickStyle(layout, name)
  const def = STYLES[styleId]
  const rawSteps = (Array.isArray(raw?.steps) ? raw.steps : Array.isArray(raw?.segments) ? raw.segments : []).slice(0, MAX_STEPS * 2)
  let steps = rawSteps.map((step, index) => {
    if (!step || typeof step !== 'object') return null
    const layoutId = STEP_LAYOUTS.includes(step.layout) ? step.layout : 'group'
    const nodeIds = [...new Set([step.nodeIds ?? []].flat().filter((id) => typeof id === 'string' || typeof id === 'number').map(String))].filter(known).slice(0, 200)
    let caption = cleanCaption(typeof (step.caption ?? step.narrative) === 'string' ? (step.caption ?? step.narrative) : '')
    if (!caption || repeatsNote(caption, texts)) caption = nodeIds.length ? captionFor(styleId, layoutId, nodeIds, graph, groups, texts, { index }) : ''
    const out = { layout: layoutId, nodeIds, kicker: short(step.kicker, 48), caption }
    if (step.headline) out.headline = short(step.headline, 60)
    if (Array.isArray(step.headlines)) out.headlines = step.headlines.slice(0, 2).map((h) => short(h, 40))
    if (step.quote) out.quote = short(step.quote, 120)
    if (step.number != null) {
      out.number = short(String(step.number), 8)
      out.numberLabel = short(step.numberLabel, 60)
    }
    if (step.detail && typeof step.detail === 'object') {
      out.detail = { label: short(step.detail.label, 8) || '★', fine: short(step.detail.fine, 120), caption: cleanCaption(step.detail.caption) || captionFor(styleId, 'deep', nodeIds, graph, groups, texts) }
    }
    const image = cleanImage(step.image)
    if (image) out.image = image
    if (Array.isArray(step.images)) out.images = step.images.slice(0, 3).map(cleanImage).filter(Boolean)
    if (Number.isFinite(Number(step.roll))) out.roll = Number(step.roll)
    if (Number.isFinite(Number(step.duration))) out.duration = Math.round(Math.min(10000, Math.max(1500, Number(step.duration))))
    return out
  }).filter((step) => step?.nodeIds.length)
  steps.forEach((step) => {
    // Honest big numbers only.
    if (step.layout === 'bigNumber' && !(step.number && numberOnSlate(step.number, layout, graph))) {
      step.layout = 'hero'
      delete step.number
    }
    // A quote is a note's own words, shown in quote marks: the AI's words never pass as the slate's.
    // Otherwise the step's longest note is quoted, else it is a hero.
    if (step.quote && !quoteOnSlate(step.quote, step.nodeIds.map((id) => graph.notes.get(id)?.text))) {
      step.quote = quoteFrom(step.nodeIds, graph)
      if (!step.quote) delete step.quote
    }
    if (step.layout === 'quote' && !step.quote) step.layout = 'hero'
    if (step.layout !== 'quote') delete step.quote
  })
  // The wide shot comes first: an overview of the whole slate.
  if (steps[0]?.layout !== 'overview') {
    const allIds = graph.list.map((note) => note.id)
    steps.unshift({ layout: 'overview', nodeIds: allIds, kicker: voiceKicker(styleId, 0), caption: captionFor(styleId, 'overview', allIds, graph, groups, texts) })
  }
  steps = steps.slice(0, MAX_STEPS)
  // Never one layout three times running.
  for (let i = 2; i < steps.length; i += 1) {
    if (steps[i].layout === steps[i - 1].layout && steps[i].layout === steps[i - 2].layout) {
      steps[i].layout = def.rhythm.find((candidate) => candidate !== steps[i].layout && !['bigNumber', 'quote', 'sweep', 'compare'].includes(candidate)) || 'group'
    }
  }
  // At least one surprising beat: a trace home, else a deep zoom, else a big number.
  const surprising = steps.some((step) => SURPRISES.has(step.layout) || step.detail)
  if (!surprising && steps.length > 1) {
    const traceable = graph.root ? steps.findLastIndex((step, i) => i > 0 && !step.nodeIds.includes(graph.root)) : -1
    if (traceable > 0) steps[traceable].layout = 'trace'
    else {
      const dive = steps.findIndex((step, i) => i > 0)
      if (dive > 0) steps[dive].detail = { label: '★', fine: short(texts.join(' · '), 90), caption: captionFor(styleId, 'deep', steps[dive].nodeIds, graph, groups, texts) }
    }
  }
  const cta = short(raw?.cta, 28) || DEFAULT_CTA
  let closing = cleanCaption(typeof raw?.closing === 'string' ? raw.closing : HONEST_CLOSE)
  if (closing && closing.toLowerCase().includes(cta.toLowerCase())) closing = ''
  if (repeatsNote(closing, texts)) closing = HONEST_CLOSE
  const overrides = raw?.style?.overrides
  return {
    version: DECK_VERSION,
    style: cleanStyleRef(overrides ? { id: styleId, overrides } : styleId),
    title: short(raw?.title || name || 'This slate', 80),
    kicker: short(raw?.kicker, 48),
    subtitle: short(raw?.subtitle, 100),
    cta,
    closing,
    ...(raw?.local === true ? { local: true } : {}),
    ...(cleanImage(raw?.cover) ? { cover: cleanImage(raw.cover) } : {}),
    steps,
  }
}

// ─── composition ────────────────────────────────────────────────────────────

// Average advance per character, as a share of the size (measured high: a serif's capitals run wide).
const CHAR = { Anton: 0.48, Caveat: 0.44, 'Abril Fatface': 0.6, Fraunces: 0.6, Inter: 0.58, 'Space Grotesk': 0.58, 'IBM Plex Mono': 0.62, 'PT Sans': 0.52 }
/** The largest font size (≤ max) at which `text` wraps into a w×h box. */
export function fitFont(text, w, h, max, font = 'Inter', min = 4) {
  const cw = (CHAR[font] || 0.55) * 1.06
  const list = words(text)
  if (!list.length) return Math.max(min, Math.min(max, h * 0.6))
  const longest = Math.max(...list.map((word) => word.length))
  for (let size = max; size > min; size *= 0.93) {
    // A word is never broken: the longest one fits on its own line.
    if (longest * cw * size > w * 0.94) continue
    let lines = 1
    let line = 0
    for (const word of list) {
      const len = (word.length + 1) * cw * size
      if (line && line + len > w * 0.94) {
        lines += 1
        line = len
      } else line += len
    }
    if (lines * size * 1.18 <= h * 0.96) return Math.round(size * 10) / 10
  }
  return min
}

/**
 * The deck to play: { version, style, skin, lines, stageNotes, steps }. `skin` maps each slate note
 * to its look (x, y, width, height and options; its centre never moves), `lines` each connection
 * to its look, `stageNotes` are the notes the style adds (with `steps`: where they show, or
 * 'all'), and `steps` the viewpoints (nodeIds, narrative, duration, layout, kicker, camera, lit,
 * reveal), first the title (or cover) and last the finale.
 */
export function composeDeck(layout, rawDirection, { style: styleRef = null } = {}) {
  const graph = slateGraph(layout)
  // A direction from anywhere (an old save, a published row, a live session) composes: missing
  // steps are none, a step without notes is skipped, a missing title is the default.
  const direction = {
    ...(rawDirection && typeof rawDirection === 'object' ? rawDirection : {}),
    steps: (Array.isArray(rawDirection?.steps) ? rawDirection.steps : []).filter((step) => step && typeof step === 'object'),
  }
  direction.title = typeof direction.title === 'string' && direction.title ? direction.title : 'This slate'
  direction.cta = typeof direction.cta === 'string' && direction.cta ? direction.cta : DEFAULT_CTA
  const ref = cleanStyleRef(styleRef || direction?.style || DEFAULT_STYLE)
  const style = resolveStyle(ref)
  const U = graph.unit
  const B = graph.box
  const kit = style.kit
  const allIds = graph.list.map((note) => note.id)
  const roleOf = (id) => (id === graph.root ? 'root' : graph.root ? (graph.notes.get(id)?.parent === graph.root ? 'branch' : 'leaf') : (graph.notes.get(id)?.children.length ? 'branch' : 'leaf'))
  const groupsIndex = new Map()
  slateGroups(layout, graph).forEach((group, index) => group.ids.forEach((id) => groupsIndex.set(id, index)))
  const branch = (id) => graph.branchOf.get(id) ?? groupsIndex.get(id) ?? 0

  // 1. The slate's notes in the style: same centres, the root grown where it has room.
  const skin = {}
  const boxes = new Map()
  graph.list.forEach((note) => {
    const role = roleOf(note.id)
    const look = style.skin(role, branch(note.id), style.palette, note.id)
    let { width, height } = note.box
    if (look.grow && role === 'root') {
      const side = Math.max(width, height)
      for (let g = look.grow; g >= 1; g -= 0.1) {
        const grown = { x: note.box.x + width / 2 - (side * g) / 2, y: note.box.y + height / 2 - (side * g) / 2, width: side * g, height: side * g }
        if (!graph.list.some((other) => other.id !== note.id && overlaps(grown, other.box, U * 0.2))) {
          width = side * g
          height = side * g
          break
        }
      }
    }
    const c = centre(note.box)
    const { grow, fontScale, rotate, image, ...options } = look
    const box = { x: c.x - width / 2, y: c.y - height / 2, width, height }
    boxes.set(note.id, box)
    // The silhouette's inner safe area: the text keeps inside its outline.
    const inset = P.textInsetFor(look.vectorPath) || (look.shape === 'circle' ? { left: 0.15, right: 0.15, top: 0.15, bottom: 0.15 } : null)
    const innerW = width * (1 - (inset?.left || 0) - (inset?.right || 0))
    const innerH = height * (1 - (inset?.top || 0) - (inset?.bottom || 0))
    skin[note.id] = {
      ...options,
      x: box.x, y: box.y, width, height,
      ...(inset ? { textInset: inset } : {}),
      // The style's size, made smaller where the note's words would not fit its shape.
      fontSize: Math.min(
        Math.round(Math.min(height, U) * (fontScale || 0.32) * (role === 'root' ? Math.min(2.2, height / U) : 1) * 10) / 10,
        fitFont(note.text, innerW * 0.92 - 14, innerH * 0.86, U * 2, look.fontFamily),
      ),
      ...(rotate ? { rotate: { rotationAngle: rotate } } : {}),
      ...(image === 'art' ? { image: artImage({ kind: style.art, palette: style.palette, bg: style.bg, seedText: note.text, width: 800, height: 800 }), imageOrigWidth: width, imageOrigHeight: height, imageFit: 'cover' } : {}),
    }
  })
  const lines = {}
  graph.list.forEach((note) => {
    if (note.parent) lines[`${note.parent}->${note.id}`] = style.line(roleOf(note.parent), branch(note.id), style.palette)
  })

  // 2. Stage notes in free space.
  const stageNotes = []
  const blockers = graph.list.map((note) => inflate(boxes.get(note.id), U * 0.35))
  const isFree = (box, extra = [], only = null) => ![...(only || blockers), ...extra].some((b) => overlaps(box, b))
  // A free spot for a w×h block beside `anchor`, preferring the side away from the slate's middle.
  // Landscape frames grow sideways (a wide screen), portrait ones up and down (a phone).
  const place = (w, h, anchor, { gap = U * 0.8, sides = null, avoid = [], portrait = false, only = null } = {}) => {
    const c = centre(anchor)
    const m = centre(B)
    const across = c.x >= m.x ? ['right', 'left'] : ['left', 'right']
    const down = c.y >= m.y ? ['below', 'above'] : ['above', 'below']
    const order = sides || (portrait ? [...down, ...across] : [...across, ...down])
    for (let push = 0; push < 60; push += 1) {
      for (const side of order) {
        const step = push * U * 0.75
        let box
        if (side === 'right') box = { x: anchor.x + anchor.width + gap + step, y: c.y - h / 2, width: w, height: h }
        if (side === 'left') box = { x: anchor.x - gap - w - step, y: c.y - h / 2, width: w, height: h }
        if (side === 'below') box = { x: c.x - w / 2, y: anchor.y + anchor.height + gap + step, width: w, height: h }
        if (side === 'above') box = { x: c.x - w / 2, y: anchor.y - gap - h - step, width: w, height: h }
        if (isFree(box, avoid, only)) return box
      }
    }
    return { x: B.x + B.width + gap, y: c.y - h / 2, width: w, height: h }
  }
  // A column of blocks (each { w, h, ... }) as one box, laid out top to bottom.
  const column = (blocks, at, gap = U * 0.3) => {
    let y = at.y
    return blocks.map((block) => {
      const out = { ...block, x: at.x + (block.indent || 0), y }
      y += block.h + gap
      return out
    })
  }
  const columnSize = (blocks, gap = U * 0.3) => ({ w: Math.max(...blocks.map((b) => b.w + (b.indent || 0))), h: blocks.reduce((s, b) => s + b.h, 0) + gap * (blocks.length - 1) })
  let serial = 0
  const add = (kind, geometry, options, steps, portrait = null) => {
    serial += 1
    const id = `sb-stage-${serial}-${kind}`
    const inset = options.text && options.vectorPath ? P.textInsetFor(options.vectorPath) : null
    const note = { id, kind, x: geometry.x, y: geometry.y, w: geometry.w ?? geometry.width, h: geometry.h ?? geometry.height, ...(inset ? { textInset: inset } : {}), ...options, steps }
    note.p = portrait ? { x: portrait.x, y: portrait.y, w: portrait.w ?? portrait.width, h: portrait.h ?? portrait.height, ...(portrait.fontSize ? { fontSize: portrait.fontSize } : {}) } : { x: note.x, y: note.y, w: note.w, h: note.h }
    stageNotes.push(note)
    return id
  }
  const textNote = (text, font, size, color, extra = {}) => ({ text, fontFamily: font, fontSize: size, fontColor: color, backgroundColor: 'transparent', borderWidth: 0, textXAlign: 'left', ...extra })
  const imageSrc = (image, seed) => safeImageUrl(image?.url) || artImage({ kind: style.art, palette: style.palette, bg: style.bg, seedText: image?.query || seed })
  const maskOf = (image, index) => P.MASKS[image?.mask] || P.MASKS[style.masks[index % style.masks.length]] || P.MASKS.rect
  const fontWeight = (k) => (k.weight ? { fontWeight: k.weight } : {})

  const steps = []
  const rollMax = style.motion.rollMax
  const clampRoll = (r) => Math.max(-rollMax, Math.min(rollMax, Number(r) || 0))
  const pushStep = (step) => {
    steps.push({
      duration: 3200, lit: step.lit ?? step.nodeIds, reveal: style.motion.reveal, ...step,
      narrative: cleanCaption(step.narrative ?? ''),
      camera: { fill: 0.86, roll: 0, ...step.camera, roll: clampRoll(step.camera?.roll) },
    })
    return steps.length - 1
  }

  // 3. The opening: a title card left of the slate (a cover or a full-bleed backdrop by style).
  const root = graph.root
  const rootBox = root ? boxes.get(root) : null
  const anchorY = rootBox ? centre(rootBox).y : centre(B).y
  const bookend = []
  const titleSteps = [0, 'finale']
  const titleText = direction.title
  const kickerText = direction.kicker
  let ctaAnchor = null
  let ctaPortrait = null
  let openingCamera
  let openingLayout = 'title'
  if (style.titleBackdrop) {
    const w = U * 34
    const h = U * 21
    const box = { x: B.x - U * 4 - w, y: anchorY - h / 2, w, h }
    // On a phone the backdrop stands up: the same centre, a portrait card.
    const pBox = { x: box.x + w / 2 - U * 8.5, y: box.y + h / 2 - U * 15, w: U * 17, h: U * 30 }
    const pw = U * 14
    const backdropImage = direction.cover || { query: direction.title, role: 'backdrop' }
    bookend.push(add('image', box, { image: imageSrc(backdropImage, titleText), imageFit: 'cover', borderWidth: 0, backgroundColor: style.bg, behind: true }, titleSteps, pBox))
    // A photo needs a deep scrim for the words to read; the style's own drawn art is dark already.
    bookend.push(add('scrim', box, { backgroundColor: '#000000', opacity: backdropImage.url ? 0.64 : 0.3, borderWidth: 0, behind: true }, titleSteps, pBox))
    const headSize = fitFont(titleText, w - U * 3, h * 0.42, U * kit.title.size * 1.4, kit.title.font)
    const headP = { x: pBox.x + (pBox.w - pw) / 2, y: pBox.y + pBox.h * 0.22, w: pw, h: pBox.h * 0.34 }
    bookend.push(add('title', { x: box.x + U * 1.5, y: box.y + h * 0.18, w: w - U * 3, h: h * 0.42 }, textNote(titleText, kit.title.font, headSize, kit.title.color, fontWeight(kit.title)), titleSteps,
      { ...headP, fontSize: fitFont(titleText, headP.w, headP.h, U * 3.4, kit.title.font) }))
    if (kickerText) {
      const subP = { x: headP.x, y: headP.y + headP.h + U * 0.5, w: pw, h: U * 3.2 }
      bookend.push(add('kicker', { x: box.x + U * 1.5, y: box.y + h * 0.62, w: w - U * 3, h: U * 2.4 }, textNote(kickerText, kit.headline.font, fitFont(kickerText, w - U * 3, U * 2.4, U * 1.4, kit.headline.font), style.chrome.accent), titleSteps,
        { ...subP, fontSize: fitFont(kickerText, subP.w, subP.h, U * 1.4, kit.headline.font) }))
    }
    ctaAnchor = { x: box.x + U * 1.5, y: box.y + h * 0.8, w: U * 11, h: U * 2.2 }
    ctaPortrait = { x: headP.x, y: pBox.y + pBox.h * 0.74, w: U * 11, h: U * 2.2 }
    openingCamera = { frame: [bookend[0]], cover: true, fill: 1 }
  } else if (style.cover) {
    openingLayout = 'cover'
    const w = U * 28
    const blocks = [
      { key: 'title', w, h: U * 3.6 },
      { key: 'rule', w: w - U * 0.5, h: U * 0.12 },
      { key: 'kicker', w: w - U * 0.5, h: U * 0.8 },
      { key: 'photo', w: U * 15, h: U * 10 },
    ]
    const size = columnSize(blocks)
    const at = { x: B.x - U * 4 - size.w, y: anchorY - size.h / 2 }
    const pW = U * 14.6
    const pBlocks = [{ key: 'title', w: pW, h: U * 7 }, { key: 'rule', w: pW, h: U * 0.12 }, { key: 'kicker', w: pW, h: U * 1.6 }, { key: 'photo', w: pW, h: U * 9.6 }, { key: 'deck', w: pW, h: U * 4.6 }]
    const pSize = columnSize(pBlocks)
    const pAt = { x: B.x - U * 4 - pSize.w, y: anchorY - pSize.h / 2 }
    const placed = column(blocks, at)
    const pPlaced = column(pBlocks, pAt)
    const pOf = (key) => pPlaced.find((b) => b.key === key)
    placed.forEach((b) => {
      const pb = pOf(b.key)
      if (b.key === 'title') bookend.push(add('title', b, textNote(titleText, kit.title.font, fitFont(titleText, b.w, b.h, U * kit.title.size, kit.title.font), kit.title.color), titleSteps, { ...pb, fontSize: fitFont(titleText, pb.w, pb.h, U * 2.6, kit.title.font) }))
      if (b.key === 'rule') bookend.push(add('rule', b, { vectorPath: kit.underline.path, backgroundColor: kit.underline.fill, borderWidth: 0 }, titleSteps, pb))
      if (b.key === 'kicker') {
        const issue = `No. 01  ·  ${kickerText || 'A Slatebox presentation'}`
        bookend.push(add('kicker', b, textNote(issue, 'Inter', fitFont(issue, b.w, b.h, U * 0.45, 'Inter'), kit.kicker.color, { fontWeight: 'bold' }), titleSteps, { ...pb, fontSize: fitFont(issue, pb.w, pb.h, U * 0.5, 'Inter') }))
      }
      if (b.key === 'photo') bookend.push(add('image', b, { vectorPath: P.MASKS.torn, image: imageSrc(direction.cover || { query: titleText }, titleText), imageFit: 'cover', borderWidth: 0, rotate: { rotationAngle: -2 } }, titleSteps, pb))
    })
    const deckText = direction.subtitle || `A field guide in ${direction.steps.length} stops.`
    const deckBox = { x: at.x + U * 15.6, y: placed.find((b) => b.key === 'photo').y, w: w - U * 15.6, h: U * 6 }
    const pd = pOf('deck')
    bookend.push(add('subtitle', deckBox, textNote(deckText, kit.headline.font, fitFont(deckText, deckBox.w, deckBox.h, U * 0.95, kit.headline.font), kit.title.color, { fontStyle: 'italic', textYAlign: 'top' }), titleSteps, { ...pd, fontSize: fitFont(deckText, pd.w, pd.h, U * 1, kit.headline.font) }))
    ctaAnchor = { x: deckBox.x, y: deckBox.y + deckBox.h + U * 0.6, w: U * 10, h: U * 2 }
    ctaPortrait = { x: pd.x, y: pd.y + pd.h + U * 0.4, w: U * 10, h: U * 2 }
    openingCamera = { frame: [...bookend], fill: 0.92 }
  } else {
    const w = U * 21.6
    const titleH = U * 5.4
    const pW = U * 11.4
    const blocks = [{ key: 'kicker', w: U * 8.4, h: U * 1.2 }, { key: 'title', w, h: titleH }, { key: 'underline', w: U * 14.6, h: U * 1.3 }]
    const pBlocks = [{ key: 'kicker', w: U * 8.4, h: U * 1.2 }, { key: 'title', w: pW, h: U * 10.7 }, { key: 'underline', w: U * 10, h: U * 1.1 }]
    const size = columnSize(blocks)
    const pSize = columnSize(pBlocks)
    const at = { x: B.x - U * 3 - size.w, y: anchorY - size.h / 2 }
    const pAt = { x: B.x - U * 3 - pSize.w, y: anchorY - pSize.h / 2 }
    const placed = column(blocks, at)
    const pPlaced = column(pBlocks, pAt)
    const pOf = (key) => pPlaced.find((b) => b.key === key)
    const titleBox = placed.find((b) => b.key === 'title')
    const rot = kit.title.rotate ? { rotate: { rotationAngle: kit.title.rotate } } : {}
    // A highlighter swipe sits behind the title (sketch); other styles underline it.
    if (kit.underline?.behind) {
      const hb = { x: titleBox.x - U * 0.4, y: titleBox.y + titleBox.h * 0.45, w: titleBox.w * 0.9, h: titleBox.h * 0.5 }
      const pt = pOf('title')
      bookend.push(add('highlight', hb, { vectorPath: kit.underline.path, backgroundColor: kit.underline.fill, borderWidth: 0, behind: true, ...rot }, titleSteps, { x: pt.x - U * 0.3, y: pt.y + pt.h * 0.5, w: pt.w * 0.95, h: pt.h * 0.42 }))
    }
    placed.forEach((b) => {
      const pb = pOf(b.key)
      if (b.key === 'kicker' && kickerText) {
        const k = kit.kicker
        const kw = Math.min(b.w * 1.6, Math.max(U * 5, kickerText.length * U * 0.32))
        const kickerOpts = k.path
          ? { vectorPath: k.path, backgroundColor: k.fill, text: kickerText, fontFamily: k.font, fontWeight: 'bold', fontSize: fitFont(kickerText, kw * 0.86, b.h, U * 0.5, k.font), fontColor: k.color, borderWidth: 0 }
          : textNote(kickerText, k.font, fitFont(kickerText, kw, b.h, U * 0.6, k.font), k.color, { fontWeight: 'bold' })
        bookend.push(add('kicker', { ...b, w: kw }, kickerOpts, titleSteps, { ...pb, w: Math.min(pb.w * 1.3, kw) }))
      }
      if (b.key === 'title') {
        bookend.push(add('title', b, textNote(titleText, kit.title.font, fitFont(titleText, b.w, b.h, U * kit.title.size, kit.title.font), kit.title.color, { ...fontWeight(kit.title), ...rot }), titleSteps,
          { ...pb, fontSize: fitFont(titleText, pb.w, pb.h, U * kit.title.size * 1.15, kit.title.font) }))
      }
      if (b.key === 'underline' && kit.underline && !kit.underline.behind) {
        if (kit.underline.bolt) {
          // Above the title's far end, clear of the kicker and of the slate.
          const bolt = { x: titleBox.x + titleBox.w - U * 4.2, y: titleBox.y - U * 5.6, w: U * 3.4, h: U * 5.2 }
          const pt = pOf('title')
          bookend.push(add('bolt', bolt, { vectorPath: kit.underline.path, backgroundColor: kit.underline.fill, borderWidth: 0, rotate: { rotationAngle: 14 } }, titleSteps, { x: pt.x + pt.w - U * 3, y: pt.y - U * 4, w: U * 3, h: U * 4.6 }))
        } else bookend.push(add('underline', b, { vectorPath: kit.underline.path, backgroundColor: kit.underline.fill, borderWidth: 0 }, titleSteps, pb))
      }
    })
    const last = placed.at(-1)
    const pLast = pPlaced.at(-1)
    ctaAnchor = { x: at.x, y: last.y + last.h + U * 0.9, w: U * 10, h: U * 2.2 }
    ctaPortrait = { x: pAt.x, y: pLast.y + pLast.h + U * 0.9, w: U * 10, h: U * 2.2 }
    openingCamera = { frame: [...bookend, ...(root ? [root] : [])], fill: 0.88 }
  }
  // What the opening lights is what it frames (a cover frames its own column, not the root).
  const openingLit = openingCamera.cover ? [...bookend] : [...new Set([...openingCamera.frame, ...bookend])]
  // The opening shows the whole slate's story to come: it is the deck's start (step 0 of the
  // counter, where a better plan takes its place unseen), lighting only its title card.
  pushStep({ layout: openingLayout, nodeIds: allIds, lit: openingLit, narrative: '', kicker: '', camera: openingCamera, duration: 4200 })
  const bookendBoxes = stageNotes.filter((note) => bookend.includes(note.id)).map((note) => inflate({ x: note.x, y: note.y, width: note.w, height: note.h }, U * 0.3))
  blockers.push(...bookendBoxes)

  // 4. The middle steps.
  const stepNotes = []
  const markAll = []
  direction.steps.forEach((s, index) => {
    const ids = (Array.isArray(s.nodeIds) ? s.nodeIds : []).map(String).filter((id) => boxes.has(id))
    if (!ids.length) return
    const at = steps.length
    const gBox = unionBoxes(ids.map((id) => boxes.get(id)))
    const lead = ids.find((id) => roleOf(id) === 'branch') || ids[0]
    const leadBox = boxes.get(lead)
    const kicker = typeof s.kicker === 'string' ? s.kicker : ''
    const narrative = typeof s.caption === 'string' ? s.caption : ''
    const roll = Number.isFinite(Number(s.roll)) && s.roll !== null ? Number(s.roll) : null
    const own = []
    const avoid = []
    const pAvoid = []
    const boxOfBlock = (box) => inflate({ x: box.x, y: box.y, width: box.w ?? box.width, height: box.h ?? box.height }, U * 0.3)
    const reserve = (box) => avoid.push(boxOfBlock(box))
    const headline = (text, w, h, max) => textNote(text, kit.headline.font, fitFont(text, w, h, max, kit.headline.font), kit.headline.color, fontWeight(kit.headline))
    // On a phone a block keeps to a column (a picture as wide as the step's notes, so it stays the
    // biggest thing in the frame).
    const portraitOf = (block, scale = 1.25) => (block.pw
      ? { ...block, w: block.pw, h: block.h * (block.pw / block.w) * scale }
      : { ...block, w: Math.max(U * 4, Math.min(block.w, U * 11)), h: block.h * scale })
    const placeColumn = (blocks, anchor, opts) => {
      const size = columnSize(blocks)
      const box = place(size.w, size.h, anchor, { avoid, ...opts })
      const placed = column(blocks, { x: box.x, y: box.y })
      placed.forEach(reserve)
      // A block with its own phone geometry (a picture behind the step's notes) keeps it.
      blocks.filter((b) => b.pAt).forEach((b) => pAvoid.push(boxOfBlock(b.pAt)))
      const pBlocks = blocks.filter((b) => !b.pAt).map((b) => portraitOf(b, b.pScale || 1.25))
      let pStacked = []
      if (pBlocks.length) {
        const pSize = columnSize(pBlocks)
        // On a phone the step's blocks stack beside or under its notes, never on each other.
        // Beside a backdrop picture the words go just under it, over the dimmed neighbours only:
        // the step's own notes and the deck's fixed notes stay clear.
        const only = blocks.some((b) => b.pAt) ? [...ids.map((id) => inflate(boxes.get(id), U * 0.35)), ...blockers.slice(graph.list.length)] : null
        const pBox = place(pSize.w, pSize.h, anchor, { avoid: pAvoid, portrait: true, ...(only ? { only, sides: ['below', 'above'] } : {}), ...opts })
        pStacked = column(pBlocks, { x: pBox.x, y: pBox.y })
        pStacked.forEach((b) => pAvoid.push(boxOfBlock(b)))
      }
      const pPlaced = blocks.map((b) => b.pAt || pStacked.shift())
      return { placed, pPlaced }
    }
    // On a phone a step frames its own stacked column (a picture, a headline): big and readable.
    // A hero keeps its note beside its bubble.
    // The camera frames everything the step lights, on a wide screen and on a phone alike.
    const ownCamera = (extra = {}) => ({ frame: [...ids, ...own], roll, ...extra })
    const L = STEP_LAYOUTS.includes(s.layout) ? s.layout : 'group'
    if (L === 'overview') {
      pushStep({ layout: 'overview', nodeIds: allIds, lit: allIds, kicker, narrative, camera: { frame: allIds, roll: roll ?? -Math.min(4, rollMax / 3), fill: 0.92 }, duration: 3600 })
      return
    }
    if (L === 'dive' || L === 'split' || L === 'group' || L === 'hero' || L === 'bigNumber' || L === 'quote' || L === 'treeBuild') {
      const blocks = []
      const tilt = L === 'dive' ? Math.round(rollMax * 0.66) : 0
      if (L === 'dive' || L === 'split') {
        const image = s.image || { query: s.headline || graph.notes.get(lead)?.text }
        // On a phone the picture is the step's backdrop: full width behind its notes, so it is the
        // biggest thing in the frame and the notes stay in it.
        blocks.push({ key: 'image', w: U * 10, h: U * 7, pAt: { x: gBox.x - U * 0.8, y: gBox.y - U * 0.8, w: gBox.width + U * 1.6, h: gBox.height + U * 1.6 }, opts: { vectorPath: maskOf(image, index), image: imageSrc(image, s.headline), imageFit: 'cover', borderColor: kit.imageBorder.color, borderWidth: kit.imageBorder.width, backgroundColor: style.bg, why: image.why || '', art: !image.url } })
      }
      if (L === 'bigNumber') {
        blocks.push({ key: 'number', w: U * 10, h: U * 9, pScale: 1, text: s.number })
        blocks.push({ key: 'bar', w: U * 9.3, h: U * 0.16, pScale: 1 })
        blocks.push({ key: 'label', w: U * 11.4, h: U * 2.3, text: s.numberLabel || s.headline || '' })
      }
      if (L === 'quote') {
        blocks.push({ key: 'marks', w: U * 3, h: U * 2.3, pScale: 1 })
        blocks.push({ key: 'quote', w: U * 14.6, h: U * 4.2, pScale: 2.2, text: `${s.quote}` })
        blocks.push({ key: 'attr', w: U * 12.5, h: U * 0.8, text: `— from “${short(graph.notes.get(lead)?.text, 40)}”` })
      }
      if (L === 'hero') blocks.push({ key: 'bubble', w: U * 6.6, h: U * 3.4, pScale: 1.2, text: s.headline || short(graph.notes.get(lead)?.text, 40) })
      if (L === 'treeBuild') blocks.push({ key: 'brace', w: U * 0.9, h: Math.max(U * 3, gBox.height * 0.9), pScale: 1 })
      if (['dive', 'split', 'group', 'treeBuild'].includes(L) && s.headline) blocks.push({ key: 'headline', w: U * 10.7, h: U * 2.8, pScale: 1.3, text: s.headline })
      if (!blocks.length) blocks.push({ key: 'headline', w: U * 10.7, h: U * 2.8, text: s.headline || short(graph.notes.get(lead)?.text, 48) })
      const { placed, pPlaced } = placeColumn(blocks, L === 'hero' ? leadBox : gBox)
      placed.forEach((b, k) => {
        const pb = pPlaced[k]
        const r = tilt ? { rotate: { rotationAngle: -tilt } } : {}
        if (b.key === 'image') own.push(add('image', b, { ...b.opts, ...r, ...(b.pAt ? { behind: true, opacity: 0.9 } : {}) }, [at], pb))
        if (b.key === 'headline') own.push(add('headline', b, { ...headline(b.text, b.w, b.h, U * 1.15), ...r }, [at], { ...pb, fontSize: fitFont(b.text, pb.w, pb.h, U * 1.5, kit.headline.font) }))
        if (b.key === 'number') own.push(add('number', b, textNote(b.text, kit.number.font, fitFont(b.text, b.w, b.h, U * 8, kit.number.font), kit.number.color, { ...fontWeight(kit.number), textXAlign: 'center' }), [at], { ...pb, fontSize: fitFont(b.text, pb.w, pb.h, U * 8, kit.number.font) }))
        if (b.key === 'bar') own.push(add('bar', b, { backgroundColor: kit.number.color, borderWidth: 0 }, [at], pb))
        if (b.key === 'label') own.push(add('label', b, textNote(b.text, kit.headline.font, fitFont(b.text, b.w, b.h, U * 0.7, kit.headline.font), style.chrome.ink), [at], { ...pb, fontSize: fitFont(b.text, pb.w, pb.h, U * 0.9, kit.headline.font) }))
        if (b.key === 'marks') own.push(add('quote-marks', b, { vectorPath: kit.quote.path, backgroundColor: kit.quote.fill, borderWidth: 0 }, [at], pb))
        if (b.key === 'quote') own.push(add('quote', b, textNote(b.text, kit.quote.font, fitFont(b.text, b.w, b.h, U * 1.3, kit.quote.font), kit.quote.color, kit.quote.italic ? { fontStyle: 'italic' } : {}), [at], { ...pb, fontSize: fitFont(b.text, pb.w, pb.h, U * 1.6, kit.quote.font) }))
        if (b.key === 'attr') own.push(add('attribution', b, textNote(b.text, style.fonts.body, fitFont(b.text, b.w, b.h, U * 0.4, style.fonts.body), style.chrome.accent), [at], { ...pb, fontSize: fitFont(b.text, pb.w, pb.h, U * 0.5, style.fonts.body) }))
        if (b.key === 'bubble') {
          const k = kit.bubble
          own.push(add('bubble', b, { vectorPath: k.path, backgroundColor: k.fill, borderColor: k.border || k.fill, borderWidth: k.border ? 2.5 : 0, text: b.text, fontFamily: k.font, fontSize: fitFont(b.text, b.w * 0.82, b.h * 0.62, U * 0.9, k.font), fontColor: k.color, textOffset: { y: -b.h * 0.08 }, rotate: { rotationAngle: 5 } }, [at], { ...pb, fontSize: fitFont(b.text, pb.w * 0.82, pb.h * 0.62, U * 1.1, k.font) }))
        }
        if (b.key === 'brace') own.push(add('brace', b, { vectorPath: kit.brace.path, backgroundColor: kit.brace.fill, borderWidth: 0 }, [at], pb))
      })
      const camera = L === 'dive'
        ? ownCamera({ roll: roll ?? tilt })
        : L === 'hero' ? ownCamera({ roll: roll ?? -Math.round(rollMax * 0.4) })
          : L === 'quote' ? { frame: [...own, ...ids], roll: roll ?? -Math.min(2, rollMax) }
            : L === 'bigNumber' ? { frame: [...own, ...ids], roll: roll ?? 0 }
              : ownCamera()
      pushStep({ layout: L, nodeIds: ids, lit: [...ids, ...own], kicker, narrative, camera, duration: s.duration || (L === 'hero' || L === 'bigNumber' ? 4200 : 3400), reveal: L === 'treeBuild' ? 'stagger' : style.motion.reveal })
      stepNotes.push(...own)
      // A nested detail: a speck in the overview, legible only when the camera dives into it.
      // Every style keeps this step (a switch keeps the steps); the style decides how the camera gets there.
      if (s.detail && L === 'dive') {
        const size = U * 1.25
        const spot = place(size * 1.9, size * 2.3, leadBox, { gap: U * 0.4, avoid })
        const sticker = add('sticker', { x: spot.x + size * 0.45, y: spot.y, w: size, h: size }, { vectorPath: kit.sticker.path, backgroundColor: kit.sticker.fill, borderColor: kit.sticker.border || kit.sticker.fill, borderWidth: kit.sticker.border ? 1.5 : 0, text: s.detail.label, fontFamily: kit.sticker.font, fontSize: fitFont(s.detail.label, size * 0.7, size * 0.6, size * 0.36, kit.sticker.font), fontColor: kit.sticker.color, rotate: { rotationAngle: 12 } }, 'all')
        const fine = add('fine-print', { x: spot.x, y: spot.y + size * 1.15, w: size * 1.9, h: size * 0.8 }, textNote(s.detail.fine, style.fonts.body, Math.max(2, fitFont(s.detail.fine, size * 1.9, size * 0.8, U * 0.095, style.fonts.body, 1)), style.chrome.ink, { textXAlign: 'center', fontWeight: 'bold', rotate: { rotationAngle: 12 } }), 'all')
        markAll.push(sticker, fine)
        reserve(spot)
        // The speck shows on every step: nothing placed later sits on it, on any screen.
        blockers.push(inflate(spot, U * 0.2))
        // Only the detail is lit: everything else falls far back, so nothing sits behind the caption.
        pushStep({ layout: 'dive', deep: true, dim: 0.05, nodeIds: [lead], lit: [sticker, fine], kicker: 'Look closer', narrative: s.detail.caption || '', camera: { frame: [sticker, fine], fill: 0.6, roll: -rollMax, deep: true }, duration: 3600 })
      }
      return
    }
    if (L === 'sweep' || L === 'compare') {
      // Two (or three) groups side by side: each with its picture (sweep) or its heading (compare).
      const parts = slateGroups(layout, graph).filter((group) => group.ids.some((id) => ids.includes(id))).slice(0, 3)
      const groupsHere = parts.length >= 2 ? parts : [{ ids, lead, box: gBox, text: '' }]
      groupsHere.forEach((group, k) => {
        if (L === 'sweep') {
          const image = s.images?.[k] || s.image || { query: group.text }
          if (style.polaroid) {
            const blocks = [{ key: 'card', w: U * 5.5, h: U * 6.4, pScale: 1 }]
            const { placed, pPlaced } = placeColumn(blocks, group.box)
            const card = placed[0]
            const pc = pPlaced[0]
            const tilt = k % 2 ? 6 : -5
            const rotate = { rotate: { rotationAngle: tilt } }
            own.push(add('polaroid', card, { backgroundColor: '#ffffff', borderColor: '#dddddd', borderWidth: 1, filters: { vect: 'dropShadow' }, ...rotate }, [at], pc))
            own.push(add('image', { x: card.x + U * 0.3, y: card.y + U * 0.3, w: U * 4.9, h: U * 4.3 }, { image: imageSrc(image, group.text), imageFit: 'cover', borderWidth: 0, backgroundColor: '#eeeeee', why: image.why || '', art: !image.url, ...rotate }, [at], { x: pc.x + U * 0.3, y: pc.y + U * 0.3, w: U * 4.9, h: U * 4.3 }))
            const label = short(group.text, 24)
            own.push(add('label', { x: card.x + U * 0.3, y: card.y + U * 4.8, w: U * 4.9, h: U * 1.2 }, textNote(label, kit.headline.font, fitFont(label, U * 4.9, U * 1.2, U * 0.75, kit.headline.font), '#222222', { textXAlign: 'center', ...rotate }), [at], { x: pc.x + U * 0.3, y: pc.y + U * 4.8, w: U * 4.9, h: U * 1.2 }))
            own.push(add('tape', { x: card.x + U * 1.7, y: card.y - U * 0.35, w: U * 2.1, h: U * 0.64 }, { backgroundColor: style.palette[(k + 1) % style.palette.length], opacity: 0.85, borderWidth: 0, rotate: { rotationAngle: tilt + 8 } }, [at], { x: pc.x + U * 1.7, y: pc.y - U * 0.35, w: U * 2.1, h: U * 0.64 }))
          } else {
            const { placed, pPlaced } = placeColumn([{ key: 'image', w: U * 4.8, h: U * 4.2, pScale: 1 }], group.box)
            own.push(add('image', placed[0], { vectorPath: maskOf(image, k + 1), image: imageSrc(image, group.text), imageFit: 'cover', borderColor: style.palette[k % style.palette.length].split('-')[0], borderWidth: kit.imageBorder.width, backgroundColor: style.bg, why: image.why || '', art: !image.url }, [at], pPlaced[0]))
          }
        } else {
          const text = s.headlines?.[k] || short(group.text, 28)
          const { placed, pPlaced } = placeColumn([{ key: 'heading', w: U * 7.5, h: U * 1.8, pScale: 1.4 }], group.box)
          own.push(add('heading', placed[0], textNote(text, kit.headline.font, fitFont(text, placed[0].w, placed[0].h, U * 1.3, kit.headline.font), k ? style.chrome.accent : kit.headline.color, fontWeight(kit.headline)), [at], { ...pPlaced[0], fontSize: fitFont(text, pPlaced[0].w, pPlaced[0].h, U * 1.6, kit.headline.font) }))
        }
      })
      pushStep({ layout: L, nodeIds: ids, lit: [...ids, ...own], kicker, narrative, camera: { frame: [...ids, ...own], roll: roll ?? Math.round(rollMax * 0.2), fill: 0.9 }, duration: s.duration || 3800, reveal: 'stagger' })
      stepNotes.push(...own)
      return
    }
    if (L === 'trace') {
      // A ribbon from this branch back to the root: the camera follows the line home.
      const target = root && boxes.get(root)
      const from = centre(leadBox)
      const to = target ? centre(target) : centre(B)
      const rib = P.ribbon(from.x, from.y, to.x, to.y, 0.38)
      const ribbonId = add('ribbon', { x: rib.box.x, y: rib.box.y, w: rib.box.width, h: rib.box.height }, { vectorPath: rib.d, backgroundColor: 'transparent', borderColor: kit.ribbon.color, borderWidth: kit.ribbon.width, borderStyle: kit.ribbon.dash === 'solid' ? 'solid' : kit.ribbon.dash }, [at])
      own.push(ribbonId)
      const label = s.headline || 'Back to the centre'
      const { placed, pPlaced } = placeColumn([{ key: 'label', w: U * 13, h: U * 1.8, pScale: 1.8 }], { x: rib.box.x, y: rib.box.y, width: rib.box.width, height: rib.box.height }, { sides: ['below', 'above', 'right', 'left'] })
      own.push(add('label', placed[0], textNote(label, kit.headline.font, fitFont(label, placed[0].w, placed[0].h, U * 0.95, kit.headline.font), kit.ribbon.color, { ...fontWeight(kit.headline), rotate: { rotationAngle: -3 } }), [at], { ...pPlaced[0], fontSize: fitFont(label, pPlaced[0].w, pPlaced[0].h, U * 1.3, kit.headline.font) }))
      const frame = [...ids, ...own, ...(root ? [root] : [])]
      pushStep({ layout: 'trace', nodeIds: ids, lit: frame, kicker, narrative, camera: { frame, roll: roll ?? 0, fill: 0.9 }, duration: s.duration || 3800 })
      stepNotes.push(...own)
    }
  })

  // A road through the whole deck (Journey): one stroke from step to step, behind the slate, that
  // the camera travels along.
  if (style.route) {
    const stops = steps.slice(1).filter((step) => step.layout !== 'overview' && !step.deep)
      .map((step) => step.nodeIds.map((id) => boxes.get(id)).find(Boolean)).filter(Boolean).map((box) => [box.x + box.width / 2, box.y + box.height / 2])
    if (root && rootBox) stops.unshift([rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2])
    const road = P.route(stops)
    if (road) add('route', { x: road.box.x, y: road.box.y, w: road.box.width, h: road.box.height }, { vectorPath: road.d, backgroundColor: 'transparent', borderColor: kit.ribbon.color, borderWidth: Math.max(4, kit.ribbon.width), borderStyle: kit.ribbon.dash === 'solid' ? 'solid' : kit.ribbon.dash, behind: true, deco: true, opacity: 0.55 }, 'all')
  }

  // 5. The homecoming finale: the camera pulls back through the whole map and lands on the
  // opening bookend with the call to action.
  const cta = kit.cta
  const ctaText = `${direction.cta}  →`
  const ctaId = add('cta', ctaAnchor, { vectorPath: cta.path, backgroundColor: cta.fill, borderColor: cta.border || cta.fill, borderWidth: cta.border ? 3 : 0, text: ctaText, fontFamily: cta.font, fontWeight: 'bold', fontSize: fitFont(ctaText, ctaAnchor.w * 0.8, ctaAnchor.h * 0.7, U * 0.95, cta.font), fontColor: cta.color }, ['finale'], ctaPortrait)
  const finaleIndex = steps.length
  // A full-bleed bookend carries its own words: no caption over it.
  const closing = openingCamera.cover ? '' : direction.closing || ''
  pushStep({
    layout: 'finale', nodeIds: allIds, lit: 'all', kicker: closing ? 'Your turn' : '', narrative: closing,
    camera: { frame: [...(openingCamera.cover ? [bookend[0]] : bookend), ctaId], cover: Boolean(openingCamera.cover), fill: 0.86, roll: -Math.min(3, rollMax), via: 'overview', p: { frame: [...(openingCamera.cover ? [bookend[0]] : bookend), ctaId], cover: Boolean(openingCamera.cover) } },
    duration: 5000, reveal: 'fade',
  })
  // Decoration (stars, orbits, grids) belongs to every step; drawn behind everything.
  // Kept to a few dozen: every one is a real note the camera's flights repaint.
  const decor = (kit.decor?.(B, U) || []).slice(0, MAX_DECOR).map((d) => {
    const { key, w, h, ...rest } = d
    return { id: `sb-deco-${key}`, kind: 'deco', deco: true, behind: true, x: d.x, y: d.y, w, h, borderWidth: 0, ...rest, steps: 'all', p: { x: d.x, y: d.y, w, h } }
  })
  stageNotes.forEach((note) => {
    if (Array.isArray(note.steps)) note.steps = note.steps.map((value) => (value === 'finale' ? finaleIndex : value))
    if (markAll.includes(note.id)) note.detail = true
  })
  steps.forEach((step) => {
    step.camera.frame = step.camera.frame.filter(Boolean)
    if (step.camera.p) step.camera.p.frame = step.camera.p.frame.filter(Boolean)
  })
  return { version: DECK_VERSION, style: ref, skin, lines, stageNotes: [...decor, ...stageNotes], steps }
}

/**
 * The box a step frames, from the deck's notes (landscape, or `portrait` geometry): what the
 * camera fits.
 */
export function frameBox(deck, step, { portrait = false } = {}) {
  const ids = portrait && step.camera.p?.frame?.length ? step.camera.p.frame : step.camera.frame
  const boxes = ids.map((id) => {
    const skin = deck.skin[id]
    if (skin) return { x: skin.x, y: skin.y, width: skin.width, height: skin.height }
    const note = deck.stageNotes.find((n) => n.id === id)
    if (!note) return null
    const g = portrait && note.p ? note.p : note
    return { x: g.x, y: g.y, width: g.w, height: g.h }
  })
  return unionBoxes(boxes)
}

/** Whether a stage note shows on step `index` (deco and nested details show on every step). */
export const showsOn = (note, index) => note.steps === 'all' || (Array.isArray(note.steps) && note.steps.includes(index))

/**
 * The deck for a slate: its direction (the AI's, else the local one) composed in its style.
 * → { direction, deck }
 */
export function deckFor(layout, { direction = null, style = null, name = '', scenes = [] } = {}) {
  const dir = direction ? normalizeDirection(direction, layout, { name }) : localDirection(layout, { name, scenes, style: style?.id || style })
  const deck = composeDeck(layout, dir, { style: style || dir.style })
  return { direction: dir, deck }
}

/**
 * The direction with the workshop's lanes as its first steps (in the authored order), and the
 * lanes' notes left out of the other steps.
 */
export function withLanes(direction, scenes, layout) {
  if (!scenes?.length) return direction
  const lanes = localDirection(layout, { scenes, style: direction.style?.id }).steps.filter((step) => step.layout === 'dive' && scenes.some((scene) => String(scene.nodeIds?.[0]) === step.nodeIds[0]))
  if (!lanes.length) return direction
  const laneIds = new Set(lanes.flatMap((step) => step.nodeIds))
  const rest = direction.steps.slice(1)
    .map((step) => ({ ...step, nodeIds: step.nodeIds.filter((id) => !laneIds.has(id)) }))
    .filter((step) => step.nodeIds.length)
  return { ...direction, steps: [direction.steps[0], ...lanes, ...rest] }
}

/**
 * What a deck saves: its direction (lanes first), its style and the steps it plays (the deck's
 * steps as viewpoints). `direction` is the AI's (normalized) or null for the local one.
 */
export function deckRecord({ layout, direction = null, style = null, name = '', scenes = [] }) {
  const base = direction ? normalizeDirection(direction, layout, { name }) : localDirection(layout, { name, scenes })
  const directed = withLanes(base, scenes, layout)
  const ref = cleanStyleRef(style || directed.style)
  const deck = composeDeck(layout, directed, { style: ref })
  return { direction: { ...directed, style: ref }, style: ref, viewpoints: deck.steps }
}

/** The steps as viewpoints a presenter plays (the deck's steps, with the narrative its captions). */
export const deckViewpoints = (deck) => deck.steps.map((step) => ({ ...step }))

export { STYLE_IDS, textOn }
