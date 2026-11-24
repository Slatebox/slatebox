// Test-run samples for drafting boards (surface workshop.draft), as workshops.js draftWorkshop
// sends them. parses() is the board's own check for the kind drafted.
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { prepareConstraintProposal } from '../../../imports/api/common/workshop-constraints.mjs'
import { constraintTool } from '../../methods/workshop-constraint-draft.mjs'
import { authorTool } from '../../methods/workshop-lane-draft.mjs'
import { conceptMapFromDraft, mapTool } from '../../methods/workshop-map-draft.mjs'
import { releasePlanFromDraft, releaseTool } from '../../methods/workshop-release-draft.mjs'
import { toolCallOf, verdict } from './answer.mjs'
import { MAP } from './workshop.mjs'

const KINDS = {
  lanes: { system: 'workshop.draft.system', toolId: 'tool.draft_workshop', tool: authorTool, parse: validateWorkshop },
  map: { system: 'workshop.draft.map', toolId: 'tool.draft_concept_map', tool: mapTool, parse: conceptMapFromDraft },
  release: { system: 'workshop.draft.release', toolId: 'tool.draft_release_plan', tool: releaseTool, parse: releasePlanFromDraft },
  rules: { system: 'workshop.draft.rules', toolId: 'tool.revise_workshop_rules', tool: constraintTool('map'), parse: (args) => prepareConstraintProposal(MAP, args) },
}
const sample = (id, title, kind, brief) => ({
  id, title, kind, brief,
  values: {
    'workshop.draft.repair': async (render) => ({ instructions: await render(KINDS[kind].system), problem: 'Call the requested tool.' }),
  },
})

export default {
  surface: 'workshop.draft',
  samples: [
    sample('lanes', 'A lane board for choosing a venue', 'lanes', 'Choose a venue for the spring party with the team: a hall, a barn or a park, at most two on the shortlist.'),
    sample('map', 'A map board for a hiking trip', 'map', 'Plan a day hike from the car park to the summit, with a lake detour that costs an hour.'),
    sample('release', 'A release plan for a small app', 'release', 'Plan two releases of a notes app: sign in, sharing, offline mode and search, about 20 points each release.'),
    sample('rules', 'Revising a map board\'s rules', 'rules', 'Let the walker skip the start and go straight to the summit.'),
  ],
  toolFor: (s) => (KINDS[s.kind].tool.name),
  request: async (s, render) => {
    const kind = KINDS[s.kind]
    const tool = { ...kind.tool, description: await render(kind.toolId) }
    return {
      system: await render(kind.system),
      prompts: [{ role: 'user', content: s.kind === 'rules' ? JSON.stringify({ currentWorkshop: MAP, requestedChange: s.brief }) : s.brief }],
      functions: [tool],
      function_call: { name: tool.name },
    }
  },
  parses: (response, s) => verdict(() => {
    const call = toolCallOf(response)
    const want = KINDS[s.kind].tool.name
    if (!call) return `It did not call ${want}.`
    if (call.name !== want) return `It called ${call.name}, not ${want}.`
    KINDS[s.kind].parse(call.arguments)
    return null
  }),
}
