// methods.js
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import { optimize } from 'svgo'
import sharp from 'sharp'
import LRU from 'lru-cache'
import CONSTANTS from '../../imports/api/common/constants'
import { fetchPublicImage, safeFetch } from '../common/safe-fetch.mjs'
import { readStoredFile } from '../common/fileStore'
import { isRasterImage } from '../common/upload-kinds.mjs'

// Create an LRU cache with size and memory limits
const base64Cache = new LRU({
  // Maximum size of cache in bytes (100MB)
  maxSize: 100 * 1024 * 1024,
  // Maximum number of items in cache
  max: 1000,
  // Calculate size of entries in bytes
  sizeCalculation: (value, key) =>
    // Base64 string size in bytes + key length
    Buffer.byteLength(value, 'utf8') + Buffer.byteLength(key, 'utf8'),
  // Items expire after 1 hour
  ttl: 1000 * 60 * 60,
  // When items are fetched, update their TTL
  updateAgeOnGet: true,
})

const imageTypes = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

const method = {}

// A file at a public https address, as a data url: a PDF as it is, an image re-encoded at the
// quality asked for. The address and every redirect are checked (safe-fetch.mjs).
method[CONSTANTS.methods.utils.base64StringFromRemoteUrl] = async (opts) => {
  check(opts, Match.ObjectIncluding({ type: String, url: String, compressionLevel: Match.Maybe(Match.Integer), quality: Match.Maybe(Match.Integer) }))
  const { url } = opts
  const compressionLevel = Math.min(Math.max(opts.compressionLevel ?? 9, 0), 9)
  const quality = Math.min(Math.max(opts.quality ?? 50, 1), 100)
  const isPdf = /^(application\/)?pdf$/.test(opts.type)
  const imgType = opts.type.replace(/^image\//, '')
  if (!isPdf && !imageTypes[imgType]) throw new Meteor.Error('base64-conversion-failed', 'That file type cannot be read.')
  const user = await Meteor.userAsync()
  if (!user) return null
  const cacheKey = `${opts.type}:${url}`
  const cachedResult = base64Cache.get(cacheKey)
  if (cachedResult) return cachedResult
  let base64
  try {
    // A file this app stored in its database is read from there (fileStore.js).
    const stored = await readStoredFile(url)
    if (stored && !(isPdf ? stored.contentType === 'application/pdf' : Object.values(imageTypes).includes(stored.contentType))) throw new Error('That file is not of the type asked for.')
    if (isPdf) {
      const { bytes } = stored ?? await safeFetch(url, { contentTypes: ['application/pdf'] })
      base64 = `data:application/pdf;base64,${bytes.toString('base64')}`
    } else {
      const { bytes } = stored ?? await fetchPublicImage(url)
      if (imgType === 'gif') {
        base64 = `data:image/gif;base64,${bytes.toString('base64')}`
      } else {
        // The bytes are the remote server's, whatever type it claimed: never an SVG, which sharp
        // would draw here with no time limit (render-svg.mjs).
        if (!isRasterImage(bytes)) throw new Error('That address is not a PNG, JPEG, GIF or WEBP image.')
        const image = sharp(bytes, { limitInputPixels: 40e6 })
        let encoded
        if (imgType === 'png') encoded = await image.png({ compressionLevel }).toBuffer()
        else if (imgType === 'webp') encoded = await image.webp({ quality }).toBuffer()
        else encoded = await image.jpeg({ quality }).toBuffer()
        base64 = `data:${imageTypes[imgType]};base64,${encoded.toString('base64')}`
      }
    }
  } catch (err) {
    throw new Meteor.Error('base64-conversion-failed', err.message)
  }
  if (Buffer.byteLength(base64) < 10 * 1024 * 1024) base64Cache.set(cacheKey, base64)
  return base64
}

method[CONSTANTS.methods.utils.optimizeSVG] = async (svg) => {
  check(svg, String)
  const user = await Meteor.userAsync()
  if (user && svg.length <= 2 * 1024 * 1024) {
    return optimize(svg).data
  }
  return null
}

// Whether a public https address answers. Private, loopback and metadata addresses are never asked.
method[CONSTANTS.methods.utils.urlExists] = async (url) => {
  check(url, String)
  const user = await Meteor.userAsync()
  if (!user) return null
  try {
    await safeFetch(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 8000 })
    return true
  } catch {
    return false
  }
}

Meteor.methods(method)
