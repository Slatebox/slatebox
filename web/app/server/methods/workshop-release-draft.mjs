import { availableLanes, validateWorkshop } from 'slateboxjs/workshops/model'

const label = { type: 'string', minLength: 1, maxLength: 80 }
const points = { type: 'integer', minimum: 1, maximum: 24 }
export const releaseTool = {
  name: 'draft_release_plan',
  description: 'Draft release windows, effort estimates and feature prerequisites for an editable planning session.',
  parameters: { type: 'object', additionalProperties: false, required: ['title', 'windows', 'features'], properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    windows: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false,
      required: ['name', 'budget'], properties: { name: label, budget: { type: 'integer', minimum: 1, maximum: 576 } } } },
    features: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'object', additionalProperties: false,
      required: ['name', 'points', 'prerequisites'], properties: { name: label, points,
        prerequisites: { type: 'array', items: label, description: 'Exact names of prerequisite features. Use an empty list for independent features.' } } } },
  } },
}
export const releaseInstructions = 'Use draft_release_plan to prepare an editable release plan from the brief. Use one to four chronological release windows. Features take 1–24 effort points. Window budgets may range from 1 to 576 points. Honor stated estimates, and keep suggested estimates modest when the user leaves them open. Use unique feature names. Write each prerequisite using its exact feature name; use no circular dependencies. The application starts all features in an Unscheduled backlog for the team to try. At least one feature must fit a release window.'

export function releasePlanFromDraft(input) {
  if (!Array.isArray(input?.windows) || input.windows.length < 1 || input.windows.length > 4) throw new Error('Provide one to four release windows.')
  if (!Array.isArray(input.features) || !input.features.length || input.features.length > 24) throw new Error('Provide one to 24 features.')
  const key = text => typeof text === 'string' ? text.trim().toLowerCase() : ''
  const names = new Map()
  input.features.forEach((feature, i) => {
    const name = key(feature?.name)
    if (!name || names.has(name)) throw new Error('Give each feature a unique name.')
    names.set(name, 'feature-' + (i + 1))
  })
  const lanes = input.windows.map((window, i) => {
    if (!Number.isInteger(window?.budget)) throw new Error('Give every release window an integer point budget.')
    return { id: 'window-' + (i + 1), label: window.name, capacity: window.budget }
  })
  const backlog = 'unscheduled'
  lanes.push({ id: backlog, label: 'Unscheduled' })
  const cards = input.features.map(feature => {
    if (!Array.isArray(feature.prerequisites)) throw new Error('List the prerequisites for each feature.')
    return { id: names.get(key(feature.name)), label: feature.name, points: feature.points, laneId: backlog,
      dependsOn: feature.prerequisites.map(ref => {
        const id = names.get(key(ref))
        if (!id) throw new Error('Use an existing feature name for every prerequisite.')
        return id
      }) }
  })
  const plan = validateWorkshop({ version: 1, kind: 'release-plan', title: input.title, lanes, cards })
  if (!plan.cards.some(card => availableLanes(plan, card).some(lane => lane.id !== backlog))) {
    throw new Error('Give at least one release window the budget to fit a feature.')
  }
  return plan
}
