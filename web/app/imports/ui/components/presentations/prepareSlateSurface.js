import {
  exportPresentationSvg,
  extractPresentationLayout,
  findPresentationBackground,
  resolvePresentationViewport,
} from './presentationRuntime.mjs'
import { withNativeInk } from '../../common/canvasTheme.mjs'

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * A workshop is drawn on the canvas a moment after the slate opens (a reload straight into a
 * live presentation can get here first). Wait, briefly, for the notes the presentation needs.
 */
async function whenDrawn(slate, nodeIds) {
  if (!nodeIds.length) return
  const engine = slate?.v2 || slate
  for (let tries = 0; tries < 40; tries += 1) {
    if (nodeIds.every((id) => engine?.nodes?.one?.(id))) return
    await pause(150)
  }
}

/**
 * What the presenter plays over: the slate's own SVG, as the slate is now, and the layout of its
 * notes (the analysis the presentation's viewpoints are built from).
 *
 * Returns { svg, rawSvg, orient, layout, backgroundImage }: `rawSvg` is the export before it is
 * fitted (kept for a published snapshot); `backgroundImage` is the slate's background picture,
 * which the presenter shows behind the drawing.
 */
export default async function prepareSlateSurface(slate, { drawn = [] } = {}) {
  await whenDrawn(slate, drawn)
  // The surface (and a published presentation's picture) holds the slate's own colours, not the
  // ink lifted for the dark canvas: the export's clone is made inside withNativeInk.
  const exported = await withNativeInk(() => exportPresentationSvg(slate, { skipOptimize: true, drawBorder: true, deferAnimations: true }))
  const { svg: rawSvg, orient } = exported
  if (!rawSvg || !orient) throw new Error('The slate could not be drawn for presenting.')

  const svgDoc = new DOMParser().parseFromString(rawSvg, 'image/svg+xml')
  const svgElement = svgDoc.querySelector('svg')
  svgElement.style.backgroundColor = 'transparent'

  // The export's own background is shown behind the drawing, not inside it.
  let backgroundImage = null
  const exportBackground = findPresentationBackground(svgElement)
  if (exportBackground) {
    if (exportBackground.tagName.toLowerCase() === 'image') {
      backgroundImage = exportBackground.getAttribute('href') || exportBackground.getAttribute('xlink:href') || null
    }
    exportBackground.remove()
  }

  // slateboxjs 3 exports nodes in absolute canvas coordinates. Keep that origin when fitting
  // the SVG: a zero-based viewBox leaves canvases around the default 10,000 origin blank.
  const viewport = resolvePresentationViewport(svgElement.getAttribute('viewBox'), orient)
  svgElement.setAttribute('viewBox', `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`)
  svgElement.setAttribute('width', `${viewport.width}`)
  svgElement.setAttribute('height', `${viewport.height}`)
  svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svgElement.style.width = `${viewport.width}px`
  svgElement.style.height = `${viewport.height}px`

  // The layout is measured from the same origin as the fitted SVG, so a viewpoint's box is
  // where its notes are drawn.
  const origin = { ...orient, left: viewport.x, top: viewport.y }
  return {
    svg: new XMLSerializer().serializeToString(svgDoc),
    rawSvg,
    orient: origin,
    layout: extractPresentationLayout(slate, { orientData: origin }),
    backgroundImage,
  }
}
