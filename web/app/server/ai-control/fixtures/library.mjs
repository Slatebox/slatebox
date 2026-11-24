// Test-run samples for library review (surface library), as refine-ai.mjs sends a turn. parses()
// checks the answer is the propose_library_refinement tool with a reply, as refine does.
import { REFINE_TOOL_NAME, readRefinement, refineData, refineTool, refineValues } from '../../library/refine-ai.mjs'
import { toolCallOf, verdict } from './answer.mjs'

const BOARD = { version: 1, title: 'Pick a venue', lanes: [{ id: 'ideas', label: 'Ideas' }, { id: 'shortlist', label: 'Shortlist', capacity: 2 }],
  cards: [{ id: 'hall', label: 'Town hall', laneId: 'ideas' }, { id: 'barn', label: 'Old barn', laneId: 'ideas' }] }
const COMPONENT = { kind: 'component', title: 'Venue picker', summary: 'Pick a venue with the team', description: 'Lanes for venue ideas and a shortlist of two.', category: 'decide', synonyms: ['venue'], authorName: 'Ana' }
const SLATE = { kind: 'slate', title: 'Team retro', summary: 'What went well and what to change', synonyms: ['retro'], authorName: 'Bo' }

const sample = (id, title, item, board, message) => ({
  id, title, item, board, message,
  values: {
    'library.refine.system': refineValues(item, board),
    'library.refine.request': refineData({ item, board, message }),
  },
})

export default {
  surface: 'library',
  tool: REFINE_TOOL_NAME,
  samples: [
    sample('component', 'A smart component with a board', COMPONENT, BOARD, 'Tighten the rules'),
    sample('locked', 'A component whose category is locked', { ...COMPONENT, categoryLocked: true }, BOARD, 'Write a clearer one-line summary'),
    sample('slate', 'A slate', SLATE, null, 'Suggest better search words'),
  ],
  request: async (s, render) => ({
    sdkChat: true,
    system: await render('library.refine.system'),
    prompts: [{ role: 'user', content: await render('library.refine.request') }],
    functions: [{ ...refineTool(s.item, s.board), description: await render('tool.propose_library_refinement') }],
    function_call: { name: REFINE_TOOL_NAME },
  }),
  parses: (response) => verdict(() => {
    const call = toolCallOf(response)
    if (call?.name !== REFINE_TOOL_NAME) return `It did not call ${REFINE_TOOL_NAME}.`
    return readRefinement(call.arguments)?.reply ? null : 'The answer has no reply.'
  }),
}
