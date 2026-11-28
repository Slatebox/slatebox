// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// G3 Diagrams as code: the project's diagrams kept in the repository as Mermaid files, both ways.
// Changes on the canvas go to the repository as one open pull request from a slatebox/ branch
// (never the default branch, never merged by Slatebox); a merged edit to a file updates its slate in
// place. When it runs:
//   slate_saved    someone edits a slate in the sync map: 10 minutes after that slate's last save
//   recipe_event   Living architecture changed a slate in the sync map (right after its run)
//   github.push    a push to the default branch touched a mapped file (a merged pull request)
//   manual         Run now, and "Save to repo now" on a synced slate or the recipe's card
// Browser-safe: data only.

const REPO = { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$' }
const PATH = { type: 'string', pattern: '^(?!/)(?!.*\\.\\.)[\\w./-]{1,300}\\.(mmd|md)$' }

export const manifest = Object.freeze({
  id: 'github-mermaid-sync',
  version: 1,
  label: 'Diagrams as code',
  agentName: 'Diagram keeper',
  integration: 'github',
  summary: 'Keeps your diagrams in the repository as Mermaid files: canvas changes become one pull request, merged file edits update the slates.',
  needs: { github: ['metadata:read', 'contents:read', 'contents:write', 'pull_requests:write'] },
  triggers: Object.freeze([
    { kind: 'vendor', event: 'github.push', debounceMs: 120000, default: true },
    { kind: 'slate_saved', debounceMs: 600000, default: true },
    { kind: 'recipe_event', event: 'architecture.updated', default: true },
    { kind: 'manual' },
  ]),
  configSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['repo', 'maps'],
    properties: {
      repo: { ...REPO, title: 'Repository', 'x-slatebox-picker': 'repos' },
      folder: { type: 'string', pattern: '^(?!/)(?!.*\\.\\.)[\\w./-]{0,200}$', default: 'docs/architecture/', title: 'Folder' },
      branch: { type: 'string', pattern: '^slatebox/[\\w.-]{1,80}$', default: 'slatebox/architecture', title: 'Branch for the pull request' },
      format: { type: 'string', enum: ['mmd', 'md'], default: 'mmd', title: 'File format', description: 'mmd: Mermaid. md: a Markdown file holding one mermaid block.' },
      direction: { type: 'string', enum: ['LR', 'TD', 'RL', 'BT'], default: 'LR', title: 'Direction' },
      reviewers: { type: 'array', maxItems: 10, items: { type: 'string', pattern: '^[\\w-]{1,39}$' }, title: 'Reviewers' },
      maps: {
        type: 'array',
        minItems: 1,
        maxItems: 40,
        title: 'Slates and their files',
        description: 'Each slate is kept as one file. Leave the file empty to name it after the slate, in the folder above.',
        'x-slatebox-picker': 'slatemaps',
        items: { type: 'object', additionalProperties: false, required: ['shareId'], properties: { shareId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' }, file: PATH } },
      },
    },
  }),
  inputSchema: null,
  outputs: Object.freeze([{ role: 'mapped', name: 'The slates you map, kept in step with their files', kind: 'diagram' }]),
  writes: Object.freeze([
    {
      kind: 'github.pull_request',
      scopeSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['repos', 'branchPrefix', 'paths'],
        properties: { repos: { type: 'array', items: REPO, minItems: 1, maxItems: 1 }, branchPrefix: { type: 'string', pattern: '^slatebox/' }, paths: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      },
      describe: (scope) => `Open pull requests in ${(scope?.repos || []).join(', ')} on branches named ${scope?.branchPrefix || 'slatebox/'}…, changing only ${(scope?.paths || []).join(', ')}`,
    },
  ]),
  events: Object.freeze(['mermaid.sync.pr_opened', 'mermaid.sync.pr_updated', 'mermaid.sync.imported', 'mermaid.sync.conflict']),
  intercepts: Object.freeze(['writeback.proposed']),
  cost: Object.freeze({ class: 'low', tokensPerRun: [0, 0], vendorCallsPerRun: [1, 60] }),
  idPrefix: 'gm',
})

export default manifest
