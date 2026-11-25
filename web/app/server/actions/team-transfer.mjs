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
// asked: addresses whose account here was emailed an invitation to join, which they accept signed
// in (teamMove.join); joined: those who accepted.
const invitedSchema = {
  type: 'object',
  properties: {
    sent: { type: 'integer' },
    needsConsent: { type: 'array', items: { type: 'string' } },
    mailDisabled: { type: 'integer' },
    unverified: { type: 'array', items: { type: 'string' } },
    asked: { type: 'array', items: { type: 'string' } },
    joined: { type: 'array', items: { type: 'string' } },
  },
}
// What a confirm did with the library items: each went to this server's review queue.
const librarySchema = { type: 'object', properties: { submitted: { type: 'integer' } } }
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
    library: librarySchema,
    kind: { type: 'string', enum: ['move'], description: 'A move: the team\'s own owner moved it here (teamMove.*).' },
    movedBy: { type: 'string', description: 'Who moved it here (their address), for administrators.' },
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
  ...(record.library && { library: record.library }),
  ...(record.move && { kind: 'move' }),
  ...(record.movedBy && { movedBy: record.movedBy }),
})

export const teamExport = defineAction({
  id: 'team.export',
  title: 'Export team',
  description:
    'For a team admin: a one-time address (15 minutes) to download everything the team owns as one archive, in the open team export format: slates with their boards and smart components, recent versions and events, comments, presentations, files, people and roles, published-link settings, AI connections (never keys) and the names and scopes of API tokens (never secrets). A POST to downloadUrl downloads it; a passphrase (form or JSON field "passphrase", the Slatebox-Export-Passphrase-Base64 header as base64url of its UTF-8 bytes, or the Slatebox-Export-Passphrase header when it is plain ASCII; at least 12 characters, not starting or ending with a space) encrypts the archive. The archive is signed and checked; teamImports.start imports it on any Slatebox server.',
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
  handler: (principal, _input, { deps }) => deps.teamTransfer.startExport(principal.userId),
})

export const teamImportsStart = defineAction({
  id: 'teamImports.start',
  title: 'Start import',
  description:
    'For an administrator of this server: a one-time address (1 hour) to upload a team export to. uploadUrl takes the archive as a POST of application/octet-stream, with its passphrase when it is encrypted: in the Slatebox-Export-Passphrase-Base64 header as base64url of its UTF-8 bytes (any passphrase), or in the Slatebox-Export-Passphrase header when it is plain ASCII. The upload becomes a new hidden team, with new ids for everything, people as placeholders who cannot sign in, slates private, board rules switched off, no keys and no tokens; the answer is the report. teamImports.confirm or teamImports.discard confirms or discards it; a pending import is discarded after 14 days.',
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
  tool: { name: 'start_team_import', title: 'Import a team', description: 'For an administrator of this server: get a one-time address (1 hour) to upload a team export to. The upload becomes a hidden team to check, which confirm_team_import makes live or discard_team_import deletes.' },
  handler: (principal, _input, { deps }) => deps.teamTransfer.startImport(principal.userId),
})

export const teamImportsList = defineAction({
  id: 'teamImports.list',
  title: 'Imports',
  description: 'For an administrator of this server: recent team imports, pending ones first to confirm or discard.',
  toolset: 'team',
  kind: 'read',
  scope: 'team:import',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/team/imports', operationId: 'listTeamImports' } },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { imports: { type: 'array', items: importSummary } }, required: ['imports'] },
  tool: { name: 'list_team_imports', title: 'List team imports', description: 'For an administrator of this server: list recent team imports, pending ones first.' },
  handler: (principal, _input, { deps }) =>
    deps.teamTransfer.listImports(principal.userId).then((records) => ({ imports: records.map(summarize) })),
})

