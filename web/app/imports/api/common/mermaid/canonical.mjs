// Canonical Mermaid: a slate written so that the text changes only when what the diagram says
// changes. Notes, frames and lines are written sorted by id, never by where they sit, so moving
// or resizing a note is a zero diff; note ids are kept as Mermaid names, so a file read back names
// the same notes; the direction is fixed (given, never read from the layout). The first line is
// a header Mermaid reads as a comment:
//   %% slatebox:<shareId> rev:<revision> hash:<hash of everything after the header>
// so a file in a repository says which slate it came from and whether its body changed. The
// revision moves with every save; the hash moves only with the diagram. Plain text work, safe on
// the server and the client (no node:crypto: the hash is a small SHA-1 written here).
import { slateGraph } from './export.mjs'
import { SHAPE_TO_SLATE } from './plan.mjs'
import { idNamer, quoted } from './text.mjs'

export const CANONICAL_DIRECTIONS = ['LR', 'TD', 'RL', 'BT']
const HEADER = /^%%\s*slatebox:([A-Za-z0-9_-]{1,64})\s+rev:(\d{1,12})\s+hash:([0-9a-f]{8,40})\s*$/

// The slate's shapes as Mermaid writes them. Shapes Mermaid has no bracket for are rectangles.
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
// Which slate shapes write the same Mermaid: a sync compares shapes as Mermaid says them, so a
// star (written as a rectangle) read back as a rectangle is not a change.
export const mermaidShapeOf = (shape) => (FLOW_SHAPES[shape] ? FLOW_SHAPES[shape].join('') : '[]')

// ─── SHA-1 (hex) ───────────────────────────────────────────────────────

function utf8(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text)
  const out = []
  for (const ch of unescape(encodeURIComponent(text))) out.push(ch.charCodeAt(0))
  return Uint8Array.from(out)
}

/** SHA-1 of a string's UTF-8 bytes, as 40 hex characters. */
export function sha1Hex(text) {
  const bytes = utf8(`${text}`)
  const length = bytes.length
  const words = new Uint32Array((((length + 8) >>> 6) + 1) * 16)
  for (let i = 0; i < length; i += 1) words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8)
  words[length >>> 2] |= 0x80 << (24 - (length % 4) * 8)
  words[words.length - 1] = length * 8
  words[words.length - 2] = Math.floor((length * 8) / 0x100000000)
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const w = new Uint32Array(80)
  const rotl = (x, n) => (x << n) | (x >>> (32 - n))
  for (let block = 0; block < words.length; block += 16) {
    for (let t = 0; t < 16; t += 1) w[t] = words[block + t]
    for (let t = 16; t < 80; t += 1) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1)
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4]
    for (let t = 0; t < 80; t += 1) {
      let f
      let k
      if (t < 20) [f, k] = [(b & c) | (~b & d), 0x5a827999]
      else if (t < 40) [f, k] = [b ^ c ^ d, 0x6ed9eba1]
      else if (t < 60) [f, k] = [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
      else [f, k] = [b ^ c ^ d, 0xca62c1d6]
      const temp = (rotl(a, 5) + f + e + k + w[t]) >>> 0
      e = d
      d = c
      c = rotl(b, 30) >>> 0
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  return [h0, h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, '0')).join('')
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'
/** Hex as lowercase base32 (RFC 4648 letters), for short ids that are always safe Mermaid names. */
export function hexToBase32(hex) {
  let bits = ''
  for (const ch of hex) bits += parseInt(ch, 16).toString(2).padStart(4, '0')
  let out = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)]
  return out
}

// ─── The canonical graph ───────────────────────────────────────────────

const arrowOf = (child, parent) => (child && parent ? 'both' : child || parent ? 'end' : 'none')

/**
 * What a slate's diagram says, with no geometry: nodes and frames by id, lines by from->to.
 * { nodes: [{ id, text, shape, link }], frames: [{ id, text, parent, members }], edges: [{ id, from, to, label, arrow, stroke }] }
 * A frame is a note drawn behind notes it wholly holds (export.mjs's rule); a workshop's board is
 * not part of the diagram (warnings say so). options.exclude: note ids to leave out.
 */
