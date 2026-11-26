import { componentSlate, createStillRenderer, holdsBoards, KIT_KINDS } from 'slateboxjs/boards/still'
import { ensureBoardChromeStyles } from './boardChromeStyles'

/*
 * One renderer for a board, wherever it shows (owner, 2026-11-23: "the preview should match the final view"):
 * the live canvas, a draft (a library preview, dashed and see-through) and a still picture (a slate's card in
 * My slates and Team slates, the full-size preview a card opens, the library gallery, the marketing site) all
 * draw it with the engine's attachWorkshop and the board's own kit. The renderer lives in the engine
 * (slateboxjs/boards/still), so the app and slatebox.com draw a board the same way; the kits and the rulebook
 * are its chunks, fetched on first need, so a first visit's bundle does not grow. The app adds only its own
 * chrome styles (its type, the zoom control's room) before a board is drawn.
 */

// The renderer imports nothing itself: the app hands it each engine module as a loader, so the kits, the rulebook and
// the canvas stay chunks of their own, fetched the first time a board needs them, and the app keeps one copy of the
// model and of the rule registry.
const renderer = createStillRenderer({
  model: () => import('slateboxjs/workshops/model'),
  boards: () => import('slateboxjs/boards'),
  nest: () => import('slateboxjs/boards/nest'),
  grid: () => import('slateboxjs/boards/grid'),
  behaviour: () => import('slateboxjs/workshops/behaviour'),
  Slate: () => import('slateboxjs').then((module) => module.Slate),
})
export const { loadBoardKit } = renderer

export { componentSlate, holdsBoards, KIT_KINDS }

/** Draw a board with the one renderer ('still' or 'draft'), in the app's chrome styles. */
export function drawBoard(engine, workshop, options) {
  ensureBoardChromeStyles()
  return renderer.drawBoard(engine, workshop, options)
}

/** Draw every board a saved slate holds onto a still canvas (a slate's card), in the app's chrome styles. */
export function drawSlateBoards(engine, slate, options) {
  ensureBoardChromeStyles()
  return renderer.drawSlateBoards(engine, slate, options)
}

/** A read-only picture of a slate (or of a component: componentSlate(workshop)) in `host`, fitted to it. */
export async function drawStill(host, slate, options) {
  ensureBoardChromeStyles()
  return renderer.renderStill(host, slate, options)
}
