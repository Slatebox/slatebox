// A video's title and poster, looked up on the server so a viewer's browser reaches the video
// host only when they press play. The address is read by the engine (slateboxjs/operations
// parseMediaUrl: YouTube, Vimeo, Loom only). The title comes from the host's own oEmbed endpoint,
// a fixed address per host; the poster comes from the host's picture server and is stored in the
// app's own image store. Every request goes through safeFetch (https only, public addresses only,
// checked again on each redirect) and may reach only the host names listed here.
//
// Runs without Meteor: the store, the cache and the clock are handed in (server/media/meteor.js).
import { parseMediaUrl, MEDIA_HOST_NAMES } from 'slateboxjs/operations'
import { safeFetch, FetchRefused, IMAGE_TYPES } from '../common/safe-fetch.mjs'

// Each host's oEmbed endpoint, the names it may redirect within, and where its posters live.
export const MEDIA_HOSTS = Object.freeze({
  youtube: Object.freeze({
    oembed: 'https://www.youtube.com/oembed',
    oembedHosts: Object.freeze(['www.youtube.com', 'youtube.com']),
    posterHosts: Object.freeze(['i.ytimg.com', 'i1.ytimg.com', 'i2.ytimg.com', 'i3.ytimg.com', 'i4.ytimg.com', 'i9.ytimg.com', 'img.youtube.com']),
  }),
  vimeo: Object.freeze({
    oembed: 'https://vimeo.com/api/oembed.json',
    oembedHosts: Object.freeze(['vimeo.com', 'www.vimeo.com']),
    posterHosts: Object.freeze(['i.vimeocdn.com']),
  }),
  loom: Object.freeze({
    oembed: 'https://www.loom.com/v1/oembed',
    oembedHosts: Object.freeze(['www.loom.com', 'loom.com']),
    posterHosts: Object.freeze(['cdn.loom.com']),
  }),
})

export const MEDIA_FETCH_LIMITS = Object.freeze({
  oembedBytes: 64 * 1024,
  posterBytes: 3 * 1024 * 1024,
  timeoutMs: 6000,
  // Lookups that reach a video host (a cached video costs nothing), per person per hour.
  perHour: 60,
  cacheEntries: 1000,
  cacheMs: 24 * 60 * 60 * 1000,
})

const USER_AGENT = 'Slatebox video lookup'
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

export class MediaRefused extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'MediaRefused'
    this.code = code
    this.status = status
  }
}

/** The file type the bytes really are (a picture server's header is not trusted alone). */
export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.toString('ascii', 0, 4) === 'GIF8') return 'image/gif'
  return null
}

const clean = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || undefined : undefined)
const size = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 && n <= 10000 ? Math.round(n) : undefined
}

/**
 * Whether a poster address is one this app stored (so drawing it reaches no one else, and makes no
 * request to the app beyond its own picture): the file store's media-posters folder, or the app's
 * own /sbimages/ copy, by path or under its https address. Anything else (a tracking pixel on
 * another host, another path on the app) is refused in a plan; Slatebox looks posters up itself.
 */
