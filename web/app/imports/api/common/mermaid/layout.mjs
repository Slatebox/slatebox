// Laying out an imported diagram: layers in the diagram's direction, each subgraph laid out on
// its own and then placed as one block in its parent, so a subgraph's notes stay together
// inside its frame. Deterministic: the same diagram always lands the same way.
//
// The canvas draws every line straight from one note towards the other's centre, with its label
// in the middle of the drawn line, so the layout keeps those straight lines clear:
//   - what the source writes first comes first, in each frame and at the top;
//   - a line that skips layers gets a lane of its own in the layers it crosses;
//   - the gap between two layers is wide enough for the labels in it and for every line between
//     them to leave its note through the side facing the other one, never across a neighbour;
//   - a frame's title sits top left, and the frame is wide enough for it;
//   - then the whole drawing is checked as the canvas will draw it, and a note (or frame) that a
//     line or a label still runs into is moved aside in its own layer, its neighbours with it,
//     until nothing is in the way (a bounded number of rounds).
// A frame never grows past the engine's largest note: a frame too long for its layers is filled
// in rows in reading order instead, and when even that cannot fit, the import is refused with the
// frame's name. No recursion over notes or lines (only over frames, at most MERMAID_LIMITS.depth
// deep).
import { tooLarge } from './parse.mjs'

const GAP_MAIN = 90 // between layers
const GAP_CROSS = 48 // between notes in a layer
const PAD = 28 // inside a frame
const PAD_TOP = 58 // inside a frame, under its title
const FRAME_MAX = 5000 // the engine's largest note, so the largest frame
const INNER_MAX_WIDTH = FRAME_MAX - PAD * 2
const INNER_MAX_HEIGHT = FRAME_MAX - PAD - PAD_TOP
const ROW_MAX = 4900 // a layer wider than this (notes side by side with no lines) wraps into rows
const CLEAR = 14 // how far a line keeps from a note it does not join
const LABEL_CLEAR = 10 // how far a label keeps from a note
const LANE = 30 // a lane for a line that skips layers, across
const ROUNDS = 40 // rounds of moving notes out of the way
const PUSH_MAX = 900 // the furthest one move takes a note
// Where a label may sit along its line (labelPosition), tried in turn when the middle is taken.
const LABEL_PLACES = [0.35, 0.65, 0.25, 0.75, 0.2, 0.8]
const WORK = 4_000_000 // checks the rounds may spend, so a huge diagram stays quick
const TOP = Symbol('top')

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}]/u
const charsOf = (text) => [...`${text ?? ''}`].reduce((sum, ch) => sum + (WIDE.test(ch) ? 2 : 1), 0)

/** A line's label as the canvas draws it: 13px text in a chip (svg.connectable setLabel). */
export function labelSize(text) {
  return { width: charsOf(text) * 7.5 + 12, height: 20 }
}
/** A frame's title, top left in FRAME_STYLE's 16px text. */
export function titleSize(text) {
  return { width: charsOf(text) * 9.6 + 28, height: 40 }
}

/** A note's size for its text in the slate's own note font (20px), wrapping a long line. */
export function noteSize(text, shape = 'rectangle') {
  const lines = `${text ?? ''}`.split('\n')
  const widthOf = (line) => charsOf(line) * 11
  const longest = Math.max(0, ...lines.map(widthOf))
  const width = Math.round(Math.min(360, Math.max(150, longest + 56)))
  const inner = width - 48
  const rows = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(widthOf(line) / inner)), 0)
  let w = width
  let h = Math.max(76, rows * 28 + 44)
  if (shape === 'circle') w = h = Math.max(w, h, 130)
  else if (shape === 'diamond') {
    w = Math.round(w * 1.5)
    h = Math.round(h * 1.6)
  } else if (shape === 'ellipse') {
    w = Math.round(w * 1.25)
    h = Math.round(h * 1.3)
  } else if (['hexagon', 'parallelogram', 'trapezium', 'rarrow', 'larrow', 'octagon'].includes(shape)) w = Math.round(w * 1.3)
  else if (['triangle', 'star', 'pentagon'].includes(shape)) {
    w = Math.round(Math.max(w, 170) * 1.35)
    h = Math.round(Math.max(h, 130) * 1.5)
  }
  return { width: Math.min(5000, w), height: Math.min(5000, h) }
}

/**
 * nodes: [{id, width, height, order}], edges: [{from, to, label}], groups: [{id, title, members:
 * [ids of nodes and groups], direction, order}], direction: TB|BT|LR|RL.
 * Returns {nodes: Map id -> {x, y}, groups: Map id -> {x, y, width, height}, width, height,
 * labelAt: Map edge index -> place along the line for a label moved off the middle}
 * (top-left corners).
 */
