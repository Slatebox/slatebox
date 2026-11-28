// Sync: a diagram read back onto the slate it came from, changing only what the diagram changed.
// The desired diagram (a canonical graph, canonical.mjs) is compared with what the slate says now:
//   - a note whose text or shape changed gets update_nodes (text, shape); never x, y, width or height
//   - a note or frame the diagram adds is drawn: inside its frame when the frame is already on the
//     slate (below the frame's notes; the frame grows taller only when the note would not fit),
//     otherwise as a small diagram of its own to the right of the slate's notes
//   - a line the diagram adds is connected, one it changes (label, arrow ends) is updated
//   - a note, frame or line the diagram drops is deleted only when it was in the base (the diagram
//     as last synced): a note added on the slate since then is never touched
//   - touched (noteId -> properties a person changed since the last sync) wins: a touched text is
//     kept and listed in kept; a touched note the diagram drops stays and is listed in kept
// Plans keep to the public limits (50 operations each). A diagram that already matches the slate
// gives no plans at all: import, canonical export and sync import is zero operations.
import { canonicalFromModel, canonicalGraph, mermaidShapeOf } from './canonical.mjs'
import { diagramPlans, importOrigin, lastNoteLook, newNoteStyle, OPERATIONS_PER_PLAN } from './plan.mjs'
import { noteSize } from './layout.mjs'

const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/

function touchedSet(touched, id) {
  if (!touched) return new Set()
  const value = touched instanceof Map ? touched.get(id) : touched[id]
  if (!value) return new Set()
  return value instanceof Set ? value : new Set(Array.isArray(value) ? value : [value])
}

const arrowStyle = (arrow) => ({ showChildArrow: arrow !== 'none', showParentArrow: arrow === 'both' })
function lineStyle(edge) {
  const style = { ...arrowStyle(edge.arrow) }
  if (edge.label) style.label = edge.label.slice(0, 500)
  if (edge.stroke === 'dotted') style.lineDash = 'dotted'
  if (edge.stroke === 'thick') style.lineWidth = 6
  if (edge.stroke === 'invisible') style.lineOpacity = 0
  return style
}

const boxOf = (o) => ({ x: Number(o.xPos ?? o.x ?? 0), y: Number(o.yPos ?? o.y ?? 0), width: Number(o.width ?? 120), height: Number(o.height ?? 80) })

/** The model drawn for new notes and frames with no frame on the slate (parse.mjs's flowchart shape). */
function subModel(nodes, frames, edges, direction) {
  return {
    type: 'flowchart',
    direction: direction === 'TD' ? 'TB' : direction || 'LR',
    nodes: nodes.map((n, k) => ({ id: n.id, text: n.text, shape: SLATE_TO_MERMAID[n.shape] || 'square', line: k, ...(n.link && { link: n.link }) })),
    subgraphs: frames.map((f, k) => ({ id: f.id, title: f.text, nodes: f.members, direction: null, line: k })),
    edges: edges.map((e) => ({ from: e.from, to: e.to, text: e.label, stroke: e.stroke, type: e.arrow === 'both' ? 'double_arrow_point' : e.arrow === 'none' ? 'arrow_open' : 'arrow_point', length: 1 })),
    warnings: [],
  }
}
const SLATE_TO_MERMAID = {
  rectangle: 'square', roundedrectangle: 'round', ellipse: 'stadium', circle: 'circle', diamond: 'diamond', hexagon: 'hexagon',
  parallelogram: 'lean_right', trapezium: 'trapezoid', rarrow: 'odd', larrow: 'odd', triangle: 'triangle',
}

/**
 * Plans that bring a slate in line with a desired canonical graph.
 * options: { current: slate JSON, base?: canonical graph as last synced, touched?: Map|object, direction? }
 * → { kind, plans, created, updated, deleted, connected, disconnected, kept, warnings, ids: { [desiredId]: noteId } }
 */
