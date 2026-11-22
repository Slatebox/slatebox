// An imported diagram as canvas operation plans: real notes (add_nodes) and lines
// (connect_nodes), the same plans an agent or the canvas conversation sends. The engine's
// applier draws them, so an import is an ordinary edit: saved by the save core, sent to everyone
// on the slate, and readable afterwards. Plans keep to the public limits (50 operations each).
import { layoutDiagram, noteSize } from './layout.mjs'

export const OPERATIONS_PER_PLAN = 50

// Mermaid shapes as the slate's own shapes. Where Mermaid has no counterpart the note is a rectangle.
export const SHAPE_TO_SLATE = {
  square: 'rectangle',
  round: 'roundedrectangle',
  stadium: 'ellipse',
  subroutine: 'rectangle',
  cylinder: 'rectangle',
  circle: 'circle',
  doublecircle: 'circle',
  odd: 'rarrow',
  diamond: 'diamond',
  hexagon: 'hexagon',
  lean_right: 'parallelogram',
  lean_left: 'parallelogram',
  trapezoid: 'trapezium',
  inv_trapezoid: 'trapezium',
  triangle: 'triangle',
}
const MIND_TO_SLATE = {
  default: 'rectangle',
  square: 'rectangle',
  rounded: 'roundedrectangle',
  circle: 'circle',
  hexagon: 'hexagon',
  bang: 'star',
  cloud: 'ellipse',
}

// A note as the app draws a new one on a slate with no notes yet (ui/components/node/addNote.js
// noteBase): the import's notes look like the notes a person adds, not the engine's fallback.
export const NOTE_STYLE = Object.freeze({ backgroundColor: '#23aad6', foregroundColor: '#000000' })

// A subgraph is drawn as a frame: a light note behind its notes, its title at the top.
export const FRAME_STYLE = {
  backgroundColor: '#f3f6fa',
  borderColor: '#9aa8ba',
  borderWidth: 1,
  borderStyle: 'dashed',
  foregroundColor: '#2c3a4b',
  textXAlign: 'left', // top left, so a line into the frame passes beside its title
  textYAlign: 'top',
  fontSize: 16,
}

const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/
const COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** Note ids for diagram names: the name where the slate accepts it and it is free. */
function noteIds(taken) {
  const used = new Set(taken)
  const given = new Map()
  return (name) => {
    if (given.has(name)) return given.get(name)
    let base = `${name}`.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 56)
    if (!base || base.startsWith('__free_')) base = 'note'
    let id = base
    for (let k = 2; used.has(id) || !NOTE_ID.test(id); k += 1) id = `${base}_${k}`
    used.add(id)
    given.set(name, id)
    return id
  }
}

function lineStyle(edge) {
  const style = {}
  if (edge.text) style.label = edge.text.slice(0, 500)
  if (edge.type.startsWith('double_arrow')) {
    style.showParentArrow = true
    style.showChildArrow = true
  } else if (edge.type === 'arrow_open') {
    style.showParentArrow = false
    style.showChildArrow = false
  } else {
    style.showParentArrow = false
    style.showChildArrow = true
  }
  if (edge.stroke === 'dotted') style.lineDash = 'dotted'
  if (edge.stroke === 'thick') style.lineWidth = 6
  if (edge.stroke === 'invisible') style.lineOpacity = 0
  return style
}

/**
 * The look an imported note starts from: the app's new-note look, or on a slate that already has
 * notes, its last note's colours (a new note takes after it, as addNote does in the app).
 */
export function newNoteStyle(look) {
  const style = { ...NOTE_STYLE }
  for (const key of ['backgroundColor', 'borderColor', 'foregroundColor']) if (COLOR.test(look?.[key] ?? '')) style[key] = look[key]
  // Another fill without its text colour: the canvas picks a text colour that reads on it.
  if (COLOR.test(look?.backgroundColor ?? '') && !COLOR.test(look?.foregroundColor ?? '')) delete style.foregroundColor
  return style
}

/**
 * The look a slate's next note takes after: its last own note that is drawn as a note (not an
 * imported frame, not an invisible text note). Undefined when it has none.
 */
export function lastNoteLook(nodes = []) {
  for (let k = nodes.length - 1; k >= 0; k -= 1) {
    const o = nodes[k]?.options
    if (!o) continue
    const frame = o.backgroundColor === FRAME_STYLE.backgroundColor && o.borderStyle === FRAME_STYLE.borderStyle
    if (frame || o.opacity === 0) continue
    return { backgroundColor: o.backgroundColor, borderColor: o.borderColor, foregroundColor: o.foregroundColor }
  }
  return undefined
}

