import { extractColors } from 'extract-colors'
import sharp from 'sharp'
import { isRasterImage } from './upload-kinds.mjs'

function decodeImageDataUri(imageDataUri) {
  const match = /^data:image\/[^;]+;base64,(.+)$/s.exec(imageDataUri)
  if (!match) throw new Error('Expected a base64 image data URI')
  const bytes = Buffer.from(match[1], 'base64')
  // Never an SVG: sharp would draw it here, with no time limit (render-svg.mjs).
  if (!isRasterImage(bytes)) throw new Error('Expected a PNG, JPEG, GIF or WEBP image')
  return bytes
}

export default async function extractImagePalette(imageDataUri, limit = 10) {
  const { data, info } = await sharp(decodeImageDataUri(imageDataUri))
    .resize({
      width: 256,
      height: 256,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const colors = await extractColors({
    data: Array.from(data),
    width: info.width,
    height: info.height,
  })

  return colors.slice(0, limit).map(({ hex }) => hex)
}
