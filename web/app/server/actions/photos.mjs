// Photo notes from the phone app: slates.addPhoto takes a photo someone took or chose on their phone
// and adds it to a slate they may edit, as a picture note. It is the Slatebox mobile app's one write
// (the viewer token's slates:add-photo scope, server/oauth/viewer.mjs).
//   - Who may add: loadSlate(true), the edit check every other write makes. Read-only and comment-only
//     people are refused (403), a stranger learns nothing (404).
//   - What may be added: at most 8 MB as sent, a JPEG, PNG or WebP by its first bytes (never a GIF,
//     SVG, PDF or HEIC: 415), at most 60 photos per person per hour (429). The server cleans it
//     (server/common/photo-clean.mjs): upright, at most 2560 pixels, written again with no metadata, so
//     its GPS location is never stored.
//   - Where it is kept: the app's one file store (server/common/fileStore.js, the S3 bucket on Cloud,
//     the database at /files/ on a self-host), under the same names as the editor's uploads.
//   - How it lands: one add_nodes photo operation through the canvas save (canvasEdit), so revisions,
//     the save core and every open canvas drawing it live are the same as any other edit. The phone
//     app's own photos save (they are the person's, from Slatebox's own app); a personal token's are
//     an agent's suggestion until a person keeps them, as every agent's canvas edit is.
import { Buffer } from 'node:buffer'
import { photoNoteSize } from 'slateboxjs/operations'
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { canvasEdit, showAgent } from './slate-operations.mjs'

export const PHOTO_LIMITS = Object.freeze({
  // The photo as sent, before it is cleaned.
  maxBytes: 8 * 1024 * 1024,
  altLength: 300,
  perHour: 60,
})

// base64 of maxBytes is 4/3 as long; the schema leaves room for that, the handler checks the bytes.
const MAX_BASE64 = Math.ceil(PHOTO_LIMITS.maxBytes / 3) * 4
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** How many bytes a base64 text decodes to, without decoding it. */
export const base64Bytes = (text) => Math.floor((text.length * 3) / 4) - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0)

const TOO_LARGE = 'Photos must be under 8 MB.'

const service = (deps) => {
  if (!deps.photos) throw problem(503, 'unavailable', 'Photo notes are not available on this server.')
  return deps.photos
}

// The photo as sent, checked by its size before a byte of it is decoded.
function photoBytes(text) {
  if (typeof text !== 'string' || !text.length) throw problem(400, 'invalid_request', 'Send the photo as base64 in photo.')
  if (text.length > MAX_BASE64 + 4 || base64Bytes(text) > PHOTO_LIMITS.maxBytes) throw problem(413, 'photo_too_large', TOO_LARGE)
  if (text.length % 4 !== 0 || !BASE64.test(text)) throw problem(400, 'invalid_request', 'photo must be base64 (no data: prefix, no line breaks).')
  return Buffer.from(text, 'base64')
}

