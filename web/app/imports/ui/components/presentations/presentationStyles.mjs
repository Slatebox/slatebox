// Presentation styles, as data. A style is how a deck looks and moves while it is presented: the
// silhouettes the slate's own notes take (custom SVG paths), the lines, the stage notes it adds
// (titles, stickers, bubbles, braces, ribbons, masked pictures), the captions, the colours, the
// fonts and the camera's motion. Nothing here is saved to the slate: the presenter plays a copy of
// the slate with the style on it. Pure: shared by the presenter and the server.
import * as P from './presentationPaths.mjs'

/** The marker that a build carries this module (checked against shipped bundles). */
export const PRESENTATION_STYLES_MARKER = 'presentationStyles:v4'

const darkText = (hex) => {
  const value = String(hex || '').replace('#', '').split('-')[0]
  if (!/^[0-9a-f]{6}$/i.test(value)) return false
  const n = parseInt(value, 16)
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150
}
const first = (color) => String(color).split('-')[0]
const textOn = (fill, dark = '#0b1030', light = '#ffffff') => (darkText(first(fill)) ? dark : light)

// Starfield, orbit rings: decoration that belongs to the whole canvas (shown on every step).
function stars(box, unit, seed, count = 80, color = '#ffffff') {
  const r = P.rng(seed)
  const out = []
  const pad = unit * 14
  for (let i = 0; i < count; i += 1) {
    const s = unit * (0.05 + r() * 0.14)
    out.push({
      key: `star${i}`, x: box.x - pad * 1.6 + r() * (box.width + pad * 3.2), y: box.y - pad * 0.6 + r() * (box.height + pad * 1.2),
      w: s, h: s, shape: 'circle', backgroundColor: color, opacity: 0.2 + r() * 0.6,
    })
  }
  return out
}

/**
 * The styles. Sizes in a style's kit are in "units": the slate's typical note height, so a style
 * reads the same on a slate of small notes and one of large notes.
 */