export function syncPlans(desired, { current, base = null, touched = null, direction = 'LR' } = {}) {
  const now = canonicalGraph(current)
  const warnings = [...(desired.warnings || [])]
  const slateNodes = Array.isArray(current?.nodes) ? current.nodes : []
  const allIds = new Set(slateNodes.map((n) => `${n?.options?.id ?? ''}`).filter(Boolean))
  const nowNodes = new Map(now.nodes.map((n) => [n.id, n]))
  const nowFrames = new Map(now.frames.map((f) => [f.id, f]))
  const nowEdges = new Map(now.edges.map((e) => [e.id, e]))
  const baseIds = new Set(base ? [...base.nodes.map((n) => n.id), ...base.frames.map((f) => f.id)] : [])
  const baseEdges = new Set(base ? base.edges.map((e) => e.id) : [])

  const updates = []
  const deletes = []
  const connects = []
  const disconnects = []
  const edgeUpdates = []
  const out = { created: [], updated: [], deleted: [], connected: [], disconnected: [], kept: [] }

  // Ids for what the diagram adds: its own name where a note may carry it and it is free.
  const ids = {}
  const taken = new Set(allIds)
  const idFor = (name) => {
    if (ids[name]) return ids[name]
    if (nowNodes.has(name) || nowFrames.has(name)) return (ids[name] = name)
    let base = NOTE_ID.test(name) && !name.startsWith('__free_') ? name : `${name}`.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 56) || 'note'
    let id = base
    for (let k = 2; taken.has(id); k += 1) id = `${base}_${k}`
    taken.add(id)
    return (ids[name] = id)
  }

  // Changed notes and frames.
  const desiredIds = new Set()
  const newNodes = []
  const newFrames = []
  for (const node of desired.nodes) {
    desiredIds.add(node.id)
    const have = nowNodes.get(node.id)
    if (!have) {
      if (nowFrames.has(node.id) || (allIds.has(node.id) && !nowNodes.has(node.id))) {
        warnings.push(`${node.id} is already on the slate as something else; it is left as it is.`)
        out.kept.push(node.id)
        continue
      }
      newNodes.push(node)
      continue
    }
    const person = touchedSet(touched, node.id)
    const changes = {}
    if (have.text !== node.text) {
      if (person.has('text')) out.kept.push(node.id)
      else changes.text = node.text.slice(0, 10000)
    }
    if (mermaidShapeOf(have.shape) !== mermaidShapeOf(node.shape) && !person.has('shape')) changes.shape = node.shape
    if (Object.keys(changes).length) {
      updates.push({ kind: 'update_nodes', target: { ids: [node.id] }, changes })
      out.updated.push(node.id)
    }
  }
  for (const frame of desired.frames) {
    desiredIds.add(frame.id)
    const have = nowFrames.get(frame.id)
    if (!have) {
      if (allIds.has(frame.id)) {
        warnings.push(`${frame.id} is already on the slate as a note; it is left as it is.`)
        out.kept.push(frame.id)
        continue
      }
      newFrames.push(frame)
      continue
    }
    if (have.text !== frame.text) {
      if (touchedSet(touched, frame.id).has('text')) out.kept.push(frame.id)
      else {
        updates.push({ kind: 'update_nodes', target: { ids: [frame.id] }, changes: { text: frame.text.slice(0, 10000) } })
        out.updated.push(frame.id)
      }
    }
  }

  // Dropped notes and frames: only what the last sync knew, and never what a person touched.
  for (const id of baseIds) {
    if (desiredIds.has(id) || !(nowNodes.has(id) || nowFrames.has(id))) continue
    if (touchedSet(touched, id).size) {
      out.kept.push(id)
      continue
    }
    deletes.push(id)
    out.deleted.push(id)
  }
  const deleted = new Set(deletes)

  // Lines.
  const newIds = new Set([...newNodes.map((n) => n.id), ...newFrames.map((f) => f.id)])
  const drawnWithNew = []
  for (const edge of desired.edges) {
    const have = nowEdges.get(edge.id) || (edge.arrow === 'none' ? nowEdges.get(`${edge.to}->${edge.from}`) : null)
    if (!have) {
      if (newIds.has(edge.from) && newIds.has(edge.to)) {
        drawnWithNew.push(edge)
        continue
      }
      const fromOk = newIds.has(edge.from) || ((nowNodes.has(edge.from) || nowFrames.has(edge.from)) && !deleted.has(edge.from))
      const toOk = newIds.has(edge.to) || ((nowNodes.has(edge.to) || nowFrames.has(edge.to)) && !deleted.has(edge.to))
      if (!fromOk || !toOk) {
        warnings.push(`The line ${edge.from} → ${edge.to} names a step that is not drawn; it is left out.`)
        continue
      }
      connects.push(edge)
      continue
    }
    if (touchedSet(touched, have.id).size) continue
    const changes = {}
    if (have.label !== edge.label && edge.stroke !== 'invisible') changes.label = edge.label
    if (have.arrow !== edge.arrow) Object.assign(changes, arrowStyle(edge.arrow))
    if (Object.keys(changes).length) {
      edgeUpdates.push({ kind: 'update_connections', from: { ids: [have.ends[0]] }, to: { ids: [have.ends[1]] }, changes })
      out.updated.push(have.id)
    }
  }
  const desiredEdges = new Set(desired.edges.flatMap((e) => (e.arrow === 'none' ? [e.id, `${e.to}->${e.from}`] : [e.id])))
  for (const id of baseEdges) {
    const have = nowEdges.get(id)
    if (!have || desiredEdges.has(id) || deleted.has(have.from) || deleted.has(have.to)) continue
    if (touchedSet(touched, id).size) {
      out.kept.push(id)
      continue
    }
    disconnects.push({ kind: 'disconnect_nodes', from: { ids: [have.ends[0]] }, to: { ids: [have.ends[1]] } })
    out.disconnected.push(id)
  }

  // What the diagram adds.
  const look = newNoteStyle(lastNoteLook(slateNodes))
  const adds = []
  const insideFrames = new Map()
  const loose = []
  for (const node of newNodes) {
    if (node.frame && nowFrames.has(node.frame) && !deleted.has(node.frame)) (insideFrames.get(node.frame) || insideFrames.set(node.frame, []).get(node.frame)).push(node)
    else loose.push(node)
  }
  const optionsOf = new Map(slateNodes.map((n) => [`${n?.options?.id ?? ''}`, n.options]))
  for (const [frameId, nodes] of insideFrames) {
    const frameBox = boxOf(optionsOf.get(frameId))
    const members = nowFrames.get(frameId).members.map((id) => optionsOf.get(id)).filter(Boolean).map(boxOf)
    let y = members.length ? Math.max(...members.map((b) => b.y + b.height)) + 30 : frameBox.y + 50
    let x = frameBox.x + 30
    let rowHeight = 0
    let bottom = frameBox.y + frameBox.height
    for (const node of nodes) {
      const size = noteSize(node.text, node.shape)
      if (x + size.width > frameBox.x + frameBox.width - 20 && x > frameBox.x + 30) {
        x = frameBox.x + 30
        y += rowHeight + 30
        rowHeight = 0
      }
      const id = idFor(node.id)
      adds.push({ kind: 'add_nodes', count: 1, ids: [id], shape: node.shape, text: node.text.slice(0, 10000), x: Math.round(x), y: Math.round(y), width: size.width, height: size.height, style: look })
      out.created.push(id)
      x += size.width + 30
      rowHeight = Math.max(rowHeight, size.height)
      bottom = Math.max(bottom, y + size.height + 30)
    }
    if (bottom > frameBox.y + frameBox.height) {
      updates.push({ kind: 'update_nodes', target: { ids: [frameId] }, changes: { height: Math.min(5000, Math.round(bottom - frameBox.y)) } })
      warnings.push(`The frame ${frameId} grew taller to hold its new notes.`)
    }
  }
  if (loose.length || newFrames.length) {
    const nodes = loose.map((n) => ({ ...n, id: idFor(n.id) }))
    const frames = newFrames.map((f) => ({ ...f, id: idFor(f.id), members: f.members.filter((m) => newIds.has(m)).map(idFor) }))
    const edges = drawnWithNew.map((e) => ({ ...e, from: idFor(e.from), to: idFor(e.to) }))
    const drawn = diagramPlans(subModel(nodes, frames, edges, direction), {
      existingIds: [...taken].filter((id) => !nodes.some((n) => n.id === id) && !frames.some((f) => f.id === id)),
      existingConnectorIds: [...nowEdges.keys()],
      origin: importOrigin(slateNodes),
      noteStyle: lastNoteLook(slateNodes),
    })
    for (const plan of drawn.plans) adds.push(...plan.operations)
    out.created.push(...drawn.created)
    out.connected.push(...drawn.plans.flatMap((p) => p.operations.filter((op) => op.kind === 'connect_nodes').map((op) => op.ids[0])))
  }
  for (const edge of connects) {
    const from = idFor(edge.from)
    const to = idFor(edge.to)
    adds.push({ kind: 'connect_nodes', from: { ids: [from] }, to: { ids: [to] }, ids: [`${from}->${to}`], style: lineStyle(edge) })
    out.connected.push(`${from}->${to}`)
  }

  const operations = [
    ...updates,
    ...disconnects,
    ...(deletes.length ? [{ kind: 'delete_nodes', target: { ids: deletes } }] : []),
    ...adds,
    ...edgeUpdates,
  ]
  const plans = []
  for (let start = 0; start < operations.length; start += OPERATIONS_PER_PLAN)
    plans.push({ message: start === 0 ? syncMessage(out) : 'Synced a Mermaid diagram (continued).', operations: operations.slice(start, start + OPERATIONS_PER_PLAN) })
  return { kind: 'flowchart', sync: true, plans, ...out, kept: [...new Set(out.kept)], warnings, ids }
}

function syncMessage(out) {
  const parts = []
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
  if (out.created.length) parts.push(`${n(out.created.length, 'note')} added`)
  if (out.updated.length) parts.push(`${n(out.updated.length, 'change')}`)
  if (out.deleted.length) parts.push(`${n(out.deleted.length, 'note')} removed`)
  if (out.connected.length) parts.push(`${n(out.connected.length, 'line')} added`)
  if (out.disconnected.length) parts.push(`${n(out.disconnected.length, 'line')} removed`)
  return `Synced a Mermaid diagram: ${parts.join(', ') || 'no changes'}.`
}

/** A parsed Mermaid model synced onto a slate (diagramPlans with sync). */
export function syncModelPlans(model, { idMap = {}, current, base = null, touched = null } = {}) {
  const desired = canonicalFromModel(model, { names: idMap })
  return syncPlans(desired, { current, base, touched, direction: model.direction })
}
