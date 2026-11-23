import { workshopPresentationScenes } from 'slateboxjs/workshops/model'

/**
 * A slate's workshop as the viewpoints that open its presentation: each lane, in the authored
 * presentation order, framed with its picture and its cards. The narrative is the lane's name,
 * and its outcome when the outcome says more than the name. `label` is the lane's name: a lane's
 * viewpoint in any plan starts with it, so viewers know where they are.
 */
export function workshopScenes(workshop) {
  if (!workshop) return []
  let scenes
  try { scenes = workshopPresentationScenes(workshop) } catch { return [] }
  return scenes.map(({ lane, nodeIds }) => {
    const outcome = String(lane.station?.outcome ?? '').trim()
    return { nodeIds, label: lane.label, narrative: outcome && outcome !== lane.label ? `${lane.label} — ${outcome}` : lane.label }
  })
}
