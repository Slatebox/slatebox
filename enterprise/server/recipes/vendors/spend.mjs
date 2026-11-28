// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One vendor call against a run's budget: the runtime's budget (spend(kind, n) throws BudgetExceeded,
// code 'budget') or a test's (take(kind, n) → false when over). The Slack and Google sessions count
// each network call here (a session method may make none, as reading the inbox does, or several, as
// reading 15 names does), and say so with countsOwnCalls.
export class VendorBudgetSpent extends Error {
  constructor() {
    super('This run used its vendor call budget.')
    this.name = 'BudgetExceeded'
    this.kind = 'vendorCalls'
    this.code = 'budget'
  }
}

export function spendVendorCall(budget) {
  if (!budget) return
  if (typeof budget.spend === 'function') return budget.spend('vendorCalls', 1)
  if (typeof budget.take === 'function' && !budget.take('vendorCalls', 1)) throw new VendorBudgetSpent()
}
