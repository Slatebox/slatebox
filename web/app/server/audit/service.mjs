// Reading the activity log: who may read which log, the filters, the SIEM pull, the chain check
// and exports. Pure, with the stores and lookups passed in (server/audit/meteor.js passes the
// real ones; scripts/audit.test.mjs fakes). The actions in server/actions/audit.mjs call it.
//
// Who reads what:
//   a team's log    its owner and its admins (and their tokens with audit:read)
//   any log         an administrator of this server; on Slatebox Cloud that is Slatebox staff,
//                   and their opening a team's log is itself an entry in it (audit.viewedByStaff)
//   'server'        entries that belong to no team (a self-hosted server's people outside teams,
//                   and the server's own), for an administrator of this server
import { problem } from '../actions/errors.mjs'
import { AUDIT_ACTIONS, AUDIT_GROUPS, actionsInGroup } from './events.mjs'
import { publicEvent } from './export.mjs'

const TEAM = /^[A-Za-z0-9_-]{1,64}$/

export const AUDIT_WORDS = Object.freeze({
  notAdmin: "Only the team's owner and admins can read its activity log.",
  noTeam: 'You are not in a team. Make a team, or ask its owner to invite you.',
  gated: "Your team's plan does not include the activity log. Its entries are still kept.",
  noAddresses: 'This server keeps no address hashes, so it cannot check an address.',
  badAction: 'Choose an action or a group of actions from the log.',
  badTime: 'Times are written like 2026-11-27T10:00:00Z.',
})

const parseTime = (value, field) => {
  if (value === undefined) return undefined
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) throw problem(400, 'invalid_request', AUDIT_WORDS.badTime, { details: { field } })
  return time
}

/**
 * deps:
 *   store            store.mjs createAuditStore
 *   cloud            whether this is Slatebox Cloud
 *   teamPerson(userId)       → { orgId, isAdmin } | null
 *   isServerAdmin(userId)    → boolean
 *   securityOn(orgId)        → whether the team's plan includes the log (imports/api/common/team-security.mjs)
 *   hashAddress(scope, text) → hex | null
 *   record(entry, options)   the recorder (audit.record)
 *   origin()                 this server's address, for an export's download address
 *   teamNames(ids)           → Map id → name (the admin page's list)
 *   scopes()                 → [{ scope, seq }] every log with entries
 *   retention()              → days entries are kept, or null for ever
 */
export function createAuditService(deps) {
  async function readerScope(principal, team) {
    if (!principal?.userId || !['person', 'agent'].includes(principal.kind)) throw problem(403, 'forbidden', AUDIT_WORDS.notAdmin)
    if (team !== undefined && team !== 'server' && !TEAM.test(team)) throw problem(400, 'invalid_request', 'team is a team id or "server".', { details: { field: 'team' } })
    const person = (await deps.teamPerson(principal.userId)) || {}
    const serverAdmin = Boolean(await deps.isServerAdmin(principal.userId))
    const scope = team ?? person.orgId ?? (serverAdmin ? 'server' : null)
    if (!scope) throw problem(403, 'no_team', AUDIT_WORDS.noTeam)
    let staff = false
    if (scope === person.orgId && person.isAdmin) staff = false
    else if (serverAdmin) staff = deps.cloud
    else throw problem(403, 'forbidden', AUDIT_WORDS.notAdmin)
    if (scope !== 'server' && !(await deps.securityOn(scope))) throw problem(403, 'plan_required', AUDIT_WORDS.gated)
    // Slatebox staff opening a team's log: an entry in that log, once an hour.
    if (staff) {
      await deps.record({ scope, orgId: scope === 'server' ? undefined : scope, action: 'audit.viewedByStaff', actor: { kind: 'staff', userId: principal.userId }, target: { type: 'log' } }, { coalesce: true })
    }
    return { scope, staff }
  }

  function filterOf(scope, input) {
    const filter = {}
    if (input.action !== undefined) {
      if (Object.hasOwn(AUDIT_GROUPS, input.action)) filter.actions = actionsInGroup(input.action)
      else if (Object.hasOwn(AUDIT_ACTIONS, input.action)) filter.actions = [input.action]
      else throw problem(400, 'invalid_request', AUDIT_WORDS.badAction, { details: { field: 'action' } })
    }
    if (input.actor) filter.userId = input.actor
    if (input.slate) filter.slateId = input.slate
    if (input.via) filter.via = input.via
    filter.from = parseTime(input.from, 'from')
    filter.to = parseTime(input.to, 'to')
    if (input.address) {
      const hash = deps.hashAddress(scope, input.address)
      if (!hash) throw problem(400, 'unavailable', AUDIT_WORDS.noAddresses, { details: { field: 'address' } })
      filter.ipHash = hash
    }
    for (const key of Object.keys(filter)) if (filter[key] === undefined) delete filter[key]
    return filter
  }

  async function list(principal, input = {}) {
    const { scope } = await readerScope(principal, input.team)
    const page = await deps.store.list(scope, filterOf(scope, input), { after: input.after ?? null, before: input.before ?? null, limit: input.limit ?? 100 })
    return { team: scope, events: page.events.map(publicEvent), next: page.next ?? null, order: page.order }
  }

  async function verify(principal, input = {}) {
    const { scope } = await readerScope(principal, input.team)
    const result = await deps.store.verify(scope)
    return {
      team: scope,
      ok: result.ok,
      checked: result.checked,
      firstSeq: result.firstSeq,
      headSeq: result.headSeq,
      head: result.head,
      since: result.since ? new Date(result.since).toISOString() : null,
      sealedSeq: result.sealedSeq,
      pending: result.pending,
      problem: result.problem,
      keptDays: deps.retention ? deps.retention() : 365,
    }
  }

  async function startExport(principal, input = {}) {
    const { scope } = await readerScope(principal, input.team)
    const filter = filterOf(scope, input)
    const { ticket, expiresAt } = await deps.store.createExport({ scope, filter, format: input.format, userId: principal.userId })
    return { downloadUrl: new URL(`/audit-export/${ticket}`, deps.origin()).href, method: 'GET', format: input.format, expiresAt: expiresAt.toISOString(), team: scope }
  }

  // The admin page's list: every log on this server, for its administrator.
  async function scopes(principal) {
    if (!principal?.userId || !(await deps.isServerAdmin(principal.userId))) throw problem(403, 'forbidden', 'For an administrator of this server.')
    const rows = await deps.scopes()
    const names = await deps.teamNames(rows.map((row) => row.scope).filter((scope) => scope !== 'server'))
    return {
      scopes: rows.map((row) => ({ team: row.scope, name: row.scope === 'server' ? 'This server' : names.get(row.scope) || 'A deleted team', entries: row.seq })),
    }
  }

  return { readerScope, filterOf, list, verify, startExport, scopes }
}