export const teamImportsGet = defineAction({
  id: 'teamImports.get',
  title: 'Import',
  description: 'For an administrator of this server: one import, with its report while it is pending or confirmed.',
  toolset: 'team',
  kind: 'read',
  scope: 'team:import',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/team/imports/{importId}', operationId: 'getTeamImport' } },
  input: { type: 'object', properties: { importId }, required: ['importId'], additionalProperties: false },
  output: { type: 'object', properties: { ...importSummary.properties, report }, required: ['importId', 'state'] },
  tool: { name: 'get_team_import', title: 'Read a team import', description: 'For an administrator of this server: read one team import and its report.' },
  async handler(principal, input, { deps }) {
    const record = await deps.teamTransfer.getImport(principal.userId, input.importId)
    return { ...summarize(record), ...(record.report && { report: record.report }) }
  },
})

export const teamImportsConfirm = defineAction({
  id: 'teamImports.confirm',
  title: 'Confirm import',
  description:
    'For an administrator of this server: makes a pending import\'s team live. Its slates and presentations get back the visibility they had (public, unlisted or private). With invite true, each person whose address the source had verified, and no account here uses in any letter case, gets an email to claim their placeholder; the answer lists addresses that already have an account (they must agree to move) and addresses the source had not verified (teamImports.invite invites each once its address is checked). Board rules stay switched off until a team admin reviews them.',
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
      library: librarySchema,
    },
    required: ['importId', 'state', 'teamId'],
  },
  tool: { name: 'confirm_team_import', title: 'Make an imported team live', description: 'For an administrator of this server: make a pending imported team live, and optionally email its people to claim their accounts. The person agrees first.' },
  handler: (principal, input, { deps }) => deps.teamTransfer.confirmImport(principal.userId, input.importId, { invite: input.invite }),
})

export const teamImportsInvite = defineAction({
  id: 'teamImports.invite',
  title: 'Invite person',
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
      outcome: { type: 'string', enum: ['sent', 'asked', 'needs_consent', 'mail_disabled', 'already_invited'] },
    },
    required: ['importId', 'email', 'outcome'],
  },
  tool: { name: 'invite_team_import_person', title: 'Invite one imported person', description: 'For an administrator of this server: email one person from a confirmed team import whose address you have checked, so they can claim their account. The person agrees first.' },
  handler: (principal, input, { deps }) => deps.teamTransfer.inviteImported(principal.userId, input.importId, input.email),
})

export const teamImportsDiscard = defineAction({
  id: 'teamImports.discard',
  title: 'Discard import',
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
  handler: (principal, input, { deps }) => deps.teamTransfer.discardImport(principal.userId, input.importId),
})

// ---- Moves: a team's own owner moves it here (team-export/transfer.mjs startMove).
const moveSummary = (record) => ({
  ...summarize(record),
  into: record.move?.intoOrgId ? 'your_team' : 'new_team',
  ...(record.seats && { seats: record.seats }),
  ...(record.settings && { settings: record.settings }),
})
const moveSummarySchema = {
  type: 'object',
  properties: {
    ...importSummary.properties,
    into: { type: 'string', enum: ['your_team', 'new_team'] },
    seats: { type: 'object' },
    settings: { type: 'string', enum: ['imported', 'kept_yours'] },
  },
  required: ['importId', 'state'],
}

export const teamMoveStart = defineAction({
  id: 'teamMove.start',
  title: 'Move a team here',
  description:
    'For the owner of a team on this server, or a signed-in person in no team yet: a one-time address (1 hour) to upload a team export from another Slatebox server, to move that team here. At most 3 moves a day per person (429 move_limit). uploadUrl takes the archive as a POST of application/octet-stream (at most maxBytes uncompressed), with its passphrase when it is encrypted (Slatebox-Export-Passphrase-Base64 header as base64url of its UTF-8 bytes, or Slatebox-Export-Passphrase when it is plain ASCII). The answer is the report of a pending move: nothing is visible to anyone until teamMove.confirm. into says where it lands: your_team (it joins the team you own) or new_team (it becomes your team). The same archive uploaded again answers with the first move. One move waits at a time.',
  toolset: 'team',
  kind: 'write',
  scope: 'team:move',
  principals: ['person', 'agent'],
  mounts: { ddp: false, http: { method: 'POST', path: '/team/moves', operationId: 'startTeamMove' } },
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
      into: { type: 'string', enum: ['your_team', 'new_team'] },
    },
    required: ['uploadUrl', 'method', 'expiresAt', 'into'],
  },
  tool: { name: 'start_team_move', title: 'Move a team here', description: 'For a team owner, or someone in no team yet: get a one-time address (1 hour) to upload a team export from another Slatebox server. It waits as a pending move that only you see until you confirm it.' },
  handler: (principal, _input, { deps }) => deps.teamTransfer.startMove(principal.userId),
})

