import { attachWorkshop, rulebookLoaded } from 'slateboxjs/workshops/model'
import { lanesPerRow, workshopOrigin, workshopStyle } from '../../../api/common/workshop-look.mjs'
import { slateBoards } from '../../../api/common/slate-boards.mjs'
import { ensureBoardChromeStyles } from './boardChromeStyles'

/*
 * One renderer for a board, wherever it shows (owner, 2026-11-23: "the preview should match the final view"):
 * the live canvas, a draft (a library preview, dashed and see-through) and a still picture (a slate's card in
 * My slates, Community and Team slates, and the full-size preview a card opens) all draw it with the engine's
 * attachWorkshop and the board's own kit, so a hiring plan is its months, bars and runway everywhere, never
 * the generic columns its notes would make without the kit. The kits and the rulebook are their own chunks,
 * fetched here on first need, so a first visit's bundle does not grow.
 */

/** The boards drawn by a kit of their own (slateboxjs/boards); a nested board's kit is a chunk of its own too. */
export const KIT_KINDS = ['launch-plan', 'hiring-plan', 'pipeline', 'budget', 'nest']

/** Fetch what a board needs to be drawn as itself: its kit (business boards) and the rulebook (a board with rules, and any kit board). */
export async function loadBoardKit(workshop) {
  const needsKit = KIT_KINDS.includes(workshop?.kind)
  const [kits] = await Promise.all([
    needsKit ? import('slateboxjs/boards') : null,
    workshop?.kind === 'nest' ? import('slateboxjs/boards/nest') : null,
    // A kit board's legend is its rulebook's sentences (boardChrome kitLegend), so a kit board needs it too.
    (workshop?.behaviour || needsKit) && !rulebookLoaded() ? import('slateboxjs/workshops/behaviour') : null,
  ])
  return kits ? { kit: kits.kitFor(workshop.kind), layoutFor: width => kits.boardLayoutFor(width) } : { kit: undefined, layoutFor: width => ({ lanesPerRow: lanesPerRow(width, workshop) }) }
}

/**
 * Draw a board with the one renderer: `how` is 'draft' (dashed, see-through, view-only, scope pv) or 'still'
 * (read-only; a card's picture). `width` is the screen width the board is laid out for: a still is laid out as a
 * desktop canvas shows it, whatever the size of the card it is drawn into.
 */
export async function drawBoard(engine, workshop, { how = 'still', origin, scope, width = 1440, style } = {}) {
  ensureBoardChromeStyles()
  const { kit, layoutFor } = await loadBoardKit(workshop)
  return attachWorkshop(engine, workshop, {
    readOnly: true, origin, layout: layoutFor(width), style: style ?? workshopStyle(engine.freeNodes?.() ?? []),
    // A draft wears its dashed frame; a still's chrome scales with the board, as an export's does.
    ...(how === 'draft' ? { draft: true } : { still: true }),
    ...((scope || how === 'draft') && { scope: scope ?? 'pv' }),
    ...(kit && { kit }),
  })
}

/**
 * Draw every board a saved slate holds onto a still canvas (a slate's card), each where the canvas puts it: the
 * first at the slate's workshop origin, a further board at its own origin and in its scope (b2:…). A board this
 * build cannot draw is left off the picture rather than failing the list. → the attached boards (destroy each to
 * take them away).
 */
export async function drawSlateBoards(engine, slate, { width = 1440 } = {}) {
  const own = Array.isArray(slate?.nodes) ? slate.nodes : []
  const style = workshopStyle(own)
  const drawn = []
  for (const board of slateBoards(slate)) {
    const workshop = board?.model?.kind === 'workshop' ? board.model.workshop : null
    if (!workshop) continue
    const main = board.id === 'main'
    const origin = main ? workshopOrigin(slate.options, own) : board.origin
    if (!origin) continue
    try {
      const attached = await drawBoard(engine, workshop, { how: 'still', origin, scope: main ? undefined : board.id, width, style })
      await attached.whenDrawn?.()
      drawn.push(attached)
    } catch (err) {
      console.warn('A board on this slate could not be drawn on its card.', err)
    }
  }
  return drawn
}
