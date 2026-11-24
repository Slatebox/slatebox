// The library's review, for administrators of this server (the library:review permission on a
// token, and an administrator's account behind it): the queue, a private review copy of each
// submission, refinement by chat, direct edits, and the decisions. Every decision writes one event.
import { defineAction } from './registry.mjs'
import { cursorInput, itemDetail, itemRef, kindInput, messageInput, metaInputs, object, requireReviewer, statusOutput } from './library-schemas.mjs'

const review = {
  toolset: 'library',
  scope: 'library:review',
  principals: ['person', 'agent'],
  precheck: requireReviewer,
  load: requireReviewer,
}
const write = { ...review, kind: 'write', idempotency: 'optional', replay: 'stored' }
// Another administrator reviews what you submit; a server with one administrator says so here (recorded).
const selfReview = { type: 'boolean', description: 'Review your own submission. Allowed only on a server with one administrator; the thread records it.' }

export const reviewQueue = defineAction({
  ...review,
  id: 'library.review.queue',
  title: 'Review queue',
  description:
    'For administrators: library items to review, oldest first: waiting (submitted and changes requested, the default), in_review, changes_requested, rejected, published or all. Each with its author, kind, the version waiting, whether it updates a published item, how long it has waited and the last message. source migration lists the slates moved from Community slates.',
  kind: 'read',
  mounts: { ddp: true, http: { method: 'GET', path: '/library/review', operationId: 'listLibraryQueue' } },
  input: object({
    status: { type: 'string', enum: ['waiting', 'submitted', 'in_review', 'changes_requested', 'rejected', 'published', 'all'], default: 'waiting' },
    kind: kindInput,
    source: { type: 'string', enum: ['migration'] },
    cursor: cursorInput,
  }),
  output: { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } }, next: { type: 'string' }, total: { type: 'integer' } }, required: ['items', 'total'] },
  tool: { name: 'list_library_queue', title: 'List library submissions', description: 'For administrators: list the library submissions waiting for review, oldest first.' },
  handler: (principal, input, { deps }) => deps.library.review.queue(principal, input),
})

export const reviewOpen = defineAction({
  ...write,
  id: 'library.review.open',
  title: 'Open for review',
  description:
    'For administrators: make (or refresh) your private review copy of a submission\'s waiting version, a slate you can change on the canvas, and mark it in review. Approving publishes that copy as it stands. Opening again for the same version answers the same copy.',
  mounts: { ddp: true, http: { method: 'POST', path: '/library/review/{itemId}/open', operationId: 'openLibraryReview' } },
  input: object({ itemId: itemRef, selfReview }, ['itemId']),
  output: { type: 'object', properties: { itemId: { type: 'string' }, reviewShareId: { type: 'string' }, status: { type: 'string' }, reviewStatus: { type: ['string', 'null'] }, version: { type: 'integer' } }, required: ['itemId', 'reviewShareId'] },
  tool: { name: 'open_library_review', title: 'Open a library submission', description: 'For administrators: open a library submission for review as a private copy you can change on the canvas.' },
  handler: (principal, input, { deps }) => deps.library.review.open(principal, input),
})

export const reviewRefine = defineAction({
  ...write,
  id: 'library.review.refine',
  title: 'Refine by chat',
  description:
    'For administrators: ask for a change to an item in review in plain words ("rename it to Weekly retro", "put it in Meetings", "Write a clearer one-line summary", "What should I check?"). Preview answers the proposal (metadata from and to, rule lines for a component\'s board, things to check) and its previewId; save with that previewId keeps exactly it, on the item and on the review copy. Simple renames, categories and summaries are read without AI.',
  modes: ['save', 'preview'],
  mounts: { ddp: true, http: { method: 'POST', path: '/library/review/{itemId}/refine', operationId: 'refineLibraryItem' } },
  input: object({
    itemId: itemRef,
    message: messageInput,
    selfReview,
    previewId: { type: 'string', maxLength: 64, description: 'Save: the previewId a preview answered. Keeps exactly that proposal (no second AI answer).' },
    history: { type: 'array', maxItems: 6, items: { type: 'object', properties: { role: { type: 'string', enum: ['user', 'assistant'] }, text: { type: 'string', maxLength: 2000 } }, required: ['role', 'text'], additionalProperties: false } },
  }, ['itemId', 'message']),
  output: {
    type: 'object',
    properties: { itemId: { type: 'string' }, reply: { type: 'string' }, proposal: { type: 'object' }, diff: { type: 'object' }, previewId: { type: 'string' }, kept: { type: 'boolean' }, revision: { type: 'integer' } },
    required: ['itemId', 'reply'],
  },
  tool: { name: 'refine_library_item', title: 'Refine a library submission', description: 'For administrators: change a library submission in review by asking in plain words; preview the change, then keep it.' },
  // When the AI fails (a provider error, an answer that could not be read), the reviewer is told so in
  // plain words, with the changes that need no AI, instead of a bare "could not be completed".
  failure: { code: 'refine_failed', message: 'The AI could not answer just now. Ask again, or say the change itself: "rename it to …", "put it in Decide", "summary: …".' },
  handler: (principal, input, { deps, mode }) => deps.library.review.refine(principal, input, { mode }),
})

