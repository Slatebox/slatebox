// Laying out an imported diagram: layers in the diagram's direction, each subgraph laid out on
// its own and then placed as one block in its parent, so a subgraph's notes stay together
// inside its frame. Deterministic: the same diagram always lands the same way. A frame never
// grows past the engine's largest note: its layers wrap into bands, and when even that cannot
// fit, the import is refused with the frame's name. No recursion over notes or lines (only over
// frames, at most MERMAID_LIMITS.depth deep), and every step is close to linear in the diagram.
import { tooLarge } from './parse.mjs'

const GAP_MAIN = 90 // between layers, room for a line's label
const GAP_CROSS = 48 // between notes in a layer
const PAD = 28 // inside a frame
const PAD_TOP = 58 // inside a frame, under its title
const FRAME_MAX = 5000 // the engine's largest note, so the largest frame
// The most a frame's contents may span inside it, across and down.
const INNER_MAX_WIDTH = FRAME_MAX - PAD * 2
const INNER_MAX_HEIGHT = FRAME_MAX - PAD - PAD_TOP
// A layer wider than this (notes side by side with no lines between them) wraps into rows.
const ROW_MAX = 4900
const TOP = Symbol('top')

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}]/u

/** A note's size for its text: wide enough for a short line, wrapping a long one. */
export function noteSize(text, shape = 'rectangle') {
  const lines = `${text ?? ''}`.split('\n')
  const widthOf = (line) => [...line].reduce((sum, ch) => sum + (WIDE.test(ch) ? 2 : 1), 0) * 8.6
  const longest = Math.max(0, ...lines.map(widthOf))
  const width = Math.round(Math.min(320, Math.max(140, longest + 48)))
  const inner = width - 40
  const rows = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(widthOf(line) / inner)), 0)
  let w = width
  let h = Math.max(70, rows * 22 + 40)
  if (shape === 'circle') w = h = Math.max(w, h, 120)
  else if (shape === 'diamond') {
    w = Math.round(w * 1.45)
    h = Math.round(h * 1.6)
  } else if (shape === 'ellipse') {
    w = Math.round(w * 1.2)
    h = Math.round(h * 1.25)
  } else if (['hexagon', 'parallelogram', 'trapezium', 'rarrow', 'larrow', 'octagon'].includes(shape)) w = Math.round(w * 1.25)
  else if (['triangle', 'star', 'pentagon'].includes(shape)) {
    w = Math.round(Math.max(w, 160) * 1.3)
    h = Math.round(Math.max(h, 120) * 1.4)
  }
  return { width: Math.min(5000, w), height: Math.min(5000, h) }
}

/**
 * nodes: [{id, width, height}], edges: [{from, to}], groups: [{id, title, members: [ids of
 * nodes and groups], parent, direction}], direction: TB|BT|LR|RL.
 * Returns {nodes: Map id -> {x, y}, groups: Map id -> {x, y, width, height}} (top-left corners).
 */
