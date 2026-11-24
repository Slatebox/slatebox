// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Google as registry actions (google.*): each a Meteor method, an /api/v1 route and an exec call,
// with the same checks (Pro or Business on Cloud, the Google card on, the person's own Google). The
// sign-in itself (google.connect) is the app's own: a token cannot start or finish a Google sign-in.
// The Google Picker is browser-only: over exec or the API, importFile works on files Slatebox may
// already open (ones it made, or ones picked before).
import { defineAction } from '/server/actions/registry.mjs'
import { shareIdInput } from '/server/actions/slate-schemas.mjs'

const obj = (properties) => ({ type: 'object', properties })
const fileId = { type: 'string', minLength: 10, maxLength: 200, pattern: '^[A-Za-z0-9_-]+$', description: 'A Google Drive file id (from the Picker, or a file Slatebox made).' }
const png = { type: 'string', maxLength: 28 * 1024 * 1024, description: 'The slate\'s picture as a PNG data URL (data:image/png;base64,...).' }
const view = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', minimum: 40 }, height: { type: 'number', minimum: 40 } }, required: ['x', 'y', 'width', 'height'], additionalProperties: false, description: 'The part of the canvas you can see now: the suggestion lands there.' }

/** The actions, over a getter for the running Google service (set at server start). */
export function googleActions(service) {
  const run = (name) => async (principal, input) => ({ status: 200, body: await service()[name](principal, input) })
  const base = { toolset: 'connectors', principals: ['person', 'agent'] }
  return [
    defineAction({
      ...base,
      id: 'google.status',
      title: 'Google connection',
      description: 'Whether Google works on this server and for you: connected or not, the access Slatebox has (only files it made or you picked), and whether the Picker is ready. Never a token.',
      kind: 'read',
      scope: 'slates:read',
      mounts: { ddp: true, http: { method: 'GET', path: '/google', operationId: 'googleStatus' } },
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: obj({ enabled: { type: 'boolean' }, configured: { type: 'boolean' }, connected: { type: 'boolean' }, status: { type: 'string' }, account: { type: ['string', 'null'], description: 'The Google account connected (your own).' }, scopes: { type: 'array', items: { type: 'string' } }, pickerReady: { type: 'boolean' }, pro: { type: 'boolean' } }),
      handler: run('status'),
    }),
    defineAction({
      id: 'google.connect',
      title: 'Connect Google',
      description: 'Finish connecting Google from the app\'s own page: the one-time code Google gave this browser is exchanged on the server, and what Google issues is kept encrypted for you alone. People only. Needs Slatebox Pro or Business.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:write',
      principals: ['person'],
      mounts: { ddp: true },
      input: { type: 'object', properties: { code: { type: 'string', minLength: 8, maxLength: 2048, writeOnly: true } }, required: ['code'], additionalProperties: false },
      output: obj({ ok: { type: 'boolean' }, integrationId: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } } }),
      handler: run('connect'),
    }),
    defineAction({
      ...base,
      id: 'google.saveToDrive',
      title: 'Save a slate to Google Drive',
      description: 'Save a slate to your Google Drive, in a Slatebox folder: its picture (PNG or SVG), a PDF, or the slate file. Needs Slatebox Pro or Business and Google connected.',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:read',
      mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/google/drive', operationId: 'saveSlateToDrive' } },
      input: { type: 'object', properties: { shareId: shareIdInput, format: { type: 'string', enum: ['png', 'pdf', 'svg', 'slatebox'] }, data: { type: 'string', maxLength: 28 * 1024 * 1024, description: 'For png and pdf a data URL, for svg the SVG text; none for the slate file.' } }, required: ['shareId', 'format'], additionalProperties: false },
      output: obj({ fileId: { type: 'string' }, name: { type: 'string' }, webViewLink: { type: 'string' } }),
      handler: run('saveToDrive'),
    }),
    defineAction({
      ...base,
      id: 'google.exportDoc',
      title: 'Export a slate to Google Docs',
      description: 'Export a slate you can edit to a Google Doc: its title, each branch as a heading with its notes as bullets (links kept), and its picture. update: true writes over the last Doc you made from this slate. Needs Slatebox Pro or Business and Google connected.',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:read',
      mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/google/doc', operationId: 'exportSlateToDoc' } },
      input: { type: 'object', properties: { shareId: shareIdInput, image: png, update: { type: 'boolean' } }, required: ['shareId'], additionalProperties: false },
      output: obj({ documentId: { type: 'string' }, url: { type: 'string' }, updated: { type: 'boolean' }, picture: { type: 'boolean', description: 'Whether the slate\'s picture went in (Google must be able to fetch it from this server).' } }),
      handler: run('exportDoc'),
    }),
    defineAction({
      ...base,
      id: 'google.lastDoc',
      title: 'The last Google Doc made from a slate',
      description: 'The Google Doc you last made from this slate, so it can be updated instead of made again.',
      kind: 'read',
      scope: 'slates:read',
      mounts: { ddp: true, http: { method: 'GET', path: '/slates/{shareId}/google/doc', operationId: 'lastSlateDoc' } },
      input: { type: 'object', properties: { shareId: shareIdInput }, required: ['shareId'], additionalProperties: false },
      output: obj({ documentId: { type: ['string', 'null'] }, url: { type: ['string', 'null'] } }),
      handler: run('lastDoc'),
    }),
    defineAction({
      ...base,
      id: 'google.exportSlides',
      title: 'Export presentation frames to Google Slides',
      description: 'Make a Google Slides deck from a presentation on a slate you can edit: one slide per frame, with its title and picture. Needs Slatebox Pro or Business and Google connected.',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:read',
      mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/google/slides', operationId: 'exportSlidesToGoogle' } },
      input: { type: 'object', properties: { shareId: shareIdInput, slides: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: { title: { type: 'string', maxLength: 200 }, image: png }, additionalProperties: false } } }, required: ['shareId', 'slides'], additionalProperties: false },
      output: obj({ presentationId: { type: 'string' }, url: { type: 'string' }, slides: { type: 'integer' }, picture: { type: 'boolean' } }),
      handler: run('exportSlides'),
    }),
    defineAction({
      ...base,
      id: 'google.importFile',
      title: 'Bring a Google file onto a slate',
      description: 'Bring a Google Doc (headings become groups, paragraphs and bullets notes), a sheet (rows), a Slides deck or a text file onto a slate as one suggestion to keep or discard (one undo). Only files Slatebox may open: ones it made, or ones you picked in the Picker. Needs Slatebox Pro or Business and Google connected.',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:write',
      mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/google/import', operationId: 'importGoogleFile' } },
      input: { type: 'object', properties: { shareId: shareIdInput, fileId, view }, required: ['shareId', 'fileId'], additionalProperties: false },
      output: obj({ name: { type: 'string' }, actions: { type: 'array', items: { type: 'string' }, description: 'The suggestion, as suggestions.list gives it: keep, discard or undo it with suggestions.decide.' }, added: { type: 'object' } }),
      tool: { name: 'import_google_file', title: 'Bring a Google Doc, sheet or file onto a slate as a suggestion', description: 'Bring a Google Doc, sheet, deck or text file you picked onto a slate as notes to keep or discard.' },
      handler: run('importFile'),
    }),
    defineAction({
      ...base,
      id: 'google.slateFiles',
      title: 'Drive files picked for a slate',
      description: 'The Google Drive files you picked for this slate: the ones the Google Drive agent may read here.',
      kind: 'read',
      scope: 'slates:read',
      mounts: { ddp: true, http: { method: 'GET', path: '/slates/{shareId}/google/files', operationId: 'slateDriveFiles' } },
      input: { type: 'object', properties: { shareId: shareIdInput }, required: ['shareId'], additionalProperties: false },
      output: obj({ files: { type: 'array', items: { type: 'object' } } }),
      handler: run('slateFiles'),
    }),
    defineAction({
      ...base,
      id: 'google.attachFiles',
      title: 'Pick Drive files for a slate',
      description: 'Add Drive files (from the Picker) to the ones the Google Drive agent may read on this slate, or replace them. Ids, names and kinds only.',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      scope: 'slates:write',
      mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/google/files', operationId: 'attachSlateDriveFiles' } },
      input: {
        type: 'object',
        properties: {
          shareId: shareIdInput,
          files: { type: 'array', maxItems: 20, items: { type: 'object', properties: { id: fileId, name: { type: 'string', maxLength: 300 }, mimeType: { type: 'string', maxLength: 200 } }, required: ['id'], additionalProperties: false } },
          replace: { type: 'boolean' },
        },
        required: ['shareId', 'files'],
        additionalProperties: false,
      },
      output: obj({ files: { type: 'array', items: { type: 'object' } } }),
      handler: run('attachFiles'),
    }),
  ]
}
