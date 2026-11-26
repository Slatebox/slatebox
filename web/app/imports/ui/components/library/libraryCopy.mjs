// The words the library's review queue, review panel, My library and the publish dialog say, from
// an item's status and its thread. Pure, so the tests read the same sentences the pages show.
import { CATEGORY_LABELS, INTEGRATION_AUTH_LABELS, INTEGRATION_CATEGORIES, INTEGRATION_CATEGORY_LABELS, KIND_LABELS, LIBRARY_CATEGORIES } from '../../../api/common/library-model.mjs'

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
  { id: 'integration', label: 'Integrations' },
])
/** The queue's kind chips: Integrations only where this server takes them (the queue says so; a locked install does not). */
export const kindFiltersFor = ({ integrations = false } = {}) => KIND_FILTERS.filter((entry) => entry.id !== 'integration' || integrations)
export const CATEGORY_CHIPS = Object.freeze(LIBRARY_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })))
// A suggested integration's categories: the agent gallery's chips.
export const INTEGRATION_CHIPS = Object.freeze(INTEGRATION_CATEGORIES.map((id) => ({ id, label: INTEGRATION_CATEGORY_LABELS[id] })))
export const categoryChipsFor = (kind) => (kind === 'integration' ? INTEGRATION_CHIPS : CATEGORY_CHIPS)

/**
 * What the reviewer's check of a suggested integration found, in lines a person reads (the review
 * panel and the tests): reachable or not, its sign-in, its tools, and what changed since it was suggested.
 */
export function probeLines(probe, { auth = 'none' } = {}) {
  if (!probe) return [{ tone: 'info', text: 'Not checked yet. Check it: Slatebox reaches the server now, signed out.' }]
  const lines = []
  // First, whatever else it found: a server that answers signed out is exactly how a path secret looks.
  if (probe.secretInPath)
    lines.push({ tone: 'error', text: `Its address seems to hold a private code in its path (${probe.secretInPath.why || 'a secret'}). Published, everyone who connected it would act as its author's account. It cannot be approved: turn it down, or ask for an address without it.` })
  if (!probe.reachable) {
    lines.push({ tone: 'error', text: `Not reachable${probe.host ? ` at ${probe.host}` : ''}${probe.problem ? `: ${probe.problem}` : '.'}` })
    return lines
  }
  lines.push({ tone: 'ok', text: `Reached ${probe.host}` })
  if (probe.lookalike) lines.push({ tone: 'warning', text: 'Its address looks like it stands for another site. Check the name before you approve.' })
  if (probe.signIn) {
    lines.push({ tone: 'info', text: `Sign-in needed${probe.signIn.authHost ? `: people sign in at ${probe.signIn.authHost}` : ''}${probe.signIn.issuer ? ` (${probe.signIn.issuer})` : ''}. Its tools show only after signing in.` })
    if (auth === 'none') lines.push({ tone: 'warning', text: 'The author said it needs no sign-in, but it asks for one.' })
  } else {
    const changes = (probe.tools || []).filter((tool) => tool.group === 'change')
    lines.push({ tone: 'ok', text: `No sign-in: ${probe.tools.length} ${probe.tools.length === 1 ? 'tool' : 'tools'}, ${changes.length} that change things elsewhere${changes.some((tool) => tool.destructive) ? ' (some delete, close or merge)' : ''}` })
    if (auth !== 'none') lines.push({ tone: 'info', text: `The author said: ${INTEGRATION_AUTH_LABELS[auth] || auth}. Signed out, it answered anyway.` })
  }
  const drift = probe.drift
  if (drift && !drift.same) {
    const parts = [drift.added?.length && `${drift.added.length} added`, drift.removed?.length && `${drift.removed.length} removed`, drift.changed?.length && `${drift.changed.length} changed`].filter(Boolean)
    lines.push({ tone: 'warning', text: `Its tools differ from when it was suggested: ${parts.join(', ')}.` })
  } else if (drift?.same) lines.push({ tone: 'ok', text: 'Its tools are the ones the author connected.' })
  return lines
}

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
