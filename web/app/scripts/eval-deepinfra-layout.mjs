import assert from 'node:assert/strict'
import {
  AI_PROVIDERS,
  buildProviderBody,
  buildProviderHeaders,
  getProviderEndpoint,
  normalizeProviderResponse,
} from '../server/methods/ai/provider.mjs'
import { DEFAULT_DEEPINFRA_MODEL } from '../server/methods/ai/deepinfra.mjs'

const apiKey = process.env.API_KEY_DEEP_INFRA
assert.ok(apiKey, 'API_KEY_DEEP_INFRA is required for the live layout evaluation')

const model = process.env.DEEPINFRA_MODEL || DEFAULT_DEEPINFRA_MODEL
const layoutTool = {
  name: 'updateLayout',
  description:
    'Return movement deltas for every node so the resulting layout has no overlap',
  parameters: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            x: {
              type: 'number',
              description:
                'Movement delta in pixels on the x-axis, not the final x coordinate',
            },
            y: {
              type: 'number',
              description:
                'Movement delta in pixels on the y-axis, not the final y coordinate',
            },
            id: {
              type: 'string',
              description: 'The unchanged nodeId from the input layout',
            },
          },
          required: ['x', 'y', 'id'],
        },
      },
    },
    required: ['nodes'],
  },
}

const fixtures = [
  {
    name: 'three-overlapping-cards',
    nodes: [
      { nodeId: 'alpha', x: 100, y: 100, width: 240, height: 120 },
      { nodeId: 'beta', x: 180, y: 140, width: 240, height: 120 },
      { nodeId: 'gamma', x: 250, y: 175, width: 240, height: 120 },
    ],
  },
  {
    name: 'mixed-overlap-and-clear-node',
    nodes: [
      { nodeId: 'north', x: 0, y: 0, width: 180, height: 100 },
      { nodeId: 'center', x: 90, y: 40, width: 180, height: 100 },
      { nodeId: 'east', x: 520, y: 40, width: 180, height: 100 },
      { nodeId: 'south', x: 120, y: 80, width: 180, height: 100 },
    ],
  },
]

function overlaps(a, b, gap = 8) {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  )
}

function countCollisions(nodes) {
  let collisions = 0
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      if (overlaps(nodes[first], nodes[second])) collisions += 1
    }
  }
  return collisions
}

function findCollisions(nodes) {
  const collisions = []
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      if (overlaps(nodes[first], nodes[second])) {
        collisions.push([nodes[first].nodeId, nodes[second].nodeId])
      }
    }
  }
  return collisions
}

async function evaluateFixture(fixture) {
  const body = buildProviderBody({
    provider: AI_PROVIDERS.deepinfra,
    model,
    system:
      'You are a layout architect. Analyze every rectangle and call updateLayout exactly once. For every input node, return its id and numeric x and y movement deltas, not final coordinates. A delta of 0 keeps that axis unchanged. Mentally add each delta to the original coordinate and verify every resulting rectangle has at least 8 pixels of clearance from every other rectangle. Preserve the composition and move nodes only as much as necessary. Do not omit nodes.',
    prompts: [
      {
        role: 'user',
        content: `Return movement deltas for this layout: ${JSON.stringify(
          fixture.nodes
        )}`,
      },
    ],
    functions: [layoutTool],
    functionCall: { name: layoutTool.name },
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
  assert.equal(fetchResponse.ok, true, `DeepInfra returned ${fetchResponse.status}`)
  const normalized = normalizeProviderResponse({
    provider: AI_PROVIDERS.deepinfra,
    response,
  })
  const updates = normalized.toolCall?.arguments?.nodes
  assert.ok(Array.isArray(updates), 'updateLayout did not return a nodes array')

  const expectedIds = fixture.nodes.map((node) => node.nodeId).sort()
  const actualIds = updates.map((node) => node.id).sort()
  assert.deepEqual(actualIds, expectedIds, 'updateLayout returned the wrong node IDs')
  assert.equal(
    updates.every(
      (node) => Number.isFinite(node.x) && Number.isFinite(node.y)
    ),
    true,
    'updateLayout returned a non-numeric movement delta'
  )

  const deltas = new Map(updates.map((node) => [node.id, node]))
  const result = fixture.nodes.map((node) => ({
    ...node,
    x: node.x + deltas.get(node.nodeId).x,
    y: node.y + deltas.get(node.nodeId).y,
  }))
  const collisions = findCollisions(result)
  const collisionCount = countCollisions(result)
  assert.equal(
    collisionCount,
    0,
    `updated layout still contains collisions: ${JSON.stringify({
      updates,
      collisions,
    })}`
  )

  return {
    fixture: fixture.name,
    latencyMs: Date.now() - startedAt,
    collisionCount,
    usage: normalized.usage,
  }
}

const results = await Promise.all(fixtures.map(evaluateFixture))

console.log(
  JSON.stringify(
    {
      provider: AI_PROVIDERS.deepinfra,
      model,
      passed: true,
      results,
    },
    null,
    2
  )
)
