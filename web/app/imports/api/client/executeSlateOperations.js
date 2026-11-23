import { SlateOperations } from 'slateboxjs'

// The engine's live applier. It resolves once every operation has reached the
// canvas, including those that wait for a note the plan made to be drawn.
export default async function executeSlateOperations({
  slate,
  plan,
  userMessage,
  replay = false,
}) {
  const result = SlateOperations.applySlateOperations(slate, plan, { userMessage, replay })
  await result.applied
  return result
}
