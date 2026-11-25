// The library's writes for everyone: use an item (fork it, or add a component to a slate), branch
// a component into a builder slate, save and submit your own, withdraw, discard, and write in an
// item's thread. None of it is charged.
import { defineAction } from './registry.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { integrationInputs, itemRef, kindInput, messageInput, metaInputs, object, statusOutput, versionInput } from './library-schemas.mjs'

const write = { kind: 'write', toolset: 'library', idempotency: 'optional', replay: 'stored' }

export const libraryFork = defineAction({
  ...write,
  id: 'library.fork',
  title: 'Use a library item',
  description:
    'Use a library item: a slate or presentation becomes a new private slate of yours (a presentation with its deck), and a smart component goes onto a new slate, or beside the boards of a slate you can edit (targetShareId; a slate holds up to 8 boards, past that 409 component_opens_new_slate; an agent gets 423 agents_paused while people there paused agents). The copy remembers where it came from. Preview first to see the board and where it goes (canvas); save makes it. topic names the board ("Retro: Q3 launch").',
  scope: 'slates:write',
  principals: ['person', 'guest', 'agent'],
  modes: ['save', 'preview'],
  mounts: { ddp: true, http: { method: 'POST', path: '/library/{itemId}/fork', operationId: 'forkLibraryItem' } },
  input: object({
    itemId: itemRef,
    version: versionInput,
    name: { type: 'string', minLength: 1, maxLength: 200, description: 'The new slate\'s name (the item\'s title by default).' },
    targetShareId: { ...shareIdInput, description: 'A smart component only: the slate to add it to (one you can edit).' },
    expectedRevision: { type: 'integer', minimum: 0, description: 'With targetShareId: the slate revision you read; a slate changed since is refused with 409 slate_changed.' },
    topic: { type: 'string', minLength: 1, maxLength: 100, description: 'A smart component only: what it is about, which names its board.' },
  }, ['itemId']),
  output: {
    type: 'object',
    properties: {
      shareId: { type: ['string', 'null'], description: 'The slate it went to (null in a preview that would make a new slate).' },
      revision: { type: 'integer' }, boardId: { type: 'string' }, itemId: { type: 'string' }, version: { type: 'integer' },
      canvas: { type: 'object', description: 'A component preview: { workshop, origin } as the canvas draws it.' },
      name: { type: 'string' }, notes: { type: 'integer' },
    },
    required: ['shareId', 'itemId', 'version'],
  },
  tool: { name: 'use_library_item', title: 'Use a library item', description: 'Copy a slate or presentation from the shared library into a new private slate, or add a smart component (a board with rules, such as a retro) to a new slate or beside the boards of one you can edit.' },
  handler: (principal, input, { deps, mode }) => deps.library.fork(principal, input, { mode }),
})

