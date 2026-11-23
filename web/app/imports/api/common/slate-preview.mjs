import { workshopToSlate } from 'slateboxjs/workshops/model'
import { workshopOrigin, workshopStyle } from './workshop-look.mjs'
import { slateBoards } from './slate-boards.mjs'

// What a dashboard card draws for a slate: what its canvas shows. A workshop slate keeps its
// lanes and cards in creative.model, and the canvas draws them beside the slate's own notes, so
// the card draws the same notes in the same place. The result is a private copy for the
// preview. It is never saved.
export function slatePreview(slate) {
  const preview = structuredClone(slate)
  preview.options = { ...preview.options }
  preview.options.containerStyle = { backgroundColor: '#ffffff', ...preview.options.containerStyle }
  preview.nodes = Array.isArray(preview.nodes) ? preview.nodes : []
  const model = preview.creative?.model
  if (model?.kind === 'workshop' && model.workshop) {
    try {
      // Every stored note is the slate's own. Where one already has a workshop note's name, the
      // workshop's note takes another id, as it does on the canvas.
      const own = preview.nodes
      const origin = workshopOrigin(preview.options, own)
      const beside = own.map(node => node?.options?.id).filter(id => typeof id === 'string')
      preview.nodes = [...own, ...workshopToSlate(model.workshop, { native: true, origin, style: workshopStyle(own), beside }).nodes]
      // A slate of many boards draws each further board where it sits, its notes named in its scope (b2:lane-…).
      for (const board of slateBoards(slate).slice(1)) {
        if (!board.origin) continue
        try { preview.nodes.push(...workshopToSlate(board.model.workshop, { native: true, origin: board.origin, style: workshopStyle(own), scope: board.id }).nodes) }
        catch { /* A board this build cannot draw is left off the card. */ }
      }
      preview.drawnFromModel = true
    } catch {
      // A model this build cannot draw leaves the card with the slate's own notes rather than failing the whole list.
    }
  }
  return preview
}
