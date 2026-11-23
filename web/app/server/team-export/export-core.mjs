// "Export everything": the lines of one team's archive (format.mjs), read from the database a
// document at a time. Takes MongoDB driver collections, so the same code runs under Meteor
// (meteor.js) and in the tests.
//
// What is the team's: the team document, the people whose orgId is the team (never a guest),
// the slates whose orgId is the team, and what hangs off those slates. An uploaded file is the
// team's when a member uploaded it or it is a picture of one of the team's slates; a slate that
// shows another team's file keeps its address and the file stays where it is.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { LIMITS, canonicalJson, contentHash, scrubSecrets, uploadKey, urlsIn } from './format.mjs'

const BATCH = 500
const chunks = (list, size = BATCH) => {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')

/**
 * db: { organizations, users, permissions, slates, snapshots, events, comments, presentations,
 *       presentationChats, slateAccess, orgSettings, providerKeys, aiChoices, apiTokens }
 * readFile(key, maxBytes) → Buffer | null: an uploaded file's bytes (null when it is gone).
 * cloudUrl: where uploads are served from. adminClaims: the claim ids a role may be.
 */
export function createTeamExporter({ db, readFile, cloudUrl, limits = LIMITS, now = Date.now, uberClaim = 'uberMensch' }) {
  async function members(orgId) {
    return db.users
      .find({ orgId, isAnonymous: { $ne: true } }, { projection: { _id: 1, emails: 1, profile: 1, isOrgOwner: 1, createdAt: 1 } })
      .toArray()
  }

  /** What an export of the team holds, by section, before it is written. */
  async function preflight(orgId) {
    const team = await db.organizations.findOne({ _id: orgId }, { projection: { _id: 1, name: 1 } })
    if (!team) return null
    const people = await members(orgId)
    return {
      team: { name: team.name || '' },
      members: people.length,
      slates: await db.slates.countDocuments({ orgId }),
      limits: { totalBytes: limits.totalBytes, slateBytes: limits.slateBytes, fileBytes: limits.fileBytes },
    }
  }

  function* small(section, doc, skipped) {
    const clean = scrubSecrets(doc)
    if (jsonBytes(clean) > limits.docBytes) {
      skipped.push({ s: section, id: doc._id, reason: 'too_large' })
      yield { t: 'skip', s: section, id: doc._id, reason: 'too_large' }
      return
    }
    yield { t: 'doc', s: section, d: clean }
  }

  /** The records of the team's archive, in order (an async generator). */
  async function* records(orgId, { skipped = [] } = {}) {
    const team = await db.organizations.findOne({ _id: orgId })
    if (!team) return
    yield { t: 'doc', s: 'team', d: { _id: team._id, name: String(team.name || '').slice(0, 120), createdOn: team.createdOn ?? null } }

    const people = await members(orgId)
    if (people.length > limits.members) throw Object.assign(new Error('The team has more people than an export may hold.'), { status: 413, code: 'too_large' })
    const memberIds = people.map((person) => person._id)
    const memberSet = new Set(memberIds)
    const roles = new Map()
    for (const batch of chunks(memberIds)) {
      for (const row of await db.permissions.find({ orgId, userId: { $in: batch } }, { projection: { userId: 1, claimId: 1 } }).toArray()) {
        if (row.claimId === uberClaim) continue
        roles.set(row.userId, [...new Set([...(roles.get(row.userId) || []), row.claimId])])
      }
    }
    for (const person of people) {
      const email = person.emails?.[0]
      yield {
        t: 'doc',
        s: 'members',
        d: {
          _id: person._id,
          email: typeof email?.address === 'string' ? email.address : null,
          emailVerified: Boolean(email?.verified),
          firstName: String(person.profile?.firstName ?? '').slice(0, 100),
          lastName: String(person.profile?.lastName ?? '').slice(0, 100),
          owner: Boolean(person.isOrgOwner),
          roles: roles.get(person._id) || [],
          createdAt: person.createdAt instanceof Date ? person.createdAt.toISOString() : person.createdAt ?? null,
        },
      }
    }

    // The slates, once to list them and find their files, and again to write them: a team's
    // slates are not held in memory together.
    const index = []
    const files = new Map() // key -> { url, ext }
    const slateIds = new Set()
    for await (const slate of db.slates.find({ orgId }, { projection: { _id: 1, shareId: 1 } })) {
      index.push({ id: slate._id, shareId: slate.shareId ?? null })
      slateIds.add(slate._id)
    }
    if (index.length > limits.slates) throw Object.assign(new Error('The team has more slates than an export may hold.'), { status: 413, code: 'too_large' })
    yield { t: 'doc', s: 'index', d: { slates: index } }

    const external = new Set()
    for (const { id } of index) {
      const slate = await db.slates.findOne({ _id: id })
      if (!slate) continue
      for (const url of urlsIn(slate)) {
        const found = uploadKey(url, cloudUrl)
        if (!found) continue
        const ours = (found.ownerUserId && memberSet.has(found.ownerUserId)) || (found.slateId && slateIds.has(found.slateId))
        if (ours) files.set(found.key, { url, ext: found.ext })
        else external.add(url)
      }
    }
    for (const url of external) skipped.push({ s: 'files', id: url, reason: 'another_team' })

    // Files before slates: the importer stores each file and then points the slates at it.
    const fileHashes = new Map() // url -> sha256
    for (const [key, file] of files) {
      const bytes = await readFile(key, limits.fileBytes)
      if (!bytes) {
        skipped.push({ s: 'files', id: file.url, reason: 'missing' })
        yield { t: 'skip', s: 'files', id: file.url, reason: 'missing' }
        continue
      }
      if (bytes.length > limits.fileBytes) {
        skipped.push({ s: 'files', id: file.url, reason: 'too_large' })
        yield { t: 'skip', s: 'files', id: file.url, reason: 'too_large' }
        continue
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      fileHashes.set(file.url, sha256)
      const id = sha256.slice(0, 32)
      yield { t: 'file', d: { id, url: file.url, ext: file.ext, size: bytes.length, sha256 } }
      for (let at = 0; at < bytes.length; at += limits.chunkBytes)
        yield { t: 'chunk', id, data: bytes.subarray(at, at + limits.chunkBytes).toString('base64') }
    }

    const fileName = (url) => (fileHashes.has(url) ? 'sbx-file:' + fileHashes.get(url) : url)
    for (const { id } of index) {
      const slate = await db.slates.findOne({ _id: id })
      if (!slate) continue
      const doc = scrubSecrets(slate)
      if (jsonBytes(doc) > limits.slateBytes) {
        skipped.push({ s: 'slates', id, reason: 'too_large' })
        yield { t: 'skip', s: 'slates', id, reason: 'too_large' }
        continue
      }
      yield { t: 'doc', s: 'slates', d: doc, h: contentHash(doc, fileName) }
    }

    const ids = index.map((entry) => entry.id)
    const shareIds = index.map((entry) => entry.shareId).filter(Boolean)
    const since = new Date(now() - limits.eventDays * 86400000)
    for (const id of ids) {
      const versions = await db.snapshots.find({ slateId: id }, { sort: { created: -1 }, limit: limits.versionsPerSlate }).toArray()
      for (const version of versions.reverse()) yield* small('versions', version, skipped)
    }
    for (const id of ids) {
      const events = await db.events
        .find({ slateId: id, at: { $gte: since.valueOf() } }, { sort: { revision: -1 }, limit: limits.eventsPerSlate })
        .toArray()
      for (const event of events.reverse()) yield* small('events', event, skipped)
    }
    for (const batch of chunks(ids))
      for await (const comment of db.comments.find({ slateId: { $in: batch } })) yield* small('comments', comment, skipped)
    for (const batch of chunks(shareIds))
      for await (const presentation of db.presentations.find({ slateShareId: { $in: batch } })) yield* small('presentations', presentation, skipped)
    for (const batch of chunks(shareIds))
      for await (const chat of db.presentationChats.find({ slateShareId: { $in: batch } })) yield* small('presentationChats', chat, skipped)
    for (const batch of chunks(ids))
      for await (const grant of db.slateAccess.find({ slateId: { $in: batch } }))
        yield* small('links', { _id: grant._id, slateId: grant.slateId, type: grant.type, userId: grant.userId ?? null, role: grant.slateAccessPermissionId }, skipped)
    for await (const setting of db.orgSettings.find({ orgId })) yield* small('settings', setting, skipped)

    // AI: the team's connections without their keys, and which one each feature uses.
    const connections = await db.providerKeys.find({ ownerType: 'org', ownerId: orgId }).toArray()
    const choices = await db.aiChoices.findOne({ _id: 'org:' + orgId })
    yield {
      t: 'doc',
      s: 'ai',
      d: {
        connections: connections
          .filter((doc) => doc.provider !== 'daily' && typeof doc.name === 'string')
          .map((doc) => ({
            name: doc.name,
            provider: doc.provider,
            ...(typeof doc.baseUrl === 'string' && { baseUrl: doc.baseUrl }),
            ...(typeof doc.model === 'string' && { model: doc.model }),
            hadKey: Boolean(doc.cipher),
          })),
        use: scrubSecrets(choices?.use || {}),
      },
    }

    // Tokens: what to make again on the other side. Never the secret, its hash or its prefix.
    for (const batch of chunks(memberIds))
      for await (const token of db.apiTokens.find({ userId: { $in: batch } }))
        yield {
          t: 'doc',
          s: 'tokens',
          d: {
            userId: token.userId,
            name: String(token.name || '').slice(0, 80),
            scopes: Array.isArray(token.scopes) ? token.scopes.filter((scope) => typeof scope === 'string') : [],
            createdAt: token.createdAt ?? null,
            revoked: Boolean(token.revokedAt),
          },
        }
  }

  return { preflight, records }
}

export const exportHash = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex')
