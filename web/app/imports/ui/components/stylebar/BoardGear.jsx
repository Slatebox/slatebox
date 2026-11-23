import React from 'react'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'

// How far around the board the pointer still counts as over it (world units): the sides and foot,
// and the band above it the pointer crosses on its way to the chip.
const AROUND = 24
const ABOVE = 48
const SIZE = 32
const FADE = 600

/** Whether a world point is in the board's hover zone: its box, 24 around it and 48 above it. */
export function inGearZone(frame, point) {
  return Boolean(frame && point) && point.x >= frame.x - AROUND && point.x <= frame.x + frame.width + AROUND &&
    point.y >= frame.y - ABOVE && point.y <= frame.y + frame.height + AROUND
}

/**
 * The gear over a board on a laptop: a small chip just above the board's top-right corner, shown
 * while the pointer is over the board (or the band above it, on the way to the chip), while the
 * pointer is on the chip itself, and while the board is in focus. It goes 600ms after the pointer
 * leaves, while a card is held, and on touch (a phone has the bar of a selected lane and the chat's
 * starter instead). HTML chrome over the board's native notes, in the style bar's layer, so it steps
 * aside during a pan or zoom as the bar does.
 */
export default function BoardGear({ v2, frame, focused, layer, onChangeBoard }) {
  const [near, setNear] = React.useState(false)
  const [onChip, setOnChip] = React.useState(false)
  const [, setView] = React.useState(0)
  const pressed = React.useRef(false)
  const leave = React.useRef(null)
  const frameRef = React.useRef(frame)
  frameRef.current = frame

  React.useEffect(() => {
    const element = v2?.element
    if (!element) return undefined
    const toWorld = (event) => (typeof v2.clientToWorld === 'function' ? v2.clientToWorld({ x: event.clientX, y: event.clientY }) : null)
    const move = (event) => {
      if (event.pointerType === 'touch') { clearTimeout(leave.current); setNear(false); return }
      if (pressed.current) return
      const inside = inGearZone(frameRef.current, toWorld(event))
      if (inside) { clearTimeout(leave.current); leave.current = null; setNear(true) }
      else if (!leave.current) leave.current = setTimeout(() => { leave.current = null; setNear(false) }, FADE)
    }
    // A press on the canvas (a card held, a pan) puts the chip away until the pointer moves again after it.
    const down = (event) => { if (!event.target?.closest?.('.sb-gear')) { pressed.current = true; setNear(false) } }
    const up = () => { pressed.current = false }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    // A pan or a zoom moves the board under the chip: it follows.
    const viewed = typeof MutationObserver === 'function' && v2.canvas?.node
      ? new MutationObserver(() => setView((n) => n + 1)) : null
    viewed?.observe(v2.canvas.node, { attributes: true, attributeFilter: ['viewBox'] })
    return () => {
      clearTimeout(leave.current)
      leave.current = null
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      viewed?.disconnect()
    }
  }, [v2])

  if (!frame || !layer || !v2?.worldToClient || !(near || onChip || focused)) return null
  const box = layer.getBoundingClientRect()
  const corner = v2.worldToClient({ x: frame.x + frame.width, y: frame.y })
  const left = Math.round(Math.min(corner.x - box.left - SIZE, box.width - SIZE - 4))
  const top = Math.round(Math.max(4, corner.y - box.top - 8 - SIZE))
  if (left < 0 || top > box.height - SIZE) return null
  return (
    <button type="button" className="sb-gear" style={{ left, top }} aria-label="Change this board" title="Change this board"
      data-board-gear="" onPointerEnter={() => { clearTimeout(leave.current); leave.current = null; setOnChip(true) }}
      onPointerLeave={() => { setOnChip(false); if (!leave.current) leave.current = setTimeout(() => { leave.current = null; setNear(false) }, FADE) }}
      onClick={onChangeBoard}>
      <SettingsOutlinedIcon aria-hidden />
    </button>
  )
}
