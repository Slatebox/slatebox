/* eslint-disable no-param-reassign -- the canvas element and the drawing's elements are styled in place */
// The slate's canvas in light and dark mode (work-polish/audit.md #1).
//
// A slate whose background nobody chose (white: every slate is made with it) follows the app's
// mode: white in light mode, a deep green a step below the dark chrome in dark mode. A slate with
// its own colour, gradient or picture keeps it in both modes. Nothing here is saved: the dark
// canvas, and ink lifted so it reads on it, are how a slate is shown, not what it holds, so
// exports, thumbnails made on the server and other people's screens are unchanged.

export const CANVAS = Object.freeze({
  light: Object.freeze({ background: '#ffffff', ink: '#1d2b2a', line: '#333333' }),
  // ink: text on a clear note; line: a connector nobody coloured.
  dark: Object.freeze({ background: '#14201b', ink: '#eef1e8', line: '#a9bcab' }),
})

/** A new slate's first note: white text on a calm blue, AA (5.2:1), and clear of both canvases. */
export const DEFAULT_NOTE = Object.freeze({ backgroundColor: '#40709a', foregroundColor: '#ffffff' })
/** The first note slates were made with until now: its text was about 2.9:1. Shown as DEFAULT_NOTE. */
export const LEGACY_DEFAULT_NOTE = Object.freeze({ backgroundColor: '#699bc3', foregroundColor: 'rgba(255, 255, 255, 0.87)' })

/** The board's own ink (the engine's boardLayer reads these custom properties), for the dark canvas. */
export const BOARD_INK = Object.freeze({
  dark: Object.freeze({
    '--slatebox-board-ink': '#dfe7dc',
    '--slatebox-board-grid': '#34493e',
    '--slatebox-board-week': '#4b6355',
    '--slatebox-board-accept': '#6fd0a4',
    '--slatebox-board-refuse': '#ff9a62',
    '--slatebox-board-bar': '#7fb3d3',
    '--slatebox-board-track': '#2c3f35',
    '--slatebox-board-launch': '#c79be4',
  }),
})

const NAMED = { white: '#ffffff', black: '#000000' }

/** { r, g, b, a } (0–255, alpha 0–1) from hex, rgb()/rgba(), white, black or transparent; null for anything else. */
export function parseColor(value) {
  if (typeof value !== 'string') return null
  let s = value.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  s = NAMED[s] ?? s
  let m = /^#([0-9a-f]{3,4})$/.exec(s)
  if (m) {
    const [r, g, b, a = 'ff'] = m[1].split('').map((c) => c + c)
    return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16), a: parseInt(a, 16) / 255 }
  }
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(s)
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
    return { r, g, b, a: m[4] ? parseInt(m[4], 16) / 255 : 1 }
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return null
    const [r, g, b] = parts.slice(0, 3).map(Number)
    const alpha = parts[3]
    let a = 1
    if (alpha !== undefined) a = alpha.endsWith('%') ? parseFloat(alpha) / 100 : Number(alpha)
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null
    a = Math.max(0, Math.min(1, a))
    return { r, g, b, a }
  }
  return null
}

const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const asColor = (c) => (typeof c === 'string' ? parseColor(c) : c)

/** `top` laid over `bottom` with `amount` (0–1) of `top`; both opaque colours or strings. */
export function mix(top, bottom, amount) {
  const a = asColor(top)
  const b = asColor(bottom)
  return { r: a.r * amount + b.r * (1 - amount), g: a.g * amount + b.g * (1 - amount), b: a.b * amount + b.b * (1 - amount), a: 1 }
}

