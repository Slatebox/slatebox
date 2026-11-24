// Icon search for custom shapes: The Noun Project's icons, each turned into one checked, normalised
// outline (slateboxjs/shapes prepareShape: a 0..100 box, the same value a drawn shape stores), with
// the credit The Noun Project asks for ("<icon> by <creator> from Noun Project", linked to the icon).
// Meteor-free: server/shapes/meteor.js supplies the signed API request and the SVG fetch, so the
// service runs in node:test with mocked answers. Answers are kept in memory for a while (a repeat
// of the same words costs no API call); failures are never kept.
import { optimize } from 'svgo'
import { prepareShape } from 'slateboxjs/shapes'
import { ShapeProblem } from './shape-core.mjs'

export const ICON_LIMITS = Object.freeze({ query: 100, perPage: 24, pages: 5, cacheEntries: 200 })
export const ICON_CACHE_TTL_MS = 6 * 60 * 60 * 1000
export const NOT_SET_UP_MESSAGE = 'Icon search is not set up on this server. Create a shape with AI instead.'
export const UNAVAILABLE_MESSAGE = 'Icon search is not answering just now. Try again, or create a shape with AI.'
const NOUN_HOST = /(^|\.)thenounproject\.com$/i
const NOUN_SITE = 'https://thenounproject.com'

const clip = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

// The elements whose outlines are never drawn: definitions, clips, masks, words.
const HIDDEN_BLOCKS = /<(defs|clipPath|mask|title|desc|text|style|metadata|symbol)\b[\s\S]*?<\/\1>/gi

/**
 * One SVG → { d, fillRule } (every filled <path>, joined), or null when the icon cannot be one
 * outline: a transform svgo could not apply, stroke-only art, or nothing to fill.
 */
