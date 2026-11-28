// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One run of design doc to diagram: per doc, its name and kind (1 call) and its body (1 call), then
// one slate: a frame per Mermaid block (Mermaid ids are the note keys, so editing one label in the
// doc changes one note), the doc map, the components table. A doc with no diagram gets one drafted
// by the agent (one call, ≤ 12k in, 1k out), kept and reused until the doc's text changes by more
// than 15%. When the project also has a living architecture map, names the design mentions that
// the map lacks are listed in a "Proposed vs current" note.
import { graphFromJson, graphFromMermaid } from '../_shared/graph.mjs'
import { count, hashOf, normalKey, plain, similarity, simhash } from '../_shared/text.mjs'
import { docLink, readDoc } from './doc.mjs'

export const DESIGN_LIMITS = Object.freeze({ draftIn: 12000, draftOut: 1000, draftChars: 40000, draftNodes: 40, draftEdges: 60, redraftBelow: 0.85, drift: 20 })

export const DRAFT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['nodes', 'edges'],
  properties: {
    nodes: { type: 'array', maxItems: DESIGN_LIMITS.draftNodes, items: { type: 'object', additionalProperties: false, required: ['key', 'label'], properties: { key: { type: 'string' }, label: { type: 'string' }, group: { type: 'string' } } } },
    edges: { type: 'array', maxItems: DESIGN_LIMITS.draftEdges, items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } } } },
  },
})

const DOC_MIME = 'application/vnd.google-apps.document'

function merge(into, graph) {
  into.nodes.push(...graph.nodes)
  into.edges.push(...graph.edges)
  into.frames.push(...(graph.frames || []))
}

