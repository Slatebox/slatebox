// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// X2, the project index (recipes catalog, X2): one slate that lists every slate in the project, by
// folder, with when it last changed and which recipe keeps it, each note a link. No integration and
// no model: every hour, and Run now.
import { defineRecipe } from '../../common/recipes/manifest.mjs'

export const manifest = defineRecipe({
  id: 'project-index',
  version: 1,
  label: 'Project index',
  summary: 'One slate listing every slate in this project, newest first, with which agent keeps each.',
  agentName: 'Project librarian',
  integration: null,
  needs: {},
  triggers: [
    { kind: 'schedule', cron: '0 * * * *', default: true },
    { kind: 'manual' },
  ],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      stale: { type: 'integer', minimum: 7, maximum: 365, default: 30, description: 'Mark slates not changed in this many days.' },
    },
  },
  inputSchema: null,
  outputs: [{ role: 'index', name: 'Project index', kind: 'index' }],
  writes: [],
  events: [],
  intercepts: ['output.ready'],
  cost: { class: 'low', tokensPerRun: [0, 0], vendorCallsPerRun: [0, 0] },
  idPrefix: 'xi',
})
