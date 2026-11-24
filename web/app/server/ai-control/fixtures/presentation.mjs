// Test-run samples for presentation planning (surface presentation), as presentations.js sends a
// plan: the system text for the kind of slate, the request with the slate, a brief or a refinement,
// and the createPresentation tool. parses() checks the plan has segments of notes on the slate.
import { PLAN_OUTPUT_TOKENS, PLAN_PART_VALUES, planFunctions, slateValues } from '../../methods/presentationRequest.mjs'
import { toolCallOf, verdict } from './answer.mjs'

export const LAYOUT = { nodes: [
  { nodeId: 'n1', description: 'Spring launch', metrics: { rotation: 0, bbox: { x: 0, y: 0, width: 200, height: 80 } }, childrenNodes: [
    { nodeId: 'n2', description: 'Book the hall', metrics: { rotation: 0, bbox: { x: 260, y: 0, width: 160, height: 60 } }, childrenNodes: [] },
    { nodeId: 'n3', description: 'Invite 50 people', metrics: { rotation: 0, bbox: { x: 260, y: 120, width: 160, height: 60 } }, childrenNodes: [] },
  ] },
  { nodeId: 'n4', description: 'Budget: 2,000 dollars', metrics: { rotation: 0, bbox: { x: 0, y: 200, width: 160, height: 60 } }, childrenNodes: [] },
] }
const IDS = ['n1', 'n2', 'n3', 'n4']

const parts = async (render) => ({ segments: await render('presentation.segments'), art: await render('presentation.art') })
const values = (extra = {}) => ({
  'presentation.segments': PLAN_PART_VALUES.segments,
  'presentation.art': PLAN_PART_VALUES.art,
  'presentation.system': parts,
  'presentation.system.dynamic': parts,
  'presentation.system.slides': parts,
  'presentation.system.template': parts,
  'presentation.slate': slateValues(LAYOUT),
  'presentation.user': async (render) => ({ slate: await render('presentation.slate'), isTemplate: Boolean(extra.template), hasScenes: false, scenes: '' }),
  'presentation.brief': async (render) => ({ request: await render('presentation.user'), brief: JSON.stringify(extra.brief || '') }),
  'presentation.refine': async (render) => ({ message: extra.refine || '', slateChanged: true, slate: await render('presentation.slate') }),
})
const sample = (id, title, extra) => ({ id, title, ...extra, values: values(extra) })

export default {
  surface: 'presentation',
  tool: 'createPresentation',
  samples: [
    sample('launch', 'A small launch plan', {}),
    sample('dynamic', 'A dynamic, visual slate', { system: 'presentation.system.dynamic' }),
    sample('slides', 'A slate laid out like slides', { system: 'presentation.system.slides' }),
    sample('template', 'A slate made from a template', { system: 'presentation.system.template', template: true }),
    sample('brief', 'With the presenter\'s brief', { brief: 'Focus on the budget' }),
    sample('refine', 'A refinement of an earlier plan', { refine: 'Make it three segments' }),
  ],
  request: async (s, render) => {
    const user = s.brief ? await render('presentation.brief') : await render('presentation.user')
    const init = { role: 'user', content: [{ type: 'text', text: user }] }
    const prompts = s.refine
      ? [init, { role: 'assistant', content: 'An earlier plan.' }, { role: 'user', content: [{ type: 'text', text: await render('presentation.refine') }] }]
      : [init]
    const texts = {}
    for (const id of ['tool.create-presentation', 'tool.create-presentation.image-query', 'tool.create-presentation.image-prompt', 'tool.create-presentation.image-why']) texts[id] = await render(id)
    return {
      system: await render(s.system || 'presentation.system'),
      prompts,
      functions: planFunctions((id) => texts[id]),
      function_call: { name: 'createPresentation' },
      maxTokens: PLAN_OUTPUT_TOKENS,
    }
  },
  parses: (response) => verdict(() => {
    const call = toolCallOf(response)
    const plan = call?.arguments || response?.json
    if (!Array.isArray(plan?.segments) || !plan.segments.length) return 'No segments came back.'
    const onSlate = plan.segments.some((segment) => (segment?.nodeIds || []).some((id) => IDS.includes(String(id))))
    return onSlate ? null : 'No segment names a note on the slate.'
  }),
}
