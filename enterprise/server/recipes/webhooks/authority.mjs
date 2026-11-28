// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Whether a hook still speaks for the person who added it. A hook keeps working only while that
// person may still add it (service.mjs hookScope): on a recipe, the person it runs for or a manager
// of its project; on a project, a manager of it. Someone unshared or lowered keeps no hook that
// hears the project's runs, feeds a recipe data or steps into its runs. Checked each time a hook is
// used (an event written, an intercept called, an inbound call taken), so no removal is missed.
const RANK = Object.freeze({ none: 0, viewer: 1, commenter: 2, editor: 3, manager: 4, owner: 5 })

/** projects: { roleFor(userId, projectId) } (context.projects). → allowed(hook, instance) → boolean */
export function createHookAuthority({ projects }) {
  return async function allowed(hook, instance) {
    if (!hook?.ownerId) return false
    const projectId = hook.scope?.projectId || instance?.projectId
    if (!projectId) return false
    const role = await projects.roleFor(hook.ownerId, projectId)
    if (hook.scope?.instanceId) {
      if (!instance || hook.scope.instanceId !== instance._id) return false
      if (hook.ownerId === instance.ownerId) return (RANK[role] || 0) >= RANK.editor
    }
    return (RANK[role] || 0) >= RANK.manager
  }
}
