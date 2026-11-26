// Who may export and import, and the one-time addresses the archive travels through. The
// actions (server/actions/team-*.mjs) and the HTTP routes (routes.mjs) both call this.
//
// Export: a team admin (the person, or a token of theirs with team:export) asks for an export
// and gets a download address that works once, for 15 minutes, for that person and team only.
// The archive is written while it downloads. Import: a server administrator (or a token of theirs
// with team:import) asks for an upload address that works once, for an hour; the upload is read
// as it arrives into a new hidden team. A ticket is stored by its hash only.
//
// Move: the owner of a team (or someone in no team yet) moves a team here themselves, without an
// administrator of this server: Slatebox Cloud to their own server, or their own server to Cloud.
// They ask for a move address (one hour, single use), upload the archive (within MOVE_LIMITS), read
// the report, and confirm or discard it. Only they see or act on their move. The archive lands in
// the same hidden team an administrator's import makes; confirming makes it theirs (import-core
// confirmMove). The other people are invited only when the mover asks (then, or later with
// inviteMoved). Nobody at this server reviews a move first: the size limit and the hostile-archive
// checks hold, a person starts at most MOVES_PER_DAY moves a day, and every step is written to the
// administrators' audit (audit) and listed with the imports.
import { createHash, randomBytes } from 'node:crypto'
import { readArchive, writeArchive, checkPassphrase, MIN_PASSPHRASE } from './archive.mjs'
import { LIMITS } from './format.mjs'
import { ImportError } from './import-core.mjs'

// A passphrase that is not plain ASCII cannot travel in a header as text: this header carries it
// as base64url of its UTF-8 bytes (routes.mjs).
export const PASSPHRASE_HEADER_BASE64 = 'Slatebox-Export-Passphrase-Base64'
export const EXPORT_TICKET_MS = 15 * 60 * 1000
export const IMPORT_TICKET_MS = 60 * 60 * 1000
export const MOVE_TICKET_MS = 60 * 60 * 1000
// A move is self-serve, so it holds less than an administrator's import: 2 GiB uncompressed.
export const MOVE_LIMITS = Object.freeze({ ...LIMITS, totalBytes: 2 * 1024 ** 3 })
// Moves a person may start here in a day (each upload counts, confirmed, discarded or failed; the
// same archive sent again does not).
export const MOVES_PER_DAY = 3
const DAY_MS = 24 * 60 * 60 * 1000

const hashTicket = (ticket) => createHash('sha256').update(String(ticket)).digest('hex')
const refused = (status, code, message) => new ImportError(status, code, message)

export function createTicketStore({ collection, now = Date.now, random = randomBytes }) {
  return {
    async issue({ kind, userId, orgId = null, ttlMs }) {
      const ticket = random(32).toString('base64url')
      const expiresAt = new Date(now() + ttlMs)
      await collection.insertOne({ _id: hashTicket(ticket), kind, userId, orgId, createdAt: new Date(now()), expiresAt, usedAt: null })
      return { ticket, expiresAt }
    },
    // Single use: the first request that presents the ticket takes it.
    async redeem(ticket, kind) {
      if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(ticket)) return null
      const _id = hashTicket(ticket)
      const found = await collection.findOne({ _id, kind, usedAt: null })
      if (!found || found.expiresAt.valueOf() <= now()) return null
      const taken = await collection.updateOne({ _id, usedAt: null }, { $set: { usedAt: new Date(now()) } })
      return taken.modifiedCount === 1 ? found : null
    },
  }
}

/**
 * exporter, importer: export-core and import-core. tickets: createTicketStore.
 * loadUser(id) → { _id, orgId, isAnonymous, isOrgOwner, emails } | null. isTeamAdmin(user) and isServerAdmin(userId) → boolean.
 * signer: { privateKey, publicKey } for the archive's signature, or a function giving it. instance: { origin, name }.
 * audit(entry): one row of the administrators' audit trail ({ type, userId, ... }); movesPerDay: the daily limit.
 */
