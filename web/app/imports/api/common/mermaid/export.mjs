// Any slate as Mermaid text. Notes and lines become a flowchart (direction read from the
// layout, shapes, labels, arrow ends and line styles kept); a note drawn behind others that it
// holds (a frame, a lane) becomes a subgraph of them; a workshop's lanes and cards become
// subgraphs of cards; a mind map that is a tree becomes a mindmap; a launch plan can be a Gantt
// chart. Export needs no renderer: this is plain text work, safe on the server and the client.
import { MermaidError } from './parse.mjs'
import { encodeLabel, idNamer, quoted } from './text.mjs'

export const MERMAID_FORMATS = ['auto', 'flowchart', 'mindmap', 'gantt']

// The slate's shapes as Mermaid's classic shapes (the ones every Mermaid renderer draws).
const FLOW_SHAPES = {
  rectangle: ['[', ']'],
  roundedrectangle: ['(', ')'],
  ellipse: ['([', '])'],
  circle: ['((', '))'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
  parallelogram: ['[/', '/]'],
  trapezium: ['[/', '\\]'],
  rarrow: ['>', ']'],
  larrow: ['>', ']'],
}
const MIND_SHAPES = {
  rectangle: ['[', ']'],
  roundedrectangle: ['(', ')'],
  circle: ['((', '))'],
  hexagon: ['{{', '}}'],
  star: ['))', '(('],
  ellipse: [')', '('],
}
const SHAPE_ALIASES = { rect: 'rectangle', roundrect: 'roundedrectangle', rounded: 'roundedrectangle', stickynote: 'rectangle' }

function shapeOf(options) {
  for (const value of [options.shape, options.shapeHint, options.vectorPath]) {
    if (typeof value !== 'string') continue
    const name = value.toLowerCase()
    if (FLOW_SHAPES[name] || MIND_SHAPES[name] || ['star', 'triangle', 'pentagon', 'octagon'].includes(name)) return name
    if (SHAPE_ALIASES[name]) return SHAPE_ALIASES[name]
  }
  return 'rectangle'
}

const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
const boxOf = (o) => ({ x: num(o.xPos ?? o.x, 0), y: num(o.yPos ?? o.y, 0), width: num(o.width, 120), height: num(o.height, 80) })
const isFreeEnd = (a) => Boolean(a.targetPoint) || `${a.childId ?? ''}`.startsWith('__free_')
const COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** The slate's notes and lines as a graph: what every format is written from. */
export function slateGraph(slate) {
  const warnings = []
  const stored = (Array.isArray(slate?.nodes) ? slate.nodes : []).filter((node) => node?.options?.id !== undefined)
  // Comment markers are notes about the slate, not part of the drawing.
  const notes = stored
    .filter((node) => node.options.isComment !== true)
    .map((node, order) => {
      const o = node.options
      const text = `${o.text ?? ''}`.trim() || (o.image ? `${o.name ?? ''}`.trim() : '')
      const link = o.link?.show && o.link.type === 'url' && /^https?:\/\//i.test(o.link.data ?? '') ? o.link.data : null
      return {
        id: `${o.id}`,
        text,
        shape: shapeOf(o),
        box: boxOf(o),
        order,
        look: {
          ...(COLOR.test(o.backgroundColor ?? '') && { fill: o.backgroundColor }),
          ...(COLOR.test(o.borderColor ?? '') && { stroke: o.borderColor }),
          ...(COLOR.test(o.foregroundColor ?? '') && { color: o.foregroundColor }),
        },
        link,
      }
    })
  const byId = new Map(notes.map((note) => [note.id, note]))
  const lines = []
  const seen = new Set()
  let free = 0
  for (const node of stored) {
    for (const a of node.relationships?.associations || []) {
      const parentId = `${a.parentId ?? node.options.id}`
      const key = a.id ?? `${parentId}->${a.childId}`
      if (seen.has(key)) continue
      seen.add(key)
      if (isFreeEnd(a)) {
        free += 1
        continue
      }
      if (!byId.has(parentId) || !byId.has(`${a.childId}`)) continue
      lines.push({
        from: parentId,
        to: `${a.childId}`,
        label: `${a.label ?? ''}`.trim(),
        childArrow: a.showChildArrow !== false,
        parentArrow: a.showParentArrow === true,
        dash: a.lineDash === 'dashed' || a.lineDash === 'dotted',
        dashed: a.lineDash === 'dashed' && num(a.lineOpacity, 1) !== 0,
        thick: num(a.lineWidth, 3) >= 5,
        hidden: num(a.lineOpacity, 1) === 0,
      })
    }
  }
  if (free) warnings.push(`${free} line${free === 1 ? '' : 's'} with an end on the open canvas ${free === 1 ? 'is' : 'are'} left out: Mermaid lines join two steps.`)
  const dashed = lines.filter((line) => line.dashed).length
  if (dashed)
    warnings.push(`Mermaid has one broken-line style: ${dashed} dashed line${dashed === 1 ? ' is' : 's are'} written as dotted (-.->), and ${dashed === 1 ? 'comes' : 'come'} back dotted.`)
  return { notes, lines, frames: findFrames(notes), warnings }
}

/**
 * Frames: a note drawn behind others that it wholly holds. Each note belongs to the smallest
 * frame holding it; a frame may sit inside another.
 */
function findFrames(notes) {
  const holds = (outer, inner) =>
    outer.order < inner.order &&
    inner.box.x >= outer.box.x - 1 &&
    inner.box.y >= outer.box.y - 1 &&
    inner.box.x + inner.box.width <= outer.box.x + outer.box.width + 1 &&
    inner.box.y + inner.box.height <= outer.box.y + outer.box.height + 1 &&
    (outer.box.width * outer.box.height > inner.box.width * inner.box.height)
  const parent = new Map()
  for (const note of notes) {
    let best = null
    for (const other of notes) {
      if (other === note || !holds(other, note)) continue
      if (!best || other.box.width * other.box.height < best.box.width * best.box.height) best = other
    }
    if (best) parent.set(note.id, best.id)
  }
  const frames = new Map()
  for (const [child, frame] of parent) {
    if (!frames.has(frame)) frames.set(frame, [])
    frames.get(frame).push(child)
  }
  return { parent, members: frames }
}

/**
 * Which way a graph reads: the way its lines mostly run. With a frame, the way the lines among
 * that frame's own notes and frames run (null when none do).
 */
export function inferDirection(graph, frame) {
  const { sx, sy, counted } = lineRuns(graph).get(frame) || { sx: 0, sy: 0, counted: 0 }
  if (!counted) {
    if (frame !== undefined) return null
    const xs = graph.notes.map((n) => n.box.x)
    const ys = graph.notes.map((n) => n.box.y)
    const wide = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
    const tall = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
    return wide > tall ? 'LR' : 'TD'
  }
  if (Math.abs(sx) > Math.abs(sy)) return sx >= 0 ? 'LR' : 'RL'
  return sy >= 0 ? 'TD' : 'BT'
}

const TOP = Symbol('top')
const runsOf = new WeakMap()
/**
 * For every frame (and the top), the sum of how far the lines among its own members run across
 * and down. Each line counts in one place: the innermost frame holding both its ends, between the
 * members of that frame its ends sit in. One pass over the lines, kept with the graph.
 */
function lineRuns(graph) {
  if (runsOf.has(graph)) return runsOf.get(graph)
  const byId = new Map(graph.notes.map((n) => [n.id, n]))
  const { parent } = graph.frames
  const containers = (id) => {
    const chain = []
    const seen = new Set()
    for (let at = parent.get(id); at !== undefined && !seen.has(at); at = parent.get(at)) {
      seen.add(at)
      chain.push(at)
    }
    chain.push(TOP)
    return chain
  }
  const runs = new Map()
  for (const line of graph.lines) {
    const up = containers(line.from)
    const down = containers(line.to)
    const downAt = new Map(down.map((frame, k) => [frame, k]))
    const k = up.findIndex((frame) => downAt.has(frame))
    const frame = up[k]
    const from = k === 0 ? line.from : up[k - 1]
    const j = downAt.get(frame)
    const to = j === 0 ? line.to : down[j - 1]
    if (from === to) continue
    const a = byId.get(from).box
    const b = byId.get(to).box
    const flip = line.parentArrow && !line.childArrow ? -1 : 1
    const key = frame === TOP ? undefined : frame
    const run = runs.get(key) || { sx: 0, sy: 0, counted: 0 }
    run.sx += flip * (b.x + b.width / 2 - (a.x + a.width / 2))
    run.sy += flip * (b.y + b.height / 2 - (a.y + a.height / 2))
    run.counted += 1
    runs.set(key, run)
  }
  runsOf.set(graph, runs)
  return runs
}

/** A tree for a mind map: one root, each note under at most one, every note reached. */
function asTree(graph) {
  if (graph.frames.members.size) return null
  const parents = new Map()
  for (const line of graph.lines) {
    if (line.label) return null
    if (parents.has(line.to)) return null
    parents.set(line.to, line.from)
  }
  const roots = graph.notes.filter((n) => !parents.has(n.id))
  if (roots.length !== 1) return null
  const children = new Map()
  for (const line of graph.lines) (children.get(line.from) || children.set(line.from, []).get(line.from)).push(line.to)
  const reached = new Set()
  const stack = [roots[0].id]
  while (stack.length) {
    const id = stack.pop()
    if (reached.has(id)) return null
    reached.add(id)
    stack.push(...(children.get(id) || []))
  }
  return reached.size === graph.notes.length ? { root: roots[0].id, children } : null
}

const workshopOf = (slate) => (slate?.creative?.model?.kind === 'workshop' ? slate.creative.model.workshop : null)

/** The formats a slate can be written as. */
export function mermaidFormats(slate) {
  const formats = ['flowchart']
  const graph = slateGraph(slate)
  if (graph.notes.length) formats.push('mindmap')
  if (workshopOf(slate)?.kind === 'release-plan') formats.push('gantt')
  return formats
}

/**
 * The slate as Mermaid. options.format: auto (default), flowchart, mindmap or gantt.
 * options.styles: also write each note's colours. options.start: a Gantt chart's first day
 * (YYYY-MM-DD; default today, from options.now).
 */
export function slateToMermaid(slate, { format = 'auto', styles = false, start, now = Date.now } = {}) {
  if (!MERMAID_FORMATS.includes(format)) throw new MermaidError('mermaid_invalid', `Choose one of ${MERMAID_FORMATS.join(', ')}.`)
  const graph = slateGraph(slate)
  const workshop = workshopOf(slate)
  let chosen = format
  if (format === 'auto') chosen = slate?.options?.mindMapMode && !workshop && asTree(graph) ? 'mindmap' : 'flowchart'
  if (chosen === 'gantt' && workshop?.kind !== 'release-plan')
    throw new MermaidError(
      'mermaid_unavailable',
      'A Gantt chart is written from a launch plan (its lanes and cards with points). This slate has none; choose flowchart or mind map.'
    )
  if (chosen === 'mindmap' && !graph.notes.length)
    throw new MermaidError('mermaid_unavailable', 'A mind map needs at least one note. Choose flowchart.')

  const name = `${slate?.options?.name ?? ''}`.trim()
  let text
  let counts
  if (chosen === 'gantt') ({ text, counts } = writeGantt(workshop, name, start, now))
  else if (chosen === 'mindmap') ({ text, counts } = writeMindmap(graph, name))
  else ({ text, counts } = writeFlowchart(graph, workshop, name, styles))
  return {
    format: chosen,
    mermaid: text,
    markdown: '```mermaid\n' + text + '\n```\n',
    ...counts,
    formats: mermaidFormats(slate),
    warnings: [...graph.warnings, ...(counts.warnings || [])],
  }
}

function frontMatter(name) {
  // A YAML double-quoted string: JSON's escapes are YAML's.
  return name ? `---\ntitle: ${JSON.stringify(name)}\n---\n` : ''
}

function writeFlowchart(graph, workshop, name, styles) {
  const direction = inferDirection(graph)
  const named = idNamer('n')
  const out = [`${frontMatter(name)}flowchart ${direction}`]
  const byId = new Map(graph.notes.map((n) => [n.id, n]))
  const reading = (a, b) =>
    direction === 'LR' || direction === 'RL'
      ? a.box.x - b.box.x || a.box.y - b.box.y || a.order - b.order
      : a.box.y - b.box.y || a.box.x - b.box.x || a.order - b.order
  const childrenOf = (frameId) => (graph.frames.members.get(frameId) || []).map((id) => byId.get(id)).sort(reading)
  const top = graph.notes.filter((n) => !graph.frames.parent.has(n.id)).sort(reading)
  const nodeLine = (note) => {
    const [open, close] = FLOW_SHAPES[note.shape] || FLOW_SHAPES.rectangle
    return `${named(note.id)}${open}${quoted(note.text)}${close}`
  }
  let subgraphs = 0
  const write = (note, depth, outer) => {
    const pad = '  '.repeat(depth)
    if (graph.frames.members.has(note.id)) {
      subgraphs += 1
      out.push(`${pad}subgraph ${named(note.id)}[${quoted(note.text)}]`)
      // A frame whose own lines run another way than its surroundings says so.
      const own = inferDirection(graph, note.id) ?? outer
      if (own !== outer) out.push(`${pad}  direction ${own === 'TD' ? 'TB' : own}`)
      for (const child of childrenOf(note.id)) write(child, depth + 1, own)
      out.push(`${pad}end`)
    } else out.push(pad + nodeLine(note))
  }
  for (const note of top) write(note, 1, direction)

  // A workshop's lanes and cards: each lane a subgraph of its cards.
  const extraLines = []
  const workshopWarnings = []
  let cards = 0
  if (workshop) {
    const laneName = (id) => named(`lane-${id}`)
    const cardName = (id) => named(`card-${id}`)
    const { lanes, cardsIn, left } = boardOf(workshop)
    const written = new Set()
    for (const lane of lanes) {
      subgraphs += 1
      const station = lane.station?.outcome ? `\n${lane.station.outcome}` : ''
      out.push(`  subgraph ${laneName(lane.id)}[${quoted(`${lane.label ?? ''}${station}`)}]`)
      for (const card of cardsIn(lane.id)) {
        cards += 1
        written.add(card.id)
        out.push(`    ${cardName(card.id)}[${quoted(`${card.label ?? ''}${pointsText(workshop, card)}`)}]`)
      }
      out.push('  end')
    }
    const laneIds = new Set(lanes.map((lane) => lane.id))
    for (const lane of lanes)
      for (const next of lane.station?.next || []) if (laneIds.has(next)) extraLines.push(`  ${laneName(lane.id)} --> ${laneName(next)}`)
    let gone = 0
    for (const card of workshop.cards || []) {
      if (!written.has(card.id)) continue
      for (const before of card.dependsOn || []) {
        if (written.has(before)) extraLines.push(`  ${cardName(before)} --> ${cardName(card.id)}`)
        else gone += 1
      }
    }
    workshopWarnings.push(...boardWarnings(left, gone))
  }

  // Lines come after every block, so naming a note in a line never moves it into a subgraph;
  // in the order of the notes they start from, as written above.
  const written = new Map()
  const rank = (note) => {
    if (!written.has(note.id)) written.set(note.id, written.size)
    for (const child of graph.frames.members.has(note.id) ? childrenOf(note.id) : []) rank(child)
  }
  top.forEach(rank)
  const lines = graph.lines
    .map((line, k) => ({ line, k }))
    .sort((a, b) => written.get(a.line.from) - written.get(b.line.from) || written.get(a.line.to) - written.get(b.line.to) || a.k - b.k)
  for (const { line } of lines) out.push(`  ${edgeLine(line, named)}`)
  out.push(...extraLines)
  for (const note of graph.notes)
    if (note.link) out.push(`  click ${named(note.id)} "${note.link.replace(/["\\\s<>`]/g, encodeURIComponent)}" _blank`)
  if (styles) {
    for (const note of graph.notes) {
      const look = Object.entries(note.look).map(([k, v]) => `${k}:${v}`)
      if (look.length) out.push(`  style ${named(note.id)} ${look.join(',')}`)
    }
  }
  return {
    text: out.join('\n'),
    counts: {
      notes: graph.notes.length - graph.frames.members.size + cards,
      lines: graph.lines.length + extraLines.length,
      subgraphs,
      warnings: workshopWarnings,
    },
  }
}

