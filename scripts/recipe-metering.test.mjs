// ctx.ai.json (enterprise/server/recipes/metering.mjs): what reaches the model.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-metering.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRecipeAI } from '../enterprise/server/recipes/metering.mjs'
import { createBudget, budgetLimits } from '../enterprise/server/recipes/budgets.mjs'

const SCHEMA = { type: 'object', properties: { label: { type: 'string' } } }

test('a prompt given as data reaches the model as JSON, never as "[object Object]"', async () => {
  const seen = []
  const ai = createRecipeAI({
    instance: { ownerId: 'u1' },
    recipeId: 'github-architecture',
    budget: createBudget(budgetLimits('low')),
    complete: async (call) => {
      seen.push(call.prompt)
      return { json: { label: 'Ledger' }, tokensIn: 10, tokensOut: 5 }
    },
  })
  assert.deepEqual(await ai.json({ purpose: 'module_label', schema: SCHEMA, prompt: { module: 'ledger', files: ['a.ts', 'b.ts'] } }), { label: 'Ledger' })
  await ai.json({ purpose: 'module_label', schema: SCHEMA, prompt: 'plain text' })
  assert.deepEqual(seen, ['{"module":"ledger","files":["a.ts","b.ts"]}', 'plain text'])
})
