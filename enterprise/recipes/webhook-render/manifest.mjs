// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// X1, render anything to a living slate (recipes catalog, wave 1 rank 10): a developer's system
// (CI, a service catalog, a lineage tool, a cron) POSTs a graph, Mermaid, a board or prose to the
// recipe's signed hook (or recipes.run with a token), and a slate in the project stays current with
// the same in-place rules as every recipe: the same keys land on the same notes, only what changed
// changes, and nothing a person edited is overwritten.
import { defineRecipe } from '../../common/recipes/manifest.mjs'

export const RENDER_LIMITS = Object.freeze({ nodes: 1000, edges: 5000, bytes: 256 * 1024, mermaidChars: 100000, textChars: 20000, cards: 24, boards: 8 })
export const RENDER_COMPONENTS = Object.freeze(['team-board', 'launch-plan', 'hiring-plan', 'sales-pipeline', 'now-next-later', 'retro', 'triage', 'impact-effort', 'goals-owners', 'customer-go-live', 'incident-review'])
const KEY = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'

const nodeSchema = { type: 'object', additionalProperties: false, required: ['key'], properties: { key: { type: 'string', pattern: KEY }, label: { type: 'string', maxLength: 300 }, group: { type: 'string', maxLength: 120 }, shape: { enum: ['rectangle', 'roundedrectangle', 'ellipse', 'circle', 'diamond', 'hexagon', 'parallelogram', 'triangle', 'star'] }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, link: { type: 'string', maxLength: 2000 } } }
const edgeSchema = { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string', pattern: KEY }, to: { type: 'string', pattern: KEY }, label: { type: 'string', maxLength: 80 } } }
const cardSchema = { type: 'object', additionalProperties: false, required: ['key', 'label', 'lane'], properties: { key: { type: 'string', pattern: KEY }, label: { type: 'string', maxLength: 120 }, lane: { type: 'string', maxLength: 60 }, owner: { type: 'string', maxLength: 60 }, due: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, link: { type: 'string', maxLength: 2000 }, fields: { type: 'object', additionalProperties: { type: 'string', maxLength: 200 } }, dependsOn: { type: 'array', maxItems: 10, items: { type: 'string', pattern: KEY } } } }

export const INPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string', pattern: KEY, description: 'Which slate this updates (one slate per key; default "main").' },
    title: { type: 'string', maxLength: 120 },
    format: { enum: ['graph', 'mermaid', 'board', 'text'] },
    graph: { type: 'object', additionalProperties: false, required: ['nodes'], properties: { nodes: { type: 'array', items: nodeSchema }, edges: { type: 'array', items: edgeSchema }, layout: { enum: ['tree', 'layered', 'mindmap', 'grid'] } } },
    mermaid: { type: 'string', maxLength: RENDER_LIMITS.mermaidChars },
    board: { type: 'object', additionalProperties: false, required: ['component', 'lanes', 'cards'], properties: { component: { enum: [...RENDER_COMPONENTS] }, title: { type: 'string', maxLength: 120 }, lanes: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['key', 'label'], properties: { key: { type: 'string', pattern: KEY }, label: { type: 'string', maxLength: 60 } } } }, cards: { type: 'array', items: cardSchema } } },
    text: { type: 'string', maxLength: RENDER_LIMITS.textChars },
    callbackUrl: { type: 'string', maxLength: 2000 },
  },
})

export const manifest = defineRecipe({
  id: 'webhook-render',
  version: 1,
  label: 'Render from a webhook',
  summary: 'Post a graph, Mermaid, a board or prose from your own systems, and a slate in this project stays current with it.',
  agentName: 'Webhook renderer',
  integration: null,
  needs: {},
  triggers: [{ kind: 'inbound', default: true }, { kind: 'manual' }],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120, description: 'The slate\'s name (a posted title wins).' },
      format: { enum: ['graph', 'mermaid', 'board', 'text'], default: 'graph', description: 'What you will post.' },
      merge: { enum: ['replace', 'append'], default: 'replace', description: 'Replace: the slate shows what you posted last. Append: keep what earlier posts added.' },
      text: { type: 'boolean', default: false, description: 'Let the agent turn posted prose into a diagram (uses your agent allowance).' },
      targetShareId: { type: 'string', pattern: '^[A-Za-z0-9_-]{4,64}$', description: 'Update one of your own slates instead (changes arrive as suggestions).' },
    },
  },
  inputSchema: INPUT_SCHEMA,
  outputs: [{ role: 'render', name: '{title}', kind: 'diagram', per: 'key' }],
  writes: [],
  events: ['webhook.rendered'],
  intercepts: ['graph.ready', 'output.ready'],
  cost: { class: 'low', tokensPerRun: [0, 9500], vendorCallsPerRun: [0, 0] },
  idPrefix: 'xw',
})
