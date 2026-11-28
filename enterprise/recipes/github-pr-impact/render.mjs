// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A pull request's impact (impactOf) and how it is shown: a slate (prSlate: added modules green,
// changed amber, removed red, the modules depending on changed ones grey; new lines green, dropped
// ones red; one summary note; the endpoint changes in a frame; a link back to the pull request) and
// a GitHub comment (prComment: a Mermaid flowchart LR of the same, at most 40 nodes, GitHub draws it).
import { idNamer, quoted } from '../../../web/app/imports/api/common/mermaid/text.mjs'
import { IMPACT, KIND_COLORS, LINE, pullUrl, SHAPES, shortSha, weightWidth } from '../_github-code/look.mjs'

export const COMMENT_NODES = 40

/** What a pull request changes, between the base's model and the head's. */
export function impactOf(baseModel, headModel, delta, changedPaths) {
  const changed = new Set(changedPaths)
  const all = new Map([...baseModel.modules, ...headModel.modules].map((m) => [m.key, m]))
  const added = new Set(delta.added.modules.map((m) => m.key))
  const removed = new Set(delta.removed.modules.map((m) => m.key))
  const touched = new Set()
  for (const m of all.values()) if (!added.has(m.key) && !removed.has(m.key) && m.files.some((f) => changed.has(f))) touched.add(m.key)
  const hit = new Set([...touched, ...added, ...removed])
  const blast = new Set()
  for (const e of baseModel.moduleEdges) if (hit.has(e.to) && !hit.has(e.from)) blast.add(e.from)
  const shown = new Set([...hit, ...blast])
  const addedEdges = new Set(delta.added.moduleEdges.map((e) => `${e.from}->${e.to}`))
  const edges = [
    ...headModel.moduleEdges.filter((e) => shown.has(e.from) && shown.has(e.to)).map((e) => ({ ...e, change: addedEdges.has(`${e.from}->${e.to}`) ? 'added' : 'kept' })),
    ...delta.removed.moduleEdges.filter((e) => shown.has(e.from) && shown.has(e.to)).map((e) => ({ ...e, change: 'removed' })),
  ]
  const kindOf = (key) => (added.has(key) ? 'added' : removed.has(key) ? 'removed' : touched.has(key) ? 'touched' : 'blast')
  return {
    modules: [...shown].sort().map((key) => ({ key, name: all.get(key)?.name ?? key, kind: kindOf(key) })),
    edges,
    endpoints: { added: delta.added.endpoints, removed: delta.removed.endpoints },
    services: { added: delta.added.services, removed: delta.removed.services },
    counts: {
      added: added.size, touched: touched.size, removed: removed.size, blast: blast.size,
      newEdges: delta.added.moduleEdges.length, droppedEdges: delta.removed.moduleEdges.length,
      endpointsAdded: delta.added.endpoints.length, endpointsRemoved: delta.removed.endpoints.length,
      servicesChanged: delta.added.services.length + delta.removed.services.length,
    },
    empty: delta.empty,
  }
}

const KIND_WORD = { added: 'added', touched: 'changed', removed: 'removed', blast: 'depends on a change' }

