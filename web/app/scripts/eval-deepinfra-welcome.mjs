/* eslint-disable no-await-in-loop, no-continue */
import assert from 'node:assert/strict'
import {
  AI_PROVIDERS,
  buildProviderBody,
  normalizeProviderResponse,
} from '../server/methods/ai/provider.mjs'
import { DEEPINFRA_ENDPOINT, deepinfraHeaders, evalFeature } from './eval-deepinfra-wire.mjs'

const apiKey = process.env.API_KEY_DEEP_INFRA
assert.ok(
  apiKey,
  'API_KEY_DEEP_INFRA is required for the live welcome evaluation'
)

const feature = evalFeature('welcome')
const model = process.env.DEEPINFRA_MODEL || feature.engine
const intentionIds = {
  default: 'expert-collaborator',
  presentation: 'dynamic-presentation',
  infographic: 'infographic-architect',
  template: 'guided-template',
}
const system = `You are the Slatebox Welcome Assistant. Help users choose what kind of visual slate to create without using the word intention. Keep conversational replies between 10 and 20 words. Available approaches and their exact intention IDs are: mind maps and diagrams (${intentionIds.default}), presentations (${intentionIds.presentation}), infographics (${intentionIds.infographic}), and template whiteboards (${intentionIds.template}). Never invent IDs. If a request ends in !!, immediately call setIntention with the matching ID, a suitable background, all known intentionItems, and at least 150 words of detailed implementation instructions. Otherwise ask concise questions only when required information is missing. When users ask to see all templates, call expandTemplates. Call each tool at most once.`

const functions = [
  {
    name: 'setIntention',
    description: 'Start the selected Slatebox creation approach',
    parameters: {
      type: 'object',
      properties: {
        intentionId: { type: 'string', enum: Object.values(intentionIds) },
        background: {
          type: 'object',
          properties: {
            baseColor: { type: 'string' },
            gradientLength: { type: 'number' },
            radialOrLinear: { type: 'string', enum: ['gradient', 'linear'] },
          },
          required: ['baseColor', 'gradientLength', 'radialOrLinear'],
        },
        instructions: {
          type: 'string',
          minLength: 1000,
          description:
            'At least 150 words covering structure, content, hierarchy, visual treatment, relationships, and constraints.',
        },
        intentionItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['key', 'value'],
          },
        },
      },
      required: ['intentionId', 'background', 'instructions', 'intentionItems'],
    },
  },
  {
    name: 'expandTemplates',
    description: 'List all available Slatebox templates',
    parameters: {
      type: 'object',
      properties: { expand: { type: 'boolean' } },
      required: ['expand'],
    },
  },
]

const fixtures = [
  {
    name: 'immediate-presentation',
    message:
      'Create a pitch deck for a neighborhood solar marketplace aimed at city partners!!',
    expectedTool: 'setIntention',
    expectedIntentionId: intentionIds.presentation,
    maxLatencyMs: 45000,
  },
  {
    name: 'template-discovery',
    message: 'Show me all the whiteboard templates.',
    expectedTool: 'expandTemplates',
    maxLatencyMs: 10000,
  },
  {
    name: 'capability-question',
    message: 'What kinds of things can I make here?',
    expectedTool: null,
    maxLatencyMs: 8000,
  },
]

async function evaluateFixture(fixture) {
  const prompts = [
    { role: 'system', content: system },
    { role: 'user', content: fixture.message },
  ]
  const startedAt = Date.now()
  const attempts = []

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const body = buildProviderBody({
      provider: AI_PROVIDERS.deepinfra,
      model,
      prompts,
      functions,
      functionCall:
        fixture.expectedTool === 'setIntention'
          ? { name: 'setIntention' }
          : { type: 'auto' },
    })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)
    const attemptStartedAt = Date.now()
    let fetchResponse
    try {
      fetchResponse = await fetch(DEEPINFRA_ENDPOINT, {
        method: 'POST',
        headers: deepinfraHeaders(apiKey),
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
    const attemptLatencyMs = Date.now() - attemptStartedAt
    attempts.push({
      latencyMs: attemptLatencyMs,
      tool: normalized.toolCall?.name || null,
      usage: normalized.usage,
    })

    assert.equal(normalized.toolCall?.name || null, fixture.expectedTool)

    if (fixture.expectedTool === 'setIntention') {
      const args = normalized.toolCall.arguments
      const instructionWordCount = args.instructions.trim().split(/\s+/).length
      if (instructionWordCount < 150 && attempt < 2) {
        prompts.push({
          role: 'user',
          content: `Call setIntention again. Its instructions contained ${instructionWordCount} words, but Slatebox requires at least 150. Return a detailed 150 to 220 word implementation brief.`,
        })
        continue
      }

      assert.equal(args.intentionId, fixture.expectedIntentionId)
      assert.equal(typeof args.background?.baseColor, 'string')
      assert.equal(Array.isArray(args.intentionItems), true)
      assert.equal(
        instructionWordCount >= 150,
        true,
        `setIntention instructions contained ${instructionWordCount} words`
      )
    } else if (fixture.expectedTool === 'expandTemplates') {
      assert.equal(normalized.toolCall.arguments.expand, true)
    } else {
      assert.equal(typeof normalized.message?.content, 'string')
      const wordCount = normalized.message.content.trim().split(/\s+/).length
      assert.equal(wordCount >= 3 && wordCount <= 50, true)
    }

    const latencyMs = Date.now() - startedAt
    assert.equal(
      latencyMs <= fixture.maxLatencyMs,
      true,
      `${fixture.name} took ${latencyMs}ms; limit is ${fixture.maxLatencyMs}ms`
    )

    return {
      fixture: fixture.name,
      passed: true,
      latencyMs,
      tool: normalized.toolCall?.name || null,
      usage: normalized.usage,
      attempts,
    }
  }

  throw new Error(`Unable to complete ${fixture.name}`)
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
