// A presentation's deck on the server: its art direction (the AI's or the local one) with the
// workshop's lanes first, its pictures found (searched, else generated, else the style's own
// art), composed in its style into the steps that are saved and played. Switching the style
// composes the same direction again: no AI is asked. Pure: what it needs is passed in.
import { composeDeck, deckFor, deckRecord, withLanes } from '../../imports/ui/components/presentations/presentationCompose.mjs'
import { cleanStyleRef, resolveStyle } from '../../imports/ui/components/presentations/presentationStyles.mjs'
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

/** Every picture a direction asks for: [{ image, set(url, source) }]. */
function wantedImages(direction) {
  const out = []
  const want = (image, set) => {
    if (image && !image.url && image.why && (image.query || image.prompt)) out.push({ image, set })
  }
  if (direction.cover) want(direction.cover, (url, source) => { direction.cover = { ...direction.cover, url, source } })
  direction.steps.forEach((step, i) => {
    want(step.image, (url, source) => { direction.steps[i].image = { ...direction.steps[i].image, url, source } })
    ;(step.images || []).forEach((image, k) => want(image, (url, source) => { direction.steps[i].images[k] = { ...direction.steps[i].images[k], url, source } }))
  })
  return out.slice(0, MAX_DECK_IMAGES)
}

const https = (url) => (typeof url === 'string' && /^https:\/\//.test(url) ? url : null)
const within = (promise, ms) => {
  let timer
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms) })]).finally(() => clearTimeout(timer))
}

/**
 * The direction with its pictures found: each is searched for (`search(query)` → { items: [{ link }] }),
 * else generated (`generate(prompt)` → [url] or [{ error }]), all within `timeLimitMs`. A picture
 * neither finds keeps no url: the composer draws the style's own art there. Nothing here throws:
 * no credits, no key, no network all end in art. → a new direction.
 */
export async function resolveDirectionImages(direction, { search = null, generate = null, timeLimitMs = IMAGE_TIME_LIMIT_MS } = {}) {
  const out = JSON.parse(JSON.stringify(direction))
  const wanted = wantedImages(out)
  if (!wanted.length || (!search && !generate)) return out
  const deadline = Date.now() + timeLimitMs
  const left = () => Math.max(0, deadline - Date.now())
  await within(Promise.all(wanted.map(async ({ image, set }) => {
    if (search && image.query) {
      try {
        const found = await within(Promise.resolve().then(() => search(image.query)), left())
        const link = found?.items?.map((item) => https(item?.link)).find(Boolean)
        if (link) { set(link, 'search'); return }
      } catch { /* searched for nothing: generate it */ }
    }
    if (generate && left() > 500) {
      try {
        const made = await within(Promise.resolve().then(() => generate(image.prompt || image.query)), left())
        const url = Array.isArray(made) ? made.map(https).find(Boolean) : null
        if (url) set(url, 'generated')
      } catch { /* the style's own art */ }
    }
  })), timeLimitMs)
  return out
}

/**
 * A one-click style switch: the same direction composed in another style. Same steps (the same
 * notes in the same order), no AI. `row` is the saved deck: { presentationData, direction }.
 * → the fields to save ({ style, direction, viewpoints }), or null when the deck has no direction.
 */
export function styleChange(row, styleRef) {
  if (!row?.direction?.steps) return null
  let layout = row.presentationData
  if (typeof layout === 'string') {
    try { layout = JSON.parse(layout) } catch { return null }
  }
  const style = cleanStyleRef(styleRef)
  const deck = composeDeck(layout, row.direction, { style })
  return { style, direction: { ...row.direction, style }, viewpoints: deck.steps }
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

/**
 * The share card (1200×630) of a styled deck: its title card in its style, not a grey snapshot.
 * The style's background, its title and kicker, its underline swoosh and the root's silhouette
 * with the style's art. → an SVG string, rendered to the preview image.
 */
export function ogCardSvg({ direction, style: styleRef = null }) {
  const style = resolveStyle(styleRef || direction?.style)
  const kit = style.kit
  const title = lines(direction?.title || 'A Slatebox presentation', 22)
  const size = title.length > 2 ? 72 : 92
  const art = direction?.cover?.url || artImage({ kind: style.art, palette: style.palette, bg: style.bg, seedText: direction?.title || '', width: 800, height: 800 })
  const accent = style.chrome.accent
  const pathFor = (d, x, y, w, h, fill, extra = '') => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 100 ${/V60|H0 V|,60/.test(d) ? 60 : 100}" preserveAspectRatio="none"><path d="${d}" fill="${fill}" ${extra}/></svg>`
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${style.bg}"/>
<defs><clipPath id="hero"><path transform="translate(760 95) scale(4.4)" d="${MASKS.blob}"/></clipPath></defs>
<image href="${esc(art)}" xlink:href="${esc(art)}" x="760" y="95" width="440" height="440" preserveAspectRatio="xMidYMid slice" clip-path="url(#hero)"/>
${direction?.kicker ? `<text x="70" y="150" font-family="${esc(kit.kicker.font)}, sans-serif" font-weight="700" font-size="30" fill="${esc(accent)}" letter-spacing="2">${esc(direction.kicker.toUpperCase())}</text>` : ''}
${title.map((line, i) => `<text x="66" y="${250 + i * size * 1.05}" font-family="${esc(kit.title.font)}, sans-serif" font-weight="${kit.title.weight || 'bold'}" font-size="${size}" fill="${esc(kit.title.color)}">${esc(line)}</text>`).join('\n')}
${pathFor(kit.underline?.path && !kit.underline.bolt ? kit.underline.path : swoosh, 66, 290 + (title.length - 1) * size * 1.05, 560, 46, esc(kit.underline?.fill || accent))}
<text x="70" y="580" font-family="${esc(style.fonts.body)}, sans-serif" font-size="24" fill="${esc(style.chrome.ink)}" opacity=".7">${esc(style.name)} · made with Slatebox</text>
</svg>`
}

/** The live session's deck, with its look: what a follower needs to play it as the presenter does. */
export function liveDeckLook(input) {
  const style = input?.style ? cleanStyleRef(input.style) : null
  let direction = null
  if (input?.direction && typeof input.direction === 'object') {
    const text = JSON.stringify(input.direction)
    // Pictures are links or drawn art; a direction is a few kilobytes. A huge one is dropped.
    if (text.length <= 60_000) direction = JSON.parse(text)
  }
  return style && direction ? { style, direction } : {}
}

export { deckFor, deckRecord, withLanes }
