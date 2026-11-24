// The shared library's core: every library.* action's work, with its permission checks, over
// injected stores (MongoDB driver collections in the app, in-memory ones in the tests). No Meteor.
//
// deps:
//   items, versions, events    the libraryItems, libraryVersions and libraryEvents collections
//   slates                     the slates collection (read, and the server-only library fields)
//   saveCore                   slate-save-core (create and save: every slate write goes through it)
//   isLibraryReviewer(userId)  → boolean: a server administrator (the uberMensch claim)
//   loadUser(userId)           → { _id, orgId, isAnonymous, name } | null
//   isTeamAdmin(userId, orgId) → boolean
//   resolveSlateForUser(shareId, userId) → { slate, canRead, canEdit } | null (the canvas's own rule)
//   latestPresentation(shareId, userId), publishedPresentation(shareId) → a SlatePresentations row | null
//   copyPresentation(deck, { shareId, sourceShareId, user, now })  a private presentation of a new slate
//   applyWorkshopOperations    the workshop_edits core (slates.applyOperations), for refinements
//   refineWithAI               refine-ai.mjs
//   notify({ item, type, message })  tells the author (in-app message, email); optional
//   listingGate(workshop)      → the first phrase that does not parse on the board, or null; optional
//   generateShareId(), newId(), now() (ms), appOrigin(), samples (slateboxjs/workshops/samples catalogSamples)
import {
  BUILTIN_AUTHOR, KIND_LABELS, LIBRARY_CATEGORIES, LIBRARY_KINDS, LIBRARY_LICENSE, LIBRARY_LIMITS, QUEUE_STATUSES, QUEUE_WAITING,
  UNNAMED_AUTHOR, canReadItem, categoryLabel, categoryLockSentence, libraryError, readMessage, readMeta, reviewStateOf, slugify, transition,
} from '../../imports/api/common/library-model.mjs'
import { checkSize, contentHash, snapshotDeck, snapshotSlate, snapshotWorkshop } from './snapshot.mjs'
import { checkProposal, localRefinement } from './refine.mjs'
import { personalDataChecks } from './refine-ai.mjs'
import { countUse, spendAllowance } from './uses.mjs'
import { copyDocument } from '../actions/slate-copy.mjs'
import { privateSlateDocument } from '../private-slate-document.mjs'
import { componentPlacing, componentSet } from '../../imports/api/common/component-add.mjs'
import { MAIN_BOARD, MAX_BOARDS, slateBoards } from '../../imports/api/common/slate-boards.mjs'
import { sharedSaveConditions } from '../methods/native-slate-save.mjs'
import { applyWorkshopEdits, validateWorkshop, rulebook } from 'slateboxjs/workshops/model'
import 'slateboxjs/workshops/behaviour'

// Events only reviewers read: the refine chat's turns. The kept result reaches the author as refine_kept (its diff, no chat).
const REVIEWER_ONLY_EVENTS = new Set(['refine_proposed'])
// A refine preview waits to be kept for half an hour; an item keeps its last few.
const REFINE_PREVIEW_MS = 30 * 60 * 1000
const REFINE_PREVIEWS = 8
const REVIEWER_ONLY_MESSAGES = new Set(['refine_proposed', 'refine_kept'])
const fail = libraryError
// What a person is told when they open their own submission: plain words, never the API's parameter name.
export const SELF_REVIEW_SENTENCE = 'You sent this one. Ask another administrator to review it, or review it yourself if you are the only one.'
const notFound = () => fail(404, 'not_found', 'There is no such item in the library.')
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const readCursor = (cursor) => {
  if (cursor === undefined || cursor === null || cursor === '') return 0
  const n = Number.parseInt(String(cursor), 10)
  if (!Number.isSafeInteger(n) || n < 0 || String(n) !== String(cursor)) throw fail(400, 'invalid_request', 'cursor is the next value a listing gave.', { field: 'cursor' })
  return n
}
// How many times an item has been published (approvals; a migrated or built-in item counts its one).
const publishedCountOf = (item) => item?.publishedCount ?? (item?.publishedVersion ? 1 : 0)
const boardKindOf = (workshop) => workshop?.kind ?? (workshop?.lanes?.[0]?.station ? 'map' : 'lanes')
const builtinRefusal = () => fail(409, 'builtin', 'This is part of Slatebox and can’t be changed here. Branch off it to make your own.')

/** What a list card shows of an item's content: its kind, its board's kind and how many notes or cards. */
export function previewOf(content) {
  if (!content) return { kind: 'component', notes: 0 }
  if (content.kind === 'component') return { kind: 'component', boardKind: boardKindOf(content.workshop), notes: content.workshop?.cards?.length ?? 0 }
  const board = slateBoards(content.slate)[0]
  return { kind: content.kind, ...(board && { boardKind: boardKindOf(board.model.workshop) }), notes: content.slate?.nodes?.length ?? 0 }
}

// What a version's metadata records (and an approve's diff compares).
const metaOf = (item) => ({
  title: item.title, summary: item.summary,
  ...(item.description && { description: item.description }),
  ...(item.category && { category: item.category }),
  synonyms: item.synonyms || [],
})

// An update to a published item keeps its proposed details beside the live ones (pendingMeta) until
// it is approved: the public keeps seeing what was published. The author and reviewers see both.
const withPending = (item) => (item?.pendingMeta ? { ...item, ...item.pendingMeta } : item)
const pendingSet = (item, meta) => (item.pendingMeta ? Object.fromEntries(Object.entries(meta).map(([field, value]) => ['pendingMeta.' + field, value])) : meta)

function metaDiff(before = {}, after = {}) {
  const out = {}
  for (const field of ['title', 'summary', 'description', 'category', 'synonyms']) {
    if (JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)) out[field] = [before[field] ?? null, after[field] ?? null]
  }
  return out
}

// What changed between two versions' content: rule lines for a board, note counts for a slate.
function contentDiff(before, after) {
  if (!before || !after) return {}
  if (after.kind === 'component') {
    try {
      const lines = rulebook().diff(validateWorkshop(before.workshop), validateWorkshop(after.workshop)).lines
      return lines.length ? { rules: lines } : {}
    } catch { return {} }
  }
  const ids = (content) => new Map((content.slate?.nodes || []).map((node) => [node?.options?.id, JSON.stringify(node)]))
  const from = ids(before), to = ids(after)
  let added = 0, removed = 0, changed = 0
  for (const [id, body] of to) if (!from.has(id)) added += 1; else if (from.get(id) !== body) changed += 1
  for (const id of from.keys()) if (!to.has(id)) removed += 1
  return added || removed || changed ? { notes: `${added} added, ${removed} removed, ${changed} changed` } : {}
}

