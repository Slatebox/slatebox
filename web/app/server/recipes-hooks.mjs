// What the MIT app tells recipes (enterprise/server/recipes, where enterprise code runs), the same
// way it tells integrations (library/integration-hooks.mjs): a person lost access to a project
// (removed from its team, its drive unshared from them, their account deleted), so the recipes that
// run for them there stop and its managers are told. Where no enterprise code runs, nothing listens.
let hooks = { ownerLostAccess: async () => null }

export function setRecipeHooks(next) {
  hooks = { ...hooks, ...next }
}

/** A person lost access: to one project (projectId), or to whatever they can no longer edit (null). */
export const recipeHooks = Object.freeze({
  ownerLostAccess: (userId, projectId = null) => hooks.ownerLostAccess(userId, projectId).catch?.((error) => console.warn('[recipes] ownerLostAccess failed', error?.message)),
})