export function toHex(color) {
  const c = asColor(color)
  return `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

/** WCAG contrast of `ink` (composited over `background` when translucent) against `background`. */
export function contrast(ink, background) {
  const bg = asColor(background)
  let fg = asColor(ink)
  if (!fg || !bg) return 21
  if (fg.a < 1) fg = mix(fg, bg, fg.a)
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const isWhite = (value) => {
  const c = parseColor(value)
  return Boolean(c && c.a === 1 && c.r === 255 && c.g === 255 && c.b === 255)
}

/**
 * True when a slate's background is the default nobody chose: no picture, no gradient that draws,
 * and white or no colour. Takes the slate's containerStyle, or a background colour on its own.
 */
export function followsTheme(containerStyle) {
  if (containerStyle == null) return true
  if (typeof containerStyle === 'string') return containerStyle.trim() === '' || isWhite(containerStyle)
  const cs = containerStyle
  if (cs.backgroundImage) return false
  if (cs.backgroundColorAsGradient && Array.isArray(cs.backgroundGradientColors) && cs.backgroundGradientColors.length > 1) return false
  return !cs.backgroundColor || isWhite(cs.backgroundColor)
}

/** 'dark' or 'light' for a slate that follows the theme; null for one that keeps its own background. */
export function canvasMode(mode, containerStyle) {
  if (!followsTheme(containerStyle)) return null
  return mode === 'dark' ? 'dark' : 'light'
}

/** The app's mode, with "system" read from the device. */
export function resolveMode(mode, systemMode) {
  if (mode === 'system') return systemMode === 'dark' ? 'dark' : 'light'
  return mode === 'dark' ? 'dark' : 'light'
}

/**
 * The ink to show in place of `ink` on `background` when it would not reach `min` contrast; null
 * when it already reads (or is not a colour). A near-neutral ink becomes the dark canvas's own light
 * ink (`neutral`: the text ink, or CANVAS.dark.line for a line); a coloured one keeps its hue and is
 * lightened just enough to read.
 */
export function liftInk(ink, background, min, neutral = CANVAS.dark.ink) {
  const fg = parseColor(ink)
  const bg = asColor(background)
  if (!fg || !bg || fg.a === 0) return null
  if (contrast(fg, bg) >= min) return null
  // Only a dark canvas lifts ink: on a light one, an ink that does not read was the author's choice.
  if (luminance(bg) > 0.18) return null
  const spread = Math.max(fg.r, fg.g, fg.b) - Math.min(fg.r, fg.g, fg.b)
  if (spread < 40) return neutral
  const opaque = { ...fg, a: 1 }
  for (let amount = 0.1; amount < 1; amount += 0.05) {
    const lifted = mix('#ffffff', opaque, amount)
    // A step of margin over the minimum, so the lifted ink is comfortable, not borderline.
    if (contrast(lifted, bg) >= min + 0.5) return toHex(lifted)
  }
  return CANVAS.dark.ink
}

// ---------------------------------------------------------------------------------------------
// On the page: mark a canvas element and show its ink lifted. Runs in a browser only.

const MARK = 'data-sb-ink'

/** Show `prop` as `value` on `el` (a style, over the attribute the engine drew), and note it in `touched`. */
function paint(el, prop, value, touched) {
  if (prop === 'color' && !el.hasAttribute(MARK)) el.dataset.sbInkColor = el.style.getPropertyValue('color')
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value)
  const props = touched.get(el) || new Set()
  props.add(prop)
  touched.set(el, props)
  const mark = [...props].join(' ')
  if (el.getAttribute(MARK) !== mark) el.setAttribute(MARK, mark)
}

/** Undo every painted style under `root` that this pass (`touched`) did not paint again. */
function unpaintStale(root, touched) {
  root.querySelectorAll(`[${MARK}]`).forEach((el) => {
    const keep = touched.get(el) || new Set()
    const stale = (el.getAttribute(MARK) || '').split(' ').filter((prop) => prop && !keep.has(prop))
    stale.forEach((prop) => {
      if (prop === 'color' && el.dataset.sbInkColor) el.style.setProperty('color', el.dataset.sbInkColor)
      else el.style.removeProperty(prop)
    })
    if (keep.size) el.setAttribute(MARK, [...keep].join(' '))
    else { el.removeAttribute(MARK); delete el.dataset.sbInkColor }
  })
}

/** How much of a note's own fill covers the canvas behind it (0: clear, 1: solid), and its colour. */
function noteBackdrop(path, view) {
  if (!path) return { alpha: 0, color: null }
  const cs = view.getComputedStyle(path)
  const fill = parseColor(cs.fill)
  if (!fill) return { alpha: cs.fill && cs.fill !== 'none' ? 1 : 0, color: null }
  const alpha = fill.a * Number(cs.fillOpacity || 1) * Number(cs.opacity || 1)
  return { alpha, color: fill }
}

/**
 * Show the ink of every note, line and arrow under `root` as it reads on `scheme`'s canvas.
 * `scheme` 'dark' lifts ink that would vanish; any scheme shows the old default note as the new one.
 */
export function inkCanvas(root, scheme) {
  const view = root.ownerDocument?.defaultView
  if (!view) return
  const touched = new Map()
  const bg = scheme === 'dark' ? CANVAS.dark.background : null
  root.querySelectorAll('[data-node-id]').forEach((group) => {
    const path = group.querySelector('[data-node-background-path]')
    const texts = [...group.querySelectorAll(':scope > text')]
    const legacy = path && (path.getAttribute('fill') || '').toLowerCase() === LEGACY_DEFAULT_NOTE.backgroundColor &&
      texts.length > 0 && texts.every((t) => (t.getAttribute('fill') || '').replace(/\s/g, '') === 'rgba(255,255,255,0.87)')
    if (legacy) {
      paint(path, 'fill', DEFAULT_NOTE.backgroundColor, touched)
      texts.forEach((t) => paint(t, 'fill', DEFAULT_NOTE.foregroundColor, touched))
      return
    }
    if (!bg) return
    const { alpha, color } = noteBackdrop(path, view)
    if (alpha >= 0.99) return
    const backdrop = color ? mix(color, bg, alpha) : parseColor(bg)
    texts.forEach((t) => {
      const lifted = liftInk(t.getAttribute('fill'), backdrop, 4.5)
      if (lifted) paint(t, 'fill', lifted, touched)
    })
    // The box a note is typed into while it is edited.
    group.querySelectorAll('.sb-inline-editor').forEach((editor) => {
      const stored = editor.hasAttribute(MARK) ? editor.dataset.sbInkColor : editor.style.getPropertyValue('color')
      const lifted = liftInk(stored, backdrop, 4.5)
      if (lifted) paint(editor, 'color', lifted, touched)
    })
  })
  if (bg) {
    root.querySelectorAll('[data-connection-id]').forEach((line) => {
      const lifted = liftInk(line.getAttribute('stroke'), bg, 3, CANVAS.dark.line)
      if (lifted) paint(line, 'stroke', lifted, touched)
    })
    root.querySelectorAll('marker path, marker polygon, marker circle').forEach((end) => {
      ['fill', 'stroke'].forEach((prop) => {
        const lifted = liftInk(end.getAttribute(prop), bg, 3, CANVAS.dark.line)
        if (lifted) paint(end, prop, lifted, touched)
      })
    })
  }
  unpaintStale(root, touched)
}

/** The dark canvas's colour and the board's dark ink, as custom properties on the canvas element. */
function setCanvasTokens(el, dark) {
  const tokens = { '--sb-canvas-bg': CANVAS.dark.background, ...BOARD_INK.dark }
  Object.entries(tokens).forEach(([name, value]) => {
    if (!dark) el.style.removeProperty(name)
    else if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value)
  })
}

/**
 * Theme the canvas element `el`: mark it `data-sb-canvas="dark"` (main.css paints the dark canvas,
 * the minimap, the zoom controls, the board's ink and its lanes from that) when `mode` is dark and
 * the slate follows the theme, and keep its ink lifted while notes are drawn, edited and recoloured.
 * `getContainerStyle` is read again whenever the canvas element's own style changes (the engine
 * repaints it when the slate's background changes). Returns a function that undoes it all.
 */
export function themeCanvas(el, { mode, getContainerStyle }) {
  if (!el) return () => {}
  const view = el.ownerDocument.defaultView
  let frame = 0
  const flush = () => {
    frame = 0
    const scheme = canvasMode(mode, getContainerStyle?.())
    // The app's mode, for the canvas's own controls (the minimap's frame), whatever the slate's background.
    const app = mode === 'dark' ? 'dark' : 'light'
    if (el.getAttribute('data-sb-mode') !== app) el.setAttribute('data-sb-mode', app)
    if (scheme === 'dark') {
      if (el.getAttribute('data-sb-canvas') !== 'dark') el.setAttribute('data-sb-canvas', 'dark')
      setCanvasTokens(el, true)
    } else if (el.hasAttribute('data-sb-canvas')) {
      el.removeAttribute('data-sb-canvas')
      setCanvasTokens(el, false)
    }
    inkCanvas(el, scheme)
  }
  const schedule = () => { if (!frame) frame = view.requestAnimationFrame(flush) }
  const observer = new view.MutationObserver((records) => {
    // The ink this paints is a style on the drawing's elements: only the canvas's own style (its
    // background) and the drawing's colours, notes and lines coming and going mean a new pass.
    if (records.some((r) => r.type === 'childList' || r.attributeName !== 'style' || r.target === el)) schedule()
  })
  observer.observe(el, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['style', 'fill', 'stroke', 'opacity', 'fill-opacity'] })
  flush()
  return () => {
    observer.disconnect()
    if (frame) view.cancelAnimationFrame(frame)
    el.removeAttribute('data-sb-canvas')
    el.removeAttribute('data-sb-mode')
    setCanvasTokens(el, false)
    unpaintStale(el, new Map())
  }
}
