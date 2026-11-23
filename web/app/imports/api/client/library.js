import { Meteor } from 'meteor/meteor'
import createAnonymousUser from './createAnonymousUser'

// The shared library from the browser: one thin wrapper per library.* action (server/actions/
// library-*.mjs), the same handlers and checks tokens, exec and the MCP server reach. Every
// wrapper answers the action's body; a refusal rejects with a Meteor.Error whose `error` is the
// action's code (not_found, category_locked, reviewer_required, sign_in_to_publish, ...) and whose
// reason is the sentence to show.

/**
 * @typedef {'component'|'slate'|'presentation'} LibraryKind
 * @typedef {'plan'|'decide'|'meetings'|'track'|'map'} LibraryCategory
 * @typedef {'draft'|'submitted'|'in_review'|'changes_requested'|'published'|'rejected'|'unpublished'} LibraryStatus
 * @typedef {{ itemId: string, version: number, title: string }} LibraryLink
 * @typedef {{
 *   id: string, slug: string, kind: LibraryKind, origin: 'builtin'|'user', title: string, summary: string,
 *   category?: LibraryCategory, authorName: string, publishedAt?: string,
 *   counts: { copies: number, adds: number, branches: number },
 *   provenance: { branchedFrom?: LibraryLink, forkedFrom?: LibraryLink },
 *   url: string, preview: { kind: LibraryKind, boardKind?: string, notes: number }
 * }} LibraryItemSummary
 * @typedef {LibraryItemSummary & {
 *   description?: string, synonyms: string[], license: string, categoryLocked: boolean, versionCount: number,
 *   publishedVersion?: number, status?: LibraryStatus, reviewStatus?: string, pendingVersion?: number,
 *   pendingMeta?: object, sourceShareId?: string, reviewShareId?: string, lastMessage?: { at: string, by: string, text: string }
 * }} LibraryItemDetail
 * @typedef {{ n: number, meta: object, content: { kind: LibraryKind, workshop?: object, slate?: object, deck?: object } }} LibraryVersion
 * @typedef {{ itemId: string, slug?: string, status: LibraryStatus, reviewStatus?: string|null, version?: number }} LibraryStatusResult
 */

const call = (method, input = {}) => Meteor.callAsync(method, input)

// A visitor who acts (uses or branches an item) becomes a guest first, as copying a slate does.
async function asSomeone() {
  if (!Meteor.userId()) await createAnonymousUser()
}

const libraryApi = {
  /** @param {{kind?: LibraryKind, category?: LibraryCategory, q?: string, sort?: 'new'|'popular', origin?: 'builtin'|'user', cursor?: string, limit?: number}} [input]
   *  @returns {Promise<{items: LibraryItemSummary[], next?: string, total: number}>} published items (signed out too) */
  list: (input) => call('library.list', input),
  /** @param {{itemId: string, version?: number}} input  id or slug
   *  @returns {Promise<{item: LibraryItemDetail, version: LibraryVersion}>} */
  get: (input) => call('library.get', input),
  /** @returns {Promise<{components: {builtin: number, community: number, total: number}, slates: number, presentations: number, categories: object, updatedAt?: string}>} */
  stats: () => call('library.stats', {}),
  /** @param {{status?: LibraryStatus}} [input]
   *  @returns {Promise<{items: Array<LibraryItemDetail & {events: object[]}>}>} the caller's own items */
  mine: (input) => call('library.mine', input),
  /** Use an item: a slate or presentation as a new private slate; a component on a new slate or beside a slate's boards.
   *  @param {{itemId: string, version?: number, name?: string, targetShareId?: string, expectedRevision?: number, topic?: string, mode?: 'save'|'preview'}} input
   *  @returns {Promise<{shareId: string|null, revision?: number, boardId?: string, itemId: string, version: number, canvas?: {workshop: object, origin: {x: number, y: number}}}>} */
  fork: async (input) => {
    await asSomeone()
    return call('library.fork', input)
  },
  /** A builder slate: a copy of a component to change, or an empty one (itemId 'new').
   *  @param {{itemId?: string, version?: number}} [input]
   *  @returns {Promise<{shareId: string, revision: number}>} */
  branch: async ({ itemId = 'new', version } = {}) => {
    await asSomeone()
    return call('library.branch', { itemId, ...(version && { version }) })
  },
  /** @param {{shareId: string, boardId?: string, itemId?: string, title: string, summary: string, category?: LibraryCategory, synonyms?: string[], description?: string}} input
   *  @returns {Promise<LibraryStatusResult>} */
  saveDraft: (input) => call('library.saveDraft', input),
  /** @param {{kind: LibraryKind, itemId?: string, shareId?: string, title?: string, summary?: string, description?: string, category?: LibraryCategory, synonyms?: string[], note?: string}} input
   *  @returns {Promise<LibraryStatusResult>} */
  submit: (input) => call('library.submit', input),
  /** @param {{itemId: string}} input @returns {Promise<LibraryStatusResult>} */
  withdraw: (input) => call('library.withdraw', input),
  /** @param {{itemId: string}} input @returns {Promise<{itemId: string, discarded: true}>} */
  discard: (input) => call('library.discard', input),
  /** @param {{itemId: string, message: string}} input @returns {Promise<{itemId: string, eventId: string}>} */
  comment: (input) => call('library.comment', input),
  review: {
    /** @param {{status?: 'waiting'|'submitted'|'in_review'|'changes_requested'|'rejected'|'published'|'all', kind?: LibraryKind, source?: 'migration', cursor?: string}} [input] */
    queue: (input) => call('library.review.queue', input),
    /** @param {{itemId: string}} input @returns {Promise<{itemId: string, reviewShareId: string, status: string, reviewStatus: string|null, version: number}>} */
    open: (input) => call('library.review.open', input),
    /** @param {{itemId: string, message: string, history?: Array<{role: 'user'|'assistant', text: string}>, mode?: 'save'|'preview'}} input
     *  @returns {Promise<{itemId: string, reply: string, proposal: {meta: object, edits: object[], check: string[]}, diff: {meta?: object, rules?: string[]}, kept?: boolean}>} */
    refine: (input) => call('library.review.refine', input),
    /** @param {{itemId: string, title?: string, summary?: string, description?: string, category?: LibraryCategory, synonyms?: string[]}} input */
    update: (input) => call('library.review.update', input),
    /** @param {{itemId: string, message?: string}} input @returns {Promise<{itemId: string, status: 'published', publishedVersion: number, url: string}>} */
    approve: (input) => call('library.review.approve', input),
    /** @param {{itemId: string, message: string}} input */
    requestChanges: (input) => call('library.review.requestChanges', input),
    /** @param {{itemId: string, message: string}} input */
    reject: (input) => call('library.review.reject', input),
    /** @param {{itemId: string, message: string}} input */
    unpublish: (input) => call('library.review.unpublish', input),
  },
}

export default libraryApi
export { libraryApi }
