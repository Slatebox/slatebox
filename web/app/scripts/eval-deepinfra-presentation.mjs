import assert from 'node:assert/strict'
import {
  AI_PROVIDERS,
  buildProviderBody,
  buildProviderHeaders,
  getProviderEndpoint,
  normalizeProviderResponse,
} from '../server/methods/ai/provider.mjs'
import { resolveAIFeatureConfig } from '../server/methods/ai/feature-config.mjs'

const apiKey = process.env.API_KEY_DEEP_INFRA
assert.ok(
  apiKey,
  'API_KEY_DEEP_INFRA is required for the live presentation evaluation'
)

const feature = resolveAIFeatureConfig('presentation')
const model = process.env.DEEPINFRA_MODEL || feature.engine
const knownNodeIds = ['root', 'research', 'prototype', 'launch']
const presentationData = [
  {
    nodeId: 'root',
    description: 'A practical product journey',
    childrenNodes: ['research', 'prototype', 'launch'],
  },
  { nodeId: 'research', description: 'Understand the audience' },
  { nodeId: 'prototype', description: 'Test the central interaction' },
  { nodeId: 'launch', description: 'Ship, measure, and improve' },
]
const createPresentation = {
  name: 'createPresentation',
  description: 'Create a narrative presentation from Slatebox nodes',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      viewpoints: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'object',
          properties: {
            nodeIds: {
              type: 'array',
              items: { type: 'string', enum: knownNodeIds },
              minItems: 1,
            },
            narrative: { type: 'string' },
            duration: { type: 'number', minimum: 500, maximum: 10000 },
          },
          required: ['nodeIds', 'narrative', 'duration'],
        },
      },
    },
    required: ['name', 'description', 'viewpoints'],
  },
}

const body = buildProviderBody({
  provider: AI_PROVIDERS.deepinfra,
  model,
  system:
    'You are a concise presentation storyteller. Build a coherent opening, progression, and conclusion using only node IDs from the supplied Slatebox data. Call createPresentation exactly once.',
  prompts: [
    {
      role: 'user',
      content: `Create a short presentation from this Slatebox data: ${JSON.stringify(
        presentationData
      )}`,
    },
  ],
  functions: [createPresentation],
  functionCall: { name: createPresentation.name },
})

const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 90000)
const startedAt = Date.now()
let fetchResponse
try {
  fetchResponse = await fetch(getProviderEndpoint(AI_PROVIDERS.deepinfra), {
    method: 'POST',
    headers: buildProviderHeaders({
      provider: AI_PROVIDERS.deepinfra,
      apiKey,
    }),
    body: JSON.stringify(body),
    signal: controller.signal,
  })
} finally {
  clearTimeout(timeout)
}

const response = await fetchResponse.json()
assert.equal(
  fetchResponse.ok,
  true,
  `DeepInfra returned ${fetchResponse.status}`
)
const normalized = normalizeProviderResponse({
  provider: AI_PROVIDERS.deepinfra,
  response,
})
const plan = normalized.toolCall?.arguments
assert.equal(normalized.toolCall?.name, 'createPresentation')
assert.equal(typeof plan?.name, 'string')
assert.equal(typeof plan?.description, 'string')
assert.equal(Array.isArray(plan?.viewpoints), true)
assert.equal(plan.viewpoints.length >= 2, true)
assert.equal(
  plan.viewpoints.every(
    (viewpoint) =>
      viewpoint.nodeIds.length > 0 &&
      viewpoint.nodeIds.every((nodeId) => knownNodeIds.includes(nodeId)) &&
      typeof viewpoint.narrative === 'string' &&
      viewpoint.narrative.length > 0 &&
      Number.isFinite(viewpoint.duration)
  ),
  true
)

console.log(
  JSON.stringify(
    {
      provider: AI_PROVIDERS.deepinfra,
      model,
      passed: true,
      latencyMs: Date.now() - startedAt,
      viewpointCount: plan.viewpoints.length,
      usage: normalized.usage,
    },
    null,
    2
  )
)
