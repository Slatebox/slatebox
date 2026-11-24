// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// An outside agent that answers with Excalidraw elements: its diagram is drawn by the same fixed
// recipe "Import from Excalidraw" uses (imports/api/common/excalidraw-scene.mjs), with no model:
// shapes with their words (bound, labelled, or free text drawn inside them), arrows bound at both
// ends or ending on a shape, the same words once.
import { sceneToLayout, skippedWords } from '/imports/api/common/excalidraw-scene.mjs'
import { PLAN_LIMITS } from './translate.mjs'

export { excalidrawElements } from './translate.mjs'

/** One group drawn from Excalidraw elements, or null when it holds no shape or words. */
export function excalidrawGroup(elements, label) {
  const { notes, lines, skipped } = sceneToLayout(elements, { maxNotes: 40, maxLines: 80 })
  if (!notes.length) return null
  return {
    label: label || 'Diagram',
    layout: 'free',
    notes: notes.map((note) => ({ ...note, text: note.text.slice(0, PLAN_LIMITS.noteChars) })),
    lines,
    left: skippedWords(skipped),
  }
}
