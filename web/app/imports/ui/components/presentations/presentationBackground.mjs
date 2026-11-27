// A slate's background as part of its style: a color, a gradient (two or three stops, linear at an
// angle or radial) or a picture (cover, contain or tiled, with the color laid over it so notes stay
// readable). The style's record keeps it (options.style.overrides.bg, the color, and
// overrides.background, { gradient } or { picture }), so wearing the style again keeps it and
// "Revert to original" restores the one before. The canvas draws it from options.containerStyle,
// the fields the engine paints (slateboxjs Slate.applyContainerStyle; the same shape update_slate's
// background takes, so an agent sets it with the same checks).

export const GRADIENT_TYPES = Object.freeze(['linear', 'radial'])
export const PICTURE_FITS = Object.freeze(['cover', 'contain', 'repeat'])
/** The most a picture is dimmed, so it never disappears. */
export const DIM_MAX = 0.8
/** A picture's dim when it is first chosen: enough that words on the canvas read. */
export const DIM_DEFAULT = 0.35

const HEX = /^#[0-9a-f]{6}$/i
const hex = (value) => (typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : null)

// An https address, or a path on this app (a file it stored: /files/..., /sbimages/...): never http,
// data:, javascript: or another scheme, never // (another host) or .. (a climb), and nothing that
// could end a CSS url(). The engine checks an agent's picture with the same rule (PICTURE_URL).
const PICTURE_URL = /^(https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~!$&*+,;=:@%/?#-]*)?|\/(?!\/)[A-Za-z0-9._~%/-]+)$/
export const PICTURE_URL_MAX = 2000
export const isPictureUrl = (value) => typeof value === 'string' && value.length <= PICTURE_URL_MAX && PICTURE_URL.test(value) && !/(^|\/)\.\.(\/|$)/.test(value)

const angleOf = (value) => (Number.isInteger(value) && value >= 0 && value <= 359 ? value : null)

/** A gradient made safe: { type, colors: 2 or 3 hex colors, angle? (linear) }, or null. */
export function cleanGradient(value) {
  if (!value || typeof value !== 'object') return null
  const type = GRADIENT_TYPES.includes(value.type) ? value.type : null
  const colors = Array.isArray(value.colors) ? value.colors.map(hex) : []
  if (!type || colors.length < 2 || colors.length > 3 || colors.some((c) => !c)) return null
  const angle = type === 'linear' ? angleOf(value.angle) : null
  return { type, colors, ...(angle !== null ? { angle } : {}) }
}

/** A picture made safe: { url, fit, dim }, or null. */
export function cleanPicture(value) {
  if (!value || typeof value !== 'object' || !isPictureUrl(value.url)) return null
  const fit = PICTURE_FITS.includes(value.fit) ? value.fit : 'cover'
  const dim = typeof value.dim === 'number' && Number.isFinite(value.dim) ? Math.min(Math.max(value.dim, 0), DIM_MAX) : 0
  return { url: value.url, fit, dim: Math.round(dim * 100) / 100 }
}

/** The style record's overrides.background made safe: { gradient } or { picture }, or null. */
export function cleanBackgroundOverride(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 1) return null
  if (keys[0] === 'gradient') {
    const gradient = cleanGradient(value.gradient)
    return gradient ? { gradient } : null
  }
  if (keys[0] === 'picture') {
    const picture = cleanPicture(value.picture)
    return picture ? { picture } : null
  }
  return null
}

/** The colors mixed evenly: the one color a gradient reads as (for the ink of words drawn on it). */
export function blend(colors) {
  const list = colors.map(hex).filter(Boolean)
  if (!list.length) return null
  const channel = (i) => list.reduce((sum, c) => sum + parseInt(c.slice(1 + i * 2, 3 + i * 2), 16), 0) / list.length
  return `#${[0, 1, 2].map((i) => Math.round(channel(i)).toString(16).padStart(2, '0')).join('')}`
}

/**
 * A background the panel or an agent asked for, checked: '#1a2b3c', { color }, { gradient }
 * (its color is the stops blended unless given) or { color?, picture }. → { color, background }
 * where background is the record's { gradient } or { picture } (null for a color). Throws a plain
 * sentence for anything else.
 */
export function readBackground(value, { color: fallback = null } = {}) {
  if (typeof value === 'string') {
    const color = hex(value)
    if (!color) throw new Error('Use a color like #1a2b3c.')
    return { color, background: null }
  }
  if (!value || typeof value !== 'object') throw new Error('Choose a color, a gradient or a picture.')
  if (value.gradient !== undefined && value.picture !== undefined) throw new Error('A background is a gradient or a picture, not both.')
  if (value.gradient !== undefined) {
    const gradient = cleanGradient(value.gradient)
    if (!gradient) throw new Error('A gradient has two or three colors like #1a2b3c, linear (at an angle from 0 to 359) or radial.')
    return { color: hex(value.color) || blend(gradient.colors), background: { gradient } }
  }
  if (value.picture !== undefined) {
    const picture = cleanPicture(value.picture)
    if (!picture) throw new Error('Use a picture you uploaded or an https address.')
    const color = hex(value.color) || hex(fallback) || '#ffffff'
    return { color, background: { picture } }
  }
  const color = hex(value.color)
  if (!color) throw new Error('Use a color like #1a2b3c.')
  return { color, background: null }
}

