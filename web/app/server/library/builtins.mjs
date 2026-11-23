// The engine catalogue's entries as library items (origin builtin, author Slatebox, always
// published), so built-in and community components share one listing, count, gallery and branch
// path. Run at startup; idempotent: a version is added only when an entry's board changed
// (contentHash), and an entry gone from the catalogue is unpublished, never deleted.
import { catalog as engineCatalog } from 'slateboxjs/catalog'
// The business boards' rules and samples join the engine's tables as they load.
import 'slateboxjs/workshops/rules'
import { catalogSamples } from 'slateboxjs/workshops/samples'
import { BUILTIN_AUTHOR, LIBRARY_LICENSE } from '../../imports/api/common/library-model.mjs'
import { catalogSample } from '../../imports/api/common/library.mjs'
import { contentHash, contentSize } from './snapshot.mjs'
import { previewOf } from './core.mjs'

const SYSTEM = { kind: 'system', userId: null, name: 'Slatebox' }

/** The board a built-in item publishes: the entry's preset with its example cards (the listing gate's sample). */
export function builtinContent(entry, samples = catalogSamples) {
  return { kind: 'component', workshop: catalogSample(entry.id, samples) }
}

/**
 * Seed or refresh the built-in items. → { created, updated, unchanged, unpublished } (ids).
 * deps: items, versions, events (collections), samples, now (ms), newId, catalog (defaults to the engine's).
 */
export async function seedBuiltins({ items, versions, events, samples = catalogSamples, now = Date.now, newId, catalog = engineCatalog }) {
  const report = { created: [], updated: [], unchanged: [], unpublished: [] }
  const at = () => new Date(now())
  const ids = new Set()
  for (const [index, entry] of catalog.entries()) {
    const _id = 'builtin-' + entry.id
    ids.add(_id)
    const content = builtinContent(entry, samples)
    const hash = contentHash(content)
    const meta = { title: entry.name, summary: entry.line, category: entry.group, synonyms: [...(entry.synonyms || [])].slice(0, 12) }
    const existing = await items.findOne({ _id })
    const fields = {
      kind: 'component', origin: 'builtin', builtinId: entry.id, slug: entry.id, ...meta, categoryLocked: true,
      authorId: null, authorName: BUILTIN_AUTHOR, status: 'published', reviewStatus: null, license: LIBRARY_LICENSE,
      // Catalogue order: the first entry is the newest, so "New" lists built-ins in the order the panel does.
      catalogOrder: index, preview: previewOf(content),
    }
    if (!existing) {
      const publishedAt = new Date(now() - index * 1000)
      await items.insertOne({
        _id, ...fields, provenance: {}, versionCount: 1, publishedVersion: 1, publishedAt, counts: { copies: 0, adds: 0, branches: 0 },
        popularity: 0, createdAt: at(), updatedAt: at(),
      })
      await versions.insertOne({ _id: `${_id}:1`, itemId: _id, n: 1, source: 'builtin', createdAt: at(), createdBy: null, meta, content, contentHash: hash, sizeBytes: contentSize(content) })
      await events.insertOne({ _id: newId(), itemId: _id, at: at(), actor: SYSTEM, type: 'created', version: 1 })
      report.created.push(_id)
      continue
    }
    const current = existing.publishedVersion ? await versions.findOne({ itemId: _id, n: existing.publishedVersion }) : null
    const metaChanged = ['title', 'summary', 'category'].some((field) => existing[field] !== meta[field]) ||
      JSON.stringify(existing.synonyms || []) !== JSON.stringify(meta.synonyms)
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
  // Entries the catalogue no longer has: unpublished, with an event (forks and copies stay with their owners).
  const stale = await items.find({ origin: 'builtin', status: 'published' }).toArray()
  for (const item of stale) {
    if (ids.has(item._id)) continue
    await items.updateOne({ _id: item._id }, { $set: { status: 'unpublished', updatedAt: at() } })
    await events.insertOne({ _id: newId(), itemId: item._id, at: at(), actor: SYSTEM, type: 'unpublished', message: 'No longer part of Slatebox.' })
    report.unpublished.push(item._id)
  }
  return report
}
