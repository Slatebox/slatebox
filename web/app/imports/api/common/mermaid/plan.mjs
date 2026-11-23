// An imported diagram as canvas operation plans: real notes (add_nodes) and lines
// (connect_nodes), the same plans an agent or the canvas conversation sends. The engine's
// applier draws them, so an import is an ordinary edit: saved by the save core, sent to everyone
// on the slate, and readable afterwards. Plans keep to the public limits (50 operations each).
import { labelSize, layoutDiagram, noteSize } from './layout.mjs'

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
  drawing.lines.forEach((line, index) => {
    if (layout.labelAt.has(index)) line.style = { ...line.style, labelPosition: Math.round(layout.labelAt.get(index) * 100) / 100 }
  })
  const sides = sideRoutes(drawing, layout, frameOf)
  const routed = []
  for (const [index, line] of drawing.lines.entries()) {
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
    const side = sides.get(index)
    const style = side ? Object.fromEntries(Object.entries(line.style).filter(([key]) => key !== 'labelPosition')) : line.style
    operations.push({ kind: 'connect_nodes', from: { ids: [from] }, to: { ids: [to] }, ids: [id], style })
    if (side) routed.push({ id, side })
  }
  // A line that would be drawn over another one running the other way leaves and enters its notes on one side,
  // curving round beside them (connect_nodes takes no ends, so the ends are set once the line is there).
  for (const { id, side } of routed) {
    operations.push({ kind: 'update_connections', connectionIds: [id], changes: { fromEnd: side.name, toEnd: side.name } })
  }
  const box = { minX: 0, minY: 0, maxX: layout.width, maxY: layout.height }
  for (const { side } of routed) {
    for (const [x, y] of side.points) {
      box.minX = Math.min(box.minX, x - SIDE_ROUTE_MARGIN)
      box.minY = Math.min(box.minY, y - SIDE_ROUTE_MARGIN)
      box.maxX = Math.max(box.maxX, x + SIDE_ROUTE_MARGIN)
      box.maxY = Math.max(box.maxY, y + SIDE_ROUTE_MARGIN)
    }
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
    bounds: { x: round(origin.x + box.minX), y: round(origin.y + box.minY), width: round(box.maxX - box.minX), height: round(box.maxY - box.minY) },
    warnings: drawing.warnings,
  }
}

// The canvas draws a line whose ends are pinned to the middle of a side as a cubic curve leaving and entering
// along that side's outward normal, its handles 0.12 + 0.55 x curviness (0.3, the default) of the span, at
// least 20 (slateboxjs svg.connectable geometry). sideRoutes samples the same curve.
const SIDE_HANDLE = 0.12 + 0.55 * 0.3
const SIDE_ROUTE_MARGIN = 8
const SIDE_NORMAL = { right: [1, 0], left: [-1, 0], bottom: [0, 1], top: [0, -1] }

/**
 * Lines drawn on top of each other: two lines between the same two ends, running opposite ways, where an end
 * may be a frame holding the other line's end (a note and the frame holding it share a middle line). The
 * one running back against the layout (up, or leftwards) is routed round one side of its notes, a side where
 * the curve meets no other note. Returns line index -> { name, points } (points: the sampled curve).
 */
function sideRoutes(drawing, layout, frameOf) {
  const routes = new Map()
  const notes = new Map(drawing.notes.map((note) => [note.name, note]))
  const boxOf = (name) => {
    const group = layout.groups.get(name)
    if (group) return group
    const at = layout.nodes.get(name)
    const note = notes.get(name)
    return at && note ? { x: at.x, y: at.y, width: note.width, height: note.height } : null
  }
  const holds = (outer, name) => {
    for (let at = name, hops = 0; at != null && hops <= drawing.frames.length + 1; at = frameOf.get(at), hops += 1) if (at === outer) return true
    return false
  }
  const meets = (a, b) => holds(a, b) || holds(b, a)
  const centre = (b) => [b.x + b.width / 2, b.y + b.height / 2]
  const lines = drawing.lines.map((line, index) => ({ line, index, from: boxOf(line.from), to: boxOf(line.to) }))
    .filter((l) => l.from && l.to && l.line.from !== l.line.to)
  const names = [...drawing.notes.map((note) => note.name), ...drawing.frames.map((frame) => frame.name)]
  const back = (l) => {
    const [fx, fy] = centre(l.from)
    const [tx, ty] = centre(l.to)
    return Math.abs(ty - fy) >= Math.abs(tx - fx) ? ty < fy : tx < fx
  }
  const frameNames = new Set(drawing.frames.map((frame) => frame.name))
  const titles = drawing.frames.map((frame) => {
    const b = boxOf(frame.name)
    return { name: frame.name, box: { x: b.x, y: b.y, width: Math.min(b.width, [...`${frame.title ?? ''}`].length * 9.6 + 28), height: 40 } }
  })
  // Where each line's label sits while the line is straight (border to border, at its place along it).
  const chipAt = (mid, text) => {
    const { width, height } = labelSize(text)
    return { x: mid.x - width / 2, y: mid.y - height / 2, width, height }
  }
  const chips = new Map()
  for (const l of lines) {
    if (!l.line.style?.label) continue
    const [p, q] = straight(l.from, l.to, centre)
    const at = layout.labelAt.get(l.index) ?? 0.5
    chips.set(l.index, chipAt({ x: p[0] + (q[0] - p[0]) * at, y: p[1] + (q[1] - p[1]) * at }, l.line.style.label))
  }
  const context = { names, boxOf, holds, centre, titles, frameNames, chips, chipAt }
  for (const a of lines) {
    if (routes.has(a.index)) continue
    const b = lines.find((o) => o.index !== a.index && !routes.has(o.index) && meets(a.line.from, o.line.to) && meets(a.line.to, o.line.from))
    if (!b) continue
    // The one running back is routed; when both or neither run back, the one written later.
    const routedLine = back(a) !== back(b) ? (back(a) ? a : b) : (a.index > b.index ? a : b)
    const route = sideRoute(routedLine, context)
    if (route?.chip) context.chips.set(routedLine.index, route.chip)
    else if (route) context.chips.delete(routedLine.index)
    if (route) routes.set(routedLine.index, route)
  }
  return routes
}

