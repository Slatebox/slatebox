import assert from 'node:assert/strict'
import { DEEPINFRA_ENDPOINT, deepinfraHeaders } from './eval-deepinfra-wire.mjs'
import { SLATE_OPERATION_TOOL } from 'slateboxjs/operations'
import { validateSlateMessageRoute } from '../server/methods/ai/welcome-response.mjs'
import {
  AI_PROVIDERS,
  buildProviderBody,
  normalizeProviderResponse,
} from '../server/methods/ai/provider.mjs'

const apiKey = process.env.API_KEY_DEEP_INFRA
assert.ok(
  apiKey,
  'API_KEY_DEEP_INFRA is required for the live slate route evaluation'
)
const model =
  process.env.DEEPINFRA_MODEL || 'Qwen/Qwen3-235B-A22B-Instruct-2507'
const userMessage = '3 triangles, to the right of the welcome node'
const currentSlate = {
  name: 'New Slate',
  nodeCount: 2,
  nodes: [
    {
      id: 'welcome-node',
      text: 'Welcome!',
      shape: 'roundedrectangle',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    },
    {
      id: 'flower-node',
      text: 'Node wrgpblg4h',
      shape: 'star',
      x: 100,
      y: 450,
      width: 200,
      height: 100,
    },
  ],
}
const delegateTool = {
  name: 'delegateToConversation',
  description:
    'Use only when the user is not requesting a concrete slate edit.',
  parameters: {
    type: 'object',
    properties: { reason: { type: 'string' } },
    required: ['reason'],
  },
}
const body = buildProviderBody({
  provider: AI_PROVIDERS.deepinfra,
  model,
  system: `Route the latest user message. Call applySlateOperations only for a concrete edit to the existing slate. Resolve references to supplied node ids. Preserve all unrequested content and styling. Never turn the user's request into a node. Never change theme, canvas background, or slate metadata unless explicitly requested. For discussion or content generation, call delegateToConversation. Current slate: ${JSON.stringify(
    currentSlate
  )}`,
  prompts: [
    { role: 'user', content: 'Can you add three nodes?' },
    {
      role: 'assistant',
      content: 'Sure — what shape and where should I put them?',
    },
    { role: 'user', content: userMessage },
  ],
  functions: [SLATE_OPERATION_TOOL, delegateTool],
  functionCall: { type: 'auto' },
})

const startedAt = Date.now()
const response = await fetch(DEEPINFRA_ENDPOINT, {
  method: 'POST',
  headers: deepinfraHeaders(apiKey),
  body: JSON.stringify(body),
})
const payload = await response.json()
assert.equal(response.ok, true, `DeepInfra returned ${response.status}`)
const normalized = normalizeProviderResponse({
  provider: AI_PROVIDERS.deepinfra,
  response: payload,
})
assert.equal(normalized.toolCall?.name, 'applySlateOperations')
const plan = normalized.toolCall.arguments
const validation = validateSlateMessageRoute(
  { toolCall: normalized.toolCall },
  {
    userMessage,
    existingNodeIds: currentSlate.nodes.map((node) => node.id),
  }
)
assert.equal(validation, null, validation?.retryPrompt)
const additions = plan.operations.filter(
  (operation) => operation.kind === 'add_nodes'
)
assert.equal(
  additions.reduce((total, operation) => total + operation.count, 0),
  3,
  'the route must add exactly three nodes'
)
assert.equal(
  additions.every(
    (operation) =>
      operation.shape === 'triangle' &&
      operation.placement?.relativeTo === 'welcome-node' &&
      operation.placement?.direction === 'right'
  ),
  true,
  'every addition must be a triangle to the right of the Welcome node'
)
assert.equal(
  plan.operations.some((operation) => operation.kind === 'update_slate'),
  false,
  'the route must not change the slate theme or metadata'
)

console.log(
  JSON.stringify(
    {
      provider: AI_PROVIDERS.deepinfra,
      model,
      passed: true,
      latencyMs: Date.now() - startedAt,
      operationCount: plan.operations.length,
      usage: normalized.usage,
    },
    null,
    2
  )
)
