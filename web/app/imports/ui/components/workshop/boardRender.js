import {
  componentSlate, drawBoard as drawEngineBoard, drawSlateBoards as drawEngineSlateBoards, holdsBoards, KIT_KINDS, loadBoardKit, renderStill,
} from 'slateboxjs/boards/still'
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

export { componentSlate, holdsBoards, KIT_KINDS, loadBoardKit }

/** Draw a board with the one renderer ('still' or 'draft'), in the app's chrome styles. */
export function drawBoard(engine, workshop, options) {
  ensureBoardChromeStyles()
  return drawEngineBoard(engine, workshop, options)
}

/** Draw every board a saved slate holds onto a still canvas (a slate's card), in the app's chrome styles. */
export function drawSlateBoards(engine, slate, options) {
  ensureBoardChromeStyles()
  return drawEngineSlateBoards(engine, slate, options)
}

/** A read-only picture of a slate (or of a component: componentSlate(workshop)) in `host`, fitted to it. */
export async function drawStill(host, slate, options) {
  ensureBoardChromeStyles()
  const { Slate } = await import('slateboxjs')
  return renderStill(host, slate, { ...options, Slate })
}