export function createTeamTransfer({ exporter, importer, tickets, loadUser, isTeamAdmin, isServerAdmin, signer = null, instance, limits = LIMITS, moveLimits = MOVE_LIMITS, movesPerDay = MOVES_PER_DAY, audit = async () => {}, now = Date.now, log = () => {} }) {
  const auditRow = (entry) => Promise.resolve(audit(entry)).catch((error) => log('team move audit failed', { type: entry.type, error: error?.message }))
  async function teamAdmin(userId) {
    const user = userId && (await loadUser(userId))
    if (!user || user.isAnonymous) throw refused(403, 'forbidden', 'Sign in to export your team.')
    if (!user.orgId) throw refused(404, 'no_team', 'You are not in a team. Export your slates from each slate instead.')
    if (!(await isTeamAdmin(user))) throw refused(403, 'team_admin_required', 'Only a team admin can export everything.')
    return user
  }
  async function serverAdmin(userId) {
    if (!userId || !(await isServerAdmin(userId))) throw refused(403, 'admin_required', 'Only an administrator of this server can import a team.')
  }

  async function startExport(userId) {
    const user = await teamAdmin(userId)
    const summary = await exporter.preflight(user.orgId)
    if (!summary) throw refused(404, 'no_team', 'Your team was not found.')
    const { ticket, expiresAt } = await tickets.issue({ kind: 'export', userId: user._id, orgId: user.orgId, ttlMs: EXPORT_TICKET_MS })
    log('team export issued', { userId: user._id, orgId: user.orgId })
    return {
      downloadUrl: new URL('/team-transfer/export/' + ticket, instance.origin).href,
      method: 'POST',
      expiresAt: expiresAt.toISOString(),
      team: summary.team,
      members: summary.members,
      slates: summary.slates,
      passphrase: { minLength: MIN_PASSPHRASE, field: 'passphrase', header: 'Slatebox-Export-Passphrase', headerBase64: PASSPHRASE_HEADER_BASE64 },
      limits: summary.limits,
    }
  }

  // The archive for a download address, or an ImportError. The team admin is checked again: one
  // who left the team, or lost the role, since asking gets nothing.
  // onEnd(end): told the archive's end record ({ lines, bytes, counts }) once it is written (a move
  // from this server compares the counts with what the receiving server made: server/selfhost-options).
  async function openExport(ticket, passphrase, { onEnd = null } = {}) {
    const record = await tickets.redeem(ticket, 'export')
    if (!record) throw refused(404, 'ticket_invalid', 'This download address is used or expired. Ask for a new export.')
    const user = await teamAdmin(record.userId)
    if (user.orgId !== record.orgId) throw refused(403, 'team_admin_required', 'You are no longer in the team this export was for.')
    checkPassphrase(passphrase, { writing: true })
    const team = await exporter.preflight(record.orgId)
    const skipped = []
    const stamp = new Date(now()).toISOString()
    const stream = writeArchive(exporter.records(record.orgId, { skipped }), {
      head: { createdAt: stamp, source: { instance: instance.origin, name: instance.name, team: team?.team?.name ?? '' }, encrypted: Boolean(passphrase) },
      passphrase: passphrase || null,
      signer: typeof signer === 'function' ? signer() : signer,
      limits,
      onEnd: (end) => {
        log('team export written', { orgId: record.orgId, lines: end.lines, bytes: end.bytes })
        onEnd?.(end)
      },
    })
    const slug = String(team?.team?.name || 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'team'
    return { stream, filename: `${slug}-${stamp.slice(0, 10)}.${passphrase ? 'sbxteam' : 'sbxteam.gz'}` }
  }

  async function startImport(userId) {
    await serverAdmin(userId)
    const { ticket, expiresAt } = await tickets.issue({ kind: 'import', userId, ttlMs: IMPORT_TICKET_MS })
    return {
      uploadUrl: new URL('/team-transfer/import/' + ticket, instance.origin).href,
      method: 'POST',
      contentType: 'application/octet-stream',
      passphraseHeader: 'Slatebox-Export-Passphrase',
      passphraseHeaderBase64: PASSPHRASE_HEADER_BASE64,
      expiresAt: expiresAt.toISOString(),
      maxBytes: limits.totalBytes,
    }
  }

  async function receiveImport(ticket, body, passphrase) {
    const record = await tickets.redeem(ticket, 'import')
    if (!record) throw refused(404, 'ticket_invalid', 'This upload address is used or expired. Ask for a new one.')
    await serverAdmin(record.userId)
    const result = await importer.importArchive(readArchive(body, { passphrase: passphrase || null, limits }), { actorUserId: record.userId })
    log('team import pending', { importId: result.importId, by: record.userId })
    return result
  }

  // Who may move a team here: a signed-in person in no team (the moved team becomes theirs) or the
  // owner of their team (it joins that team).
  async function mover(userId) {
    const user = userId && (await loadUser(userId))
    if (!user || user.isAnonymous) throw refused(403, 'forbidden', 'Sign in to move a team here.')
    if (user.orgId && !(user.isOrgOwner && (await isTeamAdmin(user)))) throw refused(403, 'team_owner_required', 'Only the owner of your team can move a team into it.')
    return user
  }
  const verifiedEmail = (user) => {
    const first = Array.isArray(user?.emails) ? user.emails.find((email) => email?.verified && typeof email.address === 'string') : null
    return first ? first.address : null
  }
  async function ownMove(userId, importId) {
    const found = await importer.get(importId)
    if (!found || !found.move || found.move.actorUserId !== userId) throw refused(404, 'not_found', 'There is no such move.')
    return found
  }

  // At most movesPerDay moves started in the last 24 hours, per person.
  async function underLimit(user) {
    const started = await importer.countMoves(user._id, new Date(now() - DAY_MS))
    if (started < movesPerDay) return
    await auditRow({ type: 'team-move-limit', userId: user._id, started })
    throw refused(429, 'move_limit', `You can move a team here ${movesPerDay} times a day. Try again tomorrow.`)
  }

  async function startMove(userId) {
    const user = await mover(userId)
    const open = (await importer.listMoves(user._id)).find((row) => ['running', 'pending', 'confirming'].includes(row.state))
    if (open) throw refused(409, 'move_pending', `You have a move waiting (${open._id}). Confirm or discard it first.`)
    await underLimit(user)
    const { ticket, expiresAt } = await tickets.issue({ kind: 'move', userId: user._id, orgId: user.orgId || null, ttlMs: MOVE_TICKET_MS })
    log('team move issued', { userId: user._id, orgId: user.orgId || null })
    return {
      uploadUrl: new URL('/team-transfer/move/' + ticket, instance.origin).href,
      method: 'POST',
      contentType: 'application/octet-stream',
      passphraseHeader: 'Slatebox-Export-Passphrase',
      passphraseHeaderBase64: PASSPHRASE_HEADER_BASE64,
      expiresAt: expiresAt.toISOString(),
      maxBytes: moveLimits.totalBytes,
      into: user.orgId ? 'your_team' : 'new_team',
    }
  }

  async function receiveMove(ticket, body, passphrase) {
    const issued = await tickets.redeem(ticket, 'move')
    if (!issued) throw refused(404, 'ticket_invalid', 'This upload address is used or expired. Ask for a new one.')
    const user = await mover(issued.userId)
    if ((user.orgId || null) !== (issued.orgId || null)) throw refused(409, 'team_changed', 'Your team changed since you asked to move. Ask again.')
    // Counted again here: addresses asked for in a row are each still one move.
    await underLimit(user)
    const result = await importer.importArchive(readArchive(body, { passphrase: passphrase || null, limits: moveLimits }), {
      actorUserId: user._id,
      move: { intoOrgId: user.orgId || null },
      limits: moveLimits,
    })
    log('team move pending', { importId: result.importId, by: user._id, duplicate: Boolean(result.duplicate) })
    if (!result.duplicate)
      await auditRow({
        type: 'team-move-uploaded', userId: user._id, importId: result.importId, intoOrgId: user.orgId || null,
        teamName: result.report?.team?.name ?? null, source: result.report?.source?.instance ?? null, signerKnown: Boolean(result.report?.source?.signerKnown),
        slates: result.report?.sections?.slates?.created ?? 0, people: (result.report?.people || []).length,
      })
    return result
  }

  async function confirmMove(userId, importId, { invite = false } = {}) {
    const found = await ownMove(userId, importId)
    const user = await mover(userId)
    if ((user.orgId || null) !== (found.move.intoOrgId || null)) throw refused(409, 'team_changed', 'Your team changed since this move was uploaded. Discard it and move again.')
    const result = await importer.confirmMove(importId, { actor: { userId: user._id, email: verifiedEmail(user) }, invite })
    log('team move confirmed', { importId, by: user._id, merged: result.merged })
    await auditRow({ type: 'team-move-confirmed', userId: user._id, importId, teamId: result.teamId, merged: Boolean(result.merged), invited: result.invited?.sent ?? 0, library: result.library?.submitted ?? 0 })
    return result
  }

  // The mover invites the moved people later: everyone not invited yet whose address the source
  // had verified (no email: all of them), or one address they checked themselves.
  async function inviteMoved(userId, importId, { email = null } = {}) {
    const found = await ownMove(userId, importId)
    if (found.state !== 'confirmed') throw refused(409, 'not_confirmed', 'Confirm the move before inviting its people.')
    const result = email ? await importer.inviteAddress(importId, email) : await importer.inviteRest(importId)
    await auditRow({ type: 'team-move-invited', userId, importId, ...(email ? { outcome: result.outcome } : { sent: result.invited?.sent ?? 0 }) })
    return result
  }

  const asAdmin = (fn) => async (userId, ...args) => {
    await serverAdmin(userId)
    return fn(...args)
  }
  return {
    // What an export of the caller's team would hold, with the same checks as startExport and no
    // download address (a move from this server asks first: server/selfhost-options).
    async preflight(userId) {
      const user = await teamAdmin(userId)
      const summary = await exporter.preflight(user.orgId)
      if (!summary) throw refused(404, 'no_team', 'Your team was not found.')
      return summary
    },
    startExport,
    openExport,
    startImport,
    receiveImport,
    // Moves are listed with the imports, with who moved each team here.
    async listImports(userId) {
      await serverAdmin(userId)
      const rows = await importer.list()
      const names = new Map()
      for (const row of rows) {
        const by = row.move?.actorUserId
        if (!by || names.has(by)) continue
        const user = await loadUser(by)
        names.set(by, (Array.isArray(user?.emails) && user.emails[0]?.address) || by)
      }
      return rows.map((row) => (row.move ? { ...row, movedBy: names.get(row.move.actorUserId) } : row))
    },
    async getImport(userId, importId) {
      await serverAdmin(userId)
      const found = await importer.get(importId)
      if (!found) throw refused(404, 'not_found', 'There is no such import.')
      return found
    },
    confirmImport: asAdmin((importId, options) => importer.confirm(importId, options)),
    inviteImported: asAdmin((importId, email) => importer.inviteAddress(importId, email)),
    discardImport: asAdmin((importId) => importer.discard(importId)),
    startMove,
    receiveMove,
    confirmMove,
    inviteMoved,
    async getMove(userId, importId) {
      return ownMove(userId, importId)
    },
    async listMoves(userId) {
      if (!userId) throw refused(403, 'forbidden', 'Sign in to see your moves.')
      return importer.listMoves(userId)
    },
    // Someone with an account here accepts the invitation to join a moved team (import-core acceptJoin).
    async joinMoved(userId, token) {
      const user = userId && (await loadUser(userId))
      if (!user || user.isAnonymous) throw refused(403, 'forbidden', 'Sign in to accept the invitation.')
      const result = await importer.acceptJoin({ token, userId: user._id })
      await auditRow({ type: 'team-move-joined', userId: user._id, importId: result.importId, teamId: result.teamId })
      return result
    },
    async discardMove(userId, importId) {
      await ownMove(userId, importId)
      const result = await importer.discard(importId)
      await auditRow({ type: 'team-move-discarded', userId, importId })
      return result
    },
  }
}