function edgeLine(line, named) {
  let from = line.from
  let to = line.to
  let head = line.childArrow
  const tail = line.parentArrow
  // An arrow only at the start reads, in Mermaid, as a line the other way.
  if (tail && !head) {
    ;[from, to] = [to, from]
    head = true
  }
  const both = head && tail
  let link
  if (line.hidden) link = '~~~'
  else if (line.dash) link = both ? '<-.->' : head ? '-.->' : '-.-'
  else if (line.thick) link = both ? '<==>' : head ? '==>' : '==='
  else link = both ? '<-->' : head ? '-->' : '---'
  const label = line.label && !line.hidden ? `|${quoted(line.label)}|` : ''
  return `${named(from)} ${link}${label} ${named(to)}`
}

function writeMindmap(graph, name) {
  const warnings = []
  const named = idNamer('n')
  const byId = new Map(graph.notes.map((n) => [n.id, n]))
  let tree = asTree(graph)
  let rootNote
  const out = ['mindmap']
  if (!tree) {
    // Not one tree: each note under the first line that reaches it, every top note under the slate's name.
    const children = new Map()
    const placed = new Set()
    const ordered = [...graph.notes].sort((a, b) => a.order - b.order)
    const incoming = new Set(graph.lines.map((l) => l.to))
    const tops = ordered.filter((n) => !incoming.has(n.id))
    const queue = [...(tops.length ? tops : ordered.slice(0, 1))].map((n) => n.id)
    queue.forEach((id) => placed.add(id))
    let dropped = 0
    for (let k = 0; k < queue.length; k += 1) {
      for (const line of graph.lines.filter((l) => l.from === queue[k])) {
        if (placed.has(line.to)) {
          dropped += 1
          continue
        }
        placed.add(line.to)
        ;(children.get(queue[k]) || children.set(queue[k], []).get(queue[k])).push(line.to)
        queue.push(line.to)
      }
      if (k === queue.length - 1) {
        const next = ordered.find((n) => !placed.has(n.id))
        if (next) {
          placed.add(next.id)
          queue.push(next.id)
          tops.push(next)
        }
      }
    }
    if (dropped) warnings.push(`${dropped} line${dropped === 1 ? '' : 's'} joining notes already in the mind map ${dropped === 1 ? 'is' : 'are'} left out.`)
    if (graph.lines.some((l) => l.label)) warnings.push('Mind maps have no line labels; they are left out.')
    if (tops.length === 1) tree = { root: tops[0].id, children }
    else {
      rootNote = { id: '\u0000root', text: name || 'Slate', shape: 'rectangle' }
      children.set(rootNote.id, tops.map((n) => n.id))
      tree = { root: rootNote.id, children }
    }
  }
  const write = (id, depth) => {
    const note = id === rootNote?.id ? rootNote : byId.get(id)
    const [open, close] = MIND_SHAPES[note.shape] || MIND_SHAPES.rectangle
    out.push(`${'  '.repeat(depth)}${named(id === rootNote?.id ? 'root' : id)}${open}${quoted(note.text)}${close}`)
    const kids = (tree.children.get(id) || []).map((k) => byId.get(k)).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
    for (const kid of kids) write(kid.id, depth + 1)
  }
  write(tree.root, 1)
  return { text: out.join('\n'), counts: { notes: graph.notes.length, lines: graph.lines.length, subgraphs: 0, warnings } }
}

