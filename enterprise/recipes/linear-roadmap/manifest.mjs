// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// LIN-L1 Live roadmap (recipes catalog, wave 2 rank 1): a workspace's Linear projects as a living
// roadmap a head of product annotates: a board per team (or initiative, or lead) with each project
// in its target-date lane, a map of which projects block which (with how many issues), and every
// project's latest health post. A slip in Linear moves one card and says by how much; people's
// notes and stickies stay. Reads only (0 tokens unless the weekly summary is on).
import { defineRecipe } from '../../common/recipes/manifest.mjs'

const ID = { type: 'string', pattern: '^[0-9a-f-]{8,64}$' }

export const manifest = defineRecipe({
  id: 'linear-roadmap',
  version: 1,
  label: 'Live roadmap from Linear',
  agentName: 'Roadmap keeper',
  integration: 'linear',
  summary: 'Your Linear projects as a living roadmap: each in its target-date lane, which projects block which, and each one\'s latest health post. A slip moves one card; your notes stay.',
  needs: { linear: ['read'] },
  triggers: [
    { kind: 'vendor', event: 'linear.project', debounceMs: 120000, default: true },
    { kind: 'vendor', event: 'linear.issue', debounceMs: 300000 },
    { kind: 'schedule', cron: '0 3 * * *', default: true },
    { kind: 'manual' },
  ],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['teams'],
    properties: {
      teams: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: ID, title: 'Teams', 'x-slatebox-picker': 'linear-teams' },
      groupBy: { enum: ['team', 'initiative', 'lead'], default: 'team', title: 'One board for each', description: 'Initiatives show only when a Linear admin installed Slatebox for the workspace; otherwise projects are grouped by team.', 'x-slatebox-labels': { team: 'Team', initiative: 'Initiative', lead: 'Project lead' } },
      blockers: { type: 'boolean', default: true, title: 'Map blockers between projects' },
      staleDays: { type: 'integer', minimum: 3, maximum: 60, default: 14, title: 'Flag a project with no update for this many days' },
      summary: { type: 'boolean', default: false, title: 'A weekly summary by the agent', description: 'Three sentences from the week\'s project updates. Off: the recipe uses no tokens.' },
    },
  },
  inputSchema: null,
  outputs: [
    { role: 'roadmap', name: 'Roadmap', kind: 'board', component: 'team-board' },
    { role: 'dependencies', name: 'Dependencies', kind: 'diagram' },
    { role: 'health', name: 'Project health', kind: 'diagram' },
  ],
  events: ['roadmap.updated', 'roadmap.slipped', 'roadmap.stale_update', 'roadmap.new_blocker'],
  intercepts: ['graph.ready', 'output.ready'],
  cost: { class: 'low', tokensPerRun: [0, 6000], vendorCallsPerRun: [2, 10] },
  idPrefix: 'lr',
})

export default manifest
