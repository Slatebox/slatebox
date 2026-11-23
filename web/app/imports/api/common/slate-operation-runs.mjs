// The receipts SlateOperationListener sees (slateOperationRuns): an agent's saved canvas plan,
// which every open canvas draws, and a workshop edit's receipt, which it must not: a workshop
// reaches screens through creativeSlates.state, and the canvas applier refuses its operations.

/** The plan operations that edit a workshop or map, not the canvas (workshop-operation-api.mjs). */
export const WORKSHOP_OPERATION_KINDS = Object.freeze([
  'workshop_edits',
  'undo_workshop_edit',
  'move_workshop_card',
  'set_presentation_order',
  'add_map_branch',
  'update_map_outcome',
  'connect_workshop_card',
  'disconnect_workshop_card',
])

const workshopKinds = new Set(WORKSHOP_OPERATION_KINDS)

/** Whether a saved run is a canvas plan the canvas applier should draw. */
export function appliesToCanvas(run) {
  if (!run || typeof run._id !== 'string' || run._id.startsWith('workshop-')) return false
  const operations = run.plan?.operations
  return Array.isArray(operations) && operations.length > 0 && !operations.some((op) => workshopKinds.has(op?.kind))
}
