// Bindings: one simple choice per part of Slatebox. Each part uses a model (a provider and one of
// its models), is turned off, or uses the default ("Use the default": no document at all). The
// default row ("Everything not set") names one model, or nothing (then the built-in default,
// Meta Muse Ember). A plain Save writes only the rows that changed; each is one audit row in the
// Changes tab (who, what, when, and the optional note).
//
// Pure apart from the injected store (store.mjs) and snapshot.
import { surface as surfaceById, SURFACES } from './catalogue.mjs'
import { capabilityGap } from './snapshot.mjs'
import { ModelError } from './models.mjs'
import { resolveModel } from './resolve.mjs'

export const BINDING_CHOICES = Object.freeze(['default', 'model', 'off'])
const NOTE_MAX = 500

const fail = (message, status = 400, details) => {
  throw new ModelError(message, status, details)
}

/**
 * The parts an administrator can bind in this build: chosen per part, not served by a built-in
 * service only, and sent by some call site (generation.notes has no request of its own yet, so a
 * binding of it would do nothing); default is what every other part follows. The eval judge is bound
 * here although people never choose it (catalogue `bindable`).
 */
export const BINDABLE_SURFACES = Object.freeze(SURFACES.filter((s) => s.bindable && s.inBuild && s.id !== 'admin.test' && (s.id === 'default' || s.requestFeatures.length)).map((s) => s.id))

/**
 * Checks one change: { surface, use: 'default' | 'model' | 'off', model? }. → the document to store,
 * or null (use the default: the document goes). Throws ModelError.
 */
export function normalizeBindingChange(change, snapshot) {
  const surface = change?.surface
  if (!BINDABLE_SURFACES.includes(surface)) fail(`${surface} is not a part of Slatebox that can be bound.`)
  const use = change.use
  if (!BINDING_CHOICES.includes(use)) fail('use is default, model or off.')
  if (use === 'default') {
    if (change.model) fail('Use the default takes no model.')
    return null
  }
  if (use === 'off') {
    if (surface === 'default') fail('Everything not set cannot be turned off here. Turn AI off for everyone on the Overview instead.')
    if (change.model) fail('Turned off takes no model.')
    return { surface, use: 'off' }
  }
  const model = snapshot?.models?.[change.model]
  if (!model) fail(`There is no model ${change.model}. Add it on the Models tab first.`, 404)
  if (model.status === 'disabled') fail(`${model.label || model.model} is turned off on the Models tab.`, 409)
  const provider = snapshot.providers?.[model.provider]
  if (!provider || provider.status === 'archived') fail(`The provider of ${model.label || model.model} is archived.`, 409)
  const gap = capabilityGap(surface, model)
  const title = surfaceById(surface)?.title || surface
  if (gap) fail(`${model.label || model.model} cannot ${({ tools: 'call tools', vision: 'read images', images: 'make images' })[gap]}, which ${title.toLowerCase()} needs.`, 409, { need: gap })
  return { surface, use: 'model', model: model._id }
}

/** A binding as the page and the actions read it. */
const shown = (doc) => (doc ? { use: doc.use, model: doc.model ?? null, version: doc.version ?? 1, updatedAt: doc.updatedAt ?? null, updatedBy: doc.updatedBy ?? null } : { use: 'default', model: null })

/**
 * deps: { store (store.mjs: write), snapshot() → the current snapshot }
 */
export function createBindingOps({ store, snapshot }) {
  /** Every part that can be bound, with its choice and what it resolves to now. */
  function list() {
    const snap = snapshot()
    const surfaces = BINDABLE_SURFACES.map((id) => {
      const at = surfaceById(id)
      const resolved = resolveModel(snap, { surface: id })
      return {
        surface: id, title: at.title, follows: at.follows, followsTitle: at.follows ? surfaceById(at.follows)?.title ?? null : null,
        needs: [...at.needs], binding: shown(snap.bindings[id]),
        resolved: { enabled: resolved.enabled, source: resolved.source, followed: resolved.followed, route: resolved.route },
      }
    })
    const skipped = (snap.health || []).filter((h) => h.kind === 'binding')
    return { generation: snap.generation, surfaces, skipped }
  }

  /**
   * Saves the changed rows: each change is checked first (nothing is written unless all pass), then
   * written with its own audit row. changes: [{ surface, use, model? }]. note: optional, kept in the
   * audit trail. → { changed: [surface ids], generation }
   */
  async function set({ actor, changes, note = null }) {
    if (!Array.isArray(changes) || !changes.length) fail('Send at least one change.')
    if (note !== null && (typeof note !== 'string' || note.length > NOTE_MAX)) fail(`A note is at most ${NOTE_MAX} characters.`)
    const snap = snapshot()
    const seen = new Set()
    const prepared = changes.map((change) => {
      if (seen.has(change?.surface)) fail(`${change.surface} appears twice in this change.`)
      seen.add(change?.surface)
      return { surface: change.surface, doc: normalizeBindingChange(change, snap) }
    })
    const changed = []
    let generation = snap.generation
    for (const { surface, doc } of prepared) {
      const before = snap.bindings[surface] ?? null
      const same = (before?.use ?? 'default') === (doc?.use ?? 'default') && (before?.model ?? null) === (doc?.model ?? null)
      if (same) continue
      const result = await store.write({
        kind: 'bindings', id: surface, doc: doc && { ...doc, version: (before?.version ?? 0) + 1 },
        action: 'ai.bindings.set', actor, reason: note?.trim() || null, target: { kind: 'binding', id: surface },
      })
      generation = result.generation
      changed.push(surface)
    }
    return { changed, generation }
  }

  /** Removes a part's binding (it uses the default again). → { removed: boolean, surface } */
  async function remove({ actor, surface, reason }) {
    const snap = snapshot()
    if (!snap.bindings[surface]) return { removed: false, surface }
    await store.write({ kind: 'bindings', id: surface, doc: null, action: 'ai.bindings.remove', actor, reason, target: { kind: 'binding', id: surface } })
    return { removed: true, surface }
  }

  /** The parts bound to a model, or to any model of a provider. */
  function usersOf({ model = null, provider = null }) {
    const snap = snapshot()
    return Object.values(snap.bindings || {})
      .filter((doc) => doc.use === 'model' && (model ? doc.model === model : snap.models[doc.model]?.provider === provider))
      .map((doc) => doc.surface)
  }

  return { list, set, remove, usersOf, heads: () => Object.values(snapshot().bindings || {}) }
}
