// Where a presentation starts and how its steps are counted, for the presenter, its counter and
// the live status lines alike.

/** Whether the viewpoint at `index` shows every note the deck shows (an overview of the slate). */
export function isOverviewAt(index, viewpoints) {
  const viewpoint = viewpoints?.[index]
  if (!viewpoint?.nodeIds?.length) return false
  const shown = new Set(viewpoint.nodeIds.map(String))
  return viewpoints.every((other) => (other?.nodeIds || []).every((id) => shown.has(String(id))))
}

/**
 * The viewpoint a presentation starts on: its opening overview (0) when the deck opens with a
 * viewpoint that shows every note the deck shows (a plan's overview of the whole slate, with its
 * narrative), otherwise the whole slate before the first viewpoint (-1), as a deck edited by hand
 * may be.
 */
export function startView(viewpoints) {
  return isOverviewAt(0, viewpoints) ? 0 : -1
}

/**
 * A viewpoint as a step: the start is step 0, the first viewpoint after it step 1, and `total`
 * is the last step (the closing overview of a plan). → { step, total, start }
 */
export function stepOf(view, viewpoints) {
  const start = startView(viewpoints)
  return { step: Math.max(0, view - start), total: Math.max(0, (viewpoints?.length || 0) - 1 - start), start }
}

/**
 * What happens when a better plan arrives while a deck is being played (`view` on `viewpoints`):
 * at the start ('swap') it takes the deck's place unseen; past the start ('offer') the person is
 * never moved, and the plan is offered for them to use.
 */
export function planArrival(view, viewpoints) {
  return view <= startView(viewpoints) ? 'swap' : 'offer'
}
