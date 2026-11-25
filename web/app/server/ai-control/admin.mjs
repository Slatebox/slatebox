// What an administrator does with AI control beyond reading the snapshot: read the audit trail,
// see how each part was used over the last day (from aiAudit, one row per model call), reset (every
// part back to the default, prompts back to their built-in text) and turn AI off for everyone.
// Pure apart from the injected collections and services; index.mjs gives it the Meteor ones, the
// tests give it in-memory ones.
import { surfaceForRequest } from './catalogue.mjs'
import { STATE_ID } from './store.mjs'
import { ModelError } from './models.mjs'

export const RESET_TARGETS = Object.freeze(['binding', 'bindings', 'prompt', 'prompts', 'all'])
export const GLOBAL_MESSAGE_MAX = 300
export const AUDIT_PAGE = 50
export const AUDIT_PAGE_MAX = 200
/** Who a Changes row names when the account that made it no longer exists. */
export const DELETED_ACCOUNT = 'a deleted account'
// aiAudit statuses that are not a failed call: an answer, or a call the meter never sent.
const NOT_ERRORS = new Set(['success', 'unmetered'])

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * deps: {
 *   store         store.mjs createControlStore (write, record, refused, state)
 *   audit         the aiControlAudit collection (find → cursor with sort/limit/toArray)
 *   aiAudit?      the aiAudit collection (aggregate → cursor with toArray)
 *   costOf?({ model, usage }) → { costMicros } (metering/prices.mjs aiCostMicros)
 *   bindings?     bindings.mjs createBindingOps (heads, remove) for the binding targets
 *   namesOf?(userIds) → { [userId]: name } the people's names, for the Changes tab (an account
 *                 that no longer exists is left out)
 *   now?()        → ms
 * }
 */
export function createAdminOps({ store, audit, aiAudit = null, costOf = () => ({ costMicros: 0 }), bindings = null, prompts = null, namesOf = null, now = Date.now }) {
  // Each row's actor with the person's name (actor.name): an account that is gone reads "a deleted
  // account", and a row with no account (the server's own) keeps no name. Only administrators read
  // the list, so the names never reach anyone else.
  async function withNames(rows) {
    const ids = [...new Set(rows.map((row) => row.actor?.userId).filter(Boolean))]
    let names = {}
    if (ids.length && namesOf) {
      try {
        names = (await namesOf(ids)) || {}
      } catch {
        names = {}
      }
    }
    return rows.map((row) => (row.actor?.userId ? { ...row, actor: { ...row.actor, name: names[row.actor.userId] || DELETED_ACCOUNT } } : row))
  }

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
    return { rows: await withNames(page), next }
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
   *   binding  removes one part's binding (surface): it uses the default again;
   *   bindings removes every part's binding, the default's too (then the built-in default, Meta
   *            Muse Ember, answers everything not turned off by the switch for everyone);
   *   prompt   returns one prompt (promptId) to its built-in text; prompts does so for every prompt
   *            (their versions stay);
   *   all      every one of the above.
   * A reason is required. → { target, removed: [surfaces], prompts: [ids] }
   */
  async function reset({ actor, target, surface = null, promptId = null, reason }) {
    if (!RESET_TARGETS.includes(target)) throw new Error(`target is ${RESET_TARGETS.join(', ')}`)
    const removed = []
    if (target === 'binding' || target === 'bindings' || target === 'all') {
      if (!bindings) throw new Error('ai-control admin: needs the binding store to reset bindings')
      const surfaces = target === 'binding' ? [surface] : bindings.heads().map((doc) => doc.surface)
      for (const id of surfaces) {
        const out = await bindings.remove({ actor, surface: id, reason })
        if (out.removed) removed.push(out.surface)
      }
    }
    let promptsReset = []
    if (target === 'prompt' || target === 'prompts' || target === 'all') {
      if (!prompts) throw new Error('ai-control admin: needs the prompt store to reset prompts')
      ;({ reset: promptsReset } = await prompts.reset({ actor, id: target === 'prompt' ? promptId : null, reason }))
    }
    return { target, removed, prompts: promptsReset }
  }

  /**
   * ai.control.setGlobal: AI on or off for everyone on this server, with the message people see
   * while it is off. Admin pages and actions never depend on it. → { aiEnabled, aiDisabledMessage, generation }
   */
  async function setGlobal({ actor, aiEnabled, message, reason }) {
    const state = await store.state()
    const { _id: _ignored, updatedAt: _at, updatedBy: _by, dbLayer: _layer, ...rest } = state
    const next = { aiEnabled: true, ...rest }
    if (aiEnabled !== undefined) next.aiEnabled = aiEnabled
    if (message !== undefined) next.aiDisabledMessage = message === null ? null : String(message).trim() || null
    if (next.aiEnabled === false && !next.aiDisabledMessage) throw new ModelError('Write the message people see while AI is off.')
    if (next.aiDisabledMessage && (next.aiDisabledMessage.length > GLOBAL_MESSAGE_MAX || /[\r\n]/.test(next.aiDisabledMessage))) throw new ModelError(`The message is one line of at most ${GLOBAL_MESSAGE_MAX} characters.`)
    const result = await store.write({ kind: 'state', id: STATE_ID, doc: next, action: 'ai.control.setGlobal', actor, reason, target: { kind: 'state', id: 'global' } })
    return { aiEnabled: next.aiEnabled !== false, aiDisabledMessage: next.aiDisabledMessage ?? null, generation: result.generation }
  }

  return { listAudit, usage, reset, setGlobal }
}

// ---------- what a signed-in page may know (ai.surfaces.status) ----------

/**
 * Whether each AI surface in this build and AI as a whole is on, and the message to show when not:
 * no models, prompts or keys. Public (every signed-in page reads it) so the app can hide or explain
 * a control an administrator turned off.
 * bind(surface) → a resolveModel result (only enabled and disabledMessage are read).
 * → { aiEnabled, message, surfaces: { [id]: { enabled, message } } }
 */
export async function surfacesStatus({ surfaces, snapshot, bind }) {
  const aiEnabled = snapshot?.state?.aiEnabled !== false
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
 * One shared ai.surfaces.status for every subscriber (the status is the same for everyone: it reads
 * only the global switch and the bindings). One timer runs while anyone subscribes; the
 * status is computed once per generation, not once per subscriber.
 * deps: { compute() → status, generation() → number, every(fn, ms) → handle, cancel(handle), pollMs }
 * → { subscribe(onChange) → Promise<{ current, stop() }>, size() }
 */
export function createStatusHub({ compute, generation, every, cancel, pollMs = 5000, log = console }) {
  const listeners = new Set()
  let current = null
  let seen = null
  let timer = null
  let pending = null
  const refresh = async () => {
    const at = generation()
    if (current && at === seen) return current
    pending ||= (async () => {
      try {
        const next = await compute()
        seen = at
        if (!current || JSON.stringify(next) !== JSON.stringify(current)) {
          current = next
          for (const listener of [...listeners]) listener(current)
        }
        return current
      } finally {
        pending = null
      }
    })()
    return pending
  }
  return {
    async subscribe(onChange) {
      const first = await refresh()
      listeners.add(onChange)
      if (!timer) timer = every(() => { refresh().catch((error) => log.warn?.(`ai-control: surfaces status not refreshed: ${error.message}`)) }, pollMs)
      return {
        current: first,
        stop() {
          listeners.delete(onChange)
          if (!listeners.size && timer) {
            cancel(timer)
            timer = null
          }
        },
      }
    },
    size: () => listeners.size,
  }
}
