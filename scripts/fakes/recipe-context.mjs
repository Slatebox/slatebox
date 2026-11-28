// A recipe's context for its own tests (builders of enterprise/recipes/<id>, MIT test support):
// the real createRecipeContext (enterprise/server/recipes/context.mjs) over an in-memory store,
// with recorded vendor sessions, canned agent answers and a fixed clock.
//   const { ctx, log, emitted, aiCalls, ledger } = createFakeRecipeContext({ manifest, config, vendor: { github }, ai: [answers…] })
//   const out = await recipe.run(ctx)
// Run with: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-<id>.test.mjs
import { createRecipeContext } from '../../enterprise/server/recipes/context.mjs'
import { budgetLimits, createBudget } from '../../enterprise/server/recipes/budgets.mjs'
import { createRecipeAI } from '../../enterprise/server/recipes/metering.mjs'
import { createRecipeStore } from '../../enterprise/server/recipes/store.mjs'
import { createMemoryDb } from './mongo-memory.mjs'

export function createFakeRecipeContext({
  manifest, config = {}, cursor = {}, trigger = { kind: 'manual' }, mode = 'run', vendor = {}, ai = [], now = Date.UTC(2026, 10, 27, 12),
  instanceId = 'inst1', projectId = 'proj1', ownerId = 'owner1', slates = {}, mermaid = {}, budget: limits = null, retentionDays = 180,
} = {}) {
  const db = createMemoryDb()
  const store = createRecipeStore((name) => db[name])
  let clockAt = now
  const clock = () => clockAt
  const budget = createBudget(limits || budgetLimits(manifest?.cost?.class || 'medium'))
  const answers = Array.isArray(ai) ? [...ai] : []
  const aiCalls = []
  const complete = async (request) => {
    aiCalls.push(request)
    const next = typeof ai === 'function' ? await ai(request) : answers.shift()
    if (next instanceof Error) throw next
    return { json: next ?? null, tokensIn: Math.ceil(request.prompt.length / 4), tokensOut: 200 }
  }
  const instance = { _id: instanceId, recipeId: manifest?.id || 'test', projectId, ownerId, name: manifest?.label || 'Test', config, cursor, slateMap: {} }
  const run = { _id: 'run1', trigger, mode }
  const recipeAI = createRecipeAI({ instance, recipeId: instance.recipeId, budget, complete })
  const made = createRecipeContext({
    instance, run, manifest: manifest || { id: 'test', events: [] }, clock, budget, vendors: vendor, ai: recipeAI, store, retentionDays,
    readSlate: async (role, key = '') => slates[key ? `${role}/${key}` : role] || null,
    mermaid: async (slateId) => mermaid[slateId] ?? null,
  })
  return { ...made, aiCalls, budget, store, ledger: store.ledger, advance: (ms) => { clockAt += ms }, refused: () => recipeAI.refused() }
}
