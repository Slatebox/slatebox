// A new note made on the canvas itself: the welcome's Add a note and a double-click on empty
// canvas make the same note, in the slate's new-note look (common/noteStyle.mjs), open for typing.
import { useEffect } from 'react'
import { noteAt } from './noteStyle.mjs'

/** A note centred on a point of the slate (slate coordinates), selected, with its words being typed. */
export function addNoteAt(slate, at) {
  const v2 = slate?.v2
  if (!v2?.addNode) return null
  const node = v2.addNode(noteAt(slate.noteStyle, at))
  Promise.resolve(node?.ready).then(() => {
    v2.selectNodes?.([node])
    node?.editor?.startInline?.()
  })
  return node
}

/** A note in the middle of what the canvas shows. */
export function addNoteInView(slate, canvasId) {
  const v2 = slate?.v2
  const canvas = document.getElementById(canvasId)
  if (!v2 || !canvas) return null
  const box = canvas.getBoundingClientRect()
  const at = v2.canvas?.point?.(box.left + box.width / 2, box.top + box.height / 2) ?? { x: 10000, y: 10000 }
  return addNoteAt(slate, at)
}

/** Whether a double-click landed on the slate's empty canvas (its drawing surface), not on a note or anything over it. */
function onEmptyCanvas(target, surface) {
  if (!surface || !target || String(target.tagName).toLowerCase() !== 'svg') return false
  return target === surface || target.contains(surface) || surface.contains(target)
}

/**
 * A double-click on empty canvas makes the slate's new note where it landed, ready to write in.
 * It is taken before the engine sees it (whose own note is grey Arial, and only selected).
 */
export function useNoteOnDoubleClick(slate, canvasId) {
  useEffect(() => {
    const canvas = slate?.v2 && document.getElementById(canvasId)
    if (!canvas) return undefined
    const onDoubleClick = (event) => {
      const { v2 } = slate
      if (!onEmptyCanvas(event.target, v2?.canvas?.node) || v2.isReadOnly?.()) return
      event.stopPropagation()
      event.preventDefault()
      addNoteAt(slate, v2.canvas.point(event.clientX, event.clientY))
    }
    canvas.addEventListener('dblclick', onDoubleClick, true)
    return () => canvas.removeEventListener('dblclick', onDoubleClick, true)
  }, [slate, canvasId])
}