const directionOf = (angle) => {
  const a = ((angle % 180) + 180) % 180
  if (a < 22.5 || a >= 157.5) return 'vertical'
  if (a >= 67.5 && a < 112.5) return 'horizontal'
  return 'diagonal'
}

// The fields only a gradient or a picture writes, cleared before each background is written.
const CLEARED = ['backgroundImage', 'backgroundSize', 'backgroundDim', 'backgroundGradientAngle', 'backgroundEffect']

/**
 * The containerStyle a background gives, over `cs`: every background field written, so a picture
 * replaces a gradient and a color replaces both. No field is left undefined (a saved slate is JSON).
 */
export function withBackground(cs, color, background) {
  const out = { ...(cs || {}), backgroundColor: color, backgroundColorAsGradient: false }
  CLEARED.forEach((key) => { delete out[key] })
  const gradient = background?.gradient
  const picture = background?.picture
  if (gradient) {
    out.backgroundColorAsGradient = true
    out.backgroundGradientType = gradient.type
    out.backgroundGradientColors = [...gradient.colors]
    if (gradient.type === 'linear' && gradient.angle !== undefined) {
      out.backgroundGradientAngle = gradient.angle
      out.backgroundGradientStrategy = directionOf(gradient.angle)
    }
  } else if (picture) {
    out.backgroundImage = picture.url
    out.backgroundSize = picture.fit
    if (picture.dim) out.backgroundDim = picture.dim
  }
  return out
}

/**
 * The background a slate shows now, read from its containerStyle for the panel:
 * { mode: 'color' | 'gradient' | 'picture', color, gradient?, picture? }. A gradient wins over a
 * picture stored beside it, as the canvas draws them.
 */
export function shownBackground(cs) {
  const color = hex(cs?.backgroundColor) || '#ffffff'
  const stops = Array.isArray(cs?.backgroundGradientColors) ? cs.backgroundGradientColors : []
  if (cs?.backgroundColorAsGradient && stops.length > 1) {
    const type = cs.backgroundGradientType === 'radial' ? 'radial' : 'linear'
    const angle = angleOf(cs.backgroundGradientAngle)
    return { mode: 'gradient', color, gradient: { type, colors: stops.slice(0, 3).map((c) => hex(c) || color), ...(type === 'linear' ? { angle: angle ?? 180 } : {}) } }
  }
  if (typeof cs?.backgroundImage === 'string' && cs.backgroundImage && cs.backgroundImage !== 'none') {
    const fit = PICTURE_FITS.includes(cs.backgroundSize) ? cs.backgroundSize : 'cover'
    const dim = typeof cs.backgroundDim === 'number' ? Math.min(Math.max(cs.backgroundDim, 0), DIM_MAX) : 0
    return { mode: 'picture', color, picture: { url: cs.backgroundImage, fit, dim } }
  }
  return { mode: 'color', color }
}

/** A gradient as CSS, for a swatch (the canvas draws the same: linear at its angle, else a circle). */
export function gradientCss(gradient) {
  if (!gradient) return 'none'
  const colors = gradient.colors.join(', ')
  return gradient.type === 'radial' ? `radial-gradient(circle, ${colors})` : `linear-gradient(${gradient.angle ?? 180}deg, ${colors})`
}

/**
 * Gradients to start from, one per style, in its own colors and calm enough that notes read on
 * them. Their color is what words drawn straight on the background take their ink from.
 */
export const GRADIENT_PRESETS = Object.freeze([
  { id: 'voyage', name: 'Night sky', gradient: { type: 'linear', colors: ['#070b2a', '#1b1f5e', '#3a1d5c'], angle: 160 } },
  { id: 'stage', name: 'Spotlight', gradient: { type: 'radial', colors: ['#2a2a2a', '#000000'] } },
  { id: 'editorial', name: 'Paper', gradient: { type: 'linear', colors: ['#f7f2e9', '#eadfcb'], angle: 180 } },
  { id: 'neon', name: 'Afterglow', gradient: { type: 'linear', colors: ['#0b0016', '#3b0a5e', '#00303a'], angle: 135 } },
  { id: 'sketch', name: 'Sunny page', gradient: { type: 'linear', colors: ['#fbf7ee', '#fff1d6'], angle: 180 } },
  { id: 'blueprint', name: 'Drafting table', gradient: { type: 'radial', colors: ['#1456b8', '#0b3b8c'] } },
  { id: 'journey', name: 'Desert road', gradient: { type: 'linear', colors: ['#f2e8d5', '#f4d9b8', '#e9c9a6'], angle: 135 } },
  { id: 'calm', name: 'Morning', gradient: { type: 'linear', colors: ['#fafaf9', '#e7e5e4'], angle: 180 } },
].map((preset) => Object.freeze({ ...preset, color: blend(preset.gradient.colors) })))

/** Whether two gradients are the same (the panel marks the chosen preset). */
export const sameGradient = (a, b) => Boolean(a && b) && a.type === b.type && a.colors.join() === b.colors.join() && (a.type === 'radial' || (a.angle ?? 180) === (b.angle ?? 180))
