import { boardLegend } from 'slateboxjs/workshops/model'

/**
 * The "Rules" chips the chat shows for a board (a library preview, a board being changed): the same legend the
 * board draws above itself on the canvas (the engine's boardLegend, generated from the board's rules as data),
 * so the chat and the canvas always say the same thing. A column's limit is its counter's to say ("2 / 3").
 * Each chip: { key, text, icon, warn }.
 */
export function boardRuleChips(workshop) {
  if (!workshop?.lanes?.length) return []
  try {
    return boardLegend(workshop).map((item, index) => ({ key: index + ':' + item.text, text: item.text, icon: item.icon, warn: Boolean(item.warn) }))
  } catch {
    return []
  }
}
