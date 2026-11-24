// The brand kit (/team/branding), kept apart from how it looks so it can be tested on its own.
//
// What a team's kit is, as stored (organizationSettings, one document per item, team admins only):
//   logo        { logoType: 'squareLogo' | 'primaryLogo', name, url }
//   color       { name, value: '#rrggbb', role?: 'primary' | 'accent' | 'neutral' }
//   typography  { name, value }   (older font styles: a preset may name one; the page no longer adds them)
//   preset      intentionId 'default' or a chat intention's id, value:
//               { background, categoryStyles: [{ backgroundColor, foregroundColor }], noteStyles,
//                 categoryFont, categoryFontSize, noteFont, noteFontSize,
//                 presentationMenuBgColorKey, presentationControlsColorKey }   (the last two hold colors)
//
// Where it is read (the page's "Where your brand shows up" says the same, and nothing more):
//   new slates        imports/api/client/createSlate.js: the default preset's background, and its first
//                     heading style, heading font and size for every new note (ui/common/noteStyle.mjs)
//   AI-made slates    server/methods/openai.js: the slate type's preset (else the default): heading and
//                     note color pairs, fonts, sizes and background, as instructions to the AI
//   presentations     server/methods/presentations.js: the square logo and the preset's bar colors, in the
//                     player of a published presentation (components/presentations/BasePresent.jsx)
//   team export       server/team-export: every item, in the team's export file
import { contrast, DEFAULT_NOTE } from '../../common/canvasTheme.mjs'
import { NOTE_FONT, NOTE_SIZE } from '../../common/noteStyle.mjs'
import { SIZES } from '../../../api/common/note-style.mjs'

export const LOGO_TYPES = Object.freeze([
  {
    key: 'squareLogo',
    name: 'Square logo',
    use: 'Shown in the corner of every presentation your team publishes.',
    used: true,
  },
  {
    key: 'primaryLogo',
    name: 'Wide logo',
    use: 'Kept with your kit. Slatebox does not show it anywhere yet.',
    used: false,
  },
])

// What the upload route takes (server/sbImages.js: classifyUpload and its 20 MB limit).
export const LOGO_TYPES_ACCEPTED = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'
export const LOGO_MAX_BYTES = 20 * 1024 * 1024
export const LOGO_RULES = 'PNG, JPG, GIF, WEBP or SVG, up to 20 MB. A transparent background looks best.'

/** Why a file can't be a logo, or null when it can. */
export function logoFileProblem(file) {
  if (!file) return 'Choose a file.'
  const type = String(file.type || '').toLowerCase()
  const name = String(file.name || '').toLowerCase()
  const known = LOGO_TYPES_ACCEPTED.split(',').includes(type) || /\.(png|jpe?g|gif|webp|svg)$/.test(name)
  if (!known) return `${file.name || 'That file'} is not a PNG, JPG, GIF, WEBP or SVG.`
  if (Number(file.size) > LOGO_MAX_BYTES) return `${file.name || 'That file'} is larger than 20 MB.`
  return null
}

export const ROLES = Object.freeze([
  { key: 'primary', name: 'Primary', hint: 'Heading notes and the presentation bar' },
  { key: 'accent', name: 'Accent', hint: 'Notes under the headings' },
  { key: 'neutral', name: 'Neutral', hint: 'The slate background' },
])

// The fonts a note can really be drawn in: the four the app serves itself (public/fonts, the style bar's
// fonts) and three every computer has. Any other family falls back to the reader's default font.
export const BRAND_FONTS = Object.freeze([
  { family: 'Manrope', label: 'Clean', source: 'served' },
  { family: 'Lora', label: 'Book', source: 'served' },
  { family: 'Courier Prime', label: 'Typewriter', source: 'served' },
  { family: 'Caveat', label: 'Handwritten', source: 'served' },
  { family: 'Arial', label: 'Arial', source: 'system' },
  { family: 'Georgia', label: 'Georgia', source: 'system' },
  { family: 'Times New Roman', label: 'Times New Roman', source: 'system' },
])

