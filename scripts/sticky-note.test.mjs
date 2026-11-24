// The tool dock's Sticky Note (owner, 2026-11-24): "the post it note svg object should be the shape of the default
// note that is added - not these square svgs ... no border, ... a yellow sticky note color, and then also use the
// sticky note drop shadow effect right away". The look is one function (noteStyle.mjs stickyNoteLook) used by the
// dock's addNote; the dock tile is drawn as that note.
//   node --test scripts/sticky-note.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { STICKY_NOTE, stickyNoteLook, noteAt, presetNoteStyle } from '../web/app/imports/ui/common/noteStyle.mjs'
import { DEFAULT_SWATCHES, DARK_TEXT } from '../web/app/imports/api/common/note-style.mjs'
import { contrast } from '../web/app/imports/ui/common/canvasTheme.mjs'

const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')

test('a sticky note is the default note: rounded, 160 wide, as tall as noteAt makes it', () => {
  for (const style of [null, presetNoteStyle(null), { ...presetNoteStyle(null), fontSize: 40 }]) {
    const look = stickyNoteLook(style)
    const plain = noteAt(style, { x: 0, y: 0 })
    assert.equal(look.shape, 'roundedrectangle')
    assert.equal(look.vectorPath, 'roundedrectangle')
    assert.equal(look.shapeHint, 'roundedrectangle')
    assert.equal(plain.shape, look.shape)
    assert.deepEqual([look.width, look.height], [plain.width, plain.height])
  }
  assert.deepEqual([stickyNoteLook(null).width, stickyNoteLook(null).height], [160, 68])
})

test('sticky yellow (the palette Lemon) with dark text that reads at AA and AAA', () => {
  const lemon = DEFAULT_SWATCHES.find((s) => s.name === 'Lemon').colour
  assert.equal(STICKY_NOTE.backgroundColor, lemon)
  assert.equal(lemon, '#fdeea6')
  const look = stickyNoteLook(null)
  assert.equal(look.backgroundColor, lemon)
  assert.equal(look.foregroundColor, DARK_TEXT)
  assert.equal(look.fontColor, DARK_TEXT)
  assert.ok(contrast(DARK_TEXT, lemon) >= 7, `text contrast ${contrast(DARK_TEXT, lemon)}`)
})

test('no border, and the "Sticky note" effect (postItNote) already on', () => {
  const look = stickyNoteLook(null)
  assert.equal(look.borderWidth, 0)
  assert.equal(look.borderOpacity, 0)
  assert.deepEqual(look.filters, { vect: 'postItNote' })
})

test('the dock makes the sticky from that look, whatever the last note was, and keeps its rounded shape', () => {
  const addNote = app('imports/ui/components/node/addNote.js')
  const branch = addNote.slice(addNote.indexOf("shape.key === 'stickyNote'"), addNote.indexOf('} else {', addNote.indexOf("shape.key === 'stickyNote'")))
  // Applied after setDimens (which copies the last note), so the last note's colour, border or square path never win.
  assert.match(branch, /setDimens\([^)]*\)\s*\n\s*Object\.assign\(nodeOpts, stickyNoteLook\(slate\?\.noteStyle\)\)/)
  // The shapeHint step must not turn it back into the old "stickyNote" shape.
  assert.match(addNote, /\['comment', 'addText', 'stickyNote'\]\.includes\(shape\.key\)/)
})

test('the dock tile is drawn as the note it makes: a landscape rounded note, filled sticky yellow, with a shadow', async () => {
  const shapes = app('imports/ui/components/node/defaultShapes.js')
  const entry = shapes.slice(shapes.indexOf("key: 'stickyNote'"))
  assert.match(entry, /iconFill: '#fdeea6'/)
  assert.doesNotMatch(entry, /M1 1l18 0\.1/)
  for (const file of ['imports/ui/components/node/QuickNodeActions.jsx', 'imports/ui/components/stylebar/AddTools.jsx']) {
    const src = app(file)
    assert.match(src, /iconFill/, file)
    assert.match(src, /drop-shadow/, file)
  }
})