export default async function run(ctx) {
  const config = ctx.instance.config
  const google = ctx.vendor.google
  const cursor = ctx.instance.cursor || {}
  const drafts = { ...(cursor.drafts || {}) }
  const revisions = { ...(cursor.revisions || {}) }
  const drift = { ...(cursor.drift || {}) }
  const slates = []
  let modelCalls = 0
  let partial = null
  let diagrams = 0

  // The project's living architecture map (G1), when there is one: the names it already shows.
  let current = null
  if (typeof ctx.project?.slatesByRecipe === 'function') {
    const maps = await ctx.project.slatesByRecipe('github-architecture', 'service-map').catch(() => [])
    if (maps?.length) current = new Set(maps.flatMap((m) => (m.notes || []).map((n) => normalKey(n.text))).filter(Boolean))
  }

  for (const fileId of config.fileIds) {
    const meta = await google.fileMeta(fileId)
    if (meta.mimeType !== DOC_MIME) {
      ctx.log('warn', 'not_a_doc', `Skipped ${fileId}: not a Google Doc.`)
      continue
    }
    const doc = await google.document(fileId)
    const read = readDoc(doc, { only: config.headings || [] })
    const graph = { nodes: [], edges: [], frames: [] }
    const notes = [{ key: 'legend', anchor: 'legend', text: `Mirrors the design doc ${plain(meta.name, 80)}. Each note links to its section; edit the doc to change the diagrams.`, link: meta.link || docLink(fileId) }]

    // The doc map: the title at the center, each heading under its parent.
    const title = { key: 'map/title', text: plain(read.title || meta.name, 120), shape: 'roundedrectangle', link: meta.link || docLink(fileId) }
    const mapNodes = [title, ...read.headings.filter((h) => h.level > 0).map((h) => ({ key: 'map/' + h.key, text: h.text, link: h.link }))]
    const mapEdges = read.headings.filter((h) => h.level > 0).map((h) => ({ from: h.parentKey && read.headings.find((p) => p.key === h.parentKey && p.level > 0) ? 'map/' + h.parentKey : 'map/title', to: 'map/' + h.key }))
    merge(graph, { nodes: mapNodes, edges: mapEdges, frames: [{ key: 'frame:map', text: 'Doc map', members: mapNodes.map((n) => n.key) }] })

    // Each Mermaid block, a frame of its own.
    for (const block of read.blocks) {
      const scope = 'mm/' + block.key
      try {
        const drawn = graphFromMermaid(block.source, { scope })
        merge(graph, drawn)
        graph.frames.push({ key: 'frame:' + scope, text: plain(`Diagram${block.heading ? ' in ' + block.heading.text : ''}`, 120), members: drawn.nodes.map((n) => n.key) })
        diagrams++
      } catch (error) {
        graph.nodes.push({ key: scope + '/unreadable', text: plain(`A diagram${block.heading ? ' in ' + block.heading.text : ''} could not be drawn: ${error.message}`, 240), ...(block.heading && { link: block.heading.link }) })
      }
    }

    // A components table: a note per component, a connector per dependency.
    if (read.components.length) {
      const nodes = new Map()
      const edges = []
      for (const c of read.components) nodes.set(normalKey(c.name), { key: 'comp/' + normalKey(c.name), text: plain(c.description ? `${c.name} — ${c.description}` : c.name, 200), ...(c.heading && { link: c.heading.link }) })
      for (const c of read.components) for (const dep of c.deps) {
        if (!nodes.has(normalKey(dep))) nodes.set(normalKey(dep), { key: 'comp/' + normalKey(dep), text: dep })
        edges.push({ from: 'comp/' + normalKey(c.name), to: 'comp/' + normalKey(dep) })
      }
      merge(graph, { nodes: [...nodes.values()], edges, frames: [{ key: 'frame:components', text: 'Components', members: [...nodes.values()].map((n) => n.key) }] })
      diagrams++
    }

    // No diagram at all: one drafted by the agent, redrawn only when the text changed enough.
    let drafted = false
    if (!read.blocks.length && !read.components.length && config.draft !== false && read.text.trim()) {
      const hash = simhash(read.text)
      const kept = drafts[fileId]
      let draft = kept && similarity(kept.hash, hash) >= DESIGN_LIMITS.redraftBelow ? kept.graph : null
      if (!draft) {
        modelCalls++
        const answer = await ctx.ai.json({
          prompt: `Draw the components and flows this design doc describes, as a graph: a node per component, service, store or actor (a short label), an edge per call, read or write (a short label). Only what the doc says.\n\n# ${read.title}\n\n${read.text.slice(0, DESIGN_LIMITS.draftChars)}`,
          schema: DRAFT_SCHEMA, maxIn: DESIGN_LIMITS.draftIn, maxOut: DESIGN_LIMITS.draftOut, purpose: 'draft',
        })
        if (answer?.nodes) {
          draft = { nodes: answer.nodes.slice(0, DESIGN_LIMITS.draftNodes).map((n) => ({ key: plain(n.key, 60), label: plain(n.label, 80), ...(n.group && { group: plain(n.group, 40) }) })), edges: answer.edges.slice(0, DESIGN_LIMITS.draftEdges).map((e) => ({ from: plain(e.from, 60), to: plain(e.to, 60), ...(e.label && { label: plain(e.label, 40) }) })) }
          drafts[fileId] = { hash, graph: draft }
        } else partial = 'ai_refused'
      }
      if (draft) {
        const { graph: drawn } = graphFromJson(draft, { scope: 'draft' })
        merge(graph, drawn)
        graph.frames.push({ key: 'frame:draft', text: 'Drafted by the agent from the doc', members: drawn.nodes.map((n) => n.key) })
        drafted = true
        diagrams++
      }
    } else delete drafts[fileId]

    // Proposed vs current: names in the design the architecture map does not show.
    if (current) {
      const named = graph.nodes.filter((n) => n.key.startsWith('mm/') || n.key.startsWith('comp/') || n.key.startsWith('draft/')).map((n) => plain(n.text.split(' — ')[0], 80))
      const missing = [...new Set(named.filter((n) => !current.has(normalKey(n))))].slice(0, DESIGN_LIMITS.drift)
      notes.push({ key: 'drift', anchor: 'top-left', text: missing.length ? `Proposed vs current: not yet in the architecture map: ${missing.join(', ')}` : 'Proposed vs current: everything this design names is in the architecture map.' })
      if (missing.length && hashOf(missing) !== drift[fileId]) ctx.emit('design_doc.drift', { docId: fileId, missing: missing.length })
      drift[fileId] = hashOf(missing)
    }

    if (revisions[fileId] !== (doc.revisionId || meta.version)) ctx.emit('design_doc.updated', { docId: fileId, diagrams: read.blocks.length, drafted })
    revisions[fileId] = doc.revisionId || meta.version
    slates.push({ role: 'design', key: fileId, name: `Design — ${plain(read.title || meta.name, 100)}`, graph: { ...graph, layout: 'layered' }, notes })
  }

  ctx.setCursor({ drafts, revisions, drift })
  return {
    desired: { slates, ...(partial && { partial }) },
    summary: `${count(slates.length, 'design doc', 'design docs')}, ${count(diagrams, 'diagram', 'diagrams')}`,
    stats: { modelCalls },
  }
}
