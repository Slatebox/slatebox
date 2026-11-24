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

test('the sticky is as tall as the default note for the font size it is given (the last note\'s)', () => {
  // The slate's default is 18px (68 tall) but the copied note is 36px: the default note at 36px is 90 tall.
  const style = presetNoteStyle(null)
  assert.equal(noteAt({ ...style, fontSize: 36 }, { x: 0, y: 0 }).height, 90)
  assert.deepEqual([stickyNoteLook(style, 36).width, stickyNoteLook(style, 36).height], [160, 90])
  assert.equal(stickyNoteLook(null, 36).height, 90)
  // A small or missing size never makes it shorter than the default note.
  assert.equal(stickyNoteLook(style, 12).height, 68)
  assert.equal(stickyNoteLook(style, undefined).height, 68)
  assert.equal(stickyNoteLook(style, 'x').height, 68)
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
  // Its height follows the font size it really has (copied from the last note), not the slate's default.
  assert.match(branch, /setDimens\([^)]*\)\s*\n\s*Object\.assign\(nodeOpts, stickyNoteLook\(slate\?\.noteStyle, nodeOpts\.fontSize\)\)/)
  // The shapeHint step must not turn it back into the old "stickyNote" shape.
  assert.match(addNote, /\['comment', 'addText', 'stickyNote'\]\.includes\(shape\.key\)/)
})

test('the dock tile is drawn as the note it makes: a landscape rounded note, filled sticky yellow, with a shadow', async () => {
  const shapes = app('imports/ui/components/node/defaultShapes.js')
  const entry = shapes.slice(shapes.indexOf("key: 'stickyNote'"))
  assert.match(entry, /iconFill: '#fdeea6'/)
  assert.doesNotMatch(entry, /M1 1l18 0\.1/)
  // It fills the 24 box like the other tiles (at least 20 wide and 14 tall) and has a folded corner.
  const path = entry.match(/path: '([^']+)'/)[1]
  const nums = [...path.matchAll(/[MLHVACSQTZmlhvacsqtz]|-?\d*\.?\d+/g)].map((m) => m[0])
  const box = pathBox(nums)
  assert.ok(box.w >= 20 && box.h >= 14, `tile is ${box.w} x ${box.h}`)
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 24 && box.y + box.h <= 24, 'inside the 24 box')
  assert.equal((path.match(/M/g) || []).length, 2, 'the note and its folded corner')
  for (const file of ['imports/ui/components/node/QuickNodeActions.jsx', 'imports/ui/components/stylebar/AddTools.jsx']) {
    const src = app(file)
    assert.match(src, /iconFill/, file)
    assert.match(src, /drop-shadow/, file)
  }
})

// The bounding box of an absolute/relative path made of M, h, v, l, a (arc end points only), H, V, z.
function pathBox(tokens) {
  let x = 0, y = 0, cmd = ''
  const xs = [], ys = []
  const take = () => Number(tokens.shift())
  while (tokens.length) {
    if (/[A-Za-z]/.test(tokens[0])) cmd = tokens.shift()
    if (/[zZ]/.test(cmd)) { cmd = ''; continue }
    switch (cmd) {
      case 'M': case 'L': x = take(); y = take(); break
      case 'm': case 'l': x += take(); y += take(); break
      case 'H': x = take(); break
      case 'h': x += take(); break
      case 'V': y = take(); break
      case 'v': y += take(); break
      case 'a': tokens.splice(0, 5); x += take(); y += take(); break
      case 'A': tokens.splice(0, 5); x = take(); y = take(); break
      default: throw new Error('unexpected ' + cmd)
    }
    xs.push(x); ys.push(y)
  }
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

test('the engine\'s sticky preset (exec/MCP add_nodes preset "sticky") is the same yellow and text colour', (t) => {
  // The engine has no app palette, so it carries the colours itself; this keeps the two from drifting.
  let src
  try {
    src = readFileSync(new URL('../web/app/node_modules/slateboxjs/src/core/NoteDefaults.ts', import.meta.url), 'utf8')
  } catch {
    t.skip('slateboxjs source not linked')
    return
  }
  const sticky = src.slice(src.indexOf('sticky: Object.freeze('))
  assert.match(sticky, new RegExp(`backgroundColor: "${STICKY_NOTE.backgroundColor}"`, 'i'))
  assert.match(sticky, new RegExp(`foregroundColor: "${STICKY_NOTE.foregroundColor}"`, 'i'))
  assert.match(sticky, /shape: "roundedrectangle"/)
  assert.match(sticky, /effect: "postItNote"/)
})
