// The six presentations Slatebox built for the marketing site's Presentations page, as library items: origin
// builtin, author Slatebox, always published, kind presentation. The slate IS the presentation: each publishes its
// slate wearing its style (presentationBake.wearStyle: the style's background, its notes' outlines, fills and fonts,
// and the style's title cards, numbers, quotes, captions and art as real notes), and its deck as the app's Present
// saves a worn style's: the art direction checked against the slate and the camera steps over the styled slate
// (deck version 5). So "Make it yours" (library.fork) opens a copy that looks like the site's poster on the canvas
// itself, and Present in the copy plays the same deck, drawing nothing the slate does not hold.
//
// Run at startup, beside the built-in components (builtins.mjs); idempotent: a version is added only when an item's
// content changed (contentHash), so a new composer that composes the steps differently publishes a new version. A
// presentation gone from the list is unpublished, never deleted. The content is shipped with the app
// (showcase/presentations.mjs, written by the site's scripts/make-present-decks.mjs); no account owns it.
import { BUILTIN_AUTHOR, LIBRARY_LICENSE } from '../../imports/api/common/library-model.mjs'
import { cleanStyleRef } from '../../imports/ui/components/presentations/presentationStyles.mjs'
import { wearStyle } from '../../imports/ui/components/presentations/presentationBake.mjs'
import { storedSlateLayout } from '../methods/presentationLayout.mjs'
import { sanitizeLayout } from '../methods/presentationRequest.mjs'
import { playerSlateCopy } from '../methods/presentationDeck.mjs'
import { checkSize, contentHash, contentSize } from './snapshot.mjs'
import { previewOf } from './core.mjs'
import { showcasePresentations } from './showcase/presentations.mjs'

const SYSTEM = { kind: 'system', userId: null, name: 'Slatebox' }
export const SHOWCASE_PREFIX = 'builtin-presentation-'

/**
 * A showcase entry's library content: { kind: 'presentation', slate, deck }. The slate wears the entry's style (the
 * app's own code, presentationBake), and the deck plays it (deck.deck, version 5).
 */
export function showcaseContent(entry) {
  const plain = structuredClone(entry.slate)
  plain.options = { ...(plain.options || {}), name: entry.title }
  const { layout } = sanitizeLayout(storedSlateLayout(plain))
  if (!layout) throw new Error(`showcase ${entry.slug}: the slate has no notes to present`)
  const style = cleanStyleRef(entry.look?.style)
  const worn = wearStyle(plain, style, { direction: entry.look?.direction, name: entry.title })
  const slate = worn.slate
  // A library copy's original is the slate as copied (styled), never the seed before it was styled.
  delete slate.options.styleOriginal
  const deck = {
    name: entry.title,
    description: entry.summary,
    showNarrative: false,
    viewpoints: worn.deck.steps,
    direction: worn.direction,
    style,
    deck: worn.deck,
    presentationData: sanitizeLayout(storedSlateLayout(slate)).layout,
    slateJSON: playerSlateCopy(slate),
  }
  return { kind: 'presentation', slate, deck }
}

/**
 * Seed or refresh the showcase presentations. → { created, updated, unchanged, unpublished, skipped } (ids).
 * deps: items, versions, events (collections), newId, now (ms), presentations (defaults to the bundled six).
 */
export async function seedShowcase({ items, versions, events, newId, now = Date.now, presentations = showcasePresentations }) {
  const report = { created: [], updated: [], unchanged: [], unpublished: [], skipped: [] }
  const at = () => new Date(now())
  const ids = new Set()
  for (const [index, entry] of presentations.entries()) {
    const _id = SHOWCASE_PREFIX + entry.slug
    ids.add(_id)
    const content = showcaseContent(entry)
    const sizeBytes = checkSize(content)
    const hash = contentHash(content)
    const meta = { title: entry.title, summary: entry.summary, synonyms: [] }
    const fields = {
      kind: 'presentation', origin: 'builtin', slug: entry.slug, title: entry.title, summary: entry.summary, synonyms: [],
      categoryLocked: false, authorId: null, authorName: BUILTIN_AUTHOR, status: 'published', reviewStatus: null,
      license: LIBRARY_LICENSE, catalogOrder: index, preview: previewOf(content),
    }
    const existing = await items.findOne({ _id })
    // A slug is unique: one another item already holds is left to it (people's slugs end in an id, so it never should).
    const holder = await items.findOne({ slug: entry.slug })
    if (holder && holder._id !== _id) {
      report.skipped.push(_id)
      continue
    }
    if (!existing) {
      // The first of the list is the newest, so "New" lists them in the site's order.
      const publishedAt = new Date(now() - index * 1000)
      await items.insertOne({
        _id, ...fields, provenance: {}, versionCount: 1, publishedVersion: 1, publishedAt, counts: { copies: 0, adds: 0, branches: 0 },
        popularity: 0, createdAt: at(), updatedAt: at(),
      })
      await versions.insertOne({ _id: `${_id}:1`, itemId: _id, n: 1, source: 'builtin', createdAt: at(), createdBy: null, meta, content, contentHash: hash, sizeBytes })
      await events.insertOne({ _id: newId(), itemId: _id, at: at(), actor: SYSTEM, type: 'created', version: 1 })
      report.created.push(_id)
      continue
    }
    const current = existing.publishedVersion ? await versions.findOne({ itemId: _id, n: existing.publishedVersion }) : null
    const metaChanged = ['title', 'summary', 'slug'].some((field) => existing[field] !== fields[field])
    if (current?.contentHash === hash && existing.status === 'published' && !metaChanged) {
      report.unchanged.push(_id)
      continue
    }
    const set = { ...fields, updatedAt: at() }
    if (current?.contentHash !== hash) {
      const n = (existing.versionCount || 0) + 1
      await versions.insertOne({ _id: `${_id}:${n}`, itemId: _id, n, source: 'builtin', createdAt: at(), createdBy: null, meta, content, contentHash: hash, sizeBytes: contentSize(content) })
      Object.assign(set, { versionCount: n, publishedVersion: n, publishedAt: existing.publishedAt ?? at() })
      await events.insertOne({ _id: newId(), itemId: _id, at: at(), actor: SYSTEM, type: 'approved', version: n, message: 'Updated with Slatebox.' })
    }
    await items.updateOne({ _id }, { $set: set })
    report.updated.push(_id)
  }
  // Presentations the list no longer has: unpublished, with an event (copies stay with their owners).
  const stale = await items.find({ origin: 'builtin', kind: 'presentation', status: 'published' }).toArray()
  for (const item of stale) {
    if (ids.has(item._id)) continue
    await items.updateOne({ _id: item._id }, { $set: { status: 'unpublished', updatedAt: at() } })
    await events.insertOne({ _id: newId(), itemId: item._id, at: at(), actor: SYSTEM, type: 'unpublished', message: 'No longer part of Slatebox.' })
    report.unpublished.push(item._id)
  }
  return report
}