export const STYLES = {
  voyage: {
    id: 'voyage',
    name: 'Voyage',
    blurb: 'Prezi-style flights through a starry map',
    bg: '#070b2a',
    palette: ['#ff4d8d', '#ffb627', '#3ddc97', '#4cc9f0', '#9b5de5', '#ff6b35'],
    dim: 0.13,
    fonts: { display: 'Anton', body: 'Space Grotesk' },
    chrome: { ink: '#f4f6ff', accent: '#ffb627', bar: '#ff4d8d', panel: 'transparent', captionFont: 'Space Grotesk', kickerFont: 'Space Grotesk', captionCase: 'none' },
    motion: { arc: 'prezi', rollMax: 12, pace: 1, deep: true, reveal: 'stagger' },
    rhythm: ['dive', 'treeBuild', 'hero', 'sweep', 'trace', 'bigNumber', 'quote'],
    art: 'planet',
    imagePrompt: 'A vivid cosmic illustration',
    masks: ['blob', 'hexagon', 'blob2'],
    skin(role, branch, palette) {
      const c = palette[branch % palette.length]
      if (role === 'root') return { grow: 1.9, vectorPath: P.blob(7, 0.1), backgroundColor: palette[4], image: 'art', fontFamily: 'Anton', fontScale: 0.44, fontColor: '#ffffff', filters: { text: 'dropShadow' } }
      if (role === 'branch') return { vectorPath: P.blob(11 + branch, 0.12), backgroundColor: c, fontFamily: 'Space Grotesk', fontWeight: 'bold', fontScale: 0.38, fontColor: textOn(c) }
      return { vectorPath: P.pill, backgroundColor: '#141c4f', borderColor: c, borderWidth: 3, fontFamily: 'Space Grotesk', fontScale: 0.3, fontColor: '#eef1ff' }
    },
    line: (fromRole, branch, palette) => ({ lineColor: palette[branch % palette.length], lineWidth: fromRole === 'root' ? 7 : 3.5, lineCurviness: 0.45, showChildArrow: false }),
    kit: {
      title: { font: 'Anton', color: '#ffffff', size: 1.9 },
      kicker: { path: P.pill, fill: '#ff4d8d', color: '#ffffff', font: 'Space Grotesk' },
      underline: { path: P.swoosh, fill: '#ffb627' },
      headline: { font: 'Anton', color: '#ffffff' },
      sticker: { path: P.burst(18, 0.8), fill: '#ffb627', color: '#0b1030', font: 'Anton' },
      bubble: { path: P.bubble, fill: '#ffffff', color: '#0b1030', font: 'Anton' },
      brace: { path: P.brace, fill: '#3ddc97', color: '#3ddc97' },
      ribbon: { color: '#3ddc97', width: 9, dash: 'dashed' },
      cta: { path: P.pill, fill: '#ff4d8d', color: '#ffffff', font: 'Anton' },
      number: { font: 'Anton', color: '#ffb627' },
      quote: { path: P.quoteMarks, fill: '#ff4d8d', font: 'Anton', color: '#ffffff', italic: false },
      imageBorder: { color: '#4cc9f0', width: 6 },
      decor(box, unit) {
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        const big = Math.max(box.width, box.height)
        return [
          ...stars(box, unit, 42, 36),
          { key: 'orbit1', x: cx - big * 0.36, y: cy - big * 0.36, w: big * 0.72, h: big * 0.72, vectorPath: P.ring(0.5), backgroundColor: '#ffffff', opacity: 0.2 },
          { key: 'orbit2', x: cx - big * 0.62, y: cy - big * 0.62, w: big * 1.24, h: big * 1.24, vectorPath: P.ring(0.3), backgroundColor: '#ffffff', opacity: 0.1 },
        ]
      },
    },
  },

  stage: {
    id: 'stage',
    name: 'Stage',
    blurb: 'Keynote black, one lime accent, huge type',
    bg: '#000000',
    palette: ['#d7ff3d', '#ffffff', '#9aa0a8', '#d7ff3d', '#ffffff', '#9aa0a8'],
    dim: 0.1,
    fonts: { display: 'Inter', body: 'Inter' },
    chrome: { ink: '#ffffff', accent: '#d7ff3d', bar: '#d7ff3d', panel: 'transparent', captionFont: 'Inter', kickerFont: 'Inter', captionCase: 'none' },
    motion: { arc: 'direct', rollMax: 0, pace: 1.35, deep: false, reveal: 'fade' },
    rhythm: ['bigNumber', 'hero', 'split', 'dive', 'quote', 'group'],
    art: 'spotlight',
    imagePrompt: 'A dramatic spotlit photograph on black',
    masks: ['circle', 'rect'],
    titleBackdrop: true,
    skin(role) {
      if (role === 'root') return { grow: 1.3, shape: 'circle', backgroundColor: '#d7ff3d', borderWidth: 0, fontFamily: 'Inter', fontWeight: 'bold', fontScale: 0.22, fontColor: '#000000' }
      if (role === 'branch') return { backgroundColor: 'transparent', borderWidth: 0, fontFamily: 'Inter', fontWeight: 'bold', fontScale: 0.42, fontColor: '#ffffff' }
      return { backgroundColor: 'transparent', borderWidth: 0, fontFamily: 'Inter', fontScale: 0.32, fontColor: '#9aa0a8' }
    },
    line: (fromRole) => ({ lineColor: fromRole === 'root' ? '#d7ff3d' : '#3a3d44', lineWidth: fromRole === 'root' ? 3 : 1.5, lineCurviness: 0.25, showChildArrow: false }),
    kit: {
      title: { font: 'Inter', weight: 'bold', color: '#ffffff', size: 3.2 },
      kicker: { path: null, fill: 'transparent', color: '#d7ff3d', font: 'Inter' },
      underline: null,
      headline: { font: 'Inter', weight: 'bold', color: '#ffffff' },
      sticker: { path: 'M50,0 A50,50 0 1 1 49.99,0 Z', fill: '#d7ff3d', color: '#000000', font: 'Inter' },
      bubble: { path: P.roundRect, fill: '#d7ff3d', color: '#000000', font: 'Inter' },
      brace: { path: P.brace, fill: '#d7ff3d', color: '#d7ff3d' },
      ribbon: { color: '#d7ff3d', width: 4, dash: 'solid' },
      cta: { path: P.pill, fill: '#d7ff3d', color: '#000000', font: 'Inter' },
      number: { font: 'Inter', weight: 'bold', color: '#d7ff3d' },
      quote: { path: P.quoteMarks, fill: '#d7ff3d', font: 'Inter', color: '#ffffff', italic: false },
      imageBorder: { color: '#d7ff3d', width: 4 },
      decor: () => [],
    },
  },

  editorial: {
    id: 'editorial',
    name: 'Editorial',
    blurb: 'A magazine issue: serif type, torn photos, pull quotes',
    bg: '#f3ede2',
    palette: ['#e4572e', '#1b1b1b', '#2a9d8f', '#e9c46a', '#264653', '#e76f51'],
    dim: 0.18,
    fonts: { display: 'Fraunces', body: 'Inter' },
    chrome: { ink: '#1b1b1b', accent: '#e4572e', bar: '#e4572e', panel: 'rgba(243,237,226,.92)', captionFont: 'Fraunces', kickerFont: 'Inter', captionCase: 'none', italic: true },
    motion: { arc: 'direct', rollMax: 2, pace: 1.2, deep: false, reveal: 'fade' },
    rhythm: ['split', 'quote', 'compare', 'dive', 'group'],
    art: 'halftone',
    imagePrompt: 'An editorial magazine photograph',
    masks: ['torn', 'rect'],
    cover: true,
    skin(role) {
      if (role === 'root') return { grow: 1.4, vectorPath: P.burst(30, 0.9, 2), backgroundColor: '#e4572e', borderWidth: 0, fontFamily: 'Fraunces', fontStyle: 'italic', fontScale: 0.25, fontColor: '#ffffff' }
      if (role === 'branch') return { vectorPath: P.tab, backgroundColor: '#1b1b1b', fontFamily: 'Fraunces', fontScale: 0.4, fontColor: '#f3ede2' }
      return { backgroundColor: '#fffdf8', borderColor: '#1b1b1b', borderWidth: 1.5, fontFamily: 'Inter', fontScale: 0.28, fontColor: '#1b1b1b' }
    },
    line: () => ({ lineColor: '#1b1b1b', lineWidth: 1.6, lineDash: 'dotted', lineCurviness: 0.3, showChildArrow: false }),
    kit: {
      title: { font: 'Fraunces', color: '#1b1b1b', size: 2.6 },
      kicker: { path: null, fill: 'transparent', color: '#e4572e', font: 'Inter' },
      underline: { path: 'M0,0 H100 V6 H0 Z', fill: '#1b1b1b' },
      headline: { font: 'Fraunces', color: '#1b1b1b' },
      sticker: { path: P.burst(30, 0.9, 2), fill: '#e4572e', color: '#ffffff', font: 'Fraunces' },
      bubble: { path: P.bubble, fill: '#fffdf8', color: '#1b1b1b', font: 'Fraunces', border: '#1b1b1b' },
      brace: { path: P.brace, fill: '#e4572e', color: '#e4572e' },
      ribbon: { color: '#e4572e', width: 3, dash: 'dotted' },
      cta: { path: P.tab, fill: '#e4572e', color: '#ffffff', font: 'Fraunces' },
      number: { font: 'Fraunces', color: '#e4572e' },
      quote: { path: P.quoteMarks, fill: '#e4572e', font: 'Fraunces', color: '#1b1b1b', italic: true },
      imageBorder: { color: '#1b1b1b', width: 0 },
      decor: () => [],
    },
  },

  neon: {
    id: 'neon',
    name: 'Neon',
    blurb: 'Kinetic gradients, chevrons and bolts',
    bg: '#0b0016',
    palette: ['#ff2e93-#ff9e2c', '#00f0ff-#7a5cff', '#b6ff00-#00d27a', '#ff2e93-#7a5cff', '#ff9e2c-#ffe600', '#00f0ff-#b6ff00'],
    dim: 0.12,
    fonts: { display: 'Anton', body: 'Space Grotesk' },
    chrome: { ink: '#ffffff', accent: '#00f0ff', bar: '#ff2e93', panel: 'transparent', captionFont: 'Anton', kickerFont: 'Space Grotesk', captionCase: 'uppercase' },
    motion: { arc: 'prezi', rollMax: 6, pace: 0.8, deep: true, reveal: 'pop' },
    rhythm: ['sweep', 'hero', 'bigNumber', 'dive', 'trace'],
    art: 'sunburst',
    imagePrompt: 'A neon, high-energy illustration',
    masks: ['hexagon', 'slant'],
    skin(role, branch, palette) {
      const c = palette[branch % palette.length]
      if (role === 'root') return { grow: 2, vectorPath: P.burst(14, 0.74, 8), backgroundColor: '#ffe600', fontFamily: 'Anton', fontScale: 0.36, fontColor: '#0b0016', rotate: -8 }
      if (role === 'branch') return { vectorPath: P.chevron, backgroundColor: c, fontFamily: 'Anton', fontScale: 0.44, fontColor: '#0b0016', rotate: branch % 2 ? 3 : -3 }
      return { vectorPath: P.slant, backgroundColor: '#1a0833', borderColor: '#00f0ff', borderWidth: 2.5, fontFamily: 'Space Grotesk', fontWeight: 'bold', fontScale: 0.3, fontColor: '#ffffff' }
    },
    line: (fromRole) => ({ lineColor: fromRole === 'root' ? '#ff2e93' : '#7a5cff', lineWidth: fromRole === 'root' ? 6 : 3, lineType: 'straight', showChildArrow: false }),
    kit: {
      title: { font: 'Anton', color: '#ffffff', size: 3.4, rotate: -4 },
      kicker: { path: P.chevron, fill: '#00f0ff-#7a5cff', color: '#0b0016', font: 'Anton' },
      underline: { path: P.bolt, fill: '#ffe600', bolt: true },
      headline: { font: 'Anton', color: '#ffffff' },
      sticker: { path: P.burst(12, 0.72, 3), fill: '#ff2e93', color: '#ffffff', font: 'Anton' },
      bubble: { path: P.chevron, fill: '#ff2e93-#ff9e2c', color: '#0b0016', font: 'Anton' },
      brace: { path: P.bolt, fill: '#ffe600', color: '#ffe600' },
      ribbon: { color: '#00f0ff', width: 6, dash: 'solid' },
      cta: { path: P.chevron, fill: '#ff2e93-#ff9e2c', color: '#0b0016', font: 'Anton' },
      number: { font: 'Anton', color: '#00f0ff' },
      quote: { path: P.quoteMarks, fill: '#ff2e93', font: 'Anton', color: '#ffffff', italic: false },
      imageBorder: { color: '#00f0ff', width: 5 },
      decor: (box, unit) => stars(box, unit, 7, 28, '#00f0ff'),
    },
  },

  sketch: {
    id: 'sketch',
    name: 'Sketchbook',
    blurb: 'Hand-drawn notes, highlighter and polaroids',
    bg: '#fbf7ee',
    palette: ['#ffd6e0', '#fff1a8', '#c8f7c5', '#cfe8ff', '#e4d4ff', '#ffd8b5'],
    dim: 0.22,
    fonts: { display: 'Caveat', body: 'Caveat' },
    chrome: { ink: '#222222', accent: '#e4572e', bar: '#222222', panel: 'rgba(251,247,238,.92)', captionFont: 'Caveat', kickerFont: 'Caveat', captionCase: 'none', big: true },
    motion: { arc: 'prezi', rollMax: 5, pace: 1, deep: false, reveal: 'pop' },
    rhythm: ['treeBuild', 'sweep', 'hero', 'trace', 'group'],
    art: 'confetti',
    imagePrompt: 'A cheerful hand-drawn marker sketch',
    masks: ['wobbly', 'rect'],
    polaroid: true,
    skin(role, branch, palette, id = '') {
      if (role === 'root') return { grow: 1.6, vectorPath: P.wobblyCircle(3), backgroundColor: '#ffd84d', borderColor: '#222222', borderWidth: 3, fontFamily: 'Caveat', fontWeight: 'bold', fontScale: 0.42, fontColor: '#222222' }
      if (role === 'branch') return { vectorPath: P.wobblyRect(10 + branch), backgroundColor: palette[branch % palette.length], borderColor: '#222222', borderWidth: 2.5, fontFamily: 'Caveat', fontWeight: 'bold', fontScale: 0.56, fontColor: '#222222' }
      return { vectorPath: P.wobblyRect(30 + branch * 2 + id.length), backgroundColor: '#ffffff', borderColor: '#222222', borderWidth: 2, fontFamily: 'Caveat', fontScale: 0.48, fontColor: '#222222' }
    },
    line: () => ({ lineColor: '#222222', lineWidth: 2.5, lineCurviness: 0.5, lineEffect: 'pencil', showChildArrow: true }),
    kit: {
      title: { font: 'Caveat', weight: 'bold', color: '#222222', size: 3, rotate: -2 },
      kicker: { path: null, fill: 'transparent', color: '#e4572e', font: 'Caveat' },
      underline: { path: P.highlight, fill: '#ffe66d', behind: true },
      headline: { font: 'Caveat', weight: 'bold', color: '#222222' },
      sticker: { path: P.burst(5, 0.45, 1), fill: '#ffd84d', color: '#222222', font: 'Caveat', border: '#222222' },
      bubble: { path: P.bubble, fill: '#ffffff', color: '#222222', font: 'Caveat', border: '#222222' },
      brace: { path: P.brace, fill: '#e4572e', color: '#e4572e' },
      ribbon: { color: '#e4572e', width: 5, dash: 'solid' },
      cta: { path: P.wobblyRect(77), fill: '#ffd84d', color: '#222222', font: 'Caveat', border: '#222222' },
      number: { font: 'Caveat', weight: 'bold', color: '#e4572e' },
      quote: { path: P.quoteMarks, fill: '#e4572e', font: 'Caveat', color: '#222222', italic: false },
      imageBorder: { color: '#ffffff', width: 0 },
      decor: () => [],
    },
  },

  blueprint: {
    id: 'blueprint',
    name: 'Blueprint',
    blurb: 'Line art on a blue grid, numbered steps',
    bg: '#0b3b8c',
    palette: ['#ffffff', '#7fd3ff', '#ffd166', '#ffffff', '#7fd3ff', '#ffd166'],
    dim: 0.2,
    fonts: { display: 'Space Grotesk', body: 'IBM Plex Mono' },
    chrome: { ink: '#ffffff', accent: '#ffd166', bar: '#7fd3ff', panel: 'transparent', captionFont: 'IBM Plex Mono', kickerFont: 'IBM Plex Mono', captionCase: 'none' },
    motion: { arc: 'direct', rollMax: 0, pace: 0.9, deep: true, reveal: 'stagger' },
    rhythm: ['trace', 'treeBuild', 'dive', 'split', 'bigNumber'],
    art: 'grid',
    imagePrompt: 'A technical blueprint line drawing',
    masks: ['rect', 'hexagon'],
    skin(role) {
      if (role === 'root') return { grow: 1.3, vectorPath: P.chevron, backgroundColor: 'transparent', borderColor: '#ffd166', borderWidth: 3, fontFamily: 'Space Grotesk', fontWeight: 'bold', fontScale: 0.3, fontColor: '#ffd166' }
      if (role === 'branch') return { backgroundColor: 'transparent', borderColor: '#ffffff', borderWidth: 2.5, fontFamily: 'Space Grotesk', fontWeight: 'bold', fontScale: 0.36, fontColor: '#ffffff' }
      return { backgroundColor: 'transparent', borderColor: '#7fd3ff', borderWidth: 1.5, borderStyle: 'dashed', fontFamily: 'IBM Plex Mono', fontScale: 0.28, fontColor: '#d8f1ff' }
    },
    line: () => ({ lineColor: '#7fd3ff', lineWidth: 2, lineType: 'straight', showChildArrow: true }),
    kit: {
      title: { font: 'Space Grotesk', weight: 'bold', color: '#ffffff', size: 2.2 },
      kicker: { path: P.dimension, fill: '#ffd166', color: '#ffd166', font: 'IBM Plex Mono' },
      underline: { path: P.dimension, fill: '#7fd3ff' },
      headline: { font: 'Space Grotesk', weight: 'bold', color: '#ffffff' },
      sticker: { path: P.hexagon, fill: '#ffd166', color: '#0b3b8c', font: 'Space Grotesk' },
      bubble: { path: P.roundRect, fill: '#ffffff', color: '#0b3b8c', font: 'Space Grotesk' },
      brace: { path: P.brace, fill: '#ffd166', color: '#ffd166' },
      ribbon: { color: '#ffd166', width: 4, dash: 'dashed' },
      cta: { path: P.chevron, fill: '#ffd166', color: '#0b3b8c', font: 'Space Grotesk' },
      number: { font: 'Space Grotesk', weight: 'bold', color: '#ffd166' },
      quote: { path: P.quoteMarks, fill: '#7fd3ff', font: 'Space Grotesk', color: '#ffffff', italic: false },
      imageBorder: { color: '#ffffff', width: 3 },
      decor(box, unit) {
        const out = []
        const step = unit * 4
        for (let x = Math.floor((box.x - unit * 20) / step) * step, i = 0; x < box.x + box.width + unit * 20; x += step, i += 1) {
          out.push({ key: `gx${i}`, x, y: box.y - unit * 8, w: unit * 0.06, h: box.height + unit * 16, backgroundColor: '#ffffff', opacity: i % 4 ? 0.08 : 0.18 })
        }
        return out.filter((_, i) => i % 2 === 0).slice(0, 30)
      },
    },
  },

  journey: {
    id: 'journey',
    name: 'Journey',
    blurb: 'A road map: pins, flags and a path through every step',
    bg: '#f2e8d5',
    palette: ['#2a9d8f', '#e76f51', '#e9c46a', '#264653', '#f4a261', '#8ab17d'],
    dim: 0.2,
    fonts: { display: 'Abril Fatface', body: 'PT Sans' },
    chrome: { ink: '#264653', accent: '#e76f51', bar: '#2a9d8f', panel: 'rgba(242,232,213,.92)', captionFont: 'PT Sans', kickerFont: 'PT Sans', captionCase: 'none' },
    motion: { arc: 'prezi', rollMax: 4, pace: 1.1, deep: false, reveal: 'stagger' },
    rhythm: ['trace', 'dive', 'hero', 'split', 'group'],
    art: 'terrain',
    masks: ['pin', 'rect'],
    route: true,
    imagePrompt: 'A vintage travel-poster illustration',
    skin(role, branch, palette) {
      const c = palette[branch % palette.length]
      if (role === 'root') return { grow: 1.5, vectorPath: P.pin, backgroundColor: '#e76f51', fontFamily: 'Abril Fatface', fontScale: 0.26, fontColor: '#ffffff', textOffset: { y: -10 } }
      if (role === 'branch') return { vectorPath: P.flag, backgroundColor: c, fontFamily: 'Abril Fatface', fontScale: 0.36, fontColor: textOn(c, '#264653') }
      return { vectorPath: P.ticket, backgroundColor: '#fffaf0', borderColor: c, borderWidth: 2, fontFamily: 'PT Sans', fontScale: 0.3, fontColor: '#264653' }
    },
    line: (fromRole, branch, palette) => ({ lineColor: palette[branch % palette.length], lineWidth: 4, lineDash: 'dashed', lineCurviness: 0.6, showChildArrow: false }),
    kit: {
      title: { font: 'Abril Fatface', color: '#264653', size: 2.4 },
      kicker: { path: P.flag, fill: '#e76f51', color: '#ffffff', font: 'PT Sans' },
      underline: { path: P.swoosh, fill: '#2a9d8f' },
      headline: { font: 'Abril Fatface', color: '#264653' },
      sticker: { path: P.pin, fill: '#e76f51', color: '#ffffff', font: 'Abril Fatface' },
      bubble: { path: P.bubble, fill: '#ffffff', color: '#264653', font: 'Abril Fatface', border: '#264653' },
      brace: { path: P.brace, fill: '#2a9d8f', color: '#2a9d8f' },
      ribbon: { color: '#e76f51', width: 7, dash: 'dashed' },
      cta: { path: P.flag, fill: '#2a9d8f', color: '#ffffff', font: 'Abril Fatface' },
      number: { font: 'Abril Fatface', color: '#e76f51' },
      quote: { path: P.quoteMarks, fill: '#2a9d8f', font: 'Abril Fatface', color: '#264653', italic: false },
      imageBorder: { color: '#ffffff', width: 5 },
      decor: () => [],
    },
  },

  calm: {
    id: 'calm',
    name: 'Calm',
    blurb: 'High contrast and still: cuts, no flights',
    bg: '#f5f5f4',
    palette: ['#1c1917', '#57534e', '#0f766e', '#1c1917', '#57534e', '#0f766e'],
    dim: 0.25,
    fonts: { display: 'Inter', body: 'Inter' },
    chrome: { ink: '#1c1917', accent: '#0f766e', bar: '#1c1917', panel: 'rgba(245,245,244,.95)', captionFont: 'Inter', kickerFont: 'Inter', captionCase: 'none' },
    motion: { arc: 'cut', rollMax: 0, pace: 1.2, deep: false, reveal: 'none' },
    rhythm: ['group', 'split', 'dive', 'quote'],
    art: 'gradient',
    imagePrompt: 'A calm, minimal photograph',
    masks: ['rect'],
    skin(role) {
      if (role === 'root') return { grow: 1.2, vectorPath: P.pill, backgroundColor: '#1c1917', fontFamily: 'Inter', fontWeight: 'bold', fontScale: 0.3, fontColor: '#ffffff' }
      if (role === 'branch') return { vectorPath: P.roundRect, backgroundColor: '#ffffff', borderColor: '#1c1917', borderWidth: 2, fontFamily: 'Inter', fontWeight: 'bold', fontScale: 0.34, fontColor: '#1c1917' }
      return { vectorPath: P.roundRect, backgroundColor: '#ffffff', borderColor: '#a8a29e', borderWidth: 1, fontFamily: 'Inter', fontScale: 0.28, fontColor: '#1c1917' }
    },
    line: () => ({ lineColor: '#78716c', lineWidth: 2, lineCurviness: 0.3, showChildArrow: false }),
    kit: {
      title: { font: 'Inter', weight: 'bold', color: '#1c1917', size: 2.2 },
      kicker: { path: null, fill: 'transparent', color: '#0f766e', font: 'Inter' },
      underline: { path: 'M0,0 H100 V8 H0 Z', fill: '#0f766e' },
      headline: { font: 'Inter', weight: 'bold', color: '#1c1917' },
      sticker: { path: P.pill, fill: '#0f766e', color: '#ffffff', font: 'Inter' },
      bubble: { path: P.roundRect, fill: '#ffffff', color: '#1c1917', font: 'Inter', border: '#1c1917' },
      brace: { path: P.brace, fill: '#0f766e', color: '#0f766e' },
      ribbon: { color: '#0f766e', width: 3, dash: 'solid' },
      cta: { path: P.pill, fill: '#1c1917', color: '#ffffff', font: 'Inter' },
      number: { font: 'Inter', weight: 'bold', color: '#0f766e' },
      quote: { path: P.quoteMarks, fill: '#0f766e', font: 'Inter', color: '#1c1917', italic: false },
      imageBorder: { color: '#1c1917', width: 0 },
      decor: () => [],
    },
  },
}

