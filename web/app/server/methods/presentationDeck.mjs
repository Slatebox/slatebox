// A presentation's deck on the server: its art direction (the AI's or the local one) with the
// workshop's lanes first, its pictures found (searched, else generated, else the style's own
// art), composed in its style into the steps that are saved and played. Switching the style
// composes the same direction again: no AI is asked. Pure: what it needs is passed in.
import {
  STEP_LAYOUTS, composeDeck, deckFor, deckRecord, pictureSlots, remixDirection, safeImageUrl, withLanes,
} from '../../imports/ui/components/presentations/presentationCompose.mjs'
import { cleanStyleRef, resolveStyle } from '../../imports/ui/components/presentations/presentationStyles.mjs'
import { ogCardMeasure, ogCardText } from './presentationCard.mjs'
import { artImage } from '../../imports/ui/components/presentations/presentationArt.mjs'
import { MASKS, swoosh } from '../../imports/ui/components/presentations/presentationPaths.mjs'

/** How long a deck's pictures may take to find, all of them together. */
export const IMAGE_TIME_LIMIT_MS = 7000
/** The longest a deck takes on the server, plan and pictures together (the presenter waits 20 s). */
export const DECK_TIME_LIMIT_MS = 19_000
/** The time left for a deck's pictures, `elapsed` ms after the request began (0: none). */
export const pictureTime = (elapsed) => {
  const left = Math.min(IMAGE_TIME_LIMIT_MS, DECK_TIME_LIMIT_MS - elapsed - 300)
  return left >= 800 ? left : 0
}
/** The most pictures a deck asks for. */
export const MAX_DECK_IMAGES = 6
/** The most pictures a deck generates (each is paid for when it is asked for). */
export const MAX_DECK_GENERATIONS = 2
/** The most new pictures one person's decks of one slate find in a day (refines included). */
export const MAX_DECK_IMAGES_PER_DAY = 18
/** How long a generated picture usually takes: with less time left, none is asked for. */
export const GENERATE_TYPICAL_MS = 6000
/** Search only pictures licensed for reuse (public domain, attribution, share-alike). */
export const LICENCE_FILTER = '&rights=cc_publicdomain|cc_attribute|cc_sharealike'

/**
 * What finding a deck's pictures may cost at most, for the meter's pre-check: one search for each
 * picture wanted, and the generations allowed. `prices`: { search, generate } in micros.
 */
export function imageEstimateMicros(count, { generations = MAX_DECK_GENERATIONS, prices = { search: 5000, generate: 30000 } } = {}) {
  const n = Math.max(0, Math.min(MAX_DECK_IMAGES, count))
  return n * prices.search + Math.min(n, generations) * prices.generate
}

/** Every picture a direction still wants: [{ image, set(url, source, credit) }], at most `max`. */
function wantedImages(direction, max = MAX_DECK_IMAGES) {
  return pictureSlots(direction)
    .filter(({ image }) => !image.url && image.why && (image.query || image.prompt))
    .slice(0, Math.max(0, max))
    .map(({ image, set }) => ({ image, set: (url, source, credit) => set({ url, source, ...(credit ? { credit } : {}) }) }))
}

const https = (url) => (typeof url === 'string' && /^https:\/\//.test(url) ? url : null)
const TIMED_OUT = Symbol('timed out')
const within = (promise, ms) => {
  let timer
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms) })]).finally(() => clearTimeout(timer))
}

/**
 * The direction with its pictures found, within `timeLimitMs`. Each is searched for
 * (`search(query)` → { items: [{ link, displayLink, image: { contextLink } }] }, licensed for
 * reuse) and copied into Slatebox's own storage (`copy(link)` → url, so a published deck never
 * hotlinks a stranger's server); else generated (`generate(prompt)` → [url] or [{ error }]), at
 * most `maxGenerations` and only with the provider's usual time still left (a generation is paid
 * for when it is asked for: one that could not finish in time is never started). A picture that
 * arrives after the deadline is handed to `onLate({ query, url, source })`, so it is kept, not
 * lost. A picture nothing finds keeps no url: the composer draws the style's own art there.
 * Nothing here throws. → { direction, found } (found: how many new pictures)
 */
