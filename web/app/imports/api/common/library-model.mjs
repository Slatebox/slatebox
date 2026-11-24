// The shared library (smart components, slates and presentations): the pure model the server and
// the browser share. Kinds, categories, statuses, the metadata limits, slugs and the one lifecycle
// table. No database and no Meteor here: server/library/core.mjs stores what this module checks.

export const LIBRARY_KINDS = Object.freeze(['component', 'slate', 'presentation'])
// The engine catalogue's groups less "All", which is a filter, not a category (slateboxjs/catalog catalogGroups).
export const LIBRARY_CATEGORIES = Object.freeze(['plan', 'decide', 'meetings', 'track', 'map'])
export const CATEGORY_LABELS = Object.freeze({ plan: 'Plan', decide: 'Decide', meetings: 'Meetings', track: 'Track', map: 'Map' })
export const KIND_LABELS = Object.freeze({ component: 'smart component', slate: 'slate', presentation: 'presentation' })
export const LIBRARY_STATUSES = Object.freeze(['draft', 'submitted', 'in_review', 'changes_requested', 'published', 'rejected', 'unpublished'])
export const LIBRARY_ORIGINS = Object.freeze(['builtin', 'user'])
// The license every published item is shared under. One constant: the owner can change it.
export const LIBRARY_LICENSE = 'CC-BY-4.0'
export const LIBRARY_LICENSE_LINE = 'Once approved, anyone can find, use and change it. Shared under CC BY 4.0.'
export const BUILTIN_AUTHOR = 'Slatebox'
export const UNNAMED_AUTHOR = 'A Slatebox user'

export const LIBRARY_LIMITS = Object.freeze({
  title: 80,
  summary: 160,
  description: 2000,
  synonyms: 12,
  synonym: 40,
  message: 2000,
  versionBytes: 1000000,
  submissionsPerDay: 10,
  // What one person may do in a day (server/library/uses.mjs spendAllowance).
  perDay: Object.freeze({ submit: 10, saveDraft: 200, branch: 50, fork: 100, comment: 100 }),
  listLimit: 48,
  exportPage: 50,
  history: 6,
  mineEvents: 20,
})

/** An error the server answers as it is: { status, code, message } (server/actions/errors.mjs toActionError). */
export function libraryError(status, code, message, details) {
  return Object.assign(new Error(message), { status, code, ...(details !== undefined && { details }) })
}

/** Plain text: no control characters, no markup brackets, spaces collapsed (newlines kept when `lines`). */
export function plainText(value, { lines = false } = {}) {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '')
  return lines
    ? cleaned.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : cleaned.replace(/\s+/g, ' ').trim()
}

/** The slug an item is found by: its title in lowercase words, then the first 6 characters of its id. */
export function slugify(title, id = '') {
  const words = plainText(title).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '')
  const tail = String(id).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toLowerCase()
  return [words || 'item', tail].filter(Boolean).join('-')
}

export const categoryLabel = (category) => CATEGORY_LABELS[category] || category
/** The sentence a branch that tries another category is answered with. */
export const categoryLockSentence = (category) => `A branch stays in its parent's category, ${categoryLabel(category)}.`

/**
 * Read item metadata from a request. `partial` reads only the fields given (an edit); otherwise
 * title and summary are required. Answers the cleaned fields; throws a 400 naming the field.
 */
export function readMeta(input = {}, { kind = 'component', partial = false } = {}) {
  const out = {}
  const bad = (field, message) => libraryError(400, 'invalid_request', message, { field })
  const text = (field, max, { lines = false, required = false } = {}) => {
    if (input[field] === undefined) {
      if (required && !partial) throw bad(field, `Give it a ${field}.`)
      return
    }
    if (typeof input[field] !== 'string') throw bad(field, `${field} is text.`)
    const value = plainText(input[field], { lines })
    if (!value && (required || partial)) throw bad(field, `Give it a ${field}.`)
    if (value.length > max) throw bad(field, `A ${field} is at most ${max} characters.`)
    if (value || !required) out[field] = value
  }
  text('title', LIBRARY_LIMITS.title, { required: true })
  text('summary', LIBRARY_LIMITS.summary, { required: true })
  text('description', LIBRARY_LIMITS.description, { lines: true })
  if (input.category !== undefined && input.category !== null) {
    if (!LIBRARY_CATEGORIES.includes(input.category)) throw bad('category', `A category is one of ${LIBRARY_CATEGORIES.map(categoryLabel).join(', ')}.`)
    out.category = input.category
  }
  if (input.synonyms !== undefined) {
    if (kind !== 'component') throw bad('synonyms', 'Only a smart component has search words.')
    if (!Array.isArray(input.synonyms) || input.synonyms.length > LIBRARY_LIMITS.synonyms)
      throw bad('synonyms', `Up to ${LIBRARY_LIMITS.synonyms} search words.`)
    const words = []
    for (const word of input.synonyms) {
      const value = plainText(word)
      if (!value || value.length > LIBRARY_LIMITS.synonym) throw bad('synonyms', `A search word is 1 to ${LIBRARY_LIMITS.synonym} characters.`)
      if (!words.some((have) => have.toLowerCase() === value.toLowerCase())) words.push(value)
    }
    out.synonyms = words
  }
  return out
}

