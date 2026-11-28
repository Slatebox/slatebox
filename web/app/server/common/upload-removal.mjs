// Removing a person's stored files once nothing uses them any more: the editor's image uploads and
// the phone app's photos (<YYYY>/<MM>/<DD>/u_<userId>_<id>.<ext>, upload-keys.mjs), the pictures
// the agent made for them (<YYYY>/<MM>/<DD>/ai_<userId>_<id>.<ext>, methods/stabilityai.js) and the
// pictures a presentation copied in from a link (<YYYY>/<MM>/presentation_<userId>_<id>.<ext>, UTC
// month, methods/presentations.js).
//
// Two things release files:
//   - an account is removed (users.delete, a team owner deleting their team, an admin removing a
//     member): every upload of that person's is listed in the file store and removed straight away,
//     except one another slate still shows (a copy someone made, a team slate that stays): that one
//     is checked again after the grace period, and kept while anything still uses it;
//   - a note is deleted, or its picture replaced (any save through the save core), or a slate is
//     deleted: the upload keys the slate used before and no longer uses are queued, and removed after
//     the grace period (GRACE_MS) only when no stored document still names them. Undo, a duplicated
//     slate, a copy, a snapshot (kept 3 days), a library item or an open suggestion that still names
//     the file keeps it.
//
// A file removed from a bucket behind a CDN is dropped from the CDN too (deps.cdn,
// cdn-invalidation.mjs), so it stops being served at once rather than when its cached copy expires.
//
// Nothing here ever blocks the account removal or the save that released the files: the work is
// queued, run in the background, and a failure is logged (the error's name and status only, never a
// key, URL or credential) and retried with a backoff by the sweep.
//
// MIT, runs without Meteor (scripts/upload-removal.test.mjs). The Meteor glue is upload-removal.js.

/** How long a released file waits before it may be removed: past the 3-day snapshot window and any undo. */
export const GRACE_MS = 7 * 24 * 60 * 60 * 1000
/** How long one server holds a claimed queue item before another may take it. */
export const LEASE_MS = 15 * 60 * 1000
/** The first retry after a failure; doubled for each further failure, up to MAX_RETRY_MS. */
export const RETRY_MS = 15 * 60 * 1000
export const MAX_RETRY_MS = 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// The names of a person's files: the person's id and a Random.id() (17 letters and digits each).
const ID = '[A-Za-z0-9]{17}'
const DAY_FILE = `\\d{4}/\\d{2}/\\d{2}/(?:u|ai)_(${ID})_${ID}\\.(?:png|jpg|gif|webp|pdf|txt)`
const MONTH_FILE = `\\d{4}/\\d{2}/presentation_(${ID})_${ID}\\.(?:png|jpg|gif|webp|img)`
// A person's file key anywhere in a text: an absolute URL, a /files/ path, a key on its own. The
// same names are released, looked for as references and listed for a removed account, so a file
// is never removed for a way of naming it the reference check does not read.
const UPLOAD_KEY_TEXT = new RegExp(`${DAY_FILE}|${MONTH_FILE}`, 'g')
const ACCOUNT_FILE = new RegExp(`^(?:${DAY_FILE}|${MONTH_FILE})$`)

/** The key when it names one of that person's files (an upload, an agent's picture, a presentation's copied picture), else null. */
export function accountFileKeyFor(key, userId) {
  if (typeof key !== 'string' || !userId) return null
  const m = ACCOUNT_FILE.exec(key)
  return m && (m[1] ?? m[2]) === userId ? key : null
}

function textOf(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    // A value JSON cannot write (a cycle) names nothing this can read; the caller keeps its files.
    return String(value)
  }
}

/**
 * Every upload key a value names, wherever it is in the value. A URL written with escaped
 * slashes (%2F, \/, escaped again inside a JSON string) is read too, so a reference is never missed for the way it was written.
 */