export function layoutDiagram({ nodes, edges, groups = [], direction = 'TB' }) {
  const size = new Map(nodes.map((n) => [n.id, { width: n.width, height: n.height }]))
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const orderOf = new Map()
  nodes.forEach((n, i) => orderOf.set(n.id, n.order ?? i))
  groups.forEach((g, i) => orderOf.set(g.id, g.order ?? nodes.length + i))
  const parentOf = new Map()
  for (const group of groups) for (const member of group.members) parentOf.set(member, group.id)
  const byOrder = (list) => [...list].sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0))
  const topLevel = byOrder([...nodes.map((n) => n.id), ...groups.map((g) => g.id)].filter((id) => !parentOf.has(id)))

  // Each line belongs to one block: the innermost frame (or the top) holding both its ends,
  // where it joins the two members of that block its ends sit in.
  const chainOf = (id) => {
    const chain = []
    for (let at = parentOf.get(id); at !== undefined; at = parentOf.get(at)) chain.push(at)
    chain.push(TOP)
    return chain
  }
  const linesIn = new Map()
  for (const edge of edges) {
    const up = chainOf(edge.from)
    const down = chainOf(edge.to)
    const downAt = new Map(down.map((block, k) => [block, k]))
    const k = up.findIndex((block) => downAt.has(block))
    const block = up[k]
    const a = k === 0 ? edge.from : up[k - 1]
    const b = downAt.get(block) === 0 ? edge.to : down[downAt.get(block) - 1]
    if (a === b) continue
    if (!linesIn.has(block)) linesIn.set(block, [])
    // Whether the line joins these two members themselves (not notes inside them), for its label.
    linesIn.get(block).push({ a, b, label: a === edge.from && b === edge.to ? edge.label || '' : '' })
  }

  // ─── Blocks: a frame's members (or the top level) in layers ──────────────────────────────
  const blocks = new Map() // block key -> block
  const blockOf = new Map() // member id -> its block
  const keyOf = (blockId) => blockId ?? TOP

  function buildBlock(blockId, members, dir) {
    const horizontal = dir === 'LR' || dir === 'RL'
    const block = {
      id: blockId, key: keyOf(blockId), members, dir, horizontal, flip: dir === 'BT' || dir === 'RL',
      framed: blockId !== undefined, layers: [], cross: new Map(), gaps: [], extraGap: [], rows: false,
      lines: [], lanes: new Map(), shift: 0,
    }
    blocks.set(block.key, block)
    for (const member of members) {
      blockOf.set(member, block)
      if (groupById.has(member)) {
        const group = groupById.get(member)
        buildBlock(member, byOrder(group.members), group.direction || dir)
      }
    }
    const inBlock = new Set(members)
    const seen = new Set()
    for (const line of linesIn.get(block.key) || []) {
      if (!inBlock.has(line.a) || !inBlock.has(line.b)) continue
      const key = `${line.a}\u0000${line.b}`
      if (seen.has(key)) {
        // A second line between the same two members: keep the longest label for spacing.
        const kept = block.lines.find((l) => l.a === line.a && l.b === line.b)
        if (line.label.length > kept.label.length) kept.label = line.label
        continue
      }
      seen.add(key)
      block.lines.push({ ...line })
    }
    const ordered = assignLayers(members, block.lines.map((l) => [l.a, l.b]))
    // A line that skips layers gets a lane in each layer between its ends.
    const layerOf = new Map()
    ordered.forEach((layer, i) => layer.forEach((id) => layerOf.set(id, i)))
    const chained = []
    let lane = 0
    for (const line of block.lines) {
      const [from, to] = layerOf.get(line.a) <= layerOf.get(line.b) ? [line.a, line.b] : [line.b, line.a]
      let previous = from
      for (let i = layerOf.get(from) + 1; i < layerOf.get(to); i += 1) {
        const id = `\u0000lane${lane++}`
        const across = line.label ? (horizontal ? labelSize(line.label).height : labelSize(line.label).width) + 16 : LANE
        block.lanes.set(id, { across })
        ordered[i].push(id)
        chained.push([previous, id])
        previous = id
      }
      chained.push([previous, to])
    }
    orderLayers(ordered, chained)
    block.ordered = ordered
    block.chained = chained
    return block
  }

  // Sizes: a note's own, a lane's, a frame's from its block (memoised per round).
  let frameSize = new Map()
  const sizeOf = (id) => frameSize.get(id) ?? size.get(id)
  function crossOf(block, id) {
    if (block.lanes.has(id)) return block.lanes.get(id).across
    const s = sizeOf(id)
    return block.horizontal ? s.height : s.width
  }
  function mainOf(block, id) {
    if (block.lanes.has(id)) return 0
    const s = sizeOf(id)
    return block.horizontal ? s.width : s.height
  }

  buildBlock(undefined, topLevel, direction)
  const blockList = [...blocks.values()]
  // Innermost blocks first, so a frame's size is known before its parent is measured.
  const depthOf = (block) => (block.id === undefined ? 0 : chainOf(block.id).length)
  const innermostFirst = [...blockList].sort((a, b) => depthOf(b) - depthOf(a))

  // ─── Measure: positions inside each block, frame sizes, then absolute boxes ──────────────
  // Pack each layer (once its members' sizes are known), wrapping a layer too wide for a row.
  function pack(block) {
    const rowMax = block.framed ? Math.min(ROW_MAX, block.horizontal ? INNER_MAX_HEIGHT : INNER_MAX_WIDTH) : ROW_MAX
    // A layer keeps every member that has a line on one row. Members with no lines that do not
    // fit beside them wait for rows of their own after the last layer, where no line crosses.
    const joined = new Set(block.chained.flat())
    const loose = []
    for (const layer of block.ordered) {
      const row = []
      let span = 0
      for (const id of layer) {
        const add = crossOf(block, id) + (row.length ? GAP_CROSS : 0)
        if (!joined.has(id) && row.length && span + add > rowMax) {
          loose.push(id)
          continue
        }
        row.push(id)
        span += add
      }
      if (row.length) block.layers.push(row)
    }
    let row = []
    let span = 0
    for (const id of loose) {
      const add = crossOf(block, id) + (row.length ? GAP_CROSS : 0)
      if (row.length && span + add > rowMax) {
        block.layers.push(row)
        row = []
        span = 0
      }
      row.push(id)
      span += row.length > 1 ? add : crossOf(block, id)
    }
    if (row.length) block.layers.push(row)
    block.extraGap = block.layers.map(() => 0)
    const spans = block.layers.map((layer) => layer.reduce((s, id) => s + crossOf(block, id), 0) + GAP_CROSS * (layer.length - 1))
    const widest = Math.max(0, ...spans)
    block.layers.forEach((layer, i) => {
      let at = (widest - spans[i]) / 2
      for (const id of layer) {
        block.cross.set(id, at)
        at += crossOf(block, id) + GAP_CROSS
      }
    })
    straighten(block)
    block.packed = true
  }
  // Each item moves towards the middle of the items it joins in the next layer, in sweeps down
  // and up, as close as the layer's order and spacing allow: parents over their children, lines
  // short and nearly straight along the diagram's direction.
  function straighten(block) {
    const links = new Map()
    const link = (a, b) => {
      if (!links.has(a)) links.set(a, { before: [], after: [] })
      if (!links.has(b)) links.set(b, { before: [], after: [] })
      links.get(a).after.push(b)
      links.get(b).before.push(a)
    }
    for (const [a, b] of block.chained) link(a, b)
    const centre = (id) => block.cross.get(id) + crossOf(block, id) / 2
    const layerAt = new Map()
    block.layers.forEach((layer, i) => layer.forEach((id) => layerAt.set(id, i)))
    for (let sweep = 0; sweep < 6; sweep += 1) {
      const down = sweep % 2 === 0
      const order = block.layers.map((_, i) => i)
      if (!down) order.reverse()
      for (const i of order) {
        const layer = block.layers[i]
        const wanted = layer.map((id) => {
          const l = links.get(id)
          const near = (l ? (down ? l.before : l.after) : []).filter((o) => Math.abs(layerAt.get(o) - i) === 1)
          return near.length ? near.reduce((sum, o) => sum + centre(o), 0) / near.length - crossOf(block, id) / 2 : block.cross.get(id)
        })
        placeInOrder(layer, wanted, (id) => crossOf(block, id) + GAP_CROSS).forEach((x, k) => block.cross.set(layer[k], x))
      }
    }
  }
  // Members of a layer keep their order and at least GAP_CROSS apart, also after a frame grows.
  function spread(block) {
    for (const layer of block.layers)
      for (let k = 1; k < layer.length; k += 1) {
        const least = block.cross.get(layer[k - 1]) + crossOf(block, layer[k - 1]) + GAP_CROSS
        if (block.cross.get(layer[k]) < least) block.cross.set(layer[k], least)
      }
  }

  function measureBlock(block) {
    if (!block.packed) pack(block)
    spread(block)
    const thickness = block.layers.map((layer) => Math.max(0, ...layer.map((id) => mainOf(block, id))))
    // The gap after each layer: room for the labels between it and the next, and for each line
    // between them to leave its note through the facing side.
    const gaps = block.layers.map((_, i) => GAP_MAIN + block.extraGap[i])
    const layerIndex = new Map()
    block.layers.forEach((layer, i) => layer.forEach((id) => layerIndex.set(id, i)))
    const centreAcross = (id) => block.cross.get(id) + crossOf(block, id) / 2
    for (const line of block.lines) {
      const ia = layerIndex.get(line.a)
      const ib = layerIndex.get(line.b)
      if (ia === undefined || ib === undefined || Math.abs(ia - ib) !== 1) continue
      const [first, second] = ia < ib ? [line.a, line.b] : [line.b, line.a]
      const i = Math.min(ia, ib)
      if (line.label) {
        const chip = labelSize(line.label)
        gaps[i] = Math.max(gaps[i], (block.horizontal ? chip.width : chip.height) + LABEL_CLEAR * 2 + Math.abs(thickness[i] - thickness[i + 1]) / 2)
      }
      const dx = Math.abs(centreAcross(second) - centreAcross(first))
      if (dx < 1) continue
      const need = (id, t) => (dx * (t / 2)) / Math.max(1, crossOf(block, id) / 2 + GAP_CROSS / 2 - CLEAR)
      const span = Math.max(need(first, thickness[i]), need(second, thickness[i + 1]))
      gaps[i] = Math.max(gaps[i], Math.min(4000, span - thickness[i] / 2 - thickness[i + 1] / 2))
    }
    const main = new Map()
    let along = 0
    block.layers.forEach((layer, i) => {
      for (const id of layer) main.set(id, along + (thickness[i] - mainOf(block, id)) / 2)
      along += thickness[i] + (i < block.layers.length - 1 ? gaps[i] : 0)
    })
    const length = Math.max(0, along)
    let low = Infinity
    let high = -Infinity
    for (const layer of block.layers)
      for (const id of layer) {
        low = Math.min(low, block.cross.get(id))
        high = Math.max(high, block.cross.get(id) + crossOf(block, id))
      }
    if (!Number.isFinite(low)) low = high = 0
    const at = new Map()
    for (const [id, m] of main) {
      const mm = block.flip ? length - m - mainOf(block, id) : m
      const cc = block.cross.get(id) - low
      at.set(id, block.horizontal ? { x: mm, y: cc } : { x: cc, y: mm })
    }
    const width = block.horizontal ? length : high - low
    const height = block.horizontal ? high - low : length
    return { at, width, height }
  }

  // A block too long for its frame is filled in rows in reading order instead.
  function rowsOf(block) {
    const at = new Map()
    let x = 0
    let y = 0
    let rowHeight = 0
    let widthUsed = 0
    for (const id of block.members) {
      const { width, height } = sizeOf(id)
      if (x > 0 && x + width > INNER_MAX_WIDTH) {
        y += rowHeight + GAP_CROSS
        x = 0
        rowHeight = 0
      }
      at.set(id, { x, y })
      x += width + GAP_CROSS
      widthUsed = Math.max(widthUsed, x - GAP_CROSS)
      rowHeight = Math.max(rowHeight, height)
    }
    const heightUsed = y + rowHeight
    if (widthUsed > INNER_MAX_WIDTH || heightUsed > INNER_MAX_HEIGHT) {
      const group = groupById.get(block.id)
      const name = `${group?.title ?? ''}`.trim() || `${block.id}`
      throw tooLarge(
        `The subgraph "${name}" holds more than fits in one frame (${FRAME_MAX.toLocaleString('en-US')} by ${FRAME_MAX.toLocaleString('en-US')} on the slate). Split it into smaller subgraphs.`
      )
    }
    return { at, width: widthUsed, height: heightUsed }
  }

  function measure() {
    frameSize = new Map()
    const inner = new Map()
    for (const block of innermostFirst) {
      let laid = block.rows ? rowsOf(block) : measureBlock(block)
      if (block.framed && !block.rows && (laid.width > INNER_MAX_WIDTH || laid.height > INNER_MAX_HEIGHT)) {
        block.rows = true
        laid = rowsOf(block)
      }
      inner.set(block.key, laid)
      if (block.framed) {
        const group = groupById.get(block.id)
        const title = titleSize(group.title)
        const width = Math.max(laid.width + PAD * 2 + block.shift, title.width + PAD, 160)
        frameSize.set(block.id, { width, height: laid.height + PAD + PAD_TOP })
      }
    }
    const result = { nodes: new Map(), groups: new Map(), boxes: new Map() }
    const place = (block, originX, originY) => {
      const laid = inner.get(block.key)
      for (const id of block.members) {
        const p = laid.at.get(id)
        const x = originX + p.x
        const y = originY + p.y
        const { width, height } = sizeOf(id)
        result.boxes.set(id, { x, y, width, height })
        if (groupById.has(id)) {
          result.groups.set(id, { x, y, width, height })
          const child = blocks.get(id)
          const innerBox = inner.get(id)
          // The frame's contents sit centred under the title, moved right by any room kept for it.
          const left = x + (width - innerBox.width - child.shift) / 2 + child.shift
          place(child, left, y + PAD_TOP)
        } else result.nodes.set(id, { x, y })
      }
    }
    const top = inner.get(TOP)
    place(blocks.get(TOP), 0, 0)
    result.width = top.width
    result.height = top.height
    return result
  }

  // ─── Check the drawing as the canvas draws it, and move what is in the way ──────────────
  const ancestorsOf = (id) => {
    const set = new Set()
    for (let at = parentOf.get(id); at !== undefined; at = parentOf.get(at)) set.add(at)
    return set
  }
  const descendantsOf = new Map()
  for (const group of groups) {
    const all = new Set()
    const stack = [...group.members]
    while (stack.length) {
      const id = stack.pop()
      all.add(id)
      if (groupById.has(id)) stack.push(...groupById.get(id).members)
    }
    descendantsOf.set(group.id, all)
  }
  // The lines the slate will hold: one from a note to another (a repeat is drawn once), none
  // from a note to itself, as plan.mjs draws them.
  const pairs = new Set()
  const drawnLines = []
  edges.forEach((e, index) => {
    if (e.from === e.to || !(size.has(e.from) || groupById.has(e.from)) || !(size.has(e.to) || groupById.has(e.to))) return
    const pair = `${e.from}\u0000${e.to}`
    if (pairs.has(pair)) return
    pairs.add(pair)
    const ends = new Set([e.from, e.to])
    const holders = new Set([...ancestorsOf(e.from), ...ancestorsOf(e.to)])
    const behind = new Set([...(descendantsOf.get(e.from) || []), ...(descendantsOf.get(e.to) || [])])
    drawnLines.push({ ...e, index, ends, holders, behind, at: 0.5, tried: 0 })
  })
  const everything = [...size.keys(), ...groupById.keys()]
  let work = 0

  function findProblems(drawn) {
    const found = []
    const chips = []
    const boxOf = (id) => drawn.boxes.get(id)
    for (const line of drawnLines) {
      const a = boxOf(line.from)
      const b = boxOf(line.to)
      const [p, q] = segment(a, b)
      const seg = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(p.x - q.x), height: Math.abs(p.y - q.y) }
      let chip = null
      if (line.label) {
        const s = labelSize(line.label)
        const mid = { x: p.x + (q.x - p.x) * line.at, y: p.y + (q.y - p.y) * line.at }
        chip = { x: mid.x - s.width / 2, y: mid.y - s.height / 2, width: s.width, height: s.height }
        // Another line's label in the same place.
        for (const other of chips) if (overlaps(chip, grow(other.chip, 4))) found.push({ id: null, kind: 'labels', chip, line })
        chips.push({ chip, line })
      }
      for (const id of everything) {
        work += 1
        if (line.ends.has(id) || line.behind.has(id)) continue
        const box = boxOf(id)
        const frame = groupById.has(id)
        const held = line.holders.has(id)
        if (!held) {
          const grown = grow(box, CLEAR)
          if (overlaps(seg, grown) && segmentHitsBox(p, q, grown)) found.push({ id, kind: 'line', p, q, line })
        }
        if (frame) {
          const t = titleBox(box, groupById.get(id).title)
          if (overlaps(seg, grow(t, CLEAR)) && segmentHitsBox(p, q, grow(t, CLEAR))) found.push({ id, kind: 'title', p, q, line })
        }
        if (chip) {
          const target = frame ? (held ? titleBox(box, groupById.get(id).title) : box) : box
          if (overlaps(chip, grow(target, LABEL_CLEAR))) found.push({ id, kind: 'label', chip, line })
        }
      }
      if (chip) {
        // A label on one of its own ends: the line is too short for it.
        for (const id of line.ends) {
          if (groupById.has(id)) continue
          if (overlaps(chip, grow(boxOf(id), LABEL_CLEAR))) found.push({ id, kind: 'own-label', chip, line })
        }
      }
    }
    return found
  }

  /** Move `id` aside in its own layer, with the members beyond it on that side. */
  function push(id, side, amount) {
    const block = blockOf.get(id)
    if (!block || block.rows) return false
    const layer = block.layers.find((l) => l.includes(id))
    if (!layer) return false
    const k = layer.indexOf(id)
    const moving = side > 0 ? layer.slice(k) : layer.slice(0, k + 1)
    for (const m of moving) block.cross.set(m, block.cross.get(m) + side * amount)
    return true
  }
  /** Which of two sides moves `id` clear of what runs into it, and how far. */
  function clearance(problem, box, block) {
    const crossAxis = block.horizontal ? 'y' : 'x'
    const crossSize = block.horizontal ? 'height' : 'width'
    const mainAxis = block.horizontal ? 'x' : 'y'
    const mainSize = block.horizontal ? 'width' : 'height'
    let low
    let high
    if (problem.kind === 'label') {
      low = problem.chip[crossAxis] - LABEL_CLEAR
      high = problem.chip[crossAxis] + problem.chip[crossSize] + LABEL_CLEAR
    } else {
      // Where the line runs across the obstacle's main span.
      const { p, q } = problem
      const m0 = box[mainAxis] - CLEAR
      const m1 = box[mainAxis] + box[mainSize] + CLEAR
      const at = (m) => {
        const dm = q[mainAxis] - p[mainAxis]
        if (Math.abs(dm) < 1e-9) return null
        const t = Math.max(0, Math.min(1, (m - p[mainAxis]) / dm))
        return p[crossAxis] + (q[crossAxis] - p[crossAxis]) * t
      }
      const c0 = at(m0)
      const c1 = at(m1)
      const values = [c0, c1].filter((v) => v !== null)
      if (!values.length) values.push(p[crossAxis], q[crossAxis])
      low = Math.min(...values) - CLEAR
      high = Math.max(...values) + CLEAR
    }
    const toHigh = high - box[crossAxis] // move the obstacle past the line, towards higher cross
    const toLow = box[crossAxis] + box[crossSize] - low
    return { toHigh: Math.max(1, toHigh + 1), toLow: Math.max(1, toLow + 1) }
  }
  /** The member of `block` that holds `id` (or `id` itself). */
  const memberIn = (block, id) => {
    let at = id
    while (at !== undefined && blockOf.get(at) !== block) at = parentOf.get(at)
    return at
  }

  const repeats = new Map()
  const sideOf = new Map()
  const swapped = new Set()
  let drawn = measure()
  for (let round = 0; round < ROUNDS && work < WORK; round += 1) {
    const found = findProblems(drawn)
    if (!found.length) break
    const moved = new Set()
    for (const problem of found) {
      // A label in the way slides along its own line first; notes move only when that fails.
      if ((problem.kind === 'label' || problem.kind === 'labels' || problem.kind === 'own-label') && !moved.has(`label:${problem.line.index}`)) {
        const line = problem.line
        if (line.tried < LABEL_PLACES.length) {
          line.at = LABEL_PLACES[line.tried]
          line.tried += 1
          moved.add(`label:${line.index}`)
          continue
        }
      }
      if (problem.kind === 'labels') {
        // Every place along the line is taken: give its layers more room.
        const a = problem.line.from
        const b = problem.line.to
        let block = blockOf.get(a)
        while (block && memberIn(block, b) === undefined) block = blockOf.get(block.id)
        if (!block || block.rows) continue
        const ia = block.layers.findIndex((l) => l.includes(memberIn(block, a)))
        const ib = block.layers.findIndex((l) => l.includes(memberIn(block, b)))
        if (ia < 0 || ib < 0 || ia === ib) continue
        const i = Math.min(ia, ib)
        if (moved.has(`gap:${String(block.key)}:${i}`)) continue
        moved.add(`gap:${String(block.key)}:${i}`)
        block.extraGap[i] += 40
        continue
      }
      if (problem.kind === 'title') {
        // A line into a frame across its title: move the frame's contents right of the title.
        const block = blocks.get(problem.id)
        if (!block || moved.has(`title:${problem.id}`)) continue
        moved.add(`title:${problem.id}`)
        // First time: the contents start right of the title, so a line from above passes beside
        // it. After that, a little more each time.
        const room = titleSize(groupById.get(problem.id).title).width - PAD + CLEAR
        block.shift = block.shift < room ? room : block.shift + 60
        continue
      }
      if (problem.kind === 'own-label') {
        // Too short for its label: widen the gap between the two ends' layers.
        const a = problem.line.from
        const b = problem.line.to
        let block = blockOf.get(a)
        while (block && memberIn(block, b) === undefined) block = blockOf.get(block.id)
        if (!block || block.rows) continue
        const ia = block.layers.findIndex((l) => l.includes(memberIn(block, a)))
        const ib = block.layers.findIndex((l) => l.includes(memberIn(block, b)))
        if (ia < 0 || ib < 0 || ia === ib) continue
        const i = Math.min(ia, ib)
        if (moved.has(`gap:${String(block.key)}:${i}`)) continue
        moved.add(`gap:${String(block.key)}:${i}`)
        block.extraGap[i] += 40
        continue
      }
      if (moved.has(problem.id)) continue
      const block = blockOf.get(problem.id)
      if (!block || block.rows) continue
      const box = drawn.boxes.get(problem.id)
      // The same thing in the way of the same line again: moving it aside along the layer did
      // not clear it, so it changes places with the line's end beside it in the layer instead.
      const key = `${problem.id}\u0000${problem.line.from}\u0000${problem.line.to}`
      repeats.set(key, (repeats.get(key) || 0) + 1)
      if (repeats.get(key) > 2) {
        const row = block.layers.find((l) => l.includes(problem.id))
        const end = [...problem.line.ends].map((e) => memberIn(block, e)).find((m) => m !== undefined && row.includes(m))
        if (end === undefined && !swapped.has(key) && row.length > 1) {
          // Nothing of the line's in this layer: the note goes to whichever end of the layer the
          // line is further from.
          swapped.add(key)
          const centreAt = (id) => block.cross.get(id) + crossOf(block, id) / 2
          const crossAxis = block.horizontal ? 'y' : 'x'
          const lineAt = (problem.kind === 'label' ? problem.chip[crossAxis] : (problem.p[crossAxis] + problem.q[crossAxis]) / 2) - (drawn.boxes.get(problem.id)[crossAxis] - block.cross.get(problem.id))
          const first = centreAt(row[0])
          const last = centreAt(row[row.length - 1])
          row.splice(row.indexOf(problem.id), 1)
          if (Math.abs(lineAt - first) > Math.abs(lineAt - last)) row.unshift(problem.id)
          else row.push(problem.id)
          const wanted = row.map((id) => block.cross.get(id)).sort((a, b) => a - b)
          placeInOrder(row, wanted, (id) => crossOf(block, id) + GAP_CROSS).forEach((x, k) => block.cross.set(row[k], x))
          sideOf.delete(problem.id)
          moved.add(problem.id)
          continue
        }
        if (end !== undefined && !swapped.has(key)) {
          swapped.add(key)
          const from = row.indexOf(problem.id)
          row.splice(from, 1)
          const at = row.indexOf(end)
          row.splice(from <= at ? at + 1 : at, 0, problem.id)
          const wanted = row.map((id) => block.cross.get(id))
          wanted.sort((a, b) => a - b)
          placeInOrder(row, wanted, (id) => crossOf(block, id) + GAP_CROSS).forEach((x, k) => block.cross.set(row[k], x))
          straighten(block)
          moved.add(problem.id)
          continue
        }
      }
      const { toHigh, toLow } = clearance(problem, box, block)
      // Never move a member that holds one of the line's ends: that would move the line too.
      const layer = block.layers.find((l) => l.includes(problem.id))
      const k = layer.indexOf(problem.id)
      const endMembers = [...problem.line.ends].map((end) => memberIn(block, end)).filter((m) => m !== undefined)
      const holdsEnd = (list) => list.some((m) => endMembers.includes(m))
      const highOk = !holdsEnd(layer.slice(k))
      const lowOk = !holdsEnd(layer.slice(0, k + 1))
      let side
      // A note keeps the side it was first moved to, so two lines cannot pull it back and forth.
      const kept = sideOf.get(problem.id)
      if (kept === 1 && highOk) side = 1
      else if (kept === -1 && lowOk) side = -1
      else if (highOk && lowOk) side = toHigh <= toLow ? 1 : -1
      else if (highOk) side = 1
      else if (lowOk) side = -1
      else {
        // Between the line's own ends in one layer: give the layers more room instead.
        const i = block.layers.indexOf(layer)
        block.extraGap[Math.max(0, i - 1)] += 40
        if (i < block.layers.length - 1) block.extraGap[i] += 40
        moved.add(problem.id)
        continue
      }
      const amount = side > 0 ? toHigh : toLow
      // A move longer than a few notes means the line runs along the layer: leave it for the
      // gap to settle rather than throw the layer apart.
      if (amount > PUSH_MAX) {
        const i = block.layers.indexOf(layer)
        block.extraGap[Math.max(0, i - 1)] += 40
        if (i < block.layers.length - 1) block.extraGap[i] += 40
        moved.add(problem.id)
        continue
      }
      if (push(problem.id, side, amount)) {
        sideOf.set(problem.id, side)
        moved.add(problem.id)
      }
    }
    drawn = measure()
  }

  // Where each line's label sits, by the line's place in `edges`, when not the middle.
  const labelAt = new Map(drawnLines.filter((l) => l.label && l.at !== 0.5).map((l) => [l.index, l.at]))
  return { nodes: drawn.nodes, groups: drawn.groups, width: drawn.width, height: drawn.height, labelAt }
}