export const libraryBranch = defineAction({
  ...write,
  id: 'library.branch',
  title: 'Branch off a component',
  description:
    'Start building a smart component on a new private slate (a builder slate): a copy of a library component to change (itemId), or an empty one (itemId "new"). Grow it by chat and with the controls on the board, then library.saveDraft and library.submit. A branch keeps its parent\'s category.',
  scope: 'slates:write',
  principals: ['person', 'guest', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/library/{itemId}/branch', operationId: 'branchLibraryComponent' } },
  input: object({ itemId: { ...itemRef, description: 'The component to branch off, or "new" for an empty builder slate.' }, version: versionInput }, ['itemId']),
  output: { type: 'object', properties: { shareId: { type: 'string' }, revision: { type: 'integer' } }, required: ['shareId'] },
  tool: { name: 'branch_library_component', title: 'Branch off a smart component', description: 'Start your own smart component on a new slate: a copy of one from the library to change, or an empty one (itemId "new").' },
  handler: (principal, input, { deps }) => deps.library.branch(principal, input),
})

export const librarySaveDraft = defineAction({
  ...write,
  id: 'library.saveDraft',
  title: 'Save a component',
  description:
    'Save the board of your builder slate (library.branch) as your own smart component, private to you: you can add it to any slate at once. The first save makes the item; later saves update it (itemId, or the builder slate remembers it). A component needs a category before it is submitted; a branch keeps its parent\'s (another is refused with 409 category_locked).',
  scope: 'slates:write',
  principals: ['person', 'guest', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/library/drafts', operationId: 'saveLibraryDraft' } },
  input: object({
    shareId: shareIdInput,
    boardId: { type: 'string', pattern: '^[a-z0-9]{1,12}$', description: 'The board on the builder slate (main by default).' },
    itemId: itemRef,
    ...metaInputs,
  }, ['shareId', 'title', 'summary']),
  output: statusOutput,
  tool: { name: 'save_library_draft', title: 'Save a smart component', description: 'Save the board on your builder slate as your own smart component, private to you, with a name, a one-line summary and a category.' },
  handler: (principal, input, { deps }) => deps.library.saveDraft(principal, input),
})

export const librarySubmit = defineAction({
  ...write,
  id: 'library.submit',
  title: 'Submit to the library',
  description:
    'Send something of yours for review, to be published in the shared library: a smart component you saved (itemId), a slate you own or administer (shareId; kind presentation sends its deck too), or a custom MCP server you connected (kind integration, integrationId: approved, it is offered to everyone in Connect an integration; its address and words become public, never your sign-in). Once approved anyone can find, use and change it, shared under CC BY 4.0. Sending a published item again proposes an update; the published version stays until the update is approved. Up to 10 a day. A guest must sign up first (403 sign_in_to_publish). The person agrees first.',
  scope: 'slates:share',
  principals: ['person', 'guest', 'agent'],
  confirm: true,
  mounts: { ddp: true, http: { method: 'POST', path: '/library/submissions', operationId: 'submitToLibrary' } },
  input: object({
    kind: kindInput,
    itemId: itemRef,
    shareId: shareIdInput,
    ...metaInputs,
    ...integrationInputs,
    note: { ...messageInput, description: 'A note for the reviewer: the first message of the item\'s thread.' },
  }, ['kind']),
  output: statusOutput,
  tool: { name: 'submit_to_library', title: 'Submit to the library', description: 'Send your smart component, slate or presentation for review, to be published in the shared library for anyone to use. The person agrees first.' },
  handler: (principal, input, { deps }) => deps.library.submit(principal, input),
})

export const libraryWithdraw = defineAction({
  ...write,
  id: 'library.withdraw',
  title: 'Withdraw',
  description: 'Take back your submission before it is reviewed (it is a draft again), or take your published item out of the library (copies people made stay theirs).',
  // It never widens who sees anything (slates:share would hold it for a yes as if it did).
  scope: 'slates:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/library/{itemId}/withdraw', operationId: 'withdrawLibraryItem' } },
  input: object({ itemId: itemRef }, ['itemId']),
  output: statusOutput,
  tool: { name: 'withdraw_library_item', title: 'Withdraw a library item', description: 'Take back your library submission before review, or take your published item out of the library.' },
  handler: (principal, input, { deps }) => deps.library.withdraw(principal, input),
})

export const libraryDiscard = defineAction({
  ...write,
  id: 'library.discard',
  title: 'Discard a draft',
  description: 'Delete your own draft library item (never submitted, or withdrawn). Its builder slate stays.',
  scope: 'slates:write',
  principals: ['person', 'guest', 'agent'],
  destructive: true,
  mounts: { ddp: true, http: { method: 'DELETE', path: '/library/{itemId}', operationId: 'discardLibraryDraft' } },
  input: object({ itemId: itemRef }, ['itemId']),
  output: { type: 'object', properties: { itemId: { type: 'string' }, discarded: { type: 'boolean' } }, required: ['itemId', 'discarded'] },
  tool: { name: 'discard_library_draft', title: 'Discard a library draft', description: 'Delete one of your own draft library items.' },
  handler: (principal, input, { deps }) => deps.library.discard(principal, input),
})

export const libraryComment = defineAction({
  ...write,
  id: 'library.comment',
  title: 'Write in the thread',
  description: 'Write in a library item\'s review thread: its author and the reviewers read it.',
  scope: 'slates:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/library/{itemId}/comments', operationId: 'commentOnLibraryItem' } },
  input: object({ itemId: itemRef, message: messageInput }, ['itemId', 'message']),
  output: { type: 'object', properties: { itemId: { type: 'string' }, eventId: { type: 'string' } }, required: ['itemId', 'eventId'] },
  tool: { name: 'comment_on_library_item', title: 'Write in a library thread', description: 'Write to the reviewer (or, as a reviewer, to the author) in a library item\'s thread.' },
  handler: (principal, input, { deps }) => deps.library.comment(principal, input),
})

export default [libraryFork, libraryBranch, librarySaveDraft, librarySubmit, libraryWithdraw, libraryDiscard, libraryComment]
