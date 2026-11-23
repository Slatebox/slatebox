// Export everything a team owns, and import such an export as a new team (server/team-export).
// The archive itself never passes through these actions: they hand out a one-time address
// (POST it to download the archive, or POST the archive to it), which also serves the app's
// buttons, the CLI and exec scripts. A refusal from the core (status and code) reaches the caller
// as an action error (errors.mjs toActionError).
import { defineAction } from './registry.mjs'

const importId = { type: 'string', pattern: '^[A-Za-z0-9]{1,40}$' }
const count = { type: 'object', properties: { created: { type: 'integer' }, skipped: { type: 'integer' } } }
// Who a confirmed import invited: emails sent, addresses that already have an account here (that
// person must agree to move), and addresses the source had not verified (teamImports.invite each
// once checked).
const invitedSchema = {
  type: 'object',
  properties: {
    sent: { type: 'integer' },
    needsConsent: { type: 'array', items: { type: 'string' } },
    mailDisabled: { type: 'integer' },
    unverified: { type: 'array', items: { type: 'string' } },
  },
}
const importSummary = {
  type: 'object',
  properties: {
    importId: { type: 'string' },
    state: { type: 'string', enum: ['running', 'pending', 'confirming', 'confirmed', 'discarding', 'discarded', 'failed'] },
    teamId: { type: 'string' },
    teamName: { type: 'string' },
    createdAt: { type: 'string' },
    expiresAt: { type: 'string' },
    failure: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } },
    invited: invitedSchema,
  },
  required: ['importId', 'state'],
}
const report = {
  type: 'object',
  description:
    'What the import made: the team, the source (instance, team, when, and whether a key this server knows signed it), counts per section with each skip and its reason, the people (placeholders until invited), the slates with their content hashes, the files, rewritten links, board rules switched off, AI connections (without keys) and the tokens to make again.',
  properties: {
    team: { type: 'object' },
    source: { type: 'object' },
    sections: { type: 'object', additionalProperties: count },
    people: { type: 'array', items: { type: 'object' } },
    slates: { type: 'array', items: { type: 'object' } },
    files: { type: 'object' },
    links: { type: 'object' },
    rulesSwitchedOff: { type: 'integer' },
    ai: { type: 'object' },
    tokens: { type: 'array', items: { type: 'object' } },
    skipped: { type: 'array', items: { type: 'object' } },
  },
}
const summarize = (record) => ({
  importId: record._id,
  state: record.state,
  ...(record.orgId && { teamId: record.orgId }),
  ...(record.teamName && { teamName: record.teamName }),
  ...(record.createdAt && { createdAt: new Date(record.createdAt).toISOString() }),
  ...(record.expiresAt && record.state === 'pending' && { expiresAt: new Date(record.expiresAt).toISOString() }),
  ...(record.failure && { failure: record.failure }),
  ...(record.invited && { invited: record.invited }),
})

export const teamExport = defineAction({
  id: 'team.export',
  title: 'Export your team',
  description:
    'For a team admin: a one-time address (15 minutes) to download everything the team owns as one archive, in the open team export format: slates with their boards and smart components, recent versions and events, comments, presentations, files, people and roles, published-link settings, AI connections (never keys) and the names and scopes of API tokens (never secrets). POST to downloadUrl to download; send a passphrase (form or JSON field "passphrase", the Slatebox-Export-Passphrase-Base64 header as base64url of its UTF-8 bytes, or the Slatebox-Export-Passphrase header when it is plain ASCII; at least 12 characters, not starting or ending with a space) to encrypt the archive. The archive is signed and checked; import it with teamImports.start on any Slatebox server.',
  toolset: 'team',
  kind: 'write',
  scope: 'team:export',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/team/export', operationId: 'exportTeam' } },
  // the whole team's content leaves the server: an agent's request waits for the person's yes
  confirm: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      downloadUrl: { type: 'string' },
      method: { type: 'string', enum: ['POST'] },
      expiresAt: { type: 'string' },
      team: { type: 'object', properties: { name: { type: 'string' } } },
      members: { type: 'integer' },
      slates: { type: 'integer' },
      passphrase: { type: 'object' },
      limits: { type: 'object' },
    },
    required: ['downloadUrl', 'method', 'expiresAt'],
  },
  tool: { name: 'export_team', title: 'Export your team', description: 'For a team admin: get a one-time download address (15 minutes) for everything the team owns as one archive (slates, boards, comments, presentations, files, people and roles; never keys or token secrets), to move the team to another Slatebox server or keep a copy. The person agrees first.' },
  cli: { command: 'team-export' },
  handler: (principal, _input, { deps }) => deps.teamTransfer.startExport(principal.userId),
})

