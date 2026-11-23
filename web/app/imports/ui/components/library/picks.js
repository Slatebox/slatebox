// The three entries the strip and the + menu show first, by what the slate holds (the names are the
// catalogue's; the library chunk has the rest). Imported only by lazy modules (AddStrip, BoardsRows).
export function stripPicks({ empty = false, hasBoard = false } = {}) {
  if (hasBoard) return [['team-board', 'Team board'], ['sales-pipeline', 'Sales pipeline'], ['launch-plan', 'Launch plan']]
  if (empty) return [['retro', 'Retro'], ['now-next-later', 'Now / Next / Later'], ['pros-cons', 'Pros and cons']]
  return [['now-next-later', 'Now / Next / Later'], ['retro', 'Retro'], ['decision-path', 'Decision path']]
}
