// A recipe for the runtime's tests: draws the graph its config (or an inbound call) names, keeps a
// board of changes, proposes one outside write, and asks the agent for a one-line summary.
import { defineRecipe } from '../../../enterprise/common/recipes/manifest.mjs'

export const manifest = defineRecipe({
  id: 'test-graph',
  version: 1,
  label: 'Test graph',
  summary: 'Draws a graph from its input.',
  agentName: 'Test cartographer',
  integration: 'github',
  needs: { github: ['contents:read'] },
  triggers: [{ kind: 'vendor', event: 'github.push', debounceMs: 120000, default: true }, { kind: 'schedule', cron: '0 3 * * *', default: true }, { kind: 'manual' }, { kind: 'inbound' }],
  configSchema: { type: 'object', additionalProperties: false, properties: { repo: { type: 'string', pattern: '^[\\w.-]+/[\\w.-]+$' }, summarize: { type: 'boolean' }, propose: { type: 'boolean' } }, required: ['repo'] },
  inputSchema: { type: 'object', additionalProperties: false, properties: { nodes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'text'], properties: { key: { type: 'string' }, text: { type: 'string' } } } }, edges: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } } }, required: ['nodes'] },
  outputs: [{ role: 'map', name: 'Service map', kind: 'diagram' }, { role: 'changes', name: 'What changed', kind: 'board', component: 'team-board' }],
  writes: [{ kind: 'github.pr_comment', scopeSchema: { type: 'object', additionalProperties: false, properties: { repos: { type: 'array', items: { type: 'string' } } }, required: ['repos'] }, describe: (scope) => `Comment on pull requests in ${scope.repos.join(', ')}` }],
  events: ['graph.drawn'],
  intercepts: ['graph.ready', 'output.ready'],
  cost: { class: 'low', tokensPerRun: [0, 4000], vendorCallsPerRun: [1, 5] },
  idPrefix: 'tg',
})

export async function run(ctx) {
  const repo = ctx.instance.config.repo
  const tree = await ctx.vendor.github.tree(repo)
  const input = ctx.run.trigger.kind === 'inbound' ? ctx.run.trigger.input : tree
  let summary = `${input.nodes.length} services`
  if (ctx.instance.config.summarize) {
    const answer = await ctx.ai.json({ purpose: 'summary', prompt: `Summarize ${input.nodes.map((n) => n.text).join(', ')}`, schema: { type: 'object', properties: { line: { type: 'string' } } } })
    if (answer?.line) summary = answer.line
  }
  ctx.setCursor({ lastSha: tree.sha })
  await ctx.ledger.upsert([{ key: `sha:${tree.sha}`, kind: 'sha', data: { n: input.nodes.length } }])
  ctx.emit('graph.drawn', { nodes: input.nodes.length })
  ctx.log('info', 'drawn', `Drew ${input.nodes.length} services.`)
  return {
    desired: {
      slates: [
        { role: 'map', key: '', name: `Service map: ${repo}`, graph: { nodes: input.nodes, edges: input.edges || [], layout: 'layered' }, notes: [{ key: 'legend', text: `Synced from ${repo} @ ${tree.sha}` }] },
        { role: 'changes', key: '', name: 'What changed', boards: [{ key: 'changes', component: 'team-board', title: 'What changed', lanes: [{ key: 'new', label: 'New' }], cards: [{ key: tree.sha, label: `Push ${tree.sha}`, lane: 'new' }] }] },
      ],
    },
    writes: ctx.instance.config.propose ? [{ kind: 'github.pr_comment', target: { repo, number: 7 }, body: { text: 'Architecture changed' }, key: 'pr:7' }] : [],
    summary,
    source: `${repo} @ ${tree.sha}`,
  }
}