function sideRoute(l, { names, boxOf, holds, centre, titles, frameNames, chips, chipAt }) {
  const [fx, fy] = centre(l.from)
  const [tx, ty] = centre(l.to)
  const upright = Math.abs(ty - fy) >= Math.abs(tx - fx)
  const port = (b, side) => {
    const [cx, cy] = centre(b)
    if (side === 'right') return [b.x + b.width, cy]
    if (side === 'left') return [b.x, cy]
    if (side === 'bottom') return [cx, b.y + b.height]
    return [cx, b.y]
  }
  // Every other note and frame the curve could cross: not an end, not held by an end, not holding an end.
  const ends = [l.line.from, l.line.to]
  const obstacles = names
    .filter((name) => !ends.some((end) => holds(end, name) || holds(name, end)))
    .map(boxOf)
    .filter(Boolean)
  for (const name of upright ? ['right', 'left'] : ['bottom', 'top']) {
    const p1 = port(l.from, name)
    const p2 = port(l.to, name)
    const [nx, ny] = SIDE_NORMAL[name]
    const handle = Math.max(20, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * SIDE_HANDLE)
    const c1 = [p1[0] + nx * handle, p1[1] + ny * handle]
    const c2 = [p2[0] + nx * handle, p2[1] + ny * handle]
    const points = []
    for (let k = 0; k <= 24; k += 1) {
      const t = k / 24
      const u = 1 - t
      points.push([0, 1].map((i) => u * u * u * p1[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * p2[i]))
    }
    const m = SIDE_ROUTE_MARGIN
    const off = (x, y, b, by) => x < b.x - by || x > b.x + b.width + by || y < b.y - by || y > b.y + b.height + by
    // Clear of every other note and frame, and of every frame title but the ends' own.
    const titlesInWay = titles.filter((t) => !ends.includes(t.name)).map((t) => t.box)
    if (!points.every(([x, y]) => obstacles.every((b) => off(x, y, b, m)) && titlesInWay.every((b) => off(x, y, b, 0)))) continue
    // The label, halfway along the curve, clear of notes, titles, frames holding neither end, and other labels.
    let chip = null
    if (l.line.style?.label) {
      const [x, y] = halfway(points)
      chip = chipAt({ x, y }, l.line.style.label)
      const meets = (a, b, by = 0) => a.x < b.x + b.width + by && b.x < a.x + a.width + by && a.y < b.y + b.height + by && b.y < a.y + a.height + by
      const boxes = names.filter((n) => !frameNames.has(n) || !ends.some((end) => holds(n, end))).map(boxOf).filter(Boolean)
      if (boxes.some((b) => meets(chip, b, 10)) || titles.some((t) => meets(chip, t.box))) continue
      if ([...chips].some(([index, other]) => index !== l.index && meets(chip, other, 20))) continue
    }
    return { name, points, chip }
  }
  return null
}

const straightExit = (b, from, to) => {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  let t = 1
  if (dx > 0) t = Math.min(t, (b.x + b.width - from[0]) / dx)
  if (dx < 0) t = Math.min(t, (b.x - from[0]) / dx)
  if (dy > 0) t = Math.min(t, (b.y + b.height - from[1]) / dy)
  if (dy < 0) t = Math.min(t, (b.y - from[1]) / dy)
  return [from[0] + dx * t, from[1] + dy * t]
}
/** A line following its notes: border to border on the line between their middles. */
function straight(a, b, centre) {
  const ca = centre(a)
  const cb = centre(b)
  return [straightExit(a, ca, cb), straightExit(b, cb, ca)]
}
/** The point halfway along a sampled curve, by length. */
function halfway(points) {
  const lengths = points.slice(1).map((q, i) => Math.hypot(q[0] - points[i][0], q[1] - points[i][1]))
  let left = lengths.reduce((sum, l) => sum + l, 0) / 2
  for (let i = 0; i < lengths.length; i += 1) {
    if (left <= lengths[i]) {
      const t = lengths[i] ? left / lengths[i] : 0
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t]
    }
    left -= lengths[i]
  }
  return points[points.length - 1]
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
