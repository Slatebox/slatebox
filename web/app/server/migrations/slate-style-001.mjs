// slate-style-001: the slate IS the presentation. Before slates wore styles, a styled presentation's
// look (its background, its notes' outlines and fonts, its title cards, captions and art) was drawn
// by the player over the slate and never saved on it. Now Present only plays the slate, so each
// presentation saved with a style (and an art direction) has that style worn on its slate, natively:
// the style's background and the notes' look written onto the slate's own notes, and its title
// cards, captions and art added as real notes (presentationBake.wearStyle, the same code the canvas,
// agents and the library seed use). Its deck becomes the camera over that slate (version 5), and a
// published snapshot is taken again from the styled slate.
//
// Nothing is deleted: every note keeps its id and its words (wearing a style removes only notes a
// style added, and a slate that never wore one has none). Each slate is saved through the save core
// (its revision goes up, the save is logged, open canvases take it as any save).
//
// Idempotent, at every boot: only decks not yet version 5 are looked at, only a slate's latest deck
// is worn, and wearing a style on a slate that already wears it gives the same slate (a run stopped
// between the slate's save and the deck's is finished by the next). Pure apart from the injected
// collections, save core and log.
import { playerSlateCopy, wearDeckOnSlate, wornSlateSet } from '../methods/presentationDeck.mjs'
import { BAKED_DECK_VERSION } from '../../imports/ui/components/presentations/presentationBake.mjs'

export const SLATE_STYLE_001 = 'migration:slate-style-001'
export const MIGRATION_ACTOR = Object.freeze({ kind: 'system', userId: null })

/** The decks this migration wears onto their slates (a style, a direction, and no worn deck yet). */
export const STYLED_DECKS = Object.freeze({
  'style.id': { $exists: true },
  'direction.steps.0': { $exists: true },
  'deck.version': { $ne: BAKED_DECK_VERSION },
})

/**
 * Wear each styled deck's style on its slate. deps: presentations, slates (raw collections),
 * saveCore (the app's save core), now, log. → { worn, skipped, failed } (deck ids; failed with why).
 */
export async function wearStyledDecks({ presentations, slates, saveCore, now = () => new Date(), log = console }) {
  const report = { worn: [], skipped: [], failed: [] }
  const rows = await presentations.find(STYLED_DECKS, {
    projection: { _id: 1, slateShareId: 1, name: 1, style: 1, direction: 1, slateJSON: 1, version: 1 },
  }).toArray()
  for (const row of rows) {
    try {
      // Only a slate's latest deck is worn by it: an older styled deck of a slate presented again
      // since (styled or not) keeps playing the slate as it is.
      const decks = await presentations.find({ slateShareId: row.slateShareId }, { projection: { _id: 1, version: 1 } }).toArray()
      const latest = decks.reduce((a, b) => ((Number(b.version) || 0) > (Number(a?.version) || 0) ? b : a), null)
      if (latest && latest._id !== row._id && (Number(latest.version) || 0) > (Number(row.version) || 0)) {
        report.skipped.push(row._id)
        continue
      }
      const slate = await slates.findOne({ shareId: row.slateShareId }, { projection: { _id: 1, creative: 1, nodes: 1 } })
      // A slate gone, empty or holding a workshop (its notes are the workshop's) keeps its deck as it is:
      // that deck plays the slate as drawn.
      if (!slate || slate.creative?.model || !Array.isArray(slate.nodes) || !slate.nodes.length) {
        report.skipped.push(row._id)
        continue
      }
      let worn = null
      await saveCore.save({
        slateId: slate._id,
        actor: MIGRATION_ACTOR,
        source: 'migration',
        build(current) {
          worn = wearDeckOnSlate(current, row, row.style, { remix: false })
          return worn ? { set: wornSlateSet(worn.slate) } : null
        },
      })
      if (!worn) {
        report.skipped.push(row._id)
        continue
      }
      const set = { ...worn.change, styleWornAt: now() }
      // A snapshot the share page or a library copy plays is taken again from the styled slate.
      if (row.slateJSON) set.slateJSON = playerSlateCopy(worn.slate)
      await presentations.updateOne({ _id: row._id, 'deck.version': { $ne: BAKED_DECK_VERSION } }, { $set: set })
      report.worn.push(row._id)
    } catch (error) {
      report.failed.push({ id: row._id, error: String(error?.message || error).slice(0, 200) })
      log.error?.(`slate-style-001: deck ${row._id} not worn: ${error?.message}`)
    }
  }
  if (report.worn.length || report.failed.length)
    log.info?.(`slate-style-001: ${report.worn.length} styled presentations now worn by their slates${report.failed.length ? `, ${report.failed.length} failed` : ''}`)
  return report
}