export async function resolveDirectionImages(direction, {
  search = null, generate = null, copy = null, timeLimitMs = IMAGE_TIME_LIMIT_MS, max = MAX_DECK_IMAGES,
  maxGenerations = MAX_DECK_GENERATIONS, generateTypicalMs = GENERATE_TYPICAL_MS, onLate = null, track = null,
} = {}) {
  const out = JSON.parse(JSON.stringify(direction))
  const wanted = wantedImages(out, max)
  let found = 0
  if (!wanted.length || (!search && !generate)) return { direction: out, found }
  const deadline = Date.now() + timeLimitMs
  const left = () => Math.max(0, deadline - Date.now())
  let generations = 0
  let open = true
  const keep = (image, url, source, credit, set) => {
    if (open) {
      set(url, source, credit)
      found += 1
    } else onLate?.({ query: image.query, url, source, ...(credit ? { credit } : {}) })
  }
  const fromSearch = async (image) => {
    const result = await search(image.query)
    const items = (result?.items || []).filter((item) => https(item?.link)).slice(0, 3)
    for (const item of items) {
      const url = copy ? await Promise.resolve().then(() => copy(item.link)).catch(() => null) : item.link
      if (https(url)) return { url, credit: [item.displayLink, https(item.image?.contextLink)].filter(Boolean).join(' · ') || null }
    }
    return null
  }
  await within(Promise.all(wanted.map(async ({ image, set }) => {
    if (search && image.query) {
      const pending = Promise.resolve().then(() => fromSearch(image)).catch(() => null)
      track?.(pending)
      const hit = await within(pending, left())
      if (hit === TIMED_OUT) {
        pending.then((late) => { if (late?.url) keep(image, late.url, 'search', late.credit, set) })
        return
      }
      if (hit?.url) { keep(image, hit.url, 'search', hit.credit, set); return }
    }
    if (generate && generations < maxGenerations && left() >= generateTypicalMs) {
      generations += 1
      const pending = Promise.resolve().then(() => generate(image.prompt || image.query)).then((made) => (Array.isArray(made) ? made.map(https).find(Boolean) : null)).catch(() => null)
      track?.(pending)
      const url = await within(pending, left())
      if (url === TIMED_OUT) pending.then((late) => { if (late) keep(image, late, 'generated', null, set) })
      else if (url) keep(image, url, 'generated', null, set)
    }
  })), timeLimitMs)
  open = false
  return { direction: out, found }
}

/**
 * A person's choice about one of a deck's pictures (`slot`: its place in pictureSlots order):
 * 'art' keeps the style's own drawn art there for good; 'next' finds another picture for the same
 * query (`search(query, page)`, copied with `copy(link)`), never the one shown now. → the fields
 * to save ({ direction, viewpoints }), or null when the slot or a new picture is not there.
 */
export async function pictureChange(row, { slot, action }, { search = null, copy = null } = {}) {
  if (!row?.direction?.steps) return null
  let layout = row.presentationData
  if (typeof layout === 'string') {
    try { layout = JSON.parse(layout) } catch { return null }
  }
  const direction = JSON.parse(JSON.stringify(row.direction))
  const target = pictureSlots(direction)[slot]
  if (!target) return null
  if (action === 'art') {
    // No reason, no picture: the composer draws the style's art there, and nothing searches again.
    target.set({ url: undefined, source: undefined, credit: undefined, why: '', art: true })
  } else if (action === 'next') {
    if (!search || !target.image.query) return null
    const seen = new Set([target.image.url, ...(target.image.seen || [])].filter(Boolean))
    let picked = null
    for (const page of [1, 2]) {
      const result = await search(target.image.query, page)
      for (const item of (result?.items || []).filter((it) => https(it?.link)).slice(0, 4)) {
        const url = copy ? await Promise.resolve().then(() => copy(item.link)).catch(() => null) : item.link
        if (https(url) && !seen.has(url)) { picked = { url, credit: [item.displayLink, https(item.image?.contextLink)].filter(Boolean).join(' · ') || undefined }; break }
      }
      if (picked) break
    }
    if (!picked) return null
    target.set({ url: picked.url, source: 'search', credit: picked.credit, seen: [...seen].slice(-6) })
  } else return null
  const deck = composeDeck(layout, direction, { style: row.style || direction.style })
  return { direction, viewpoints: deck.steps }
}

