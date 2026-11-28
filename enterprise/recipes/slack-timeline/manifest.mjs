// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// S3, the project timeline (recipes catalog, wave 1 rank 5): the dates people commit to in a channel
// on a launch plan (up to 12 tasks, owners, due dates, "after X"), and every commitment on a board of
// Open, Done and Slipped. A later message that moves a date moves the task and shows the slip.
import { defineRecipe } from '../../common/recipes/manifest.mjs'
import { channelsSchema, FOLD_TRIGGER, SLACK_READ_NEEDS, tzSchema } from '../_slack-ledger/config.mjs'

export const COMMITMENT_LANES = Object.freeze([
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
  { key: 'slipped', label: 'Slipped' },
])

export const manifest = defineRecipe({
  id: 'slack-timeline',
  version: 1,
  label: 'Project timeline',
  summary: 'The dates people commit to in your channels, on a launch plan with owners and due dates, and a board of every commitment. A moved date shows the slip.',
  agentName: 'Timeline keeper',
  integration: 'slack',
  needs: { slack: SLACK_READ_NEEDS },
  triggers: [FOLD_TRIGGER, { kind: 'manual' }],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['channels'],
    properties: {
      channels: channelsSchema,
      pastDays: { type: 'integer', minimum: 0, maximum: 90, default: 14, description: 'Show tasks due this many days back.' },
      futureDays: { type: 'integer', minimum: 7, maximum: 365, default: 60, description: 'Show tasks due this many days ahead.' },
      lanes: { type: 'array', maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 40 }, default: [], description: 'Milestone lanes, e.g. Backend, Payments, Launch (empty: from the channel\'s most used terms).' },
      tz: tzSchema,
    },
  },
  inputSchema: null,
  outputs: [{ role: 'timeline', name: 'Timeline — {channel}', kind: 'board', component: 'launch-plan', per: 'channel' }],
  writes: [],
  events: ['timeline.date_changed', 'timeline.slipped', 'timeline.done'],
  intercepts: ['output.ready'],
  cost: { class: 'low', tokensPerRun: [0, 18000], vendorCallsPerRun: [1, 40] },
  idPrefix: 'st',
})
