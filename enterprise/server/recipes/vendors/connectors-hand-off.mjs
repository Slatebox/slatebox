// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What the Slack and Google recipe vendors borrow from the integrations that already run
// (enterprise/server/meteor.js startConnectors): the credentials vault (each person's sealed Slack
// and Google tokens), the integrations store, the guarded fetches (Slack's hosts only; Google's),
// Slack's settings and its once-a-minute read gate (shared with the Slack agent), Google's settings.
// Set once the integrations start; until then (or with integrations off) a recipe asking for Slack
// or Google is told to sign in again, never handed a token from anywhere else.
let current = null

/** deps: { vault, integrations, slack: { fetch, config, gates }, google: { fetch, config } } */
export function setRecipeConnectors(deps) {
  current = deps && deps.vault && deps.integrations ? deps : null
}

export const recipeConnectors = () => current