export function posterAllowedFor(settings = {}) {
  const prefixes = ['/sbimages/media-posters%2F', '/sbimages/media-posters/']
  const cloud = String(settings.aws?.cloudUrl || '').replace(/\/+$/, '')
  if (/^https:\/\//.test(cloud)) prefixes.push(`${cloud}/media-posters/`)
  const base = String(settings.public?.baseUrl || '').replace(/\/+$/, '')
  if (/^https:\/\//.test(base)) prefixes.push(`${base}/sbimages/media-posters%2F`, `${base}/sbimages/media-posters/`)
  return (url) => typeof url === 'string' && !/\.\.|%2e%2e/i.test(url) && prefixes.some((prefix) => url.startsWith(prefix))
}

/** Every poster a plan names (a video note added or changed). */
export function postersIn(plan) {
  const out = []
  for (const op of plan?.operations || []) {
    if (op?.media?.poster !== undefined) out.push(op.media.poster)
    if (op?.changes?.media?.poster !== undefined) out.push(op.changes.media.poster)
  }
  return out
}

/** Where a video's poster is kept: one name per video, so storing it again replaces it. */
export function posterKey(media, contentType) {
  const id = media.provider === 'vimeo' && media.hash ? `${media.id}-${media.hash}` : media.id
  return `media-posters/${media.provider}/${id}.${EXT[contentType] || 'jpg'}`
}

/** A small time-limited cache of looked-up videos (title, author, poster address). */
export function createMemoryCache({ entries = MEDIA_FETCH_LIMITS.cacheEntries, ms = MEDIA_FETCH_LIMITS.cacheMs, now = Date.now } = {}) {
  const map = new Map()
  return {
    get(key) {
      const hit = map.get(key)
      if (!hit) return undefined
      if (hit.expires <= now()) {
        map.delete(key)
        return undefined
      }
      map.delete(key)
      map.set(key, hit)
      return hit.value
    },
    set(key, value) {
      map.delete(key)
      map.set(key, { value, expires: now() + ms })
      while (map.size > entries) map.delete(map.keys().next().value)
    },
  }
}

/** At most `perHour` lookups that reach a video host, per person, in any hour. */
export function createHourlyLimit({ perHour = MEDIA_FETCH_LIMITS.perHour, now = Date.now } = {}) {
  const seen = new Map()
  return {
    take(subject) {
      const since = now() - 60 * 60 * 1000
      const times = (seen.get(subject) || []).filter((t) => t > since)
      if (times.length >= perHour) {
        seen.set(subject, times)
        return false
      }
      times.push(now())
      seen.set(subject, times)
      if (seen.size > 10000) seen.delete(seen.keys().next().value)
      return true
    },
  }
}

/**
 * The lookup the media actions use.
 *   storePoster({ key, body, contentType }) -> the stored poster's address (https, or /sbimages/...)
 *   fetch: safeFetch, replaced in tests
 */
export function createMediaLookup({ storePoster, fetch = safeFetch, cache = createMemoryCache(), limit = createHourlyLimit(), log = console } = {}) {
  async function oembed(media) {
    const host = MEDIA_HOSTS[media.provider]
    const address = `${host.oembed}?${new URLSearchParams({ url: media.url, format: 'json', maxwidth: '1280' })}`
    const answer = await fetch(address, {
      allowHosts: host.oembedHosts,
      maxBytes: MEDIA_FETCH_LIMITS.oembedBytes,
      timeoutMs: MEDIA_FETCH_LIMITS.timeoutMs,
      contentTypes: ['application/json', 'text/json', 'text/javascript'],
      accept: 'application/json',
      userAgent: USER_AGENT,
    })
    let data
    try {
      data = JSON.parse(answer.bytes.toString('utf8'))
    } catch {
      throw new FetchRefused('The video host answered with something that is not oEmbed.')
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new FetchRefused('The video host answered with something that is not oEmbed.')
    return data
  }

  async function poster(media, data) {
    const host = MEDIA_HOSTS[media.provider]
    const address = typeof data.thumbnail_url === 'string' ? data.thumbnail_url : ''
    let url
    try {
      url = new URL(address)
    } catch {
      return null
    }
    // Only the host's own picture server, over https: never an address the answer makes up.
    if (url.protocol !== 'https:' || !host.posterHosts.includes(url.hostname.toLowerCase())) return null
    const image = await fetch(url.href, {
      allowHosts: host.posterHosts,
      maxBytes: MEDIA_FETCH_LIMITS.posterBytes,
      timeoutMs: MEDIA_FETCH_LIMITS.timeoutMs,
      // Loom's picture server labels its JPEGs application/octet-stream; the bytes are sniffed below
      // and only a real JPEG, PNG, WEBP or GIF is stored.
      contentTypes: [...IMAGE_TYPES, 'application/octet-stream', 'binary/octet-stream'],
      accept: 'image/*',
      userAgent: USER_AGENT,
    })
    const contentType = sniffImage(image.bytes)
    if (!contentType || !IMAGE_TYPES.includes(contentType)) return null
    const stored = await storePoster({ key: posterKey(media, contentType), body: image.bytes, contentType })
    if (typeof stored !== 'string' || !/^(https:\/\/|\/(?![/\\]))\S+$/.test(stored)) return null
    return { poster: stored, posterWidth: size(data.thumbnail_width), posterHeight: size(data.thumbnail_height) }
  }

  /**
   * The video an address names, with its title, author and stored poster when the host answers.
   * subject: who asks (the hourly limit). store false (a preview): look up the title, store no poster.
   * Answers { media, found, notice? }; refuses an address that is not a video (MediaRefused).
   */
  return async function lookup(rawUrl, { subject = 'anyone', store = true } = {}) {
    const parsed = parseMediaUrl(rawUrl)
    if (!parsed) throw new MediaRefused('not_a_video', 'That is not a YouTube, Vimeo or Loom video address.')
    const { start, ...video } = parsed
    const key = `${video.provider}:${video.id}:${video.hash || ''}`
    const withStart = (value) => ({ ...value, ...(start ? { start } : {}) })
    const cached = cache.get(key)
    if (cached) {
      // eslint-disable-next-line no-unused-vars
      const { poster: _p, posterWidth: _w, posterHeight: _h, ...bare } = cached
      return { media: withStart(store ? cached : bare), found: true }
    }
    if (!limit.take(subject)) throw new MediaRefused('rate_limited', 'Too many videos looked up in the last hour. Try again later.', 429)
    let data
    try {
      data = await oembed(video)
    } catch (error) {
      log.warn?.('[media] oEmbed lookup failed', video.provider, error?.message)
      const host = MEDIA_HOST_NAMES[video.provider]
      // The note is still made: the play button and the host's name, and the player when pressed.
      return { media: withStart(video), found: false, notice: `${host} did not share this video's title or picture, so the note shows the play button only.` }
    }
    const info = { ...video, ...(clean(data.title, 300) && { title: clean(data.title, 300) }), ...(clean(data.author_name, 120) && { author: clean(data.author_name, 120) }) }
    if (!store) return { media: withStart(info), found: true }
    let pictured = null
    try {
      pictured = await poster(video, data)
    } catch (error) {
      log.warn?.('[media] poster fetch failed', video.provider, error?.message)
    }
    const value = { ...info, ...(pictured?.poster && { poster: pictured.poster }), ...(pictured?.posterWidth && pictured?.posterHeight && { posterWidth: pictured.posterWidth, posterHeight: pictured.posterHeight }) }
    if (value.poster) cache.set(key, value)
    return { media: withStart(value), found: true, ...(!value.poster && { notice: 'The video\'s picture could not be fetched, so the note shows its title and the play button.' }) }
  }
}