function noteStyle(look = {}) {
  const style = {}
  if (COLOR.test(look.fill ?? '')) style.backgroundColor = look.fill
  if (COLOR.test(look.stroke ?? '')) style.borderColor = look.stroke
  if (COLOR.test(look.color ?? '')) style.foregroundColor = look.color
  return style
}

/**
 * A diagram model (parse.mjs) as a drawing: notes, frames and lines with their positions,
 * before any ids are given.
 */
export function drawingOf(model, base = NOTE_STYLE) {
  const warnings = [...(model.warnings || [])]
  // What the source writes first comes first: steps and subgraphs by the line they start on.
  const sourceOrder = (item, k) => (Number.isFinite(item.line) ? item.line * 100000 : 0) + k
  if (model.type === 'flowchart') {
    const notes = model.nodes.map((node, k) => {
      const shape = SHAPE_TO_SLATE[node.shape] || 'rectangle'
      return {
        name: node.id,
        text: node.text,
        shape,
        order: sourceOrder(node, k),
        style: { ...base, ...noteStyle(node.style) },
        ...(node.link && { link: node.link }),
        ...noteSize(node.text, shape),
      }
    })
    const frames = model.subgraphs.map((s, k) => ({ name: s.id, title: s.title, members: s.nodes, direction: s.direction, order: sourceOrder(s, k) }))
    const lines = model.edges.map((edge) => ({ from: edge.from, to: edge.to, style: lineStyle(edge) }))
    return { kind: 'flowchart', direction: model.direction, notes, frames, lines, warnings }
  }
  if (model.type === 'mindmap') {
    const notes = []
    const lines = []
    const walk = (item) => {
      const shape = MIND_TO_SLATE[item.shape] || 'rectangle'
      notes.push({ name: item.id, text: item.text, shape, style: { ...base }, ...noteSize(item.text, shape) })
      for (const child of item.children) {
        lines.push({ from: item.id, to: child.id, style: { showParentArrow: false, showChildArrow: false } })
        walk(child)
      }
    }
    walk(model.root)
    return { kind: 'mindmap', direction: 'LR', notes, frames: [], lines, warnings, mindMap: true }
  }
  if (model.type === 'gantt') {
    const notes = model.tasks.map((task) => {
      const length = task.duration ? `\n${task.duration}` : ''
      const text = `${task.name}${length}`
      const shape = task.tags.includes('milestone') ? 'diamond' : 'rectangle'
      return { name: task.id, text, shape, style: { ...base }, ...noteSize(text, shape) }
    })
    const frames = model.sections.map((section) => ({
      name: section.id,
      title: section.title,
      members: model.tasks.filter((t) => t.section === section.id).map((t) => t.id),
      direction: 'LR',
    }))
    const lines = model.tasks.flatMap((task) =>
      task.after.map((before) => ({ from: before, to: task.id, style: { showParentArrow: false, showChildArrow: true } }))
    )
    return { kind: 'gantt', direction: 'TB', notes, frames, lines, warnings, title: model.title }
  }
  throw new Error(`Unknown diagram ${model.type}`)
}

/**
 * Plans that draw a diagram model on a slate.
 * options.existingIds: note and connector ids already on the slate.
 * options.origin: where the diagram's top-left corner goes.
 */
