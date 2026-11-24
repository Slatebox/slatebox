// Video notes for people, exec, agents and the API: one lookup and one add, with the same checks
// on every surface. media.lookup reads a YouTube, Vimeo or Loom address and answers the video with
// its title and a poster stored in the app's own image store (server/media/media-lookup.mjs);
// the canvas uses it when someone pastes or drops a video address, then adds the note itself.
// slates.addMedia does both in one call and saves the note through slates.applyOperations' canvas
// path (applyToCanvas), so revisions, permissions, presence and the save core are the same as
// any other edit, and every open canvas draws it.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { applyToCanvas, showAgent } from './slate-operations.mjs'

const urlInput = { type: 'string', minLength: 1, maxLength: 2000, description: 'The video\'s address: a YouTube, Vimeo or Loom link.' }

export const mediaOut = {
  type: 'object',
  description: 'A video a media note plays: the address, the host, and the title and poster when the host shared them.',
  properties: {
    provider: { type: 'string', enum: ['youtube', 'vimeo', 'loom'] },
    id: { type: 'string' },
    url: { type: 'string', description: 'The canonical watch address.' },
    hash: { type: 'string' },
    start: { type: 'integer', description: 'Where it starts, in seconds.' },
    title: { type: 'string' },
    author: { type: 'string' },
    poster: { type: 'string', description: 'The poster picture, in this app\'s image store.' },
    posterWidth: { type: 'integer' },
    posterHeight: { type: 'integer' },
  },
  required: ['provider', 'id', 'url'],
}

const service = (deps) => {
  if (!deps.media) throw problem(503, 'unavailable', 'Video notes are not available on this server.')
  return deps.media
}

async function lookup(principal, url, deps, { store = true } = {}) {
  try {
    return await service(deps)(url, { subject: principal.userId || principal.tokenId || 'anyone', store })
  } catch (error) {
    if (error?.name === 'MediaRefused') throw problem(error.status, error.code, error.message)
    throw error
  }
}

export const mediaLookup = defineAction({
  id: 'media.lookup',
  title: 'Video info',
  description:
    'Read a YouTube, Vimeo or Loom address: the video\'s host, id, canonical address, start time, title and author, and its poster picture stored in this app (so people\'s browsers reach the video host only when they press play). Pass the answer as media in an add_nodes operation (count 1), or call slates.addMedia to look up and add in one step. When the host shares no title or picture the video still comes back, with a notice. Any other address is refused with 400 not_a_video. At most 60 new videos per person per hour.',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['person', 'guest', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/media/lookup', operationId: 'lookupMedia' } },
  // It changes no slate, but it stores the poster in the app's image store and reaches the
  // video host (openWorld), so it is not read-only.
  changesNoSlate: true,
  openWorld: true,
  // The same address looks up the same video (the poster is stored under one name per video).
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  input: {
    type: 'object',
    properties: { url: urlInput },
    required: ['url'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      media: mediaOut,
      found: { type: 'boolean', description: 'False when the host shared nothing about the video (private, removed, or not answering).' },
      notice: { type: 'string' },
    },
    required: ['media', 'found'],
  },
  tool: { name: 'lookup_media', title: 'Look up a video', description: 'Read a YouTube, Vimeo or Loom link: its title, author and a stored poster, ready for a video note.' },
  async handler(principal, input, { deps }) {
    return lookup(principal, input.url, deps)
  },
})

export const slatesAddMedia = defineAction({
  id: 'slates.addMedia',
  title: 'Add video',
  description:
    'Add a video note to a slate from a YouTube, Vimeo or Loom address: the poster (stored in this app), a play button, and the title and host. It plays where it sits when someone presses play, never on its own, and plays inline in presentations. x and y place its top-left corner (320 by 180); without them it goes beside the slate\'s notes. One save, like slates.applyOperations; mode "preview" stores nothing.',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/media', operationId: 'addMediaNote' } },
  // Not openWorld: it reads the video's title and poster from the address the caller gave (as
  // media.lookup does) and sends nothing from the slate anywhere, so the exec gate treats it as an
  // additive edit of the caller's slate, not as a call that widens who sees the slate.
  modes: ['save', 'preview'],
  idempotency: 'optional',
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      url: urlInput,
      x: { type: 'number', minimum: -1000000, maximum: 1000000, description: 'The note\'s left edge, in canvas units. Send with y.' },
      y: { type: 'number', minimum: -1000000, maximum: 1000000, description: 'The note\'s top edge, in canvas units. Send with x.' },
    },
    required: ['shareId', 'url'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      mode: { type: 'string' },
      shareId: { type: 'string' },
      revision: { type: 'integer' },
      message: { type: 'string' },
      nodeId: { type: 'string', description: 'The video note\'s id.' },
      media: mediaOut,
      notice: { type: 'string' },
      report: { type: 'object' },
    },
    required: ['ok', 'shareId', 'message', 'media'],
  },
  load: loadSlate(true),
  // Refused before anything is fetched: an address that is not a video, half a position.
  precheck(_principal, input) {
    if ((input.x === undefined) !== (input.y === undefined)) throw problem(400, 'invalid_request', 'Send x and y together, or neither.')
  },
  tool: { name: 'add_media_note', title: 'Add a video note', description: 'Add a YouTube, Vimeo or Loom video to a slate as a note that shows its poster and plays in place when pressed.' },
  async handler(principal, input, ctx) {
    if ((input.x === undefined) !== (input.y === undefined)) throw problem(400, 'invalid_request', 'Send x and y together, or neither.')
    const { deps, resource: slate } = ctx
    const found = await lookup(principal, input.url, deps, { store: ctx.mode !== 'preview' })
    const { media } = found
    const name = media.title ? `"${media.title.slice(0, 80)}"` : 'a video'
    const operation = { kind: 'add_nodes', count: 1, media, ...(input.x !== undefined && { x: input.x, y: input.y }) }
    const result = await applyToCanvas(principal, {
      shareId: input.shareId,
      plan: { message: `Added ${name}.`, operations: [operation] },
      userMessage: `Add video: ${input.url}`.slice(0, 200),
      // Adding a note never conflicts, so it is made on the revision as read.
      expectedRevision: slate.revision ?? 0,
    }, ctx)
    const body = result.body
    // Everyone on the slate sees the agent that added it: its pointer goes to the new note.
    if (ctx.mode === 'save' && result.status === 201) await showAgent(principal, slate, body, deps)
    return {
      status: result.status,
      body: {
        ok: true,
        mode: ctx.mode,
        shareId: body.shareId,
        revision: body.revision,
        message: body.message,
        nodeId: body.report?.created?.[0],
        media,
        ...(found.notice && { notice: found.notice }),
        report: body.report,
      },
    }
  },
})

export default [mediaLookup, slatesAddMedia]