export function svgToOutline(svg, { precision = 2 } = {}) {
  if (typeof svg !== 'string' || !svg.includes('<svg') || svg.length > 400000) return null
  let data
  try {
    data = optimize(svg, {
      multipass: true,
      floatPrecision: precision,
      plugins: [
        { name: 'preset-default', params: { overrides: { convertShapeToPath: { convertArcs: true }, convertPathData: { floatPrecision: precision } } } },
      ],
    }).data
  } catch {
    return null
  }
  const body = data.replace(HIDDEN_BLOCKS, '')
  const parts = []
  for (const [tag] of body.matchAll(/<path\b[^>]*>/gi)) {
    if (/\stransform=/i.test(tag)) return null
    if (/\sfill="none"/i.test(tag) || /fill:\s*none/i.test(tag)) continue
    const d = tag.match(/\sd="([^"]+)"/i)?.[1]?.trim()
    // A path's first moveto is absolute even when written "m"; joined after another it would not be.
    if (d) parts.push(d.replace(/^m/, 'M'))
  }
  if (!parts.length) return null
  return { d: parts.join(''), fillRule: /fill-rule(="|:\s*)evenodd/i.test(data) ? 'evenodd' : 'nonzero' }
}

/** One Noun Project icon (with its SVG) → a shape { iconId, name, d, fillRule, aspect, textBox, credit, license }, or null. */
export function iconToShape(icon, svg) {
  let outline = svgToOutline(svg)
  if (!outline) return null
  const name = clip(icon.term || icon.name || 'icon', 60) || 'icon'
  let prepared = prepareShape({ name, d: outline.d, fillRule: outline.fillRule })
  if (!prepared.ok && prepared.code === 'too_long') {
    // A fine-grained icon: one decimal is all a stored outline keeps anyway.
    outline = svgToOutline(svg, { precision: 1 })
    prepared = outline ? prepareShape({ name, d: outline.d, fillRule: outline.fillRule }) : prepared
  }
  if (!prepared.ok) return null
  const creator = clip(icon.creator?.name || icon.creator?.username, 80)
  const link = typeof icon.permalink === 'string' && icon.permalink.startsWith('/') ? `${NOUN_SITE}${icon.permalink}` : NOUN_SITE
  return {
    iconId: String(icon.id),
    name: prepared.shape.name,
    d: prepared.shape.d,
    fillRule: prepared.shape.fillRule,
    aspect: prepared.shape.aspect,
    textBox: prepared.shape.textBox,
    credit: {
      text: clip(icon.attribution, 200) || `${name}${creator ? ` by ${creator}` : ''} from Noun Project`,
      url: link,
    },
    license: clip(icon.license_description, 60) || null,
  }
}

/**
 * deps: {
 *   configured: boolean            whether a Noun Project key and secret are set
 *   apiOrigin?: string             https://api.thenounproject.com unless the operator names another
 *   requestJson(url) -> object     the signed (OAuth 1.0a) GET; throws on a failed request
 *   fetchText(url) -> string       an icon's SVG
 *   now?, ttlMs?, maxEntries?
 * }
 */
export function createIconSearch(deps) {
  const now = deps.now || (() => Date.now())
  const ttl = deps.ttlMs ?? ICON_CACHE_TTL_MS
  const maxEntries = deps.maxEntries ?? ICON_LIMITS.cacheEntries
  const apiOrigin = String(deps.apiOrigin || 'https://api.thenounproject.com').replace(/\/+$/, '')
  const apiHost = (() => { try { return new URL(apiOrigin).host } catch { return '' } })()
  const cache = new Map()

  // Only the icon files The Noun Project serves (or the operator's own API origin) are fetched.
  const fetchable = (url) => {
    try {
      const u = new URL(url)
      return (u.protocol === 'https:' && NOUN_HOST.test(u.hostname)) || u.host === apiHost
    } catch {
      return false
    }
  }

  async function shapesOf(icons) {
    return Promise.all(icons.map(async (icon) => {
      try {
        const svg = typeof icon.svg === 'string' ? icon.svg : fetchable(icon.icon_url) ? await deps.fetchText(icon.icon_url) : null
        return svg ? iconToShape(icon, svg) : null
      } catch {
        return null
      }
    }))
  }

  return {
    configured: Boolean(deps.configured),
    /**
     * → { icons: [...], hasMore, cached, credit } for q (1..100 characters). limit 1..24 (12),
     * page 1..5. Icons that cannot be one outline are left out.
     */
    async search(principal, { q, limit = 12, page = 1 } = {}) {
      if (!principal?.userId) throw new ShapeProblem('sign_in', 'Sign in to search icons.', 401)
      const words = clip(q, ICON_LIMITS.query + 1)
      if (!words || words.length > ICON_LIMITS.query) throw new ShapeProblem('invalid_request', `Search for 1 to ${ICON_LIMITS.query} characters.`)
      if (!deps.configured) throw new ShapeProblem('icons_not_set_up', NOT_SET_UP_MESSAGE, 503)
      const want = Math.max(1, Math.min(ICON_LIMITS.perPage, Number.isInteger(limit) ? limit : 12))
      const at = Math.max(1, Math.min(ICON_LIMITS.pages, Number.isInteger(page) ? page : 1))
      const key = JSON.stringify([words.toLowerCase(), want, at])
      const hit = cache.get(key)
      if (hit && now() - hit.at < ttl) {
        cache.delete(key)
        cache.set(key, hit)
        return { ...hit.value, cached: true }
      }
      // A few more than asked for: some icons cannot be one outline.
      const ask = Math.min(50, want + Math.ceil(want / 2))
      const url = `${apiOrigin}/v2/icon?query=${encodeURIComponent(words)}&limit=${ask}&page=${at}&include_svg=1&limit_to_public_domain=0`
      let answer
      try {
        answer = await deps.requestJson(url)
      } catch (error) {
        if (error?.status === 404) answer = { icons: [] }
        else if (error?.status === 429) throw new ShapeProblem('icons_busy', 'Icon search is busy just now. Try again in a minute, or create a shape with AI.', 429)
        else throw new ShapeProblem('icons_unavailable', UNAVAILABLE_MESSAGE, 502)
      }
      const found = Array.isArray(answer?.icons) ? answer.icons.filter((icon) => icon && icon.id != null) : []
      const icons = (await shapesOf(found)).filter(Boolean).slice(0, want)
      const value = {
        icons,
        hasMore: found.length >= ask && at < ICON_LIMITS.pages,
        credit: { text: 'Icons from Noun Project', url: NOUN_SITE },
      }
      cache.set(key, { at: now(), value })
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
      return { ...value, cached: false }
    },
  }
}
