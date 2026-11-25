// The shared library (smart components, slates, presentations and integrations): the pure model the
// server and the browser share. An integration is a custom MCP server someone connected and suggested
// for everyone: approved, it becomes a Community card in Connect an integration › Existing
// (enterprise/: Slatebox as an MCP client). Only its address and the words people wrote travel, never
// a sign-in or what the server says about itself. Kinds, categories, statuses, the metadata limits, slugs and the one lifecycle
// table. No database and no Meteor here: server/library/core.mjs stores what this module checks.

export const LIBRARY_KINDS = Object.freeze(['component', 'slate', 'presentation', 'integration'])
// The engine catalogue's groups less "All", which is a filter, not a category (slateboxjs/catalog catalogGroups).
export const LIBRARY_CATEGORIES = Object.freeze(['plan', 'decide', 'meetings', 'track', 'map'])
export const CATEGORY_LABELS = Object.freeze({ plan: 'Plan', decide: 'Decide', meetings: 'Meetings', track: 'Track', map: 'Map' })
export const KIND_LABELS = Object.freeze({ component: 'smart component', slate: 'slate', presentation: 'presentation', integration: 'integration' })
// An integration's categories: the agent gallery's chips (enterprise/common/gallery.mjs GROUPS, same ids and words).
export const INTEGRATION_CATEGORIES = Object.freeze(['work', 'business', 'research', 'web'])
export const INTEGRATION_CATEGORY_LABELS = Object.freeze({ work: 'Work', business: 'Business', research: 'Research', web: 'Web and facts' })
// How a suggested integration signs people in, as its author says (the reviewer's check reads the server itself).
export const INTEGRATION_AUTH = Object.freeze(['none', 'oauth', 'key'])
export const INTEGRATION_AUTH_LABELS = Object.freeze({ none: 'No sign-in', oauth: 'Sign in on its own page (OAuth)', key: 'API key or token' })
export const INTEGRATION_CONSENT_LINE = 'If it is approved, its address, name and description are public: anyone using Slatebox can find and connect it. Your sign-in is never shared.'
// The kinds the public library lists and exports unless one is asked for by name: an integration is a
// card in Connect an integration, not something to open on a canvas.
export const LISTED_KINDS = Object.freeze(['component', 'slate', 'presentation'])
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

export const categoryLabel = (category) => CATEGORY_LABELS[category] || INTEGRATION_CATEGORY_LABELS[category] || category
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
    const categories = kind === 'integration' ? INTEGRATION_CATEGORIES : LIBRARY_CATEGORIES
    if (!categories.includes(input.category)) throw bad('category', `A category is one of ${categories.map(categoryLabel).join(', ')}.`)
    out.category = input.category
  }
  // An integration's words become a card: no web addresses in its name or line (its homepage has its own field).
  if (kind === 'integration') {
    for (const field of ['title', 'summary']) {
      if (out[field] && /\bhttps?:\/\/|\bwww\./i.test(out[field])) throw bad(field, 'Leave web addresses out of the name and description. Put its homepage in its own field.')
    }
    if (out.title && out.title.length > INTEGRATION_LIMITS.name) throw bad('title', `A name is at most ${INTEGRATION_LIMITS.name} characters.`)
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

export const INTEGRATION_LIMITS = Object.freeze({ name: 40, homepage: 300 })

/**
 * What a person says about the integration they suggest, beyond its name, line and category: its
 * homepage or docs (https, no sign-in details in it), how it signs people in, and their agreement that
 * its address and words become public once approved. → { homepage, auth }; throws a 400 naming the field.
 */
export function readIntegrationFields(input = {}) {
  const bad = (field, message) => libraryError(400, 'invalid_request', message, { field })
  if (input.consent !== true) throw libraryError(400, 'consent_required', 'Agree that its address and description become public if it is approved.', { field: 'consent' })
  if (!input.integrationId || typeof input.integrationId !== 'string') throw bad('integrationId', 'Name the connected integration to suggest (integrationId, from integrations.list).')
  const auth = input.auth ?? 'none'
  if (!INTEGRATION_AUTH.includes(auth)) throw bad('auth', 'auth is none, oauth or key.')
  let homepage = null
  if (input.homepage !== undefined && input.homepage !== null && input.homepage !== '') {
    if (typeof input.homepage !== 'string' || input.homepage.length > INTEGRATION_LIMITS.homepage) throw bad('homepage', `A homepage is a web address of at most ${INTEGRATION_LIMITS.homepage} characters.`)
    let url
    try { url = new URL(input.homepage.trim()) } catch { throw bad('homepage', 'The homepage is not a web address.') }
    if (url.protocol !== 'https:') throw bad('homepage', 'The homepage starts with https://')
    if (url.username || url.password) throw bad('homepage', 'Leave sign-in details out of the homepage.')
    url.hash = ''
    homepage = url.href
  }
  return { homepage, auth }
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

// ---------- the name an item credits ----------
// An item credits its author by the name on their account (firstName and lastName), never their email.
// Someone signed in with no name is asked once, as they submit ("How should we credit you?"); the answer
// is saved to their profile, so this item and the next credit it. A guest can't submit at all.
export const CREDIT_QUESTION = 'How should we credit you?'
export const CREDIT_HELP = 'Shown with what you publish. Saved to your profile.'

/** Whether this account has no name to credit: signed in (not a guest) with no first or last name. */
export function needsCreditName(user) {
  if (!user || user.isAnonymous) return false
  return ![user.profile?.firstName, user.profile?.lastName].some((part) => typeof part === 'string' && part.trim())
}

/** The name typed as the profile keeps it ({ firstName, lastName, name }), or { problem } to show. */
export function readCreditName(text) {
  const name = plainText(text).slice(0, LIBRARY_LIMITS.title).trim()
  if (!name) return { problem: 'Say how we should credit you: a name or a nickname.' }
  if (/@/.test(name)) return { problem: 'Use a name rather than an email address: it is shown to everyone.' }
  const [firstName, ...rest] = name.split(' ')
  return { firstName, lastName: rest.join(' '), name }
}