export const reviewUpdate = defineAction({
  ...write,
  id: 'library.review.update',
  title: 'Edit details',
  description: 'For administrators: change a library item\'s title, summary, description, category or search words directly. A branch\'s category stays its parent\'s.',
  mounts: { ddp: true, http: { method: 'PATCH', path: '/library/review/{itemId}', operationId: 'updateLibraryItem' } },
  input: object({ itemId: itemRef, ...metaInputs, selfReview }, ['itemId']),
  output: { type: 'object', properties: { item: itemDetail }, required: ['item'] },
  tool: { name: 'update_library_item', title: 'Edit a library item\'s details', description: 'For administrators: change a library item\'s title, summary, description, category or search words.' },
  handler: (principal, input, { deps }) => deps.library.review.update(principal, input),
})

export const reviewApprove = defineAction({
  ...write,
  id: 'library.review.approve',
  title: 'Approve and publish',
  description:
    'For administrators: publish an item in review as its review copy stands now (your refinements included), as the version its author sent. Anyone can then find, use and change it. The author is told. The person agrees first.',
  confirm: true,
  mounts: { ddp: true, http: { method: 'POST', path: '/library/review/{itemId}/approve', operationId: 'approveLibraryItem' } },
  input: object({ itemId: itemRef, message: messageInput, selfReview }, ['itemId']),
  output: { type: 'object', properties: { itemId: { type: 'string' }, status: { type: 'string' }, publishedVersion: { type: 'integer' }, publishedCount: { type: 'integer', description: 'How many times it has been published, this time included (1 the first time).' }, url: { type: 'string' } }, required: ['itemId', 'status', 'publishedVersion'] },
  tool: { name: 'approve_library_item', title: 'Approve a library submission', description: 'For administrators: publish a library submission in review, as its review copy stands. The person agrees first.' },
  handler: (principal, input, { deps }) => deps.library.review.approve(principal, input),
})

const decision = (id, verb, path, operationId, toolName, toolTitle, description, extra = {}) => defineAction({
  ...write,
  ...extra,
  id,
  title: toolTitle,
  description,
  mounts: { ddp: true, http: { method: 'POST', path, operationId } },
  input: object({ itemId: itemRef, message: { ...messageInput, description: `Why: the author reads it.` } }, ['itemId', 'message']),
  output: statusOutput,
  tool: { name: toolName, title: toolTitle, description: `For administrators: ${verb}, with a message the author reads.` },
  handler: (principal, input, { deps }) => deps.library.review[id.split('.').pop()](principal, input),
})

export const reviewRequestChanges = decision('library.review.requestChanges', 'send a library submission back for changes',
  '/library/review/{itemId}/changes', 'requestLibraryChanges', 'request_library_changes', 'Request changes',
  'For administrators: send an item in review back to its author for changes, with a message saying what to change.')
export const reviewReject = decision('library.review.reject', 'turn down a library submission',
  '/library/review/{itemId}/reject', 'rejectLibraryItem', 'reject_library_item', 'Reject',
  'For administrators: turn down a submission, with a message saying why. A published item\'s rejected update leaves the published version as it is.')
export const reviewUnpublish = decision('library.review.unpublish', 'take a published item out of the library',
  '/library/review/{itemId}/unpublish', 'unpublishLibraryItem', 'unpublish_library_item', 'Unpublish',
  'For administrators: take a published item out of the library, with a message saying why. Copies people already made stay theirs.',
  { destructive: true })

// The queue first: GET /library/review is more specific than GET /library/{itemId}.
export default [reviewQueue, reviewOpen, reviewRefine, reviewUpdate, reviewApprove, reviewRequestChanges, reviewReject, reviewUnpublish]
