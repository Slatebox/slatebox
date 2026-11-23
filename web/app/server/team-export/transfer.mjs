// Who may export and import, and the one-time addresses the archive travels through. The
// actions (server/actions/team-*.mjs) and the HTTP routes (routes.mjs) both call this.
//
// Export: a team admin (the person, or a token of theirs with team:export) asks for an export
// and gets a download address that works once, for 15 minutes, for that person and team only.
// The archive is written while it downloads. Import: a server administrator (or a token of theirs
// with team:import) asks for an upload address that works once, for an hour; the upload is read
// as it arrives into a new hidden team. A ticket is stored by its hash only.
import { createHash, randomBytes } from 'node:crypto'
import { readArchive, writeArchive, checkPassphrase, MIN_PASSPHRASE } from './archive.mjs'
import { LIMITS } from './format.mjs'
import { ImportError } from './import-core.mjs'

// A passphrase that is not plain ASCII cannot travel in a header as text: this header carries it
// as base64url of its UTF-8 bytes (routes.mjs).
export const PASSPHRASE_HEADER_BASE64 = 'Slatebox-Export-Passphrase-Base64'
export const EXPORT_TICKET_MS = 15 * 60 * 1000
export const IMPORT_TICKET_MS = 60 * 60 * 1000

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
 * loadUser(id) → { _id, orgId, isAnonymous } | null. isTeamAdmin(user) and isServerAdmin(userId) → boolean.
 * signer: { privateKey, publicKey } for the archive's signature, or a function giving it. instance: { origin, name }.
 */
export function createTeamTransfer({ exporter, importer, tickets, loadUser, isTeamAdmin, isServerAdmin, signer = null, instance, limits = LIMITS, now = Date.now, log = () => {} }) {
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
  async function openExport(ticket, passphrase) {
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
      onEnd: (end) => log('team export written', { orgId: record.orgId, lines: end.lines, bytes: end.bytes }),
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

  const asAdmin = (fn) => async (userId, ...args) => {
    await serverAdmin(userId)
    return fn(...args)
  }
  return {
    startExport,
    openExport,
    startImport,
    receiveImport,
    listImports: asAdmin(() => importer.list()),
    async getImport(userId, importId) {
      await serverAdmin(userId)
      const found = await importer.get(importId)
      if (!found) throw refused(404, 'not_found', 'There is no such import.')
      return found
    },
    confirmImport: asAdmin((importId, options) => importer.confirm(importId, options)),
    inviteImported: asAdmin((importId, email) => importer.inviteAddress(importId, email)),
    discardImport: asAdmin((importId) => importer.discard(importId)),
  }
}
