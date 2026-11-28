// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The app tells recipes about every slate save (web/app/server/recipes-hooks.mjs slateSaved, from
// the save core's onWrite). Almost no slate is in a sync map, and a person editing saves every few
// seconds, so this stays cheap:
//   - a recipe's own saves are not edits to export (recipe → recipe goes through recipe_event)
//   - a slate no recipe watches is remembered as such for cacheMs (one indexed query, then none)
//   - a watched slate's saves are folded per slate: at most one write per throttleMs, which only
//     pushes that slate's due time out (queue.slateSaved, debounced per slate)
// Each server keeps its own memory; service.mjs forgets a slate here when a sync map changes on
// this server (forget), and other servers catch up within cacheMs.

export const SAVE_LIMITS = Object.freeze({ cacheMs: 30000, throttleMs: 15000, cacheSize: 5000 })

export function createSlateSaveListener({ store, queue, clock = Date.now, limits = SAVE_LIMITS }) {
  const watchedBy = new Map() // shareId → { at, instances: [{ _id, debounceMs }] }
  const pushed = new Map() // `${instanceId}:${shareId}` → when its due time was last pushed out

  const remember = (map, key, value) => {
    if (map.size >= limits.cacheSize) map.delete(map.keys().next().value)
    map.set(key, value)
  }

  async function watchers(shareId) {
    const now = clock()
    const known = watchedBy.get(shareId)
    if (known && now - known.at < limits.cacheMs) return known.instances
    const rows = await store.instances.find({ state: 'active', watchSlates: shareId }, { limit: 50, projection: { _id: 1, triggers: 1 } }).toArray()
    const instances = rows
      .map((row) => ({ _id: row._id, spec: (row.triggers || []).find((t) => t.kind === 'slate_saved') }))
      .filter((row) => row.spec)
      .map((row) => ({ _id: row._id, debounceMs: row.spec.debounceMs ?? 0 }))
    remember(watchedBy, shareId, { at: now, instances })
    return instances
  }

  /** A slate was saved. → how many recipes it pushed out (0 for nearly every save). */
  async function slateSaved({ shareId, actor = null } = {}) {
    if (typeof shareId !== 'string' || !shareId) return 0
    if (String(actor?.tokenId || '').startsWith('recipe:')) return 0
    const now = clock()
    let n = 0
    for (const instance of await watchers(shareId)) {
      const key = `${instance._id}:${shareId}`
      if (now - (pushed.get(key) ?? -Infinity) < limits.throttleMs) continue
      remember(pushed, key, now)
      if (await queue.slateSaved(instance._id, shareId, { debounceMs: instance.debounceMs })) n += 1
    }
    return n
  }

  /** A sync map changed: its slates are read again on their next save. */
  function forget(shareIds = null) {
    if (!shareIds) watchedBy.clear()
    else for (const id of shareIds) watchedBy.delete(id)
  }

  return { slateSaved, forget }
}