export function diagramPlans(model, { existingIds = [], existingConnectorIds = [], origin = { x: 0, y: 0 }, noteStyle: look } = {}) {
  const drawing = drawingOf(model, newNoteStyle(look))
  const idFor = noteIds(existingIds)
  const frameIds = new Map(drawing.frames.map((frame) => [frame.name, idFor(frame.name)]))
  const noteId = new Map(drawing.notes.map((note) => [note.name, idFor(note.name)]))
  const endId = (name) => noteId.get(name) ?? frameIds.get(name)

  const layout = layoutDiagram({
    nodes: drawing.notes.map((note) => ({ id: note.name, width: note.width, height: note.height, order: note.order })),
    edges: drawing.lines.map((line) => ({ from: line.from, to: line.to, label: line.style.label || '' })),
    groups: drawing.frames.map((frame) => ({
      id: frame.name, title: frame.title, members: frame.members, direction: frame.direction, order: frame.order,
    })),
    direction: drawing.direction,
  })
  const round = (value) => Math.round(value)
  const operations = []
  // Frames first, outer ones before inner ones, so each is drawn behind what it holds.
  const frameOf = new Map()
  for (const frame of drawing.frames) for (const member of frame.members) frameOf.set(member, frame.name)
  const depths = new Map()
  const depth = (name) => {
    const chain = []
    let at = name
    while (!depths.has(at) && frameOf.has(at) && chain.length <= drawing.frames.length) {
      chain.push(at)
      at = frameOf.get(at)
    }
    let d = depths.get(at) ?? 0
    for (let k = chain.length - 1; k >= 0; k -= 1) depths.set(chain[k], (d += 1))
    return depths.get(name) ?? 0
  }
  const frames = [...drawing.frames].sort((a, b) => depth(a.name) - depth(b.name))
  for (const frame of frames) {
    const box = layout.groups.get(frame.name)
    operations.push({
      kind: 'add_nodes',
      count: 1,
      ids: [frameIds.get(frame.name)],
      shape: 'rectangle',
      text: frame.title ?? '',
      x: round(origin.x + box.x),
      y: round(origin.y + box.y),
      width: round(Math.min(5000, box.width)),
      height: round(Math.min(5000, box.height)),
      style: FRAME_STYLE,
    })
  }
  for (const note of drawing.notes) {
    const at = layout.nodes.get(note.name)
    operations.push({
      kind: 'add_nodes',
      count: 1,
      ids: [noteId.get(note.name)],
      shape: note.shape,
      text: note.text.slice(0, 10000),
      x: round(origin.x + at.x),
      y: round(origin.y + at.y),
      width: note.width,
      height: note.height,
      ...(Object.keys(note.style).length || note.link
        ? { style: { ...note.style, ...(note.link && { link: note.link }) } }
        : {}),
    })
  }
  const pairs = new Set()
  const connectorIds = new Set(existingConnectorIds)
  let dropped = 0
  let loops = 0
  let unknown = 0
  for (const line of drawing.lines) {
    const from = endId(line.from)
    const to = endId(line.to)
    if (!from || !to) {
      unknown += 1
      continue
    }
    // A slate's line joins two notes; one from a note to itself cannot be drawn.
    if (from === to) {
      loops += 1
      continue
    }
    // The slate keeps one line from a note to another; a second from the same note to the same note is one line.
    const pair = `${from}\u0000${to}`
    if (pairs.has(pair)) {
      dropped += 1
      continue
    }
    pairs.add(pair)
    let id = `${from}->${to}`
    for (let k = 2; connectorIds.has(id); k += 1) id = `${from}->${to}~${k}`
    connectorIds.add(id)
    operations.push({ kind: 'connect_nodes', from: { ids: [from] }, to: { ids: [to] }, ids: [id], style: line.style })
  }
  const lines = (n) => `${n} line${n === 1 ? '' : 's'}`
  const was = (n) => (n === 1 ? 'was' : 'were')
  if (dropped) drawing.warnings.push(`${lines(dropped)} repeating another ${was(dropped)} drawn once.`)
  if (loops) drawing.warnings.push(`${lines(loops)} from a step to itself ${loops === 1 ? 'is' : 'are'} left out: a line on a slate joins two notes.`)
  if (unknown) drawing.warnings.push(`${lines(unknown)} naming a step that is not drawn ${unknown === 1 ? 'is' : 'are'} left out.`)

  const plans = []
  for (let start = 0; start < operations.length; start += OPERATIONS_PER_PLAN) {
    const part = operations.slice(start, start + OPERATIONS_PER_PLAN)
    plans.push({ message: importMessage(drawing, start === 0), operations: part })
  }
  return {
    kind: drawing.kind,
    plans,
    mindMap: Boolean(drawing.mindMap),
    title: drawing.title ?? model.title ?? null,
    notes: drawing.notes.length,
    frames: drawing.frames.length,
    lines: operations.filter((op) => op.kind === 'connect_nodes').length,
    created: operations.filter((op) => op.kind === 'add_nodes').map((op) => op.ids[0]),
    bounds: { x: origin.x, y: origin.y, width: round(layout.width), height: round(layout.height) },
    warnings: drawing.warnings,
  }
}

const KIND_NAME = { flowchart: 'flowchart', mindmap: 'mind map', gantt: 'Gantt chart' }
function importMessage(drawing, first) {
  const what = `${drawing.notes.length} note${drawing.notes.length === 1 ? '' : 's'}`
  return first ? `Imported a Mermaid ${KIND_NAME[drawing.kind]}: ${what}.` : `Imported a Mermaid ${KIND_NAME[drawing.kind]} (continued).`
}

/** Where an import goes on a slate that already has notes: to the right of them, top-aligned. */
export function importOrigin(nodes = []) {
  const boxes = nodes
    .map((node) => node?.options)
    .filter(Boolean)
    .map((o) => ({ x: Number(o.xPos ?? o.x ?? 0), y: Number(o.yPos ?? o.y ?? 0), w: Number(o.width ?? 120), h: Number(o.height ?? 80) }))
    .filter((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite))
  if (!boxes.length) return { x: 5000, y: 5000 }
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const top = Math.min(...boxes.map((b) => b.y))
  return { x: Math.round(right + 200), y: Math.round(top) }
}
