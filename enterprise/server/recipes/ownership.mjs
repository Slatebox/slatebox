// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Which notes a recipe keeps, and which became a person's. A recipe's note stays its own until a
// person changes what it says or how it looks (text, shape, colors, link) or deletes it; from then
// on it is the person's, and the recipe never changes or deletes it again. Moving and resizing a
// note never changes whose it is (the recipe never touches where a note is anyway).
// Provenance is kept here, in recipeNotes, never on the note: no plan, paste or import can make a
// note look like a recipe's.
// Who changed what is read from the slate's event log (slateEvents: one row per save, with
// [noteId, property] pairs and the actor), after the revision the recipe last saw.

// The properties whose change by a person makes a note theirs. '*' is a whole-note change (added,
// removed, or rewritten past the per-property log).
export const OWNERSHIP_PROPS = Object.freeze(['text', 'shape', 'vectorPath', 'backgroundColor', 'foregroundColor', 'borderColor', 'borderWidth', 'borderStyle', 'link', 'label', 'lane', 'laneId', '*'])
export const GEOMETRY_PROPS = Object.freeze(['x', 'y', 'width', 'height', 'rotationAngle', 'zIndex'])

export const recipeNoteId = (instanceId, slateId, noteId) => `${instanceId}:${slateId}:${noteId}`

/**
 * Notes others changed since `revision`, by property: Map<noteId, Set<prop>>. Rows saved by this
 * recipe (its token id) are not counted. events: the slate's event log rows after the revision
 * (any order).
 */
export function touchedSince(events, slateId, revision, tokenId) {
  const out = new Map()
  for (const row of events || []) {
    if (row.slateId !== slateId || !(row.revision > (revision ?? -1))) continue
    if (row.actor?.tokenId && row.actor.tokenId === tokenId) continue
    for (const [id, prop] of row.properties || []) {
      if (!out.has(id)) out.set(id, new Set())
      out.get(id).add(prop)
    }
    // a card a person moved between lanes (the board's move log)
    for (const move of row.moves || row.cardMoves || []) {
      const id = move.card || move.cardId || move.id
      if (!id) continue
      if (!out.has(id)) out.set(id, new Set())
      out.get(id).add('lane')
    }
  }
  return out
}

/** Whether these touched properties make a note the person's. */
export const takesOwnership = (props) => [...(props || [])].some((prop) => OWNERSHIP_PROPS.includes(prop))

/**
 * Brings the recipe's rows up to date with the slate. → { changed: RecipeNote[], dropped: noteId[] }
 *   owned     Map<noteId, RecipeNote> (changed in place)
 *   touched   touchedSince(...)
 *   present   Set<noteId>: real notes on the slate now
 *   waiting   Set<noteId>: the recipe's own suggestions still waiting there (ghosts)
 * A row the recipe suggested (pending) that is now a real note was kept: it is the recipe's. One
 * that is neither real nor waiting was discarded or expired: the row is dropped, so the next run
 * proposes it again while it is still true. A kept note people changed or deleted is theirs.
 */
export function flipTouched(owned, touched, present, now = new Date(), waiting = new Set()) {
  const changed = []
  const dropped = []
  for (const [noteId, row] of owned) {
    if (row.owner === 'person') continue
    if (row.pending) {
      if (present.has(noteId)) {
        const next = { ...row, pending: false, updated: now }
        owned.set(noteId, next)
        changed.push(next)
      } else if (!waiting.has(noteId)) {
        owned.delete(noteId)
        dropped.push(noteId)
      }
      continue
    }
    const props = touched.get(noteId)
    const deleted = !present.has(noteId) && !row.gone
    if (!takesOwnership(props) && !deleted) continue
    const next = { ...row, owner: 'person', personProps: [...new Set([...(row.personProps || []), ...(props ? [...props].filter((p) => OWNERSHIP_PROPS.includes(p)) : []), ...(deleted ? ['deleted'] : [])])], updated: now }
    owned.set(noteId, next)
    changed.push(next)
  }
  return { changed, dropped }
}

/** "Make it mine": the person takes a note the recipe keeps. */
export const makeMine = (row, now = new Date()) => ({ ...row, owner: 'person', personProps: [...new Set([...(row.personProps || []), 'claimed'])], updated: now })
