// Repro harness: which deepinfra payload shape triggers
// "template error: list object has no element 0" (the Template-Population kickoff failure)
// Usage: node scripts/repro-template-payload.mjs [--live]
import { buildProviderBody } from '../server/methods/ai/provider.mjs'
import { SLATE_OPERATION_TOOL } from 'slateboxjs/operations'

const setIntention = {
  name: 'setIntention',
  description: 'This is your response to the last query',
  parameters: {
    type: 'object',
    properties: {
      intentionId: { type: 'string', description: 'This is the intention id of the intention they have chosen.' },
      background: {
        type: 'object',
        properties: {
          baseColor: { type: 'string', description: 'hex base color via color psychology' },
          gradientLength: { type: 'number', description: 'number of shades' },
          radialOrLinear: { type: 'string', description: 'gradient or linear' },
        },
        required: ['baseColor', 'gradientLength', 'radialOrLinear'],
      },
      instructions: { type: 'string', minLength: 1000, description: 'detailed instructions' },
    },
    required: ['intentionId', 'instructions'],
  },
}

const TOOL = {
  name: 'respond',
  description: 'respond with notes',
  parameters: {
    type: 'object',
    properties: { notes: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' } } } } },
  },
}

const REAL_TOOLS = [
  SLATE_OPERATION_TOOL,
  setIntention,
  {
    name: 'previewTemplate',
    description: 'Preview a specific template',
    parameters: {
      type: 'object',
      properties: { slateTemplateId: { type: 'string', description: 'Provide the shareId of the template if applicable.' } },
      required: ['slateTemplateId'],
    },
  },
  {
    name: 'expandTemplates',
    description: 'Get all the available templates',
    parameters: {
      type: 'object',
      properties: { expand: { type: 'boolean', description: 'Set to true when the user wants to see all the available templates.' } },
      required: ['expand'],
    },
  },
]

const shapes = {
  plain: {
    prompts: [{ role: 'user', content: 'Please populate the template with notes about pro/con lists.' }],
  },
  toolHistoryText: {
    // deepinfra flattening turns these parts into plain text
    prompts: [
      { role: 'user', content: "I'd like to make a slate: Pro/Con list for platform choice" },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_f29e', name: 'setIntention', input: { intentionId: 'sSdfQkbvvFZDsMB7r', instructions: 'two columns...' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_f29e', content: 'intention ok' }] },
      { role: 'user', content: 'Now populate the template. Use the respond function.' },
    ],
  },
  templateKick: {
    // closer to the real failing call: function_call forced + history w/ tool parts
    prompts: [
      { role: 'system', content: 'You are the template assistant. Call respond with the notes.' },
      { role: 'user', content: "I'd like to make a slate: Pro/Con list for platform choice" },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_f29e', name: 'setIntention', input: { intentionId: 'sSdfQkbvvFZDsMB7r' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_f29e', content: 'template intention engaged' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Got it — building that now.' }] },
      { role: 'user', content: 'Populate the template now with the respond function.' },
    ],
    functionCall: { name: 'respond' },
    functions: [TOOL],
  },
  realTools: {
    prompts: [
      { role: 'user', content: 'I would like to create a slate using the Pro/Con list for platform choice template. {{templateMarkdown}} Here is the template: | Pros | Cons | …' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_f29e', name: 'setIntention', input: { intentionId: 'sSdfQkbvvFZDsMB7r', instructions: 'two columns…'.repeat(3) } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_f29e', content: 'template intention engaged' }] },
      { role: 'user', content: 'Now populate the template.' },
    ],
    functionCall: { name: 'setIntention' },
    functions: REAL_TOOLS,
  },
  realToolsBigRider: {
    prompts: [
      { role: 'user', content: 'Pro/Con list for platform choice\n\n(Note - the above is the actual user message… Current slate state: ' + JSON.stringify({ nodes: Array.from({ length: 40 }, (_, i) => ({ id: 'n' + i, type: 'text', x: i * 100, y: i * 50, w: 120, h: 80, text: 'Node ' + i })), connections: Array.from({ length: 20 }, (_, i) => ({ id: 'c' + i, source: 'n' + i, target: 'n' + (i + 1) })) }) + '\n\n\nfake token test' },
    ],
    functionCall: { name: 'setIntention' },
    functions: REAL_TOOLS,
  },
}
const live = process.argv.includes('--live')
const key = process.env.DEEPINFRA_KEY
if (live && !key) {
  console.error('set DEEPINFRA_KEY for --live')
  process.exit(1)
}


for (const [name, cfg] of Object.entries(shapes)) {
  const body = buildProviderBody({
    provider: 'deepinfra',
    model: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    prompts: cfg.prompts,
    system: name === 'plain' ? 'You are the template assistant.' : undefined,
    functions: cfg.functions,
    functionCall: cfg.functionCall,
    userId: 'repro',
  })
  console.log(`\n=== ${name}: ${body.messages.length} message(s)`)
  body.messages.forEach((m, i) => console.log(`  [${i}] ${m.role} (${m.content.length}b)${m.tool_calls ? ' +tool_calls' : ''}`))
  if (!live) {
    if (name.startsWith('realTools')) {
      console.log('  (dry: message counts only; run --live to probe)')
    }
    continue
  }
  if (!name.startsWith('realTools')) continue // plain/toolHistory/templateKick already verified 200
  const res = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, max_tokens: 8, max_completion_tokens: 8 }),
  })
  const text = await res.text()
  console.log(`  LIVE => ${res.status} ${text.slice(0, 160)}`)
}
