// The presentation preview's title card is a plain box, not a note, so the engine does not lay it out:
// its title is set at the largest size at which every word is whole and the lines fit the card.
// (Notes in the sample slate are laid out by the engine itself: BrandPreviewSlate.jsx.)

export const LINE_HEIGHT = 1.3 // as the engine's notes: SVG.js leading

/** Words in lines no wider than `maxWidth`, wrapping between words only. */
export function wrapLines(text, maxWidth, measure) {
  const out = []
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (line && measure(test) > maxWidth) {
        out.push(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) out.push(line)
  }
  return out
}

/**
 * The largest size (down to `minSize`) at which `text` fits a box of `width` by `height` with every
 * word whole. `measureAt(text, size)` is the text's width in pixels at that size.
 */
export function fitSize({ text, width, height, maxSize, minSize = 10, measureAt }) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  for (let size = Math.floor(maxSize); size > minSize; size -= 1) {
    const measure = (s) => measureAt(s, size)
    if (words.some((word) => measure(word) > width)) continue
    const lines = wrapLines(text, width, measure)
    if (lines.length * size * LINE_HEIGHT <= height) return { size, lines }
  }
  return { size: minSize, lines: wrapLines(text, width, (s) => measureAt(s, minSize)) }
}
