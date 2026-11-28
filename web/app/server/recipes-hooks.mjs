// What the MIT app tells recipes (enterprise/server/recipes, where enterprise code runs), the same
// way it tells integrations (library/integration-hooks.mjs): a person lost access to a project
// (removed from its team, its drive unshared from them, their account deleted), so the recipes that
// run for them there stop and its managers are told. And a slate was saved (the save core's onWrite,
// server/slate-save.js), so a recipe that keeps that slate in step with a file (a sync map) exports
// it after its quiet time. Where no enterprise code runs, nothing listens.
let hooks = { ownerLostAccess: async () => null, slateSaved: async () => 0 }

export function setRecipeHooks(next) {
  hooks = { ...hooks, ...next }
}

/** A person lost access: to one project (projectId), or to whatever they can no longer edit (null). */
export const recipeHooks = Object.freeze({
  ownerLostAccess: (userId, projectId = null) => hooks.ownerLostAccess(userId, projectId).catch?.((error) => console.warn('[recipes] ownerLostAccess failed', error?.message)),
  /** A slate was saved: { shareId, actor }. Never awaited by a save, never fails one. */
  slateSaved: (save) => {
    try {
      return Promise.resolve(hooks.slateSaved(save)).catch((error) => console.warn('[recipes] slateSaved failed', error?.message))
    } catch (error) {
      console.warn('[recipes] slateSaved failed', error?.message)
      return Promise.resolve(0)
    }
  },
})