export function canonicalGraph(slate, { exclude = null } = {}) {
  // exclude: note ids that are about the diagram, not in it (a recipe's legend notes): left out.
  const skip = exclude ? new Set(exclude) : null
  const graph = slateGraph(skip ? { ...slate, nodes: (slate?.nodes || []).filter((n) => !skip.has(`${n?.options?.id ?? ''}`)) } : slate)
  const isFrame = (id) => graph.frames.members.has(id)
  const nodes = []
  const frames = []
  for (const note of graph.notes) {
    if (isFrame(note.id)) frames.push({ id: note.id, text: note.text, parent: graph.frames.parent.get(note.id) ?? null, members: [] })
    else nodes.push({ id: note.id, text: note.text, shape: note.shape, link: note.link, frame: graph.frames.parent.get(note.id) ?? null })
  }
  const frameById = new Map(frames.map((f) => [f.id, f]))
  for (const [frameId, members] of graph.frames.members) frameById.get(frameId).members = [...members].sort()
  const edges = []
  for (const line of graph.lines) {
    // An arrow only at the start is the same line written from its other end (as Mermaid reads it).
    const flip = line.parentArrow && !line.childArrow
    const from = flip ? line.to : line.from
    const to = flip ? line.from : line.to
    edges.push({
      id: `${from}->${to}`,
      from,
      to,
      ends: [line.from, line.to],
      label: line.hidden ? '' : line.label,
      arrow: arrowOf(line.childArrow, line.parentArrow),
      stroke: line.hidden ? 'invisible' : line.dash ? 'dotted' : line.thick ? 'thick' : 'normal',
    })
  }
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return { nodes: nodes.sort(byId), frames: frames.sort(byId), edges: uniqueEdges(edges).sort(byId), warnings: graph.warnings }
}

function uniqueEdges(edges) {
  const seen = new Map()
  for (const edge of edges) if (!seen.has(edge.id)) seen.set(edge.id, edge)
  return [...seen.values()]
}

const ARROW_OF_TYPE = (type) => (type.startsWith('double_arrow') ? 'both' : type === 'arrow_open' ? 'none' : 'end')

/**
 * A parsed Mermaid flowchart (parse.mjs) as a canonical graph. names maps a Mermaid name to the
 * note id it stands for (a canonical file's names are the ids themselves).
 */
export function canonicalFromModel(model, { names = {} } = {}) {
  if (model?.type !== 'flowchart') throw Object.assign(new Error('A synced diagram is a flowchart.'), { code: 'mermaid_unsupported', status: 422 })
  const idOf = (name) => (Object.hasOwn(names, name) ? names[name] : name)
  const subgraphIds = new Set(model.subgraphs.map((s) => s.id))
  const parentOf = new Map()
  for (const s of model.subgraphs) for (const member of s.nodes) parentOf.set(member, s.id)
  const nodes = model.nodes
    .filter((n) => !subgraphIds.has(n.id))
    .map((n) => ({ id: idOf(n.id), text: n.text, shape: SHAPE_TO_SLATE[n.shape] || 'rectangle', link: n.link || null, frame: parentOf.has(n.id) ? idOf(parentOf.get(n.id)) : null }))
  const frames = model.subgraphs.map((s) => ({
    id: idOf(s.id),
    text: s.title ?? '',
    parent: parentOf.has(s.id) ? idOf(parentOf.get(s.id)) : null,
    members: s.nodes.map(idOf).sort(),
  }))
  const edges = model.edges
    .filter((e) => e.from !== e.to)
    .map((e) => {
      const from = idOf(e.from)
      const to = idOf(e.to)
      return {
        id: `${from}->${to}`,
        from,
        to,
        label: e.stroke === 'invisible' ? '' : `${e.text ?? ''}`.trim(),
        arrow: e.stroke === 'invisible' ? 'none' : ARROW_OF_TYPE(e.type),
        stroke: e.stroke === 'invisible' ? 'invisible' : e.stroke === 'thick' ? 'thick' : e.stroke === 'dotted' ? 'dotted' : 'normal',
      }
    })
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return { nodes: nodes.sort(byId), frames: frames.sort(byId), edges: uniqueEdges(edges).sort(byId), warnings: [...(model.warnings || [])], direction: model.direction }
}

