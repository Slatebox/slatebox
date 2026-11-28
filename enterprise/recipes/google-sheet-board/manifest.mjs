// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// W1, the sheet-backed live board (recipes catalog, wave 1 rank 8): a picked Google Sheet drives an
// org chart, a kanban, a hiring plan, a pipeline or a timeline, without the data leaving the sheet.
// A changed cell changes that card; a new row adds one; a deleted row removes its card (or marks it
// removed when a person touched it). Optionally, moving a card writes its status back to the sheet.
import { defineRecipe } from '../../common/recipes/manifest.mjs'

export const SHEET_TEMPLATES = Object.freeze({
  'org-chart': { label: 'Org chart', required: ['name'], optional: ['title', 'manager', 'department', 'id', 'email'] },
  kanban: { label: 'Kanban', component: 'team-board', required: ['title', 'status'], optional: ['owner', 'due', 'id', 'group'] },
  'hiring-plan': { label: 'Hiring plan', component: 'hiring-plan', required: ['role', 'stage'], optional: ['count', 'start', 'owner', 'id', 'group'] },
  pipeline: { label: 'Pipeline', component: 'sales-pipeline', required: ['deal', 'stage'], optional: ['amount', 'owner', 'close', 'id', 'group'] },
  timeline: { label: 'Timeline', component: 'launch-plan', required: ['task', 'end'], optional: ['start', 'dependsOn', 'owner', 'id', 'group'] },
})
export const SHEET_COLUMNS = Object.freeze([...new Set(Object.values(SHEET_TEMPLATES).flatMap((t) => [...t.required, ...t.optional]))])
const FILE_ID = '^[A-Za-z0-9_-]{10,128}$'

export const manifest = defineRecipe({
  id: 'google-sheet-board',
  version: 1,
  label: 'Sheet-backed live board',
  summary: 'A Google Sheet you pick drives a live org chart, kanban, hiring plan, pipeline or timeline. Edit the sheet and the board follows.',
  agentName: 'Sheet sync',
  integration: 'google',
  needs: { google: ['drive.file'] },
  triggers: [{ kind: 'vendor', event: 'google.file_changed', debounceMs: 60000, default: true }, { kind: 'manual' }],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['fileId', 'template'],
    properties: {
      fileId: { type: 'string', pattern: FILE_ID, description: 'The sheet, picked with the Google Picker.', 'x-picker': 'google.sheet' },
      tab: { type: 'string', minLength: 1, maxLength: 100, description: 'The tab (the first one when empty).' },
      headerRow: { type: 'integer', minimum: 1, maximum: 50, default: 1 },
      template: { enum: Object.keys(SHEET_TEMPLATES) },
      columns: { type: 'object', additionalProperties: false, properties: Object.fromEntries(SHEET_COLUMNS.map((c) => [c, { type: 'string', minLength: 1, maxLength: 100 }])), description: 'Which header is which (proposed at setup; you confirm it).' },
      groupBy: { type: 'string', minLength: 1, maxLength: 100, description: 'Split into boards by this column when there are more cards than a board holds.' },
      winner: { enum: ['sheet', 'board'], default: 'sheet', description: 'When the sheet changes a card someone moved: the sheet wins, or the board.' },
    },
  },
  inputSchema: null,
  // The component is the template's (team-board for a kanban; an org chart is a tree of notes).
  outputs: [{ role: 'board', name: '{file} — {tab}', kind: 'board', component: 'team-board', components: ['team-board', 'hiring-plan', 'sales-pipeline', 'launch-plan'], per: 'tab' }],
  writes: [
    {
      kind: 'google.write_sheet',
      scopeSchema: { type: 'object', additionalProperties: false, required: ['fileId', 'columns'], properties: { fileId: { type: 'string', pattern: FILE_ID }, tab: { type: 'string' }, columns: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'string', pattern: '^[A-Z]{1,2}$' } } } },
      describe: (scope) => `Change only column ${(scope?.columns || ['?'])[0]} of the sheet you picked${scope?.tab ? ` (tab ${scope.tab})` : ''}, when a card moves on the board`,
    },
  ],
  events: ['sheet.synced', 'sheet.writeback.done'],
  intercepts: ['graph.ready', 'output.ready', 'writeback.proposed'],
  cost: { class: 'low', tokensPerRun: [0, 2000], vendorCallsPerRun: [2, 4] },
  idPrefix: 'gs',
})
