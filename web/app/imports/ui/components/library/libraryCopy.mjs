// The words the library's review queue, review panel, My library and the publish dialog say, from
// an item's status and its thread. Pure, so the tests read the same sentences the pages show.
import { CATEGORY_LABELS, KIND_LABELS, LIBRARY_CATEGORIES } from '../../../api/common/library-model.mjs'

export const QUEUE_TABS = Object.freeze([
  { id: 'waiting', label: 'Waiting' },
  { id: 'in_review', label: 'In review' },
  { id: 'published', label: 'Published' },
  { id: 'rejected', label: 'Not accepted' },
])
export const KIND_FILTERS = Object.freeze([
  { id: '', label: 'All' },
  { id: 'component', label: 'Smart components' },
  { id: 'slate', label: 'Slates' },
  { id: 'presentation', label: 'Presentations' },
])
export const CATEGORY_CHIPS = Object.freeze(LIBRARY_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })))

export const REFINE_STARTERS = Object.freeze([
  'What should I check?',
  'Tighten the rules',
  'Write a clearer one-line summary',
  'Pick the right category',
])

export const kindLabel = (kind) => KIND_LABELS[kind] || 'item'
export const KindTitle = (kind) => {
  const label = kindLabel(kind)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** What an author sees of their item: the status that matters to them. */
export function authorStatus(item) {
  const waiting = item.reviewStatus || item.status
  if (item.status === 'published' && item.reviewStatus === 'changes_requested') return { id: 'changes_requested', label: 'Update needs changes', tone: 'warning' }
  if (item.status === 'published' && item.reviewStatus === 'rejected') return { id: 'published', label: 'Published · update not accepted', tone: 'success' }
  if (item.status === 'published' && item.pendingVersion) return { id: 'published', label: 'Published · update waiting for review', tone: 'success' }
  switch (waiting) {
    case 'draft': return { id: 'draft', label: 'Draft', tone: 'default' }
    case 'submitted': return { id: 'waiting', label: 'Submitted for review', tone: 'info' }
    case 'in_review': return { id: 'waiting', label: 'Being reviewed', tone: 'info' }
    case 'changes_requested': return { id: 'changes_requested', label: 'Needs changes', tone: 'warning' }
    case 'published': return { id: 'published', label: 'Published', tone: 'success' }
    case 'rejected': return { id: 'rejected', label: 'Not accepted', tone: 'error' }
    case 'unpublished': return { id: 'unpublished', label: 'Taken out of the library', tone: 'default' }
    default: return { id: 'draft', label: 'Draft', tone: 'default' }
  }
}

// My library's groups, in order.
export const MINE_GROUPS = Object.freeze([
  { id: 'draft', title: 'Drafts' },
  { id: 'waiting', title: 'Waiting for review' },
  { id: 'changes_requested', title: 'Needs changes' },
  { id: 'published', title: 'Published' },
  { id: 'rejected', title: 'Not accepted' },
  { id: 'unpublished', title: 'Taken out' },
])

/** The caller's items in My library's groups (empty groups left out). */
export function groupMine(items = []) {
  const groups = new Map(MINE_GROUPS.map((group) => [group.id, []]))
  for (const item of items) groups.get(authorStatus(item).id)?.push(item)
  return MINE_GROUPS.map((group) => ({ ...group, items: groups.get(group.id) })).filter((group) => group.items.length)
}

/** What an author may do with an item now: the buttons My library shows. */
export function authorActions(item) {
  const status = item.status
  const review = item.reviewStatus
  return {
    submit: ['draft', 'changes_requested', 'rejected', 'unpublished'].includes(status) || (status === 'published' && (!review || review === 'changes_requested' || review === 'rejected')),
    withdraw: (status === 'submitted' && review === 'submitted') || (status === 'published' && (!review || ['submitted', 'changes_requested', 'rejected'].includes(review))),
    discard: status === 'draft',
    reply: status !== 'draft',
  }
}

/** "3 hours", "2 days": how long something has waited. */
export function waitedFor(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

const EVENT_WORDS = Object.freeze({
  created: 'started it',
  draft_saved: 'saved a draft',
  submitted: 'submitted it for review',
  withdrawn: 'withdrew it',
  review_opened: 'opened it for review',
  refine_proposed: 'asked for a refinement',
  refine_kept: 'kept a refinement',
  edited: 'edited its details',
  approved: 'approved and published it',
  changes_requested: 'asked for changes',
  rejected: 'did not accept it',
  unpublished: 'took it out of the library',
  comment: 'wrote',
  migrated: 'moved it into the library',
})

/** One line of the thread: who did what. */
export function eventLine(event) {
  const who = event.actor?.kind === 'ai' ? 'Slatebox AI' : event.actor?.name || 'Slatebox'
  const what = EVENT_WORDS[event.type] || event.type
  return `${who} ${what}${event.version ? ` (version ${event.version})` : ''}`
}

/** A diff's lines, for the review panel's cards and the thread: metadata from → to, rule lines, note counts. */
export function diffLines(diff = {}) {
  const lines = []
  for (const [field, [from, to]] of Object.entries(diff.meta || {})) {
    const show = (value) => (Array.isArray(value) ? value.join(', ') : field === 'category' && value ? CATEGORY_LABELS[value] || value : value ?? '—')
    lines.push(`${field.charAt(0).toUpperCase() + field.slice(1)}: ${show(from)} → ${show(to)}`)
  }
  for (const line of diff.rules || []) lines.push(line)
  if (diff.notes) lines.push(`Notes: ${diff.notes}`)
  return lines
}

/** The sentence under a publish dialog: what the author agrees to. */
export const PUBLISH_LINE = 'Once approved, anyone can find, copy and change it. Shared under CC BY 4.0.'

/** The publish dialog's starting fields for a slate or presentation. */
export function publishDefaults({ kind, name = '', description = '', libraryOrigin = null } = {}) {
  return {
    kind,
    title: String(name || '').slice(0, 80),
    summary: String(description || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    description: '',
    note: '',
    basedOn: libraryOrigin?.title || null,
  }
}

/** The submit input from the dialog's fields: empty optional fields left out. */
export function publishInput(fields, { shareId }) {
  return {
    kind: fields.kind, shareId,
    title: fields.title.trim(), summary: fields.summary.trim(),
    ...(fields.description.trim() && { description: fields.description.trim() }),
    ...(fields.note.trim() && { note: fields.note.trim() }),
  }
}

/**
 * The credit a slate made from the library carries (its libraryOrigin), as the licence asks: whose work it is
 * and where it came from. → { text, href } or null. A slate or presentation is a copy; a component is a board added
 * from the library.
 */
export function originCredit(origin) {
  if (!origin?.itemId || !origin.title) return null
  const by = origin.authorName ? ` by ${origin.authorName}` : ''
  const text = origin.kind === 'component' ? `${origin.title}${by}, from the library` : `Copy of ${origin.title}${by}`
  return { text, href: `/library/${encodeURIComponent(origin.itemId)}` }
}
