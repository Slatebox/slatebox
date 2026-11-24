// Test-run samples for the Slatebox agent (surface agent.slatebox): a task with notes from other
// agents, sent as the canvas conversation sends the agent's request (teammate.mjs requestText).
import { chatPrompts, chatSystemValues } from '../../methods/ai/exec-chat.mjs'
import { oneLine } from '../../agents/teammate.mjs'
import { DRAWING, execWorld } from './exec-world.mjs'
import { execParses } from './canvas.mjs'

const SHARE = 'sample1'
const sample = (id, title, task, notes) => ({
  id, title,
  values: {
    'agent.request.notes': { request: oneLine(task, 500), notes: JSON.stringify(notes) },
    'exec.chat.system': async () => chatSystemValues((await execWorld()).manifest, SHARE),
  },
})

export default {
  surface: 'agent.slatebox',
  tool: 'exec',
  samples: [
    sample('handoff', 'A task with a note from another agent', 'Add a note for the budget beside the venue', [{ by: 'Linear agent', text: 'The budget is 2000 dollars' }]),
    sample('two-notes', 'A task with two notes', 'Group the party notes', [{ by: 'Ana', text: 'Keep it short' }, { by: 'Research agent', text: 'Three venues found' }]),
  ],
  request: async (_s, render) => ({
    sdkChat: true,
    system: await render('exec.chat.system'),
    prompts: chatPrompts({ board: DRAWING, shareId: SHARE, message: await render('agent.request.notes'), history: [] }),
    functions: [(await execWorld()).tool],
    function_call: { name: 'exec' },
    allowPlainText: true,
  }),
  parses: execParses,
}