// A Gantt name is not quoted: a colon would end it, so it is written as a code like the rest.
// Mermaid's Gantt reader takes a line that starts with one of its words (section, title,
// excludes, click, a date ...) as that command, whatever its case; such a name starts with its
// first letter written as a code, so it stays a name.
const GANTT_WORDS =
  /^(?:accTitle|accDescr|accDescription|href|call|click|gantt|dateFormat|inclusiveEndDates|topAxis|axisFormat|tickInterval|includes|excludes|todayMarker|weekday|weekend|title|section)(?![A-Za-z0-9_])|^\d{4}-\d\d-\d\d/i
const ganttText = (text, fallback) => {
  const plain = `${text ?? ''}`.replace(/\s*\n\s*/g, ' ').trim() || fallback
  const code = encodeLabel(plain).replace(/:/g, '#58;')
  return GANTT_WORDS.test(plain) ? `#${plain.codePointAt(0)};${code.slice(String.fromCodePoint(plain.codePointAt(0)).length)}` : code
}

/** A card's points as words on the card: 1 point, 3 points. */
function pointsText(workshop, card) {
  if (workshop.kind !== 'release-plan' || card.points === undefined || card.points === null) return ''
  return `\n${card.points} point${Number(card.points) === 1 ? '' : 's'}`
}

