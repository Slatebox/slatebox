// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// G1 Living architecture: the project keeps a service map, a module graph and an API surface per
// repository, rebuilt from the code on every merge to the default branch, and a "What changed"
// board. People's own notes, words and moves on those slates stay theirs (reconcile, R1–R9).
// Browser-safe: data only (catalog.mjs reads it for the recipe picker).

const REPO = { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$' }
const GLOBS = { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 200 } }

export const manifest = Object.freeze({
  id: 'github-architecture',
  version: 1,
  label: 'Living architecture',
  agentName: 'GitHub architect',
  integration: 'github',
  description: 'Keeps a service map, module graphs and the API surface of your repositories up to date on every merge, with a board of what changed.',
  needs: { github: ['metadata:read', 'contents:read'] },
  triggers: Object.freeze([
    { kind: 'vendor', event: 'github.push', debounceMs: 120000, default: true },
    { kind: 'schedule', cron: '0 3 * * *', default: true },
    { kind: 'manual' },
    { kind: 'inbound' },
  ]),
  configSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['repos'],
    properties: {
      repos: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: REPO, title: 'Repositories', 'x-slatebox-picker': 'repos' },
      include: { ...GLOBS, title: 'Only these paths' },
      exclude: { ...GLOBS, title: 'Leave out these paths', description: 'Added to the defaults: node_modules, vendor, dist, build, tests and generated code.' },
      groupingDepth: { type: 'integer', minimum: 1, maximum: 4, default: 2, title: 'Module depth', description: 'Folder levels a module spans when the repository has no workspace packages.' },
      views: {
        type: 'object',
        additionalProperties: false,
        title: 'Slates to keep',
        properties: { serviceMap: { type: 'boolean', default: true }, modules: { type: 'boolean', default: true }, api: { type: 'boolean', default: true } },
      },
      colorByOwner: { type: 'boolean', default: true, title: 'Color modules by owner (CODEOWNERS)' },
      showExternal: { type: 'boolean', default: false, title: 'Show the 10 most used outside packages' },
      labels: { type: 'boolean', default: true, title: 'Name modules with the agent', description: 'A short name and purpose per module, from its file list. Off: modules are named by folder, and the recipe uses no tokens.' },
      checkRun: { type: 'boolean', default: false, title: 'Add a check to each push', description: 'Needs the "Add a check" permission.' },
    },
  }),
  inputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      env: { type: 'string', minLength: 1, maxLength: 40 },
      version: { type: 'string', minLength: 1, maxLength: 60 },
      service: { type: 'string', maxLength: 100 },
    },
  }),
  outputs: Object.freeze([
    { role: 'service-map', name: 'Service map', kind: 'diagram' },
    { role: 'modules', name: 'Modules — {repo}', kind: 'diagram', per: 'repo' },
    { role: 'drill', name: 'Modules — {repo} › {module}', kind: 'diagram', per: 'module', folder: ['Modules'] },
    { role: 'api', name: 'API surface — {repo}', kind: 'diagram', per: 'repo' },
    { role: 'changes', name: 'What changed', kind: 'board', component: 'team-board' },
    { role: 'changes-archive', name: 'What changed — archive', kind: 'diagram' },
  ]),
  writes: Object.freeze([
    {
      kind: 'github.check_run',
      scopeSchema: { type: 'object', additionalProperties: false, required: ['repos'], properties: { repos: { type: 'array', items: REPO, minItems: 1 } } },
      describe: (scope) => `Add a neutral "Slatebox architecture" check to pushes in ${(scope?.repos || []).join(', ')}`,
    },
  ]),
  events: Object.freeze(['architecture.updated', 'architecture.new_dependency', 'architecture.cycle_detected', 'architecture.renamed']),
  intercepts: Object.freeze(['graph.ready', 'output.ready']),
  cost: Object.freeze({ class: 'low', tokensPerRun: [0, 32000], vendorCallsPerRun: [2, 200] }),
  idPrefix: 'ga',
})

export default manifest