const primaryFamily = (family) => String(family ?? '').split(',')[0].replace(/['"]/g, '').trim()

/** A font family as the page shows it: one of BRAND_FONTS, or one that won't draw on slates. */
export function fontInfo(family) {
  const name = primaryFamily(family)
  if (!name) return { family: NOTE_FONT, label: 'Clean', source: 'served', isDefault: true }
  const known = BRAND_FONTS.find((f) => f.family.toLowerCase() === name.toLowerCase())
  return known ? { ...known } : { family: name, label: name, source: 'missing' }
}

/**
 * A preset's font as a family: presets name a family (Lora), or, from the older font styles, a
 * typography setting's name ("Headings") or its key ("courier-prime"). `typography` maps a style's
 * name to its family, as createSlate.js does.
 */
export function presetFamily(font, typography = {}) {
  if (!font) return null
  const named = typography[font]
  const raw = named || font
  const byKey = BRAND_FONTS.find((f) => f.family.toLowerCase().replace(/\s+/g, '-') === String(raw).toLowerCase())
  return byKey ? byKey.family : raw
}

export const SIZE_CHOICES = SIZES // S 14, M 18, L 28, XL 44: the style bar's sizes, in pixels
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 120

/** A preset's size as pixels in range, or null for "not set". */
export function fontSize(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, n))
}

