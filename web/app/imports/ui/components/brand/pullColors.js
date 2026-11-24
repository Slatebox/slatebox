// "Pull colors from my logo", in the browser: the logo is drawn into a small canvas and its pixels read
// (extract-colors, the library the server's own palette reader uses: server/common/imagePalette.mjs).
// A logo on another origin that refuses to be read this way is read by the server instead
// (images.getColors), which reads PNG, JPG, GIF and WEBP but never draws an SVG.
import { Meteor } from 'meteor/meteor'
import { extractColors } from 'extract-colors'
import CONSTANTS from '../../../api/common/constants'

const SIDE = 160

function load(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The logo could not be read.'))
    img.src = src
  })
}

function pixels(img) {
  const ratio = Math.min(1, SIDE / Math.max(img.naturalWidth || SIDE, img.naturalHeight || SIDE))
  const width = Math.max(1, Math.round((img.naturalWidth || SIDE) * ratio))
  const height = Math.max(1, Math.round((img.naturalHeight || SIDE) * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, width, height)
  return { data: Array.from(ctx.getImageData(0, 0, width, height).data), width, height }
}

/** The main colors of a logo (a File just chosen, or the url of one stored), most present first. */
export default async function pullColors(source) {
  const local = typeof source !== 'string'
  const src = local ? URL.createObjectURL(source) : source
  try {
    const img = await load(src, !local)
    const found = await extractColors(pixels(img), { pixels: SIDE * SIDE, distance: 0.18, saturationDistance: 0.2, lightnessDistance: 0.2, hueDistance: 0.08 })
    return found.sort((a, b) => b.area - a.area).map((c) => c.hex)
  } catch (error) {
    if (local || /\.svg(\?|$)/i.test(src)) throw error
    const ext = (src.split('?')[0].split('.').pop() || 'png').toLowerCase()
    const colors = await Meteor.callAsync(CONSTANTS.methods.images.getColors, { imgUrl: src, imgType: `image/${ext === 'jpg' ? 'jpeg' : ext}` })
    if (!colors?.length) throw error
    return colors
  } finally {
    if (local) URL.revokeObjectURL(src)
  }
}
