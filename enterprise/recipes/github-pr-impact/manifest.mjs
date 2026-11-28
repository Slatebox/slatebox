// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// G2 PR impact: on every pull request, a small diagram of the modules and services it changes and
// the dependencies it adds or drops, as a slate reviewers can annotate, and (with the permission)
// as one Mermaid comment on the pull request, edited in place on each push. Browser-safe: data only.

const REPO = { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$' }

export const manifest = Object.freeze({
  id: 'github-pr-impact',
  version: 1,
  label: 'Pull request impact',
  agentName: 'PR reviewer',
  integration: 'github',
  summary: 'Draws what each pull request changes in your architecture, on a slate reviewers can annotate, and as one diagram comment on the pull request.',
  needs: { github: ['metadata:read', 'contents:read', 'pull_requests:read'] },
  triggers: Object.freeze([
    { kind: 'vendor', event: 'github.pull_request', debounceMs: 120000, default: true },
    { kind: 'manual' },
  ]),
  configSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['repos'],
    properties: {
      repos: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: REPO, title: 'Repositories', 'x-slatebox-picker': 'repos' },
      mode: { type: 'string', enum: ['both', 'slate', 'comment'], default: 'both', title: 'Where the impact goes' },
      skipLabel: { type: 'string', maxLength: 50, default: 'no-slatebox', title: 'Skip pull requests with this label' },
      includeDrafts: { type: 'boolean', default: false, title: 'Draft pull requests too' },
      minFiles: { type: 'integer', minimum: 1, maximum: 100, default: 3, title: 'Smallest pull request', description: 'Changed files, unless a manifest or infrastructure file changed.' },
      summary: { type: 'boolean', default: true, title: 'Summary in three bullets by the agent' },
      exclude: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 200 } },
    },
  }),
  inputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['repo', 'number'],
    properties: { repo: REPO, number: { type: 'integer', minimum: 1 } },
  }),
  outputs: Object.freeze([{ role: 'pr', name: '#{number} {title}', kind: 'diagram', per: 'pull request', folder: ['Pull requests'] }]),
  writes: Object.freeze([
    {
      kind: 'github.pr_comment',
      scopeSchema: { type: 'object', additionalProperties: false, required: ['repos'], properties: { repos: { type: 'array', items: REPO, minItems: 1 } } },
      describe: (scope) => `Post one impact comment on pull requests in ${(scope?.repos || []).join(', ')}, edited in place on each push`,
    },
  ]),
  events: Object.freeze(['pr_impact.ready', 'pr_impact.new_dependency', 'pr_impact.service_changed']),
  intercepts: Object.freeze(['graph.ready', 'output.ready']),
  cost: Object.freeze({ class: 'low', tokensPerRun: [0, 4000], vendorCallsPerRun: [3, 130] }),
  idPrefix: 'gp',
})

export default manifest
