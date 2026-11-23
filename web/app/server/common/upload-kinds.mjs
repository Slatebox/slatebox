import { Buffer } from 'node:buffer'
import { renderSvgToPng } from './render-svg.mjs'

// What an upload may be, told by its first bytes, never by the name or type the browser sent.
// The stored name and type are the server's. An SVG logo is stored as a PNG drawn from it, so
// no script in it reaches the public bucket. It is drawn in a child process with a time limit
// (render-svg.mjs): drawing an SVG has no cost bound of its own.
const kinds = [
  { ext: 'png', type: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', type: 'image/gif', test: (b) => b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a' },
  { ext: 'webp', type: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: 'pdf', type: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
]
const rasterKinds = kinds.filter((k) => k.type.startsWith('image/'))

// Before sharp reads bytes a caller supplied (a data URI, a fetched image), they must be a raster
// image by their first bytes: sharp would otherwise detect and draw an SVG, with no time limit,
// in this process.
export function isRasterImage(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 12 && rasterKinds.some((k) => k.test(buffer))
}

const looksLikeSvg = (b) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(b.subarray(0, 4096).toString('utf8'))
const isPlainText = (b) => !b.includes(0) && !/<\s*(html|script|svg|iframe|body|meta)\b/i.test(b.toString('utf8'))

export async function classifyUpload(buffer, declaredName = '') {
  const kind = kinds.find((k) => k.test(buffer))
  if (kind) return { body: buffer, ext: kind.ext, type: kind.type }
  if (looksLikeSvg(buffer)) {
    const { png } = await renderSvgToPng(buffer, { density: 200, maxInputBytes: 2 * 1024 * 1024, timeoutMs: 8000 })
    return { body: png, ext: 'png', type: 'image/png' }
  }
  if (/\.txt$/i.test(declaredName) && isPlainText(buffer)) return { body: buffer, ext: 'txt', type: 'text/plain; charset=utf-8' }
  return null
}
