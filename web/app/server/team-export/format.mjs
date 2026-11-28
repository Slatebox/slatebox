// The team export format, version 2: what "Export everything" writes and what the importer
// reads. One archive holds everything a team owns, as lines of JSON (NDJSON), gzipped and, when
// the person gives a passphrase, encrypted (archive.mjs). The format is open: docs/team-export.md
// describes every line, and nothing here depends on Meteor.
//
// Lines, in this order (the importer refuses an archive whose sections go backwards):
//   {"t":"head", ...}                         format, version, when, the source instance and team
//   {"t":"doc","s":"team","d":{...}}          the team: its name
//   {"t":"doc","s":"members","d":{...}}       one per person: name, email, roles, owner (never a password)
//   {"t":"doc","s":"index","d":{...}}         the source ids of every slate that follows
//   {"t":"file","d":{...}} + {"t":"chunk"}... one per uploaded file the slates, brand kit, presentations
//                                             and library items use, its bytes in chunks
//   {"t":"doc","s":"slates","d":{...},"h":…}  one per slate (boards and smart components included), with its content hash
//   {"t":"doc","s":"versions","d":{...}}      recent saved versions of each slate
//   {"t":"doc","s":"events","d":{...}}        the slates' recent event log
//   {"t":"doc","s":"comments","d":{...}}
//   {"t":"doc","s":"presentations","d":{...}}
//   {"t":"doc","s":"presentationChats","d":{...}}
//   {"t":"doc","s":"links","d":{...}}         who a slate is shared with and its published link role (never the link key)
//   {"t":"doc","s":"settings","d":{...}}      team settings (branding and the like)
//   {"t":"doc","s":"ai","d":{...}}            team AI connections and choices (never a key)
//   {"t":"doc","s":"tokens","d":{...}}        the names and scopes of the members' API tokens (never a secret)
//   {"t":"doc","s":"library","d":{...}}       the shared-library items the members wrote: details and content (arrive as drafts)
//   {"t":"skip","s":…,"id":…,"reason":…}       something the exporter left out, and why
//   {"t":"end", ...}                          counts, the digest of every line before it and its signature
//
// Never in an archive: passwords and their hashes, sessions and sign-in links, API, MCP and exec
// token secrets or hashes, AI and call keys (or their ciphers), published-link keys, wallet,
// meter and payment records. scrubSecrets removes any such field wherever it appears, and the
// tests grep the plaintext for them.
import { createHash } from 'node:crypto'

export const FORMAT = 'slatebox-team-export'
// The version this server writes. It reads every version from OLDEST_VERSION up to it, so an
// archive from an older server always imports here; one from a newer server is refused with
// "update this server" (archive.mjs), as is a section this server does not know (import-core).
// A change an older reader can skip safely (a new optional section) keeps the version.
export const VERSION = 2
export const OLDEST_VERSION = 2
export const UPDATE_THIS_SERVER = 'This archive was written by a newer Slatebox than this server runs. Update this server to the latest Slatebox, then import it again.'

export const SECTIONS = Object.freeze([
  'team',
  'members',
  'index',
  'files',
  'slates',
  'versions',
  'events',
  'comments',
  'presentations',
  'presentationChats',
  'links',
  'settings',
  'ai',
  'tokens',
  'library',
])

export const LIMITS = Object.freeze({
  // the whole archive, uncompressed
  totalBytes: 10 * 1024 ** 3,
  // one slate as JSON
  slateBytes: 15 * 1024 * 1024,
  // one uploaded file
  fileBytes: 50 * 1024 * 1024,
  // any other record as JSON
  docBytes: 2 * 1024 * 1024,
  // one line: a slate, or one base64 chunk of a file, with room for the envelope
  lineBytes: 16 * 1024 * 1024 + 4096,
  // raw bytes per file chunk line
  chunkBytes: 512 * 1024,
  // how many people, slates and documents of any one section an archive may hold
  members: 2000,
  slates: 20000,
  docsPerSection: 500000,
  // recent versions and events kept per slate
  versionsPerSlate: 20,
  eventsPerSlate: 500,
  eventDays: 90,
})

// Field names that hold a secret, wherever they appear in a document. Matched whole, ignoring case.
const SECRET_KEYS = new Set(
  [
    'services',
    'password',
    'passwordHash',
    'bcrypt',
    'argon2',
    'hashedToken',
    'loginTokens',
    'resume',
    'secret',
    'secrets',
    'clientSecret',
    'cipher',
    'apiKey',
    'apiKeyEnv',
    'last4',
    'token',
    'tokenHash',
    'accessKey',
    'privateKey',
    'stripeCustomerId',
    'customerId',
    'subscriptionId',
    'paymentMethodId',
    'dailyKey',
    'invitationLease',
  ].map((key) => key.toLowerCase())
)

export const isSecretKey = (key) => SECRET_KEYS.has(String(key).toLowerCase())