export function uploadKeysIn(value) {
  const text = textOf(value)
  const keys = new Set()
  if (!text.includes('_')) return keys
  const plain = text.replace(/%2F/gi, '/').replace(/\\+\//g, '/')
  for (const match of plain.matchAll(UPLOAD_KEY_TEXT)) keys.add(match[0])
  return keys
}

const readPath = (doc, path) => path.split('.').reduce((value, part) => (value == null ? undefined : value[part]), doc)
const IGNORED_PATHS = new Set(['lastSaved', 'revision', 'recentTouches'])

/**
 * The upload keys a save stops using: named by the stored slate at a path the save's $set writes,
 * and named nowhere in what the save writes. A key that moves from one note to another (or to
 * another path in the same save) is not released.
 */
export function releasedUploadKeys(current, set) {
  if (!current || !set) return []
  const paths = Object.keys(set).filter((path) => !IGNORED_PATHS.has(path))
  const before = new Set()
  for (const path of paths) for (const key of uploadKeysIn(readPath(current, path))) before.add(key)
  if (!before.size) return []
  const after = new Set()
  for (const path of paths) for (const key of uploadKeysIn(set[path])) after.add(key)
  return [...before].filter((key) => !after.has(key))
}

/** The date folders (dateFolder of upload-keys.mjs) from a day before `since` to a day after `until`. */
export function dayFoldersBetween(since, until, dateFolder) {
  const start = new Date(new Date(since).getTime() - DAY_MS)
  start.setHours(12, 0, 0, 0)
  const endDay = new Date(new Date(until).getTime() + DAY_MS)
  endDay.setHours(23, 59, 59, 999)
  const end = endDay.getTime()
  const folders = []
  for (let at = start; at.getTime() <= end; at = new Date(at.getTime() + DAY_MS)) {
    const folder = dateFolder(at)
    if (folders[folders.length - 1] !== folder) folders.push(folder)
  }
  return folders
}

/** The UTC month folders (2026/11) from a day before `since` to a day after `until`. */
export function monthFoldersBetween(since, until) {
  const start = new Date(new Date(since).getTime() - DAY_MS)
  const end = new Date(new Date(until).getTime() + DAY_MS)
  const last = end.getUTCFullYear() * 12 + end.getUTCMonth()
  const folders = []
  for (let month = start.getUTCFullYear() * 12 + start.getUTCMonth(); month <= last; month += 1) {
    folders.push(`${Math.floor(month / 12)}/${String((month % 12) + 1).padStart(2, '0')}`)
  }
  return folders
}

/**
 * Every key a paged listing gives (S3 ListObjectsV2: Contents, IsTruncated, NextContinuationToken).
 * @param page (continuationToken | undefined) -> one page
 */
export async function pagedKeys(page) {
  const keys = []
  let token
  do {
    const result = await page(token)
    for (const item of result?.Contents || []) if (typeof item?.Key === 'string') keys.push(item.Key)
    token = result?.IsTruncated ? result.NextContinuationToken : undefined
  } while (token)
  return keys
}

/** The bucket prefixes a person's files are under, from the day before `since` to the day after `until`. */
export function accountPrefixes({ userId, since, until, dateFolder }) {
  const prefixes = []
  for (const folder of dayFoldersBetween(since, until, dateFolder)) prefixes.push(`${folder}/u_${userId}_`, `${folder}/ai_${userId}_`)
  for (const month of monthFoldersBetween(since, until)) prefixes.push(`${month}/presentation_${userId}_`)
  return prefixes
}

/**
 * A person's files in a bucket: their uploads and the agent's pictures by day folder
 * (<day>/u_<userId>_, <day>/ai_<userId>_), a presentation's copied pictures by UTC month
 * (<month>/presentation_<userId>_), from the day before the account was made to the day after
 * `until`. Only keys that are that person's (accountFileKeyFor) are returned.
 */
export async function bucketUploadsOf({ userId, since, until, listPrefix, dateFolder }) {
  const keys = new Set()
  for (const prefix of accountPrefixes({ userId, since, until, dateFolder })) {
    for (const key of await listPrefix(prefix)) if (accountFileKeyFor(key, userId)) keys.add(key)
  }
  return [...keys]
}

/** What a failure is logged as: its name, code and HTTP status. Never its message (it may name a key or bucket). */
export function failureOf(error) {
  return {
    name: typeof error?.name === 'string' ? error.name.slice(0, 60) : 'Error',
    ...(typeof error?.code === 'string' && { code: error.code.slice(0, 60) }),
    ...(Number.isInteger(error?.$metadata?.httpStatusCode) && { status: error.$metadata.httpStatusCode }),
  }
}

export const retryDelay = (attempts) => Math.min(RETRY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_MS)

/**
 * Given the documents of every collection that may name a file, the keys of `keys` any of them
 * names. Stops reading once every key is found.
 * @param {AsyncIterable<object>|Iterable<object>} documents
 * @param {Set<string>} keys
 */
export async function referencedKeys(documents, keys) {
  const found = new Set()
  if (!keys.size) return found
  for await (const doc of documents) {
    for (const key of uploadKeysIn(doc)) if (keys.has(key)) found.add(key)
    if (found.size === keys.size) break
  }
  return found
}

/**
 * @param {object} deps
 * @param deps.queue   { put(item), claim({ at, limit, leaseMs }) -> items, done(item), later(item, { dueAt, attempts, failure }) }
 *                     An item: { _id, kind: 'file' | 'account', key?, userId?, since?, dueAt, attempts }.
 *                     done and later change the row only while it is still the claimed one (same
 *                     _id and dueAt): a file released again during a run keeps its new wait.
 * @param deps.files   { listUploadsOf(userId, since) -> keys, remove(key) }: the file store.
 * @param deps.isUsed  (Set of keys) -> Set of the keys a stored document still names.
 * @param deps.cdn     optional { invalidate(keys) }: told the keys each run removed, so a CDN in front
 *                     of the file store stops serving them (cdn-invalidation.mjs). Never blocks a run.
 * @param deps.now     the clock
 * @param deps.log     (message, details) for what was done and what failed; details never hold a key.
 */
export function createUploadRemoval({ queue, files, isUsed, cdn = null, now = Date.now, log = () => {}, graceMs = GRACE_MS }) {
  /** Files a save or a deleted slate stopped using: removed after the grace period if nothing names them then. */
  async function released(keys) {
    const at = now()
    for (const key of new Set(keys)) {
      // Released again: the grace period starts again.
      await queue.put({ _id: `file:${key}`, kind: 'file', key, dueAt: at + graceMs, attempts: 0 })
    }
  }

  /** An account was removed: its uploads are removed on the next run (run it at once with sweep()). */
  async function accountRemoved({ userId, createdAt }) {
    if (typeof userId !== 'string' || !userId) return
    const since = Number.isFinite(new Date(createdAt).getTime()) ? new Date(createdAt).getTime() : null
    await queue.put({ _id: `account:${userId}`, kind: 'account', userId, since, dueAt: now(), attempts: 0 })
  }

  // The CDN drops its copies of what was removed. A failure there never fails the removal.
  async function uncache(keys) {
    if (!cdn || !keys.length) return
    try {
      await cdn.invalidate(keys)
    } catch (error) {
      log('CDN invalidation failed', failureOf(error))
    }
  }

  async function failed(item, error) {
    const attempts = (item.attempts || 0) + 1
    const failure = failureOf(error)
    log('upload removal failed; it will be retried', { kind: item.kind, attempts, ...failure })
    await queue.later(item, { dueAt: now() + retryDelay(attempts), attempts, failure })
  }

  // Remove the keys nothing names. Returns the keys kept because something still names them.
  async function runAccount(item) {
    const keys = new Set(await files.listUploadsOf(item.userId, item.since))
    const used = keys.size ? await isUsed(keys) : new Set()
    const removed = []
    try {
      for (const key of keys) {
        if (used.has(key)) continue
        await files.remove(key)
        removed.push(key)
      }
    } finally {
      // Also when a removal failed part way: what is gone already is dropped from the CDN now.
      await uncache(removed)
    }
    const kept = [...used].filter((key) => keys.has(key))
    // Kept: another slate shows it (a copy, a team slate that stays). Checked again after the grace
    // period, when the snapshots that named it have gone, and kept for as long as anything uses it.
    if (kept.length) await released(kept)
    await queue.done(item)
    log('account uploads removed', { removed: removed.length, kept: kept.length })
  }

  async function runFiles(items) {
    const keys = new Set(items.map((item) => item.key))
    const used = await isUsed(keys)
    const removed = []
    for (const item of items) {
      try {
        if (!used.has(item.key)) {
          await files.remove(item.key)
          removed.push(item.key)
        }
        // Still named somewhere: kept. A later save or deletion that releases it queues it again.
        await queue.done(item)
      } catch (error) {
        await failed(item, error)
      }
    }
    await uncache(removed)
    if (items.length) log('released uploads checked', { removed: removed.length, kept: items.length - removed.length })
  }

  /** One run of the queue: the items due now, claimed so another server does not run them too. */
  async function sweep({ limit = 200 } = {}) {
    const items = await queue.claim({ at: now(), limit, leaseMs: LEASE_MS })
    const fileItems = []
    for (const item of items) {
      if (item.kind === 'account') {
        try {
          await runAccount(item)
        } catch (error) {
          await failed(item, error)
        }
      } else if (item.kind === 'file' && typeof item.key === 'string') {
        fileItems.push(item)
      } else {
        await queue.done(item)
      }
    }
    if (fileItems.length) {
      try {
        await runFiles(fileItems)
      } catch (error) {
        // The reference check itself failed: every item waits and is tried again.
        for (const item of fileItems) await failed(item, error)
      }
    }
    return { claimed: items.length }
  }

  return { released, accountRemoved, sweep }
}
