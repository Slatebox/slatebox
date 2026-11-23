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
  assert.match(render, /KIT_KINDS = \['launch-plan', 'hiring-plan', 'pipeline', 'budget', 'nest'\]/)
})

test('a still is the board read-only, its chrome at the board\'s size; a draft wears its frame', () => {
  assert.match(render, /readOnly: true/)
  assert.match(render, /how === 'draft' \? \{ draft: true \} : \{ still: true \}/)
  // Laid out as a desktop canvas shows it, whatever the card's size.
  assert.match(render, /width = 1440/)
})

test('the kits and the rulebook stay out of a first visit: fetched with import() when a board is drawn', () => {
  assert.doesNotMatch(render, /^\s*import [^(]*['"]slateboxjs\/(boards|workshops\/behaviour)/m)
  for (const chunk of ['slateboxjs/boards', 'slateboxjs/boards/nest', 'slateboxjs/workshops/behaviour']) assert.ok(render.includes(`import('${chunk}')`), chunk)
})
