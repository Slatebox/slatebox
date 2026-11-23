// The library gallery's words and URL state (library spec §7.1), pure so node tests read them: the kind tabs and
// category chips, the count line, a card's author, provenance and use lines, the license line, the query string the
// list keeps its filters in, and the ?copy=1 deep link from slatebox.com, which runs once.
import { CATEGORY_LABELS, LIBRARY_CATEGORIES, LIBRARY_KINDS } from '../../../../api/common/library-model.mjs'

export const KIND_TABS = Object.freeze([
  { id: null, label: 'All' },
  { id: 'component', label: 'Smart components' },
  { id: 'slate', label: 'Slates' },
  { id: 'presentation', label: 'Presentations' },
])
export const CATEGORY_CHIPS = Object.freeze([{ id: null, label: 'All' }, ...LIBRARY_CATEGORIES.map(id => ({ id, label: CATEGORY_LABELS[id] }))])
export const SORTS = Object.freeze([{ id: 'new', label: 'New' }, { id: 'popular', label: 'Most used' }])
export const KIND_NAMES = Object.freeze({ component: 'Smart component', slate: 'Slate', presentation: 'Presentation' })

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
const times = n => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

/** "19 smart components, 2 slates, 1 presentation": what the library holds (library.stats). */
export function countLine(stats) {
  if (!stats) return ''
  return [plural(stats.components?.total ?? 0, 'smart component'), plural(stats.slates ?? 0, 'slate'), plural(stats.presentations ?? 0, 'presentation')].join(', ')
}

/** Who made it: "Built by Slatebox" for a built-in, otherwise "By <name>". */
export const authorLine = item => (item?.origin === 'builtin' ? 'Built by Slatebox' : `By ${item?.authorName || 'A Slatebox user'}`)

/** Where it came from: a component branched off another, or a slate or presentation published from a copy of one. */
export function provenanceLine(item) {
  const { branchedFrom, forkedFrom } = item?.provenance ?? {}
  if (branchedFrom?.itemId) return { text: 'Branched from', title: branchedFrom.title || 'another component', itemId: branchedFrom.itemId }
  if (forkedFrom?.itemId) return { text: 'Forked from', title: forkedFrom.title || 'another item', itemId: forkedFrom.itemId }
  return null
}

/** How much it has been used: "Added to slates 3 times · branched once" for a component; "Copied twice" otherwise. */
export function usesLine(item) {
  const counts = item?.counts ?? {}
  if (item?.kind === 'component') {
    const parts = []
    if (counts.adds) parts.push(`Added to slates ${times(counts.adds)}`)
    if (counts.branches) parts.push(`${parts.length ? 'branched' : 'Branched'} ${times(counts.branches)}`)
    return parts.join(' · ')
  }
  return counts.copies ? `Copied ${times(counts.copies)}` : ''
}

/** The license line under an item: free to use, change and share, crediting its author. */
export function licenseLine(item) {
  const who = item?.origin === 'builtin' ? 'Slatebox' : item?.authorName || 'its author'
  return `Free to use, change and share under CC BY 4.0, crediting ${who}.`
}

/** "Version 2 · published 23 Nov 2026". */
export function versionLine(item, version) {
  const n = version?.n ?? item?.publishedVersion
  const date = item?.publishedAt ? new Date(item.publishedAt) : null
  const when = date && !Number.isNaN(date.valueOf()) ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null
  return [n ? `Version ${n}` : null, when ? `published ${when}` : null].filter(Boolean).join(' · ')
}

/** What a card's picture shows in words, for a screen reader and while it draws. */
export function previewLabel(item) {
  const p = item?.preview ?? {}
  const what = item?.kind === 'component' ? 'board' : item?.kind === 'presentation' ? 'presentation' : 'slate'
  return `A picture of the ${what} ${item?.title ?? ''}${p.notes ? `, ${plural(p.notes, item?.kind === 'component' ? 'card' : 'note')}` : ''}`.trim()
}

/** The list's filters as the URL keeps them (?kind=component&category=plan&q=retro&sort=popular). Unknown values are dropped. */
export function readGalleryQuery(search = '') {
  const params = new URLSearchParams(search)
  const kind = LIBRARY_KINDS.includes(params.get('kind')) ? params.get('kind') : null
  const category = LIBRARY_CATEGORIES.includes(params.get('category')) ? params.get('category') : null
  const sort = params.get('sort') === 'popular' ? 'popular' : 'new'
  const q = (params.get('q') ?? '').slice(0, 100)
  return { kind, category, sort, q }
}

/** The query string for a set of filters (the defaults left out). */
export function galleryQuery({ kind, category, sort, q } = {}) {
  const params = new URLSearchParams()
  if (kind) params.set('kind', kind)
  if (category) params.set('category', category)
  if (q?.trim()) params.set('q', q.trim())
  if (sort === 'popular') params.set('sort', 'popular')
  const out = params.toString()
  return out ? '?' + out : ''
}

/** library.list's input for a set of filters. */
export function listInput({ kind, category, sort, q } = {}, cursor) {
  return { ...(kind && { kind }), ...(category && { category }), ...(q?.trim() && { q: q.trim() }), sort: sort === 'popular' ? 'popular' : 'new', limit: 24, ...(cursor && { cursor }) }
}

/**
 * The deep link from slatebox.com (/library/<slug>?copy=1) asks for "Open a copy" (a component: on a new slate) once.
 * → { copy, rest }: whether to run it, and the query string to put back without it, so a reload or Back never copies
 * again.
 */
export function readCopyRequest(search = '') {
  const params = new URLSearchParams(search)
  const copy = params.get('copy') === '1'
  params.delete('copy')
  const rest = params.toString()
  return { copy, rest: rest ? '?' + rest : '' }
}

/** The words an item's main button says. */
export const actionLabel = kind => (kind === 'component' ? 'Add to a slate' : 'Open a copy')

/** A refusal from library.fork, in words a person can act on. */
export function forkErrorText(error) {
  const code = error?.error ?? error?.code
  if (code === 'component_opens_new_slate') return error.reason || 'That slate can’t take another board. Add it on a new slate instead.'
  if (code === 'not_found') return 'This item is no longer in the library.'
  if (code === 'forbidden') return 'You can view that slate but not add to it. Pick another, or a new slate.'
  return error?.reason || error?.message || 'That didn’t work. Try again in a moment.'
}