export const STYLE_IDS = Object.keys(STYLES)
export const DEFAULT_STYLE = 'voyage'

/** The chips of the one-click switcher: a swatch drawn from each style's own shapes. */
export const STYLE_CHIPS = STYLE_IDS.map((id) => {
  const style = STYLES[id]
  const shape = { voyage: P.blob(7, 0.1), stage: 'M50,0 A50,50 0 1 1 49.99,0 Z', editorial: P.quoteMarks, neon: P.bolt, sketch: P.wobblyCircle(3), blueprint: P.chevron, journey: P.pin, calm: P.pill }[id]
  return { id, name: style.name, blurb: style.blurb, bg: style.bg, fg: first(style.palette[0]), fg2: style.chrome.accent, path: shape }
})

const HEX = /^#[0-9a-f]{6}$/i
const cleanColor = (value) => (typeof value === 'string' && HEX.test(value.trim()) ? value.trim() : null)

/**
 * A style with what the AI or the chat changed (palette, background, fonts): an unknown id is the
 * default style, and only colours and font names that are safe are kept.
 */
export function resolveStyle(styleRef) {
  const id = typeof styleRef === 'string' ? styleRef : styleRef?.id
  const base = STYLES[id] || STYLES[DEFAULT_STYLE]
  const overrides = typeof styleRef === 'object' && styleRef ? styleRef.overrides || {} : {}
  const palette = Array.isArray(overrides.palette) ? overrides.palette.map(cleanColor).filter(Boolean).slice(0, 6) : []
  const bg = cleanColor(overrides.bg)
  const font = (value) => (typeof value === 'string' && /^[A-Za-z0-9 ]{2,40}$/.test(value.trim()) ? value.trim() : null)
  const display = font(overrides.fonts?.display)
  if (!palette.length && !bg && !display) return base
  return {
    ...base,
    palette: palette.length >= 3 ? [...palette, ...base.palette].slice(0, 6) : base.palette,
    bg: bg || base.bg,
    fonts: { ...base.fonts, ...(display ? { display } : {}) },
    kit: { ...base.kit, ...(display ? { title: { ...base.kit.title, font: display }, headline: { ...base.kit.headline, font: display } } : {}) },
  }
}

/** The style's own ref, cleaned for saving: { id, overrides? }. */
export function cleanStyleRef(styleRef) {
  const id = typeof styleRef === 'string' ? styleRef : styleRef?.id
  if (!STYLES[id]) return { id: DEFAULT_STYLE }
  const overrides = typeof styleRef === 'object' && styleRef?.overrides ? styleRef.overrides : null
  if (!overrides) return { id }
  const out = {}
  const palette = Array.isArray(overrides.palette) ? overrides.palette.map(cleanColor).filter(Boolean).slice(0, 6) : []
  if (palette.length >= 3) out.palette = palette
  if (cleanColor(overrides.bg)) out.bg = cleanColor(overrides.bg)
  const display = typeof overrides.fonts?.display === 'string' && /^[A-Za-z0-9 ]{2,40}$/.test(overrides.fonts.display.trim()) ? overrides.fonts.display.trim() : null
  if (display) out.fonts = { display }
  return Object.keys(out).length ? { id, overrides: out } : { id }
}

export { darkText, textOn }
