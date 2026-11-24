// What an administrator does with AI control beyond reading the snapshot: read the audit trail,
// see how each surface was used over the last day (from aiAudit, one row per model call), and
// reset (spec 2.4: return the server's choices to the settings file and built-in defaults, or
// switch the DB layer off at runtime). Pure apart from the injected collections and services;
// index.mjs gives it the Meteor ones, the tests give it in-memory ones.
import { surfaceForRequest } from './catalogue.mjs'
import { STATE_ID } from './store.mjs'

export const RESET_TARGETS = Object.freeze(['use', 'dbLayer', 'all'])
export const AUDIT_PAGE = 50
export const AUDIT_PAGE_MAX = 200
// aiAudit statuses that are not a failed call: an answer, or a call the meter never sent.
const NOT_ERRORS = new Set(['success', 'unmetered'])

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * deps: {
 *   store         store.mjs createControlStore (write, record, refused, state)
 *   audit         the aiControlAudit collection (find → cursor with sort/limit/toArray)
 *   aiAudit?      the aiAudit collection (aggregate → cursor with toArray)
 *   aiSettings?   ai-settings-core.mjs (resetServerUse)
 *   costOf?({ model, usage }) → { costMicros } (metering/prices.mjs aiCostMicros)
 *   now?()        → ms
 * }
 */
export function createAdminOps({ store, audit, aiAudit = null, aiSettings = null, costOf = () => ({ costMicros: 0 }), now = Date.now }) {
  /**
   * The audit trail, newest first, filtered. filter: { limit, before (the next page: a previous
   * answer's next, '<ISO time>|<row id>', or an ISO time alone for rows older than it), since (ISO
   * time), action (exact, or a prefix ending in .), kind, id, userId, outcome ('ok' | 'refused') }
   * → { rows, next | null }
   */
  async function listAudit(filter = {}) {
    const limit = Math.min(Math.max(Number.isInteger(filter.limit) ? filter.limit : AUDIT_PAGE, 1), AUDIT_PAGE_MAX)
    const selector = {}
    const at = {}
    const [beforeAt, beforeId] = String(filter.before || '').split('|')
    if (filter.since) at.$gte = new Date(filter.since)
    if (beforeAt && !beforeId) at.$lt = new Date(beforeAt)
    if (Object.keys(at).length) selector.at = at
    // rows written in the same millisecond page by their id, so none is skipped
    if (beforeAt && beforeId) selector.$or = [{ at: { $lt: new Date(beforeAt) } }, { at: new Date(beforeAt), _id: { $lt: beforeId } }]
    if (filter.action) selector.action = filter.action.endsWith('.') ? { $regex: `^${escapeRegex(filter.action)}` } : filter.action
    if (filter.kind) selector['target.kind'] = filter.kind
    if (filter.id) selector['target.id'] = filter.id
    if (filter.userId) selector['actor.userId'] = filter.userId
    if (filter.outcome) selector.outcome = filter.outcome
    const rows = await audit.find(selector).sort({ at: -1, _id: -1 }).limit(limit + 1).toArray()
    const page = rows.slice(0, limit)
    const next = rows.length > limit ? `${new Date(page.at(-1).at).toISOString()}|${page.at(-1)._id}` : null
    return { rows: page, next }
  }

  /**
   * Calls, failed calls and spend per surface over the last `hours` (24 by default), from aiAudit.
   * Rows written before AI control carry no surface; their request feature names it.
   * → { since, surfaces: { [surface]: { calls, errors, costMicros } } }
   */
  async function usage({ hours = 24 } = {}) {
    const since = now() - hours * 60 * 60 * 1000
    const surfaces = {}
    if (!aiAudit) return { since: new Date(since).toISOString(), surfaces }
    const groups = await aiAudit.aggregate([
      { $match: { created: { $gte: since } } },
      {
        $group: {
          _id: { surface: '$surface', feature: '$feature', model: '$model', status: '$status' },
          calls: { $sum: 1 },
          inputTokens: { $sum: { $ifNull: ['$usage.inputTokens', 0] } },
          outputTokens: { $sum: { $ifNull: ['$usage.outputTokens', 0] } },
          providerCostUsd: { $sum: { $ifNull: ['$usage.providerCostUsd', 0] } },
        },
      },
    ], { maxTimeMS: 5000 }).toArray()
    for (const group of groups) {
      const { surface, feature, model, status } = group._id || {}
      const id = surface || surfaceForRequest(feature) || 'unknown'
      const row = (surfaces[id] ||= { calls: 0, errors: 0, costMicros: 0 })
      row.calls += group.calls
      if (!NOT_ERRORS.has(status)) row.errors += group.calls
      if (group.inputTokens || group.outputTokens || group.providerCostUsd) {
        row.costMicros += costOf({ model, usage: { inputTokens: group.inputTokens, outputTokens: group.outputTokens, providerCostUsd: group.providerCostUsd } }).costMicros || 0
      }
    }
    return { since: new Date(since).toISOString(), surfaces }
  }

  /**
   * ai.control.reset. target:
   *   use      clears what an administrator chose in the app for the server's features (keys:
   *            only those), so the settings file and built-in AI answer again;
   *   dbLayer  switches the DB layer off at runtime (aiControlState.dbLayer 'off'): every AI
   *            control document is ignored until it is switched on again;
   *   all      both.
   * A reason is required. → { target, cleared: [keys], dbLayer: 'on' | 'off' }
   */
  async function reset({ userId, actor, target, keys = null, reason }) {
    if (!RESET_TARGETS.includes(target)) throw new Error(`target is ${RESET_TARGETS.join(', ')}`)
    let cleared = []
    if (target === 'use' || target === 'all') {
      if (!aiSettings) throw new Error('ai-control admin: needs aiSettings to reset choices')
      ;({ cleared } = await aiSettings.resetServerUse(userId, { keys, reason, actor }))
    }
    let { dbLayer } = await store.state()
    if (target === 'dbLayer' || target === 'all') {
      const state = await store.state()
      const { _id: _ignored, updatedAt: _at, updatedBy: _by, ...rest } = state
      await store.write({ kind: 'state', id: STATE_ID, doc: { aiEnabled: true, ...rest, dbLayer: 'off' }, action: 'ai.control.reset', actor, reason, target: { kind: 'state', id: 'dbLayer' } })
      dbLayer = 'off'
    }
    return { target, cleared, dbLayer: dbLayer === 'off' ? 'off' : 'on' }
  }

  return { listAudit, usage, reset }
}