/** A board's lanes in their shown order (any lane left out of that order after it), and their cards. */
function boardOf(workshop) {
  const all = (workshop.lanes || []).filter((lane) => lane && lane.id !== undefined)
  const byId = new Map(all.map((lane) => [lane.id, lane]))
  const shown = (workshop.presentationOrder || []).map((id) => byId.get(id)).filter(Boolean)
  const lanes = [...new Set([...shown, ...all])]
  const cards = (workshop.cards || []).filter((card) => card && card.id !== undefined)
  const cardsIn = (laneId) => cards.filter((card) => card.laneId === laneId)
  const left = cards.filter((card) => !byId.has(card.laneId)).length
  return { lanes, cardsIn, left }
}

function boardWarnings(left, gone, loops = 0) {
  const warnings = []
  if (left) warnings.push(`${left} card${left === 1 ? ' is' : 's are'} in no lane on the board and left out.`)
  if (gone) warnings.push(`${gone} card dependenc${gone === 1 ? 'y names a card' : 'ies name cards'} no longer on the board, left out.`)
  if (loops) warnings.push(`${loops} card dependenc${loops === 1 ? 'y is' : 'ies are'} left out: those cards depend on each other, and a Gantt chart needs an order.`)
  return warnings
}

function day(value, now) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) return value
  return new Date(now()).toISOString().slice(0, 10)
}

