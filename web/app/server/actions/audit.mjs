// The activity log's actions (server/audit): the team page (/team/audit), the server admin's page
// (/admin/audit) and a SIEM's pull, over the same checks (server/audit/service.mjs). A token
// needs audit:read and its person must be the team's owner or an admin. None of these is a client
// method or an MCP tool (exec-binding.mjs NEVER_BOUND): the log is the team admin's record, not
// something an agent reads while it works.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { AUDIT_ACTION_IDS, AUDIT_GROUPS, VIAS } from '../audit/events.mjs'

const TEAM = { type: 'string', pattern: '^(server|[A-Za-z0-9_-]{1,64})$', description: 'The team whose log to read (its id), or "server" for entries outside any team. Leave it out for your own team.' }
const TIME = { type: 'string', pattern: '^[0-9][0-9TZ:.+-]{9,34}$' }
const ACTION = {
  type: 'string',
  enum: [...Object.keys(AUDIT_GROUPS), ...AUDIT_ACTION_IDS],
  description: 'One action (slate.renamed) or a group of them (slates, sharing, members, exports, publishing, comments, agents, signin, sso, scim, log).',
}
const FILTERS = {
  team: TEAM,
  action: ACTION,
  actor: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$', description: 'Only what this account did (its id).' },
  slate: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$', description: 'Only entries about this slate (its share id).' },
  via: { type: 'string', enum: [...VIAS], description: 'Only what came through this door: app, api, mcp, exec, scim, sso or system.' },
  from: { ...TIME, description: 'From this time (included).' },
  to: { ...TIME, description: 'Until this time (not included).' },
  address: { type: 'string', pattern: '^[0-9A-Fa-f.:]{2,45}$', description: 'Only requests from this address. The log keeps a keyed hash of each address, never the address.' },
}
const EVENT = {
  type: 'object',
  properties: {
    seq: { type: 'integer' },
    at: { type: 'string' },
    action: { type: 'string' },
    summary: { type: 'string' },
    actor: { type: 'object' },
    target: { type: 'object' },
    slateId: { type: 'string' },
    via: { type: 'string' },
    addressHash: { type: 'string' },
    details: { type: 'object' },
    expiresAt: { type: 'string' },
    entryHash: { type: 'string' },
    chain: { type: 'string' },
  },
}

export const auditList = defineAction({
  id: 'audit.list',
  title: 'Activity log',
  description:
    "A team's activity log: who did what to which slate, through which door (app, api, mcp, exec, scim, sso), when, and a keyed hash of the address. Names and ids only: never note text, comments or prompts. Newest first; pass the answer's next as before for the page after. For a SIEM, pass after (a seq, 0 at first) to read oldest first from there, and keep the last next to ask again later. For the team's owner and admins (and administrators of this server).",
  toolset: 'team',
  kind: 'read',
  scope: 'audit:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/audit', operationId: 'listAuditEvents' } },
  input: {
    type: 'object',
    properties: {
      ...FILTERS,
      after: { type: 'integer', minimum: 0, description: 'Entries after this seq, oldest first.' },
      before: { type: 'integer', minimum: 1, description: 'Entries before this seq, newest first.' },
      limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
    },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      team: { type: 'string' },
      events: { type: 'array', items: EVENT },
      next: { type: ['integer', 'null'] },
      order: { type: 'string', enum: ['newest', 'oldest'] },
    },
    required: ['team', 'events', 'next', 'order'],
  },
  handler: async (principal, input, { deps }) => {
    if (input.after !== undefined && input.before !== undefined) throw problem(400, 'invalid_request', 'Send after or before, not both.')
    return deps.audit.list(principal, input)
  },
})

export const auditVerify = defineAction({
  id: 'audit.verify',
  title: 'Check the activity log',
  description:
    "Checks that a team's activity log is unbroken: every entry still matches its hash, none is missing, and each links to the one before. head is the newest sealed link: keep it outside Slatebox and compare it next time. Entries are sealed within a minute of being written (pending counts those not sealed yet).",
  toolset: 'team',
  kind: 'read',
  scope: 'audit:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/audit/verify', operationId: 'verifyAuditLog' } },
  input: { type: 'object', properties: { team: TEAM }, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      team: { type: 'string' },
      ok: { type: 'boolean' },
      checked: { type: 'integer' },
      firstSeq: { type: ['integer', 'null'] },
      headSeq: { type: ['integer', 'null'] },
      head: { type: ['string', 'null'] },
      since: { type: ['string', 'null'] },
      sealedSeq: { type: 'integer' },
      pending: { type: 'integer' },
      problem: { type: ['object', 'null'], properties: { seq: { type: 'integer' }, kind: { type: 'string', enum: ['edited', 'missing', 'chain', 'checkpoint'] } } },
      keptDays: { type: ['integer', 'null'], description: 'How many days entries are kept; null: until removed.' },
    },
    required: ['team', 'ok', 'checked', 'head', 'sealedSeq', 'pending'],
  },
  handler: (principal, input, { deps }) => deps.audit.verify(principal, input),
})

export const auditExport = defineAction({
  id: 'audit.export',
  title: 'Export the activity log',
  description:
    'A one-time address (10 minutes) to download the log, with the same filters as audit.list, as CSV or JSON: at most 100,000 entries, oldest first. A GET to downloadUrl downloads it. The export is itself an entry in the log.',
  toolset: 'team',
  kind: 'write',
  scope: 'audit:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/audit/export', operationId: 'exportAuditLog' } },
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { format: { type: 'string', enum: ['csv', 'json'], default: 'csv' }, ...FILTERS },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      downloadUrl: { type: 'string' },
      method: { type: 'string', enum: ['GET'] },
      format: { type: 'string' },
      expiresAt: { type: 'string' },
      team: { type: 'string' },
    },
    required: ['downloadUrl', 'method', 'format', 'expiresAt'],
  },
  handler: (principal, input, { deps }) => deps.audit.startExport(principal, input),
})

// The admin page's list of logs (/admin/audit), for an administrator of this server.
export const auditScopes = defineAction({
  id: 'audit.scopes',
  title: 'Activity logs on this server',
  description: 'Every activity log on this server with its number of entries: one per team, and this server\'s own. For an administrator of this server.',
  toolset: 'team',
  kind: 'read',
  principals: ['person'],
  mounts: { ddp: true },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { scopes: { type: 'array', items: { type: 'object' } } }, required: ['scopes'] },
  handler: (principal, _input, { deps }) => deps.audit.scopes(principal),
})

// A download the browser makes itself (a PNG, an SVG, a printed PDF): the page reports it, and
// the entry says so (reported: client). Once an hour per person, slate and format.
export const auditRecordDownload = defineAction({
  id: 'audit.recordDownload',
  title: 'Note a download',
  description: 'Notes in the activity log that this person downloaded a picture or a printout of a slate in the browser.',
  toolset: 'slates',
  kind: 'write',
  principals: ['person', 'guest'],
  mounts: { ddp: true },
  input: {
    type: 'object',
    properties: {
      shareId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' },
      format: { type: 'string', enum: ['png', 'svg', 'pdf'] },
    },
    required: ['shareId', 'format'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { noted: { type: 'boolean' } }, required: ['noted'] },
  handler: async (principal, input, { deps }) => ({ noted: await deps.auditDownloads.note(principal, input) }),
})

export default [auditList, auditVerify, auditExport, auditScopes, auditRecordDownload]
