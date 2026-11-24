// Text measuring in the page, as the engine measures it (a canvas, the note's own font string), once
// the font has loaded: measured before, a font's words take the fallback font's width and the note
// comes out the wrong size.
import { fitNote, noteFont } from './fitNote.mjs'

let canvas = null
const context = () => {
  if (!canvas) canvas = document.createElement('canvas')
  return canvas.getContext('2d')
}

/** A measure(text) for one font, in pixels. */
export function measurer({ fontSize, fontFamily, fontWeight }) {
  const ctx = context()
  const font = noteFont({ fontSize, fontFamily, fontWeight })
  return (text) => {
    if (!ctx) return String(text).length * fontSize * 0.6
    ctx.font = font
    return ctx.measureText(String(text)).width
  }
}

/** Wait (briefly) for the families to load, so measuring uses them. */
export async function fontsReady(families = []) {
  if (typeof document === 'undefined' || !document.fonts?.load) return
  const quoted = [...new Set(families.filter(Boolean))].map((f) => `16px "${String(f).replace(/"/g, '')}"`)
  const timeout = new Promise((resolve) => { setTimeout(resolve, 1500) })
  await Promise.race([Promise.all(quoted.map((f) => document.fonts.load(f).catch(() => null))), timeout])
}

/** fitNote with the page's measure for the note's font. */
export function fitInPage({ text, fontSize, fontFamily, fontWeight, ...limits }) {
  return fitNote({ text, fontSize, measure: measurer({ fontSize, fontFamily, fontWeight }), ...limits })
}
