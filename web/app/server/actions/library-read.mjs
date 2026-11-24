// The library's reads: public (published items, for anyone, cached) and the caller's own items.
import { defineAction } from './registry.mjs'
import { categoryInput, cursorInput, itemDetail, itemRef, itemSummary, kindInput, object, versionInput, versionOutput } from './library-schemas.mjs'
import { LIBRARY_STATUSES } from '../../imports/api/common/library-model.mjs'

const everyone = ['person', 'guest', 'agent', 'visitor']

export const libraryStats = defineAction({
  id: 'library.stats',
  title: 'Library counts',
  description:
    'How many published items the shared library holds: smart components (built in and from the community, and the total), slates, presentations, and items per category. Open to anyone.',
  toolset: 'library',
  kind: 'read',
  scope: 'slates:read',
  principals: everyone,
  mounts: { ddp: true, http: { method: 'GET', path: '/library/stats', operationId: 'getLibraryStats' } },
  publicCache: { maxAge: 300 },
  input: object({}),
  output: {
    type: 'object',
    properties: {
      components: { type: 'object', properties: { builtin: { type: 'integer' }, community: { type: 'integer' }, total: { type: 'integer' } } },
      slates: { type: 'integer' }, presentations: { type: 'integer' }, categories: { type: 'object' }, updatedAt: { type: 'string' },
    },
    required: ['components', 'slates', 'presentations', 'categories'],
  },
  tool: { name: 'get_library_stats', title: 'Count the library', description: 'Count the published smart components, slates and presentations in the shared library, and the items in each category.' },
  handler: (principal, _input, { deps }) => deps.library.stats(principal),
})

export const libraryExport = defineAction({
  id: 'library.export',
  title: 'Library export',
  description: 'Every published library item with its published version\'s content, 50 per page, oldest first: what the public gallery is built from.',
  toolset: 'library',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent', 'visitor'],
  mounts: { http: { method: 'GET', path: '/library/export', operationId: 'exportLibrary' } },
  publicCache: { maxAge: 120 },
  input: object({ cursor: cursorInput }),
  output: { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } }, next: { type: 'string' } }, required: ['items'] },
  tool: { name: 'export_library', title: 'Export the library', description: 'Read every published item of the shared library with its content, 50 per page.' },
  handler: (principal, input, { deps }) => deps.library.export(principal, input),
})

export const libraryMine = defineAction({
  id: 'library.mine',
  title: 'My library',
  description:
    'Your own library items, newest first: drafts, submissions waiting for review, items that need changes, published and not accepted ones, each with its status, the version waiting, the last message and the last 20 events of its thread.',
  toolset: 'library',
  kind: 'read',
  scope: 'slates:read',
  principals: ['person', 'guest', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/library/mine', operationId: 'listMyLibrary' } },
  input: object({ status: { type: 'string', enum: [...LIBRARY_STATUSES] } }),
  output: { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } }, required: ['items'] },
  tool: { name: 'list_my_library', title: 'List my library items', description: 'List the smart components, slates and presentations you saved or submitted to the shared library, with where each stands in review.' },
  handler: (principal, input, { deps }) => deps.library.mine(principal, input),
})

export const libraryList = defineAction({
  id: 'library.list',
  title: 'Library',
  description:
    'Published items of the shared library: smart components (boards that keep their rules: the ones built into Slatebox and the ones people built), slates and presentations anyone can copy. Filter by kind, category (plan, decide, meetings, track, map), origin (builtin or user) or words (q); sort new or popular. 24 per page by default (at most 48); pass next as cursor for more. Open to anyone.',
  toolset: 'library',
  kind: 'read',
  scope: 'slates:read',
  principals: everyone,
  mounts: { ddp: true, http: { method: 'GET', path: '/library', operationId: 'listLibrary' } },
  // What is taken out of the library leaves shared caches within a minute.
  publicCache: { maxAge: 60 },
  input: object({
    kind: kindInput,
    category: categoryInput,
    q: { type: 'string', minLength: 1, maxLength: 100 },
    sort: { type: 'string', enum: ['new', 'popular'], default: 'new' },
    origin: { type: 'string', enum: ['builtin', 'user'] },
    cursor: cursorInput,
    limit: { type: 'integer', minimum: 1, maximum: 48 },
  }),
  output: { type: 'object', properties: { items: { type: 'array', items: itemSummary }, next: { type: 'string' }, total: { type: 'integer' } }, required: ['items', 'total'] },
  tool: { name: 'list_library', title: 'Browse the library', description: 'Browse the shared Slatebox library: smart components (boards with rules, built in or made by people), slates and presentations anyone can copy, by kind, category or words.' },
  handler: (principal, input, { deps }) => deps.library.list(principal, input),
})

export const libraryGet = defineAction({
  id: 'library.get',
  title: 'Library item',
  description:
    'One library item by id or slug, with a version\'s content: a smart component\'s board (workshop, with its rules), or a slate\'s notes (and a presentation\'s deck). Anyone reads published items; an item\'s author and reviewers also read its drafts, every version and its review thread.',
  toolset: 'library',
  kind: 'read',
  scope: 'slates:read',
  principals: everyone,
  mounts: { ddp: true, http: { method: 'GET', path: '/library/{itemId}', operationId: 'getLibraryItem' } },
  // What is taken out of the library leaves shared caches within a minute.
  publicCache: { maxAge: 60 },
  input: object({ itemId: itemRef, version: versionInput }, ['itemId']),
  output: {
    type: 'object',
    properties: {
      item: itemDetail, version: versionOutput,
      thread: { type: 'array', items: { type: 'object' }, description: 'Its author and reviewers only: the review thread (every action and message), oldest first.' },
    },
    required: ['item', 'version'],
  },
  tool: { name: 'get_library_item', title: 'Read a library item', description: 'Read one item of the shared library in full: a smart component\'s board and rules, or a slate or presentation.' },
  handler: (principal, input, { deps }) => deps.library.get(principal, input),
})

// stats, export and mine before get: their routes are more specific than /library/{itemId}.
export default [libraryStats, libraryExport, libraryMine, libraryList, libraryGet]
