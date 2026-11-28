// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// S2, the concept map (recipes catalog, wave 1 rank 6): a channel's vocabulary ("PSP", "3DS2", "soft
// decline") as a mind map, the channel at the center, related terms clustered, each term linked to
// the message that first defined it. For people joining a project mid-flight.
import { defineRecipe } from '../../common/recipes/manifest.mjs'
import { channelsSchema, teamIdSchema, SLACK_READ_NEEDS, tzSchema } from '../_slack-ledger/config.mjs'

export const manifest = defineRecipe({
  id: 'slack-concepts',
  version: 1,
  label: 'Concept map',
  summary: "Your channels' vocabulary as a mind map: each term, what it means, the terms it goes with, and a link to the message that defined it.",
  agentName: 'Glossary keeper',
  integration: 'slack',
  needs: { slack: SLACK_READ_NEEDS },
  triggers: [
    { kind: 'schedule', cron: '0 8 * * 1', default: true },
    // New messages: the map is redrawn once 10 new terms are in the ledger (6-hour debounce).
    { kind: 'vendor', event: 'slack.message', debounceMs: 6 * 3600000, default: true },
    { kind: 'manual' },
  ],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['channels'],
    properties: {
      channels: channelsSchema,
      teamId: teamIdSchema,
      max: { type: 'integer', minimum: 10, maximum: 80, default: 40, description: 'How many terms to show.' },
      tz: tzSchema,
    },
  },
  inputSchema: null,
  outputs: [{ role: 'concepts', name: 'Concepts — {channel}', kind: 'diagram', per: 'channel' }],
  writes: [],
  events: ['concepts.updated'],
  intercepts: ['graph.ready', 'output.ready'],
  cost: { class: 'low', tokensPerRun: [0, 8000], vendorCallsPerRun: [1, 20] },
  idPrefix: 'sc',
})
