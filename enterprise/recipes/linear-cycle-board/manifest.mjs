// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// LIN-L2 Cycle board and blockers (recipes catalog, wave 2): a team's current Linear cycle on the
// team's canvas for standup: a board with a card per issue in its status lane, a map of what is
// blocked and by whom (other teams' blockers framed by team), and how the cycle's scope moved since
// it started. One slate per cycle; a closed cycle's slate stays as it was. With the permission,
// moving a card on the board moves the issue in Linear (to the first status of that lane).
import { defineRecipe } from '../../common/recipes/manifest.mjs'

const ID = { type: 'string', pattern: '^[0-9a-f-]{8,64}$' }

export const manifest = defineRecipe({
  id: 'linear-cycle-board',
  version: 1,
  label: 'Cycle board from Linear',
  agentName: 'Cycle keeper',
  integration: 'linear',
  summary: 'Your team\'s current Linear cycle as a board for standup: each issue in its status lane, what is blocked and by whom, and what was added after the cycle started.',
  needs: { linear: ['read'] },
  triggers: [
    { kind: 'vendor', event: 'linear.issue', debounceMs: 120000, default: true },
    { kind: 'vendor', event: 'linear.cycle', debounceMs: 60000, default: true },
    { kind: 'schedule', cron: '30 3 * * *', default: true },
    { kind: 'manual' },
  ],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['teams'],
    properties: {
      teams: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: ID, title: 'Teams', 'x-slatebox-picker': 'linear-teams' },
      subIssues: { type: 'boolean', default: false, title: 'Sub-issues get their own cards' },
    },
  },
  inputSchema: null,
  outputs: [{ role: 'cycle', name: '{team} cycle {number} ({dates})', kind: 'board', component: 'team-board', per: 'cycle', folder: ['Cycles'] }],
  writes: [
    {
      kind: 'linear.update_item',
      scopeSchema: { type: 'object', additionalProperties: false, required: ['teams'], properties: { teams: { type: 'array', minItems: 1, items: ID }, fields: { type: 'array', items: { enum: ['state'] } } } },
      describe: (scope) => `Move an issue's status in Linear when its card moves on the cycle board, for ${(scope?.teams || []).length === 1 ? 'one team' : `${(scope?.teams || []).length} teams`}; never any other field`,
    },
  ],
  events: ['cycle.updated', 'cycle.blocked', 'cycle.scope_changed'],
  intercepts: ['graph.ready', 'output.ready', 'writeback.proposed'],
  cost: { class: 'low', tokensPerRun: [0, 0], vendorCallsPerRun: [1, 15] },
  idPrefix: 'lc',
})

export default manifest