// ---------- what a signed-in page may know (ai.surfaces.status) ----------

/**
 * For one person, whether each AI surface in this build and AI as a whole is on, and the message
 * to show when not: no models, prompts or connections. Public (every signed-in page reads it) so
 * the app can hide or explain a control an administrator turned off.
 * bind(surface) → a resolveBinding result (only enabled and disabledMessage are read).
 * → { aiEnabled, message, surfaces: { [id]: { enabled, message } } }
 */
export async function surfacesStatus({ surfaces, snapshot, bind }) {
  const aiEnabled = snapshot?.dbLayer === 'off' || snapshot?.state?.aiEnabled !== false
  const out = {}
  for (const s of surfaces) {
    // not a place people use (default is the fallback row; admin.test is an administrator's)
    if (!s.inBuild || s.id === 'default' || (!s.useKey && !s.builtinOnly)) continue
    if (s.builtinOnly) {
      out[s.id] = { enabled: aiEnabled, message: aiEnabled ? null : snapshot.state.aiDisabledMessage || null }
      continue
    }
    const binding = await bind(s.id)
    out[s.id] = { enabled: Boolean(binding.enabled), message: binding.enabled ? null : binding.disabledMessage || null }
  }
  return { aiEnabled, message: aiEnabled ? null : snapshot.state.aiDisabledMessage || null, surfaces: out }
}

/**
 * Only what changed between two versions of a document, for an audit row: the top-level fields
 * that differ, from each side. A new document (before null) or a removed one (after null) keeps
 * every field of the side that exists.
 */
export function changedFields(before, after) {
  if (!before || !after) return { before: before ?? null, after: after ?? null }
  const out = { before: {}, after: {} }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === '_id') continue
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue
    if (key in before) out.before[key] = before[key]
    if (key in after) out.after[key] = after[key]
  }
  return out
}