export function layoutDiagram({ nodes, edges, groups = [], direction = 'TB' }) {
  const size = new Map(nodes.map((n) => [n.id, { width: n.width, height: n.height }]))
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const parentOf = new Map()
  for (const group of groups) for (const member of group.members) parentOf.set(member, group.id)
  const topLevel = [...nodes.map((n) => n.id), ...groups.map((g) => g.id)].filter((id) => !parentOf.has(id))

  // Each line belongs to one block: the innermost frame (or the top) holding both its ends,
  // where it joins the two members of that block its ends sit in. Found once per line.
  const containers = (id) => {
    const chain = []
    for (let at = parentOf.get(id); at !== undefined; at = parentOf.get(at)) chain.push(at)
    chain.push(TOP)
    return chain
  }
  const linesIn = new Map()
  for (const edge of edges) {
    const up = containers(edge.from)
    const down = containers(edge.to)
    const downAt = new Map(down.map((block, k) => [block, k]))
    const k = up.findIndex((block) => downAt.has(block))
    const block = up[k]
    const a = k === 0 ? edge.from : up[k - 1]
    const j = downAt.get(block)
    const b = j === 0 ? edge.to : down[j - 1]
    if (a === b) continue
    if (!linesIn.has(block)) linesIn.set(block, [])
    linesIn.get(block).push([a, b])
  }

  const placed = new Map() // id -> {x, y} relative to its block
  const boxes = new Map() // group id -> {width, height}

  function layoutBlock(blockId, members, dir) {
    for (const member of members) {
      if (groupById.has(member)) {
        const group = groupById.get(member)
        const inner = layoutBlock(member, group.members, group.direction || dir)
        boxes.set(member, {
          width: Math.max(inner.width + PAD * 2, Math.min(420, `${group.title ?? ''}`.length * 9 + PAD * 2), 160),
          height: inner.height + PAD + PAD_TOP,
          inner,
        })
      }
    }
    const sizeOf = (id) => (boxes.has(id) ? boxes.get(id) : size.get(id))
    const inBlock = new Set(members)
    const lifted = []
    const seen = new Set()
    for (const [a, b] of linesIn.get(blockId ?? TOP) || []) {
      if (!inBlock.has(a) || !inBlock.has(b)) continue
      const key = `${a}\u0000${b}`
      if (seen.has(key)) continue
      seen.add(key)
      lifted.push([a, b])
    }
    const horizontal = dir === 'LR' || dir === 'RL'
    const flipMain = dir === 'BT' || dir === 'RL'
    const main = (id) => (horizontal ? sizeOf(id).width : sizeOf(id).height)
    const cross = (id) => (horizontal ? sizeOf(id).height : sizeOf(id).width)
    const framed = blockId !== undefined
    const mainMax = horizontal ? INNER_MAX_WIDTH : INNER_MAX_HEIGHT
    const crossMax = horizontal ? INNER_MAX_HEIGHT : INNER_MAX_WIDTH
    const spanOf = (list, measure) => list.reduce((sum, id) => sum + measure(id), 0) + GAP_CROSS * Math.max(0, list.length - 1)

    const ordered = assignLayers(members, lifted)
    orderLayers(ordered, lifted)
    // A layer too wide for a row (notes with no lines between them) wraps into several.
    const rowMax = framed ? Math.min(ROW_MAX, crossMax) : ROW_MAX
    const layers = []
    for (const layer of ordered) {
      let row = []
      for (const id of layer) {
        if (row.length && spanOf([...row, id], cross) > rowMax) {
          layers.push(row)
          row = []
        }
        row.push(id)
      }
      if (row.length) layers.push(row)
    }

    // Layers in bands along the main axis; a frame's layers wrap into a new band at its edge.
    const thickness = layers.map((layer) => Math.max(0, ...layer.map(main)))
    const bands = [[]]
    let run = 0
    layers.forEach((layer, index) => {
      const extra = (bands.at(-1).length ? GAP_MAIN : 0) + thickness[index]
      if (framed && bands.at(-1).length && run + extra > mainMax) {
        bands.push([])
        run = 0
      }
      run += (bands.at(-1).length ? GAP_MAIN : 0) + thickness[index]
      bands.at(-1).push(index)
    })
    let across = 0
    let length = 0
    const at = new Map()
    for (const band of bands) {
      const crossLengths = band.map((index) => spanOf(layers[index], cross))
      const widest = Math.max(0, ...crossLengths)
      let along = 0
      const inBand = new Map()
      band.forEach((index, k) => {
        let offsetAcross = across + (widest - crossLengths[k]) / 2
        for (const id of layers[index]) {
          // Centre each item in its layer's thickness.
          inBand.set(id, { main: along + (thickness[index] - main(id)) / 2, cross: offsetAcross })
          offsetAcross += cross(id) + GAP_CROSS
        }
        along += thickness[index] + GAP_MAIN
      })
      const bandLength = Math.max(0, along - GAP_MAIN)
      for (const [id, p] of inBand) at.set(id, { main: flipMain ? bandLength - p.main - main(id) : p.main, cross: p.cross })
      length = Math.max(length, bandLength)
      across += widest + GAP_MAIN
    }
    let spanAcross = Math.max(0, across - GAP_MAIN)

    if (framed && (length > mainMax || spanAcross > crossMax)) {
      // Still too big: rows of members in reading order, filling the frame's width.
      at.clear()
      const flat = layers.flat()
      let x = 0
      let y = 0
      let rowHeight = 0
      let widthUsed = 0
      for (const id of flat) {
        const { width, height } = sizeOf(id)
        if (x > 0 && x + width > INNER_MAX_WIDTH) {
          y += rowHeight + GAP_CROSS
          x = 0
          rowHeight = 0
        }
        at.set(id, horizontal ? { main: x, cross: y } : { main: y, cross: x })
        x += width + GAP_CROSS
        widthUsed = Math.max(widthUsed, x - GAP_CROSS)
        rowHeight = Math.max(rowHeight, height)
      }
      const heightUsed = y + rowHeight
      if (widthUsed > INNER_MAX_WIDTH || heightUsed > INNER_MAX_HEIGHT) {
        const group = groupById.get(blockId)
        const name = `${group?.title ?? ''}`.trim() || `${blockId}`
        throw tooLarge(
          `The subgraph "${name}" holds more than fits in one frame (${FRAME_MAX.toLocaleString('en-US')} by ${FRAME_MAX.toLocaleString('en-US')} on the slate). Split it into smaller subgraphs.`
        )
      }
      length = horizontal ? widthUsed : heightUsed
      spanAcross = horizontal ? heightUsed : widthUsed
    }
    for (const [id, p] of at) placed.set(id, horizontal ? { x: p.main, y: p.cross } : { x: p.cross, y: p.main })
    return horizontal ? { width: length, height: spanAcross } : { width: spanAcross, height: length }
  }

  const whole = layoutBlock(undefined, topLevel, direction)

  // Absolute positions: a member of a group sits inside the group's frame, under its title.
  const result = { nodes: new Map(), groups: new Map(), width: whole.width, height: whole.height }
  function place(members, originX, originY) {
    for (const id of members) {
      const p = placed.get(id)
      const x = originX + p.x
      const y = originY + p.y
      if (groupById.has(id)) {
        const box = boxes.get(id)
        result.groups.set(id, { x, y, width: box.width, height: box.height })
        const innerX = x + (box.width - box.inner.width) / 2
        place(groupById.get(id).members, innerX, y + PAD_TOP)
      } else result.nodes.set(id, { x, y })
    }
  }
  place(topLevel, 0, 0)
  return result
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
  // The turned lines make no cycle: each note's layer is one past its latest predecessor's.
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

/** A few sweeps placing each note near the middle of its neighbours in the layer before. */
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
      // Notes joined to the reference layer move to the middle of their neighbours; the others
      // keep their places.
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