export const teamMoveList = defineAction({
  id: 'teamMove.list',
  title: 'My moves',
  description: 'Your own team moves here, newest first: the one waiting to confirm, and those done or failed.',
  toolset: 'team',
  kind: 'read',
  scope: 'team:move',
  principals: ['person', 'agent'],
  mounts: { ddp: false, http: { method: 'GET', path: '/team/moves', operationId: 'listTeamMoves' } },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { moves: { type: 'array', items: moveSummarySchema } }, required: ['moves'] },
  tool: { name: 'list_team_moves', title: 'List my team moves', description: 'List your own team moves to this server, newest first.' },
  handler: (principal, _input, { deps }) => deps.teamTransfer.listMoves(principal.userId).then((records) => ({ moves: records.map(moveSummary) })),
})

export const teamMoveGet = defineAction({
  id: 'teamMove.get',
  title: 'Move',
  description: 'One of your own team moves, with its report: what will arrive, what was left out and why.',
  toolset: 'team',
  kind: 'read',
  scope: 'team:move',
  principals: ['person', 'agent'],
  mounts: { ddp: false, http: { method: 'GET', path: '/team/moves/{importId}', operationId: 'getTeamMove' } },
  input: { type: 'object', properties: { importId }, required: ['importId'], additionalProperties: false },
  output: { type: 'object', properties: { ...moveSummarySchema.properties, report }, required: ['importId', 'state'] },
  tool: { name: 'get_team_move', title: 'Read a team move', description: 'Read one of your own team moves and its report.' },
  async handler(principal, input, { deps }) {
    const record = await deps.teamTransfer.getMove(principal.userId, input.importId)
    return { ...moveSummary(record), ...(record.report && { report: record.report }) }
  },
})

export const teamMoveConfirm = defineAction({
  id: 'teamMove.confirm',
  title: 'Confirm move',
  description:
    'Confirms your pending move. In no team: the moved team goes live and you become its owner. As a team owner: its slates, presentations, people (as placeholders) and library drafts join your team; your brand kit and agent choices stay, and the moved ones are used only when your team has none. You take the seat of the moved person with your verified address (else of its owner); someone already in your team takes the seat with their address. With invite true, every other person whose address the source had verified gets an email to claim their account; someone who already has an account here gets an invitation to join instead, which they accept signed in (teamMove.join). Nobody gets an account they can sign in to, or joins, without that email; teamMove.invite sends them later. Library items go to this server\'s review queue (submitted, waiting for its approval). Slates get back their visibility; board rules stay switched off until reviewed; keys, tokens and agent connections are never moved.',
  toolset: 'team',
  kind: 'write',
  scope: 'team:move',
  principals: ['person', 'agent'],
  mounts: { ddp: false, http: { method: 'POST', path: '/team/moves/{importId}/confirm', operationId: 'confirmTeamMove' } },
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
      merged: { type: 'boolean' },
      seats: { type: 'object' },
      settings: { type: 'string', enum: ['imported', 'kept_yours'] },
      invited: invitedSchema,
      library: librarySchema,
    },
    required: ['importId', 'state', 'teamId'],
  },
  tool: { name: 'confirm_team_move', title: 'Confirm a team move', description: 'Confirm your pending team move: the team becomes yours, or joins the team you own, and optionally its people are emailed to claim their accounts. The person agrees first.' },
  handler: (principal, input, { deps }) => deps.teamTransfer.confirmMove(principal.userId, input.importId, { invite: input.invite }),
})

