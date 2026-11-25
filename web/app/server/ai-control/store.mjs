// Every change to the AI control data goes through here: the document and its audit row are
// written in one call, the global generation moves on (so every pod reloads its snapshot), and
// the audit row never carries a key. The audit collection is append-only: this module has no
// way to change or remove an audit row, and nothing else writes it.
//
// Pure apart from the injected collections (MongoDB driver collections, or the in-memory ones the
// tests use).

export const COLLECTIONS = Object.freeze({
  providers: 'aiProviders',
  models: 'aiModels',
  bindings: 'aiBindings',
  bindingVersions: 'aiBindingVersions',
  agents: 'aiAgents',
  prompts: 'aiPrompts',
  promptVersions: 'aiPromptVersions',
  state: 'aiControlState',
  audit: 'aiControlAudit',
})
export const STATE_ID = 'global'
export const AUDIT_DAYS = 400
const VIA = ['ddp', 'http', 'exec', 'mcp', 'cli', 'system']
// Changes that cannot be undone by saving again need a reason in the audit trail.
const NEEDS_REASON = /\.(publish|rollback|remove|archive|reset|rotate|setGlobal)$/
const SECRET_FIELD = /^(apiKey|key|cipher|previousCipher|plaintext|authorization|secret|clientSecret|token|password)$/i
// Values that look like a key whatever field they are in (spec 6.2).
const SECRET_VALUE = /^(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|[A-Za-z0-9+/=_-]{40,})$/

export class ControlStoreError extends Error {
  constructor(message, code = 'invalid_request') {
    super(message)
    this.name = 'ControlStoreError'
    this.code = code
  }
}

/**
 * A copy of a document fit for the audit trail: every key-bearing field becomes
 * { redacted: true, fingerprint } (the document's keyFingerprint, never the key), and any value
 * that looks like a key is replaced the same way.
 */
export function redact(value, fingerprint = null) {
  if (Array.isArray(value)) return value.map((item) => redact(item, fingerprint))
  if (value instanceof Date) return value
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && SECRET_VALUE.test(value) ? { redacted: true, fingerprint } : value
  }
  const own = typeof value.keyFingerprint === 'string' ? value.keyFingerprint : fingerprint
  const out = {}
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_FIELD.test(key) && inner !== null && inner !== undefined) out[key] = { redacted: true, fingerprint: own }
    else out[key] = redact(inner, own)
  }
  return out
}

function checkActor(actor) {
  if (!actor || typeof actor !== 'object') throw new ControlStoreError('A change names who made it.')
  if (actor.userId != null && typeof actor.userId !== 'string') throw new ControlStoreError('actor.userId is an id.')
  if (!['person', 'agent', 'system'].includes(actor.principal)) throw new ControlStoreError('actor.principal is person, agent or system.')
  if (actor.via !== undefined && !VIA.includes(actor.via)) throw new ControlStoreError(`actor.via is ${VIA.join(', ')}.`)
  return { userId: actor.userId ?? null, principal: actor.principal, ...(actor.tokenId && { tokenId: String(actor.tokenId) }), via: actor.via ?? 'system' }
}

function checkReason(action, reason) {
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > 500)) throw new ControlStoreError('A reason is text of at most 500 characters.')
  if (NEEDS_REASON.test(action) && !(typeof reason === 'string' && reason.trim())) throw new ControlStoreError('Say why: this change needs a reason.')
  return reason?.trim() || null
}

/**
 * collections: { [COLLECTIONS key]: a driver collection with findOne, replaceOne, deleteOne,
 * insertOne, findOneAndUpdate }. newId(), now() → Date. withTransaction?(fn) runs fn(session) in
 * one transaction where the database supports it. onWrite?(generation) tells the snapshot holder
 * of this pod to swap at once.
 */