export function prSlate({ repo, pr, impact, summary, merged = false, closed = false, now = Date.now() }) {
  const nodes = impact.modules.map((m) => ({ key: m.key, text: `${m.name}\n${KIND_WORD[m.kind]}`, shape: SHAPES.module, colors: IMPACT[m.kind] }))
  const edges = impact.edges.map((e) => ({
    from: e.from,
    to: e.to,
    style: e.change === 'added' ? { ...LINE.added } : e.change === 'removed' ? { ...LINE.removed } : { lineWidth: weightWidth(e.weight) },
    ...(e.change === 'removed' && { label: 'dropped' }),
  }))
  const frames = []
  const endpointKeys = []
  for (const e of impact.endpoints.added) {
    endpointKeys.push(e.key)
    nodes.push({ key: e.key, text: `${e.method} ${e.path}`, shape: 'rectangle', colors: IMPACT.added })
  }
  for (const e of impact.endpoints.removed) {
    endpointKeys.push(`gone:${e.key}`)
    nodes.push({ key: `gone:${e.key}`, text: `${e.method} ${e.path}\nremoved`, shape: 'rectangle', colors: IMPACT.removed })
  }
  if (endpointKeys.length) frames.push({ key: 'endpoints', text: 'Endpoints', members: endpointKeys })
  const serviceKeys = []
  for (const s of impact.services.added) {
    serviceKeys.push(s.key)
    nodes.push({ key: s.key, text: `${s.label}\nadded`, shape: SHAPES[s.kind] || SHAPES.service, colors: KIND_COLORS[s.kind] || IMPACT.added })
  }
  for (const s of impact.services.removed) {
    serviceKeys.push(`gone:${s.key}`)
    nodes.push({ key: `gone:${s.key}`, text: `${s.label}\nremoved`, shape: SHAPES[s.kind] || SHAPES.service, colors: IMPACT.removed })
  }
  if (serviceKeys.length) frames.push({ key: 'services', text: 'Services', members: serviceKeys })
  const notes = [
    { key: 'pr', text: `#${pr.number} ${pr.title}\n${repo} @ ${shortSha(pr.head.sha)}${merged ? ' · merged' : closed ? ' · closed' : ''}`, link: { url: pullUrl(repo, pr.number) }, anchor: 'top-left' },
    { key: 'summary', text: summary || (impact.empty ? 'No architectural change.' : 'Changes shown on the diagram.'), anchor: 'legend' },
  ]
  return {
    role: 'pr',
    key: `${repo}#${pr.number}`,
    name: `#${pr.number} ${pr.title}`.slice(0, 120),
    folder: merged ? ['Pull requests', 'Merged'] : ['Pull requests'],
    graph: { nodes, edges, frames, layout: 'layered' },
    notes,
    // A pull request closed without merging: its slate goes after 14 days unless a person edited it.
    ...(closed && !merged && { retention: { deleteAfter: new Date(now + 14 * 86400000).toISOString(), unlessTouched: true } }),
  }
}

const MERMAID_CLASS = { added: 'fill:#dcfce7,stroke:#16a34a', touched: 'fill:#fef3c7,stroke:#d97706', removed: 'fill:#fee2e2,stroke:#dc2626', blast: 'fill:#f1f5f9,stroke:#94a3b8' }

/** The comment's Mermaid: flowchart LR, at most 40 nodes (modules that only depend on a change go first). */
export function impactMermaid(impact) {
  let modules = impact.modules
  let dropped = 0
  if (modules.length > COMMENT_NODES) {
    const order = { added: 0, removed: 1, touched: 2, blast: 3 }
    const kept = [...modules].sort((a, b) => order[a.kind] - order[b.kind] || (a.key < b.key ? -1 : 1)).slice(0, COMMENT_NODES)
    dropped = modules.length - kept.length
    modules = kept
  }
  const shown = new Set(modules.map((m) => m.key))
  // Names from the module's folder (mod:<repo>:packages/api -> packages_api), unique.
  const named = idNamer('m')
  const nameOf = new Map(modules.map((m) => [m.key, named(m.key.slice(m.key.lastIndexOf(':') + 1))]))
  const out = ['flowchart LR']
  for (const m of modules) out.push(`  ${nameOf.get(m.key)}[${quoted(`${m.name} (${KIND_WORD[m.kind]})`)}]:::${m.kind}`)
  for (const e of impact.edges) {
    if (!shown.has(e.from) || !shown.has(e.to)) continue
    const link = e.change === 'added' ? '==>' : e.change === 'removed' ? '-.->' : '-->'
    out.push(`  ${nameOf.get(e.from)} ${link}${e.change === 'removed' ? `|${quoted('dropped')}|` : ''} ${nameOf.get(e.to)}`)
  }
  for (const [kind, style] of Object.entries(MERMAID_CLASS)) if (modules.some((m) => m.kind === kind)) out.push(`  classDef ${kind} ${style}`)
  return { text: out.join('\n'), dropped }
}

export function prComment({ impact, summary, marker }) {
  const { text, dropped } = impactMermaid(impact)
  const lines = ['### Architecture impact', '']
  if (impact.modules.length) lines.push('```mermaid', text, '```', '')
  if (dropped) lines.push(`_${dropped} more modules are on the slate._`, '')
  if (summary) lines.push(summary, '')
  const c = impact.counts
  lines.push(`${c.added} added · ${c.touched} changed · ${c.removed} removed · ${c.newEdges} new dependenc${c.newEdges === 1 ? 'y' : 'ies'} · ${c.endpointsAdded + c.endpointsRemoved} endpoint change${c.endpointsAdded + c.endpointsRemoved === 1 ? '' : 's'}`)
  return { markdown: lines.join('\n'), marker }
}
