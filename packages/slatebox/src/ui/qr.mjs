// A QR code in the terminal, for a link that has to be opened on another device (a phone, or the
// laptop the person is sitting at while this runs over SSH). No dependencies beyond the vendored
// encoder (src/vendor/qrcode.mjs).
//
// Three looks, chosen by what the terminal can show:
//   - color: half blocks (two modules to a cell, so the code is about half as tall as wide in
//     cells, which is square on screen), black on an explicit white background, so it scans the
//     same on light and dark terminals.
//   - unicode, no color: half blocks in the terminal's own colors, light modules drawn (scanners
//     read the inverted code a dark terminal shows; a light terminal shows it the right way round).
//   - ascii (no Unicode): two cells a module, one row a module: "##" and two spaces, or with
//     color, two spaces on black or white.
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
    for (let x = 0; x < size; x++) {
      const top = dark(x, y)
      const bottom = dark(x, y + 1)
      if (color) row += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
      else row += !top && !bottom ? '█' : !top ? '▀' : !bottom ? '▄' : ' '
    }
    lines.push(color ? `\x1b[30;47m${row}\x1b[0m` : row)
  }
  return lines
}
