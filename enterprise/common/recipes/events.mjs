// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The events a recipe sends to outbound webhooks: the common ones every recipe emits, and the
// recipe's own (named in its manifest, e.g. architecture.new_dependency). Each event's data is a
// small object of ids, counts, codes and Slatebox's own addresses, never note text, tokens or a
// vendor's words: a receiver that needs the content reads it through the API with its own rights.
// Browser-safe (the webhook form lists the events from here).

export const EVENT_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/
export const ENVELOPE_LIMITS = Object.freeze({ bodyBytes: 64 * 1024, dataKeys: 24, stringChars: 300, listItems: 200 })

const id = { type: 'string', maxLength: 80 }
const count = { type: 'integer', minimum: 0 }
const url = { type: 'string', maxLength: 300 }
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

// event → its data schema (draft subset the registry's validator reads)
export const COMMON_EVENTS = Object.freeze({
  'run.started': obj({}),
  'run.finished': obj({
    state: { type: 'string', enum: ['done', 'partial', 'failed', 'skipped', 'cancelled'] },
    durationMs: count,
    stats: obj({ vendorCalls: count, tokensIn: count, tokensOut: count, ops: count, added: count, updated: count, removed: count, keptByPerson: count }),
    slatesChanged: { type: 'array', maxItems: 200, items: id },
  }, ['state']),
  'run.failed': obj({ name: { type: 'string', maxLength: 60 }, status: { type: ['integer', 'null'] }, code: { type: 'string', maxLength: 60 } }, ['code']),
  'slate.updated': obj({ slateId: id, shareId: id, url, added: count, updated: count, removed: count }, ['slateId', 'shareId']),
  'diagram.changed': obj({ slateId: id, shareId: id, before: { type: ['string', 'null'], maxLength: 80 }, after: { type: 'string', maxLength: 80 }, mermaidUrl: { type: ['string', 'null'], maxLength: 300 } }, ['slateId', 'after']),
  'approval.needed': obj({ cardId: id, kind: { type: 'string', maxLength: 40 }, target: { type: 'string', maxLength: 200 }, url }, ['cardId', 'kind']),
  'writeback.done': obj({ kind: { type: 'string', maxLength: 40 }, target: { type: 'string', maxLength: 200 }, ref: { type: 'string', maxLength: 300 } }, ['kind']),
  'writeback.declined': obj({ kind: { type: 'string', maxLength: 40 }, target: { type: 'string', maxLength: 200 }, reason: { type: 'string', maxLength: 60 } }, ['kind']),
  'recipe.paused': obj({ reason: { type: 'string', maxLength: 60 }, by: { type: ['string', 'null'], maxLength: 80 } }),
  'recipe.resumed': obj({ by: { type: ['string', 'null'], maxLength: 80 } }),
  // A signed test send (recipes.hooks.test).
  ping: obj({ hookId: id }),
})

export const COMMON_EVENT_NAMES = Object.freeze(Object.keys(COMMON_EVENTS))

// A recipe's own events carry ids, counts, short codes and keys only: this is their one schema.
export const OWN_EVENT_DATA = {
  type: 'object',
  additionalProperties: {
    type: ['string', 'integer', 'number', 'boolean', 'null', 'array'],
    maxLength: ENVELOPE_LIMITS.stringChars,
    maxItems: ENVELOPE_LIMITS.listItems,
    items: { type: ['string', 'integer', 'number', 'boolean'], maxLength: ENVELOPE_LIMITS.stringChars },
  },
}

/** Every event a hook may name for this recipe (null manifest: the common ones, for a project hook). */
export function eventsFor(manifest = null) {
  return [...COMMON_EVENT_NAMES.filter((name) => name !== 'ping'), ...(manifest?.events || [])]
}

/** The schema an event's data must meet, or null when the recipe does not send it. */
export function eventSchema(name, manifest = null) {
  if (Object.hasOwn(COMMON_EVENTS, name)) return COMMON_EVENTS[name]
  if (manifest?.events?.includes(name)) return OWN_EVENT_DATA
  return null
}

/**
 * The body every hook receives:
 *   { id, type, at, project: { id }, instance: { id, recipeId, name }, run: { id, trigger: { kind } } | null, data }
 */
export function envelope({ id: eventId, type, at, instance, run = null, data = {} }) {
  return {
    id: eventId,
    type,
    at: new Date(at).toISOString(),
    project: { id: instance?.projectId ?? null },
    instance: instance ? { id: instance._id, recipeId: instance.recipeId, name: String(instance.name || '').slice(0, 120) } : null,
    run: run ? { id: run._id, trigger: { kind: run.trigger?.kind || 'manual' } } : null,
    data,
  }
}
