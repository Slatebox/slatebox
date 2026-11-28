// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// W2, design doc to diagram (recipes catalog, wave 1 rank 9): each picked Google Doc mirrored as a
// slate that stays current as the doc changes: its Mermaid blocks drawn (a frame each), its headings
// as a doc map, its components tables as notes, every note linked back to its heading. A doc with no
// diagram gets one drafted by the agent from its text, redrawn only when the text really changes.
import { defineRecipe } from '../../common/recipes/manifest.mjs'

export const manifest = defineRecipe({
  id: 'google-design-doc',
  version: 1,
  label: 'Design doc to diagram',
  summary: 'Each design doc you pick, mirrored as a slate: its Mermaid diagrams, its outline and its components, each note linked back to its section.',
  agentName: 'Design doc reader',
  integration: 'google',
  needs: { google: ['drive.file'] },
  triggers: [{ kind: 'vendor', event: 'google.file_changed', debounceMs: 120000, default: true }, { kind: 'manual' }],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['fileIds'],
    properties: {
      fileIds: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,128}$' }, description: 'The design docs, picked with the Google Picker.', 'x-picker': 'google.doc' },
      headings: { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 120 }, default: [], description: 'Only diagram these sections (empty: the whole doc).' },
      draft: { type: 'boolean', default: true, description: 'Let the agent draft a diagram for a doc that has none.' },
    },
  },
  inputSchema: null,
  outputs: [{ role: 'design', name: 'Design — {doc}', kind: 'diagram', per: 'doc' }],
  writes: [],
  events: ['design_doc.updated', 'design_doc.drift'],
  intercepts: ['graph.ready', 'output.ready'],
  cost: { class: 'medium', tokensPerRun: [0, 13000], vendorCallsPerRun: [2, 40] },
  idPrefix: 'gd',
})