// ── Colors ─────────────────────────────────────────────────────────────────────────────────────
export function normalHex(value) {
  const raw = String(value ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map((c) => c + c).join('')}`.toLowerCase()
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toLowerCase()
  return null
}

/** WCAG level of a text color on a fill: AAA, AA, AA large (bold or 24px and up only) or fail. */
export function contrastCheck(ink, fill) {
  const ratio = Math.round(contrast(ink, fill) * 100) / 100
  let level = 'fail'
  if (ratio >= 7) level = 'AAA'
  else if (ratio >= 4.5) level = 'AA'
  else if (ratio >= 3) level = 'AA large'
  return { ratio, level, passes: ratio >= 4.5 }
}

/** Black or white, whichever reads better on a fill. */
export function inkOn(fill) {
  return contrast('#ffffff', fill) >= contrast('#111111', fill) ? '#ffffff' : '#111111'
}

/** The text color that makes a pair pass AA: the pair's own when it does, else black or white. */
export function readableInk(ink, fill) {
  return ink && contrastCheck(ink, fill).passes ? ink : inkOn(fill)
}

/** A team's colors, as the page lists them: each with its id, name, hex and role. */
export function paletteOf(settings) {
  return (settings || [])
    .filter((s) => s?.type === 'color' && !s.deleted && normalHex(s.value?.value))
    .map((s) => ({ _id: s._id, name: s.value?.name || 'Unnamed color', value: normalHex(s.value.value), role: s.value?.role || null }))
}

/** A name for a color pulled from a logo, from its hue and lightness ("Deep blue", "Light gray"). */
export function colorName(hex) {
  const h = normalHex(hex)
  if (!h) return 'Color'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let hue = 0
  if (d) {
    if (max === r) hue = ((g - b) / d) % 6
    else if (max === g) hue = (b - r) / d + 2
    else hue = (r - g) / d + 4
    hue = Math.round(hue * 60 + 360) % 360
  }
  const tone = l < 0.3 ? 'Deep ' : l > 0.75 ? 'Light ' : ''
  if (s < 0.12) return l < 0.12 ? 'Black' : l > 0.94 ? 'White' : `${tone}gray`
  const names = [[15, 'red'], [40, 'orange'], [65, 'yellow'], [160, 'green'], [195, 'teal'], [255, 'blue'], [290, 'purple'], [335, 'pink'], [360, 'red']]
  const name = names.find(([edge]) => hue < edge)?.[1] ?? 'red'
  return `${tone}${name}`.replace(/^./, (c) => c.toUpperCase())
}

/**
 * Colors pulled from a logo, ready to add: the strongest few that the kit doesn't already hold (or
 * nearly hold), each named and given the role a kit would want (the first colorful one primary,
 * the next accent, the lightest or darkest gray neutral).
 */
export function colorsFromLogo(hexes, existing = [], limit = 5) {
  const close = (a, b) => {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) < 28
  }
  const held = existing.map((c) => normalHex(c.value ?? c)).filter(Boolean)
  const roles = new Set(existing.map((c) => c.role).filter(Boolean))
  const out = []
  for (const raw of hexes || []) {
    const value = normalHex(raw)
    if (!value || held.some((h) => close(h, value)) || out.some((c) => close(c.value, value))) continue
    out.push({ value, name: colorName(value), role: null })
    if (out.length >= limit) break
  }
  const gray = (c) => /gray|black|white/i.test(c.name)
  for (const role of ['primary', 'accent']) {
    if (roles.has(role)) continue
    const pick = out.find((c) => !c.role && !gray(c))
    if (pick) { pick.role = role; roles.add(role) }
  }
  if (!roles.has('neutral')) {
    const pick = out.find((c) => !c.role && gray(c))
    if (pick) pick.role = 'neutral'
  }
  return out
}

// ── The style a preset gives slates ────────────────────────────────────────────────────────────
// What a slate gets with no preset at all: white canvas, the default note (noteStyle.mjs), the dark
// presentation bar.
export const SLATEBOX_DEFAULTS = Object.freeze({
  background: '#ffffff',
  heading: Object.freeze({ backgroundColor: DEFAULT_NOTE.backgroundColor, foregroundColor: DEFAULT_NOTE.foregroundColor }),
  note: Object.freeze({ backgroundColor: '#ffffff', foregroundColor: '#1d2b2a' }),
  headingFont: NOTE_FONT,
  headingSize: NOTE_SIZE,
  noteFont: NOTE_FONT,
  noteSize: 14,
  barColor: '#1f2a26',
  controlsColor: '#ffffff',
})

/** A preset's background as one color for the preview (its base color, for a gradient), or null. */
export function backgroundOf(preset) {
  const bg = preset?.background
  if (!bg) return null
  if (bg.activeType === 'gradient') return normalHex(bg.gradientConfig?.baseColorValue) || normalHex(bg.gradientConfig?.gradientColors?.[0])
  return normalHex(bg.colorValue)
}

/** The background kinds a preset can have: none (Slatebox's), one color, or a soft gradient. */
export function backgroundKind(preset) {
  const bg = preset?.background
  if (!bg || !backgroundOf(preset)) return 'none'
  return bg.activeType === 'gradient' ? 'gradient' : 'color'
}

/** A background value as createSlate.js reads it. `shades` is the gradient's colors (from the server). */
export function backgroundValue(kind, hex, shades = []) {
  const value = normalHex(hex)
  if (kind === 'none' || !value) return null
  if (kind === 'gradient') {
    const colors = (shades || []).map(normalHex).filter(Boolean).slice(0, 5)
    return {
      activeType: 'gradient',
      colorValue: null,
      gradientConfig: { baseColorValue: value, gradientColorCount: colors.length || 1, gradientType: 'radial', gradientStrategy: 'shades', gradientColors: colors.length ? colors : [value] },
    }
  }
  return { activeType: 'color', colorValue: value, gradientConfig: null }
}

const pairs = (list) => (Array.isArray(list) ? list : [])
  .map((p) => ({ backgroundColor: normalHex(p?.backgroundColor), foregroundColor: normalHex(p?.foregroundColor) }))
  .filter((p) => p.backgroundColor)
  .map((p) => ({ ...p, foregroundColor: p.foregroundColor || inkOn(p.backgroundColor) }))

/**
 * Everything a preset says, filled in with what slates get without it, for the preview and the
 * fields: colors as hex, fonts as families, sizes as pixels.
 */
export function effectiveStyle(preset, typography = {}) {
  const p = preset || {}
  const headings = pairs(p.categoryStyles)
  const notes = pairs(p.noteStyles)
  return {
    background: backgroundOf(p) || SLATEBOX_DEFAULTS.background,
    backgroundColors: backgroundKind(p) === 'gradient' ? (p.background.gradientConfig.gradientColors || []).map(normalHex).filter(Boolean) : [],
    headings: headings.length ? headings : [SLATEBOX_DEFAULTS.heading],
    notes: notes.length ? notes : [SLATEBOX_DEFAULTS.note],
    headingFont: presetFamily(p.categoryFont, typography) || SLATEBOX_DEFAULTS.headingFont,
    headingSize: fontSize(p.categoryFontSize) || SLATEBOX_DEFAULTS.headingSize,
    noteFont: presetFamily(p.noteFont, typography) || SLATEBOX_DEFAULTS.noteFont,
    noteSize: fontSize(p.noteFontSize) || SLATEBOX_DEFAULTS.noteSize,
    barColor: normalHex(p.presentationMenuBgColorKey) || SLATEBOX_DEFAULTS.barColor,
    controlsColor: normalHex(p.presentationControlsColorKey) || SLATEBOX_DEFAULTS.controlsColor,
    custom: {
      background: Boolean(backgroundOf(p)),
      headings: headings.length > 0,
      notes: notes.length > 0,
      headingFont: Boolean(p.categoryFont),
      headingSize: Boolean(fontSize(p.categoryFontSize)),
      noteFont: Boolean(p.noteFont),
      noteSize: Boolean(fontSize(p.noteFontSize)),
      bar: Boolean(normalHex(p.presentationMenuBgColorKey)),
      controls: Boolean(normalHex(p.presentationControlsColorKey)),
    },
  }
}

/** True when a preset says nothing (slates of that kind look like Slatebox's own). */
export function presetIsEmpty(preset) {
  const c = effectiveStyle(preset).custom
  return !Object.values(c).some(Boolean)
}

/**
 * A preset from the kit's colors by role, in one step ("Use my colors"): heading notes in the primary
 * color, notes under them in the accent (or a light tint of it, readable either way), the background
 * in the neutral, the presentation bar in the primary. Fonts and sizes are kept. Only roles the kit
 * has are used; with none, the first colors stand in.
 */
export function presetFromColors(palette, preset = {}) {
  const colors = (palette || []).filter((c) => normalHex(c.value))
  if (!colors.length) return { ...preset }
  const byRole = (role) => colors.find((c) => c.role === role)?.value
  const colorful = colors.filter((c) => !/gray|black|white/i.test(colorName(c.value)))
  const primary = byRole('primary') || colorful[0]?.value || colors[0].value
  const accent = byRole('accent') || colorful.find((c) => c.value !== primary)?.value || null
  const neutral = byRole('neutral') || null
  const heading = { backgroundColor: primary, foregroundColor: inkOn(primary) }
  const headings = [heading]
  if (accent) headings.push({ backgroundColor: accent, foregroundColor: inkOn(accent) })
  const notes = [{ backgroundColor: '#ffffff', foregroundColor: readableInk(primary, '#ffffff') }]
  if (accent) notes.unshift({ backgroundColor: accent, foregroundColor: inkOn(accent) })
  const next = {
    ...preset,
    categoryStyles: headings,
    noteStyles: notes,
    presentationMenuBgColorKey: primary,
    presentationControlsColorKey: inkOn(primary),
  }
  if (neutral) next.background = backgroundValue('color', neutral)
  return next
}

/** The color pairs a style shows text on, each with its contrast check, for the AA warnings. */
export function contrastWarnings(style) {
  const out = []
  style.headings.forEach((p, i) => out.push({ key: `heading-${i}`, label: `Heading style ${i + 1}`, ink: p.foregroundColor, fill: p.backgroundColor, ...contrastCheck(p.foregroundColor, p.backgroundColor) }))
  style.notes.forEach((p, i) => out.push({ key: `note-${i}`, label: `Note style ${i + 1}`, ink: p.foregroundColor, fill: p.backgroundColor, ...contrastCheck(p.foregroundColor, p.backgroundColor) }))
  out.push({ key: 'bar', label: 'Presentation bar', ink: style.controlsColor, fill: style.barColor, ...contrastCheck(style.controlsColor, style.barColor) })
  return out.filter((w) => !w.passes)
}

/** A preset made safe to save: hex colors, family names, pixel sizes, nothing unknown left as "". */
export function cleanPreset(preset) {
  const p = { ...(preset || {}) }
  p.categoryStyles = pairs(p.categoryStyles)
  p.noteStyles = pairs(p.noteStyles)
  for (const key of ['categoryFontSize', 'noteFontSize']) p[key] = fontSize(p[key])
  for (const key of ['categoryFont', 'noteFont']) p[key] = p[key] ? primaryFamily(p[key]) : null
  for (const key of ['presentationMenuBgColorKey', 'presentationControlsColorKey']) p[key] = normalHex(p[key])
  if (!p.background || !backgroundOf(p)) delete p.background
  return p
}

// ── Where it shows up ──────────────────────────────────────────────────────────────────────────
/**
 * What the kit changes today, item by item, for the page's "Where your brand shows up". `kit` is
 * { squareLogo, primaryLogo, palette, defaultPreset, typePresets } as the page holds them.
 */
export function brandUses(kit = {}) {
  const preset = kit.defaultPreset || null
  const style = effectiveStyle(preset)
  const has = (v) => (v ? 'on' : 'off')
  return [
    {
      key: 'new-slates',
      place: 'New slates',
      what: 'Background, and the color, font and size of every new note.',
      from: 'Default style',
      state: has(style.custom.background || style.custom.headings || style.custom.headingFont || style.custom.headingSize),
      link: { to: '/new', label: 'Start a slate' },
    },
    {
      key: 'ai-slates',
      place: 'Slates made with Ask Slatebox',
      what: 'The AI is told to use your heading and note colors, fonts, sizes and background.',
      from: kit.typePresets ? 'Default style, or the style for that kind of slate' : 'Default style',
      state: has(!presetIsEmpty(preset) || Boolean(kit.typePresets)),
      link: { to: '/new', label: 'Try it on a new slate' },
    },
    {
      key: 'presentations',
      place: 'Published presentations',
      what: 'Your square logo in the corner, and your bar and control colors.',
      from: 'Square logo and presentation bar',
      state: has(kit.squareLogo || style.custom.bar || style.custom.controls),
      link: { to: '/', label: 'Open a slate to present' },
    },
    {
      key: 'export',
      place: 'Team export',
      what: 'The whole kit is included when an admin exports everything.',
      from: 'Everything here',
      state: 'on',
      link: { to: '/team/settings', label: 'Team settings' },
    },
  ]
}

/** What the kit does not reach yet, said plainly on the page so nobody looks for it. */
export const NOT_YET = Object.freeze([
  'Presentation styles chosen in the Present composer (they use their own look, not your colors or fonts).',
  'Share images: a public slate\'s link shows a picture of the slate; without one it shows the Slatebox logo, not yours.',
  'Picture and PDF exports of a slate.',
  'Your wide logo.',
])

// ── The preview's sample slate ─────────────────────────────────────────────────────────────────
// Words chosen to test the fit: a long single word, a short one, and lines that must wrap.
export const SAMPLE_HEADINGS = Object.freeze(['Quarterly roadmap', 'Customer research', 'Internationalization'])
export const SAMPLE_NOTES = Object.freeze([
  ['Ship the onboarding checklist', 'Pricing page'],
  ['Interview twelve customers', 'Accessibility'],
  ['Localization review', 'Right-to-left layouts'],
])

/**
 * The sample slate the preview draws, as slate JSON the engine loads: heading notes in the heading
 * styles, notes under them in the note styles, a line from each heading to its notes. Every note is
 * sized for its words by `fit({ text, fontSize, fontFamily })` (fitNote.mjs, with the page's measure),
 * so the engine lays out every word whole, inside its note.
 */
export function sampleSlate(style, fit, { headings = SAMPLE_HEADINGS, notes = SAMPLE_NOTES } = {}) {
  const GAP_X = 56
  const GAP_Y = 64
  const STACK = 22
  const nodes = []
  let x = 0
  headings.forEach((title, col) => {
    const hs = style.headings[col % style.headings.length]
    const head = fit({ text: title, fontSize: style.headingSize, fontFamily: style.headingFont, minWidth: 150, maxWidth: 300, minHeight: 60 })
    const kids = (notes[col] || []).map((text, row) => {
      const ns = style.notes[(col + row) % style.notes.length]
      return { text, ns, box: fit({ text, fontSize: style.noteSize, fontFamily: style.noteFont, minWidth: 130, maxWidth: 260, minHeight: 52 }) }
    })
    const colWidth = Math.max(head.width, ...kids.map((k) => k.box.width))
    const headId = `brand-heading-${col}`
    const associations = []
    let y = head.height + GAP_Y
    kids.forEach((k, row) => {
      const id = `brand-note-${col}-${row}`
      nodes.push({
        options: {
          id, text: k.text, xPos: x + (colWidth - k.box.width) / 2, yPos: y, width: k.box.width, height: k.box.height,
          backgroundColor: k.ns.backgroundColor, foregroundColor: k.ns.foregroundColor, fontFamily: style.noteFont, fontSize: style.noteSize,
          shape: 'roundedrectangle', vectorPath: 'roundedrectangle', borderWidth: k.ns.backgroundColor === '#ffffff' ? 1 : 0, borderColor: '#d6dbd2',
          allowDrag: false, allowMenu: false, allowContext: false, allowResize: false,
        },
        relationships: { associations: [] },
      })
      associations.push({ parentId: headId, childId: id, lineColor: hs.backgroundColor, lineWidth: 3, showChildArrow: false, lineType: 'bezier' })
      y += k.box.height + STACK
    })
    nodes.unshift({
      options: {
        id: headId, text: title, xPos: x + (colWidth - head.width) / 2, yPos: 0, width: head.width, height: head.height,
        backgroundColor: hs.backgroundColor, foregroundColor: hs.foregroundColor, fontFamily: style.headingFont, fontSize: style.headingSize,
        shape: 'roundedrectangle', vectorPath: 'roundedrectangle', borderWidth: 0,
        allowDrag: false, allowMenu: false, allowContext: false, allowResize: false,
      },
      relationships: { associations },
    })
    x += colWidth + GAP_X
  })
  const gradient = style.backgroundColors?.length > 1
  return {
    shareId: 'brand-preview',
    options: {
      name: 'Brand preview',
      containerStyle: {
        backgroundColor: style.background,
        backgroundColorAsGradient: gradient,
        backgroundGradientType: 'radial',
        backgroundGradientColors: gradient ? style.backgroundColors : [],
        backgroundGradientStrategy: 'shades',
      },
    },
    nodes,
  }
}