export const teamMoveInvite = defineAction({
  id: 'teamMove.invite',
  title: 'Invite moved people',
  description:
    'After your move is confirmed: emails the moved people nobody invited yet, whose address the source had verified (an enrollment to claim their account, or, when an account here already has the address, an invitation to join that they accept signed in). With email, invites that one person once you have checked their address (one the source had not verified).',
  toolset: 'team',
  kind: 'write',
  scope: 'team:move',
  principals: ['person', 'agent'],
  mounts: { ddp: false, http: { method: 'POST', path: '/team/moves/{importId}/invite', operationId: 'inviteTeamMovePeople' } },
  // emails go out: an agent's request waits for the person's yes
  confirm: true,
  idempotency: 'optional',
  replay: 'stored',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { importId, email: { type: 'string', minLength: 3, maxLength: 320 } },
    required: ['importId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      importId: { type: 'string' },
      state: { type: 'string' },
      invited: invitedSchema,
      now: invitedSchema,
      email: { type: 'string' },
      outcome: { type: 'string', enum: ['sent', 'asked', 'needs_consent', 'mail_disabled', 'already_invited'] },
    },
    required: ['importId'],
  },
  tool: { name: 'invite_team_move_people', title: 'Invite the people of a moved team', description: 'After your team move is confirmed, email its people who were not invited yet so they can claim their accounts (or join, if they already have one here). The person agrees first.' },
  handler: (principal, input, { deps }) => deps.teamTransfer.inviteMoved(principal.userId, input.importId, { email: input.email || null }),
})

export const teamMoveJoin = defineAction({
  id: 'teamMove.join',
  title: 'Join a moved team',
  description:
    'For someone who already has an account here and was invited to join a team that moved here: accepts the invitation (its token, from the email link). Signed in as the account the invitation was sent to, in no team or already in that team, you take your seat: your slates and comments from the old server become yours, and in no team you join it.',
  toolset: 'team',
  kind: 'write',
  scope: null,
  principals: ['person'],
  mounts: { ddp: true },
  idempotency: 'optional',
  replay: 'stored',
  successStatus: 200,
  input: { type: 'object', properties: { token: { type: 'string', minLength: 20, maxLength: 100 } }, required: ['token'], additionalProperties: false },
  output: { type: 'object', properties: { importId: { type: 'string' }, teamId: { type: 'string' }, teamName: { type: ['string', 'null'] } }, required: ['teamId'] },
  handler: (principal, input, { deps }) => deps.teamTransfer.joinMoved(principal.userId, input.token),
})

export const teamMoveDiscard = defineAction({
  id: 'teamMove.discard',
  title: 'Discard move',
  description: 'Discards your pending move: everything it wrote (slates, files, people, settings, library drafts) is deleted. A pending move nobody confirms is discarded after 14 days.',
  toolset: 'team',
  kind: 'write',
  scope: 'team:move',
  principals: ['person', 'agent'],
  mounts: { ddp: false, http: { method: 'POST', path: '/team/moves/{importId}/discard', operationId: 'discardTeamMove' } },
  destructive: true,
  idempotency: 'optional',
  replay: 'stored',
  successStatus: 200,
  input: { type: 'object', properties: { importId }, required: ['importId'], additionalProperties: false },
  output: { type: 'object', properties: { importId: { type: 'string' }, state: { type: 'string', enum: ['discarded'] } }, required: ['importId', 'state'] },
  tool: { name: 'discard_team_move', title: 'Discard a team move', description: 'Delete your pending team move and everything it wrote.' },
  handler: (principal, input, { deps }) => deps.teamTransfer.discardMove(principal.userId, input.importId),
})

export default [teamExport, teamImportsStart, teamImportsList, teamImportsGet, teamImportsConfirm, teamImportsInvite, teamImportsDiscard, teamMoveStart, teamMoveList, teamMoveGet, teamMoveConfirm, teamMoveInvite, teamMoveJoin, teamMoveDiscard]