/** A thread message: plain text, 1 to 2,000 characters. */
export function readMessage(message, { required = true } = {}) {
  if (message === undefined || message === null || message === '') {
    if (required) throw libraryError(400, 'message_required', 'Write a message to go with this.', { field: 'message' })
    return undefined
  }
  if (typeof message !== 'string') throw libraryError(400, 'invalid_request', 'message is text.', { field: 'message' })
  const value = plainText(message, { lines: true })
  if (!value && required) throw libraryError(400, 'message_required', 'Write a message to go with this.', { field: 'message' })
  if (value.length > LIBRARY_LIMITS.message) throw libraryError(400, 'invalid_request', `A message is at most ${LIBRARY_LIMITS.message} characters.`, { field: 'message' })
  return value || undefined
}

// ---------- the lifecycle ----------
// One table: [from statuses, action, role, to]. `null` from is a new item. 'same' keeps the status;
// 'gone' removes the item (a discarded draft).
export const LIFECYCLE = Object.freeze([
  [[null, 'draft'], 'saveDraft', 'author', 'draft'],
  [[null, 'draft', 'changes_requested', 'rejected', 'unpublished'], 'submit', 'author', 'submitted'],
  // An update to a published item: it stays published, and the new version waits (pendingVersion).
  [['published'], 'submit', 'author', 'same'],
  [['submitted'], 'withdraw', 'author', 'draft'],
  [['published'], 'withdraw', 'author', 'unpublished'],
  [['draft'], 'discard', 'author', 'gone'],
  // Opening again (a refreshed review copy) keeps it in review.
  [['submitted', 'changes_requested', 'in_review'], 'review.open', 'reviewer', 'in_review'],
  [['in_review'], 'review.requestChanges', 'reviewer', 'changes_requested'],
  [['in_review'], 'review.approve', 'reviewer', 'published'],
  [['in_review', 'submitted'], 'review.reject', 'reviewer', 'rejected'],
  [['published'], 'review.unpublish', 'reviewer', 'unpublished'],
])

/** The status an action leads to from `status` (null: a new item), or null when the table does not allow it. */
export function nextStatus(status, action, role) {
  for (const [from, act, who, to] of LIFECYCLE) {
    if (act === action && who === role && from.includes(status ?? null)) return to === 'same' ? status : to
  }
  return null
}

// The statuses of a version waiting on a reviewer (reviewStatus; the queue reads it).
const PENDING_STATUSES = ['submitted', 'in_review', 'changes_requested', 'rejected']

/**
 * What an action does to an item: `{ status, reviewStatus }` to store, or null when not allowed.
 * `status` is what the public sees; `reviewStatus` is the state of the version waiting for review
 * (null when none). On a published item with an update waiting, the review actions move the update
 * (reviewStatus) and the item stays published until the update is approved.
 */
export function transition(item, action, role) {
  const status = item?.status ?? null
  const updating = status === 'published' && Boolean(item?.pendingVersion) && PENDING_STATUSES.includes(item?.reviewStatus)
  if (updating && action.startsWith('review.') && action !== 'review.unpublish') {
    const to = nextStatus(item.reviewStatus, action, role)
    if (!to) return null
    return { status: 'published', reviewStatus: to === 'published' ? null : to }
  }
  // Withdrawing an update takes back only the update: the published version stays live. An update a
  // reviewer has open can't be taken back (write to the reviewer instead).
  if (updating && action === 'withdraw') {
    return role === 'author' && ['submitted', 'changes_requested', 'rejected'].includes(item.reviewStatus) ? { status: 'published', reviewStatus: null } : null
  }
  // A new update replaces the waiting one only once it is no longer waiting on a reviewer: never while
  // it is submitted or in review (that would wipe the reviewer's refinements).
  if (status === 'published' && action === 'submit') {
    if (role !== 'author' || (item?.pendingVersion && ['submitted', 'in_review'].includes(item?.reviewStatus))) return null
    return { status, reviewStatus: 'submitted' }
  }
  const to = nextStatus(status, action, role)
  if (!to) return null
  return { status: to, reviewStatus: PENDING_STATUSES.includes(to) ? to : null }
}

/** The state a reviewer sees an item in: its waiting version's state, or its own status. */
export const reviewStateOf = (item) => item?.reviewStatus || item?.status || null

/** Whether a person may read an item: published is public; anything else only its author and reviewers. */
export function canReadItem(item, { userId = null, reviewer = false } = {}) {
  if (!item) return false
  if (item.status === 'published') return true
  return Boolean(reviewer || (userId && item.authorId === userId))
}

/** The waiting statuses the review queue shows by default. */
export const QUEUE_WAITING = Object.freeze(['submitted', 'changes_requested'])
export const QUEUE_STATUSES = Object.freeze(['submitted', 'in_review', 'changes_requested', 'rejected'])
