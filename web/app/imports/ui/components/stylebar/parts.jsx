import React from 'react'
import { createPortal } from 'react-dom'
import Tooltip from '@mui/material/Tooltip'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'

/**
 * A bar button. An icon-only button shows its name on hover and on keyboard focus (the same
 * words as its accessible name); a button with words needs no tooltip. Nothing shows a shortcut.
 */
export const BarButton = React.forwardRef(function BarButton(
  { label, tip = true, children, caret = false, className = '', pressed, checked, expanded, controls, role, ...rest },
  ref
) {
  const button = (
    <button
      ref={ref}
      type="button"
      className={`sb-btn ${className}`}
      aria-label={label}
      aria-pressed={pressed}
      aria-checked={checked}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      role={role}
      data-roving=""
      {...rest}
    >
      {children}
      {caret && <ExpandMoreIcon className="sb-caret" aria-hidden />}
    </button>
  )
  if (!tip) return button
  return (
    <Tooltip title={label} placement="top" disableInteractive enterDelay={250} describeChild={false}>
      {button}
    </Tooltip>
  )
})

/**
 * The toolbar keyboard pattern: Tab reaches the bar once, the arrows (and Home, End) move along
 * it, and Escape goes back to the canvas.
 */
export function useRoving(ref, deps = []) {
  React.useEffect(() => {
    const bar = ref.current
    if (!bar) return undefined
    const items = () => [...bar.querySelectorAll('[data-roving]')].filter((el) => !el.disabled && el.offsetParent !== null)
    const reset = () => {
      const list = items()
      if (!list.some((el) => el.tabIndex === 0)) list.forEach((el, i) => { el.tabIndex = i === 0 ? 0 : -1 })
      else list.forEach((el) => { if (el.tabIndex !== 0) el.tabIndex = -1 })
    }
    reset()
    const key = (event) => {
      const list = items()
      const at = list.indexOf(document.activeElement)
      if (at < 0) return
      let next = null
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (at + 1) % list.length
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (at - 1 + list.length) % list.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = list.length - 1
      if (next === null) return
      event.preventDefault()
      list.forEach((el, i) => { el.tabIndex = i === next ? 0 : -1 })
      list[next].focus()
    }
    const focus = (event) => {
      const list = items()
      if (list.includes(event.target)) list.forEach((el) => { el.tabIndex = el === event.target ? 0 : -1 })
    }
    bar.addEventListener('keydown', key)
    bar.addEventListener('focusin', focus)
    return () => { bar.removeEventListener('keydown', key); bar.removeEventListener('focusin', focus) }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}

const focusable = 'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])'

const GROUPS = '[role="radiogroup"], [role="tablist"]'
const inGroup = (g) => [...g.querySelectorAll('button')].filter((el) => !el.disabled && el.closest(GROUPS) === g)

/**
 * Inside a popover or sheet, each group of choices (swatches, tabs, options) is one Tab stop:
 * the chosen one, or the first. The arrows (and Home, End) move within the group.
 */
export function groupStops(container) {
  if (!container) return
  container.querySelectorAll(GROUPS).forEach((g) => {
    const items = inGroup(g)
    if (!items.length) return
    const keep = items.find((el) => el === document.activeElement)
      ?? items.find((el) => el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true')
      ?? items[0]
    items.forEach((el) => { el.tabIndex = el === keep ? 0 : -1 })
  })
}

export function groupKeys(event) {
  const g = event.target.closest?.(GROUPS)
  if (!g) return
  const items = inGroup(g)
  const at = items.indexOf(event.target)
  if (at < 0) return
  let next = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (at + 1) % items.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (at - 1 + items.length) % items.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  if (next === null) return
  event.preventDefault()
  event.stopPropagation()
  items.forEach((el, i) => { el.tabIndex = i === next ? 0 : -1 })
  items[next].focus()
}

/** Put the keyboard on what opened: its [data-autofocus], or the first thing that takes it. */
export function focusInto(container) {
  const go = () => (container?.querySelector('[data-autofocus]') ?? container?.querySelector(focusable))?.focus({ preventScroll: true })
  // At once, so the first keys typed land in it; again a frame later if it was not ready.
  go()
  if (!container?.contains(document.activeElement)) requestAnimationFrame(go)
}

/**
 * A popover of the bar. It opens away from the note (up, or beside it), stays inside the canvas,
 * takes the keyboard when opened from the keyboard, and closes on Escape (back to its button)
 * or a press outside.
 */
export function Pop({ id, open, onClose, anchor, layer, note, label, children, className = '', side = false, takeFocus = false }) {
  const ref = React.useRef(null)
  React.useLayoutEffect(() => { if (open) groupStops(ref.current) })
  const [at, setAt] = React.useState(null)
  React.useLayoutEffect(() => {
    if (!open || !ref.current || !anchor || !layer) return
    const place = () => {
      const box = layer.getBoundingClientRect()
      const own = ref.current.getBoundingClientRect()
      const a = anchor.getBoundingClientRect()
      const bar = anchor.closest('.sb-style-bar')?.getBoundingClientRect() ?? a
      const n = note ?? null
      const edge = 8
      const fitsX = (left) => Math.min(Math.max(left, box.left + edge), box.right - edge - own.width)
      const barAboveNote = !n || bar.bottom <= n.top + 1
      const up = bar.top - own.height - 8
      const down = bar.bottom + 8
      let left = fitsX(side ? bar.right - own.width : a.left)
      let top
      if (barAboveNote && up >= box.top + edge && !side) top = up
      else if (!barAboveNote && down + own.height <= box.bottom - edge && !side) top = down
      else {
        // Beside the note: whichever side has room, level with the bar.
        const right = (n?.right ?? bar.right) + 12
        const leftSide = (n?.left ?? bar.left) - 12 - own.width
        left = right + own.width <= box.right - edge ? right : leftSide >= box.left + edge ? leftSide : fitsX(a.left)
        // Below the bar when it is above the note (above it otherwise), so the bar stays usable.
        top = Math.min(Math.max(barAboveNote ? bar.bottom + 8 : bar.top - own.height - 8, box.top + edge), box.bottom - edge - own.height)
      }
      // Placed in the page's terms, then written relative to whatever holds the popover.
      const parent = ref.current.offsetParent?.getBoundingClientRect() ?? box
      const next = { left: Math.round(left - parent.left), top: Math.round(Math.max(top, box.top + edge) - parent.top) }
      setAt((prev) => (prev?.left === next.left && prev?.top === next.top ? prev : next))
    }
    place()
    const watch = new ResizeObserver(place)
    watch.observe(ref.current)
    return () => watch.disconnect()
  }, [open, anchor, layer, note?.top, note?.left, side])
  React.useEffect(() => {
    if (!open) return undefined
    const outside = (event) => {
      if (ref.current?.contains(event.target) || anchor?.contains(event.target)) return
      // A press inside another of the bar's popovers (the custom colour beside this one) is not outside.
      if (event.target.closest?.('.sb-pop')) return
      onClose(false)
    }
    // Escape with the keyboard handed back (after a swatch was pressed) closes the popover and
    // does only that: the canvas does not also clear the selection on the same press.
    const escape = (event) => {
      if (event.key !== 'Escape' || document.querySelector('.sb-inline-editor')) return
      const at = document.activeElement
      const free = !at || at === document.body || at === document.documentElement || at.closest?.('#slateCanvas') || at.closest?.('.sb-style-bar')
      if (!free) return
      event.stopImmediatePropagation()
      event.preventDefault()
      onClose(false)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true) }
  }, [open, anchor, onClose])
  React.useLayoutEffect(() => {
    // Opened from the keyboard, or a popover for typing (a label, a size): the keyboard goes in.
    if (open && (takeFocus || (document.activeElement === anchor && anchor?.matches(':focus-visible')))) focusInto(ref.current)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null
  return (
    <div
      ref={ref}
      id={id}
      role="group"
      aria-label={label}
      className={`sb-pop ${className}`}
      style={{ left: at?.left ?? -9999, top: at?.top ?? -9999, opacity: at ? 1 : 0 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          event.preventDefault()
          onClose(true)
          return
        }
        groupKeys(event)
      }}
    >
      {children}
    </div>
  )
}

/** A phone sheet from the bottom edge. */
export function Sheet({ title, onClose, children, id }) {
  const ref = React.useRef(null)
  React.useLayoutEffect(() => { groupStops(ref.current) })
  React.useEffect(() => {
    requestAnimationFrame(() => ref.current?.querySelector(focusable)?.focus({ preventScroll: true }))
  }, [])
  // On the page itself, above everything beside the canvas (the conversation, the zoom control).
  return createPortal(
    <div
      ref={ref}
      id={id}
      className="sb-sheet"
      role="dialog"
      aria-label={title}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); return } groupKeys(event) }}
    >
      <div className="sb-sheet-grip" aria-hidden />
      <div className="sb-sheet-head">
        <h2>{title}</h2>
        <button type="button" className="sb-sheet-close" aria-label="Close" onClick={onClose}><CloseIcon /></button>
      </div>
      {children}
    </div>,
    document.body
  )
}

/** A row of mutually exclusive choices, as radio buttons. */
export function Choices({ label, value, options, onPick, className = 'sb-choices' }) {
  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((o) => (
        <BarButton key={o.key} role="radio" checked={value === o.key} label={o.label ?? o.name} tip={!o.text && Boolean(o.icon)}
          onClick={() => onPick(o.key)}>
          {o.icon ?? o.text ?? o.name}
        </BarButton>
      ))}
    </div>
  )
}
