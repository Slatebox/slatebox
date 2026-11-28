// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Who a recipe's work runs as: an agent of its owner, with the owner's rights (never more), named
// on the canvas by the recipe ("GitHub architect · runs for Ana", server/presence/agentPresence.mjs).
// Its token id is recipe:<instanceId>, so the slate's history, its undo and the activity log file
// every change under the recipe, and a person's edits are told apart from it (reconcile.mjs).
// direct: the run saves on slates the recipe made once the owner turned on "Apply future updates
// automatically" (canvasEdit in server/actions/slate-operations.mjs reads it); otherwise its
// changes are suggestions people keep or discard.

export const RECIPE_SCOPES = Object.freeze(['slates:read', 'slates:write', 'projects:read'])

export const recipeTokenId = (instanceId) => `recipe:${instanceId}`

export function recipePrincipal(instance, runId, manifest, { direct = false } = {}) {
  return {
    kind: 'agent',
    builtin: 'recipe',
    userId: instance.ownerId,
    tokenId: recipeTokenId(instance._id),
    scopes: [...RECIPE_SCOPES],
    runId,
    direct: Boolean(direct),
    agent: { name: manifest.agentName, onBehalfOf: instance.ownerId, colorIndex: Number.isInteger(instance.colorIndex) ? instance.colorIndex : 0, recipeId: instance.recipeId, instanceId: instance._id },
  }
}

/** Whether a run saves directly on this slate: the recipe made it, and its owner chose auto. */
export const savesDirectly = (instance, slateId) => instance.applyMode === 'auto' && Object.values(instance.slateMap || {}).includes(slateId)