function writeGantt(workshop, name, start, now) {
  const named = idNamer('t')
  const out = ['gantt']
  out.push(`  title ${ganttText(name || workshop.title, 'Launch plan')}`)
  out.push('  dateFormat YYYY-MM-DD')
  const { lanes, cardsIn, left } = boardOf(workshop)
  const sections = lanes.map((lane) => ({ lane, cards: cardsIn(lane.id) })).filter((section) => section.cards.length)
  const onBoard = new Set(sections.flatMap((section) => section.cards.map((card) => card.id)))

  // What each card starts after: every card of the lane before (lanes run in order), and the
  // cards it depends on. A dependency that would close a loop is left out, so every task has a start.
  const after = new Map()
  const reaches = (from, target) => {
    const seen = new Set([from])
    const queue = [from]
    for (let k = 0; k < queue.length; k += 1) {
      if (queue[k] === target) return true
      for (const [card, befores] of after) if (befores.has(queue[k]) && !seen.has(card)) {
        seen.add(card)
        queue.push(card)
      }
    }
    return false
  }
  let previous = []
  for (const { cards } of sections) {
    for (const card of cards) after.set(card.id, new Set(previous))
    previous = cards.map((card) => card.id)
  }
  let gone = 0
  let loops = 0
  let lines = 0
  for (const { cards } of sections)
    for (const card of cards)
      for (const before of card.dependsOn || []) {
        if (!onBoard.has(before) || before === card.id) {
          gone += before === card.id ? 0 : 1
          loops += before === card.id ? 1 : 0
          continue
        }
        if (after.get(card.id).has(before)) {
          lines += 1
          continue
        }
        // before -> card closes a loop when card already leads to before.
        if (reaches(card.id, before)) {
          loops += 1
          continue
        }
        after.get(card.id).add(before)
        lines += 1
      }

  let tasks = 0
  for (const { lane, cards } of sections) {
    out.push(`  section ${ganttText(lane.label, 'Lane')}`)
    for (const card of cards) {
      tasks += 1
      const befores = [...after.get(card.id)].map((id) => named(`card-${id}`))
      // Only the first lane's cards with no dependencies start on the first day.
      const when = befores.length ? `after ${befores.join(' ')}` : day(start, now)
      const length = `${Math.max(1, Math.round(Number(card.points) || 1))}d`
      out.push(`  ${ganttText(card.label, 'Card')} :${named(`card-${card.id}`)}, ${when}, ${length}`)
    }
  }
  return { text: out.join('\n'), counts: { notes: tasks, lines, subgraphs: sections.length, warnings: boardWarnings(left, gone, loops) } }
}
