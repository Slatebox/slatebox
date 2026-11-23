// The share card's words as paths. The PNG renderer (librsvg, in a child process) has none of
// the styles' web fonts and fetches nothing, so a card's title would fall back to a system serif.
// Each line is drawn here with opentype.js in a bundled font of the same kind (a condensed black
// for Anton, a serif for Fraunces, the hand of Caveat itself), as a <path> any renderer draws.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import opentype from 'opentype.js'

// The style's font → a bundled @fontsource face of the same kind: [package, weight].
const FACES = {
  Anton: ['roboto-condensed', 900],
  Inter: ['roboto', 900],
  'Space Grotesk': ['ibm-plex-sans', 700],
  'IBM Plex Mono': ['ibm-plex-mono', 700],
  Fraunces: ['pt-serif', 700],
  'Abril Fatface': ['abril-fatface', 400],
  Caveat: ['caveat', 700],
  'PT Sans': ['pt-sans', 700],
}
const FALLBACK = ['roboto', 700]

// The node_modules that holds @fontsource: the Meteor server bundle's npm folder, or (outside
// Meteor, in the unit tests) the nearest one above this process's working directory.
function fontHome() {
  const serverDir = globalThis.__meteor_bootstrap__?.serverDir
  const candidates = []
  if (serverDir) candidates.push(join(serverDir, 'npm'))
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    candidates.push(dir, join(dir, 'web', 'app'))
    if (dirname(dir) === dir) break
  }
  return candidates.find((dir) => existsSync(join(dir, 'node_modules', '@fontsource', 'roboto', 'package.json'))) || null
}

const cache = new Map()
function face(family, weight) {
  const [pkg, w] = FACES[family] || FALLBACK
  const bold = weight === 'bold' || Number(weight) >= 600
  const want = FACES[family] ? w : bold ? 700 : 400
  const key = `${pkg}-${want}`
  if (cache.has(key)) return cache.get(key)
  let font = null
  try {
    const home = fontHome()
    const file = home && join(home, 'node_modules', '@fontsource', pkg, 'files', `${pkg}-latin-${want}-normal.woff`)
    if (file && existsSync(file)) {
      const bytes = readFileSync(file)
      font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    }
  } catch (error) {
    console.warn('A share card font could not be read:', error.message)
  }
  cache.set(key, font)
  return font
}

const esc = (text) => String(text || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** One line of the card as a path (or, with no font to draw it, as text). */
export function ogCardText({ text, x, y, size, family, weight = 'normal', fill, opacity = 1 }) {
  const font = face(family, weight)
  if (!font) return `<text x="${x}" y="${y}" font-family="${esc(family)}, sans-serif" font-weight="${weight}" font-size="${size}" fill="${esc(fill)}" opacity="${opacity}">${esc(text)}</text>`
  const d = font.getPath(String(text), x, y, size).toPathData(2)
  return `<path d="${d}" fill="${esc(fill)}" opacity="${opacity}"/>`
}

/** How wide a line is drawn (0 with no font: the card keeps its own size). */
export function ogCardMeasure({ text, size, family, weight = 'normal' }) {
  const font = face(family, weight)
  return font ? font.getAdvanceWidth(String(text), size) : 0
}
