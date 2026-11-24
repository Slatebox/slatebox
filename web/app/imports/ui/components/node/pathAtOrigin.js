import { Slatebox } from 'slateboxjs'

/**
 * A note's outline moved to its own origin. The engine fits a path's own box to the note, so
 * only its shape matters: a path stored in canvas coordinates (around 10000) sent every reader
 * of its bounds (the sibling's line, its preview, the bird's-eye view, animations, exports read
 * from the database) thousands of pixels astray. Every writer stores outlines through this.
 */
export default function pathAtOrigin(path) {
  if (typeof path !== 'string' || !path) return path
  const box = Slatebox.utils.getBBox({ path })
  if (![box?.x, box?.y].every(Number.isFinite) || (box.x === 0 && box.y === 0)) return path
  return Slatebox.utils._transformPath(path, `T${-box.x},${-box.y}`)
}
