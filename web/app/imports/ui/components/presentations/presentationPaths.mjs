// Custom SVG paths for presentation styles. Every path here becomes a real SlateboxJS note's
// options.vectorPath (the engine fits the path's box to the note), so silhouettes, stickers,
// swooshes, braces, bubbles and ribbons are notes on the canvas, never overlays. Pure: shared by
// the presenter and the server.

/** A small seeded generator, so a style draws the same shapes every time. */
export function rng(seed) {
  let s = (seed >>> 0) || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}
const f = (n) => Math.round(n * 100) / 100

// Each silhouette's inner safe area for text, as the share of each side kept clear (a chevron's
// notch, a bubble's tail, a pin's point): applied as the note's textInset, so a label never
// crosses the path's outline.
const INSETS = new Map()
const inset = (d, sides) => {
  INSETS.set(d, sides)
  return d
}
const all = (n) => ({ left: n, right: n, top: n, bottom: n })
/** The text inset a path needs ({ left, right, top, bottom } shares), or null for a plain box. */
export const textInsetFor = (d) => (d ? INSETS.get(d) || null : null)

/** A smooth organic blob (Catmull-Rom through jittered radial points). */
export function blob(seed = 1, wobble = 0.16, n = 8) {
  const r = rng(seed)
  const pts = []
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2
    const rad = 50 * (1 - wobble + wobble * 2 * r())
    pts.push([50 + Math.cos(a) * rad, 50 + Math.sin(a) * rad])
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`
  for (let i = 0; i < n; i += 1) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`
  }
  return inset(`${d} Z`, all(0.12 + wobble * 0.5))
}

/** A hand-drawn rectangle: jittered edges with a little overshoot. */
export function wobblyRect(seed = 1, w = 100, h = 60, amp = 1.4) {
  const r = rng(seed)
  const j = () => (r() - 0.5) * 2 * amp
  const pts = []
  const step = 12
  for (let x = 0; x <= w; x += step) pts.push([x + j() * 0.3, j()])
  for (let y = step; y <= h; y += step) pts.push([w + j(), y + j() * 0.3])
  for (let x = w - step; x >= 0; x -= step) pts.push([x + j() * 0.3, h + j()])
  for (let y = h - step; y > 0; y -= step) pts.push([j(), y + j() * 0.3])
  return inset(`M${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' L')} Z`, all(0.05))
}

/** A hand-drawn circle. */
export function wobblyCircle(seed = 3) {
  const r = rng(seed)
  const n = 22
  const pts = []
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2 - 0.3
    const rad = 50 + (r() - 0.5) * 3.2
    pts.push([50 + Math.cos(a) * rad, 50 + Math.sin(a) * rad])
  }
  return inset(`M${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' L')} Z`, all(0.15))
}

/** A starburst sticker. */
export function burst(spikes = 16, inner = 0.78, seed = 5) {
  const r = rng(seed)
  let d = ''
  for (let i = 0; i < spikes * 2; i += 1) {
    const a = (i / (spikes * 2)) * Math.PI * 2
    const rad = i % 2 ? 50 * inner : 50 * (0.96 + r() * 0.04)
    d += `${i ? ' L' : 'M'}${f(50 + Math.cos(a) * rad)},${f(50 + Math.sin(a) * rad)}`
  }
  // The text sits inside the inner circle of the spikes.
  return inset(`${d} Z`, all(Math.min(0.4, 0.5 - inner * 0.5 * 0.72 + 0.02)))
}

/** An orbit ring: outer circle one way, inner the other (the hole stays empty). */
export function ring(thick = 0.6) {
  const o = 50
  const i = 50 - thick
  return `M0,50 A${o},${o} 0 1 1 100,50 A${o},${o} 0 1 1 0,50 Z M${50 - i},50 A${i},${i} 0 1 0 ${50 + i},50 A${i},${i} 0 1 0 ${50 - i},50 Z`
}

/** Torn paper along the top and bottom edges. */
export function torn(seed = 9) {
  const r = rng(seed)
  let d = 'M0,3'
  for (let x = 4; x <= 100; x += 4) d += ` L${x},${f(r() * 5)}`
  d += ' L100,57'
  for (let x = 96; x >= 0; x -= 4) d += ` L${x},${f(55 + r() * 5)}`
  return `${d} Z`
}