export const teamImportsStart = defineAction({
  id: 'teamImports.start',
  title: 'Start an import',
  description:
    'For an administrator of this server: a one-time address (1 hour) to upload a team export to. POST the archive to uploadUrl as application/octet-stream, with its passphrase when it is encrypted: in the Slatebox-Export-Passphrase-Base64 header as base64url of its UTF-8 bytes (any passphrase), or in the Slatebox-Export-Passphrase header when it is plain ASCII. The upload becomes a new hidden team, with new ids for everything, people as placeholders who cannot sign in, slates private, board rules switched off, no keys and no tokens; the answer is the report. Confirm or discard it with teamImports.confirm or teamImports.discard; a pending import is discarded after 14 days.',
  toolset: 'team',
  kind: 'write',
  scope: 'team:import',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/team/imports', operationId: 'startTeamImport' } },
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      uploadUrl: { type: 'string' },
      method: { type: 'string', enum: ['POST'] },
      contentType: { type: 'string' },
      passphraseHeader: { type: 'string' },
      passphraseHeaderBase64: { type: 'string' },
      expiresAt: { type: 'string' },
      maxBytes: { type: 'integer' },
    },
    required: ['uploadUrl', 'method', 'expiresAt'],
  },
  tool: { name: 'start_team_import', title: 'Import a team', description: 'For an administrator of this server: get a one-time address (1 hour) to upload a team export to. The upload becomes a hidden team to check, then confirm_team_import or discard_team_import.' },
  cli: { command: 'team-import-start' },
  handler: (principal, _input, { deps }) => deps.teamTransfer.startImport(principal.userId),
})

export const teamImportsList = defineAction({
  id: 'teamImports.list',
  title: 'List imports',
  description: 'For an administrator of this server: recent team imports, pending ones first to confirm or discard.',
  toolset: 'team',
  kind: 'read',
  scope: 'team:import',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/team/imports', operationId: 'listTeamImports' } },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { imports: { type: 'array', items: importSummary } }, required: ['imports'] },
  tool: { name: 'list_team_imports', title: 'List team imports', description: 'For an administrator of this server: list recent team imports, pending ones first.' },
  cli: { command: 'team-imports' },
  handler: (principal, _input, { deps }) =>
    deps.teamTransfer.listImports(principal.userId).then((records) => ({ imports: records.map(summarize) })),
})

export const teamImportsGet = defineAction({
  id: 'teamImports.get',
  title: 'Read an import',
  description: 'For an administrator of this server: one import, with its report while it is pending or confirmed.',
  toolset: 'team',
  kind: 'read',
  scope: 'team:import',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/team/imports/{importId}', operationId: 'getTeamImport' } },
  input: { type: 'object', properties: { importId }, required: ['importId'], additionalProperties: false },
  output: { type: 'object', properties: { ...importSummary.properties, report }, required: ['importId', 'state'] },
  tool: { name: 'get_team_import', title: 'Read a team import', description: 'For an administrator of this server: read one team import and its report.' },
  cli: { command: 'team-import' },
  async handler(principal, input, { deps }) {
    const record = await deps.teamTransfer.getImport(principal.userId, input.importId)
    return { ...summarize(record), ...(record.report && { report: record.report }) }
  },
})

