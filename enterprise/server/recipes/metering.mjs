// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The agent work a recipe asks for, metered like every other agent feature: one metered action per
// run (feature 'recipes', detached: no person waits on it), billed the owner's normal way: their
// own key when they set one, else their allowance or credits on Slatebox Cloud; a self-hosted
// install's admin keys, with no meter. The model is AI control's settings.ai.use.recipes (falling
// back to connectors, then the default) and each prompt is the registry prompt
// recipes.<recipeId>.<purpose>, editable in Admin › AI › Prompts.
// A refusal (no allowance left, the meter off for this person, a provider's no) makes ctx.ai.json
// answer null: the run keeps its deterministic part and ends partial (ai_refused).
import { BudgetExceeded } from './budgets.mjs'

export const AI_FEATURE = 'recipes'
export const PROMPT_ID = (recipeId, purpose) => `recipes.${recipeId}.${purpose}`
export const AI_CALL_LIMITS = Object.freeze({ maxIn: 16000, maxOut: 4000, purpose: /^[a-z][a-z0-9_-]{0,40}$/ })

/** Runs fn inside one metered action for the instance's owner (runAIAction from server/metering/context.mjs). */
export const withRecipeAI = (runAIAction) => (instance, fn) =>
  runAIAction({ feature: AI_FEATURE, userId: instance.ownerId, detached: true, countsAsDraft: false }, fn)

// A rough token count for budgeting before the call (4 characters a token).
export const estimateTokens = (text) => Math.ceil(String(text || '').length / 4)

/**
 * ctx.ai for one run.
 *   complete({ promptId, purpose, prompt, schema, maxOut, userId, signal }) → { json, tokensIn, tokensOut }
 *     the model call (meteor.js: req with the recipes feature); throws on refusal
 *   budget   the run's budget (budgets.mjs)
 *   onRefused(code)  the run ends partial with this reason
 */
export function createRecipeAI({ instance, recipeId, budget, complete, signal = null, onRefused = () => {}, log = () => {} }) {
  let refused = null
  async function json({ prompt, schema, maxIn = AI_CALL_LIMITS.maxIn, maxOut = 2000, purpose }) {
    if (refused) return null
    if (typeof purpose !== 'string' || !AI_CALL_LIMITS.purpose.test(purpose)) throw new Error('ctx.ai.json needs a purpose (lowercase words)')
    if (!schema || typeof schema !== 'object') throw new Error('ctx.ai.json needs the answer\'s schema')
    // A prompt is text or plain data (names, lists): data goes to the model as JSON, never as
    // "[object Object]".
    const input = typeof prompt === 'string' ? prompt : prompt == null ? '' : JSON.stringify(prompt)
    const cappedIn = Math.min(maxIn, AI_CALL_LIMITS.maxIn)
    const text = estimateTokens(input) > cappedIn ? input.slice(0, cappedIn * 4) : input
    const outCap = Math.min(maxOut, AI_CALL_LIMITS.maxOut)
    const estimate = estimateTokens(text)
    if (!budget.fits('tokensIn', estimate) || !budget.fits('tokensOut', outCap)) {
      refused = 'budget'
      onRefused('budget')
      log('warn', 'ai_budget', 'The run reached its agent budget; it keeps what it has.')
      return null
    }
    try {
      const answer = await complete({ promptId: PROMPT_ID(recipeId, purpose), purpose, prompt: text, schema, maxOut: outCap, userId: instance.ownerId, signal })
      budget.record('tokensIn', answer?.tokensIn ?? estimate)
      budget.record('tokensOut', answer?.tokensOut ?? 0)
      return answer?.json && typeof answer.json === 'object' ? answer.json : null
    } catch (error) {
      if (error instanceof BudgetExceeded) throw error
      if (error?.name === 'AbortError' || signal?.aborted) throw error
      refused = error?.code || 'ai_refused'
      onRefused('ai_refused')
      log('warn', 'ai_refused', 'The agent could not answer; the run keeps what it has.')
      return null
    }
  }
  return { json, refused: () => refused }
}
