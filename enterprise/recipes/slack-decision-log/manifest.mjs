// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// S1, the decision log (recipes catalog, wave 1 rank 4): every decision made in a channel's threads,
// on a lane board that is always current, each card linked to its thread.
import { defineRecipe } from '../../common/recipes/manifest.mjs'
import { channelsSchema, FOLD_TRIGGER, SLACK_READ_NEEDS, tzSchema } from '../_slack-ledger/config.mjs'

export const DECISION_LANES = Object.freeze([
  { key: 'maybe', label: 'Maybe' },
  { key: 'decided', label: 'Decided' },
  { key: 'revisited', label: 'Revisited' },
  { key: 'reversed', label: 'Reversed' },
])

export const manifest = defineRecipe({
  id: 'slack-decision-log',
  version: 1,
  label: 'Decision log',
  summary: 'Every decision made in the channels you pick, on a board that stays current: Decided, Revisited, Reversed and Maybe, each card linked to its thread.',
  agentName: 'Decision keeper',
  integration: 'slack',
  needs: { slack: SLACK_READ_NEEDS },
  triggers: [FOLD_TRIGGER, { kind: 'schedule', cron: '0 18 * * *', default: true }, { kind: 'manual' }],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['channels'],
    properties: {
      channels: channelsSchema,
      confidence: { type: 'number', minimum: 0.3, maximum: 1, default: 0.7, description: 'Below this, a decision goes to the Maybe lane.' },
      threadsOnly: { type: 'boolean', default: false, description: 'Read threads only, not top-level messages.' },
      deciders: { type: 'array', maxItems: 20, items: { type: 'string', pattern: '^[UW][A-Z0-9]{2,20}$' }, default: [], description: 'Only these people make decisions (empty: anyone).', 'x-picker': 'slack.user' },
      tz: tzSchema,
    },
  },
  inputSchema: null,
  outputs: [
    { role: 'decisions', name: 'Decision log — {channel}', kind: 'board', component: 'team-board', per: 'channel' },
    { role: 'archive', name: 'Decision log — {channel} — {month}', kind: 'board', component: 'team-board', per: 'channel-month', folder: ['Decision archive'] },
    { role: 'all', name: 'All decisions', kind: 'board', component: 'team-board' },
  ],
  writes: [],
  events: ['decision.recorded', 'decision.revisited', 'decision.reversed'],
  intercepts: ['output.ready'],
  cost: { class: 'low', tokensPerRun: [0, 18000], vendorCallsPerRun: [1, 40] },
  idPrefix: 'sd',
})
