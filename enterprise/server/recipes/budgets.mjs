// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What one run may spend: vendor calls, model tokens in and out, and canvas operations. Every call
// through ctx.vendor and ctx.ai is counted here; past a limit the call is refused (BudgetExceeded)
// and the run ends partial with what it already made. Limits come from the recipe's cost class,
// and a self-hosted install may change them (settings.selfHosted.recipes.budgets).

export const RECIPE_BUDGETS = Object.freeze({
  low: Object.freeze({ vendorCalls: 60, tokensIn: 16000, tokensOut: 4000, ops: 600 }),
  medium: Object.freeze({ vendorCalls: 200, tokensIn: 48000, tokensOut: 8000, ops: 1500 }),
  high: Object.freeze({ vendorCalls: 600, tokensIn: 120000, tokensOut: 16000, ops: 3000 }),
})
export const BUDGET_KINDS = Object.freeze(['vendorCalls', 'tokensIn', 'tokensOut', 'ops'])

export class BudgetExceeded extends Error {
  constructor(kind) {
    super(`This run used its ${kind} budget.`)
    this.name = 'BudgetExceeded'
    this.kind = kind
    this.code = 'budget'
  }
}

/** The limits for a cost class, with an install's overrides (whole numbers only, never below 1). */
export function budgetLimits(costClass, overrides = null) {
  const base = RECIPE_BUDGETS[costClass] || RECIPE_BUDGETS.medium
  const own = overrides?.[costClass] || {}
  const out = {}
  for (const kind of BUDGET_KINDS) out[kind] = Number.isInteger(own[kind]) && own[kind] > 0 ? own[kind] : base[kind]
  return out
}

export function createBudget(limits) {
  const used = { vendorCalls: 0, tokensIn: 0, tokensOut: 0, ops: 0 }
  return {
    limits: { ...limits },
    used,
    /** Whether n more fit, without spending. */
    fits: (kind, n = 1) => used[kind] + n <= limits[kind],
    /** Spends n, or throws BudgetExceeded and spends nothing. */
    spend(kind, n = 1) {
      if (!BUDGET_KINDS.includes(kind)) throw new Error(`budget: unknown kind ${kind}`)
      if (used[kind] + n > limits[kind]) throw new BudgetExceeded(kind)
      used[kind] += n
    },
    /** Records what was spent after the fact (a model's real token counts), capped at the limit. */
    record(kind, n) {
      used[kind] = Math.min(limits[kind], used[kind] + Math.max(0, n | 0))
    },
    left: () => Object.fromEntries(BUDGET_KINDS.map((kind) => [kind, Math.max(0, limits[kind] - used[kind])])),
  }
}