export const teamImportsConfirm = defineAction({
  id: 'teamImports.confirm',
  title: 'Confirm an import',
  description:
    'For an administrator of this server: makes a pending import\'s team live. Its slates and presentations get back the visibility they had (public, unlisted or private). With invite true, each person whose address the source had verified, and no account here uses in any letter case, gets an email to claim their placeholder; the answer lists addresses that already have an account (they must agree to move) and addresses the source had not verified (invite each with teamImports.invite once you have checked it). Board rules stay switched off until a team admin reviews them.',
  toolset: 'team',
  kind: 'write',
  scope: 'team:import',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/team/imports/{importId}/confirm', operationId: 'confirmTeamImport' } },
  confirm: true,
  idempotency: 'optional',
  replay: 'stored',
  successStatus: 200,
  input: { type: 'object', properties: { importId, invite: { type: 'boolean', default: false } }, required: ['importId'], additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      importId: { type: 'string' },
      state: { type: 'string', enum: ['confirmed'] },
      teamId: { type: 'string' },
      invited: invitedSchema,
    },
    required: ['importId', 'state', 'teamId'],
  },
  tool: { name: 'confirm_team_import', title: 'Make an imported team live', description: 'For an administrator of this server: make a pending imported team live, and optionally email its people to claim their accounts. The person agrees first.' },
  cli: { command: 'team-import-confirm' },
  handler: (principal, input, { deps }) => deps.teamTransfer.confirmImport(principal.userId, input.importId, { invite: input.invite }),
})

export const teamImportsInvite = defineAction({
  id: 'teamImports.invite',
  title: 'Invite a person',
  description:
    'For an administrator of this server: after you have checked an address that a confirmed import listed as unverified (the source had not verified it), sends that person the email to claim their placeholder. An address any account here already uses, in any letter case, is not invited: that person must agree to move.',
  toolset: 'team',
  kind: 'write',
  scope: 'team:import',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/team/imports/{importId}/invite', operationId: 'inviteTeamImportPerson' } },
  // an email goes to an address only the archive vouched for: an agent's request waits for a yes
  confirm: true,
  idempotency: 'optional',
  replay: 'stored',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { importId, email: { type: 'string', minLength: 3, maxLength: 320 } },
    required: ['importId', 'email'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      importId: { type: 'string' },
      email: { type: 'string' },
      outcome: { type: 'string', enum: ['sent', 'needs_consent', 'mail_disabled', 'already_invited'] },
    },
    required: ['importId', 'email', 'outcome'],
  },
  tool: { name: 'invite_team_import_person', title: 'Invite one imported person', description: 'For an administrator of this server: email one person from a confirmed team import whose address you have checked, so they can claim their account. The person agrees first.' },
  cli: { command: 'team-import-invite' },
  handler: (principal, input, { deps }) => deps.teamTransfer.inviteImported(principal.userId, input.importId, input.email),
})

export const teamImportsDiscard = defineAction({
  id: 'teamImports.discard',
  title: 'Discard an import',
  description: 'For an administrator of this server: deletes a pending import\'s hidden team and everything the import wrote (slates, files, people, settings).',
  toolset: 'team',
  kind: 'write',
  scope: 'team:import',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/team/imports/{importId}/discard', operationId: 'discardTeamImport' } },
  destructive: true,
  idempotency: 'optional',
  replay: 'stored',
  successStatus: 200,
  input: { type: 'object', properties: { importId }, required: ['importId'], additionalProperties: false },
  output: { type: 'object', properties: { importId: { type: 'string' }, state: { type: 'string', enum: ['discarded'] } }, required: ['importId', 'state'] },
  tool: { name: 'discard_team_import', title: 'Discard a team import', description: 'For an administrator of this server: delete a pending imported team and everything the import wrote.' },
  cli: { command: 'team-import-discard' },
  handler: (principal, input, { deps }) => deps.teamTransfer.discardImport(principal.userId, input.importId),
})

export default [teamExport, teamImportsStart, teamImportsList, teamImportsGet, teamImportsConfirm, teamImportsInvite, teamImportsDiscard]
