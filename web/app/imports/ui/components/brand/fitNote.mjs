// A note's size for its words, the way real slates size them: the AI and the welcome make a note as
// wide as its words need (ai.js measures the text first), and the engine then lays the words out in
// it (slateboxjs Node.wrapTextToWidth, fitTextToNode and fitHeightToText). This module copies the
// engine's layout rules so a note sized here is laid out by the engine without a word broken in two
// and without text spilling out, at any font and size:
//   - the engine wraps at the note's width less 14px, between words;
//   - a single word wider than that is cut into pieces (what the brand kit's preview used to show:
//     "Categor / y 1"), so the note must be at least as wide as its longest word plus that margin;
//   - the text is shrunk (never grown) when its box is wider than width - 12 or taller than height - 10;
//   - a line is 1.3 times the font size; a script font's swashes (Caveat) reach past it, so a note
//     gets six tenths of a line more.
// `measure(text)` is the text's width in pixels at the note's font: in the page, a canvas measureText
// with the same font string the engine uses, after the font has loaded.

export const WRAP_MARGIN = 14 // the engine's wrapTextToWidth: textArea().w - 14
export const FIT_MARGIN_X = 12 // fitTextToNode: availW = area.w - 12
export const FIT_MARGIN_Y = 10 // fitTextToNode: availH = area.h - 10
export const LINE_HEIGHT = 1.3 // textLineHeight: SVG.js leading
// Canvas measureText and the SVG text box differ by a pixel or two (kerning, rounding): room for it.
export const SAFETY = 6

/** The engine's canvas font string for a note. */
export function noteFont({ fontSize, fontFamily, fontWeight }) {
  return `${fontWeight === 'bold' ? 'bold ' : ''}${fontSize}px ${fontFamily || 'sans-serif'}`
}

/** The engine's own wrapping, line by line (Node.wrapTextToWidth). */
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
      if (measure(word) > maxWidth) {
        if (line) {
          out.push(line)
          line = ''
        }
        let chunk = ''
        for (const ch of word) {
          if (chunk && measure(chunk + ch) > maxWidth) {
            out.push(chunk)
            chunk = ch
          } else {
            chunk += ch
          }
        }
        line = chunk
        continue
      }
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
 * The width and height for a note holding `text`: as wide as the words want up to `maxWidth`
 * (never narrower than the longest word, so no word is cut), at least `minWidth` by `minHeight`, and
 * as tall as its lines. Returns the lines the engine will draw, too.
 */
export function fitNote({ text, fontSize, measure, minWidth = 120, maxWidth = 320, minHeight = 56 }) {
  const size = Number(fontSize) > 0 ? Number(fontSize) : 14
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  const longest = words.reduce((w, word) => Math.max(w, measure(word)), 0)
  const oneLine = Math.max(0, ...String(text ?? '').split('\n').map((line) => measure(line.trim())))
  // Glyphs whose ink reaches past their advance (a script font's swashes) grow with the size.
  const pad = WRAP_MARGIN + SAFETY + size * 0.04
  let width = Math.min(Math.max(oneLine + pad, minWidth), maxWidth)
  width = Math.ceil(Math.max(width, longest + pad))
  const lines = wrapLines(text, width - WRAP_MARGIN, measure)
  const textHeight = lines.length * size * LINE_HEIGHT
  const height = Math.ceil(Math.max(minHeight, textHeight + FIT_MARGIN_Y + SAFETY + size * 0.6))
  return { width, height, lines }
}

/**
 * The largest size (down to `minSize`) at which `text` fits a box of `width` by `height` without a word
 * cut, for a fixed frame such as the presentation card's title. Lines as fitNote's.
 */
export function fitSize({ text, width, height, maxSize, minSize = 10, measureAt }) {
  for (let size = Math.floor(maxSize); size > minSize; size -= 1) {
    const measure = (s) => measureAt(s, size)
    const words = String(text ?? '').split(/\s+/).filter(Boolean)
    if (words.some((word) => measure(word) > width)) continue
    const lines = wrapLines(text, width, measure)
    if (lines.length * size * LINE_HEIGHT <= height) return { size, lines }
  }
  return { size: minSize, lines: wrapLines(text, width, (s) => measureAt(s, minSize)) }
}