export const slatesAddPhoto = defineAction({
  id: 'slates.addPhoto',
  title: 'Add photo',
  description:
    'Add a photo to a slate you can edit, as a picture note. Send the photo as base64 (a JPEG, PNG or WebP, at most 8 MB; others are refused with 415, larger with 413). The server turns it upright, shrinks it to fit 2560 pixels and removes its metadata, its location included, before it is stored. center places the middle of the note (the middle of the person\'s screen, in canvas units); without it the note goes beside the slate\'s notes. The note is 320 on its longer side. At most 60 photos per person per hour (429). One save, like slates.applyOperations; mode "preview" stores nothing. Added by an agent with a personal token, the note is a live suggestion (202, outcome "suggested") for people on the slate to keep or discard.',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:add-photo',
  principals: ['person', 'agent'],
  mounts: { ddp: false, http: { method: 'POST', path: '/slates/{shareId}/photos', operationId: 'addPhotoNote' } },
  modes: ['save', 'preview'],
  idempotency: 'optional',
  // A photo of 8 MB is about 11 MB as base64 in the JSON body.
  bodyLimit: '12mb',
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      // No maxLength: a photo too large answers 413 (the handler counts its bytes); the body limit caps the request.
      photo: { type: 'string', minLength: 1, description: 'The photo, base64: a JPEG, PNG or WebP of at most 8 MB.' },
      alt: { type: 'string', maxLength: PHOTO_LIMITS.altLength, description: 'What the photo shows, for a screen reader.' },
      center: {
        type: 'object',
        description: 'Where the middle of the note goes, in canvas units: the middle of what the person is looking at.',
        properties: {
          x: { type: 'number', minimum: -1000000, maximum: 1000000 },
          y: { type: 'number', minimum: -1000000, maximum: 1000000 },
        },
        required: ['x', 'y'],
        additionalProperties: false,
      },
    },
    required: ['shareId', 'photo'],
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
      nodeId: { type: 'string', description: 'The photo note\'s id.' },
      url: { type: 'string', description: 'The stored photo\'s address.' },
      width: { type: 'integer', description: 'The stored photo\'s width in pixels.' },
      height: { type: 'integer', description: 'The stored photo\'s height in pixels.' },
      outcome: { type: 'string', enum: ['saved', 'suggested'], description: 'suggested: added by an agent with a personal token, the note is shown live on the slate for a person to keep or discard; nothing is saved yet.' },
      suggestion: { type: 'object', description: 'outcome suggested: the suggestion (actionId, items) as list_suggestions gives it.' },
      report: { type: 'object' },
    },
    required: ['ok', 'shareId', 'message', 'url', 'width', 'height'],
  },
  load: loadSlate(true),
  // Refused before the photo is read: one too large, or not base64.
  precheck(_principal, input) {
    photoBytes(input.photo)
  },
  async handler(principal, input, ctx) {
    const { deps, resource: slate } = ctx
    const photos = service(deps)
    const bytes = photoBytes(input.photo)
    if (!photos.limit.take(principal.userId)) throw problem(429, 'rate_limited', 'Too many photos added in the last hour. Try again later.')
    let cleaned
    try {
      cleaned = await photos.clean(bytes)
    } catch (error) {
      if (error?.name === 'PhotoRefused') throw problem(error.status, error.code, error.message)
      throw error
    }
    const preview = ctx.mode === 'preview'
    const stored = await photos.store({ userId: principal.userId, bytes: cleaned.bytes, type: cleaned.type, ext: cleaned.ext, dryRun: preview })
    const size = photoNoteSize(cleaned.width, cleaned.height)
    const at = input.center ? { x: Math.round(input.center.x - size.width / 2), y: Math.round(input.center.y - size.height / 2) } : null
    const photo = { url: stored.url, width: cleaned.width, height: cleaned.height, ...(input.alt?.trim() && { alt: input.alt.trim() }) }
    let result
    try {
      result = await canvasEdit(principal, {
        shareId: input.shareId,
        plan: { message: 'Added a photo.', operations: [{ kind: 'add_nodes', count: 1, photo, ...(at && at) }] },
        userMessage: 'Add photo',
        // Adding a note never conflicts, so it is made on the revision as read.
        expectedRevision: slate.revision ?? 0,
      }, ctx)
    } catch (error) {
      // Nothing points at a photo whose note was not saved.
      if (!preview) await photos.remove(stored.key).catch(() => {})
      throw error
    }
    const body = result.body
    // A personal token's agent shows its pointer on the new note; the phone app is the person, not an agent.
    if (!preview && result.status === 201 && principal.firstParty !== 'viewer') await showAgent(principal, slate, body, deps)
    return {
      status: result.status,
      body: {
        ok: true,
        mode: ctx.mode,
        shareId: body.shareId,
        revision: body.revision,
        message: body.message,
        nodeId: body.report?.created?.[0] ?? body.suggestion?.items?.find((item) => item.kind === 'add')?.nodeId,
        url: stored.url,
        width: cleaned.width,
        height: cleaned.height,
        ...(!preview && { outcome: body.outcome || 'saved' }),
        ...(body.suggestion && { suggestion: body.suggestion }),
        report: body.report,
      },
    }
  },
})

export default [slatesAddPhoto]
