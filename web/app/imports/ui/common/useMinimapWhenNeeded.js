// The minimap is for finding the way around what is off screen. While everything on a plain slate
// is on screen (a new slate, one note, a board that fits) it has nothing to add, so the canvas is
// marked data-whole-in-view and the minimap is hidden (main.css), as a workshop slate already does
// (useWorkshopOnCanvas.js). Checked when the view moves (the canvas's viewBox) and when notes come,
// go or move (the drawing changes).
import { useEffect } from 'react'

/** Whether every note of the engine `v2` lies inside what the canvas shows. An empty slate is all in view. */
export function wholeInView(v2) {
  const seen = v2?.canvas?.viewbox?.()
  if (!seen) return false
  return (v2.getAllNodes?.() ?? []).every(({ options: note }) => {
    const x = note?.x
    const y = note?.y
    if (![x, y].every(Number.isFinite)) return true
    return x >= seen.x - 1 && y >= seen.y - 1 && x + (note.width ?? 0) <= seen.x + seen.width + 1 && y + (note.height ?? 0) <= seen.y + seen.height + 1
  })
}

export default function useMinimapWhenNeeded(v2, element, enabled) {
  useEffect(() => {
    const svg = v2?.canvas?.node
    if (!enabled || !v2 || !element || !svg || typeof MutationObserver !== 'function') return undefined
    let frame = 0
    const mark = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => element.toggleAttribute('data-whole-in-view', wholeInView(v2))) }
    const viewed = new MutationObserver(mark)
    viewed.observe(svg, { attributes: true, attributeFilter: ['viewBox'] })
    // A note added, removed or dragged changes the drawing under the canvas.
    const drawn = new MutationObserver(mark)
    drawn.observe(svg, { childList: true, subtree: true, attributes: true, attributeFilter: ['transform'] })
    window.addEventListener('resize', mark)
    mark()
    return () => {
      cancelAnimationFrame(frame)
      viewed.disconnect()
      drawn.disconnect()
      window.removeEventListener('resize', mark)
      element.removeAttribute('data-whole-in-view')
    }
  }, [v2, element, enabled])
}
