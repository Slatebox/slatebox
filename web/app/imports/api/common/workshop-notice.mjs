// What a workshop says as it stands, line by line, and which of it to show for a moment after a
// change. Every line is read aloud (a live region the canvas keeps out of sight); on screen only a
// line that tells more than the board already shows appears, briefly, beside the board.

/**
 * @param {{lanes: object[], cards: object[]}} workshop the workshop as it is drawn
 * @param {{id: string, label: string, text: string}[]} signals its resolved placement outcomes
 * @returns {{key: string, place: string, text: string, said: string}[]} `said` is the whole line,
 *   for a screen reader; `text` is what it adds to the board (empty when nothing)
 */
export function standingLines(workshop, signals = []) {
  const lines = []
  if (workshop.lanes[0]?.station) {
    for (const card of workshop.cards) {
      const station = workshop.lanes.find((lane) => lane.id === card.laneId)
      if (!station) continue
      const outcome = station.station?.outcome && station.station.outcome !== station.label ? station.station.outcome : ''
      lines.push({ key: 'card:' + card.id, place: station.label, text: outcome,
        said: `${card.label} · ${station.label}${outcome ? ' — ' + outcome : ''}` })
    }
  }
  for (const signal of signals) lines.push({ key: 'signal:' + signal.id, place: signal.label, text: signal.text, said: `${signal.label} — ${signal.text}` })
  return lines
}

/** The one line to show after a change: the last that changed and says something new, or null. */
export function noticeAfter(before, after) {
  const was = new Map(before.map((line) => [line.key, line]))
  const changed = after.filter((line) => line.text && (was.get(line.key)?.said !== line.said))
  const line = changed[changed.length - 1]
  return line ? { place: line.place, text: line.text } : null
}

/**
 * Shows the notice after each change and hides it `shownFor` ms later. The newest change always
 * wins: one that adds nothing takes a notice still showing away at once (a card moved into a stop,
 * then back before the notice went, no longer names that stop).
 * @param {(notice: {place: string, text: string}|null) => void} show
 * @param {number} shownFor
 * @param {{setTimeout: Function, clearTimeout: Function}} [timers]
 */
export function noticeKeeper(show, shownFor, timers = globalThis) {
  let timer = null
  const stop = () => { if (timer !== null) timers.clearTimeout(timer); timer = null }
  return {
    change(before, after) {
      stop()
      const next = noticeAfter(before, after)
      show(next)
      if (next) timer = timers.setTimeout(() => { timer = null; show(null) }, shownFor)
    },
    stop,
  }
}