const LINKS = {
  none: { normal: '---', dotted: '-.-', thick: '===', invisible: '~~~' },
  end: { normal: '-->', dotted: '-.->', thick: '==>', invisible: '~~~' },
  both: { normal: '<-->', dotted: '<-.->', thick: '<==>', invisible: '~~~' },
}

/** The body of a canonical file (everything after the header), from a canonical graph. */
export function canonicalBody(graph, { direction = 'LR' } = {}) {
  const dir = CANONICAL_DIRECTIONS.includes(direction) ? direction : direction === 'TB' ? 'TD' : 'LR'
  const named = idNamer('n')
  // Names are given in id order, so the same ids always get the same names.
  for (const id of [...graph.frames.map((f) => f.id), ...graph.nodes.map((n) => n.id)].sort()) named(id)
  const out = [`flowchart ${dir}`]
  const framesIn = new Map()
  const nodesIn = new Map()
  const push = (map, key, value) => (map.get(key) || map.set(key, []).get(key)).push(value)
  const frameIds = new Set(graph.frames.map((f) => f.id))
  for (const frame of graph.frames) push(framesIn, frameIds.has(frame.parent) ? frame.parent : null, frame)
  for (const node of graph.nodes) push(nodesIn, frameIds.has(node.frame) ? node.frame : null, node)
  const nodeLine = (node) => {
    const [open, close] = FLOW_SHAPES[node.shape] || FLOW_SHAPES.rectangle
    return `${named(node.id)}${open}${quoted(node.text)}${close}`
  }
  const seen = new Set()
  const write = (frameId, depth) => {
    const pad = '  '.repeat(depth)
    const entries = [...(framesIn.get(frameId) || []).map((f) => ({ id: f.id, frame: f })), ...(nodesIn.get(frameId) || []).map((n) => ({ id: n.id, node: n }))]
    entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const entry of entries) {
      if (entry.node) {
        out.push(pad + nodeLine(entry.node))
        continue
      }
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      out.push(`${pad}subgraph ${named(entry.id)}[${quoted(entry.frame.text)}]`)
      write(entry.id, depth + 1)
      out.push(`${pad}end`)
    }
  }
  write(null, 1)
  const edges = [...graph.edges].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
  for (const edge of edges) {
    const link = LINKS[edge.arrow]?.[edge.stroke] || '-->'
    const label = edge.label && edge.stroke !== 'invisible' ? `|${quoted(edge.label)}|` : ''
    out.push(`  ${named(edge.from)} ${link}${label} ${named(edge.to)}`)
  }
  for (const node of graph.nodes)
    if (node.link) out.push(`  click ${named(node.id)} "${node.link.replace(/["\\\s<>`]/g, encodeURIComponent)}" _blank`)
  return out.join('\n')
}

/** The hash a canonical header carries: 16 hex characters of the body's SHA-1. */
export const canonicalHash = (body) => sha1Hex(body).slice(0, 16)

/** A canonical graph as the file text: header, then body. */
export function writeCanonical(graph, { shareId = 'slate', revision = 0, direction = 'LR' } = {}) {
  const body = canonicalBody(graph, { direction })
  const hash = canonicalHash(body)
  const safeShare = /^[A-Za-z0-9_-]{1,64}$/.test(`${shareId}`) ? shareId : 'slate'
  return { text: `%% slatebox:${safeShare} rev:${Math.max(0, Math.floor(Number(revision) || 0))} hash:${hash}\n${body}\n`, body, hash }
}

/** The header of a canonical file, or null: { shareId, revision, hash, bodyHash } (bodyHash: the body as it is now). */
export function readCanonicalHeader(text) {
  const source = `${text ?? ''}`.replace(/\r\n?/g, '\n')
  const [first, ...rest] = source.split('\n')
  const match = HEADER.exec(first.trim())
  const body = (match ? rest.join('\n') : source).replace(/\n+$/, '')
  return match ? { shareId: match[1], revision: Number(match[2]), hash: match[3], bodyHash: canonicalHash(body) } : null
}

/** The hash of a file's body as it is now (header or not): what a sync compares. */
export function bodyHashOf(text) {
  const source = `${text ?? ''}`.replace(/\r\n?/g, '\n')
  const lines = source.split('\n')
  const body = (HEADER.test(lines[0].trim()) ? lines.slice(1) : lines).join('\n').replace(/\n+$/, '')
  return canonicalHash(body)
}
