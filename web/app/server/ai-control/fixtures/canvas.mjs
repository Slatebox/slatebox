// Test-run samples for the canvas conversation (surface canvas), as exec-chat.mjs sends them: the
// exec tool, the instructions with the registry's rules and declarations, and the request. The
// program the model writes is never run here; parses() checks it is an exec call with code (or a
// short reply), as the conversation's own check does.
import { chatPrompts, chatSystemValues } from '../../methods/ai/exec-chat.mjs'
import { textOf, toolCallOf, verdict } from './answer.mjs'
import { DRAWING, execWorld } from './exec-world.mjs'

const SHARE = 'sample1'
const sample = (id, title, message) => ({
  id, title, message,
  values: {
    'exec.chat.system': async () => chatSystemValues((await execWorld()).manifest, SHARE),
    'exec.chat.fix': { why: 'invalid_request: expectedRevision is required (line 2)', shareId: SHARE },
  },
})

export const execParses = (response) => verdict(() => {
  const call = toolCallOf(response)
  if (!call) {
    const reply = textOf(response).trim()
    return reply && reply.length <= 1200 ? null : 'Neither an exec call nor a short reply came back.'
  }
  if (call.name !== 'exec') return `It called ${call.name}, not exec.`
  return typeof call.arguments?.code === 'string' && call.arguments.code.trim() ? null : 'The exec call has no code.'
})

export default {
  surface: 'canvas',
  tool: 'exec',
  samples: [
    sample('add-ideas', 'Add three ideas beside a note', 'add three ideas for a theme beside spring party'),
    sample('connect', 'Connect two notes', 'connect spring party to book a venue'),
  ],
  request: async (s, render) => ({
    sdkChat: true,
    system: await render('exec.chat.system'),
    prompts: chatPrompts({ board: DRAWING, shareId: SHARE, message: s.message, history: [] }),
    functions: [(await execWorld()).tool],
    function_call: { name: 'exec' },
    allowPlainText: true,
  }),
  parses: execParses,
}