/**
 * The slate a published deck plays on, built on the server from the saved slate: each note's
 * place, size, words and everything that draws it (shape and custom outline, fills, fonts, effects;
 * pictures only of a worn style's art), the connections between them, the canvas background and the
 * style the slate wears.
 * A worn style's art is real notes, so it is published with the slate: the player draws only this.
 * Nothing else of the slate (its settings, comments, rules) is published. → a JSON string, or null.
 */
const PLAYER_NODE_KEYS = ['id', 'text', 'xPos', 'yPos', 'width', 'height', 'rotate', 'shape', 'shapeHint', 'vectorPath', 'fillRule', 'textBox', 'shapeRef',
  'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'foregroundColor', 'fontColor', 'textXAlign', 'textYAlign', 'textOffset', 'textInset', 'textOpacity',
  'backgroundColor', 'borderColor', 'borderWidth', 'borderStyle', 'borderOpacity', 'opacity', 'filters', 'imageFit', 'imageOrigWidth', 'imageOrigHeight',
  'isLocked', 'styleRole']
const PLAYER_LINE_KEYS = ['parentId', 'childId', 'lineColor', 'lineWidth', 'lineType', 'lineCurviness', 'lineCurveType', 'lineDash', 'lineEffect', 'lineOpacity', 'isStraightLine', 'showChildArrow', 'showParentArrow']
const PLAYER_BACKGROUND_KEYS = ['backgroundColor', 'backgroundColorAsGradient', 'backgroundGradientType', 'backgroundGradientColors', 'backgroundGradientStrategy']
const pick = (source, keys) => Object.fromEntries(keys.filter((key) => source?.[key] !== undefined && typeof source[key] !== 'function').map((key) => [key, source[key]]))
export function playerSlateCopy(slateDoc) {
  const nodes = Array.isArray(slateDoc?.nodes) ? slateDoc.nodes : null
  if (!nodes) return null
  const style = slateDoc.options?.style
  const copy = {
    options: {
      name: String(slateDoc.options?.name || '').slice(0, 200),
      viewPort: pick(slateDoc.options?.viewPort, ['width', 'height']),
      ...(slateDoc.options?.containerStyle?.backgroundColor ? { containerStyle: pick(slateDoc.options.containerStyle, PLAYER_BACKGROUND_KEYS) } : {}),
      ...(style && typeof style === 'object' && typeof style.id === 'string' ? { style: cleanStyleRecord(style) } : {}),
    },
    nodes: nodes.filter((node) => node?.options?.id != null).slice(0, 2000).map((node) => {
      const options = { ...pick(node.options, PLAYER_NODE_KEYS), text: String(node.options.text ?? '').slice(0, 2000) }
      // A person's own pictures stay unpublished; a worn style's pictures (its art, or one found for a step with
      // a reason and a credit) are part of the presentation, from a safe link only.
      const image = node.options.styleRole ? safeImageUrl(node.options.image) : null
      if (image) options.image = image
      return {
        options,
        relationships: { associations: (node.relationships?.associations || []).slice(0, 200).map((assoc) => pick(assoc, PLAYER_LINE_KEYS)) },
      }
    }),
  }
  return JSON.stringify(copy)
}

/** A style record made safe to publish: { id, overrides?, v }. */
function cleanStyleRecord(style) {
  const ref = cleanStyleRef(style)
  return { ...ref, ...(Number.isInteger(style.v) ? { v: style.v } : {}) }
}

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const ids = (list, n = 400) => (Array.isArray(list) ? list : []).filter((id) => (typeof id === 'string' || typeof id === 'number') && String(id).length <= 128).slice(0, n).map(String)
/**
 * A worn style's deck (version 5) from a browser, made safe: a box, the ids each step lights,
 * reveals and hides, its camera and its words, nothing else. → the deck, or null.
 */
