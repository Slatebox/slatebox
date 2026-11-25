// Importing a team export (format.mjs) into a NEW team that stays hidden until a server
// administrator confirms it, or is deleted when they discard it (or nobody acts for 14 days).
//
// The archive is treated as hostile:
// - Every document gets a new id from this server, and so does every share link. The only link
//   back to the source is teamImportMap {importId, section, sourceId, newId}. Nothing is upserted
//   or looked up by a source id, so an archive that names an existing document of this server
//   (a slate id read from a public link, another team's id) changes nothing and learns nothing.
// - Ownership is set here, never read from the archive: every document belongs to the new team
//   and to a person the import made.
// - People arrive as placeholders: no password, no sign-in, no email address an account could be
//   found by. Roles are the team's own (admin of this team at most); a server-wide claim, sign-in
//   secrets or any field a person record does not have refuses that person.
// - Every row is checked: its shape, its size and its keys (no "$" or "." keys).
// - Files are told by their first bytes (classifyFile) and must match their hash and size.
// - Slates arrive private; what they were (public, unlisted) is kept and given back on confirm.
//   Template and directory flags are dropped. Every board rule arrives switched off.
// - AI connections arrive without keys, and only those with a public address.
// - Tokens are never made: the report lists them to make again.
// - Library items arrive as their authors' drafts: nothing reaches this server's library until
//   its own review approves it.
//
// A move (moving a team to another server by its own owner, not by this server's administrator)
// imports the same way, into the same hidden team, and records who is moving it and into which
// team (move: { actorUserId, intoOrgId }). Its confirm (confirm with move) then either makes the
// hidden team live with the mover as its owner, or merges it into the mover's own team. The mover
// takes the seat of the archive's person with their address (else the archive's owner); a person
// whose address belongs to someone already in the team takes that person's seat. The other
// people stay placeholders until the mover chooses to invite them. The same archive moved twice
// by the same person returns the first move (archive digest), and nothing is written twice.
// Every document the import writes carries teamImportId, so a discard (or a failed import)
// removes exactly what it wrote.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { unsafeKeyPath } from '../common/document-keys.mjs'
import { ArchiveError } from './archive.mjs'
import { addressQuery } from './invite.mjs'
import { encodeUseKeys } from '../methods/ai/connection-store.mjs'
import { USE_KEYS } from '../methods/ai/connections.mjs'
import { LIMITS, OPTION_FLAGS, SECTIONS, SLATE_FLAGS, contentHash, eachObject, mapStrings, replaceUrls } from './format.mjs'
import { LIBRARY_LICENSE, slugify } from '../../imports/api/common/library-model.mjs'

export const PENDING_DAYS = 14

export class ImportError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const isId = (value) => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,80}$/.test(value)
const shortText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{1,60}$/
const CONNECTION_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
const LIBRARY_KINDS = ['component', 'slate', 'presentation']
const MEMBER_FIELDS = new Set(['_id', 'email', 'emailVerified', 'firstName', 'lastName', 'owner', 'roles', 'createdAt'])
const ROLES = ['NONE', 'READ', 'COMMENT', 'EDIT']
const VISIBILITY = ['private', 'unlisted', 'public']
// Who owns a document and how it was imported are set by the importer, never read from a row.
const OWNERSHIP = ['_id', 'orgId', 'userId', 'teamImportId', 'importedVisibility', 'importPlaceholder', 'createdByUserId']
const owned = (row) => {
  for (const key of OWNERSHIP) delete row[key]
  return row
}
const toDate = (value, fallback) => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.valueOf()) ? fallback : date
}

// Is an AI endpoint on the public internet, by its address alone? A name on a private network
// (localhost, .local, .internal, a bare host) or a private, loopback or link-local address is not.
export function isPublicEndpoint(baseUrl) {
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(host)) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false
  }
  if (host.includes(':')) return false // an IPv6 literal: not checked, so not taken
  return true
}

/**
 * db: driver collections { organizations, users, permissions, slates, events, snapshots, comments,
 *     presentations, presentationChats, slateAccess, orgSettings, providerKeys, aiChoices,
 *     imports, importMap }
 * createSlate(row, actor): stores a new slate (the save core's create).
 * classifyFile(bytes, ext) → { body, ext, type } | null. storeFile({ body, ext, type, ownerUserId })
 * → { url, key }. deleteFile(key).
 * teamClaims: the claim ids a team role may be. aiProviders: the connection types this server has.
 * knownSigners: fingerprints of signing keys this server trusts (its own), or a function giving them.
 * invite(user, { confirmed }) → 'sent' | 'needs_consent' | 'unverified' | 'mail_disabled' | 'already_invited'
 *     (invite.mjs; confirm with invite, and inviteAddress for an address the source had not verified).
 * libraryPreview(content) → the listing preview of a library item's content (optional).
 * db.libraryItems is optional: without it library items are skipped.
 */
