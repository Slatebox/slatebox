// Copy a slate the caller can open into a new private slate of theirs. The server builds the
// copy and stores it through the save core; no browser writes the slates collection.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { shareIdInput } from './slate-schemas.mjs'

// What belongs to the source, not to a copy: its identity, sharing, links, counters and history.
// `library` (a builder or review slate's mode) is the source's; `libraryOrigin` (the library item a
// slate was forked from) is not listed: it carries through every later copy, the provenance chain.
export const sourceOnly = ['_id', 'shareId', 'userId', 'orgId', 'created', 'lastSaved', 'revision', 'recentTouches',
  'sharingRevision', 'nativeConversationRevision', 'lastNativeCanvasProposal', 'livePresentation', 'archivedDate', 'library']
// The source's own sharing and search fields, and what belongs to its author's work on it: the
// AI conversation it started (welcomeAid) and the files attached to that conversation, and the
// Google Doc it was last exported to with that export's rendered images, and the slate as it was before
// its first style (styleOriginal: it may hold notes its author deleted since; a copy's original is the
// copy as made, kept when the copy first wears a style).
export const sourceOnlyOptions = ['url_name', 'accessKey', 'allowCollaboration', 'isSharing', 'searchName', 'searchDescription', 'searchText',
  'welcomeAid', 'uploadedFiles', 'lastSavedGoogleDocUrl', 'staticImage', 'staticImageTimestamp', 'staticFrameImage', 'styleOriginal']

// A copy is an ordinary slate: none of the retired template, community or featured flags, whatever its source had.
const templateOptions = ['isTemplate', 'templateApproved', 'templateMarkdown', 'templateTags', 'tags', 'basedOnTemplate', 'templateName', 'isCommunity', 'isFeatured']

/** The new slate's document, before the save core stores it. */
export function copyDocument(source, { id, shareId, user, now, name, libraryOrigin }) {
  const copy = structuredClone(source)
  for (const key of sourceOnly) delete copy[key]
  copy.options = { ...copy.options }
  for (const key of sourceOnlyOptions) delete copy.options[key]
  for (const key of templateOptions) delete copy.options[key]
  copy.nodes = Array.isArray(copy.nodes) ? copy.nodes : []
  if (copy.creative) copy.creative.revision = 0
  // Each further board starts over too (boards S4a): its revision from 0, without the source's Undo records
  // (which name the source's authors and revisions) or its trades, and the slate's counter for all boards
  // from 0. The board ids already given out (boardSeq) stay given out.
  if (copy.boards && typeof copy.boards === 'object') {
    for (const board of Object.values(copy.boards)) {
      if (!board || typeof board !== 'object') continue
      board.revision = 0
      delete board.undo
      delete board.trades
    }
  }
  if (copy.boardsRevision !== undefined) copy.boardsRevision = 0
  // A fork of a library item remembers it (and so does every later copy of the fork).
  if (libraryOrigin) copy.libraryOrigin = { ...libraryOrigin }
  if (name) copy.options.name = name
  Object.assign(copy.options, {
    id,
    // Sharing belongs to the source. The new owner shares the copy separately.
    isPrivate: true, isUnlisted: false, isPublic: false,
  })
  return {
    ...copy,
    _id: id,
    userId: user._id,
    ...(user.orgId && { orgId: user.orgId }),
    shareId,
    created: now,
    lastSaved: now,
  }
}

export default defineAction({
  id: 'slates.copy',
  title: 'Copy slate',
  description:
    'Make a private copy of a slate you may edit, a public slate, or a slate whose presentation is published publicly. Someone who may only view a private slate cannot copy it. The copy is an ordinary private slate. A published presentation of the slate is copied with it as a private presentation of the copy. To use something from the library, fork it (library.fork).',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['person', 'guest', 'agent'],
  // A retried copy answers the first copy instead of making another.
  idempotency: 'optional',
  // A token copies by its account's rule, the one the app applies (resolveSlateForUser).
  mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/copy', operationId: 'copySlate' } },
  tool: { name: 'copy_slate', title: 'Copy a slate', description: 'Make a private copy of a slate the person may edit, or of a public slate (such as a template to start from), and return the copy\'s id.' },
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      name: { type: 'string', minLength: 1, maxLength: 200 },
    },
    required: ['shareId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { shareId: { type: 'string' }, revision: { type: 'integer', minimum: 1 } },
    required: ['shareId', 'revision'],
  },
  async load(principal, input, { deps }) {
    const found = await deps.resolveSlateForUser(input.shareId, principal.userId)
    if (!found?.canRead) throw problem(404, 'not_found', 'Slate not found or unavailable.')
    const presentation = await deps.publishedPresentation(found.slate.shareId)
    // Who may copy: an editor (the owner and team admins included), anyone for a public slate or
    // a slate whose presentation is public. A view invitation alone has never allowed a copy.
    if (!found.canEdit && found.slate.options?.isPublic !== true && presentation?.isPublic !== true)
      throw problem(404, 'not_found', 'Slate not found or unavailable.')
    return { source: found.slate, presentation }
  },
  async handler(principal, input, { deps, now, resource: { source, presentation } }) {
    const user = await deps.loadUser(principal.userId)
    if (!user) throw problem(404, 'not_found', 'Slate not found or unavailable.')
    const shareId = await deps.generateShareId()
    const id = deps.newId()
    const row = copyDocument(source, {
      id, shareId, user, now: now(),
      name: input.name,
    })
    const made = await deps.saveCore.create({ row, actor: principal, source: 'copy' })
    // A slate's published presentation goes with it, as a private presentation of the copier's. A
    // workshop's presentation is a snapshot of its own workshop and is copied by its own route.
    if (presentation && !presentation.workshop)
      await deps.copyPresentation(presentation, { shareId, sourceShareId: source.shareId, user, now: now() })
    return { shareId, revision: made.revision }
  },
})
