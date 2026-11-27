// A photo from someone's phone, made safe to store and show (slates.addPhoto): turned upright by its
// EXIF orientation, shrunk to fit 2560 pixels, and written again as JPEG (quality 85), or PNG when
// it has see-through parts. sharp writes no metadata unless asked (withMetadata is never called), so
// the stored copy carries no EXIF (its GPS location included), XMP or IPTC.
//
// Only a JPEG, PNG or WebP by its first bytes reaches sharp: anything else (a GIF, an SVG, which sharp
// would otherwise draw with no time limit, a PDF, a HEIC) is refused before it is read.
// MIT, runs without Meteor (scripts/photo-notes.test.mjs).
import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import { isRasterImage } from './upload-kinds.mjs'

export const PHOTO_CLEAN_LIMITS = Object.freeze({
  // The bytes a photo may be, as sent (before it is cleaned).
  maxBytes: 8 * 1024 * 1024,
  // sharp refuses a picture of more pixels than this before decoding it (a small file can claim a huge size).
  maxPixels: 40_000_000,
  // The longer side of the stored copy.
  maxSide: 2560,
  jpegQuality: 85,
})

export class PhotoRefused extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'PhotoRefused'
    this.status = status
    this.code = code
  }
}

export const PHOTO_TYPE_TEXT = 'Send a JPEG, PNG or WebP photo.'

const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isPng = (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
const isWebp = (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'

/** The kind of photo the bytes are, by their first bytes: 'jpeg', 'png', 'webp', or null. */
export function photoKind(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null
  if (isJpeg(bytes)) return 'jpeg'
  if (isPng(bytes)) return 'png'
  if (isWebp(bytes)) return 'webp'
  return null
}

/**
 * The photo, cleaned: { bytes, width, height, type, ext }. Refuses (PhotoRefused) bytes that are too
 * large (413), not a JPEG, PNG or WebP (415), or not readable as one (415).
 */
export async function cleanPhoto(bytes, { limits = PHOTO_CLEAN_LIMITS } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new PhotoRefused(400, 'invalid_request', 'No photo was sent.')
  if (bytes.length > limits.maxBytes) throw new PhotoRefused(413, 'photo_too_large', 'Photos must be under 8 MB.')
  // A raster image by its first bytes (the rule every sharp caller keeps), and of the three kinds a photo may be.
  if (!isRasterImage(bytes) || !photoKind(bytes)) throw new PhotoRefused(415, 'unsupported_photo', PHOTO_TYPE_TEXT)
  try {
    const source = sharp(bytes, { limitInputPixels: limits.maxPixels, failOn: 'error' })
    const { hasAlpha } = await source.metadata()
    // rotate() with no angle turns the picture upright by its EXIF orientation, then drops the tag.
    const pipeline = source.rotate().resize({ width: limits.maxSide, height: limits.maxSide, fit: 'inside', withoutEnlargement: true })
    const out = hasAlpha
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await pipeline.jpeg({ quality: limits.jpegQuality, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    return {
      bytes: out.data,
      width: out.info.width,
      height: out.info.height,
      type: hasAlpha ? 'image/png' : 'image/jpeg',
      ext: hasAlpha ? 'png' : 'jpg',
    }
  } catch (error) {
    if (error instanceof PhotoRefused) throw error
    if (/pixel limit/i.test(String(error?.message))) throw new PhotoRefused(413, 'photo_too_large', 'That photo has too many pixels. Send one under 40 megapixels.')
    throw new PhotoRefused(415, 'unsupported_photo', `That photo could not be read. ${PHOTO_TYPE_TEXT}`)
  }
}
