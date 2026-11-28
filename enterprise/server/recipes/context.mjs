// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The only thing a recipe sees. A recipe never calls the registry, Mongo or fetch itself
// (scripts/recipe-imports.test.mjs checks its imports): it reads its vendor through ctx.vendor
// (every call counted against the run's budget), asks the agent through ctx.ai (metered, null when
// refused), remembers through ctx.ledger and ctx.setCursor, reads its own slates through
// ctx.slates, and answers what it wants the project to hold (a DesiredSet); the runner does the rest.
import { validate } from '/server/actions/schema.mjs'
import { eventSchema } from '../../common/recipes/events.mjs'
import { logLine, RECIPE_LIMITS } from './queue.mjs'

export const CURSOR_BYTES = 64 * 1024
export const LEDGER_LIMITS = Object.freeze({ keyChars: 200, dataBytes: 8 * 1024, rowsPerRun: 2000, readRows: 500 })

export class CursorTooLarge extends Error {
  constructor() {
    super('A recipe keeps at most 64 KB between runs.')
    this.name = 'CursorTooLarge'
  }
}

/** A vendor session whose every method call is counted (budget vendorCalls) and checks the signal. */
export function budgeted(session, budget, signal) {
  if (!session || typeof session !== 'object') return session
  return new Proxy(session, {
    get(target, key) {
      const value = target[key]
      if (typeof value !== 'function') return value && typeof value === 'object' && !Array.isArray(value) ? budgeted(value, budget, signal) : value
      return (...args) => {
        if (signal?.aborted) throw Object.assign(new Error('The run stopped.'), { name: 'AbortError', code: 'timeout' })
        budget.spend('vendorCalls', 1)
        return value.apply(target, args)
      }
    },
  })
}

/**
 * deps:
 *   instance, run, manifest, signal, clock, budget
 *   vendors     { github?, slack?, google? } opened sessions
 *   ai          createRecipeAI(...) (metering.mjs)
 *   store       for the ledger (store.ledger)
 *   readSlate(role, key) → { slate, revision } | null   one of the recipe's own slates
 *   mermaid(slateId, { canonical }) → string
 *   emit(type, data)    queued for after the run (validated now)
 *   quarantine(value)   enterprise/server/results.mjs
 *   retentionDays
 */
export function createRecipeContext({ instance, run, manifest, signal = null, clock = Date.now, budget, vendors = {}, ai, store, readSlate = async () => null, mermaid = async () => null, emit = () => {}, quarantine = (v) => v, retentionDays = 180 }) {
  const log = []
  const emitted = []
  let cursor = structuredClone(instance.cursor || {})
  let cursorChanged = false
  let ledgerWrites = 0
  const ledgerId = (key) => `${instance._id}:${String(key).slice(0, LEDGER_LIMITS.keyChars)}`
  const expires = () => new Date(clock() + retentionDays * 86400000)

  const ledger = {
    async get(key) {
      const row = await store.ledger.findOne({ _id: ledgerId(key) })
      return row && !row.tombstone ? row.data : null
    },
    async upsert(rows) {
      for (const { key, kind = 'item', data = {}, sourceRef = null, at = clock() } of rows || []) {
        ledgerWrites += 1
        if (ledgerWrites > LEDGER_LIMITS.rowsPerRun) throw Object.assign(new Error('A run writes at most 2000 ledger rows.'), { code: 'ledger_limit' })
        if (Buffer.byteLength(JSON.stringify(data)) > LEDGER_LIMITS.dataBytes) throw Object.assign(new Error('A ledger row holds at most 8 KB.'), { code: 'ledger_row' })
        await store.ledger.updateOne({ _id: ledgerId(key) }, { $set: { instanceId: instance._id, key: String(key).slice(0, LEDGER_LIMITS.keyChars), kind, data, sourceRef, at: new Date(at), expiresAt: expires(), tombstone: false } }, { upsert: true })
      }
    },
    async since(at, kind = null) {
      const rows = await store.ledger.find({ instanceId: instance._id, tombstone: false, at: { $gt: new Date(at) }, ...(kind && { kind }) }, { sort: { at: 1 }, limit: LEDGER_LIMITS.readRows }).toArray()
      return rows.map(({ key, kind: k, data, sourceRef, at: when }) => ({ key, kind: k, data, sourceRef, at: when }))
    },
    async tombstone(key) {
      await store.ledger.updateOne({ _id: ledgerId(key) }, { $set: { instanceId: instance._id, key, tombstone: true, at: new Date(clock()), expiresAt: expires() } }, { upsert: true })
    },
    async isTombstoned(key) {
      return Boolean((await store.ledger.findOne({ _id: ledgerId(key) }))?.tombstone)
    },
  }

  const ctx = Object.freeze({
    instance: Object.freeze({ id: instance._id, name: instance.name, config: structuredClone(instance.config || {}), cursor: structuredClone(instance.cursor || {}), projectId: instance.projectId }),
    run: Object.freeze({ id: run._id, trigger: structuredClone(run.trigger || { kind: 'manual' }), mode: run.mode }),
    signal,
    now: () => clock(),
    vendor: Object.freeze(Object.fromEntries(Object.entries(vendors).map(([name, session]) => [name, budgeted(session, budget, signal)]))),
    ai: Object.freeze({ json: (request) => ai.json(request) }),
    ledger: Object.freeze(ledger),
    slates: Object.freeze({ read: (role, key = '') => readSlate(role, key), mermaid: (slateId, options = { canonical: true }) => mermaid(slateId, options) }),
    setCursor(patch) {
      const next = { ...cursor, ...patch }
      if (Buffer.byteLength(JSON.stringify(next)) > CURSOR_BYTES) throw new CursorTooLarge()
      cursor = next
      cursorChanged = true
    },
    log(level, code, msg) {
      if (log.length < RECIPE_LIMITS.logLines) log.push(logLine(clock(), level, code, msg))
    },
    emit(type, data = {}) {
      const schema = eventSchema(type, manifest)
      if (!schema) throw new Error(`The recipe ${manifest.id} does not send ${type}; list it in its manifest's events.`)
      const invalid = validate(schema, data)
      if (invalid) throw new Error(`${type}: ${invalid.message}`)
      emitted.push({ type, data })
      emit(type, data)
    },
    quarantine,
    budget: Object.freeze({ left: () => budget.left() }),
  })
  return { ctx, log, emitted, cursor: () => cursor, cursorChanged: () => cursorChanged }
}
