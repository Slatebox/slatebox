// Community slates, approved public templates and featured public presentations become library
// items (spec §5.4). What waits in the queue is marked migrationPristine until its owner sends it
// again: until then a reviewer may publish it only while its slate is still public (core.mjs). One-shot and idempotent: each item remembers what it came from (migratedFrom,
// also written as its `migrated` event), so a second run adds nothing. The source slates are not
// changed: a public slate stays link-public.
import { LIBRARY_LICENSE, LIBRARY_LIMITS, UNNAMED_AUTHOR, plainText, slugify } from '../../imports/api/common/library-model.mjs'
import { checkSize, contentHash, snapshotDeck, snapshotSlate } from './snapshot.mjs'
import { previewOf } from './core.mjs'

// Community slates were never reviewed: they go to the queue. One constant, in case the owner
// wants them published directly instead.
export const MIGRATE_COMMUNITY_STATUS = 'submitted'
const SYSTEM = { kind: 'system', userId: null, name: 'Slatebox' }
// Owners that are no account: the app's own seeds (server/bootstrap/proConTemplate.json is owned by
// 'system'). What they own is credited to Slatebox, with no author account.
const SEED_OWNERS = new Set(['system'])

// Approved public templates (template-policy.mjs publicTemplateSelector), stated here so the
// migration outlives the template code it replaces.
export const templateSelector = () => ({
  isThemeGenerator: { $ne: true }, 'options.isTemplate': true, 'options.templateApproved': true,
  'options.isPublic': true, 'options.isPrivate': { $ne: true }, 'options.isUnlisted': { $ne: true }, archivedDate: { $exists: false },
})
// Community slates (slateFilter.js 'community' without the per-person clause).
export const communitySelector = (masterUserId) => ({
  'options.isTemplate': { $exists: false }, 'options.isPublic': true, archivedDate: { $exists: false },
  ...(masterUserId && { userId: { $ne: masterUserId } }),
})
export const featuredSelector = () => ({ isPublished: true, isPublic: true, isFeatured: true })

const firstLine = (text) => plainText(String(text || '').replace(/[#*_`>[\]()!-]+/g, ' ')).slice(0, LIBRARY_LIMITS.summary)

/**
 * deps: slates, presentations, items, versions, events (collections), userName(userId) → string,
 * masterUserId, newId, now (ms). → { created: { published, submitted }, skipped, failed } counts
 * (dryRun reports what it would create and writes nothing).
 */
export async function migrateCommunity({ slates, presentations, items, versions, events, userName = async () => UNNAMED_AUTHOR, masterUserId = null, newId, now = Date.now, dryRun = false, today = null }) {
  const report = { created: { published: 0, submitted: 0 }, skipped: 0, failed: 0, items: [] }
  const at = () => new Date(now())
  const day = today || new Date(now()).toISOString().slice(0, 10)

  async function make({ key, kind, status, title, summary, authorId, authorName, content, message, sourceShareId, pristine = false }) {
    if (await items.findOne({ migratedFrom: key })) {
      report.skipped += 1
      return
    }
    let sizeBytes
    try {
      sizeBytes = checkSize(content)
    } catch {
      report.failed += 1
      return
    }
    const id = newId()
    const clean = plainText(title).slice(0, LIBRARY_LIMITS.title) || 'Untitled slate'
    const item = {
      _id: id, kind, origin: 'user', status, reviewStatus: status === 'published' ? null : status, slug: slugify(clean, id),
      title: clean, summary: firstLine(summary) || clean, categoryLocked: false, synonyms: [], authorId: authorId ?? null, authorName,
      provenance: {}, sourceShareId, versionCount: 1, counts: { copies: 0, adds: 0, branches: 0 }, popularity: 0, license: LIBRARY_LICENSE,
      preview: previewOf(content), migratedFrom: key, ...(pristine && { migrationPristine: true }), createdAt: at(), updatedAt: at(),
      ...(status === 'published' ? { publishedVersion: 1, publishedAt: at() } : { pendingVersion: 1, submittedAt: at() }),
    }
    report.items.push({ key, kind, status, title: clean })
    report.created[status === 'published' ? 'published' : 'submitted'] += 1
    if (dryRun) return
    await items.insertOne(item)
    await versions.insertOne({ _id: `${id}:1`, itemId: id, n: 1, source: 'migration', createdAt: at(), createdBy: null,
      meta: { title: item.title, summary: item.summary, synonyms: [] }, content, contentHash: contentHash(content), sizeBytes })
    await events.insertOne({ _id: newId(), itemId: id, at: at(), actor: SYSTEM, type: 'migrated', version: 1, message })
  }

  for (const slate of await slates.find(templateSelector()).toArray()) {
    const seeded = SEED_OWNERS.has(slate.userId)
    const authorName = seeded || slate.options?.userNameOverride === 'Slatebox' ? 'Slatebox' : await userName(slate.userId)
    await make({
      key: 'template:' + slate._id, kind: 'slate', status: 'published', title: slate.options?.name, sourceShareId: slate.shareId,
      summary: slate.options?.templateMarkdown || slate.options?.description, authorId: seeded ? null : slate.userId, authorName,
      content: { kind: 'slate', slate: snapshotSlate(slate) }, message: `Moved from the template gallery on ${day}.`,
    })
  }
  // A featured deck publishes what its player already showed everyone: the deck's own copy of the
  // slate (slateJSON: each note's place, words and look, nothing else), never the slate as it stands
  // now. A deck without that copy waits for review; a deleted slate's deck is left out.
  for (const deck of await presentations.find(featuredSelector()).toArray()) {
    const slate = await slates.findOne({ shareId: deck.slateShareId })
    if (!slate || slate.archivedDate) {
      if (!slate) report.failed += 1
      else report.skipped += 1
      continue
    }
    let played = null
    try { played = typeof deck.slateJSON === 'string' ? JSON.parse(deck.slateJSON) : null } catch { played = null }
    const status = played && Array.isArray(played.nodes) ? 'published' : MIGRATE_COMMUNITY_STATUS
    await make({
      key: 'presentation:' + deck._id, kind: 'presentation', status, title: deck.name || slate.options?.name, sourceShareId: slate.shareId,
      summary: deck.description || slate.options?.description, authorId: deck.userId ?? slate.userId, authorName: await userName(deck.userId ?? slate.userId),
      content: { kind: 'presentation', slate: snapshotSlate(status === 'published' ? played : slate), deck: snapshotDeck(deck) }, message: `Moved from featured presentations on ${day}.`,
      pristine: status !== 'published',
    })
  }
  for (const slate of await slates.find(communitySelector(masterUserId)).toArray()) {
    await make({
      key: 'community:' + slate._id, kind: 'slate', status: MIGRATE_COMMUNITY_STATUS, title: slate.options?.name, sourceShareId: slate.shareId,
      summary: slate.options?.description, authorId: slate.userId, authorName: await userName(slate.userId),
      content: { kind: 'slate', slate: snapshotSlate(slate) }, message: `Moved from Community slates on ${day}.`, pristine: true,
    })
  }
  return report
}