// ─── Geometry ──────────────────────────────────────────────────────────────────────────
const grow = (b, by) => ({ x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 })
const overlaps = (a, b) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
const titleBox = (frame, title) => {
  const t = titleSize(title)
  return { x: frame.x, y: frame.y, width: Math.min(frame.width, t.width), height: t.height }
}
function exitPoint(box, p, q) {
  const dx = q.x - p.x
  const dy = q.y - p.y
  let t = 1
  if (dx > 0) t = Math.min(t, (box.x + box.width - p.x) / dx)
  if (dx < 0) t = Math.min(t, (box.x - p.x) / dx)
  if (dy > 0) t = Math.min(t, (box.y + box.height - p.y) / dy)
  if (dy < 0) t = Math.min(t, (box.y - p.y) / dy)
  return { x: p.x + dx * t, y: p.y + dy * t }
}
/** The drawn line between two boxes: from border to border, aimed centre to centre. */
function segment(a, b) {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 }
  const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  return [exitPoint(a, ca, cb), exitPoint(b, cb, ca)]
}
function segmentHitsBox(p, q, box) {
  let t0 = 0
  let t1 = 1
  const dx = q.x - p.x
  const dy = q.y - p.y
  for (const [pp, qq] of [
    [-dx, p.x - box.x],
    [dx, box.x + box.width - p.x],
    [-dy, p.y - box.y],
    [dy, box.y + box.height - p.y],
  ]) {
    if (pp === 0) {
      if (qq <= 0) return false
    } else {
      const r = qq / pp
      if (pp < 0) {
        if (r > t1) return false
        if (r > t0) t0 = r
      } else {
        if (r < t0) return false
        if (r < t1) t1 = r
      }
    }
  }
  return t1 - t0 > 1e-6
}