export function createControlStore({ collections, newId, now = () => new Date(), withTransaction = null, onWrite = () => {}, refusedPerWindow = 20, refusedWindowMs = 10 * 60 * 1000 }) {
  for (const key of ['state', 'audit']) if (!collections?.[key]) throw new Error(`ai-control store: needs the ${key} collection`)
  const refusals = refusalBudget({ count: refusedPerWindow, windowMs: refusedWindowMs, now: () => now().getTime() })

  async function bump(actor, session) {
    const at = now()
    const result = await collections.state.findOneAndUpdate(
      { _id: STATE_ID },
      { $inc: { generation: 1 }, $set: { lastPublishAt: at, lastPublishBy: actor.userId }, $setOnInsert: { aiEnabled: true, dbLayer: 'on' } },
      { upsert: true, returnDocument: 'after', ...(session && { session }) },
    )
    // driver 6 returns the document, driver 4/5 { value }
    const doc = result && Object.hasOwn(result, 'value') && !Object.hasOwn(result, 'generation') ? result.value : result
    return doc?.generation ?? null
  }

  async function auditRow({ action, actor, target, before, after, reason, evalRun = null, outcome = 'ok', error = null, generation = null, untrusted = false }, session) {
    const row = {
      _id: newId(), at: now(), actor, action, target,
      before: before == null ? null : redact(before), after: after == null ? null : redact(after),
      reason, evalRun, generation, outcome, ...(error && { error: String(error).slice(0, 500) }),
      // a refusal of someone who is not an administrator (their own text is not kept)
      ...(untrusted && { untrusted: true }),
    }
    await collections.audit.insertOne(row, session ? { session } : undefined)
    return row
  }

  /**
   * Writes one document (doc) or removes it (doc null), with its audit row.
   * change: { kind (a COLLECTIONS key other than audit), id, doc|null, action ('ai.bindings.publish'),
   *           actor { userId, principal, via, tokenId? }, reason?, evalRun?, create? (insert only:
   *           a ControlStoreError code conflict when the id exists) }
   * → { generation, before, after, auditId }
   */
  async function write({ kind, id, doc, action, actor, reason, evalRun = null, target = null, create = false }) {
    if (kind === 'audit' || !collections[kind]) throw new ControlStoreError(`${kind} is not an AI control collection.`)
    if (typeof action !== 'string' || !/^ai\.[a-z][A-Za-z]*(\.[a-z][A-Za-z]*)+$/.test(action)) throw new ControlStoreError('action names the action that made the change (ai.<area>.<verb>).')
    if (typeof id !== 'string' || !id) throw new ControlStoreError('A change names the document it writes.')
    const who = checkActor(actor)
    const why = checkReason(action, reason)
    const run = async (session) => {
      const options = session ? { session } : undefined
      const before = await collections[kind].findOne({ _id: id }, options)
      let after = null
      if (doc === null) {
        await collections[kind].deleteOne({ _id: id }, options)
      } else {
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ControlStoreError('A document is an object.')
        after = { ...doc, _id: id, updatedAt: now(), updatedBy: who.userId }
        // the generation only moves forward, through bump
        if (kind === 'state') after.generation = before?.generation ?? 0
        if (create) {
          // a new document only (a binding version): two writers that picked the same id never
          // overwrite each other; the second gets a conflict and picks again
          if (before) throw new ControlStoreError(`${id} already exists.`, 'conflict')
          try {
            await collections[kind].insertOne(after, session ? { session } : undefined)
          } catch (error) {
            if (error?.code === 11000 || /duplicate/i.test(error?.message || '')) throw new ControlStoreError(`${id} already exists.`, 'conflict')
            throw error
          }
        } else {
          await collections[kind].replaceOne({ _id: id }, after, { upsert: true, ...(session && { session }) })
        }
      }
      const generation = await bump(who, session)
      const row = await auditRow({ action, actor: who, target: target || { kind, id }, before, after, reason: why, evalRun, generation }, session)
      return { generation, before, after, auditId: row._id }
    }
    const result = withTransaction ? await withTransaction(run) : await run(null)
    try {
      await onWrite(result.generation)
    } catch {}
    return { ...result, before: result.before && redact(result.before), after: result.after && redact(result.after) }
  }

  /**
   * Records a refused change (spec 6.6: probing is visible). Never throws for a bad actor.
   * trusted: the caller passed the administrator check (a person-only rule or the write rate
   * refused it). Anyone else's text is not kept (no reason, a short target), and refusals are
   * kept for at most refusedPerWindow per caller per refusedWindowMs on this process, so a
   * signed-in user calling an admin action in a loop cannot fill the audit trail, which keeps rows
   * for 400 days. → the row, or null when not kept
   */
  async function refused({ action, actor, target = null, reason = null, error, trusted = false }) {
    let who
    try {
      who = checkActor(actor)
    } catch {
      who = { userId: actor?.userId ?? null, principal: 'unknown', via: 'system' }
    }
    if (!refusals.take(`${trusted ? 'admin' : 'other'}:${who.userId ?? 'anonymous'}`)) return null
    const shortTarget = target && typeof target === 'object'
      ? { kind: String(target.kind ?? '').slice(0, 40), id: String(target.id ?? '').slice(0, trusted ? 200 : 60) }
      : null
    return auditRow({
      action: String(action).slice(0, 80), actor: who, target: shortTarget, before: null, after: null,
      reason: trusted && typeof reason === 'string' ? reason.slice(0, 500) : null, outcome: 'refused', error, ...(!trusted && { untrusted: true }),
    })
  }

  /**
   * Records a change made outside the AI control collections (ai.update to the agent settings):
   * the audit row only, with keys redacted. The generation does
   * not move, since nothing in the snapshot changed.
   * entry: { action ('ai.update'), actor, target { kind, id }, before, after, reason? } → the row
   */
  async function record({ action, actor, target, before = null, after = null, reason = null }) {
    if (typeof action !== 'string' || !/^[a-z][A-Za-z]*(\.[a-z][A-Za-z]*)+$/.test(action)) throw new ControlStoreError('action names the action that made the change (area.verb).')
    if (!target || typeof target.kind !== 'string' || typeof target.id !== 'string') throw new ControlStoreError('A change names what it changed: target { kind, id }.')
    const who = checkActor(actor)
    const why = checkReason(action, reason)
    return auditRow({ action, actor: who, target: { kind: target.kind, id: target.id }, before, after, reason: why })
  }

  /** The global state document (generation, AI on/off, dbLayer). */
  const state = async () => (await collections.state.findOne({ _id: STATE_ID })) || { _id: STATE_ID, generation: 0, aiEnabled: true, dbLayer: 'on' }

  return { write, record, refused, state, bump: (actor) => bump(checkActor(actor), null) }
}

