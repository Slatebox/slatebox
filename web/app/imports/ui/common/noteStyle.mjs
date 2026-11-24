// The look of a new note on a slate: the organisation's default preset (its first category style,
// category font and size, set on the branding page) or, without one, the default note (white on a
// calm blue, Manrope at the style bar's Medium, 18px). One answer for every way a note is made on
// a fresh slate: the welcome's Add a note, a double-click on the canvas and the tool dock.
// Sizes are pixels, as numbers: the engine wraps and grows a note's words only for a pixel size
// (a "14pt" string is drawn on one line, past the note's edge), and the branding page's preview
// draws a preset's size in pixels too.
import { DEFAULT_NOTE, contrast } from './canvasTheme.mjs'
import { DEFAULT_SWATCHES, DARK_TEXT } from '../../api/common/note-style.mjs'

export const NOTE_FONT = 'Manrope'
// The style bar's M, so a first note's size is one of its chips.
export const NOTE_SIZE = 18 // pixels

/** Black or white, whichever reads better on the colour. */
export function inkFor(background) {
  return contrast('#ffffff', background) >= contrast('#000000', background) ? '#ffffff' : '#000000'
}

/**
 * A new note's colours, font and size (in pixels), from an organisation's default preset value
 * ({ categoryStyles: [{ backgroundColor, foregroundColor }], categoryFont, categoryFontSize }).
 * A preset's font is the name of a typography setting: `fonts` maps names to font families.
 */
export function presetNoteStyle(preset, fonts = {}) {
  const first = preset?.categoryStyles?.[0]
  const backgroundColor = first?.backgroundColor || DEFAULT_NOTE.backgroundColor
  const foregroundColor = first?.foregroundColor
    || (first?.backgroundColor ? inkFor(first.backgroundColor) : DEFAULT_NOTE.foregroundColor)
  const font = preset?.categoryFont
  const size = Number(preset?.categoryFontSize)
  return {
    backgroundColor,
    foregroundColor,
    fontFamily: (font && (fonts[font] || font)) || NOTE_FONT,
    fontSize: size > 0 ? size : NOTE_SIZE,
  }
}

/** The options for the engine's addNode: a rounded note of the style, centred on a point, empty. */
export function noteAt(style, at) {
  const s = style || presetNoteStyle(null)
  // 160 by 68 at the default size; taller for bigger words, and past 36px wider too, so a long word
  // at a heading size (44px "Internationalization") shrinks less to fit. The engine keeps every word
  // whole and shrinks the text to fit the note (autofit), never cutting a word into letters.
  const width = Math.max(160, Math.round(s.fontSize * 4.4))
  const height = Math.max(68, Math.round(s.fontSize * 1.4 + 40))
  return {
    x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2), width, height, text: '',
    shape: 'roundedrectangle', backgroundColor: s.backgroundColor, fontColor: s.foregroundColor,
    fontFamily: s.fontFamily, fontSize: s.fontSize, borderWidth: 0,
  }
}

/** The style in the tool dock's own terms (the classic note options). */
export function dockNoteStyle(style) {
  const s = style || presetNoteStyle(null)
  return {
    backgroundColor: s.backgroundColor,
    foregroundColor: s.foregroundColor,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineColor: '#333',
    lineWidth: 3,
  }
}

/**
 * The sticky note the tool dock's "Sticky Note" makes: the default note's shape and size (a rounded
 * 160 wide note, as tall as noteAt makes it for the slate's font size), in sticky yellow (the palette's
 * Lemon) with dark text, no border and the "Sticky note" effect (the post-it shadow) already on. The
 * same colours whatever the slate's last note was.
 */
export const STICKY_NOTE = Object.freeze({
  backgroundColor: DEFAULT_SWATCHES.find((s) => s.name === 'Lemon').colour,
  foregroundColor: DARK_TEXT,
})

/**
 * The sticky note's own options (the rest, its font and place, come from the caller). `fontSize` is
 * the size the note's words will really have (the dock copies the slate's last note's): the note is as
 * tall as the default note would be for it.
 */
export function stickyNoteLook(style, fontSize) {
  const s = style || presetNoteStyle(null)
  const size = Number(fontSize)
  const { width, height } = noteAt(size > 0 ? { ...s, fontSize: size } : s, { x: 0, y: 0 })
  return {
    width,
    height,
    shape: 'roundedrectangle',
    vectorPath: 'roundedrectangle',
    shapeHint: 'roundedrectangle',
    backgroundColor: STICKY_NOTE.backgroundColor,
    foregroundColor: STICKY_NOTE.foregroundColor,
    // The engine's own name for the text colour (a copied note can carry it, and it wins).
    fontColor: STICKY_NOTE.foregroundColor,
    borderWidth: 0,
    borderOpacity: 0,
    filters: { vect: 'postItNote' },
  }
}
