// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// S4, the weekly channel digest (recipes catalog, wave 1 rank 7): every Monday, a slate for last
// week (a frame per channel: decisions, slips, open questions, top terms, a short summary) and a
// presentation made from it; optionally a post in a channel the owner granted.
import { defineRecipe } from '../../common/recipes/manifest.mjs'
import { CHANNEL_ID, channelsSchema, SLACK_READ_NEEDS, tzSchema } from '../_slack-ledger/config.mjs'

export const DIGEST_SECTIONS = Object.freeze(['decisions', 'slips', 'questions', 'concepts', 'summary'])

export const manifest = defineRecipe({
  id: 'slack-digest',
  version: 1,
  label: 'Weekly channel digest',
  summary: 'Every Monday, last week in your channels on one slate and a presentation: decisions, slips, open questions and a short summary. Can post it to a channel you allow.',
  agentName: 'Digest writer',
  integration: 'slack',
  needs: { slack: SLACK_READ_NEEDS },
  triggers: [{ kind: 'schedule', cron: '30 7 * * 1', default: true }, { kind: 'manual' }],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['channels'],
    properties: {
      channels: channelsSchema,
      sections: { type: 'array', uniqueItems: true, items: { enum: [...DIGEST_SECTIONS] }, default: [...DIGEST_SECTIONS], description: 'What each channel\'s frame shows.' },
      presentation: { type: 'boolean', default: true, description: 'Also make a presentation from the digest.' },
      post: {
        type: 'object',
        additionalProperties: false,
        properties: {
          channel: { type: 'string', pattern: CHANNEL_ID, description: 'Post the digest here (needs your permission below).', 'x-picker': 'slack.channel' },
          format: { enum: ['link', 'bullets'], default: 'link', description: 'A link, or five bullets and the link.' },
        },
      },
      tz: tzSchema,
    },
  },
  inputSchema: null,
  outputs: [{ role: 'digest', name: 'Week of {week}', kind: 'diagram', per: 'week', folder: ['Digests'], presentation: true }],
  writes: [
    {
      kind: 'slack.post',
      scopeSchema: { type: 'object', additionalProperties: false, required: ['channels'], properties: { channels: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'string', pattern: CHANNEL_ID } } } },
      describe: (scope) => `Post the weekly digest in ${(scope?.channels || []).map((c) => '<#' + c + '>').join(', ') || 'the channel you pick'}, once a week, as you`,
    },
  ],
  events: ['digest.published'],
  intercepts: ['output.ready', 'writeback.proposed'],
  cost: { class: 'low', tokensPerRun: [0, 20000], vendorCallsPerRun: [1, 20] },
  idPrefix: 'sw',
})
