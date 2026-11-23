import { localPlan } from './presentationPlan.mjs'

function flattenNodes(nodes, result = []) {
  ;(nodes || []).forEach((node) => {
    if (node?.nodeId) result.push(node)
    flattenNodes(node?.childrenNodes, result)
  })
  return result
}

const layoutIds = (presentationData) =>
  new Set(flattenNodes(presentationData?.nodes).map((node) => String(node.nodeId)))

/**
 * Build a useful presentation locally, so rendering never depends on an AI key: the slate as a
 * whole, then one segment per group of related notes (see presentationPlan.mjs), then the whole
 * slate again. `scenes` (see workshopScenes) are a workshop's lanes in their authored order, each
 * with its cards: they are the first segments.
 */
export default function buildFallbackPresentation(presentationData, name, { scenes = [] } = {}) {
  return {
    name: name ? `${name} — automatic` : 'Automatic presentation',
    viewpoints: localPlan(presentationData, name, { scenes }),
  }
}

/**
 * Play a saved sequence over the slate as it is now. A viewpoint that frames a workshop lane
 * frames that lane's cards as they are now (cards move between lanes after a deck is saved).
 * The lanes' viewpoints keep the authored lane order, in the places the deck gives lanes, and a
 * lane the deck does not know yet is presented after them. Notes that are gone are left out,
 * and a viewpoint left with no note is dropped.
 *
 * `keep`, for a follower: the presenter's own deck, whose step numbers must stay the
 * presenter's; only the cards are brought up to date.
 */
export function reconcileViewpoints(viewpoints, presentationData, scenes = [], { keep = false } = {}) {
  const known = layoutIds(presentationData)
  const byLane = new Map(scenes.map((scene) => [String(scene.nodeIds[0]), scene]))
  const workshopPart = (id) => byLane.has(id) || id.startsWith('card-') || id.startsWith('image-')
  // A lane's viewpoint frames one lane. One that frames several (an overview) stays where it is.
  const laneOf = (viewpoint) => {
    const lanes = (viewpoint.nodeIds || []).map(String).filter((id) => byLane.has(id))
    return lanes.length === 1 ? lanes[0] : undefined
  }
  let sequence = viewpoints || []
  if (!keep && byLane.size) {
    const isLane = sequence.map((viewpoint) => Boolean(laneOf(viewpoint)))
    const ordered = scenes.flatMap((scene) => {
      const lane = String(scene.nodeIds[0])
      const own = sequence.filter((viewpoint) => laneOf(viewpoint) === lane)
      return own.length ? own : [{ nodeIds: scene.nodeIds, narrative: scene.narrative, duration: 3000 }]
    })
    const last = isLane.lastIndexOf(true)
    const merged = []
    let lane = 0
    sequence.forEach((viewpoint, index) => {
      merged.push(isLane[index] ? ordered[lane++] : viewpoint)
      if (index === last) merged.push(...ordered.slice(lane))
    })
    sequence = last < 0 ? [...ordered, ...sequence] : merged
  }
  return sequence
    .map((viewpoint) => {
      const ids = (viewpoint.nodeIds || []).map(String)
      const lanes = ids.filter((id) => byLane.has(id))
      const framed = lanes.length
        ? [...ids.filter((id) => !workshopPart(id)), ...lanes.flatMap((lane) => byLane.get(lane).nodeIds.map(String))]
        : ids
      return { ...viewpoint, nodeIds: [...new Set(framed)].filter((id) => known.has(id)) }
    })
    .filter((viewpoint) => keep || viewpoint.nodeIds.length > 0)
}