// A copy of value without any secret field, at any depth.
export function scrubSecrets(value, depth = 0) {
  if (depth > 80) return null
  if (Array.isArray(value)) return value.map((item) => scrubSecrets(item, depth + 1))
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString()
    if (value._bsontype === 'Binary' || Buffer.isBuffer(value)) return null
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (isSecretKey(key) || item === undefined) continue
      out[key] = scrubSecrets(item, depth + 1)
    }
    return out
  }
  return value
}

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  return value
}
export const createHashHex = (text) => createHash('sha256').update(text).digest('hex')

export const canonicalJson = (value) => JSON.stringify(canonical(value ?? null))

// What a slate holds, apart from who owns it, where it lives and when it was saved: the part an
// export and an import must keep the same. Files are named by their content, so a slate whose
// pictures moved to new addresses hashes the same.
// projectId: the project a slate sits in is this server's (an export carries no projects).
export const IDENTITY_FIELDS = ['_id', 'shareId', 'userId', 'orgId', 'created', 'lastSaved', 'revision', 'recentTouches', 'teamImportId', 'importedVisibility', 'importedFrom', 'projectId']
// options.shareId repeats the slate's share address, which a move changes.
const OPTION_IDENTITY = ['id', 'shareId', 'isPrivate', 'isPublic', 'isUnlisted', 'searchName', 'searchText', 'searchDescription']

// Every string in value, passed through fn, at any depth.
export function mapStrings(value, fn, depth = 0) {
  if (depth > 80) return value
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = mapStrings(item, fn, depth + 1)
    return out
  }
  return value
}

// Every object in value, visited depth first.
export function eachObject(value, fn, depth = 0) {
  if (depth > 80 || !value || typeof value !== 'object') return
  if (!Array.isArray(value)) fn(value)
  for (const item of Array.isArray(value) ? value : Object.values(value)) eachObject(item, fn, depth + 1)
}

const URL_PATTERN = /https?:\/\/[^\s"'<>()\\]+/g
export const replaceUrls = (text, fn) => (text.includes('://') ? text.replace(URL_PATTERN, (url) => fn(url) ?? url) : text)
export function urlsIn(value, found = new Set()) {
  mapStrings(value, (text) => {
    if (text.includes('://')) for (const match of text.matchAll(URL_PATTERN)) found.add(match[0])
    return text
  })
  return found
}

// Directory and template flags: where a slate is listed, which only a server's administrators set.
// The library fields (server/library): a builder or review slate's mode, and the item a slate was forked from.
export const SLATE_FLAGS = ['isTemplate', 'isFeatured', 'featured', 'featuredOn', 'templateApproved', 'isCommunity', 'library', 'libraryOrigin']
export const OPTION_FLAGS = ['isTemplate', 'templateApproved', 'isFeatured', 'isCommunity']

// A link to another slate is content, but its address is not: it changes when the slate moves.
const canvasLink = (url) => url.replace(/\/canvas\/[A-Za-z0-9_-]{1,80}(?=$|[/?#])/, '/canvas/*')

export function slateContent(slate, fileName = (url) => url, { keepOptionShareId = false } = {}) {
  const rest = { ...slate }
  for (const field of [...IDENTITY_FIELDS, ...SLATE_FLAGS]) delete rest[field]
  if (rest.options && typeof rest.options === 'object') {
    rest.options = { ...rest.options }
    for (const field of [...OPTION_IDENTITY, ...OPTION_FLAGS]) if (!(keepOptionShareId && field === 'shareId')) delete rest.options[field]
  }
  // the search fields the save core builds
  for (const key of Object.keys(rest)) if (/^search[A-Z]/.test(key)) delete rest[key]
  return mapStrings(rest, (text) => replaceUrls(text, (url) => canvasLink(fileName(url) ?? url)))
}

export function contentHash(slate, fileName) {
  return createHashHex(canonicalJson(slateContent(slate, fileName)))
}

// Does a slate as received match the hash its exporter wrote? A server whose exporter kept
// options.shareId in the content wrote that hash; it is taken too, so an archive from either reads.
export function matchesContentHash(slate, fileName, hash) {
  if (contentHash(slate, fileName) === hash) return true
  return createHashHex(canonicalJson(slateContent(slate, fileName, { keepOptionShareId: true }))) === hash
}


// An uploaded file's address: <cloudUrl>/YYYY/MM/DD/<name>. The name says whose it is: an upload
// is u_<userId>_<random>.<ext>, a slate's picture is <slateId>[_<time>].<ext>.
const KEY = /^(\d{4}\/\d{2}\/\d{2})\/([A-Za-z0-9_-]{1,120})\.(png|jpg|jpeg|gif|webp|pdf|txt|svg)$/
export function uploadKey(url, cloudUrl) {
  if (!cloudUrl || typeof url !== 'string') return null
  const prefix = cloudUrl.replace(/\/+$/, '') + '/'
  if (!url.startsWith(prefix)) return null
  const key = url.slice(prefix.length).split(/[?#]/)[0]
  const match = KEY.exec(key)
  if (!match) return null
  const name = match[2]
  const upload = /^u_([A-Za-z0-9]{17})_[A-Za-z0-9]{17}$/.exec(name)
  return { key, ext: match[3], ownerUserId: upload ? upload[1] : null, slateId: upload ? null : name.split('_')[0] }
}
