// What the style bar shows and sends, kept apart from how it looks so it can be tested on its own.
// Every change is an ordinary slate package; the canvas page sends it through updateNode or
// updateLine (packageUp, collab.invoke, collab.send), so it is saved, shared and undoable as before.

// ── Text size ────────────────────────────────────────────────────────────────────────────────
export const SIZES = [
  { key: 'S', size: 14, name: 'Small' },
  { key: 'M', size: 18, name: 'Medium' },
  { key: 'L', size: 28, name: 'Large' },
  { key: 'XL', size: 44, name: 'Extra large' },
]
export const MIN_SIZE = 6
export const MAX_SIZE = 400

// A size is drawn in the unit it is stored with: a number or "18px" in pixels, "14pt" in points
// (older slates' first notes are "14pt", drawn at 18.7px). The bar works in pixels.
const sizeNumber = (value) => {
  const raw = String(value ?? '').trim().toLowerCase()
  let n = typeof value === 'number' ? value : parseFloat(raw)
  if (typeof value !== 'number' && raw.endsWith('pt')) n = (n * 4) / 3
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null
}

/** Which size chip a note's font size picks: S, M, L, XL, or Custom with its number. */
export function sizeChoice(fontSize) {
  const n = sizeNumber(fontSize)
  if (n === null) return { key: null }
  const preset = SIZES.find((s) => s.size === n)
  return preset ? { key: preset.key } : { key: 'custom', size: n }
}

/** The package for a new text size, and only the size: never the text, the shape or the box. */
export function sizePackage(size) {
  const n = sizeNumber(size)
  if (n === null || n < MIN_SIZE || n > MAX_SIZE) return null
  return { type: 'onNodeTextChanged', data: { fontSize: n } }
}

// ── Fonts ────────────────────────────────────────────────────────────────────────────────────
// Served by the app itself (public/fonts, with their licences): no request leaves for a font.
export const FONTS = [
  { key: 'clean', name: 'Clean', family: 'Manrope' },
  { key: 'book', name: 'Book', family: 'Lora' },
  { key: 'typewriter', name: 'Typewriter', family: 'Courier Prime' },
  { key: 'handwritten', name: 'Handwritten', family: 'Caveat' },
]

