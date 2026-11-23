// The canvas has two side panels, Ask Slatebox and the slate settings, in the same place beside the
// canvas, and shows one at a time: the one opened last wins. The settings opened over Ask Slatebox
// only cover it: what it holds (a preview waiting for Keep, a request in flight, a typed message)
// stays, and it is back when the settings close. Otherwise closing a panel opens nothing.

/**
 * @param {{ask: boolean, settings: boolean}} before which were open
 * @param {{ask: boolean, settings: boolean}} now which are asked to be open
 * @returns {{ask: boolean, settings: boolean}} which stay open
 */
export function onePanel(before, now) {
  if (!now.ask || !now.settings) return { ...now }
  if (!before.settings) return { ask: false, settings: true }
  return { ask: true, settings: false }
}

/**
 * The side panels after a change, and whether Ask Slatebox is kept (still there, with what it
 * holds, while it is out of sight).
 * @param {{ask: boolean, settings: boolean}} before which were open
 * @param {{ask: boolean, settings: boolean}} now which are asked to be open
 * @param {boolean} kept whether Ask Slatebox was kept
 * @returns {{ask: boolean, settings: boolean, kept: boolean}}
 */
export function sidePanels(before, now, kept) {
  const next = onePanel(before, now)
  let keep = kept
  // Covered by the settings: kept. Closed by the person (×, the toggle): let go.
  if (before.ask && !next.ask) keep = next.settings
  // The settings that covered it close: it is back.
  if (before.settings && !next.settings && keep && !next.ask) next.ask = true
  return { ...next, kept: keep }
}
