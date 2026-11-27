// Removing a person's uploaded files (the editor's image uploads and the phone app's photos, keys
// <YYYY>/<MM>/<DD>/u_<userId>_<id>.<ext>, upload-keys.mjs) once nothing uses them any more.
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

// An upload key anywhere in a text: an absolute URL, a /files/ path, a key on its own.
const UPLOAD_KEY_TEXT = /\d{4}\/\d{2}\/\d{2}\/u_[A-Za-z0-9]{17}_[A-Za-z0-9]{17}\.(?:png|jpg|gif|webp|pdf|txt)/g

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
  if (!text.includes('u_')) return keys
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

/**
 * A person's uploads in a bucket: one prefix per day folder (<day>/u_<userId>_), from the day
 * before the account was made to the day after `until`. Only keys that are that person's
 * (uploadKeyFor) are returned.
 */
export async function bucketUploadsOf({ userId, since, until, listPrefix, dateFolder, uploadKeyFor }) {
  const keys = new Set()
  for (const folder of dayFoldersBetween(since, until, dateFolder)) {
    for (const key of await listPrefix(`${folder}/u_${userId}_`)) if (uploadKeyFor(key, userId)) keys.add(key)
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
 * @param deps.queue   { put(item), claim({ at, limit, leaseMs }) -> items, done(id), later(id, { dueAt, attempts, failure }) }
 *                     An item: { _id, kind: 'file' | 'account', key?, userId?, since?, dueAt, attempts }.
 * @param deps.files   { listUploadsOf(userId, since) -> keys, remove(key) }: the file store.
 * @param deps.isUsed  (Set of keys) -> Set of the keys a stored document still names.
 * @param deps.now     the clock
 * @param deps.log     (message, details) for what was done and what failed; details never hold a key.
 */
export function createUploadRemoval({ queue, files, isUsed, now = Date.now, log = () => {}, graceMs = GRACE_MS }) {
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

  async function failed(item, error) {
    const attempts = (item.attempts || 0) + 1
    const failure = failureOf(error)
    log('upload removal failed; it will be retried', { kind: item.kind, attempts, ...failure })
    await queue.later(item._id, { dueAt: now() + retryDelay(attempts), attempts, failure })
  }

  // Remove the keys nothing names. Returns the keys kept because something still names them.
  async function runAccount(item) {
    const keys = new Set(await files.listUploadsOf(item.userId, item.since))
    const used = keys.size ? await isUsed(keys) : new Set()
    let removed = 0
    for (const key of keys) {
      if (used.has(key)) continue
      await files.remove(key)
      removed += 1
    }
    const kept = [...used].filter((key) => keys.has(key))
    // Kept: another slate shows it (a copy, a team slate that stays). Checked again after the grace
    // period, when the snapshots that named it have gone, and kept for as long as anything uses it.
    if (kept.length) await released(kept)
    await queue.done(item._id)
    log('account uploads removed', { removed, kept: kept.length })
  }

  async function runFiles(items) {
    const keys = new Set(items.map((item) => item.key))
    const used = await isUsed(keys)
    let removed = 0
    for (const item of items) {
      try {
        if (!used.has(item.key)) {
          await files.remove(item.key)
          removed += 1
        }
        // Still named somewhere: kept. A later save or deletion that releases it queues it again.
        await queue.done(item._id)
      } catch (error) {
        await failed(item, error)
      }
    }
    if (items.length) log('released uploads checked', { removed, kept: items.length - removed })
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
        await queue.done(item._id)
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