/** A hexagon (pointy sides), for photo masks. */
export const hexagon = inset('M25,0 H75 L100,43.3 L75,86.6 H25 L0,43.3 Z', { left: 0.2, right: 0.2, top: 0.08, bottom: 0.08 })
export const ticket = inset('M0,0 H100 V20 A10,10 0 0 0 100,40 V60 H0 V40 A10,10 0 0 0 0,20 Z', { left: 0.11, right: 0.11, top: 0.04, bottom: 0.04 })
export const chevron = inset('M0,0 H84 L100,30 L84,60 H0 L14,30 Z', { left: 0.15, right: 0.17, top: 0.04, bottom: 0.04 })
export const slant = inset('M14,0 H100 L86,60 H0 Z', { left: 0.15, right: 0.15, top: 0.04, bottom: 0.04 })
export const pill = inset('M30,0 H70 A30,30 0 0 1 70,60 H30 A30,30 0 0 1 30,0 Z', { left: 0.12, right: 0.12, top: 0.06, bottom: 0.06 })
export const roundRect = inset('M10,0 H90 Q100,0 100,10 V50 Q100,60 90,60 H10 Q0,60 0,50 V10 Q0,0 10,0 Z', all(0.04))
export const bubble = inset('M10,0 H90 Q100,0 100,10 V50 Q100,60 90,60 H42 L20,80 L26,60 H10 Q0,60 0,50 V10 Q0,0 10,0 Z', { left: 0.06, right: 0.06, top: 0.05, bottom: 0.3 })
export const tab = inset('M0,8 Q0,0 8,0 H40 L46,8 H92 Q100,8 100,16 V60 H0 Z', { left: 0.04, right: 0.04, top: 0.16, bottom: 0.04 })
export const bolt = 'M58,0 L18,56 H44 L30,100 L82,36 H54 L70,0 Z'
export const pin = inset('M50,0 C22,0 4,20 4,46 C4,74 50,120 50,120 C50,120 96,74 96,46 C96,20 78,0 50,0 Z M50,28 A18,18 0 1 0 50.01,28 Z', { left: 0.14, right: 0.14, top: 0.08, bottom: 0.5 })
export const flag = inset('M0,0 H8 V100 H0 Z M8,4 H96 L80,26 L96,48 H8 Z', { left: 0.1, right: 0.2, top: 0.05, bottom: 0.52 })
export const quoteMarks =
  'M30,8 C12,13 2,28 2,46 C2,58 10,66 21,66 C31,66 38,59 38,49 C38,40 31,33 22,33 C20,33 18,34 17,34 C18,25 25,18 35,14 Z ' +
  'M76,8 C58,13 48,28 48,46 C48,58 56,66 67,66 C77,66 84,59 84,49 C84,40 77,33 68,33 C66,33 64,34 63,34 C64,25 71,18 81,14 Z'
/** A brush swoosh (a marker underline). */
export const swoosh = 'M2,34 C22,10 60,4 98,14 C99,17 98,20 95,21 C64,15 30,20 6,42 C3,43 1,38 2,34 Z'
/** A marker highlight behind words. */
export const highlight = 'M3,12 C25,4 70,2 97,8 C100,20 99,40 96,52 C70,58 30,60 4,54 C0,40 0,22 3,12 Z'
/** A curly brace pointing right. */
export const brace = 'M0,0 C12,0 14,4 14,14 V40 C14,46 18,50 24,50 C18,50 14,54 14,60 V86 C14,96 12,100 0,100 L0,97 C8,97 10,94 10,86 V60 C10,54 13,51 17,50 C13,49 10,46 10,40 V14 C10,6 8,3 0,3 Z'
/** Blueprint dimension line: ticks at both ends. */
export const dimension = 'M0,0 H2 V20 H0 Z M98,0 H100 V20 H98 Z M2,9 H98 V11 H2 Z'

/**
 * An open path in canvas coordinates, padded so the engine's fitted box keeps it where it is drawn
 * (two zero-length moves at the box's corners).
 */
export function padded(d, x0, y0, x1, y1) {
  return `M${f(x0)},${f(y0)} h0.01 M${f(x1)},${f(y1)} h0.01 ${d}`
}

/**
 * A ribbon the camera follows: a smooth curve from (x0, y0) to (x1, y1) that bows out by `bow` of
 * its length, as a stroke-only path in canvas coordinates. → { d, box }
 */
export function ribbon(x0, y0, x1, y1, bow = 0.35) {
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const cx = mx + nx * len * bow
  const cy = my + ny * len * bow
  const c1 = [x0 + (cx - x0) * 0.9, y0 + (cy - y0) * 0.9]
  const c2 = [x1 + (cx - x1) * 0.9, y1 + (cy - y1) * 0.9]
  const xs = [x0, x1, c1[0], c2[0]]
  const ys = [y0, y1, c1[1], c2[1]]
  const pad = 20
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + pad * 2, height: Math.max(...ys) - Math.min(...ys) + pad * 2 }
  const d = `M${f(x0)},${f(y0)} C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(x1)},${f(y1)}`
  return { d: padded(d, box.x, box.y, box.x + box.width, box.y + box.height), box }
}

/**
 * A route through points (in step order): one smooth stroke the camera travels along, as a path
 * in canvas coordinates (Catmull-Rom through the points). → { d, box }
 */
export function route(points) {
  const pts = points.filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (pts.length < 2) return null
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`
  }
  const pad = 30
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + pad * 2, height: Math.max(...ys) - Math.min(...ys) + pad * 2 }
  return { d: padded(d, box.x, box.y, box.x + box.width, box.y + box.height), box }
}

/** A hand-drawn arrow from (x0, y0) to (x1, y1), with its head, in canvas coordinates. */
export function scribbleArrow(x0, y0, x1, y1) {
  const { d, box } = ribbon(x0, y0, x1, y1, 0.22)
  const a = Math.atan2(y1 - y0, x1 - x0)
  const h = Math.max(14, Math.hypot(x1 - x0, y1 - y0) * 0.12)
  const p1 = [x1 - Math.cos(a - 0.45) * h, y1 - Math.sin(a - 0.45) * h]
  const p2 = [x1 - Math.cos(a + 0.45) * h, y1 - Math.sin(a + 0.45) * h]
  return { d: `${d} M${f(p1[0])},${f(p1[1])} L${f(x1)},${f(y1)} L${f(p2[0])},${f(p2[1])}`, box }
}

/** Masks a picture can be cut to, by name (the AI and the styles choose among these). */
export const MASKS = {
  rect: roundRect,
  blob: blob(21, 0.1),
  blob2: blob(33, 0.12),
  hexagon,
  slant,
  torn: torn(9),
  circle: 'M50,0 A50,50 0 1 1 49.99,0 Z',
  ticket,
  wobbly: wobblyRect(41),
  pin,
}
export const MASK_NAMES = Object.keys(MASKS)
