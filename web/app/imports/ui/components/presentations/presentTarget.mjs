/**
 * Where Present goes for a slate. Every slate whose notes are drawn on the canvas, a slate with a
 * workshop included, opens the presenter. A board drawn by its own renderer (the other creative
 * kinds) has no canvas to present, and shows its own read-only view instead.
 */
export function presentTarget(slate) {
  if (!slate) return null
  return slate.creativeKind && slate.creativeKind !== 'workshop' ? 'overlay' : 'presenter'
}