/** The indexes (spec 1.8: a TTL keeps the audit trail for auditDays, 400 by default). */
export async function ensureAIControlIndexes(collections, { auditDays = AUDIT_DAYS } = {}) {
  const days = Number.isInteger(auditDays) && auditDays > 0 ? auditDays : AUDIT_DAYS
  await collections.audit.createIndex({ at: 1 }, { expireAfterSeconds: days * 24 * 60 * 60, name: 'at_ttl' })
  await collections.audit.createIndex({ 'target.id': 1, at: -1 })
  await collections.audit.createIndex({ action: 1, at: -1 })
  await collections.bindings.createIndex({ surface: 1 })
  await collections.bindingVersions.createIndex({ bindingId: 1, version: -1 }, { unique: true })
  await collections.promptVersions.createIndex({ promptId: 1, version: -1 }, { unique: true })
  await collections.models.createIndex({ connection: 1 })
  await collections.prompts.createIndex({ surface: 1 })
}

// How many refused attempts per caller the audit trail keeps in a window (in memory, per process).
// The first refusal past the budget is logged once per window, so a flood is still seen.
function refusalBudget({ count, windowMs, now }) {
  const by = new Map()
  return {
    take(key) {
      const at = now()
      const row = by.get(key)
      if (!row || at - row.start >= windowMs) {
        by.set(key, { start: at, used: 1, warned: false })
        if (by.size > 10000) by.delete(by.keys().next().value)
        return true
      }
      if (row.used < count) {
        row.used += 1
        return true
      }
      if (!row.warned) {
        row.warned = true
        console.warn(`ai-control: more than ${count} refused AI control changes from ${key.replace(/^[a-z]+:/, '')} in ${Math.round(windowMs / 60000)} minutes; the rest of this window is not kept in the audit trail`)
      }
      return false
    },
  }
}
