// One renderer for a board on every surface (owner, 2026-11-23): the live canvas, a draft (a library preview) and a
// still picture (a slate's card in My slates, Community and Team slates, and the full-size preview a card opens) all
// draw a board with the engine's attachWorkshop and the board's own kit, through workshop/boardRender.js. A card that
// flattened a board to its notes (workshopToSlate) drew a hiring plan as generic columns; this keeps that from coming
// back. scripts/one-renderer.spec.mjs proves it in a browser; the engine's tests/unit/one-renderer.test.ts per kind.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '../web/app/imports/ui/components')
const read = path => readFileSync(join(app, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const render = read('workshop/boardRender.js')

test('a slate\'s card draws its boards with the one renderer, not as notes', () => {
  const snap = read('SnapSlate.jsx')
  assert.doesNotMatch(snap, /slatePreview\(|slate-preview|workshopToSlate/)
  assert.match(snap, /import \{ drawSlateBoards \} from '\.\/workshop\/boardRender'/)
  assert.match(snap, /drawSlateBoards\(snap\.v2 \?\? snap, ss\)/)
  // The boards it drew go with the card.
  assert.match(snap, /board\.destroy\(\)/)
})

test('a draft is drawn by the same renderer as a draft', () => {
  const preview = read('useConversationPreview.js')
  assert.match(preview, /drawBoard\(engine, workshop, \{ how: 'draft'/)
  assert.doesNotMatch(preview, /attachWorkshop\(/)
})

test('the live canvas and the renderer agree on which boards need a kit', () => {
  assert.match(read('workshop/useWorkshopOnCanvas.js'), /import \{ KIT_KINDS \} from '\.\/boardRender'/)
  // The list is the engine's (slateboxjs/boards/still), the one the still renderer loads kits by.
  assert.match(render, /KIT_KINDS[^]*from 'slateboxjs\/boards\/still'/)
  assert.match(render, /export \{[^}]*KIT_KINDS[^}]*\}/)
})

test('the app draws a board through the engine\'s one renderer (slateboxjs/boards/still), never with its own attachWorkshop', () => {
  // The engine's tests/unit/still.test.ts proves the renderer itself: read-only stills, a draft in its frame, laid
  // out as a desktop canvas shows it, every built-in drawn with its kit, and the kits fetched with import().
  assert.match(render, /from 'slateboxjs\/boards\/still'/)
  assert.doesNotMatch(render, /attachWorkshop/)
  // The renderer takes the engine's modules from the app (createStillRenderer); the model only as a loader, never a
  // static import the app could draw with itself.
  assert.match(render, /createStillRenderer\(/)
  assert.doesNotMatch(render, /^\s*import [^(]*['"]slateboxjs\/workshops\/model['"]/m)
  for (const name of ['drawBoard', 'drawSlateBoards']) assert.match(render, new RegExp(`export function ${name}\\(`))
  // A library picture (the gallery's cards and item page) is the same renderer: renderStill.
  assert.match(render, /renderer\.renderStill\(host, slate/)
})

test('the kits and the rulebook stay out of a first visit: the renderer\'s imports are its own chunks', () => {
  assert.doesNotMatch(render, /^\s*import [^(]*['"]slateboxjs\/(boards|boards\/nest|workshops\/behaviour)['"]/m)
  // Each is handed to the renderer as a loader, fetched with import() on first need; the canvas class too.
  for (const name of ['slateboxjs/boards', 'slateboxjs/boards/nest', 'slateboxjs/workshops/behaviour', 'slateboxjs']) assert.ok(render.includes(`import('${name}')`), name)
})

test('the gallery draws its pictures with the one renderer', () => {
  const still = read('library/gallery/LibraryStill.jsx')
  assert.match(still, /from '\.\.\/\.\.\/workshop\/boardRender'/)
  assert.match(still, /drawStill\(/)
  assert.doesNotMatch(still, /attachWorkshop|workshopToSlate|slatePreview\(/)
})
