// What both eval layers call a built smart component: a preview from the builder path that is a board of plain
// lanes, passes validateWorkshop (the one gate), was drafted by the agent from the words (not the starter a failed
// draft falls back to), and says what it made.
import 'slateboxjs/workshops/behaviour'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { componentQuality, componentStarter } from '../../../web/app/imports/api/common/builder-freeform.mjs'

/** Checks a preview: [] when it is a valid, drafted, rendered-ready component, else the reasons. */
export function previewProblems(preview, prompt) {
  const problems = []
  if (preview.mode !== 'play' || preview.format !== 'lanes') problems.push(`not a board of lanes (mode ${preview.mode}, format ${preview.format})`)
  const workshop = preview.canvas?.workshop
  let valid = null
  try { valid = validateWorkshop(workshop) } catch (error) { problems.push('workshop fails validateWorkshop: ' + error.message) }
  if (preview.provider !== 'ai') problems.push('the agent draft was not used (fell back to the starter board)')
  if (valid) {
    const starter = validateWorkshop(componentStarter(prompt))
    if (valid.title === starter.title && JSON.stringify(valid.lanes) === JSON.stringify(starter.lanes)) problems.push('the board is the starter, not a draft')
    if (valid.kind || valid.experience || valid.lanes.some((lane) => lane.station)) problems.push('not a board of plain lanes')
    if (!valid.cards.length) problems.push('no pieces to drag')
    if (!preview.said || !/from your description/.test(preview.said)) problems.push('the reply does not say what was made')
  }
  return { problems, workshop: valid }
}

/**
 * The quality gate on what a preview made (componentQuality, the check the drafting request and the preview hold a
 * draft to): [] when every card is named as a real thing (never a lane, title or generic phrase plus a number or letter),
 * no card is named twice, there are three or more, and the board has behavior (a capacity, allowed lanes, a rule).
 */
export function qualityProblems(preview, prompt) {
  let workshop
  try { workshop = validateWorkshop(preview.canvas?.workshop) } catch (error) { return ['no valid board: ' + error.message] }
  return componentQuality(workshop, { message: prompt })
}
