// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One run of render from a webhook: the posted payload (the trigger's input) as the slate for its
// key. Keys are the poster's, so posting the same graph twice changes nothing, and removing one node
// and adding another is one delete (or "removed" on a note a person touched) and one add, with no
// moves. Prose costs one model call (≤ 8k in, 1.5k out), and only when the owner turned it on.
// A run with nothing posted (Run now without data) redraws nothing.
import { graphFromJson, graphFromMermaid } from '../_shared/graph.mjs'
import { count, https, plain } from '../_shared/text.mjs'
import { checkRenderInput, RenderInputError } from './input.mjs'

export const TEXT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['nodes', 'edges'],
  properties: {
    nodes: { type: 'array', maxItems: 60, items: { type: 'object', additionalProperties: false, required: ['key', 'label'], properties: { key: { type: 'string' }, label: { type: 'string' }, group: { type: 'string' } } } },
    edges: { type: 'array', maxItems: 120, items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } } } },
  },
})

export default async function run(ctx) {
  const config = ctx.instance.config || {}
  const input = ctx.run.trigger?.input
  if (input === undefined || input === null) return { desired: { slates: [] }, summary: 'Nothing was posted, so nothing changed.', stats: { posted: false } }
  const { format, key, title, data } = checkRenderInput(input, config)
  const slate = { role: 'render', key, name: plain(title || `Rendered — ${key}`, 120), notes: [{ key: 'legend', anchor: 'legend', text: `Kept up to date by posts to this recipe's webhook (key ${key}).` }] }
  if (config.targetShareId) slate.target = { shareId: config.targetShareId }
  if (config.merge === 'append') slate.incremental = true
  let modelCalls = 0
  let size = 0

  if (format === 'graph') {
    const { graph } = graphFromJson(data.graph)
    slate.graph = graph
    size = graph.nodes.length
  } else if (format === 'mermaid') {
    try {
      slate.graph = graphFromMermaid(data.mermaid)
    } catch (error) {
      throw new RenderInputError(error.status === 422 ? 422 : 400, error.code || 'bad_payload', error.details?.line ? `/mermaid (line ${error.details.line})` : '/mermaid', error.message)
    }
    size = slate.graph.nodes.length
  } else if (format === 'board') {
    const b = data.board
    const cards = b.cards.map((c) => ({ key: c.key, label: plain(c.label, 120), lane: c.lane, ...(c.owner && { owner: plain(c.owner, 60) }), ...(c.due && { due: c.due }), ...(https(c.link) && { link: https(c.link) }), ...(c.fields && { fields: Object.fromEntries(Object.entries(c.fields).map(([k, v]) => [plain(k, 40), plain(v, 200)])) }), ...(c.dependsOn?.length && { dependsOn: c.dependsOn }) }))
    const boards = []
    for (let i = 0; i < cards.length; i += 24) boards.push({ key: `board-${i / 24 + 1}`, component: b.component, title: plain(b.title || title || 'Board', 100) + (cards.length > 24 ? ` (${i / 24 + 1})` : ''), lanes: b.lanes.map((l) => ({ key: l.key, label: plain(l.label, 60) })), cards: cards.slice(i, i + 24) })
    if (!boards.length) boards.push({ key: 'board-1', component: b.component, title: plain(b.title || title || 'Board', 100), lanes: b.lanes.map((l) => ({ key: l.key, label: plain(l.label, 60) })), cards: [] })
    slate.boards = boards
    size = cards.length
  } else {
    modelCalls++
    const answer = await ctx.ai.json({ prompt: `Turn this description into a diagram: a node per thing it names (a short label), an edge per relation (a short label). Only what it says.\n\n${data.text}`, schema: TEXT_SCHEMA, maxIn: 8000, maxOut: 1500, purpose: 'text' })
    if (!answer?.nodes) throw Object.assign(new Error('The agent could not draw that text just now. Post it again, or post a graph.'), { status: 503, code: 'ai_refused' })
    const { graph } = graphFromJson(answer)
    slate.graph = graph
    size = graph.nodes.length
  }

  ctx.emit('webhook.rendered', { key, format, size, ...(data.callbackUrl && { callbackUrl: https(data.callbackUrl) }) })
  return { desired: { slates: [slate] }, summary: `${format === 'board' ? count(size, 'card', 'cards') : count(size, 'note', 'notes')} for ${key}`, stats: { modelCalls, posted: true } }
}
