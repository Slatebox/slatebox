/* eslint-disable no-await-in-loop, no-continue */
import assert from 'node:assert/strict'
import {
  AI_PROVIDERS,
  buildProviderBody,
  buildProviderHeaders,
  getProviderEndpoint,
  normalizeProviderResponse,
} from '../server/methods/ai/provider.mjs'
import { resolveAIFeatureConfig } from '../server/methods/ai/feature-config.mjs'
import validateGenerationResponse from '../server/methods/ai/generation-response.mjs'

const apiKey = process.env.API_KEY_DEEP_INFRA
assert.ok(
  apiKey,
  'API_KEY_DEEP_INFRA is required for the live generation evaluation'
)

const feature = resolveAIFeatureConfig('generation')
const model = process.env.DEEPINFRA_MODEL || feature.engine
const respondTool = {
  name: 'respond',
  description: 'Create or update Slatebox mind-map nodes',
  parameters: {
    type: 'object',
    properties: {
      categories: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            id: { type: 'string' },
            parentCategoryIds: {
              type: 'array',
              items: { type: 'string' },
            },
            isUpdate: { type: 'boolean' },
            noun: { type: 'string' },
          },
          required: [
            'description',
            'id',
            'parentCategoryIds',
            'isUpdate',
          ],
        },
      },
      notes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            id: { type: 'string' },
            parentCategoryIds: {
              type: 'array',
              items: { type: 'string' },
            },
            isUpdate: { type: 'boolean' },
            noun: { type: 'string' },
          },
          required: [
            'description',
            'id',
            'parentCategoryIds',
            'isUpdate',
          ],
        },
      },
      suggestion: { type: 'string' },
    },
    required: ['categories', 'notes', 'suggestion'],
  },
}
const system =
  'You are a Slatebox expert collaborator. Build a useful, concise mind map by calling respond exactly once. Categories are major branches and notes are supporting ideas. Use unique ids, attach root categories to main, and keep every note under 30 words.'
const prompt =
  'Create a simple mind map about renewable energy with three major branches. Each branch should have at least one practical supporting note.'

async function runGate(run) {
  const prompts = [{ role: 'user', content: prompt }]
  const startedAt = Date.now()
  const attempts = []

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const body = buildProviderBody({
      provider: AI_PROVIDERS.deepinfra,
      model,
      system,
      prompts,
      functions: [respondTool],
      functionCall: { name: 'respond' },
    })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    const attemptStartedAt = Date.now()
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
    const validationError = validateGenerationResponse(normalized)
    const args = normalized.toolCall?.arguments
    const categoryCount = Array.isArray(args?.categories)
      ? args.categories.length
      : 0
    const noteCount = Array.isArray(args?.notes) ? args.notes.length : 0
    const underproduced = categoryCount < 1 || noteCount < 3
    attempts.push({
      latencyMs: Date.now() - attemptStartedAt,
      validation: validationError?.code || null,
      categoryCount,
      noteCount,
      usage: normalized.usage,
    })

    if ((validationError || underproduced) && attempt < 2) {
      prompts.push({
        role: 'user',
        content:
          validationError?.retryPrompt ||
          'Call respond again with at least one category and three useful notes.',
      })
      continue
    }

    assert.equal(validationError, null)
    assert.equal(categoryCount >= 1, true)
    assert.equal(noteCount >= 3, true)
    assert.equal(categoryCount + noteCount <= 30, true)
    assert.equal(Date.now() - startedAt <= 45000, true)
    return {
      run,
      passed: true,
      latencyMs: Date.now() - startedAt,
      categoryCount,
      noteCount,
      attempts,
    }
  }

  throw new Error(`Generation gate run ${run} did not complete`)
}

const results = []
for (let run = 1; run <= 3; run += 1) {
  results.push(await runGate(run))
}

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