export function createTeamImporter({
  db,
  newId,
  newShareId,
  newAccessKey,
  createSlate,
  classifyFile,
  storeFile,
  deleteFile = async () => {},
  validateBoard = null,
  teamClaims,
  aiProviders,
  knownSigners = [],
  invite = null,
  libraryPreview = (content) => ({ kind: content?.kind ?? 'component', notes: 0 }),
  limits: defaultLimits = LIMITS,
  now = Date.now,
}) {
  const TAGGED = ['organizations', 'users', 'permissions', 'slates', 'snapshots', 'comments', 'presentations', 'presentationChats', 'slateAccess', 'orgSettings', 'providerKeys', 'aiChoices', ...(db.libraryItems ? ['libraryItems'] : [])]

  async function removeWritten(importId) {
    const files = await db.importMap.find({ importId, section: 'files' }).toArray()
    for (const file of files) await deleteFile(file.newId).catch(() => {})
    const slates = await db.importMap.find({ importId, section: 'slates' }, { projection: { newId: 1 } }).toArray()
    const slateIds = slates.map((row) => row.newId)
    for (let i = 0; i < slateIds.length; i += 500) await db.events.deleteMany({ slateId: { $in: slateIds.slice(i, i + 500) } })
    for (const name of TAGGED) await db[name].deleteMany({ teamImportId: importId })
    await db.importMap.deleteMany({ importId })
  }

  /**
   * Reads the archive's records (archive.mjs readArchive) into a new hidden team.
   * Returns { importId, report }. On any refusal of the archive itself, everything written is
   * removed and an ImportError or ArchiveError is thrown.
   */
  async function importArchive(archive, { actorUserId, move = null, limits: given = null }) {
    const limits = given || defaultLimits
    const importId = newId()
    const startedAt = now()
    const moving = move ? { actorUserId, intoOrgId: move.intoOrgId ?? null } : null
    await db.imports.insertOne({ _id: importId, state: 'running', createdBy: actorUserId, createdAt: new Date(startedAt), updatedAt: new Date(startedAt), ...(moving && { move: moving }) })
    const orgId = newId()
    const ids = new Map() // any source id or share id -> new
    const members = new Map() // source user id -> { newId, name }
    const slateIds = new Map() // source slate id -> new
    const shareIds = new Map() // source share id -> new
    const slateShares = new Map() // source slate id -> its new share id
    const fileUrls = new Map() // source url -> new url
    const fileNames = new Map() // source url -> 'sbx-file:<sha256>'
    const done = new Set() // section:sourceId already taken
    const report = {
      team: null,
      source: null,
      sections: {},
      people: [],
      slates: [],
      files: { created: 0, bytes: 0 },
      links: { rewritten: 0 },
      rulesSwitchedOff: 0,
      ai: { imported: [], skipped: [] },
      tokens: [],
      library: [],
      skipped: [],
    }
    const count = (section, outcome = 'created', n = 1) => {
      if (!report.sections[section]) report.sections[section] = { created: 0, skipped: 0 }
      report.sections[section][outcome] += n
    }
    const skip = (section, id, reason) => {
      count(section, 'skipped')
      if (report.skipped.length < 1000) report.skipped.push({ section, ...(id !== undefined && { id: String(id).slice(0, 200) }), reason })
    }
    const remember = (section, sourceId, created) =>
      db.importMap.insertOne({ _id: newId(), importId, section, sourceId: String(sourceId).slice(0, 300), newId: created })

    let ownerId = null
    let digest = null
    let section = -1
    let head = null
    let file = null // the file being read: { meta, parts, size }
    const rewrite = (value) =>
      mapStrings(value, (text) => {
        if (ids.has(text)) return ids.get(text)
        return replaceUrls(text, (url) => {
          if (fileUrls.has(url)) {
            report.links.rewritten += 1
            return fileUrls.get(url)
          }
          const canvas = /\/canvas\/([A-Za-z0-9_-]{1,80})(?=$|[/?#])/.exec(url)
          if (canvas && shareIds.has(canvas[1])) {
            report.links.rewritten += 1
            return url.replace('/canvas/' + canvas[1], '/canvas/' + shareIds.get(canvas[1]))
          }
          return undefined
        })
      })
    const checkDoc = (sectionName, doc, maxBytes = limits.docBytes) => {
      if (!isPlain(doc)) return 'invalid'
      if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > maxBytes) return 'too_large'
      if (unsafeKeyPath(doc)) return 'unsafe_keys'
      return null
    }
    const enter = async (name) => {
      const at = SECTIONS.indexOf(name)
      if (at < 0) throw new ImportError(422, 'section_unknown', `The archive has a section this server does not know (${String(name).slice(0, 40)}).`)
      if (at < section) throw new ImportError(422, 'out_of_order', 'The archive is out of order.')
      if (at > 0 && !report.team) throw new ImportError(422, 'team_missing', 'The archive does not start with its team.')
      if (at > section) {
        if (file) throw new ArchiveError('corrupt', 'A file in the archive is incomplete.')
        section = at
        if (at > SECTIONS.indexOf('members') && ownerId === null) await settleOwner()
      }
    }
    async function settleOwner() {
      if (ownerId) return
      const owner = report.people.find((person) => person.owner) || report.people.find((person) => person.roles.includes('admin')) || report.people[0]
      if (owner) ownerId = owner.newId
      else {
        ownerId = newId()
        await db.users.insertOne({ _id: ownerId, orgId, profile: { firstName: 'Imported', lastName: 'owner' }, emails: [], isOrgOwner: true, createdAt: new Date(now()), teamImportId: importId, importPlaceholder: { importId, email: null, sourceId: null } })
        report.people.push({ newId: ownerId, name: 'Imported owner', email: null, roles: [], owner: true, created: true })
      }
      await db.organizations.updateOne({ _id: orgId }, { $set: { createdByUserId: ownerId } })
    }

    const handlers = {
      async team(d) {
        if (report.team) throw new ImportError(422, 'corrupt', 'The archive has two teams.')
        if (!isPlain(d) || typeof d.name !== 'string') throw new ImportError(422, 'invalid', 'The archive team is not readable.')
        const name = d.name.trim().slice(0, 120) || 'Imported team'
        await db.organizations.insertOne({
          _id: orgId,
          name,
          createdOn: now(),
          isEducationInstitution: false,
          hidden: true,
          teamImport: { id: importId, state: 'pending' },
          teamImportId: importId,
        })
        if (isId(d._id)) ids.set(d._id, orgId)
        report.team = { id: orgId, name }
        count('team')
      },
      async members(d) {
        if (!isPlain(d) || !isId(d._id)) return skip('members', undefined, 'invalid')
        if (members.size >= limits.members) return skip('members', d._id, 'too_many')
        if (members.has(d._id)) return skip('members', d._id, 'duplicate')
        const extra = Object.keys(d).filter((key) => !MEMBER_FIELDS.has(key))
        if (extra.length) return skip('members', d._id, extra.some((key) => /services|password|token|secret|hash/i.test(key)) ? 'carries_secrets' : 'unexpected_fields')
        if (d.roles !== undefined && (!Array.isArray(d.roles) || d.roles.some((role) => typeof role !== 'string'))) return skip('members', d._id, 'invalid')
        const refused = (d.roles || []).filter((role) => !teamClaims.includes(role))
        if (refused.length) return skip('members', d._id, 'role_refused')
        const email = typeof d.email === 'string' && EMAIL.test(d.email.trim()) ? d.email.trim().toLowerCase() : null
        const firstName = shortText(d.firstName, 100)
        const lastName = shortText(d.lastName, 100)
        const id = newId()
        await db.users.insertOne({
          _id: id,
          orgId,
          profile: { firstName, lastName },
          emails: [],
          isOrgOwner: d.owner === true,
          createdAt: new Date(now()),
          teamImportId: importId,
          importPlaceholder: { importId, email, emailVerified: d.emailVerified === true, sourceId: d._id },
        })
        const roles = [...new Set(d.roles || [])]
        for (const claimId of roles) await db.permissions.insertOne({ _id: newId(), userId: id, orgId, claimId, teamImportId: importId })
        members.set(d._id, { newId: id, name: `${firstName} ${lastName}`.trim() })
        ids.set(d._id, id)
        await remember('members', d._id, id)
        report.people.push({ newId: id, name: `${firstName} ${lastName}`.trim(), email, ...(email && { emailVerified: d.emailVerified === true }), roles, owner: d.owner === true })
        count('members')
      },
      async index(d) {
        if (!isPlain(d) || !Array.isArray(d.slates)) throw new ImportError(422, 'invalid', 'The archive slate index is not readable.')
        if (d.slates.length > limits.slates) throw new ImportError(413, 'too_large', 'The archive has more slates than an import may hold.')
        for (const entry of d.slates) {
          if (!isPlain(entry) || !isId(entry.id) || slateIds.has(entry.id)) continue
          const id = newId()
          slateIds.set(entry.id, id)
          ids.set(entry.id, id)
          if (isId(entry.shareId) && !shareIds.has(entry.shareId)) {
            const share = await newShareId()
            shareIds.set(entry.shareId, share)
            ids.set(entry.shareId, share)
          }
          if (isId(entry.shareId) && shareIds.has(entry.shareId)) slateShares.set(entry.id, shareIds.get(entry.shareId))
        }
      },
      async slates(d, record) {
        const reason = checkDoc('slates', d, limits.slateBytes)
        if (reason) return skip('slates', d?._id, reason)
        if (!isId(d._id) || !slateIds.has(d._id)) return skip('slates', d._id, 'not_listed')
        if (done.has('slates:' + d._id)) return skip('slates', d._id, 'duplicate')
        done.add('slates:' + d._id)
        if ((d.options !== undefined && !isPlain(d.options)) || (d.nodes !== undefined && !Array.isArray(d.nodes))) return skip('slates', d._id, 'invalid')
        // The hash the exporter wrote, of the content as it left: a slate that differs was changed.
        if (typeof record.h === 'string' && contentHash(d, (url) => fileNames.get(url) ?? url) !== record.h) return skip('slates', d._id, 'hash_mismatch')
        if (validateBoard) {
          let broken = false
          eachObject(d, (item) => {
            if (!broken && Array.isArray(item.lanes) && Array.isArray(item.cards)) {
              try {
                validateBoard(item)
              } catch {
                broken = true
              }
            }
          })
          if (broken) return skip('slates', d._id, 'invalid_board')
        }
        const id = slateIds.get(d._id)
        const shareId = (isId(d.shareId) && shareIds.get(d.shareId)) || slateShares.get(d._id) || (await newShareId())
        slateShares.set(d._id, shareId)
        const row = owned(rewrite(d))
        for (const flag of SLATE_FLAGS) delete row[flag]
        const options = { ...(row.options || {}) }
        for (const flag of OPTION_FLAGS) delete options[flag]
        const visibility = { isPublic: options.isPublic === true, isUnlisted: options.isUnlisted === true }
        let off = 0
        eachObject(row, (item) => {
          if (isPlain(item.behaviour) && Array.isArray(item.behaviour.rules))
            for (const rule of item.behaviour.rules)
              if (isPlain(rule) && rule.on !== false) {
                rule.on = false
                off += 1
              }
        })
        const owner = (isId(d.userId) && members.get(d.userId)?.newId) || ownerId
        const at = now()
        const slate = {
          ...row,
          _id: id,
          shareId,
          userId: owner,
          orgId,
          created: toDate(d.created, new Date(at)).valueOf(),
          lastSaved: at,
          options: { ...options, id, isPrivate: true, isPublic: false, isUnlisted: false },
          importedVisibility: visibility,
          teamImportId: importId,
        }
        delete slate.revision
        delete slate.recentTouches
        await createSlate(slate, { kind: 'person', userId: owner })
        await remember('slates', d._id, id)
        report.rulesSwitchedOff += off
        if (report.slates.length < 2000) report.slates.push({ name: shortText(options.name, 200), shareId, contentHash: record.h ?? null, rulesSwitchedOff: off })
        count('slates')
      },
      async versions(d) {
        const reason = checkDoc('versions', d)
        if (reason) return skip('versions', d?._id, reason)
        if (!slateIds.has(d.slateId)) return skip('versions', d._id, 'slate_missing')
        // A version is the whole slate as it was, kept as one JSON string: the ids inside it are
        // read and rewritten like any slate's, and it names the new slate and its share link,
        // never the source's (restoring it loads its id and share id onto the open slate).
        const slateId = slateIds.get(d.slateId)
        let content = d.snapshot
        if (typeof content === 'string') {
          try {
            const parsed = JSON.parse(content)
            if (isPlain(parsed)) content = parsed
          } catch {
            // not JSON: kept as text, its links rewritten
          }
        }
        content = rewrite(content ?? null)
        if (isPlain(content)) {
          if (unsafeKeyPath(content)) return skip('versions', d._id, 'unsafe_keys')
          if (isPlain(content.options)) content.options.id = slateId
          if ('shareId' in content) content.shareId = slateShares.get(d.slateId) ?? null
        }
        await db.snapshots.insertOne({
          _id: newId(),
          slateId,
          userId: members.get(d.userId)?.newId || ownerId,
          snapshot: typeof content === 'string' ? content : JSON.stringify(content),
          created: toDate(d.created, new Date(now())),
          teamImportId: importId,
        })
        count('versions')
      },
      async events() {
        // A new slate starts its own event log (its creation is revision 1); the source's
        // events stay in the archive.
        count('events', 'skipped')
      },
      async comments(d) {
        const reason = checkDoc('comments', d)
        if (reason) return skip('comments', d?._id, reason)
        if (!slateIds.has(d.slateId)) return skip('comments', d._id, 'slate_missing')
        const row = owned(rewrite({ ...d }))
        await db.comments.insertOne({
          ...row,
          _id: newId(),
          slateId: slateIds.get(d.slateId),
          createdByUserId: members.get(d.createdByUserId)?.newId ?? null,
          mentionedTeamMembers: Array.isArray(d.mentionedTeamMembers) ? d.mentionedTeamMembers.map((id) => members.get(id)?.newId).filter(Boolean) : [],
          teamImportId: importId,
        })
        count('comments')
      },
      async presentations(d) {
        const reason = checkDoc('presentations', d)
        if (reason) return skip('presentations', d?._id, reason)
        if (!shareIds.has(d.slateShareId)) return skip('presentations', d._id, 'slate_missing')
        const row = owned(rewrite({ ...d }))
        delete row.isFeatured
        await db.presentations.insertOne({
          ...row,
          _id: newId(),
          slateShareId: shareIds.get(d.slateShareId),
          userId: members.get(d.userId)?.newId || ownerId,
          orgId,
          isPublic: false,
          isPublished: false,
          importedVisibility: { isPublic: d.isPublic === true, isPublished: d.isPublished === true },
          teamImportId: importId,
        })
        count('presentations')
      },
      async presentationChats(d) {
        const reason = checkDoc('presentationChats', d)
        if (reason) return skip('presentationChats', d?._id, reason)
        if (!shareIds.has(d.slateShareId)) return skip('presentationChats', d._id, 'slate_missing')
        const row = owned(rewrite({ ...d }))
        await db.presentationChats.insertOne({ ...row, _id: newId(), slateShareId: shareIds.get(d.slateShareId), userId: members.get(d.userId)?.newId || ownerId, teamImportId: importId })
        count('presentationChats')
      },
      async links(d) {
        if (!isPlain(d) || !slateIds.has(d.slateId)) return skip('links', d?._id, 'slate_missing')
        if (!VISIBILITY.includes(d.type) || !ROLES.includes(d.role)) return skip('links', d._id, 'invalid')
        const grant = { _id: newId(), slateId: slateIds.get(d.slateId), type: d.type, slateAccessPermissionId: d.role, teamImportId: importId }
        if (d.userId) {
          const member = members.get(d.userId)
          if (!member) return skip('links', d._id, 'person_missing')
          grant.userId = member.newId
        }
        // A published link gets a new key: the source's link keeps pointing at the source.
        grant.accessKey = await newAccessKey()
        await db.slateAccess.insertOne(grant)
        count('links')
      },
      async settings(d) {
        const reason = checkDoc('settings', d)
        if (reason) return skip('settings', d?._id, reason)
        const row = owned(rewrite({ ...d }))
        await db.orgSettings.insertOne({ ...row, _id: newId(), orgId, teamImportId: importId })
        count('settings')
      },
      async ai(d) {
        if (!isPlain(d)) return skip('ai', undefined, 'invalid')
        const imported = new Set()
        const at = now()
        for (const connection of Array.isArray(d.connections) ? d.connections.slice(0, 20) : []) {
          const name = isPlain(connection) && typeof connection.name === 'string' ? connection.name : null
          if (!name || !CONNECTION_NAME.test(name) || imported.has(name)) {
            report.ai.skipped.push({ name: shortText(name, 40), reason: 'invalid' })
            continue
          }
          if (!aiProviders.includes(connection.provider)) {
            report.ai.skipped.push({ name, reason: 'provider_unknown' })
            continue
          }
          if (connection.baseUrl !== undefined && (typeof connection.baseUrl !== 'string' || !isPublicEndpoint(connection.baseUrl))) {
            report.ai.skipped.push({ name, reason: 'not_public' })
            continue
          }
          await db.providerKeys.insertOne({
            _id: newId(),
            ownerType: 'org',
            ownerId: orgId,
            provider: connection.provider,
            name,
            ...(connection.baseUrl && { baseUrl: connection.baseUrl }),
            ...(typeof connection.model === 'string' && { model: connection.model.slice(0, 200) }),
            cipher: null,
            last4: '',
            created: at,
            updated: at,
            lastError: null,
            teamImportId: importId,
          })
          imported.add(name)
          report.ai.imported.push({ name, provider: connection.provider, needsKey: connection.hadKey === true })
        }
        const use = {}
        if (isPlain(d.use))
          for (const [feature, value] of Object.entries(d.use))
            if ((/^[a-z][A-Za-z]{0,39}$/.test(feature) || USE_KEYS.includes(feature)) && (value === 'builtin' || (typeof value === 'string' && imported.has(value.replace(/^team:/, '')) && value.startsWith('team:'))))
              use[feature] = value
        if (Object.keys(use).length) await db.aiChoices.insertOne({ _id: 'org:' + orgId, use: encodeUseKeys(use), updated: at, teamImportId: importId })
        count('ai')
      },
      async tokens(d) {
        if (!isPlain(d) || !members.has(d.userId)) return skip('tokens', undefined, 'person_missing')
        if (d.revoked === true) return
        if (report.tokens.length < 500)
          report.tokens.push({
            person: members.get(d.userId).name,
            name: shortText(d.name, 80),
            scopes: Array.isArray(d.scopes) ? d.scopes.filter((scope) => typeof scope === 'string').slice(0, 20) : [],
          })
        count('tokens', 'skipped')
      },
      async library(d) {
        if (!db.libraryItems) return skip('library', d?._id, 'not_supported')
        const reason = checkDoc('library', d, limits.slateBytes)
        if (reason) return skip('library', d?._id, reason)
        if (!isId(d._id) || done.has('library:' + d._id)) return skip('library', d._id, 'duplicate')
        done.add('library:' + d._id)
        if (!LIBRARY_KINDS.includes(d.kind) || typeof d.title !== 'string' || !isPlain(d.content) || d.content.kind !== d.kind) return skip('library', d._id, 'invalid')
        if (validateBoard) {
          let broken = false
          eachObject(d.content, (item) => {
            if (!broken && Array.isArray(item.lanes) && Array.isArray(item.cards)) {
              try {
                validateBoard(item)
              } catch {
                broken = true
              }
            }
          })
          if (broken) return skip('library', d._id, 'invalid_board')
        }
        const content = owned(rewrite(structuredClone(d.content)))
        if (isPlain(content.slate)) {
          for (const flag of SLATE_FLAGS) delete content.slate[flag]
          eachObject(content, (item) => {
            if (isPlain(item.behaviour) && Array.isArray(item.behaviour.rules)) for (const rule of item.behaviour.rules) if (isPlain(rule)) rule.on = false
          })
        }
        const id = newId()
        const author = (isId(d.authorId) && members.get(d.authorId)) || null
        const title = shortText(d.title, 200).trim() || 'Imported item'
        const at = new Date(now())
        const sourceShareId = typeof d.sourceShareId === 'string' && shareIds.has(d.sourceShareId) ? shareIds.get(d.sourceShareId) : null
        await db.libraryItems.insertOne({
          _id: id,
          kind: d.kind,
          origin: 'user',
          status: 'draft',
          reviewStatus: null,
          slug: slugify(title, id),
          title,
          summary: shortText(d.summary, 500),
          ...(typeof d.description === 'string' && { description: d.description.slice(0, 5000) }),
          ...(typeof d.category === 'string' && /^[a-z][a-z-]{0,40}$/.test(d.category) && { category: d.category }),
          categoryLocked: false,
          synonyms: Array.isArray(d.synonyms) ? d.synonyms.filter((word) => typeof word === 'string').map((word) => word.slice(0, 60)).slice(0, 12) : [],
          authorId: author?.newId || ownerId,
          authorName: author?.name || '',
          provenance: {},
          ...(sourceShareId && { sourceShareId }),
          draft: content,
          versionCount: 0,
          counts: { copies: 0, adds: 0, branches: 0 },
          popularity: 0,
          license: LIBRARY_LICENSE,
          preview: libraryPreview(content),
          importedLibrary: { status: shortText(d.status, 40) },
          createdAt: at,
          updatedAt: at,
          teamImportId: importId,
        })
        await remember('library', d._id, id)
        if (report.library.length < 500) report.library.push({ title, kind: d.kind, was: shortText(d.status, 40) })
        count('library')
      },
    }

    async function takeFile(record) {
      const { d } = record
      if (
        !isPlain(d) ||
        typeof d.id !== 'string' ||
        !/^[0-9a-f]{32}$/.test(d.id) ||
        typeof d.url !== 'string' ||
        d.url.length > 2000 ||
        !Number.isSafeInteger(d.size) ||
        d.size < 0 ||
        typeof d.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(d.sha256)
      )
        throw new ArchiveError('corrupt', 'A file in the archive is not readable.')
      if (d.size > limits.fileBytes) throw new ImportError(413, 'too_large', 'A file in the archive is larger than an import may hold.')
      file = { meta: d, parts: [], size: 0 }
      if (d.size === 0) await finishFile()
    }
    async function takeChunk(record) {
      if (!file || record.id !== file.meta.id || typeof record.data !== 'string') throw new ArchiveError('corrupt', 'A file in the archive is damaged.')
      const bytes = Buffer.from(record.data, 'base64')
      file.size += bytes.length
      if (file.size > file.meta.size) throw new ArchiveError('corrupt', 'A file in the archive is longer than it says.')
      file.parts.push(bytes)
      if (file.size === file.meta.size) await finishFile()
    }
    async function finishFile() {
      const { meta, parts } = file
      file = null
      const bytes = Buffer.concat(parts)
      if (createHash('sha256').update(bytes).digest('hex') !== meta.sha256) throw new ArchiveError('corrupt', 'A file in the archive does not match its hash.')
      fileNames.set(meta.url, 'sbx-file:' + meta.sha256)
      const kind = await classifyFile(bytes, meta.ext).catch(() => null)
      if (!kind) return skip('files', meta.url, 'not_allowed_kind')
      const owner = /\/u_([A-Za-z0-9]{17})_[A-Za-z0-9]{17}\.[a-z]+$/.exec(meta.url)
      const stored = await storeFile({ body: kind.body, ext: kind.ext, type: kind.type, ownerUserId: (owner && members.get(owner[1])?.newId) || ownerId })
      await remember('files', meta.url, stored.key)
      fileUrls.set(meta.url, stored.url)
      report.files.created += 1
      report.files.bytes += kind.body.length
      count('files')
    }

    const iterator = archive[Symbol.asyncIterator]()
    try {
      for (;;) {
        const next = await iterator.next()
        if (next.done) {
          if (file) throw new ArchiveError('corrupt', 'A file in the archive is incomplete.')
          const verified = next.value || {}
          digest = typeof verified.end?.digest === 'string' ? verified.end.digest : null
          if (!report.team) throw new ImportError(422, 'team_missing', 'The archive has no team.')
          await settleOwner()
          report.source = {
            instance: shortText(head?.source?.instance, 300),
            team: shortText(head?.source?.team, 120),
            exportedAt: shortText(head?.createdAt, 40),
            signer: verified.signer?.fingerprint ?? null,
            signerKnown: Boolean(verified.signer && (typeof knownSigners === 'function' ? knownSigners() : knownSigners).includes(verified.signer.fingerprint)),
          }
          break
        }
        const record = next.value
        if (record.t === 'head') {
          head = record
          continue
        }
        if (record.t === 'skip') {
          skip(SECTIONS.includes(record.s) ? record.s : 'other', record.id, 'left_out_by_export:' + shortText(record.reason, 40))
          continue
        }
        if (record.t === 'file') {
          await enter('files')
          if (file) throw new ArchiveError('corrupt', 'A file in the archive is incomplete.')
          await takeFile(record)
          continue
        }
        if (record.t === 'chunk') {
          await takeChunk(record)
          continue
        }
        if (record.t !== 'doc' || typeof record.s !== 'string') throw new ImportError(422, 'corrupt', 'The archive has a record this server does not read.')
        await enter(record.s)
        await handlers[record.s](record.d, record)
      }
    } catch (error) {
      await removeWritten(importId)
      await db.imports.updateOne(
        { _id: importId },
        { $set: { state: 'failed', updatedAt: new Date(now()), failure: { code: error.code || 'failed', message: String(error.message || '').slice(0, 300) } } }
      )
      if (error instanceof ArchiveError || error instanceof ImportError) throw error
      throw new ImportError(500, 'import_failed', 'The import failed. Nothing was kept.')
    } finally {
      await iterator.return?.().catch(() => {})
    }
    const finishedAt = now()
    // The same archive moved again by the same person: the first move stands, this copy goes.
    if (moving && digest) {
      const earlier = await db.imports.findOne({ _id: { $ne: importId }, digest, 'move.actorUserId': actorUserId, state: { $in: ['pending', 'confirming', 'confirmed'] } })
      if (earlier) {
        await removeWritten(importId)
        await db.imports.deleteMany({ _id: importId })
        return { importId: earlier._id, state: earlier.state, report: earlier.report ?? null, duplicate: true }
      }
    }
    // Never the source ids in what is returned: the map stays on the server.
    report.people = report.people.map(({ newId: _id, ...person }) => person)
    await db.imports.updateOne(
      { _id: importId },
      {
        $set: {
          state: 'pending',
          orgId,
          ...(digest && { digest }),
          teamName: report.team.name,
          updatedAt: new Date(finishedAt),
          expiresAt: new Date(finishedAt + PENDING_DAYS * 86400000),
          report,
        },
      }
    )
    return { importId, state: 'pending', report }
  }

  async function get(importId) {
    if (!isId(importId)) return null
    return db.imports.findOne({ _id: importId })
  }

  async function list({ limit = 50 } = {}) {
    return db.imports
      .find({ state: { $in: ['pending', 'confirmed', 'failed', 'running'] } }, { sort: { createdAt: -1 }, limit, projection: { report: 0 } })
      .toArray()
  }

  async function claim(importId, to) {
    const result = await db.imports.updateOne({ _id: importId, state: 'pending' }, { $set: { state: to, updatedAt: new Date(now()) } })
    if (!result.matchedCount && !result.modifiedCount) {
      const found = await get(importId)
      if (!found) throw new ImportError(404, 'not_found', 'There is no such import.')
      throw new ImportError(409, 'not_pending', `This import is ${found.state}; only a pending import can be confirmed or discarded.`)
    }
    return get(importId)
  }

  async function restoreVisibility(importId, orgId) {
    for await (const slate of db.slates.find({ orgId, teamImportId: importId }, { projection: { _id: 1, importedVisibility: 1 } })) {
      const was = slate.importedVisibility || {}
      await db.slates.updateOne(
        { _id: slate._id },
        { $set: { 'options.isPublic': was.isPublic === true, 'options.isUnlisted': was.isUnlisted === true, 'options.isPrivate': !was.isPublic && !was.isUnlisted }, $unset: { importedVisibility: 1 } }
      )
    }
    for await (const presentation of db.presentations.find({ orgId, teamImportId: importId }, { projection: { _id: 1, importedVisibility: 1 } })) {
      const was = presentation.importedVisibility || {}
      await db.presentations.updateOne({ _id: presentation._id }, { $set: { isPublic: was.isPublic === true, isPublished: was.isPublished === true }, $unset: { importedVisibility: 1 } })
    }
  }

  // Emails each placeholder of the import whose address the source had verified (invite.mjs).
  async function inviteAll(importId, orgId) {
    const invited = { sent: 0, needsConsent: [], mailDisabled: 0, unverified: [] }
    if (!invite) return invited
    for await (const user of db.users.find({ orgId, 'importPlaceholder.importId': importId })) {
      if (!user.importPlaceholder?.email) continue
      const outcome = await invite(user).catch(() => 'failed')
      if (outcome === 'sent') invited.sent += 1
      else if (outcome === 'needs_consent') invited.needsConsent.push(user.importPlaceholder.email)
      else if (outcome === 'mail_disabled') invited.mailDisabled += 1
      else if (outcome === 'unverified') invited.unverified.push(user.importPlaceholder.email)
    }
    return invited
  }

  /** Makes the hidden team live: its slates get back what they were, and, with invite, its people are invited. */
  async function confirm(importId, { invite: sendInvites = false } = {}) {
    const found = await get(importId)
    if (found?.move) throw new ImportError(409, 'is_a_move', 'This import is a move: the person moving the team confirms it.')
    const { orgId } = await claim(importId, 'confirming')
    await restoreVisibility(importId, orgId)
    await db.organizations.updateOne({ _id: orgId }, { $set: { 'teamImport.state': 'confirmed' }, $unset: { hidden: 1 } })
    // Addresses the source had verified are invited; the others wait in invited.unverified until
    // the administrator confirms each one (inviteAddress), since an archive edited by hand could
    // list any address.
    const invited = sendInvites ? await inviteAll(importId, orgId) : { sent: 0, needsConsent: [], mailDisabled: 0, unverified: [] }
    await db.imports.updateOne({ _id: importId }, { $set: { state: 'confirmed', confirmedAt: new Date(now()), updatedAt: new Date(now()), invited } })
    return { importId, state: 'confirmed', teamId: orgId, invited }
  }

  // Everything the import wrote that names placeholder `from` names `to` instead, and the
  // placeholder goes. Its roles go to `to` only when keepRoles (the mover of a new team);
  // someone already in the team keeps their own.
  async function takeSeat(importId, from, to, { keepRoles }) {
    for (const name of ['slates', 'snapshots', 'presentations', 'presentationChats', 'slateAccess'])
      await db[name].updateMany({ teamImportId: importId, userId: from }, { $set: { userId: to } })
    await db.comments.updateMany({ teamImportId: importId, createdByUserId: from }, { $set: { createdByUserId: to } })
    for (const comment of await db.comments.find({ teamImportId: importId, mentionedTeamMembers: from }, { projection: { _id: 1, mentionedTeamMembers: 1 } }).toArray())
      await db.comments.updateOne({ _id: comment._id }, { $set: { mentionedTeamMembers: [...new Set(comment.mentionedTeamMembers.map((id) => (id === from ? to : id)))] } })
    if (db.libraryItems) await db.libraryItems.updateMany({ teamImportId: importId, authorId: from }, { $set: { authorId: to } })
    if (keepRoles)
      for (const row of await db.permissions.find({ teamImportId: importId, userId: from }).toArray()) {
        const has = await db.permissions.findOne({ userId: to, orgId: row.orgId, claimId: row.claimId })
        if (has) await db.permissions.deleteMany({ _id: row._id })
        else await db.permissions.updateOne({ _id: row._id }, { $set: { userId: to } })
      }
    else await db.permissions.deleteMany({ teamImportId: importId, userId: from })
    await db.users.deleteMany({ _id: from, teamImportId: importId })
  }

  /**
   * Confirms a move (an import with move). actor: { userId, email } — the mover, already checked
   * by the caller to be the one who started it and still able to (transfer.mjs).
   * Without move.intoOrgId the hidden team goes live with the mover as its owner; with it, the
   * team's slates, people and the rest join that team. Returns { importId, state, teamId,
   * merged, seats, settings, invited }.
   */
  async function confirmMove(importId, { actor, invite: sendInvites = false }) {
    const found = await get(importId)
    if (!found) throw new ImportError(404, 'not_found', 'There is no such move.')
    if (!found.move) throw new ImportError(409, 'not_a_move', 'This import is not a move.')
    const { orgId: staging, move } = await claim(importId, 'confirming')
    const into = move.intoOrgId || null
    const team = into || staging
    await restoreVisibility(importId, staging)

    const placeholders = await db.users.find({ orgId: staging, 'importPlaceholder.importId': importId }).toArray()
    const email = typeof actor.email === 'string' ? actor.email.trim().toLowerCase() : null
    const seat = (email && placeholders.find((user) => user.importPlaceholder?.email === email)) || placeholders.find((user) => user.isOrgOwner) || null
    const seats = { mover: seat ? `${seat.profile?.firstName ?? ''} ${seat.profile?.lastName ?? ''}`.trim() : null, matched: [] }
    // People already in the team, found by address in any letter case.
    const existing = new Map()
    if (into)
      for (const user of placeholders) {
        const address = user.importPlaceholder?.email
        if (!address || user === seat) continue
        const member = await db.users.findOne({ orgId: into, ...addressQuery(address) }, { projection: { _id: 1 } })
        if (member) existing.set(user._id, member._id)
      }

    let settings = 'imported'
    if (into) {
      for (const name of ['users', 'permissions', 'slates', 'presentations'])
        await db[name].updateMany({ teamImportId: importId, orgId: staging }, { $set: { orgId: into } })
      // The team's own brand kit and agent choices win; the moved ones are left out.
      if (await db.orgSettings.findOne({ orgId: into, teamImportId: { $ne: importId } }, { projection: { _id: 1 } })) {
        await db.orgSettings.deleteMany({ teamImportId: importId, orgId: staging })
        settings = 'kept_yours'
      } else await db.orgSettings.updateMany({ teamImportId: importId, orgId: staging }, { $set: { orgId: into } })
      for (const connection of await db.providerKeys.find({ teamImportId: importId, ownerType: 'org', ownerId: staging }).toArray()) {
        const taken = await db.providerKeys.findOne({ ownerType: 'org', ownerId: into, name: connection.name }, { projection: { _id: 1 } })
        if (taken) await db.providerKeys.deleteMany({ _id: connection._id })
        else await db.providerKeys.updateOne({ _id: connection._id }, { $set: { ownerId: into } })
      }
      const choices = await db.aiChoices.findOne({ _id: 'org:' + staging })
      if (choices) {
        await db.aiChoices.deleteMany({ _id: 'org:' + staging })
        if (!(await db.aiChoices.findOne({ _id: 'org:' + into }))) await db.aiChoices.insertOne({ ...choices, _id: 'org:' + into })
      }
      await db.organizations.deleteMany({ _id: staging, teamImportId: importId })
    } else {
      await db.organizations.updateOne({ _id: staging }, { $set: { 'teamImport.state': 'confirmed', createdByUserId: actor.userId }, $unset: { hidden: 1 } })
    }

    if (seat) await takeSeat(importId, seat._id, actor.userId, { keepRoles: !into })
    for (const [from, to] of existing) {
      await takeSeat(importId, from, to, { keepRoles: false })
      seats.matched.push(placeholders.find((user) => user._id === from)?.importPlaceholder?.email)
    }
    if (!into) await db.users.updateOne({ _id: actor.userId }, { $set: { orgId: staging, isOrgOwner: true } })

    const invited = sendInvites ? await inviteAll(importId, team) : { sent: 0, needsConsent: [], mailDisabled: 0, unverified: [] }
    await db.imports.updateOne({ _id: importId }, { $set: { state: 'confirmed', orgId: team, confirmedAt: new Date(now()), updatedAt: new Date(now()), invited, seats, settings } })
    return { importId, state: 'confirmed', teamId: team, merged: Boolean(into), seats, settings, invited }
  }

  /**
   * Invites one person of a confirmed import whose address the source had not verified, once the
   * administrator has confirmed that address. Returns { importId, email, outcome } with the
   * outcome of invite ('sent', 'needs_consent', 'mail_disabled', 'already_invited').
   */
  async function inviteAddress(importId, email) {
    const record = await get(importId)
    if (!record) throw new ImportError(404, 'not_found', 'There is no such import.')
    if (record.state !== 'confirmed') throw new ImportError(409, 'not_confirmed', 'Confirm the import before inviting its people.')
    if (!invite) throw new ImportError(422, 'invite_unavailable', 'This server cannot invite people.')
    const address = typeof email === 'string' ? email.trim().toLowerCase() : ''
    const user = address && (await db.users.findOne({ orgId: record.orgId, 'importPlaceholder.importId': importId, 'importPlaceholder.email': address }))
    if (!user) throw new ImportError(404, 'person_not_found', 'No one in this import has that address.')
    const outcome = await invite(user, { confirmed: true })
    const was = record.invited || {}
    const left = (was.unverified || []).filter((other) => other !== address)
    await db.imports.updateOne(
      { _id: importId },
      {
        $set: {
          updatedAt: new Date(now()),
          'invited.unverified': outcome === 'mail_disabled' ? was.unverified || [] : left,
          ...(outcome === 'sent' && { 'invited.sent': (was.sent || 0) + 1 }),
          ...(outcome === 'needs_consent' && { 'invited.needsConsent': [...new Set([...(was.needsConsent || []), address])] }),
        },
      }
    )
    return { importId, email: address, outcome }
  }

  /** Deletes the hidden team and everything the import wrote. */
  async function discard(importId) {
    await claim(importId, 'discarding')
    await removeWritten(importId)
    await db.imports.updateOne({ _id: importId }, { $set: { state: 'discarded', updatedAt: new Date(now()) }, $unset: { report: 1 } })
    return { importId, state: 'discarded' }
  }

  /** Discards pending imports nobody confirmed for PENDING_DAYS, and clears runs a crash left behind. */
  async function purge() {
    const cutoff = new Date(now() - PENDING_DAYS * 86400000)
    let purged = 0
    for (const record of await db.imports.find({ state: 'pending', updatedAt: { $lt: cutoff } }, { projection: { _id: 1 } }).toArray()) {
      try {
        await discard(record._id)
        purged += 1
      } catch {
        // another server took it
      }
    }
    const stale = new Date(now() - 86400000)
    for (const record of await db.imports.find({ state: { $in: ['running', 'confirming', 'discarding'] }, updatedAt: { $lt: stale } }, { projection: { _id: 1, state: 1 } }).toArray()) {
      if (record.state === 'confirming') continue // a confirm half done is finished by hand, never deleted
      await removeWritten(record._id)
      await db.imports.updateOne({ _id: record._id, state: record.state }, { $set: { state: 'failed', updatedAt: new Date(now()), failure: { code: 'stale', message: 'The import stopped before it finished.' } } })
      purged += 1
    }
    return { purged }
  }

  async function listMoves(actorUserId, { limit = 20 } = {}) {
    return db.imports
      .find({ 'move.actorUserId': actorUserId, state: { $in: ['pending', 'confirming', 'confirmed', 'failed', 'running'] } }, { sort: { createdAt: -1 }, limit, projection: { report: 0 } })
      .toArray()
  }

  return { importArchive, get, list, listMoves, confirm, confirmMove, inviteAddress, discard, purge }
}
