// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// XJ-1 Release map: Linear + GitHub (recipes catalog Part 14, wave 2): what each GitHub release
// shipped, in Linear's words. One frame per release, oldest to newest, holding the Linear issues its
// commits name (ENG-123 in a commit message or a merged branch's name) and each project's progress
// at that release against the one before. A board catches drift: issues a release shipped that are
// still open in Linear. Reads only, 0 tokens.
import { defineRecipe } from '../../common/recipes/manifest.mjs'

const ID = { type: 'string', pattern: '^[0-9a-f-]{8,64}$' }
const REPO = { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$' }

export const manifest = defineRecipe({
  id: 'linear-release-map',
  version: 1,
  label: 'Release map from Linear and GitHub',
  agentName: 'Release mapper',
  integration: 'linear',
  summary: 'Each GitHub release as a frame of the Linear issues it shipped, with each project\'s progress before and after, and a board of what shipped but is still open in Linear.',
  needs: { linear: ['read'], github: ['metadata:read', 'contents:read'] },
  triggers: [
    { kind: 'vendor', event: 'github.release', debounceMs: 60000, default: true },
    { kind: 'vendor', event: 'linear.issue', debounceMs: 600000 },
    { kind: 'schedule', cron: '15 4 * * *', default: true },
    { kind: 'manual' },
  ],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['repos', 'teams'],
    properties: {
      repos: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: REPO, title: 'Repositories', 'x-slatebox-picker': 'repos' },
      teams: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: ID, title: 'Linear teams', description: 'Only these teams\' issue ids (ENG-123) are read from commits.', 'x-slatebox-picker': 'linear-teams' },
      releases: { type: 'integer', minimum: 1, maximum: 12, default: 6, title: 'Releases to show' },
      prereleases: { type: 'boolean', default: false, title: 'Pre-releases too' },
    },
  },
  inputSchema: null,
  outputs: [{ role: 'releases', name: 'Releases', kind: 'diagram' }],
  events: ['release_map.updated', 'release_map.drift'],
  intercepts: ['graph.ready', 'output.ready'],
  cost: { class: 'low', tokensPerRun: [0, 0], vendorCallsPerRun: [2, 20] },
  idPrefix: 'lm',
})

export default manifest