/**
 * Positions for a layer's items in their order, each at least step(item) after the one before,
 * as close as possible to where each wants to be (least squares: pool adjacent violators).
 */
function placeInOrder(items, wanted, step) {
  const offset = []
  let run = 0
  items.forEach((id, k) => {
    offset[k] = run
    run += step(id)
  })
  // With y = x - offset the order is y non-decreasing: pool the blocks that break it.
  const pools = []
  items.forEach((_, k) => {
    pools.push({ sum: wanted[k] - offset[k], count: 1 })
    while (pools.length > 1 && pools[pools.length - 2].sum / pools[pools.length - 2].count > pools[pools.length - 1].sum / pools[pools.length - 1].count) {
      const last = pools.pop()
      pools[pools.length - 1].sum += last.sum
      pools[pools.length - 1].count += last.count
    }
  })
  const out = []
  for (const pool of pools) for (let j = 0; j < pool.count; j += 1) out.push(pool.sum / pool.count + offset[out.length])
  return out
}

/** Longest-path layers, after reversing the lines that close a cycle. */
function assignLayers(members, edges) {
  const index = new Map(members.map((id, i) => [id, i]))
  const out = new Map(members.map((id) => [id, []]))
  for (const [a, b] of edges) out.get(a).push(b)
  // Depth-first in the order notes were written (a stack, not recursion); a line back to a
  // note still being visited closes a cycle and is turned around.
  const state = new Map()
  const forward = []
  for (const root of members) {
    if (state.get(root)) continue
    state.set(root, 1)
    const stack = [[root, 0]]
    while (stack.length) {
      const top = stack[stack.length - 1]
      const [id, k] = top
      const next = out.get(id)[k]
      if (next === undefined) {
        state.set(id, 2)
        stack.pop()
        continue
      }
      top[1] = k + 1
      if (state.get(next) === 1) forward.push([next, id])
      else {
        forward.push([id, next])
        if (!state.get(next)) {
          state.set(next, 1)
          stack.push([next, 0])
        }
      }
    }
  }
  const after = new Map(members.map((id) => [id, []]))
  const waiting = new Map(members.map((id) => [id, 0]))
  for (const [a, b] of forward) {
    if (a === b) continue
    after.get(a).push(b)
    waiting.set(b, waiting.get(b) + 1)
  }
  const layerOf = new Map(members.map((id) => [id, 0]))
  const ready = members.filter((id) => waiting.get(id) === 0)
  for (let k = 0; k < ready.length; k += 1) {
    const id = ready[k]
    for (const next of after.get(id)) {
      layerOf.set(next, Math.max(layerOf.get(next), layerOf.get(id) + 1))
      waiting.set(next, waiting.get(next) - 1)
      if (waiting.get(next) === 0) ready.push(next)
    }
  }
  const layers = []
  for (const id of members) (layers[layerOf.get(id)] ||= []).push(id)
  return layers.filter(Boolean).map((layer) => layer.sort((a, b) => index.get(a) - index.get(b)))
}

