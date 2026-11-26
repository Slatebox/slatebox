// A QR code in the terminal, for a link that has to be opened on another device (a phone, or the
// laptop the person is sitting at while this runs over SSH). No dependencies beyond the vendored
// encoder (src/vendor/qrcode.mjs).
//
// Looks, chosen by what the terminal can show:
//   - color, full cells (unicode: false, color: true): a module is two spaces on a black or white
//     background, one row a module. Only backgrounds are drawn, and a terminal paints a cell's
//     background over its whole height, line spacing included, so it scans in every terminal; it
//     is twice as tall as the half-block look, so the wizard uses it when the terminal has the rows.
//   - color, half blocks (unicode and color): two modules to a cell, every cell an upper half
//     block "▀" in the top module's color on the bottom module's color (black or white), so the
//     code is about half as tall as wide in cells (square on screen) and scans the same on light
//     and dark terminals. Where the terminal adds line spacing below the glyph, the gap takes the
//     bottom module's color, so no false light line crosses the code. A terminal that adds
//     spacing above the glyph (or splits it) still shows thin gaps there; terminals that draw
//     block elements themselves (iTerm2, kitty, WezTerm, Alacritty, Windows Terminal, xterm.js
//     with its custom glyphs) fill the cell and show none.
//   - unicode, no color: half blocks in the terminal's own colors, light modules drawn as the
//     glyph and dark modules left as the background. A dark terminal shows the code the right way
//     round (light glyphs, dark background); a light terminal shows it inverted, which scanners
//     that do not read inverted codes cannot read. Any line spacing shows the background between
//     rows. Use color where there is any.
//   - ascii (no Unicode, no color): two cells a module, one row a module: "##" dark, two spaces
//     light (the right way round on a light terminal, inverted on a dark one).
import { encode } from '../vendor/qrcode.mjs'

const QUIET = 2

/**
 * The code's lines for text.
 * @param {string} text
 * @param {{unicode?: boolean, color?: boolean}} [options]
 * @returns {string[]}
 */
export function qrLines(text, { unicode = true, color = false } = {}) {
  const { data, size } = encode(String(text), { ecc: 'L', border: QUIET })
  const dark = (x, y) => y < size && x < size && data[y][x] === true
  const lines = []
  if (!unicode) {
    for (let y = 0; y < size; y++) {
      let row = ''
      // With color, a module is two spaces on a black or white background.
      for (let x = 0; x < size; x++) row += color ? (dark(x, y) ? '\x1b[40m  ' : '\x1b[47m  ') : dark(x, y) ? '##' : '  '
      lines.push(color ? `${row}\x1b[0m` : row)
    }
    return lines
  }
  for (let y = 0; y < size; y += 2) {
    let row = ''
    let last = ''
    for (let x = 0; x < size; x++) {
      const top = dark(x, y)
      const bottom = dark(x, y + 1)
      if (color) {
        // The top module is the glyph's color, the bottom one the background; a code only when it changes.
        const sgr = `\x1b[${top ? 30 : 37};${bottom ? 40 : 47}m`
        row += `${sgr === last ? '' : sgr}▀`
        last = sgr
      } else row += !top && !bottom ? '█' : !top ? '▀' : !bottom ? '▄' : ' '
    }
    lines.push(color ? `${row}\x1b[0m` : row)
  }
  return lines
}

/** How many rows qrLines draws for text in the full-cell look (one a module, quiet zone included). */
export const qrSize = text => encode(String(text), { ecc: 'L', border: QUIET }).size
