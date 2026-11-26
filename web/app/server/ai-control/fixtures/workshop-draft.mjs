// Test-run samples for drafting boards (surface workshop.draft), as workshops.js draftWorkshop
// sends them. parses() is the board's own check for the kind drafted.
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { prepareConstraintProposal } from '../../../imports/api/common/workshop-constraints.mjs'
import { constraintTool } from '../../methods/workshop-constraint-draft.mjs'
import { authorTool } from '../../methods/workshop-lane-draft.mjs'
import { componentAuthorTool, parseComponentDraft } from '../../methods/workshop-component-draft.mjs'
import { componentQuality } from '../../../imports/api/common/builder-freeform.mjs'
import { gridAuthorTool, parseGridDraft } from '../../methods/workshop-grid-draft.mjs'
import { gridQuality } from '../../../imports/api/common/builder-grid.mjs'
import { conceptMapFromDraft, mapTool } from '../../methods/workshop-map-draft.mjs'
import { releasePlanFromDraft, releaseTool } from '../../methods/workshop-release-draft.mjs'
import { toolCallOf, verdict } from './answer.mjs'
import { MAP } from './workshop.mjs'

const KINDS = {
  lanes: { system: 'workshop.draft.system', toolId: 'tool.draft_workshop', tool: authorTool, parse: validateWorkshop },
  map: { system: 'workshop.draft.map', toolId: 'tool.draft_concept_map', tool: mapTool, parse: conceptMapFromDraft },
  release: { system: 'workshop.draft.release', toolId: 'tool.draft_release_plan', tool: releaseTool, parse: releasePlanFromDraft },
  // a smart component is held to the quality gate as well as the board's own check
  component: { system: 'workshop.draft.component', toolId: 'tool.draft_component', tool: componentAuthorTool, parse: (args, s) => {
    const problems = componentQuality(parseComponentDraft(args), { message: s.brief })
    if (problems.length) throw new Error(problems.join(' '))
  } },
  // a printable page (a grid sheet) is held to its own quality gate as well as the sheet's own check
  grid: { system: 'workshop.draft.grid', toolId: 'tool.draft_grid', tool: gridAuthorTool, parse: (args, s) => {
    const problems = gridQuality(parseGridDraft(args, { message: s.brief }), { message: s.brief })
    if (problems.length) throw new Error(problems.join(' '))
  } },
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
    sample('component', 'A smart component described in the builder', 'component', 'snappable congruent pieces to compose new printable materials'),
    sample('rules', 'Revising a map board\'s rules', 'rules', 'Let the walker skip the start and go straight to the summit.'),
    // printable pages (a grid sheet): the owner's words and the five more of the smart-component eval (spec §9)
    sample('grid-owner-printable-pieces', 'A printable page from the owner\'s words', 'grid', 'snappable congruent pieces to compose new printable materials'),
    sample('grid-worksheet-builder', 'A worksheet builder', 'grid', 'a worksheet builder for my 4th grade class: drag question, picture and answer-line blocks onto a letter page, six blocks per page'),
    sample('grid-flashcard-sheet', 'A flashcard sheet', 'grid', 'a printable flashcard sheet, 8 cards per page, term on each card, for Spanish vocabulary'),
    sample('grid-bingo-card-maker', 'A bingo card maker', 'grid', 'bingo card maker: 5 by 5 squares with a free space in the middle, a title on top, different card for each player'),
    sample('grid-comic-page', 'A comic page', 'grid', 'a comic page with panels I can arrange, some panels big, with speech bubbles, then print it'),
    sample('grid-sticker-sheet', 'A sticker sheet', 'grid', 'a sticker sheet for classroom rewards, A4, 3 across'),
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
    KINDS[s.kind].parse(call.arguments, s)
    return null
  }),
}