export function sanitizeBakedDeck(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 5 || !Array.isArray(raw.steps) || !raw.steps.length) return null
  const str = (value, n) => (typeof value === 'string' ? value.slice(0, n) : '')
  const steps = raw.steps.slice(0, 40).filter((step) => step && typeof step === 'object' && step.box).map((step) => ({
    layout: str(step.layout, 20) || 'group',
    box: { x: finite(step.box.x), y: finite(step.box.y), width: Math.max(1, finite(step.box.width)), height: Math.max(1, finite(step.box.height)) },
    lit: step.lit === 'all' ? 'all' : ids(step.lit),
    own: ids(step.own),
    hide: ids(step.hide, 2000),
    ...(Number.isFinite(Number(step.dim)) ? { dim: Math.min(1, Math.max(0, Number(step.dim))) } : {}),
    ...(step.deep ? { deep: true } : {}),
    camera: {
      fill: Math.min(1, Math.max(0.2, finite(step.camera?.fill) || 0.86)),
      roll: Math.min(30, Math.max(-30, finite(step.camera?.roll))),
      ...(step.camera?.cover ? { cover: true } : {}),
      ...(step.camera?.deep ? { deep: true } : {}),
      ...(step.camera?.via === 'overview' ? { via: 'overview' } : {}),
    },
    reveal: ['fade', 'pop', 'stagger', 'draw'].includes(step.reveal) ? step.reveal : 'fade',
    duration: Math.round(Math.min(10000, Math.max(1500, finite(step.duration) || 3200))),
    kicker: str(step.kicker, 48),
    narrative: str(step.narrative, 200),
    nodeIds: ids(step.nodeIds),
    ...(Array.isArray(step.credits) ? { credits: step.credits.slice(0, 6).map((c) => str(c, 60)).filter(Boolean) } : {}),
  }))
  if (!steps.length) return null
  const style = raw.style && typeof raw.style === 'object' && typeof raw.style.id === 'string' ? cleanStyleRecord(raw.style) : null
  return { version: 5, style, decor: ids(raw.decor, 400), steps }
}

/**
 * A direction from a browser or a live session, made safe without the slate: known fields only,
 * short strings, note ids as short strings, safe picture links, a known style. (On publish the
 * slate is at hand and normalizeDirection checks it against the slate too.)
 */
export function sanitizeDirectionShape(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) return null
  const str = (value, n) => (typeof value === 'string' ? value.slice(0, n) : undefined)
  const image = (value) => {
    if (!value || typeof value !== 'object') return undefined
    const url = safeImageUrl(value.url)
    return { query: str(value.query, 120), prompt: str(value.prompt, 300), why: str(value.why, 140), mask: str(value.mask, 20), role: str(value.role, 12), ...(url ? { url, source: str(value.source, 12) } : {}), ...(value.art ? { art: true } : {}) }
  }
  return {
    style: cleanStyleRef(raw.style),
    title: str(raw.title, 80), kicker: str(raw.kicker, 48), subtitle: str(raw.subtitle, 100), cta: str(raw.cta, 28), closing: str(raw.closing, 200),
    ...(raw.local === true ? { local: true } : {}),
    ...(image(raw.cover) ? { cover: image(raw.cover) } : {}),
    steps: raw.steps.slice(0, 24).filter((step) => step && typeof step === 'object').map((step) => ({
      layout: STEP_LAYOUTS.includes(step.layout) ? step.layout : 'group',
      nodeIds: [step.nodeIds ?? []].flat().filter((id) => (typeof id === 'string' || typeof id === 'number') && String(id).length <= 128).slice(0, 100).map(String),
      kicker: str(step.kicker, 48), caption: str(step.caption, 200), headline: str(step.headline, 60),
      ...(Array.isArray(step.headlines) ? { headlines: step.headlines.slice(0, 2).map((h) => str(h, 40)).filter(Boolean) } : {}),
      ...(step.quote ? { quote: str(step.quote, 120) } : {}),
      ...(step.number != null ? { number: str(String(step.number), 8), numberLabel: str(step.numberLabel, 60) } : {}),
      ...(step.detail && typeof step.detail === 'object' ? { detail: { label: str(step.detail.label, 8), fine: str(step.detail.fine, 120), caption: str(step.detail.caption, 200) } } : {}),
      ...(image(step.image) ? { image: image(step.image) } : {}),
      ...(Array.isArray(step.images) ? { images: step.images.slice(0, 3).map(image).filter(Boolean) } : {}),
      ...(Number.isFinite(Number(step.roll)) && step.roll !== null ? { roll: Math.max(-15, Math.min(15, Number(step.roll))) } : {}),
      ...(Number.isFinite(Number(step.duration)) && step.duration !== null ? { duration: Math.max(1500, Math.min(10000, Number(step.duration))) } : {}),
    })),
  }
}

