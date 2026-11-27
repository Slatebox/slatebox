// audit.record(): the one way anything adds to the activity log. Single sign-on, SCIM, the
// registry, the save core and the plain Meteor methods all call it. It never throws and never
// fails the action it records: an entry that cannot be written is logged to the server's log.
//
//   audit.record({
//     action: 'slate.renamed',                   // an id from events.mjs AUDIT_ACTIONS
//     target: { type: 'slate', id, name },        // what it was done to
//     slateId, orgId,                             // the slate (its share id) and team, when known
//     details: { from, to },                      // only the keys events.mjs DETAIL_KEYS allows
//     actor, via, address,                        // optional: taken from the running call when left out
//     scope,                                      // optional: 'server' for a server-wide entry
//   }, { coalesce: true })                        // one per actor per slate per hour
//
// The running call (the registry's run, a Meteor method through ddp.mjs, an /api/v1 request)
// is carried in an AsyncLocalStorage context: who calls (the principal), through which door
// (via) and from which address. The Meteor side (meteor.js) plugs in the sink that resolves the
// team, the person's name and the address hash, and writes the entry (store.mjs).
//
// deferred: an entry made inside a database transaction (a save with a session) waits in the
// context and is written only when the registry's run succeeds, so an aborted transaction leaves
// no entry for a change that never happened.
import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage()
let sink = null
let logError = (error, entry) => console.error('[audit] entry not written', entry?.action, error?.message || error) // eslint-disable-line no-console

// Through which door a principal's call came. MCP marks its principal (server/mcp/endpoint.mjs);
// a script's calls carry the run they belong to (server/exec/gate.mjs).
export function viaOf(principal, context = null) {
  if (principal?.via === 'mcp') return 'mcp'
  if (principal?.runId) return 'exec'
  if (context?.via) return context.via
  if (principal?.kind === 'agent') return 'api'
  return 'app'
}

// Who a principal is, as an entry names them.
export function actorOf(principal) {
  if (!principal) return null
  const kind = principal.kind === 'visitor' ? 'guest' : principal.kind
  return {
    kind,
    ...(principal.userId && { userId: principal.userId }),
    ...(principal.tokenId && { tokenId: principal.tokenId }),
    ...(principal.tokenName && { tokenName: principal.tokenName }),
  }
}

export const auditContext = () => storage.getStore() || null

/** Runs fn(context) with these facts added to the running call's context. */
export function withAuditContext(patch, fn) {
  const next = { ...(storage.getStore() || {}), ...patch }
  return storage.run(next, () => fn(next))
}

/** The entry with the running call's actor, door and address filled in where it names none. */
export function completeEntry(entry, context = auditContext()) {
  const principal = context?.principal || null
  return {
    ...entry,
    // No principal (a plain Meteor method): the sink names the method's caller, else Slatebox.
    actor: entry.actor || actorOf(principal) || null,
    via: entry.via || viaOf(principal, context),
    ...(entry.address === undefined && context?.address && { address: context.address }),
  }
}

async function write(entry, options) {
  if (!sink) return null
  try {
    return await sink(entry, options)
  } catch (error) {
    try {
      logError(error, entry)
    } catch {
      // nothing more to do: the log's own report failed too
    }
    return null
  }
}

export const audit = Object.freeze({
  /** Adds an entry (see the top of this file). Resolves when it is written; never rejects. */
  record(entry, options = {}) {
    const context = auditContext()
    const full = completeEntry(entry, context)
    if (context?.recorded) context.recorded.push(full.action)
    if (options.deferred && context?.pending) {
      context.pending.push([full, options])
      return Promise.resolve(null)
    }
    return write(full, options)
  },
  /** Writes what a successful run held back (deferred entries), once each. */
  async flush(context = auditContext()) {
    if (!context?.pending?.length) return
    const seen = new Set()
    const held = context.pending.splice(0)
    for (const [entry, options] of held) {
      const key = `${entry.action}|${entry.target?.id || ''}|${entry.slateId || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      await write(entry, options)
    }
  },
  /** Drops what a failed run held back. */
  discard(context = auditContext()) {
    if (context?.pending) context.pending.splice(0)
  },
  /** The Meteor side's writer: (entry, options) => Promise. null turns recording off (tests). */
  configure(next, { onError } = {}) {
    sink = next
    if (onError) logError = onError
  },
  get configured() {
    return Boolean(sink)
  },
})