const primaryFamily = (family) => String(family ?? '').split(',')[0].replace(/['"]/g, '').trim()

/** Which font a note's family is, by its name in the bar; a family not offered shows as "Other: <name>". */
export function fontChoice(family) {
  const primary = primaryFamily(family)
  if (!primary) return { key: 'clean', name: 'Clean' }
  const font = FONTS.find((f) => f.family.toLowerCase() === primary.toLowerCase())
  return font ? { key: font.key, name: font.name } : { key: 'other', name: `Other: ${primary}` }
}

export function fontPackage(key) {
  const font = FONTS.find((f) => f.key === key)
  return font ? { type: 'onNodeTextChanged', data: { fontFamily: font.family } } : null
}

export function boldPackage(on) {
  return { type: 'onNodeTextChanged', data: { fontWeight: on ? 'bold' : 'normal' } }
}

// The engine's own words (its operations accept only these; it draws anything else in the centre).
export const ALIGN_ACROSS = ['left', 'middle', 'right']
export const ALIGN_UP_DOWN = ['top', 'middle', 'bottom']

export function alignPackage({ x, y } = {}) {
  const data = {}
  if (ALIGN_ACROSS.includes(x)) data.textXAlign = x
  if (ALIGN_UP_DOWN.includes(y)) data.textYAlign = y
  return Object.keys(data).length ? { type: 'onNodeTextChanged', data } : null
}

// ── Colours ──────────────────────────────────────────────────────────────────────────────────
// Fills chosen so a note's text stays easy to read; the last three are dark, for white text.
export const DEFAULT_SWATCHES = [
  { name: 'Mint', colour: '#d4e9e2' }, { name: 'Butter', colour: '#fbdfac' }, { name: 'Lilac', colour: '#dcdcf3' },
  { name: 'Sky', colour: '#dceaf3' }, { name: 'Blush', colour: '#f0d6dc' }, { name: 'White', colour: '#ffffff' },
  { name: 'Sage', colour: '#cfe0c3' }, { name: 'Lemon', colour: '#fdeea6' }, { name: 'Peach', colour: '#f6c4b0' },
  { name: 'Stone', colour: '#e5e3de' }, { name: 'Leaf', colour: '#8bb174' }, { name: 'Forest', colour: '#24493a' },
  { name: 'Ink', colour: '#1f2a2a' },
]
export const DARK_TEXT = '#1b1f1d'
export const LIGHT_TEXT = '#ffffff'

const NAMED = { white: '#ffffff', black: '#000000', transparent: '#ffffff' }

/** A colour as #rrggbb (lower case), or null when it cannot be read. */
export function toHex(colour) {
  if (colour == null) return null
  const c = String(colour).trim().toLowerCase()
  if (NAMED[c]) return NAMED[c]
  let m = /^#([0-9a-f]{3})$/.exec(c)
  if (m) return '#' + m[1].split('').map((d) => d + d).join('')
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(c)
  if (m) return '#' + m[1]
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c)
  if (m) return '#' + [m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')
  return null
}

const luminance = (hex) => {
  const h = toHex(hex)
  if (!h) return 1
  const ch = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/**
 * A colour's name for a screen reader and a tooltip: the default swatch's own name, or words
 * for its shade and hue ("light orange", "dark green"), never a hex code.
 */
export function colourName(colour) {
  const hex = toHex(colour)
  if (!hex) return 'Colour'
  const known = [...DEFAULT_SWATCHES, ...LINE_SWATCHES].find((s) => s.colour === hex)
  if (known) return known.name
  const [r, g, b] = toRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  const sat = max === min ? 0 : light > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1)
  if (sat < 0.12 || max - min < 0.06) {
    if (light > 0.95) return 'White'
    if (light < 0.08) return 'Black'
    return cap(light > 0.7 ? 'light grey' : light < 0.3 ? 'dark grey' : 'grey')
  }
  let hue = 0
  if (max === r) hue = ((g - b) / (max - min)) % 6
  else if (max === g) hue = (b - r) / (max - min) + 2
  else hue = (r - g) / (max - min) + 4
  hue = (hue * 60 + 360) % 360
  const names = [[15, 'red'], [40, 'orange'], [68, 'yellow'], [160, 'green'], [195, 'teal'], [255, 'blue'], [290, 'purple'], [335, 'pink'], [361, 'red']]
  let name = names.find(([end]) => hue < end)[1]
  if (name === 'orange' && light < 0.4) name = 'brown'
  const shade = light > 0.78 ? 'pale ' : light > 0.62 ? 'light ' : light < 0.3 ? 'dark ' : ''
  return cap(shade + name)
}

/** Colours for lines: dark enough to show as a line on a light canvas (3:1 or more on white). */
export const LINE_SWATCHES = [
  { name: 'Charcoal', colour: '#3d4543' }, { name: 'Grey', colour: '#6b7370' }, { name: 'Forest', colour: '#24493a' },
  { name: 'Green', colour: '#2e7d32' }, { name: 'Teal', colour: '#00796b' }, { name: 'Blue', colour: '#1565c0' },
  { name: 'Indigo', colour: '#3949ab' }, { name: 'Purple', colour: '#7b1fa2' }, { name: 'Red', colour: '#c62828' },
  { name: 'Orange', colour: '#c25100' }, { name: 'Brown', colour: '#795548' },
]

/** A note's fill: both colours of a gradient ("#a-#b"), and the one shown on the swatch. */
export function fillOf(options = {}) {
  const raw = String(options.backgroundColor ?? '#ffffff')
  const parts = raw.includes('-#') ? raw.split('-').filter(Boolean) : [raw]
  const colours = parts.map((p) => toHex(p) ?? p)
  return { colours, colour: colours[colours.length - 1] }
}

/** Text Auto: dark or white, whichever is easier to read on the fill. */
export function autoTextColour(fill) {
  return contrast(LIGHT_TEXT, fill) > contrast(DARK_TEXT, fill) ? LIGHT_TEXT : DARK_TEXT
}

/**
 * Whether a note's text colour is Auto: none was set, or it is plain dark or plain white (the
 * two colours Auto chooses between, as notes made before Auto existed have them). A colour a
 * person picked (red, a brand green) is theirs and is kept.
 */
export function isAutoText(options = {}) {
  const text = toHex(options.fontColor ?? options.foregroundColor)
  if (!text) return true
  const l = luminance(text)
  return l >= 0.9 || l <= 0.02
}

/** A new fill. A note on Auto text gets the readable text colour with it. */
export function fillPackages(options, colour, opacity = 1) {
  const pkgs = [{ type: 'onNodeColorChanged', data: { color: colour, opacity } }]
  if (isAutoText(options)) {
    const next = autoTextColour(colour)
    // Sent unless the text is already exactly that colour (a faded white from an old note becomes plain white).
    if (next !== (options.fontColor ?? options.foregroundColor) || (options.textOpacity ?? 1) !== 1) {
      pkgs.push({ type: 'onNodeTextChanged', data: { fontColor: next, textOpacity: 1 } })
    }
  }
  return pkgs
}

export function textColourPackage(colour, options = {}, opacity = 1) {
  if (colour === 'auto') {
    return { type: 'onNodeTextChanged', data: { fontColor: autoTextColour(fillOf(options).colour), textOpacity: 1 } }
  }
  return { type: 'onNodeTextChanged', data: { fontColor: colour, textOpacity: opacity } }
}

export const BORDER_WIDTHS = [
  { key: 'thin', name: 'Thin', width: 1 },
  { key: 'medium', name: 'Medium', width: 3 },
  { key: 'thick', name: 'Thick', width: 6 },
]
export const BORDER_STYLES = [
  { key: 'solid', name: 'Solid', value: null },
  { key: 'dashed', name: 'Dashed', value: '-' },
  { key: 'dotted', name: 'Dotted', value: '.' },
]

/** Border changes, one package per property: colour and opacity never overwrite each other. */
export function borderPackages({ colour, opacity, width, style } = {}) {
  const pkg = (prop, val) => ({ type: 'onNodeBorderPropertiesChanged', data: { prop, val } })
  const out = []
  if (colour !== undefined) out.push(pkg('borderColor', colour))
  if (opacity !== undefined) out.push(pkg('borderOpacity', opacity))
  if (width !== undefined) {
    const w = BORDER_WIDTHS.find((b) => b.key === width)?.width ?? (Number.isFinite(width) ? width : null)
    if (w !== null) out.push(pkg('borderWidth', w))
  }
  if (style !== undefined) {
    const s = BORDER_STYLES.find((b) => b.key === style)
    if (s) out.push(pkg('borderStyle', s.value))
  }
  return out
}

export const borderWidthKey = (w) => {
  const n = Number(w)
  if (!Number.isFinite(n)) return 'thin'
  return n >= 5 ? 'thick' : n >= 2 ? 'medium' : 'thin'
}
export const borderStyleKey = (s) => (s === '-' || s === '--.' ? 'dashed' : s === '.' ? 'dotted' : 'solid')

/** Recent colours for a slate: newest first, no repeats, at most seven. */
export function recentColoursAfter(list, colour) {
  const c = toHex(colour) ?? colour
  return [c, ...(list || []).filter((x) => x !== c)].slice(0, 7)
}

// ── Effects ──────────────────────────────────────────────────────────────────────────────────
const EFFECT_NAMES = { dropShadow: 'Shadow', blur: 'Blur', outline: 'Outline', postItNote: 'Sticky note', pencil: 'Pencil' }
export function effectName(id) {
  if (!id || id === 'none' || id === 'None') return 'None'
  return EFFECT_NAMES[id] ?? String(id).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}
const effectId = (id) => (!id || id === 'none' || id === 'None' ? '' : id)

/** An effect for the note's shape ('vect') or text ('text'). "None" clears it: the id is empty. */
export function effectPackage(target, id) {
  return { type: 'onNodeEffectChanged', data: { filter: { apply: target === 'text' ? 'text' : 'vect', id: effectId(id) } } }
}
/** Every effect and animation that is on, in words (the Effects and animation row's value). */
export function effectsSummary(options = {}, animations = {}) {
  const animName = (id) => animations[id]?.display || effectName(id)
  const parts = []
  if (options.filters?.vect) parts.push(effectName(options.filters.vect))
  if (options.animations?.vect) parts.push(animName(options.animations.vect))
  if (options.filters?.text) parts.push(`text ${effectName(options.filters.text)}`)
  if (options.animations?.text) parts.push(`text ${animName(options.animations.text)}`)
  return parts.length ? parts.join(', ') : 'None'
}

export function animationPackage(target, id) {
  return { type: 'onNodeEffectChanged', data: { filter: { apply: target === 'text' ? 'text' : 'vect', isAnimation: true, id: effectId(id) } } }
}

// ── Shape, picture, link, lock, order ────────────────────────────────────────────────────────
/** A shape change: the path and its size; the line shape also gets a border that shows. */
export function shapePackage({ path, hint, width, height }, options = {}) {
  const out = []
  if (options.opacity === 0) out.push({ type: 'onNodeColorChanged', data: { opacity: 1, color: options.backgroundColor } })
  out.push({ type: 'onNodeShapeChanged', data: { shape: path, hint, width, height } })
  if (hint === 'line') out.push({ type: 'onNodeBorderPropertiesChanged', data: { prop: 'borderWidth', val: 3 } })
  return out
}

/**
 * A custom shape (one path from slateboxjs/shapes: { name, d, fillRule, aspect, textBox, id? }) on
 * one note. keepProportions sizes the note from its own width and the shape's proportions, so a
 * mixed selection keeps each note's width.
 */
export function customShapePackage(shape, options = {}, { keepProportions = true } = {}) {
  const out = []
  if (options.opacity === 0) out.push({ type: 'onNodeColorChanged', data: { opacity: 1, color: options.backgroundColor } })
  const width = Number(options.width) || 180
  const aspect = Math.min(10, Math.max(0.1, Number(shape.aspect) || 1))
  const height = keepProportions ? Math.max(20, Math.round(width / aspect)) : Number(options.height) || Math.round(width / aspect)
  out.push({
    type: 'onNodeShapeChanged',
    data: {
      shape: 'custom',
      hint: 'custom',
      vectorPath: shape.d,
      fillRule: shape.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
      textBox: shape.textBox ?? null,
      shapeRef: shape.id ? { id: shape.id, name: shape.name } : { name: shape.name },
      width,
      height,
    },
  })
  return out
}

/** A picture from a search result, or none (clears it). */
export function imagePackage(item) {
  if (!item?.link) return { type: 'onNodeImageChanged', data: { img: null } }
  return { type: 'onNodeImageChanged', data: { img: item.link, w: item.image?.width, h: item.image?.height } }
}

/** The picture a generation answered with, or null for an error answer or none at all. */
export function imageFromGeneration(res) {
  const first = Array.isArray(res) ? res[0] : null
  return typeof first === 'string' && first ? first : null
}

export function linkPackage(url, { remove = false } = {}) {
  if (remove) return { pkg: { type: 'onNodeLinkRemoved', data: {} } }
  const address = String(url ?? '').trim()
  if (!address) return { error: 'Type a web address, starting with https://.' }
  if (!/^https?:\/\/\S+$/i.test(address)) return { error: 'A link must start with http:// or https://.' }
  return { pkg: { type: 'onNodeLinkAdded', data: { link: { show: true, type: 'url', data: address } } } }
}

// What a locked note still takes: unlocking, locking and its order. Anything else (a colour, a
// size) is dropped, even from a bar that has not yet heard that someone else locked it.
const ON_LOCKED = new Set(['onNodeLocked', 'onNodeUnlocked', 'onNodeToFront', 'onNodeToBack'])
export function forNote(options = {}, pkgs = []) {
  return options.isLocked ? pkgs.filter((p) => ON_LOCKED.has(p?.type)) : pkgs
}

export const lockPackage = (on) => ({ type: on ? 'onNodeLocked' : 'onNodeUnlocked', data: {} })
export const orderPackage = (where) => ({ type: where === 'back' ? 'onNodeToBack' : 'onNodeToFront', data: {} })

// ── Several notes ───────────────────────────────────────────────────────────────────────────
/** One value shared by all, or mixed. */
export function shared(values) {
  if (!values.length) return { value: undefined, mixed: false }
  const first = JSON.stringify(values[0])
  return values.every((v) => JSON.stringify(v) === first) ? { value: values[0], mixed: false } : { value: undefined, mixed: true }
}

const opts = (n) => n?.options ?? n ?? {}

/** Each setting of the selection: shared, or mixed. */
export function selectionStyle(nodes) {
  const list = nodes.map(opts)
  const pick = (fn) => shared(list.map(fn))
  return {
    fill: pick((o) => fillOf(o).colour),
    border: pick((o) => toHex(o.borderColor) ?? o.borderColor ?? null),
    borderWidth: pick((o) => borderWidthKey(o.borderWidth)),
    borderStyle: pick((o) => borderStyleKey(o.borderStyle)),
    textColour: pick((o) => (isAutoText(o) ? 'auto' : toHex(o.fontColor ?? o.foregroundColor))),
    size: pick((o) => sizeNumber(o.fontSize)),
    font: pick((o) => fontChoice(o.fontFamily).key),
    bold: pick((o) => o.fontWeight === 'bold'),
    // A note made with the engine's default holds "center", drawn the same as "middle".
    alignX: pick((o) => (ALIGN_ACROSS.includes(o.textXAlign) ? o.textXAlign : 'middle')),
    alignY: pick((o) => o.textYAlign || 'middle'),
    locked: pick((o) => Boolean(o.isLocked)),
  }
}

const tab = (list, flag) => list.every((o) => o[flag] !== false)

/**
 * Which bar controls the selection gets. A hidden tab (showXTab) takes its whole control with it.
 * Templates set those flags; chat and exec set them as the operations key hiddenControls.
 */
export function barControls(nodes) {
  const list = nodes.map(opts)
  const one = list.length === 1
  const colour = tab(list, 'showColorTab')
  const text = tab(list, 'showTextTab')
  return {
    fill: colour,
    border: colour,
    textColour: text,
    sizes: text,
    align: text,
    shape: one && tab(list, 'showShapeTab'),
    ask: tab(list, 'showAITab'),
    // The bar never holds a text box: text is typed on the note itself.
    text: false,
  }
}

/**
 * What stays open once the bar's controls change under it (exec hid one, someone locked the
 * note): a popover or sheet whose button is gone closes, and a More detail panel whose row is
 * gone goes back to the rows. `rows` are the keys moreRows gives the note.
 */
export function panelsStillShown({ open = null, colourTab = 'fill', moreView = null, phoneSheet } = {}, show, rows = [], locked = false) {
  const colourShown = { fill: show.fill, border: show.border, text: show.textColour }[colourTab]
  const popShown = {
    colour: !locked && colourShown,
    size: !locked && show.sizes,
    align: !locked && show.align,
    shape: !locked && show.shape,
  }
  const keep = (key) => key === null || !(key in popShown) || Boolean(popShown[key])
  // A locked note's More keeps Locked and Order (the rest are actions, not panels).
  const viewShown = moreView !== null && rows.includes(moreView) && (!locked || moreView === 'order')
  const out = { open: keep(open) ? open : null, moreView: viewShown ? moreView : null }
  if (phoneSheet !== undefined) {
    const sheetShown = {
      colour: !locked && (show.fill || show.border || show.textColour),
      style: !locked && (show.sizes || show.shape),
    }
    out.phoneSheet = phoneSheet === null || !(phoneSheet in sheetShown) || sheetShown[phoneSheet] ? phoneSheet : null
  }
  return out
}

/** The rows of More, each with its current value. */
export function moreRows(nodes, { copiedStyle = null, template = false, phone = false, animations = {} } = {}) {
  const list = nodes.map(opts)
  const one = list.length === 1
  const style = selectionStyle(list)
  const rows = []
  const textShown = tab(list, 'showTextTab')
  // On a phone the bar has no room for the line tool's button, so it leads More.
  if (phone && one) rows.push({ key: 'line', label: 'Draw a line', value: 'To a note or anywhere' })
  if (phone && tab(list, 'showColorTab')) {
    rows.push({ key: 'border', label: 'Border', value: style.borderWidth.mixed || style.borderStyle.mixed ? 'Mixed'
      : `${BORDER_WIDTHS.find((b) => b.key === style.borderWidth.value)?.name}, ${style.borderStyle.value}` })
  }
  if (phone && textShown) {
    const names = { left: 'Left', middle: 'Centre', right: 'Right' }
    rows.push({ key: 'alignment', label: 'Alignment', value: style.alignX.mixed ? 'Mixed' : names[style.alignX.value] })
  }
  if (textShown) {
    const font = style.font.mixed ? 'Mixed' : fontChoice(list[0].fontFamily).name
    rows.push({ key: 'font', label: 'Font', value: font + (style.bold.value ? ', bold' : '') })
  }
  if (one && tab(list, 'showImageTab')) rows.push({ key: 'picture', label: 'Picture', value: list[0].image ? 'Set' : 'None' })
  if (tab(list, 'showEffectTab')) {
    const v = shared(list.map((o) => effectsSummary(o, animations)))
    rows.push({ key: 'effects', label: 'Effects and animation', value: v.mixed ? 'Mixed' : v.value })
  }
  if (one && !template) rows.push({ key: 'link', label: 'Link', value: list[0].link?.show ? 'Edit' : 'Add' })
  rows.push({ key: 'locked', label: 'Locked', value: style.locked.mixed ? 'Mixed' : style.locked.value ? 'On' : 'Off', toggle: true })
  rows.push({ key: 'order', label: 'Order', value: 'Front, back', divider: true })
  rows.push({ key: 'duplicate', label: 'Duplicate' })
  if (one) rows.push({ key: 'copy-style', label: 'Copy style' })
  if (copiedStyle) rows.push({ key: 'paste-style', label: one ? 'Paste style' : `Paste style on ${list.length} notes` })
  if (!template) {
    rows.push({ key: 'copy-picture', label: 'Copy as picture', divider: true })
    rows.push({ key: 'selection-svg', label: 'Selection as SVG' })
  }
  return rows
}

// ── Copy style ──────────────────────────────────────────────────────────────────────────────
const STYLE_KEYS = ['backgroundColor', 'opacity', 'borderColor', 'borderOpacity', 'borderWidth', 'borderStyle',
  'fontSize', 'fontFamily', 'fontColor', 'textOpacity', 'fontWeight', 'textXAlign', 'textYAlign']

/** The style of a note, without its text, size, shape or picture. */
export function copyStyleOf(options = {}) {
  const style = {}
  for (const key of STYLE_KEYS) if (options[key] !== undefined) style[key] = options[key]
  if (style.fontColor === undefined && options.foregroundColor !== undefined) style.fontColor = options.foregroundColor
  if (options.filters && (options.filters.vect || options.filters.text)) {
    style.filters = { vect: options.filters.vect || '', text: options.filters.text || '' }
  }
  return style
}

/** The packages that put a copied style on a note (sent to the selection only). */
export function pasteStylePackages(style = {}) {
  const out = []
  if (style.backgroundColor !== undefined) out.push({ type: 'onNodeColorChanged', data: { color: style.backgroundColor, opacity: style.opacity ?? 1 } })
  out.push(...borderPackages({
    colour: style.borderColor,
    opacity: style.borderOpacity,
    width: style.borderWidth,
  }))
  if (style.borderStyle !== undefined) out.push({ type: 'onNodeBorderPropertiesChanged', data: { prop: 'borderStyle', val: style.borderStyle } })
  const text = {}
  for (const key of ['fontSize', 'fontFamily', 'fontColor', 'textOpacity', 'fontWeight', 'textXAlign', 'textYAlign']) {
    if (style[key] !== undefined) text[key] = style[key]
  }
  if (Object.keys(text).length) out.push({ type: 'onNodeTextChanged', data: text })
  if (style.filters) {
    out.push(effectPackage('vect', style.filters.vect))
    out.push(effectPackage('text', style.filters.text))
  }
  return out
}

// ── Lines ───────────────────────────────────────────────────────────────────────────────────
export const LINE_WIDTHS = [
  { key: 'thin', name: 'Thin', width: 2 },
  { key: 'medium', name: 'Medium', width: 4 },
  { key: 'thick', name: 'Thick', width: 8 },
]
export const lineWidthKey = (w) => (w >= 6 ? 'thick' : w >= 3 ? 'medium' : 'thin')

/** A line's values, read from the line itself first, then from its note's defaults. */
export function lineValues(assoc = {}, owner = {}) {
  const pick = (key, fallback) => assoc[key] ?? owner[key] ?? fallback
  return {
    colour: pick('lineColor', '#666666'),
    width: pick('lineWidth', 3),
    opacity: pick('lineOpacity', 1),
    effect: assoc.lineEffect ?? owner.lineEffect ?? '',
    elbow: assoc.lineType === 'orthogonal',
    curveType: assoc.lineCurveType || 'cubic',
    curviness: assoc.lineCurviness ?? 0.1,
    startArrow: Boolean(assoc.showParentArrow),
    endArrow: assoc.showChildArrow ?? true,
    dash: assoc.lineDash || 'solid',
    label: assoc.label || '',
  }
}

/**
 * How a line's ends behave. An end on a note follows it (no anchor) or is pinned to a spot on
 * its edge (an anchor); an end on no note is free. `mode` is follow or pinned when every end on a
 * note agrees, null when they differ; `summary` says it in words.
 */
export function lineEnds(assoc = {}) {
  const start = assoc.sourceAnchor ? 'pinned' : 'follow'
  const end = assoc.targetPoint ? 'free' : assoc.targetAnchor ? 'pinned' : 'follow'
  const attached = [start, end].filter((s) => s !== 'free')
  const mode = attached.every((s) => s === attached[0]) ? attached[0] : null
  const words = { follow: 'follows its note', pinned: 'pinned', free: 'free' }
  const summary = mode && end !== 'free' ? (mode === 'follow' ? 'follow the notes' : 'pinned')
    : `start ${words[start]}, end ${words[end]}`
  return { start, end, mode, summary }
}

/**
 * The packages that make every end of a line that is on a note follow it, or pin it where it is
 * now (`anchorOf(which)` gives where: the engine's lineEndAnchor). A free end is left as it is,
 * and an end already as asked sends nothing.
 */
export function lineEndsPackages(assoc, mode, anchorOf) {
  const out = []
  for (const which of ['source', 'target']) {
    if (which === 'target' && assoc?.targetPoint) continue
    const prop = which === 'source' ? 'sourceAnchor' : 'targetAnchor'
    const now = assoc?.[prop] ?? null
    if (mode === 'follow' && now) out.push(linePackage(prop, null, assoc))
    if (mode === 'pinned' && !now) {
      const anchor = anchorOf?.(which)
      if (anchor) out.push(linePackage(prop, { x: anchor.x, y: anchor.y }, assoc))
    }
  }
  return out
}

export function linePackage(prop, val, assoc) {
  const value = prop === 'lineEffect' ? effectId(val) : val
  return { type: 'onLinePropertiesChanged', data: { prop, val: value, associationId: assoc?.id } }
}

// ── Placement ───────────────────────────────────────────────────────────────────────────────
export const BAR_GAP = 12
export const NOTE_BAR_WIDTH = { full: 786, compact: 606, phone: 290 }
export const FULL_WIDTH = { note: 786, nodes: 851, line: 638, card: 438 }

/** Full, compact (sizes folded into "Size: M", "Ask"), or the phone's five buttons. */
export function barMode({ kind = 'note', canvasWidth, phone = false }) {
  if (phone) return 'phone'
  return (FULL_WIDTH[kind] ?? FULL_WIDTH.note) > canvasWidth - 32 ? 'compact' : 'full'
}

/**
 * Where the bar goes: centred over the selection, 12px clear of the engine's handles above it,
 * or below when there is no room above; always inside the visible canvas. Null while the
 * selection moves or is off the canvas.
 */
export function placeBar({ frame, bar, canvas, anchorTop = null }) {
  if (!frame || !frame.rect || frame.kind === 'none' || frame.moving) return null
  const r = frame.rect
  if (r.right < canvas.left || r.left > canvas.right || r.bottom < canvas.top || r.top > canvas.bottom) return null
  const clearance = frame.topClearance ?? 0
  const edge = 8
  // Above an anchor (a card's lane) when there is room there; otherwise placed for the selection
  // itself, so it never drops below a card over the rest of its lane.
  if (anchorTop !== null && anchorTop - clearance - BAR_GAP - bar.height < canvas.top + edge) {
    // As high as the canvas allows, covering as little of the lane's title as it can, while it
    // still clears the card; otherwise placed for the card itself.
    const top = canvas.top + edge
    if (top + bar.height + BAR_GAP <= r.top) {
      const centre = (r.left + r.right) / 2
      const left = Math.max(canvas.left + edge, Math.min(centre - bar.width / 2, canvas.right - edge - bar.width))
      return { left, top, below: false }
    }
    return placeBar({ frame, bar, canvas })
  }
  // A line: clear of the line and of the notes at its ends. Above the line, below it, then above
  // or below everything (the line and both notes), whichever is first to fit and cover none.
  const avoid = Array.isArray(frame.avoid) ? frame.avoid.filter(Boolean) : []
  if (avoid.length && anchorTop === null) {
    const all = [r, ...avoid]
    const union = {
      top: Math.min(...all.map((a) => a.top)), bottom: Math.max(...all.map((a) => a.bottom)),
      left: Math.min(...all.map((a) => a.left)), right: Math.max(...all.map((a) => a.right)),
    }
    const centre = (r.left + r.right) / 2
    const left = Math.max(canvas.left + edge, Math.min(centre - bar.width / 2, canvas.right - edge - bar.width))
    const covers = (top) => all.some((a) => left < a.right && left + bar.width > a.left && top < a.bottom && top + bar.height > a.top)
    const fits = (top) => top >= canvas.top + edge && top + bar.height <= canvas.bottom - edge
    const tries = [
      [r.top - clearance - BAR_GAP - bar.height, false],
      [r.bottom + clearance + BAR_GAP, true],
      [union.top - clearance - BAR_GAP - bar.height, false],
      [union.bottom + clearance + BAR_GAP, true],
    ]
    const found = tries.find(([top]) => fits(top) && !covers(top))
    if (found) return { left, top: found[0], below: found[1] }
  }
  const topEdge = anchorTop ?? r.top
  let top = topEdge - clearance - BAR_GAP - bar.height
  let below = false
  if (top < canvas.top + edge) {
    below = true
    top = r.bottom + clearance + BAR_GAP
    if (top + bar.height > canvas.bottom - edge) top = Math.max(canvas.top + edge, canvas.bottom - edge - bar.height)
  }
  const centre = (r.left + r.right) / 2
  let left = centre - bar.width / 2
  left = Math.min(left, canvas.right - edge - bar.width)
  left = Math.max(left, canvas.left + edge)
  return { left, top, below }
}

// ── Workshop cards ──────────────────────────────────────────────────────────────────────────
/** What a workshop card's bar offers: only what the workshop allows. */
export function cardBar({ workshop, cardId, destinations, asksFirst, editable, canEdit, author, conversation }) {
  const card = workshop?.cards?.find((c) => c.id === cardId)
  if (!card) return { controls: [], lanes: [], moveLabel: '' }
  // A lane the rules refuse that the card may still be moved to anyway (asksFirst) is listed too, in the board's order,
  // marked "asks first": choosing it opens "Move anyway?". On a phone this menu is how a card is moved.
  const open = new Set((destinations(workshop, cardId) || []).map((l) => l.id))
  const lanes = workshop.lanes
    .filter((l) => open.has(l.id) || (editable && asksFirst?.(workshop, cardId, l.id)))
    .map((l) => ({ id: l.id, label: l.label, here: l.id === card.laneId, ...(!open.has(l.id) && { asks: true }) }))
  const current = workshop.lanes.find((l) => l.id === card.laneId)
  const controls = []
  if (editable && canEdit) controls.push('edit')
  if (editable && lanes.length > 1) controls.push('move')
  if (conversation) controls.push('ask')
  if (editable && author) controls.push('remove')
  return { card, lanes, controls, moveLabel: `Move to: ${current?.label ?? ''}` }
}

// ── Words ───────────────────────────────────────────────────────────────────────────────────
/** A tooltip names the control only: never a keyboard shortcut a person would have to learn. */
export function tooltipFine(label) {
  return !/[⌘⌥⇧⌃]|\b(ctrl|cmd|command|alt|option|shift)\s*\+/i.test(String(label))
}
