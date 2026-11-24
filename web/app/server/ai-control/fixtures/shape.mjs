// Test-run samples for custom shapes (surface shape). request() builds what shape-core.mjs sends;
// parses() is its own check (readCandidates, acceptCandidates): at least one usable outline.
import { SHAPE_TOOL, acceptCandidates, readCandidates } from '../../shapes/shape-core.mjs'
import { verdict } from './answer.mjs'

const sample = (id, title, describe) => ({
  id, title,
  values: {
    'shape.system': { count: 3 },
    'shape.user': { describe },
    'shape.retry': { problems: 'open_path', missing: 1 },
  },
})

export default {
  surface: 'shape',
  tool: SHAPE_TOOL.name,
  samples: [
    sample('cloud', 'A cloud with a hole in the middle', 'a cloud with a hole in the middle'),
    sample('arrow', 'An arrow pointing right', 'an arrow pointing right'),
    sample('house', 'A small house with a door', 'a small house with a door'),
  ],
  request: async (_sample, render) => ({
    system: await render('shape.system'),
    prompts: [{ role: 'user', content: [{ type: 'text', text: await render('shape.user') }] }],
    functions: [{ ...SHAPE_TOOL, description: await render('tool.propose_shapes') }],
    function_call: { name: SHAPE_TOOL.name },
    allowPlainText: true,
    maxTokens: 6000,
  }),
  parses: (response) => verdict(() => (acceptCandidates(readCandidates(response)).shapes.length ? null : 'No usable outline came back.')),
}