/** A few sweeps placing each item near the middle of its neighbours in the layer before. */
function orderLayers(layers, edges) {
  const above = new Map()
  const below = new Map()
  for (const [a, b] of edges) {
    if (!above.has(b)) above.set(b, [])
    above.get(b).push(a)
    if (!below.has(a)) below.set(a, [])
    below.get(a).push(b)
  }
  const neighbours = (id, up) => (up ? above : below).get(id) || []
  for (let sweep = 0; sweep < 4; sweep += 1) {
    const down = sweep % 2 === 0
    const range = down ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).slice(0, -1).reverse()
    for (const i of range) {
      const reference = layers[down ? i - 1 : i + 1]
      const pos = new Map(reference.map((id, k) => [id, k]))
      const weight = new Map()
      layers[i].forEach((id) => {
        const linked = neighbours(id, down).filter((other) => pos.has(other))
        if (linked.length) weight.set(id, linked.reduce((s, o) => s + pos.get(o), 0) / linked.length)
      })
      const moving = layers[i]
        .map((id, k) => ({ id, k }))
        .filter((entry) => weight.has(entry.id))
        .sort((a, b) => weight.get(a.id) - weight.get(b.id) || a.k - b.k)
        .map((entry) => entry.id)
      let next = 0
      layers[i] = layers[i].map((id) => (weight.has(id) ? moving[next++] : id))
    }
  }
}