/**
 * A one-click style switch: the direction remixed for another style and composed in it. Same
 * steps (the same notes in the same order), the style's layouts, no AI. `row` is the saved deck: { presentationData, direction }.
 * → the fields to save ({ style, direction, viewpoints }), or null when the deck has no direction.
 */
export function styleChange(row, styleRef) {
  if (!row?.direction?.steps) return null
  let layout = row.presentationData
  if (typeof layout === 'string') {
    try { layout = JSON.parse(layout) } catch { return null }
  }
  const style = cleanStyleRef(styleRef)
  // The style's own beats: the same steps (notes and order), its layouts and, for Slatebox's own
  // words, its voice.
  const direction = { ...remixDirection(row.direction, layout, style, { name: row.name || '' }), style }
  const deck = composeDeck(layout, direction, { style })
  return { style, direction, viewpoints: deck.steps }
}

const esc = (text) => String(text || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const lines = (text, max) => {
  const out = []
  let line = ''
  String(text || '').split(/\s+/).filter(Boolean).forEach((word) => {
    if (line && (line + word).length > max) { out.push(line.trim()); line = '' }
    line += `${word} `
  })
  if (line.trim()) out.push(line.trim())
  return out.slice(0, 3)
}

// The card's hero picture. A drawn art picture (an SVG data URI) is placed as nested SVG markup:
// the renderer draws inline SVG but not an SVG inside an <image>. A raster is an <image>.
function heroImage(href, x, y, w, h) {
  const svg = /^data:image\/svg\+xml[^,]*,/.exec(href)
  if (svg) {
    const markup = decodeURIComponent(href.slice(svg[0].length))
    const open = /<svg\b[^>]*>/.exec(markup)
    const viewBox = open && /viewBox="([^"]+)"/.exec(open[0])
    if (open && viewBox) {
      const inner = markup.slice(open.index + open[0].length).replace(/<\/svg>\s*$/, '')
      return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${viewBox[1]}" preserveAspectRatio="xMidYMid slice">${inner}</svg>`
    }
  }
  return `<image href="${esc(href)}" xlink:href="${esc(href)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
}

/**
 * The share card (1200×630) of a styled deck: its title card in its style, not a grey snapshot.
 * The style's background, its title and kicker, its underline swoosh and the cover (or the
 * style's art) cut to a blob. `drawText({ text, x, y, size, family, weight, fill, opacity })`
 * draws each line (the server draws them as paths in bundled fonts, so the renderer needs no web
 * font); `cover` is the picture's href (the server passes it inlined as data, so the renderer
 * fetches nothing). → an SVG string
 */
export function ogCardSvg({ direction, style: styleRef = null, drawText = null, measureText = null, cover = null }) {
  const style = resolveStyle(styleRef || direction?.style)
  const kit = style.kit
  const title = lines(direction?.title || 'A Slatebox presentation', 22)
  // The title keeps clear of the picture (x 66 to 720): a wide face is set smaller.
  const widest = measureText ? Math.max(...title.map((line) => measureText({ text: line, size: 100, family: kit.title.font, weight: kit.title.weight || 'bold' }))) : 0
  const size = Math.min(title.length > 2 ? 72 : 92, widest ? Math.floor((654 / widest) * 100) : 92)
  const art = cover || safeImageUrl(direction?.cover?.url) || artImage({ kind: style.art, palette: style.palette, bg: style.bg, seedText: direction?.title || '', width: 800, height: 800 })
  const accent = style.chrome.accent
  const text = drawText || (({ text: t, x, y, size: z, family, weight = 'normal', fill, opacity = 1 }) => `<text x="${x}" y="${y}" font-family="${esc(family)}, sans-serif" font-weight="${weight}" font-size="${z}" fill="${esc(fill)}" opacity="${opacity}">${esc(t)}</text>`)
  const pathFor = (d, x, y, w, h, fill, extra = '') => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 100 ${/V60|H0 V|,60/.test(d) ? 60 : 100}" preserveAspectRatio="none"><path d="${d}" fill="${fill}" ${extra}/></svg>`
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${style.bg}"/>
<defs><clipPath id="hero"><path transform="translate(760 95) scale(4.4)" d="${MASKS.blob}"/></clipPath></defs>
<g clip-path="url(#hero)">${heroImage(art, 760, 95, 440, 440)}</g>
${direction?.kicker ? text({ text: direction.kicker.toUpperCase(), x: 70, y: 150, size: 30, family: kit.kicker.font, weight: 'bold', fill: accent }) : ''}
${title.map((line, i) => text({ text: line, x: 66, y: 250 + i * size * 1.05, size, family: kit.title.font, weight: kit.title.weight || 'bold', fill: kit.title.color })).join('\n')}
${pathFor(kit.underline?.path && !kit.underline.bolt ? kit.underline.path : swoosh, 66, 290 + (title.length - 1) * size * 1.05, 560, 46, esc(kit.underline?.fill || accent))}
${text({ text: `${style.name} · made with Slatebox`, x: 70, y: 580, size: 24, family: style.fonts.body, fill: style.chrome.ink, opacity: 0.7 })}
</svg>`
}

/** The live session's deck, with its look: what a follower needs to play it as the presenter does. */
export function liveDeckLook(input) {
  const style = input?.style ? cleanStyleRef(input.style) : null
  let direction = null
  if (input?.direction && typeof input.direction === 'object') {
    const text = JSON.stringify(input.direction)
    // Pictures are links or drawn art; a direction is a few kilobytes. A huge one is dropped, and
    // what is kept is only the fields a follower's player reads, with safe picture links.
    if (text.length <= 60_000) direction = sanitizeDirectionShape(JSON.parse(text))
  }
  return style && direction ? { style, direction } : {}
}

/**
 * The share card ready for the renderer: its words drawn as paths in bundled fonts and its cover
 * inlined (`fetchImage(url)` → { bytes, contentType }, only for an https cover). → an SVG string
 */
export async function ogCardReady({ direction, style, fetchImage = null }) {
  let cover = null
  const url = safeImageUrl(direction?.cover?.url)
  if (url?.startsWith('https://') && fetchImage) {
    const image = await fetchImage(url).catch(() => null)
    if (image?.bytes) cover = `data:${image.contentType};base64,${Buffer.from(image.bytes).toString('base64')}`
  }
  return ogCardSvg({ direction: url?.startsWith('https://') && !cover ? { ...direction, cover: null } : direction, style, cover, drawText: ogCardText, measureText: ogCardMeasure })
}

export { deckFor, deckRecord, withLanes }

/**
 * Whether a change to a version gives it a new share card: a published version whose look changes
 * (a restyle or another picture, which write a new direction). → { generation, look, replaces } or
 * null. `generation` is new, so a card still rendering for the old look is never kept; `replaces`
 * is the card to remove once the new one is in place.
 */
export function shareCardChange(row, fields, newGeneration) {
  if (!row?.isPublished || !fields?.direction) return null
  return {
    generation: newGeneration,
    look: { direction: fields.direction, style: fields.style ?? row.style ?? null },
    replaces: row.imageUrl ? { url: row.imageUrl, generation: row.snapshotGeneration ?? null } : null,
  }
}
