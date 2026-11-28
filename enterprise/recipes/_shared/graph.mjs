// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A diagram as a recipe wants it on a slate (DesiredSet graph, design B.2): notes by key, connectors
// by from/to keys, frames by key. Keys come from the source (Mermaid ids, a posted graph's keys), so
// the same source always lands on the same notes and reconcile changes only what changed.
import { parseMermaid } from '/imports/api/common/mermaid/parse.mjs'
import { SHAPE_TO_SLATE } from '/imports/api/common/mermaid/plan.mjs'
import { plain, https } from './text.mjs'

export const GRAPH_LIMITS = Object.freeze({ nodes: 1000, edges: 5000, frames: 100, textChars: 300, keyChars: 120 })
const MIND_TO_SLATE = { default: 'rectangle', square: 'rectangle', rounded: 'roundedrectangle', circle: 'circle', hexagon: 'hexagon', bang: 'star', cloud: 'ellipse' }

const keyOf = (raw) => plain(raw, GRAPH_LIMITS.keyChars)

/**
 * A Mermaid model (parseMermaid) as a desired graph. scope prefixes every key, so two diagrams on
 * one slate (two blocks of one doc) never share a note.
 */
export function graphFromMermaidModel(model, { scope = '' } = {}) {
  const k = (id) => (scope ? `${scope}/${id}` : String(id))
  if (model.type === 'flowchart') {
    const nodes = model.nodes.map((n) => ({ key: k(n.id), text: plain(n.text || n.id, GRAPH_LIMITS.textChars), shape: SHAPE_TO_SLATE[n.shape] || 'rectangle' }))
    const edges = model.edges.map((e) => ({ from: k(e.from), to: k(e.to), ...(e.text && { label: plain(e.text, 80) }), ...(e.stroke && e.stroke !== 'normal' && { style: e.stroke }) }))
    const frames = (model.subgraphs || []).map((g) => ({ key: k('frame:' + g.id), text: plain(g.title || g.id, 120), members: g.nodes.map(k) }))
    return { nodes, edges, frames, layout: model.direction === 'LR' || model.direction === 'RL' ? 'layered' : 'tree' }
  }
  if (model.type === 'mindmap') {
    const nodes = []
    const edges = []
    const walk = (node, parent, depth) => {
      nodes.push({ key: k(node.id), text: plain(node.text, GRAPH_LIMITS.textChars), shape: MIND_TO_SLATE[node.shape] || 'rectangle', ...(depth === 0 && { size: 'large' }) })
      if (parent) edges.push({ from: k(parent.id), to: k(node.id) })
      for (const child of node.children || []) walk(child, node, depth + 1)
    }
    if (model.root) walk(model.root, null, 0)
    return { nodes, edges, frames: [], layout: 'mindmap' }
  }
  if (model.type === 'gantt') {
    const nodes = model.tasks.map((t) => ({ key: k(t.id), text: plain([t.name, t.start, t.duration].filter(Boolean).join(' · '), GRAPH_LIMITS.textChars), shape: 'roundedrectangle' }))
    const ids = new Set(model.tasks.map((t) => t.id))
    const edges = model.tasks.flatMap((t) => (t.after || []).filter((a) => ids.has(a)).map((a) => ({ from: k(a), to: k(t.id) })))
    const frames = (model.sections || []).map((s) => ({ key: k('frame:' + s.id), text: plain(s.title, 120), members: model.tasks.filter((t) => t.section === s.id).map((t) => k(t.id)) }))
    return { nodes, edges, frames, layout: 'layered' }
  }
  throw Object.assign(new Error('unsupported diagram'), { code: 'mermaid_unsupported' })
}

/** Mermaid text as a desired graph (throws MermaidError with Slatebox's plain reason). */
export const graphFromMermaid = (text, options) => graphFromMermaidModel(parseMermaid(text), options)

/**
 * A posted graph ({nodes:[{key,label,group?,shape?,color?,link?}], edges:[{from,to,label?}]}) as a
 * desired graph. Groups become frames. Unknown edge ends are dropped and counted.
 */
export function graphFromJson(input, { scope = '' } = {}) {
  const k = (id) => (scope ? `${scope}/${id}` : keyOf(id))
  const nodes = []
  const seen = new Set()
  const groups = new Map()
  for (const n of input.nodes || []) {
    const key = k(n.key)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const link = https(n.link)
    nodes.push({ key, text: plain(n.label ?? n.key, GRAPH_LIMITS.textChars), ...(n.shape && { shape: n.shape }), ...(n.color && { colors: { background: n.color } }), ...(link && { link }), ...(n.group && { group: plain(n.group, 120) }) })
    if (n.group) {
      const g = plain(n.group, 120)
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g).push(key)
    }
  }
  let dropped = 0
  const edges = []
  const pairs = new Set()
  for (const e of input.edges || []) {
    const from = k(e.from)
    const to = k(e.to)
    if (!seen.has(from) || !seen.has(to) || pairs.has(from + '->' + to)) {
      dropped++
      continue
    }
    pairs.add(from + '->' + to)
    edges.push({ from, to, ...(e.label && { label: plain(e.label, 80) }) })
  }
  const frames = [...groups].map(([text, members]) => ({ key: k('group:' + text.toLowerCase()), text, members }))
  return { graph: { nodes, edges, frames, layout: input.layout || 'layered' }, dropped }
}
