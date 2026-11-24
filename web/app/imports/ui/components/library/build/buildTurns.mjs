// Building a smart component (library spec §4): the words and choices of a builder slate, pure so the
// server's tests read the same ones the page shows. A builder slate is an ordinary slate whose server-only
// `library` field says it is building one ({mode:'build', itemId?, boardId?, parent?}); the component is a
// real board on it, grown by the same chat (preview, then Keep) and the board's own rule controls.
import { CATEGORY_LABELS, CREDIT_HELP, CREDIT_QUESTION, LIBRARY_CATEGORIES, LIBRARY_LICENSE_LINE, LIBRARY_LIMITS, categoryLabel, readCreditName } from '../../../../api/common/library-model.mjs'

export { CATEGORY_LABELS, CREDIT_HELP, CREDIT_QUESTION, LIBRARY_CATEGORIES, LIBRARY_LICENSE_LINE, categoryLabel }

/**
 * The link that opens a builder: `/new#build` (from scratch) or `/new#build=<itemId>` (a copy of a component
 * to change). `{ itemId: 'new' }` or `{ itemId }`, or null for any other hash. An item id is an id or a slug.
 */
export function readBuildHash(hash) {
  const text = String(hash ?? '').replace(/^#/, '')
  if (text === 'build' || text === 'build=' || text === 'build=new') return { itemId: 'new' }
  const match = /^build=([A-Za-z0-9][A-Za-z0-9_:-]{0,99})$/.exec(text)
  return match ? { itemId: decodeURIComponent(match[1]) } : null
}

/** The link to branch off a component (an item id or slug), or to start from scratch. */
export const buildLink = (itemId = null) => (itemId && itemId !== 'new' ? '/new#build=' + encodeURIComponent(itemId) : '/new#build')

/**
 * The shapes a component can start from (§4.2): each a plain chat message, previewed and kept like any
 * other. Each is read on this slate without AI, so it works on any install: a board of columns from its
 * names, and the other shapes from the catalogue board of that shape, which the chat then reshapes.
 */
export const BUILD_SHAPES = Object.freeze([
  { id: 'columns', label: 'Columns', message: 'Make a workshop with To do, Doing and Done', kind: 'lanes', makes: 'lanes' },
  { id: 'piles', label: 'Lists in lists', message: 'Add a board to sort the evidence', kind: 'component', makes: 'nest', layout: 'clusters' },
  { id: 'tree', label: 'A tree', message: 'Add a board to break down a problem', kind: 'component', makes: 'nest', layout: 'tree' },
  { id: 'timeline', label: 'A timeline', message: 'Add a launch plan', kind: 'component', makes: 'launch-plan' },
])
// A 2 by 2 is not offered as a start until its square has controls of its own (a corner's "holds N" badge to drag):
// its board's rule controls today are about children, which mean nothing on a square. It can still be branched off.

/** The builder's first turn: from scratch, what to make; on a branch, whose copy this is. */
export function buildFirstTurn(library) {
  const parent = library?.parent
  if (parent?.title) {
    return {
      kind: 'branch',
      title: 'This is your copy of ' + parent.title + '.',
      line: 'Change anything: say it, or drag the controls on the board.',
      shapes: [],
    }
  }
  return {
    kind: 'scratch',
    title: 'What should this board do?',
    line: 'Pick a shape to start from, or describe it. Every change shows first, and you keep what you like.',
    shapes: BUILD_SHAPES,
  }
}

/** The build bar's words: what is being built, and where it came from. */
export function buildBarWords({ library, title, status } = {}) {
  const parent = library?.parent
  const category = parent?.category ? categoryLabel(parent.category) : null
  return {
    heading: 'Building a smart component',
    title: String(title || '').trim() || 'Untitled',
    from: parent?.title ? 'Branched from ' + parent.title + (category ? ' (' + category + ')' : '') : null,
    category: category ? category + ' (from ' + parent.title + ')' : null,
    state: statusWords(status),
  }
}

/** What the build bar says of the item once it is saved or sent. */
export function statusWords(status) {
  switch (status) {
    case 'draft': return 'Saved to your library'
    case 'submitted': return 'Submitted for review'
    case 'in_review': return 'Being reviewed'
    case 'changes_requested': return 'Changes asked for'
    case 'published': return 'Published'
    case 'rejected': return 'Not accepted'
    case 'unpublished': return 'Unpublished'
    default: return null
  }
}

/**
 * The status in the header's short words, when the header is short of room: always the start of statusWords (the rest
 * is still read out), so it never says something else. "Saved to your library" is "Saved", "Submitted for review" is
 * "Submitted"; the others are short already.
 */
export function statusShort(status) {
  const words = statusWords(status)
  if (status === 'draft') return 'Saved'
  if (status === 'submitted') return 'Submitted'
  return words
}

/** The saved toast (§4.2). */
export const SAVED_SENTENCE = 'Saved. It’s in your library: add it to any slate from Add to this slate › Yours.'
export const SUBMITTED_SENTENCE = 'Submitted for review. You’ll hear back in My library.'

/** Words people might search for, typed with commas: at most 12, each at most 40 characters, no repeats. */
export function readSynonyms(text) {
  const seen = new Set()
  const out = []
  for (const part of String(text ?? '').split(/[,\n]/)) {
    const word = part.replace(/\s+/g, ' ').trim().slice(0, LIBRARY_LIMITS.synonym)
    if (!word || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    out.push(word)
    if (out.length >= LIBRARY_LIMITS.synonyms) break
  }
  return out
}

/**
 * The save sheet's fields as the server takes them, or the first thing to fix (`problem`, `field`). A branch's
 * category is its parent's (locked): it is never sent as a choice, so the server fills it in. Submitting with no
 * name on the account (`askName`) asks how to credit them: `credit` is that name, saved to their profile first.
 */
export function readSaveSheet({ title, summary, category, synonyms, note, credit } = {}, { locked = null, submitting = false, askName = false } = {}) {
  const name = String(title ?? '').replace(/\s+/g, ' ').trim()
  const line = String(summary ?? '').replace(/\s+/g, ' ').trim()
  if (!name) return { problem: 'Give it a name.', field: 'title' }
  if (name.length > LIBRARY_LIMITS.title) return { problem: `A name has up to ${LIBRARY_LIMITS.title} characters.`, field: 'title' }
  if (!line) return { problem: 'Say in one line what it does.', field: 'summary' }
  if (line.length > LIBRARY_LIMITS.summary) return { problem: `One line has up to ${LIBRARY_LIMITS.summary} characters.`, field: 'summary' }
  const chosen = locked ?? category ?? null
  if (chosen && !LIBRARY_CATEGORIES.includes(chosen)) return { problem: 'Pick one of the categories.', field: 'category' }
  if (submitting && !chosen) return { problem: 'Pick a category, so people can find it.', field: 'category' }
  const credited = submitting && askName ? readCreditName(credit) : null
  if (credited?.problem) return { problem: credited.problem, field: 'credit' }
  const words = readSynonyms(synonyms)
  const message = String(note ?? '').trim().slice(0, LIBRARY_LIMITS.message)
  return {
    input: { title: name, summary: line, ...(!locked && chosen && { category: chosen }), ...(words.length && { synonyms: words }) },
    ...(message && { note: message }),
    ...(credited && { credit: credited.name }),
  }
}

/** A board's name, as the save sheet starts from it. */
export const boardName = (workshop) => String(workshop?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, LIBRARY_LIMITS.title)
