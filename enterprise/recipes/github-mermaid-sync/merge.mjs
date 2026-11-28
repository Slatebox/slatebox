// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A three-way merge of canonical graphs, per element (note, frame, line), never per file:
//   base   what the slate and the file last agreed on
//   ours   the slate now (the canvas)
//   theirs the file now (the repository)
// An element changed on one side only takes that side. Changed the same on both: fine. Changed
// differently on both: the canvas wins, and the element is a conflict (a note on the slate, a line in
// the pull request body). Adding and removing are changes like any other. Nothing is lost silently.

const nodeSay = (n) => (n ? JSON.stringify([n.text, n.shape === 'larrow' ? 'rarrow' : n.shape, n.frame ?? null]) : null)
const frameSay = (f) => (f ? JSON.stringify([f.text, f.parent ?? null]) : null)
const edgeSay = (e) => (e ? JSON.stringify([e.label, e.arrow, e.stroke]) : null)

function mergeSet(base, ours, theirs, say, kind, conflicts) {
  const b = new Map((base || []).map((x) => [x.id, x]))
  const o = new Map(ours.map((x) => [x.id, x]))
  const t = new Map(theirs.map((x) => [x.id, x]))
  const out = []
  for (const id of [...new Set([...b.keys(), ...o.keys(), ...t.keys()])].sort()) {
    const [bs, os, ts] = [say(b.get(id)), say(o.get(id)), say(t.get(id))]
    let pick
    if (os === ts) pick = o.get(id) ?? t.get(id)
    else if (bs === os) pick = t.get(id)
    else if (bs === ts) pick = o.get(id)
    else {
      pick = o.get(id)
      conflicts.push({ kind, id, canvas: o.get(id) ?? null, repo: t.get(id) ?? null })
    }
    if (pick) out.push(pick)
  }
  return out
}

/** → { merged: canonical graph, conflicts: [{ kind, id, canvas, repo }], repoChanged, canvasChanged } */
export function mergeGraphs(base, ours, theirs) {
  const conflicts = []
  const nodes = mergeSet(base?.nodes, ours.nodes, theirs.nodes, nodeSay, 'note', conflicts)
  // A sync never moves a note, so a note the file puts in another subgraph stays in its frame on
  // the canvas; the file follows the canvas and the conflict says where to move it.
  const oursById = new Map(ours.nodes.map((n) => [n.id, n]))
  for (const [k, n] of nodes.entries()) {
    const mine = oursById.get(n.id)
    if (mine && (n.frame ?? null) !== (mine.frame ?? null)) {
      conflicts.push({ kind: 'note', id: n.id, reason: 'frame', canvas: mine, repo: n })
      nodes[k] = { ...n, frame: mine.frame ?? null }
    }
  }
  const frames = mergeSet(base?.frames, ours.frames, theirs.frames, frameSay, 'frame', conflicts)
  const ids = new Set([...nodes.map((n) => n.id), ...frames.map((f) => f.id)])
  // A line whose end is gone goes with it.
  const edges = mergeSet(base?.edges, ours.edges, theirs.edges, edgeSay, 'line', conflicts).filter((e) => ids.has(e.from) && ids.has(e.to))
  // Frame members follow the notes' and frames' own frame field.
  for (const f of frames) f.members = [...nodes.filter((n) => n.frame === f.id).map((n) => n.id), ...frames.filter((x) => x.parent === f.id).map((x) => x.id)].sort()
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const strip = (g) => g && { nodes: g.nodes.map(nodeSay), frames: g.frames.map(frameSay), edges: g.edges.map(edgeSay), ids: [...g.nodes, ...g.frames, ...g.edges].map((x) => x.id) }
  const merged = { nodes, frames: frames.map((f) => ({ ...f })), edges, warnings: [] }
  return { merged, conflicts, repoChanged: !same(strip(base), strip(theirs)), canvasChanged: !same(strip(base), strip(ours)) }
}

/** What changed between two graphs, as the pull request body says it: "+2 notes, −1 line". */
export function graphChanges(before, after) {
  const count = (a, b) => {
    const x = new Set((a || []).map((e) => e.id))
    const y = new Set((b || []).map((e) => e.id))
    return { added: [...y].filter((id) => !x.has(id)).length, removed: [...x].filter((id) => !y.has(id)).length }
  }
  const notes = count([...(before?.nodes || []), ...(before?.frames || [])], [...after.nodes, ...after.frames])
  const lines = count(before?.edges, after.edges)
  const byId = new Map([...(before?.nodes || []), ...(before?.frames || [])].map((n) => [n.id, n.text]))
  const renamed = [...after.nodes, ...after.frames].filter((n) => byId.has(n.id) && byId.get(n.id) !== n.text).length
  const parts = []
  if (notes.added) parts.push(`+${notes.added} note${notes.added === 1 ? '' : 's'}`)
  if (notes.removed) parts.push(`−${notes.removed} note${notes.removed === 1 ? '' : 's'}`)
  if (renamed) parts.push(`${renamed} renamed`)
  if (lines.added) parts.push(`+${lines.added} line${lines.added === 1 ? '' : 's'}`)
  if (lines.removed) parts.push(`−${lines.removed} line${lines.removed === 1 ? '' : 's'}`)
  return parts.join(', ') || 'no change in what it says'
}
