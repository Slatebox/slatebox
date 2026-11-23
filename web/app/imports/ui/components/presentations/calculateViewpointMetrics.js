import { viewpointFrame } from './presentationFraming.mjs'

/**
 * The box the camera frames for a viewpoint's notes: { centerX, centerY, width, height,
 * rotation } (see presentationFraming.mjs), or null when none of them is on the slate.
 */
export default function calculateViewpointMetrics(nodeIds, presentationData) {
  if (!nodeIds?.length) return null
  return viewpointFrame(nodeIds, presentationData)
}