export function createLibraryCore(deps) {
  const {
    items, versions, events, counters = null, slates, saveCore, isLibraryReviewer, loadUser,
    isTeamAdmin = async () => false, resolveSlateForUser, latestPresentation = async () => null, publishedPresentation = async () => null,
    copyPresentation = async () => {}, applyWorkshopOperations = null, refineWithAI = async () => ({ reply: '' }), notify = async () => {},
    listingGate = null, generateShareId, newId, now = Date.now, appOrigin = () => '', samples = {},
    countReviewers = async () => Number.POSITIVE_INFINITY,
    // Whether people on a slate paused its agents (agents.control): an agent's call that changes that slate is refused,
    // as its slates.applyOperations is (423 agents_paused).
    agentsPaused = async () => false,
  } = deps
  const at = () => new Date(now())

  const isReviewer = async (userId) => Boolean(userId && (await isLibraryReviewer(userId)))
  async function agentsGate(principal, slate) {
    if (principal?.kind === 'agent' && slate?._id && (await agentsPaused(slate._id)))
      throw fail(423, 'agents_paused', 'People on this slate paused its agents. Ask one of them to resume agents, then retry.')
  }
  async function requireReviewer(principal) {
    if (!(await isReviewer(principal?.userId))) throw fail(403, 'reviewer_required', 'Only an administrator of this server reviews library submissions.')
  }
  async function findItem(ref) {
    if (typeof ref !== 'string' || !ref) return null
    return (await items.findOne({ _id: ref })) || (await items.findOne({ slug: ref.toLowerCase() }))
  }
  async function readableItem(principal, ref) {
    const item = await findItem(ref)
    const reviewer = await isReviewer(principal?.userId)
    if (!canReadItem(item, { userId: principal?.userId, reviewer })) throw notFound()
    return { item, reviewer, privileged: reviewer || Boolean(principal?.userId && item.authorId === principal.userId) }
  }
  async function authoredItem(principal, ref) {
    const item = await findItem(ref)
    if (!item) throw notFound()
    if (item.origin === 'builtin') throw builtinRefusal()
    if (!principal?.userId || item.authorId !== principal.userId) {
      if (canReadItem(item, { userId: principal?.userId })) throw fail(403, 'author_required', 'Only its author can do this.')
      throw notFound()
    }
    return item
  }
  async function displayName(userId) {
    const user = userId ? await loadUser(userId) : null
    const name = typeof user?.name === 'string' ? user.name.trim().slice(0, 80) : ''
    return name || UNNAMED_AUTHOR
  }
  async function log(item, type, actor, extra = {}) {
    const row = { _id: newId(), itemId: item._id, at: at(), actor, type, ...extra }
    await events.insertOne(row)
    return row
  }
  const authorActor = async (principal) => ({ kind: 'author', userId: principal.userId, name: await displayName(principal.userId) })
  const reviewerActor = async (principal) => ({ kind: 'reviewer', userId: principal.userId, name: await displayName(principal.userId) })
  const lastMessage = (by, text) => (text ? { lastMessage: { at: at(), by, text: text.slice(0, 300) } } : {})

  async function versionOf(item, n) {
    return n ? versions.findOne({ itemId: item._id, n }) : null
  }
  // The version a caller sees: the public see the published one; the author and reviewers may name any,
  // and by default see the one waiting for review (or the author's draft when nothing was submitted).
  async function visibleVersion(item, privileged, n) {
    if (n !== undefined && n !== null) {
      if (!privileged && n !== item.publishedVersion) throw notFound()
      const found = await versionOf(item, n)
      if (!found) throw fail(404, 'not_found', 'There is no such version.')
      return found
    }
    const chosen = privileged ? item.pendingVersion ?? item.publishedVersion : item.publishedVersion
    if (chosen) return versionOf(item, chosen)
    if (privileged && item.draft) return { n: 0, meta: metaOf(item), content: item.draft, source: 'draft' }
    throw fail(404, 'not_found', 'This item has no version yet.')
  }

  async function writeVersion(item, { source, content, createdBy, meta }) {
    const sizeBytes = checkSize(content)
    const n = (item.versionCount || 0) + 1
    const row = { _id: `${item._id}:${n}`, itemId: item._id, n, source, createdAt: at(), createdBy: createdBy ?? null, meta, content, contentHash: contentHash(content), sizeBytes }
    await versions.insertOne(row)
    return row
  }

  // Approving publishes the version its author sent, as the reviewer left it on the review copy: the
  // reviewed content and details go into that same version, so a review never adds a number of its own
  // (the version people see is the stored publishedVersion, and a branch's provenance names the same).
  // What the author sent first is kept beside it (submitted), once.
  async function publishReviewed(row, { content, meta, reviewedBy }) {
    const sizeBytes = checkSize(content)
    const hash = contentHash(content)
    const changed = row.contentHash !== hash || JSON.stringify(row.meta ?? null) !== JSON.stringify(meta)
    const submitted = !row.submitted && changed
      ? { submitted: { content: row.content, meta: row.meta, contentHash: row.contentHash, sizeBytes: row.sizeBytes, createdBy: row.createdBy ?? null } }
      : {}
    const set = { content, meta, contentHash: hash, sizeBytes, reviewedAt: at(), reviewedBy, ...submitted }
    await versions.updateOne({ _id: row._id }, { $set: set })
    return { ...row, ...set }
  }

  // ---------- shapes ----------
  const url = (item) => `${appOrigin().replace(/\/$/, '')}/library/${item.slug}`
  function summary(item) {
    return {
      id: item._id, slug: item.slug, kind: item.kind, origin: item.origin, title: item.title, summary: item.summary,
      ...(item.category && { category: item.category }),
      authorName: item.authorName, ...(item.publishedAt && { publishedAt: new Date(item.publishedAt).toISOString() }),
      counts: { copies: item.counts?.copies ?? 0, adds: item.counts?.adds ?? 0, branches: item.counts?.branches ?? 0 },
      provenance: item.provenance || {}, url: url(item), preview: item.preview || { kind: item.kind, notes: 0 },
    }
  }
  function detail(item, privileged) {
    return {
      ...summary(item),
      ...(item.description && { description: item.description }),
      synonyms: item.synonyms || [], license: item.license || LIBRARY_LICENSE, categoryLocked: Boolean(item.categoryLocked),
      versionCount: item.versionCount || 0, ...(item.publishedVersion && { publishedVersion: item.publishedVersion }),
      // Said only once it is more than one: absent means published once (the export stays within one exec result).
      ...(publishedCountOf(item) > 1 && { publishedCount: publishedCountOf(item) }),
      ...(privileged && {
        status: item.status, ...(item.reviewStatus && { reviewStatus: item.reviewStatus }),
        ...(item.pendingVersion && { pendingVersion: item.pendingVersion }),
        ...(item.pendingMeta && { pendingMeta: item.pendingMeta }),
        ...(item.draftMeta && { draftMeta: item.draftMeta }),
        ...(item.sourceShareId && { sourceShareId: item.sourceShareId }),
        ...(item.reviewShareId && { reviewShareId: item.reviewShareId }),
        ...(item.lastMessage && { lastMessage: { ...item.lastMessage, at: new Date(item.lastMessage.at).toISOString() } }),
      }),
    }
  }
  const versionShape = (version) => ({ n: version.n, meta: version.meta, content: version.content, ...(version.createdAt && { createdAt: new Date(version.createdAt).toISOString() }) })
  // The thread as its reader may see it. Reviewers see everything. An author sees what was decided and
  // said to them, never the reviewer's own refine chat (refine_proposed), what a review copy was, or
  // anyone's account id.
  const eventShape = (row, { reviewer = false } = {}) => {
    const actor = reviewer || !row.actor ? row.actor : { kind: row.actor.kind, name: row.actor.name }
    const message = row.message && (reviewer || !REVIEWER_ONLY_MESSAGES.has(row.type)) ? row.message : undefined
    const diff = row.diff && (reviewer || row.type !== 'review_opened') ? row.diff : undefined
    return { id: row._id, at: new Date(row.at).toISOString(), actor, type: row.type,
      ...(message && { message }), ...(diff && { diff }), ...(row.version !== undefined && { version: row.version }) }
  }
  const threadFor = (rows, reviewer) => rows.filter((row) => reviewer || !REVIEWER_ONLY_EVENTS.has(row.type)).map((row) => eventShape(row, { reviewer }))

  async function page(selector, sort, cursor, limit) {
    const skip = readCursor(cursor)
    const rows = await items.find(selector, { sort, skip, limit: limit + 1 }).toArray()
    const total = await items.countDocuments(selector)
    return { rows: rows.slice(0, limit), next: rows.length > limit ? String(skip + limit) : undefined, total }
  }

  // ---------- reads ----------
  async function list(_principal, input = {}) {
    const selector = { status: 'published' }
    if (input.kind) selector.kind = input.kind
    if (input.category) selector.category = input.category
    if (input.origin) selector.origin = input.origin
    const q = typeof input.q === 'string' ? input.q.trim().slice(0, 100) : ''
    if (q) {
      const pattern = { $regex: escapeRegex(q), $options: 'i' }
      selector.$or = [{ title: pattern }, { summary: pattern }, { synonyms: pattern }, { description: pattern }]
    }
    const sort = input.sort === 'popular' ? { popularity: -1, publishedAt: -1, _id: 1 } : { publishedAt: -1, _id: 1 }
    const limit = Math.min(Math.max(Number(input.limit) || 24, 1), LIBRARY_LIMITS.listLimit)
    const { rows, next, total } = await page(selector, sort, input.cursor, limit)
    return { items: rows.map(summary), ...(next && { next }), total }
  }

  async function get(principal, input) {
    const { item, privileged, reviewer } = await readableItem(principal, input.itemId)
    const version = await visibleVersion(item, privileged, input.version)
    // Its author and reviewers also read the review thread (the review panel and My library show it).
    const thread = privileged && item.origin !== 'builtin'
      ? threadFor((await events.find({ itemId: item._id }, { sort: { at: -1, _id: -1 }, limit: 100 }).toArray()).reverse(), reviewer)
      : null
    return { item: detail(item, privileged), version: versionShape(version), ...(thread && { thread }) }
  }

  async function stats() {
    const count = (selector) => items.countDocuments({ status: 'published', ...selector })
    const [builtin, community, slatesN, presentations] = await Promise.all([
      count({ kind: 'component', origin: 'builtin' }), count({ kind: 'component', origin: 'user' }),
      count({ kind: 'slate' }), count({ kind: 'presentation' }),
    ])
    const categories = {}
    for (const category of LIBRARY_CATEGORIES) categories[category] = await count({ category })
    const [latest] = await items.find({ status: 'published' }, { sort: { publishedAt: -1 }, limit: 1 }).toArray()
    return {
      components: { builtin, community, total: builtin + community }, slates: slatesN, presentations, categories,
      ...(latest?.publishedAt && { updatedAt: new Date(latest.publishedAt).toISOString() }),
    }
  }

  async function exportPage(_principal, input = {}) {
    const { rows, next } = await page({ status: 'published' }, { _id: 1 }, input.cursor, LIBRARY_LIMITS.exportPage)
    const out = []
    for (const item of rows) {
      const version = await versionOf(item, item.publishedVersion)
      if (version) out.push({ ...detail(item, false), version: versionShape(version) })
    }
    return { items: out, ...(next && { next }) }
  }

  async function mine(principal, input = {}) {
    if (!principal?.userId) throw fail(401, 'unauthorized', 'Sign in to see your library.')
    const selector = { authorId: principal.userId }
    if (input.status) selector.$or = [{ status: input.status }, { reviewStatus: input.status }]
    const rows = await items.find(selector, { sort: { updatedAt: -1 }, limit: 200 }).toArray()
    const reviewer = await isReviewer(principal.userId)
    const out = []
    for (const item of rows) {
      const selectorFor = { itemId: item._id, ...(!reviewer && { type: { $nin: [...REVIEWER_ONLY_EVENTS] } }) }
      const thread = await events.find(selectorFor, { sort: { at: -1, _id: -1 }, limit: LIBRARY_LIMITS.mineEvents }).toArray()
      out.push({ ...detail(item, true), events: threadFor(thread.reverse(), reviewer) })
    }
    return { items: out }
  }

  // ---------- forks and branches ----------
  async function newSlate(principal, content, { name, libraryOrigin, library } = {}) {
    const user = await loadUser(principal.userId)
    if (!user) throw fail(404, 'not_found', 'Your account could not be found.')
    const shareId = await generateShareId()
    const id = newId()
    const row = content.slate
      ? copyDocument(content.slate, { id, shareId, user, now: now(), name, libraryOrigin })
      : privateSlateDocument({ content: { ...content.row, ...(libraryOrigin && { libraryOrigin }) }, id, user, shareId, now: now() })
    if (library) row.library = library
    const made = await saveCore.create({ row, actor: principal, source: 'library' })
    return { shareId, revision: made.revision ?? 1, user, row }
  }
  // A slate holding one board, at the top left, as its first board.
  const boardSlateContent = (workshop, name) => {
    const set = componentSet(workshop, { x: 40, y: 40 })
    return { row: { options: { name: name.slice(0, 200), description: '', workshopOrigin: set['options.workshopOrigin'] }, nodes: [], nativeCanvasDrawing: true, creative: set.creative } }
  }
  // A component's board is called what its item is called (a built-in's is its entry's name).
  const boardTitle = (item, version) => version.meta?.title || item.title || version.content.workshop?.title || 'Board'
  const named = (title, topic) => (topic ? `${title}: ${topic.replace(/\s+/g, ' ').trim()}`.slice(0, 120) : title)
  // One use counted per signed-in person and item (uses.mjs): never a guest, never twice.
  const bump = (item, field, principal) => countUse({ items, counters, itemId: item._id, field, userId: principal?.userId, guest: principal?.kind === 'guest' })
  const spend = (principal, action) => spendAllowance({ counters, userId: principal?.userId, action, now })

  async function fork(principal, input, { mode = 'save' } = {}) {
    const { item, privileged } = await readableItem(principal, input.itemId)
    const version = await visibleVersion(item, privileged, input.version)
    // Kept on the copy and every later copy: the credit its licence asks for (whose it is, and where from).
    const origin = { itemId: item._id, version: version.n, kind: item.kind, title: item.title, ...(item.authorName && { authorName: item.authorName }) }
    if (item.kind !== 'component') {
      if (input.targetShareId) throw fail(400, 'invalid_request', 'Only a smart component is added to a slate. A slate or presentation opens as a copy of its own.', { field: 'targetShareId' })
      const name = input.name || version.meta?.title || item.title
      if (mode === 'preview') return { shareId: null, itemId: item._id, version: version.n, name, notes: version.content.slate?.nodes?.length ?? 0 }
      await spend(principal, 'fork')
      const made = await newSlate(principal, version.content, { name, libraryOrigin: origin })
      if (item.kind === 'presentation' && version.content.deck)
        await copyPresentation({ ...version.content.deck, isPublished: false, isPublic: false }, { shareId: made.shareId, sourceShareId: null, user: made.user, now: now() })
      await bump(item, 'copies', principal)
      return { shareId: made.shareId, revision: made.revision, itemId: item._id, version: version.n }
    }
    const workshop = validateWorkshop({ ...structuredClone(version.content.workshop), title: named(boardTitle(item, version), input.topic) })
    if (!input.targetShareId) {
      if (mode === 'preview') return { shareId: null, itemId: item._id, version: version.n, canvas: { workshop, origin: { x: 40, y: 40 } } }
      await spend(principal, 'fork')
      const made = await newSlate(principal, boardSlateContent(workshop, input.name || workshop.title), { libraryOrigin: origin })
      await bump(item, 'adds', principal)
      return { shareId: made.shareId, revision: made.revision, boardId: MAIN_BOARD, itemId: item._id, version: version.n }
    }
    const found = await resolveSlateForUser(input.targetShareId, principal.userId)
    if (!found?.canRead) throw fail(404, 'not_found', 'Slate not found or unavailable.')
    if (!found.canEdit) throw fail(403, 'forbidden', 'You can view this slate but not add to it.')
    const slate = found.slate
    const held = slateBoards(slate).length
    if (slate.creative && !held) throw fail(409, 'component_opens_new_slate', 'This slate can’t hold a board.')
    if (held >= MAX_BOARDS) throw fail(409, 'component_opens_new_slate', `This slate holds ${MAX_BOARDS} boards, the most for now. Add it on a new slate?`)
    if (input.expectedRevision !== undefined && (slate.revision ?? 0) !== input.expectedRevision)
      throw fail(409, 'slate_changed', 'The slate changed since you read it. Read it again and send its revision.', { revision: slate.revision ?? 0 })
    const placed = componentPlacing(slate, workshop)
    if (mode === 'preview') return { shareId: slate.shareId, revision: slate.revision ?? 0, boardId: placed.boardId, itemId: item._id, version: version.n, canvas: { workshop, origin: placed.origin } }
    await agentsGate(principal, slate)
    let made = placed
    let saved
    try {
      saved = await saveCore.save({
        slateId: slate._id, actor: principal, source: 'library',
        conditions: { userId: slate.userId, orgId: slate.orgId ?? null, ...sharedSaveConditions(slate, principal.userId) },
        build(current) {
          if (input.expectedRevision !== undefined && (current.revision ?? 0) !== input.expectedRevision) throw Object.assign(new Error('moved'), { code: 'slate_moved' })
          if (slateBoards(current).length >= MAX_BOARDS) throw Object.assign(new Error('full'), { code: 'board_cap' })
          made = componentPlacing(current, workshop)
          return { set: made.set, inc: { nativeConversationRevision: 1 } }
        },
      })
    } catch (error) {
      if (error?.code === 'slate_moved') throw fail(409, 'slate_changed', 'The slate changed since you read it. Read it again and send its revision.')
      if (error?.code === 'board_cap') throw fail(409, 'component_opens_new_slate', `This slate holds ${MAX_BOARDS} boards, the most for now. Add it on a new slate?`)
      if (error?.name === 'SlateSaveRefused' || error?.code === 'save_refused') throw fail(409, 'slate_changed', 'The slate changed since you read it. Try again.')
      throw error
    }
    await bump(item, 'adds', principal)
    return { shareId: slate.shareId, revision: saved.revision, boardId: made.boardId, itemId: item._id, version: version.n }
  }

  async function branch(principal, input = {}) {
    if (!input.itemId || input.itemId === 'new') {
      await spend(principal, 'branch')
      const made = await newSlate(principal, { row: { options: { name: 'Untitled smart component', description: '' }, nodes: [] } }, { library: { mode: 'build' } })
      return { shareId: made.shareId, revision: made.revision }
    }
    const { item, privileged } = await readableItem(principal, input.itemId)
    if (item.kind !== 'component') throw fail(400, 'invalid_request', 'Only a smart component is branched. Fork a slate or presentation instead.', { field: 'itemId' })
    const version = await visibleVersion(item, privileged, input.version)
    const workshop = validateWorkshop(structuredClone(version.content.workshop))
    const parent = { itemId: item._id, version: version.n, title: item.title, ...(item.category && { category: item.category }) }
    await spend(principal, 'branch')
    const made = await newSlate(principal, boardSlateContent(workshop, workshop.title || item.title), { library: { mode: 'build', boardId: MAIN_BOARD, parent } })
    await bump(item, 'branches', principal)
    return { shareId: made.shareId, revision: made.revision }
  }

  // ---------- author writes ----------
  async function builderSlate(principal, shareId) {
    const slate = await slates.findOne({ shareId })
    if (!slate || slate.archivedDate) throw fail(404, 'not_found', 'Slate not found or unavailable.')
    if (slate.userId !== principal.userId) throw fail(403, 'owner_required', 'Only the slate’s owner can save its board to the library.')
    if (slate.library?.mode !== 'build') throw fail(409, 'not_a_builder', 'This slate is not building a smart component. Start one with library.branch.')
    return slate
  }
  const boardOn = (slate, boardId) => slateBoards(slate).find((board) => board.id === (boardId || slate.library?.boardId || MAIN_BOARD))
  async function parentCategory(parent) {
    if (!parent) return null
    if (parent.category) return parent.category
    const item = await items.findOne({ _id: parent.itemId })
    return item?.category ?? null
  }
  async function lockCategory(meta, parent, given) {
    const locked = await parentCategory(parent)
    if (!locked) return false
    if (given && given !== locked) throw fail(409, 'category_locked', categoryLockSentence(locked))
    meta.category = locked
    return true
  }

  async function saveDraft(principal, input) {
    const slate = await builderSlate(principal, input.shareId)
    const board = boardOn(slate, input.boardId)
    if (!board) throw fail(409, 'no_board', 'There is no board to save yet. Make one by chat first.')
    const meta = readMeta(input, { kind: 'component' })
    const parent = slate.library.parent || null
    const locked = await lockCategory(meta, parent, input.category)
    const draft = { kind: 'component', workshop: snapshotWorkshop(board.model.workshop) }
    checkSize(draft)
    await spend(principal, 'saveDraft')
    const ref = input.itemId || slate.library.itemId
    const actor = await authorActor(principal)
    if (ref) {
      const item = await authoredItem(principal, ref)
      if (item.kind !== 'component') throw fail(400, 'invalid_request', 'That item is not a smart component.', { field: 'itemId' })
      if (!['draft', 'changes_requested', 'rejected', 'unpublished', 'published'].includes(item.status) || ['submitted', 'in_review'].includes(item.reviewStatus))
        throw fail(409, 'invalid_transition', 'It is waiting for review. Withdraw it first to change it.')
      // A published item's details are what the public reads: a draft's details wait beside them
      // (draftMeta) and reach the public only through a submitted update a reviewer approves.
      const details = item.status === 'published' ? { draftMeta: meta } : meta
      await items.updateOne({ _id: item._id }, { $set: { ...details, categoryLocked: locked || Boolean(item.categoryLocked), draft, sourceShareId: slate.shareId, sourceBoardId: board.id, updatedAt: at() } })
      await log(item, 'draft_saved', actor)
      if (slate.library.itemId !== item._id) await slates.updateOne({ _id: slate._id }, { $set: { 'library.itemId': item._id } })
      return { itemId: item._id, slug: item.slug, status: item.status }
    }
    const id = newId()
    const item = {
      _id: id, kind: 'component', origin: 'user', status: 'draft', reviewStatus: null, slug: slugify(meta.title, id),
      title: meta.title, summary: meta.summary, ...(meta.description && { description: meta.description }), ...(meta.category && { category: meta.category }),
      categoryLocked: locked, synonyms: meta.synonyms || [], authorId: principal.userId, authorName: actor.name,
      provenance: parent ? { branchedFrom: { itemId: parent.itemId, version: parent.version, title: parent.title } } : {},
      sourceShareId: slate.shareId, sourceBoardId: board.id, draft, versionCount: 0, counts: { copies: 0, adds: 0, branches: 0 }, popularity: 0,
      license: LIBRARY_LICENSE, preview: previewOf(draft), createdAt: at(), updatedAt: at(),
    }
    await items.insertOne(item)
    await log(item, 'created', actor)
    await slates.updateOne({ _id: slate._id }, { $set: { 'library.itemId': id } })
    return { itemId: id, slug: item.slug, status: 'draft' }
  }

  async function ownsOrAdmins(principal, slate) {
    if (slate.userId === principal.userId) return true
    return Boolean(slate.orgId && (await isTeamAdmin(principal.userId, slate.orgId)))
  }

  async function submit(principal, input) {
    if (principal.kind === 'guest') throw fail(403, 'sign_in_to_publish', 'Sign up to publish to the library (/signup). Your slates come with you.')
    if (!LIBRARY_KINDS.includes(input.kind)) throw fail(400, 'invalid_request', 'kind is component, slate or presentation.', { field: 'kind' })
    const note = readMessage(input.note, { required: false })
    const actor = await authorActor(principal)
    let item, content, created = false
    if (input.kind === 'component') {
      if (!input.itemId) throw fail(400, 'invalid_request', 'Name the smart component to submit (itemId, from library.saveDraft).', { field: 'itemId' })
      item = await authoredItem(principal, input.itemId)
      if (item.kind !== 'component') throw fail(400, 'invalid_request', 'That item is not a smart component.', { field: 'itemId' })
      // The board as it stands on the author's builder slate, when it is still there; otherwise the saved draft.
      const source = item.sourceShareId ? await slates.findOne({ shareId: item.sourceShareId }) : null
      const board = source && source.userId === principal.userId && source.library?.mode === 'build' && !source.archivedDate ? boardOn(source, item.sourceBoardId) : null
      if (board) content = { kind: 'component', workshop: snapshotWorkshop(board.model.workshop) }
      else if (item.draft) content = item.draft
      else if (item.pendingVersion || item.publishedVersion) content = (await versionOf(item, item.pendingVersion ?? item.publishedVersion))?.content
      if (!content) throw fail(409, 'no_board', 'There is no board to submit yet. Save it first.')
    } else {
      if (!input.shareId) throw fail(400, 'invalid_request', 'Name the slate to submit (shareId).', { field: 'shareId' })
      const found = await resolveSlateForUser(input.shareId, principal.userId)
      if (!found?.canRead) throw fail(404, 'not_found', 'Slate not found or unavailable.')
      const slate = found.slate
      if (!(await ownsOrAdmins(principal, slate))) throw fail(403, 'owner_required', 'Only the slate’s owner, or an admin of its team, can publish it to the library.')
      if (slate.library?.mode) throw fail(409, 'not_publishable', 'A builder or review slate is published from its own panel.')
      content = { kind: input.kind, slate: snapshotSlate(slate) }
      if (input.kind === 'presentation') {
        const deck = (await publishedPresentation(slate.shareId)) || (await latestPresentation(slate.shareId, principal.userId))
        if (!deck) throw fail(409, 'no_presentation', 'This slate has no presentation yet. Press Present to make one, then publish it.')
        content.deck = snapshotDeck(deck)
      }
      item = await items.findOne({ kind: input.kind, sourceShareId: slate.shareId, authorId: principal.userId })
      if (!item) {
        const id = newId()
        const title = input.title ?? slate.options?.name ?? ''
        const origin = slate.libraryOrigin
        item = {
          _id: id, kind: input.kind, origin: 'user', status: null, reviewStatus: null, slug: slugify(title || 'slate', id), title: '', summary: '',
          categoryLocked: false, synonyms: [], authorId: principal.userId, authorName: actor.name,
          provenance: origin?.itemId ? { forkedFrom: { itemId: origin.itemId, version: origin.version, title: origin.title } } : {},
          sourceShareId: slate.shareId, versionCount: 0, counts: { copies: 0, adds: 0, branches: 0 }, popularity: 0, license: LIBRARY_LICENSE,
          createdAt: at(), updatedAt: at(),
        }
        if (!input.title && title) input = { ...input, title }
        created = true
      }
    }
    const next = transition(created ? null : item, 'submit', 'author')
    if (!next) throw fail(409, 'invalid_transition', reviewStateOf(item) === 'in_review' ? 'It is being reviewed now.' : 'It is already waiting for review.')
    const given = readMeta(input, { kind: item.kind, partial: true })
    const meta = { ...metaOf(item), ...(item.draftMeta || {}), ...given }
    if (!meta.title) throw fail(400, 'invalid_request', 'Give it a title.', { field: 'title' })
    if (!meta.summary) throw fail(400, 'invalid_request', 'Give it a one-line summary.', { field: 'summary' })
    if (item.categoryLocked && given.category && given.category !== item.category) throw fail(409, 'category_locked', categoryLockSentence(item.category))
    if (item.kind === 'component' && !meta.category) throw fail(400, 'category_required', `Choose a category: ${LIBRARY_CATEGORIES.map(categoryLabel).join(', ')}.`, { field: 'category' })
    checkSize(content)
    // Today's allowance is taken atomically, just before anything is written: parallel submits can't beat it.
    await spend(principal, 'submit')
    if (created) await items.insertOne({ ...item, ...meta, status: 'draft' })
    const version = await writeVersion(item, { source: 'submit', content, createdBy: principal.userId, meta })
    const updating = item.status === 'published'
    const set = {
      ...(updating ? { pendingMeta: meta } : meta), status: next.status, reviewStatus: next.reviewStatus, pendingVersion: version.n, versionCount: version.n,
      submittedAt: at(), updatedAt: at(), authorName: actor.name, ...lastMessage('author', note),
      ...(item.status !== 'published' && { preview: previewOf(content) }),
    }
    // Sent by its owner: no longer the untouched copy a migration made (the queue's "From Community slates").
    await items.updateOne({ _id: item._id }, { $set: set, $unset: { draft: '', draftMeta: '', migrationPristine: '' } })
    await log(item, 'submitted', actor, { version: version.n, ...(note && { message: note }) })
    return { itemId: item._id, slug: item.slug, status: next.status, reviewStatus: next.reviewStatus, version: version.n }
  }

  async function withdraw(principal, input) {
    const item = await authoredItem(principal, input.itemId)
    const next = transition(item, 'withdraw', 'author')
    if (!next) throw fail(409, 'invalid_transition', reviewStateOf(item) === 'in_review' ? 'It is being reviewed now. Write to the reviewer instead.' : 'There is nothing to withdraw.')
    const set = { status: next.status, reviewStatus: null, updatedAt: at() }
    // A submission taken back is a draft again, with the content it was submitted with (an update
    // taken back too: the published version stays live, the update is the author's draft again).
    if ((next.status === 'draft' || next.status === 'published') && item.pendingVersion) {
      const pending = await versionOf(item, item.pendingVersion)
      if (pending && item.kind === 'component') set.draft = pending.content
    }
    await items.updateOne({ _id: item._id }, { $set: set, $unset: { pendingVersion: '', pendingMeta: '' } })
    await log(item, 'withdrawn', await authorActor(principal))
    return { itemId: item._id, status: next.status }
  }

  async function discard(principal, input) {
    const item = await authoredItem(principal, input.itemId)
    if (!transition(item, 'discard', 'author')) throw fail(409, 'invalid_transition', 'Only a draft is discarded. Withdraw it first.')
    await items.deleteOne({ _id: item._id })
    if (item.sourceShareId) await slates.updateOne({ shareId: item.sourceShareId, 'library.itemId': item._id }, { $unset: { 'library.itemId': '' } })
    return { itemId: item._id, discarded: true }
  }

  async function comment(principal, input) {
    const item = await findItem(input.itemId)
    if (!item) throw notFound()
    if (item.origin === 'builtin') throw builtinRefusal()
    const reviewer = await isReviewer(principal.userId)
    const author = item.authorId === principal.userId
    if (!reviewer && !author) {
      if (canReadItem(item, { userId: principal.userId })) throw fail(403, 'author_required', 'Only its author or a reviewer writes in its thread.')
      throw notFound()
    }
    const message = readMessage(input.message)
    if (!reviewer) await spend(principal, 'comment')
    const by = author ? 'author' : 'reviewer'
    const row = await log(item, 'comment', author ? await authorActor(principal) : await reviewerActor(principal), { message })
    await items.updateOne({ _id: item._id }, { $set: { ...lastMessage(by, message), updatedAt: at() } })
    if (!author) await notify({ item, type: 'comment', message })
    return { itemId: item._id, eventId: row._id }
  }

  // ---------- review ----------
  async function queue(principal, input = {}) {
    await requireReviewer(principal)
    const status = input.status || 'waiting'
    const selector = { origin: 'user' }
    if (status === 'waiting') selector.reviewStatus = { $in: [...QUEUE_WAITING] }
    else if (status === 'all') selector.reviewStatus = { $in: ['submitted', 'in_review', 'changes_requested'] }
    else if (status === 'published') selector.status = 'published'
    else if (QUEUE_STATUSES.includes(status)) selector.reviewStatus = status
    if (input.kind) selector.kind = input.kind
    if (input.source === 'migration') selector.migrationPristine = true
    const sort = status === 'published' ? { publishedAt: -1, _id: 1 } : { submittedAt: 1, _id: 1 }
    const { rows, next, total } = await page(selector, sort, input.cursor, LIBRARY_LIMITS.listLimit)
    return {
      items: rows.map((item) => ({
        ...detail(item, true), authorId: item.authorId, isUpdate: item.status === 'published' && Boolean(item.pendingVersion),
        ...(item.submittedAt && { waitingSince: new Date(item.submittedAt).toISOString(), waitingMs: Math.max(0, now() - new Date(item.submittedAt).getTime()) }),
        ...(item.migrationPristine && { migrated: true }),
      })),
      ...(next && { next }), total,
    }
  }

  async function reviewItem(principal, ref) {
    await requireReviewer(principal)
    const item = await findItem(ref)
    if (!item) throw notFound()
    if (item.origin === 'builtin') throw builtinRefusal()
    return item
  }
  // A second person reviews what someone publishes: an administrator never opens, refines, edits or
  // approves their own submission. A server with one administrator may, by saying so (selfReview),
  // and the event log records it. → whether this is a self-review.
  // A slate moved from Community slates that its owner never sent: published only while the slate is
  // still public. Made private or deleted since, it is not theirs to give any more.
  async function checkSourceStillPublic(item) {
    if (!item.migrationPristine || !item.sourceShareId) return
    const source = await slates.findOne({ shareId: item.sourceShareId })
    if (!source || source.archivedDate || source.options?.isPublic !== true || source.options?.isPrivate === true)
      throw fail(409, 'source_not_public', 'Its owner has made the slate private or deleted it since it was moved here, so it can’t be published. Turn it down instead.')
  }
  async function checkNotOwn(principal, item, input = {}) {
    if (!item.authorId || item.authorId !== principal.userId) return false
    if (input.selfReview === true && (await countReviewers()) <= 1) return true
    throw fail(403, 'self_review', SELF_REVIEW_SENTENCE)
  }
  const refused = (item, action) =>
    fail(409, 'invalid_transition', `It is ${String(reviewStateOf(item)).replace('_', ' ')}, so it can’t be ${action}.`, { status: item.status, reviewStatus: item.reviewStatus ?? null })

  async function open(principal, input) {
    const item = await reviewItem(principal, input.itemId)
    const self = await checkNotOwn(principal, item, input)
    await checkSourceStillPublic(item)
    const next = transition(item, 'review.open', 'reviewer')
    if (!next || !item.pendingVersion) throw refused(item, 'opened for review')
    const version = await versionOf(item, item.pendingVersion)
    const existing = item.reviewShareId ? await slates.findOne({ shareId: item.reviewShareId }) : null
    let reviewShareId = existing?.shareId
    let archived = null
    // The review copy is the reviewer's: made again for a new version, the old one archived (never deleted).
    if (!existing || existing.archivedDate || existing.library?.version !== version.n || existing.userId !== principal.userId) {
      if (existing && !existing.archivedDate) {
        await slates.updateOne({ _id: existing._id }, { $set: { archivedDate: at() } })
        archived = existing.shareId
      }
      const library = { mode: 'review', itemId: item._id, version: version.n, ...(item.kind === 'component' && { boardId: MAIN_BOARD }) }
      const content = item.kind === 'component' ? boardSlateContent(validateWorkshop(structuredClone(version.content.workshop)), item.title) : version.content
      const made = await newSlate(principal, content, { name: item.title, library })
      if (item.kind === 'presentation' && version.content.deck)
        await copyPresentation({ ...version.content.deck, isPublished: false, isPublic: false }, { shareId: made.shareId, sourceShareId: null, user: made.user, now: now() })
      reviewShareId = made.shareId
    }
    await items.updateOne({ _id: item._id }, { $set: { status: next.status, reviewStatus: next.reviewStatus, reviewShareId, reviewerId: principal.userId, updatedAt: at() } })
    if (reviewStateOf(item) !== 'in_review' || archived || reviewShareId !== item.reviewShareId)
      await log(item, 'review_opened', await reviewerActor(principal), { version: version.n, ...(self && { selfReview: true }), ...(archived && { diff: { notes: `Archived review copy ${archived}` } }) })
    return { itemId: item._id, reviewShareId, status: next.status, reviewStatus: next.reviewStatus, version: version.n }
  }

  async function reviewSlate(item) {
    const slate = item.reviewShareId ? await slates.findOne({ shareId: item.reviewShareId }) : null
    if (!slate || slate.archivedDate || slate.library?.mode !== 'review') throw fail(409, 'open_first', 'Open it for review first (library.review.open).')
    return slate
  }

  async function refine(principal, input, { mode = 'save' } = {}) {
    const item = await reviewItem(principal, input.itemId)
    await checkNotOwn(principal, item, input)
    if (reviewStateOf(item) !== 'in_review') throw refused(item, 'refined')
    const slate = await reviewSlate(item)
    const board = item.kind === 'component' ? boardOn(slate, slate.library.boardId) : null
    const message = readMessage(input.message)
    const history = (input.history || []).slice(-LIBRARY_LIMITS.history)
    const local = localRefinement(message)
    // Keep names the preview it keeps (previewId): exactly that proposal is applied, stored with the item,
    // never a second AI answer. Without a previewId, save asks afresh (a direct call that previews nothing).
    let raw
    let kept = null
    if (mode === 'save' && input.previewId) {
      kept = (item.refinePreviews || []).find((row) => row.id === input.previewId)
      if (!kept || kept.userId !== principal.userId || kept.message !== message || now() - new Date(kept.at).getTime() > REFINE_PREVIEW_MS)
        throw fail(409, 'preview_expired', 'That proposal is no longer there to keep. Ask again to see it, then keep it.')
      raw = kept.raw
    } else {
      raw = local || (await refineWithAI({ item, board: board?.model?.workshop ?? null, message, history, principal }))
    }
    const actor = await reviewerActor(principal)
    let proposal
    try {
      proposal = checkProposal(withPending(item), raw)
    } catch (error) {
      await log(item, 'refine_proposed', { kind: 'ai', userId: null, name: 'Slatebox' }, { message: `${message}\n— ${error.message}`.slice(0, 2000), ...(raw?.ai && { ai: raw.ai }) })
      throw error
    }
    const diff = { ...(Object.keys(proposal.diff.meta).length && { meta: proposal.diff.meta }) }
    let applied = null
    if (proposal.edits.length) {
      if (!board || !applyWorkshopOperations) throw fail(409, 'no_board', 'There is no board on the review copy to edit.')
      const plan = { message: 'Refine', operations: [{ kind: 'workshop_edits', edits: proposal.edits, expectedRevision: board.revision ?? 0, boardId: board.id }] }
      const token = { _id: null, userId: principal.userId, name: 'Library review' }
      // The dry run checks the edits the way a person's would be checked; a refusal is answered with
      // its sentence and recorded, and nothing is applied.
      try {
        await applyWorkshopOperations({ slate, token, plan, dryRun: true, ruleActor: { by: actor.name, via: 'chat' } })
      } catch (error) {
        await log(item, 'refine_proposed', { kind: local ? 'system' : 'ai', userId: null, name: 'Slatebox' }, { message: `${message}\n— ${error.message}`.slice(0, 2000), ...(raw?.ai && { ai: raw.ai }) })
        throw error
      }
      // The rule lines the reviewer sees: the board before and after the same edits (the dry run's
      // answer is the board as an agent reads it, not the stored model).
      try {
        const before = validateWorkshop(board.model.workshop)
        const after = applyWorkshopEdits(before, proposal.edits, { actor: { by: actor.name, via: 'chat' } }).workshop
        const lines = rulebook().diff(before, after).lines
        if (lines.length) diff.rules = lines
      } catch { /* a board without a rulebook has no rule lines to show */ }
      if (mode === 'save') {
        await agentsGate(principal, slate)
        applied = await applyWorkshopOperations({ slate, token, plan, dryRun: false, key: newId(), ruleActor: { by: actor.name, via: 'chat' } })
      }
    }
    await log(item, 'refine_proposed', { kind: local ? 'system' : 'ai', userId: null, name: 'Slatebox' }, {
      message: message, ...(Object.keys(diff).length && { diff }), ...(raw?.ai && { ai: raw.ai }),
    })
    // The server's own scan for personal data comes first, whatever the AI said.
    const check = [...personalDataChecks(withPending(item), board?.model?.workshop ?? null), ...proposal.check].slice(0, 12)
    const out = { itemId: item._id, reply: proposal.reply, proposal: { meta: proposal.meta, edits: proposal.edits, check }, diff }
    if (mode !== 'save') {
      const previewId = newId()
      const fresh = (item.refinePreviews || []).filter((row) => now() - new Date(row.at).getTime() <= REFINE_PREVIEW_MS)
      const row = { id: previewId, userId: principal.userId, message, at: at(), raw: { reply: raw?.reply ?? '', ...(raw?.meta && { meta: raw.meta }), ...(raw?.edits && { edits: raw.edits }), ...(raw?.check && { check: raw.check }), ...(raw?.ai && { ai: raw.ai }) } }
      await items.updateOne({ _id: item._id }, { $set: { refinePreviews: [...fresh, row].slice(-REFINE_PREVIEWS) } })
      return { ...out, previewId }
    }
    if (kept) await items.updateOne({ _id: item._id }, { $set: { refinePreviews: (item.refinePreviews || []).filter((row) => row.id !== kept.id) } })
    if (Object.keys(proposal.meta).length) await items.updateOne({ _id: item._id }, { $set: { ...pendingSet(item, proposal.meta), updatedAt: at() } })
    if (Object.keys(proposal.meta).length || proposal.edits.length) await log(item, 'refine_kept', actor, { ...(Object.keys(diff).length && { diff }) })
    return { ...out, kept: Boolean(Object.keys(proposal.meta).length || proposal.edits.length), ...(applied?.body?.revision !== undefined && { revision: applied.body.revision }) }
  }

  async function update(principal, input) {
    const item = await reviewItem(principal, input.itemId)
    await checkNotOwn(principal, item, input)
    const { itemId: _id, selfReview: _self, ...fields } = input
    const meta = readMeta(fields, { kind: item.kind, partial: true })
    if (meta.category && item.categoryLocked && meta.category !== item.category) throw fail(409, 'category_locked', categoryLockSentence(item.category))
    const shown = withPending(item)
    const diff = metaDiff(shown, { ...shown, ...meta })
    if (Object.keys(diff).length) {
      await items.updateOne({ _id: item._id }, { $set: { ...pendingSet(item, meta), updatedAt: at() } })
      await log(item, 'edited', await reviewerActor(principal), { diff: { meta: diff } })
    }
    return { item: detail(await items.findOne({ _id: item._id }), true) }
  }

  async function approve(principal, input) {
    const item = await reviewItem(principal, input.itemId)
    const self = await checkNotOwn(principal, item, input)
    await checkSourceStillPublic(item)
    const next = transition(item, 'review.approve', 'reviewer')
    if (!next) throw refused(item, 'approved')
    const message = readMessage(input.message, { required: false })
    const slate = await reviewSlate(item)
    const pending = item.pendingVersion ? await versionOf(item, item.pendingVersion) : null
    let content
    if (item.kind === 'component') {
      const board = boardOn(slate, slate.library.boardId)
      if (!board) throw fail(409, 'no_board', 'The review copy has no board to publish.')
      content = { kind: 'component', workshop: snapshotWorkshop(board.model.workshop) }
      const failing = listingGate ? listingGate(content.workshop) : null
      if (failing) throw fail(409, 'listing_gate', `"${failing}" does not work on this board yet. Change the board or its rules, then approve.`)
    } else {
      content = { kind: item.kind, slate: snapshotSlate(slate) }
      if (item.kind === 'presentation') {
        const deck = (await latestPresentation(slate.shareId, principal.userId)) || null
        content.deck = deck ? snapshotDeck(deck) : pending?.content?.deck ?? null
        if (!content.deck) throw fail(409, 'no_presentation', 'The review copy has no presentation to publish.')
      }
    }
    const meta = metaOf(withPending(item))
    const version = pending
      ? await publishReviewed(pending, { content, meta, reviewedBy: principal.userId })
      : await writeVersion(item, { source: 'review', content, createdBy: principal.userId, meta })
    // How many times it has been published (the review header's "published 2 times"); the version
    // number people see is publishedVersion, the version the author sent.
    const publishedCount = publishedCountOf(item) + 1
    const diff = { ...(pending && Object.keys(metaDiff(pending.meta, meta)).length && { meta: metaDiff(pending.meta, meta) }), ...contentDiff(pending?.content, content) }
    await items.updateOne({ _id: item._id }, {
      $set: { ...meta, status: 'published', reviewStatus: null, publishedVersion: version.n, publishedCount, versionCount: version.n, publishedAt: at(), updatedAt: at(), preview: previewOf(content), ...lastMessage('reviewer', message) },
      $unset: { pendingVersion: '', pendingMeta: '', migrationPristine: '' },
    })
    await log(item, 'approved', await reviewerActor(principal), { version: version.n, ...(self && { selfReview: true }), ...(message && { message }), ...(Object.keys(diff).length && { diff }) })
    const published = await items.findOne({ _id: item._id })
    await notify({ item: published, type: 'approved', message })
    return { itemId: item._id, status: 'published', publishedVersion: version.n, publishedCount, url: url(published) }
  }

  async function decide(principal, input, action, type, verb) {
    const item = await reviewItem(principal, input.itemId)
    const next = transition(item, action, 'reviewer')
    if (!next) throw refused(item, verb)
    const message = readMessage(input.message)
    const set = { status: next.status, reviewStatus: next.reviewStatus, updatedAt: at(), ...lastMessage('reviewer', message) }
    const unset = next.status === 'unpublished' ? { pendingVersion: '', pendingMeta: '' } : next.reviewStatus === 'rejected' && item.pendingMeta ? { pendingMeta: '' } : null
    await items.updateOne({ _id: item._id }, { $set: set, ...(unset && { $unset: unset }) })
    await log(item, type, await reviewerActor(principal), { message, ...(item.pendingVersion && { version: item.pendingVersion }) })
    await notify({ item: { ...item, ...set }, type, message })
    return { itemId: item._id, status: next.status, reviewStatus: next.reviewStatus }
  }

  // ---------- board adds from the catalogue ----------
  /** One more add of a built-in board (add_component): counted on builtin-<id>, once per signed-in person. */
  async function countBuiltinAdd(catalogId, principal) {
    if (typeof catalogId !== 'string' || !catalogId) return
    await countUse({ items, counters, itemId: 'builtin-' + catalogId, field: 'adds', userId: principal?.userId, guest: principal?.kind === 'guest' })
  }

  /** The workshop a library item adds to a slate, for add_component { library: { itemId, version? } }. */
  async function componentFor(principal, { itemId, version }) {
    const { item, privileged } = await readableItem(principal, itemId)
    if (item.kind !== 'component') throw fail(400, 'invalid_component', 'That library item is not a smart component.')
    const found = await visibleVersion(item, privileged, version)
    const workshop = validateWorkshop({ ...structuredClone(found.content.workshop), title: boardTitle(item, found) })
    return { item, version: found.n, workshop, count: () => bump(item, 'adds', principal) }
  }

  return {
    isReviewer, list, get, stats, export: exportPage, mine, fork, branch, saveDraft, submit, withdraw, discard, comment,
    review: {
      queue, open, refine, update, approve,
      requestChanges: (principal, input) => decide(principal, input, 'review.requestChanges', 'changes_requested', 'sent back'),
      reject: (principal, input) => decide(principal, input, 'review.reject', 'rejected', 'rejected'),
      unpublish: (principal, input) => decide(principal, input, 'review.unpublish', 'unpublished', 'unpublished'),
    },
    countBuiltinAdd, componentFor, kinds: LIBRARY_KINDS, kindLabels: KIND_LABELS, builtinAuthor: BUILTIN_AUTHOR,
  }
}
