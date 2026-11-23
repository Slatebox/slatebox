import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { onePanel, sidePanels } from '../web/app/imports/api/common/side-panels.mjs'

const read = (path) => readFileSync(new URL('../web/app/imports/ui/' + path, import.meta.url), 'utf8')

test('opening one side panel closes the other; closing one opens nothing', () => {
  // Settings opened while Ask Slatebox is open (the panel the owner saw on top of the other).
  assert.deepEqual(onePanel({ ask: true, settings: false }, { ask: true, settings: true }), { ask: false, settings: true })
  // Ask Slatebox opened (header, bar, a note's style bar) while the settings are open.
  assert.deepEqual(onePanel({ ask: false, settings: true }, { ask: true, settings: true }), { ask: true, settings: false })
  // Closing either leaves the other closed.
  assert.deepEqual(onePanel({ ask: true, settings: false }, { ask: false, settings: false }), { ask: false, settings: false })
  assert.deepEqual(onePanel({ ask: false, settings: true }, { ask: false, settings: false }), { ask: false, settings: false })
  // Nothing opened: nothing changes.
  assert.deepEqual(onePanel({ ask: true, settings: false }, { ask: true, settings: false }), { ask: true, settings: false })
})

test('the settings only cover Ask Slatebox: it is kept with what it holds, and back when they close', () => {
  const closed = { ask: false, settings: false }
  // Ask Slatebox open; the settings opened over it: Ask is closed but kept.
  let state = sidePanels({ ask: true, settings: false }, { ask: true, settings: true }, false)
  assert.deepEqual(state, { ask: false, settings: true, kept: true })
  // The canvas applies that; the next pass changes nothing.
  state = sidePanels({ ask: true, settings: true }, { ask: false, settings: true }, state.kept)
  assert.deepEqual(state, { ask: false, settings: true, kept: true })
  // The settings close (×, Escape): Ask Slatebox is back, still kept.
  state = sidePanels({ ask: false, settings: true }, closed, state.kept)
  assert.deepEqual(state, { ask: true, settings: false, kept: true })
  // The person closes Ask Slatebox: it is let go, and nothing comes back.
  state = sidePanels({ ask: true, settings: false }, closed, state.kept)
  assert.deepEqual(state, { ask: false, settings: false, kept: false })
  // The settings opened and closed with Ask Slatebox never open: closing them opens nothing.
  state = sidePanels(closed, { ask: false, settings: true }, false)
  assert.deepEqual(sidePanels({ ask: false, settings: true }, closed, state.kept), { ask: false, settings: false, kept: false })
  // Ask Slatebox opened over the settings that cover it: it shows, the settings close.
  assert.deepEqual(sidePanels({ ask: false, settings: true }, { ask: true, settings: true }, true), { ask: true, settings: false, kept: true })
})

test('the canvas keeps a covered Ask Slatebox mounted, out of sight, and the settings take their room from the canvas', () => {
  const canvas = read('pages/Canvas.jsx')
  assert.match(canvas, /sidePanels\(was, panelsBefore\.current, askKeptNow\.current\)/)
  // Minimised under a carried note on a narrow screen (sheet-drag.mjs), it is out of sight and still mounted too.
  assert.match(canvas, /canShowConversation && \(nativeChatOpen \|\| askKept\) && <div style=\{\{ display: nativeChatOpen && !minimised \? 'contents' : 'none' \}\}>/)
  // Leaving the slate closes Export or Embed with the panels.
  assert.match(canvas, /setSlateDrawerOpen\(false\); setSlateOutput\(null\)/)
  const drawer = read('components/SlateDrawer.jsx')
  // In the page's flow beside (or under) the canvas, as Ask Slatebox is: never a drawer over it.
  assert.doesNotMatch(drawer, /<Drawer|SwipeableDrawer|BackdropProps|position: 'fixed'/)
  assert.match(drawer, /component="aside"/)
})

test('Export and Embed live in the slate menu only: the settings panel holds neither, and nothing is left behind', () => {
  const drawer = read('components/SlateDrawer.jsx')
  assert.doesNotMatch(drawer, /SlateExport|SlateEmbed|'export'|'embed'|sbSlateExportAccordionBtn|getOrientation|onExport/)
  const toolbar = read('components/CanvasToolbar.jsx')
  assert.match(toolbar, /key: 'export', label: 'Export'[^\n]*onOutput\('export'\)/)
  assert.match(toolbar, /key: 'embed', label: 'Embed'[^\n]*onOutput\('embed'\)/)
  assert.doesNotMatch(toolbar, /onSettings\('(export|embed)'\)/)
  const dialog = read('components/slate/SlateOutputDialog.jsx')
  assert.match(dialog, /<SlateExport /)
  assert.match(dialog, /<SlateEmbed /)
})

test('a panel opening or closing gives the engine the canvas\'s new size in the same commit', () => {
  // The canvas is drawn with preserveAspectRatio "slice": until its view box takes the new size, a
  // canvas made taller by the chat closing on a phone crops the board's sides (a station measured
  // at x -178 on test). The engine's ResizeObserver catches up a frame later; the page must not wait.
  const canvas = read('pages/Canvas.jsx')
  const effect = canvas.match(/React\.useLayoutEffect\(\(\) => \{[^\n]*resizePanZoom\?\.\(\)[^\n]*\}, \[([^\]]*)\]\)/)
  assert.ok(effect, 'Canvas syncs the engine view box in a layout effect')
  const deps = effect[1].split(',').map((dep) => dep.trim())
  assert.ok(deps.includes('conversationVisible'), 'when Ask Slatebox opens or closes')
  assert.ok(deps.includes('slateDrawerOpen'), 'when the settings open or close')
})
