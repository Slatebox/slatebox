// Reading Mermaid source into a plain model of what it draws. Slatebox draws three kinds as
// notes and lines: a flowchart (graph), a mind map and a Gantt chart. Any other kind is refused
// with its name, so nothing half-drawn reaches a slate. The model uses Mermaid's own names for
// shapes, line ends and strokes, so tests compare it with Mermaid's parser directly.
import { decodeLabel } from './text.mjs'

export const MERMAID_MAX_LENGTH = 100000

// What one import may draw: a slate's own limits (notes per slate and connectors per slate in
// the engine's write contract), and how deep frames may sit inside frames. Checked while
// reading, before any layout, so a short text that names every pair (A & B --> C & D) or nests
// without end is refused in moments, not after millions of lines are made.
export const MERMAID_LIMITS = Object.freeze({ notes: 1000, lines: 5000, depth: 50 })

export class MermaidError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'MermaidError'
    this.code = code
    // The text is fine but cannot be drawn (another kind of diagram), or the slate cannot be written so: 422.
    this.status = code === 'mermaid_invalid' ? 400 : 422
    if (details) this.details = details
  }
}

const amount = (n) => n.toLocaleString('en-US')

/** Refused for its size: the text is fine, but a slate cannot hold what it draws (422). */
export const tooLarge = (message) => new MermaidError('mermaid_too_large', message)
const tooManyNotes = () =>
  tooLarge(`This diagram draws more than ${amount(MERMAID_LIMITS.notes)} notes (each subgraph or section is a frame, and counts as one); a slate holds up to ${amount(MERMAID_LIMITS.notes)}. Split it into smaller diagrams.`)
const tooManyLines = () =>
  tooLarge(`This diagram draws more than ${amount(MERMAID_LIMITS.lines)} lines (A & B --> C & D draws one line for every pair); a slate holds up to ${amount(MERMAID_LIMITS.lines)}. Split it into smaller diagrams.`)

const invalid = (message, line) =>
  new MermaidError('mermaid_invalid', line ? `Line ${line}: ${message}` : message, line ? { line } : undefined)

// Diagram kinds Mermaid draws that Slatebox does not (yet) draw as notes.
const OTHER_KINDS = [
  [/^sequenceDiagram\b/, 'sequence diagram'],
  [/^classDiagram(-v2)?\b/, 'class diagram'],
  [/^stateDiagram(-v2)?\b/, 'state diagram'],
  [/^erDiagram\b/, 'entity relationship diagram'],
  [/^journey\b/, 'user journey'],
  [/^pie\b/, 'pie chart'],
  [/^quadrantChart\b/, 'quadrant chart'],
  [/^requirementDiagram\b/, 'requirement diagram'],
  [/^gitGraph\b/, 'git graph'],
  [/^C4(Context|Container|Component|Dynamic|Deployment)\b/, 'C4 diagram'],
  [/^timeline\b/, 'timeline'],
  [/^sankey(-beta)?\b/, 'Sankey diagram'],
  [/^xychart(-beta)?\b/, 'XY chart'],
  [/^block(-beta)?\b/, 'block diagram'],
  [/^packet(-beta)?\b/, 'packet diagram'],
  [/^kanban\b/, 'kanban board'],
  [/^architecture(-beta)?\b/, 'architecture diagram'],
  [/^radar(-beta)?\b/, 'radar chart'],
  [/^treemap(-beta)?\b/, 'treemap'],
  [/^zenuml\b/, 'ZenUML diagram'],
  [/^info\b/, 'info diagram'],
]

/**
 * The Mermaid source in a text: the text itself, or the first ```mermaid block of a Markdown
 * document (a README, a .md file).
 */
export function extractMermaid(text) {
  const source = `${text ?? ''}`.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const fence = source.match(/^(\s*)(```|~~~)\s*mermaid[^\n]*\n([\s\S]*?)\n\s*\2\s*$/m)
  if (fence) return fence[3]
  return source
}

/** A YAML scalar as written on one line: "double" (JSON escapes), 'single' ('' is ') or plain. */
function yamlText(value) {
  if (/^".*"$/.test(value)) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'")
  return value
}

/** Front matter (---\ntitle: x\n---) and %% comments and directives, removed. */
function prepare(source) {
  let text = source
  let title = null
  const front = text.match(/^\s*---\n([\s\S]*?)\n---\s*\n/)
  if (front) {
    const named = front[1].match(/^title:\s*(.+)$/m)
    if (named) title = yamlText(named[1].trim())
    // Keep the line count, so errors name the line as written.
    text = '\n'.repeat(front[0].split('\n').length - 1) + text.slice(front[0].length)
  }
  // Directives (%%{init: ...}%%) and comment lines. A comment runs to the end of its line.
  text = text.replace(/%%\{[\s\S]*?\}%%/g, (m) => m.replace(/[^\n]/g, ''))
  text = text
    .split('\n')
    .map((line) => (/^\s*%%/.test(line) ? '' : line))
    .join('\n')
  return { text, title }
}

/** What a Mermaid text draws: {type, ...}. Throws MermaidError with a plain reason. */
export function parseMermaid(input) {
  if (typeof input !== 'string' || !input.trim()) throw invalid('Paste or upload some Mermaid first.')
  if (input.length > MERMAID_MAX_LENGTH)
    throw invalid(`That is ${input.length.toLocaleString('en-US')} characters; a Mermaid import takes up to ${MERMAID_MAX_LENGTH.toLocaleString('en-US')}.`)
  const { text, title } = prepare(extractMermaid(input))
  const lines = text.split('\n')
  const first = lines.findIndex((line) => line.trim())
  if (first < 0) throw invalid('Paste or upload some Mermaid first.')
  const head = lines[first].trim()
  let model
  if (/^(flowchart|graph)\b/i.test(head)) model = parseFlowchart(text, first)
  else if (/^mindmap\b/.test(head)) model = parseMindmap(lines, first)
  else if (/^gantt\b/.test(head)) model = parseGantt(lines, first)
  else {
    const other = OTHER_KINDS.find(([pattern]) => pattern.test(head))
    if (other)
      throw new MermaidError(
        'mermaid_unsupported',
        `Slatebox draws flowcharts, mind maps and Gantt charts as notes and lines. This is a ${other[1]}, which it can't draw as notes yet, so nothing was added.`,
        { kind: other[1] }
      )
    throw invalid(
      `This doesn't start like a Mermaid diagram. Begin with flowchart, graph, mindmap or gantt.`,
      first + 1
    )
  }
  if (title && !model.title) model.title = title
  return model
}

// ─── Flowchart ──────────────────────────────────────────────────────────

const DIRECTIONS = { TB: 'TB', TD: 'TB', BT: 'BT', RL: 'RL', LR: 'LR', '>': 'LR', '<': 'RL', '^': 'BT', v: 'TB' }

// Openers, longest first, with the closers each may end with and the shape each closer makes.
const SHAPES = [
  ['(((', [[')))', 'doublecircle']]],
  ['((', [['))', 'circle']]],
  ['([', [['])', 'stadium']]],
  ['[[', [[']]', 'subroutine']]],
  ['[(', [[')]', 'cylinder']]],
  ['{{', [['}}', 'hexagon']]],
  ['[/', [['/]', 'lean_right'], ['\\]', 'trapezoid']]],
  ['[\\', [['\\]', 'lean_left'], ['/]', 'inv_trapezoid']]],
  ['(', [[')', 'round']]],
  ['[', [[']', 'square']]],
  ['{', [['}', 'diamond']]],
]

// Mermaid 11's `A@{ shape: name }` names, as the classic shapes they draw.
export const NAMED_SHAPES = {
  rect: 'square', rectangle: 'square', proc: 'square', process: 'square',
  rounded: 'round', event: 'round',
  stadium: 'stadium', pill: 'stadium', terminal: 'stadium',
  circle: 'circle', circ: 'circle',
  'dbl-circ': 'doublecircle', 'double-circle': 'doublecircle',
  diam: 'diamond', diamond: 'diamond', decision: 'diamond', question: 'diamond',
  hex: 'hexagon', hexagon: 'hexagon', prepare: 'hexagon',
  cyl: 'cylinder', cylinder: 'cylinder', database: 'cylinder', db: 'cylinder',
  'lean-r': 'lean_right', 'lean-right': 'lean_right', 'in-out': 'lean_right',
  'lean-l': 'lean_left', 'lean-left': 'lean_left', 'out-in': 'lean_left',
  'trap-b': 'trapezoid', trapezoid: 'trapezoid', priority: 'trapezoid',
  'trap-t': 'inv_trapezoid', 'inv-trapezoid': 'inv_trapezoid', manual: 'inv_trapezoid',
  subproc: 'subroutine', subroutine: 'subroutine', 'fr-rect': 'subroutine',
  odd: 'odd', flag: 'odd',
  tri: 'triangle', triangle: 'triangle', extract: 'triangle',
}

const ID_CHAR = /[\p{L}\p{N}_]/u
const isSpace = (c) => c === ' ' || c === '\t'

function parseFlowchart(text, headLine) {
  const lines = text.split('\n')
  const header = lines[headLine].trim().match(/^(flowchart|graph)(?:[ \t]+(TB|TD|BT|RL|LR|[<>^v]))?\s*;?\s*(.*)$/i)
  if (!header) throw invalid('Expected flowchart or graph and a direction (TD, LR ...).', headLine + 1)
  const direction = DIRECTIONS[(header[2] || 'TB').toUpperCase()] || DIRECTIONS[header[2]] || 'TB'
  // Statements may follow the header on its own line after a semicolon.
  const bodyStart = lines.slice(0, headLine + 1).join('\n').length + 1
  const body = (header[3] ? header[3] + '\n' : '') + text.slice(bodyStart)
  const lineOffset = header[3] ? headLine : headLine + 1

  const nodes = new Map()
  const edges = []
  const subgraphs = []
  const classDefs = new Map()
  const classOf = new Map()
  const styleOf = new Map()
  const links = new Map()
  const warnings = []
  // Open subgraph blocks; each collects the ids mentioned inside it.
  const open = []
  const claimed = new Set()
  let generated = 0

  let i = 0
  const n = body.length
  // Where each line of the body starts, so naming a line is a search, not a scan of the text.
  const starts = [0]
  for (let at = body.indexOf('\n'); at >= 0; at = body.indexOf('\n', at + 1)) starts.push(at + 1)
  const lineAt = (at) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= at) lo = mid
      else hi = mid - 1
    }
    return lineOffset + lo + 1
  }
  const fail = (message, at = i) => {
    throw invalid(message, lineAt(at))
  }
  const peek = (s) => body.startsWith(s, i)
  const skipInline = () => {
    while (i < n && isSpace(body[i])) i += 1
  }
  const restOfLine = () => {
    const end = body.indexOf('\n', i)
    const line = body.slice(i, end < 0 ? n : end)
    i = end < 0 ? n : end
    return line
  }
  const mention = (id) => {
    for (const block of open) {
      if (block.seen.has(id)) continue
      block.seen.add(id)
      block.mentions.push(id)
    }
  }

  function node(id, at) {
    if (!nodes.has(id)) {
      if (nodes.size >= MERMAID_LIMITS.notes) throw tooManyNotes()
      nodes.set(id, { id, text: id, shape: 'square', order: nodes.size, given: false, line: lineAt(at) })
    }
    mention(id)
    return nodes.get(id)
  }

  function readId() {
    const start = i
    while (i < n) {
      const c = body[i]
      if (ID_CHAR.test(c)) i += 1
      // A dash or dot inside a name (my-step, v1.2); never the start of a line (--, -., ==).
      else if ((c === '-' || c === '.') && i > start && i + 1 < n && ID_CHAR.test(body[i + 1])) i += 1
      else break
    }
    return body.slice(start, i)
  }

  // A quoted string at i ("..." or "`...`"), returned with its quotes.
  function readQuoted() {
    const end = body.indexOf('"', i + 1)
    if (end < 0) fail('A label starts with " but never ends.')
    const raw = body.slice(i, end + 1)
    i = end + 1
    return raw
  }

  function readShape(target) {
    // `>text]` (asymmetric) and the bracketed shapes.
    if (body[i] === '>') {
      i += 1
      return readText([[']', 'odd']], target)
    }
    for (const [opener, closers] of SHAPES) {
      if (!peek(opener)) continue
      i += opener.length
      return readText(closers, target)
    }
    return false
  }

  function readText(closers, target) {
    skipInline()
    let raw
    if (body[i] === '"') {
      raw = readQuoted()
      skipInline()
      const closer = closers.find(([close]) => peek(close))
      if (!closer) fail(`Expected ${closers.map(([c]) => c).join(' or ')} after the label.`)
      i += closer[0].length
      target.text = decodeLabel(raw)
      target.shape = closer[1]
      return true
    }
    // Unquoted: up to the first closer on this line.
    let best = null
    for (const [close, shape] of closers) {
      const at = body.indexOf(close, i)
      if (at >= 0 && (!best || at < best.at)) best = { at, close, shape }
    }
    const eol = body.indexOf('\n', i)
    if (!best || (eol >= 0 && best.at > eol)) fail(`Expected ${closers.map(([c]) => c).join(' or ')} to close the label.`)
    raw = body.slice(i, best.at)
    i = best.at + best.close.length
    target.text = decodeLabel(raw)
    target.shape = best.shape
    return true
  }

  function readNamedShape(target) {
    // A@{ shape: rect, label: "..." }
    const end = body.indexOf('}', i)
    if (end < 0) fail('A shape written with @{ never closes with }.')
    const inside = body.slice(i + 2, end)
    i = end + 1
    const shape = inside.match(/\bshape\s*:\s*([A-Za-z-]+)/)
    const label = inside.match(/\blabel\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,}]+)/)
    if (shape) {
      const known = NAMED_SHAPES[shape[1].toLowerCase()]
      if (!known) warnings.push(`The shape ${shape[1]} is drawn as a rectangle.`)
      target.shape = known || 'square'
    }
    if (label) target.text = decodeLabel(label[1].replace(/^'(.*)'$/s, '$1'))
    return true
  }

  function readNode() {
    const at = i
    const id = readId()
    if (!id) {
      const c = body[i]
      fail(c === undefined ? 'Expected a step.' : `Expected a step name, found "${c}".`)
    }
    const item = node(id, at)
    const save = i
    skipInline()
    const shaped = {}
    let found = false
    if (body[i] === '@' && body[i + 1] === '{') found = readNamedShape(shaped)
    else if (i === save && body[i] === '>') found = readShape(shaped)
    else if (i < n && '[({'.includes(body[i])) found = readShape(shaped)
    if (!found) i = save
    else {
      item.text = shaped.text ?? item.text
      item.shape = shaped.shape ?? item.shape
      item.given = true
    }
    if (peek(':::')) {
      i += 3
      const cls = readId()
      if (cls) classOf.set(id, [...(classOf.get(id) || []), cls])
    }
    return id
  }

  function readGroup() {
    const ids = [readNode()]
    for (;;) {
      const save = i
      skipInline()
      if (body[i] !== '&') {
        i = save
        break
      }
      i += 1
      skipInline()
      ids.push(readNode())
    }
    return ids
  }

  // A line between steps at i, with its label, or null.
  function readLink() {
    const rest = body.slice(i, i + 400)
    let m
    const make = (start, stroke, end, length, text = '') => {
      const head = start === '<' ? 'point' : start === 'o' ? 'circle' : start === 'x' ? 'cross' : null
      const close = end === '>' ? 'point' : end === 'o' ? 'circle' : end === 'x' ? 'cross' : null
      let type = 'arrow_open'
      if (head && close) type = `double_arrow_${close}`
      else if (close) type = `arrow_${close}`
      return { stroke, type, text, length }
    }
    // Labelled forms: -- text -->, == text ==>, -. text .->
    m = rest.match(/^([<ox]?)(--|==|-\.)[ \t]+/)
    if (m && !/^([<ox]?)(--[-ox>]|==[=ox>]|-\.+-)/.test(rest)) {
      const kind = m[2]
      const closing =
        kind === '--' ? /[ \t]*(-{2,})([-ox>])/ : kind === '==' ? /[ \t]*(={2,})([=ox>])/ : /[ \t]*(\.+)-([ox>]?)/
      const after = rest.slice(m[0].length)
      let textPart
      let tail
      if (after.startsWith('"')) {
        const q = after.indexOf('"', 1)
        if (q < 0) fail('A line label starts with " but never ends.')
        textPart = after.slice(0, q + 1)
        tail = after.slice(q + 1).match(new RegExp('^' + closing.source))
      } else {
        const eol = after.indexOf('\n')
        const scope = eol < 0 ? after : after.slice(0, eol)
        const found = scope.match(closing)
        if (found) {
          textPart = scope.slice(0, found.index)
          tail = scope.slice(found.index).match(new RegExp('^' + closing.source))
        }
      }
      if (!tail) fail('A line label is not followed by the rest of the line (-->, ==> or .->).')
      const stroke = kind === '--' ? 'normal' : kind === '==' ? 'thick' : 'dotted'
      let end = tail[2]
      if (end === '-' || end === '=') end = ''
      i += m[0].length + textPart.length + tail[0].length
      return make(m[1], stroke, end, 1, decodeLabel(textPart))
    }
    if ((m = rest.match(/^([<ox]?)(-{2,})([-ox>])/))) {
      i += m[0].length
      return withPipe(make(m[1], 'normal', m[3] === '-' ? '' : m[3], m[2].length - 1))
    }
    if ((m = rest.match(/^([<ox]?)(={2,})([=ox>])/))) {
      i += m[0].length
      return withPipe(make(m[1], 'thick', m[3] === '=' ? '' : m[3], m[2].length - 1))
    }
    if ((m = rest.match(/^([<ox]?)-(\.+)-([ox>]?)/))) {
      i += m[0].length
      return withPipe(make(m[1], 'dotted', m[3], m[2].length))
    }
    if ((m = rest.match(/^~{3,}/))) {
      i += m[0].length
      return withPipe(make('', 'invisible', '', 1))
    }
    return null
  }

  function withPipe(link) {
    const save = i
    skipInline()
    if (body[i] !== '|') {
      i = save
      return link
    }
    i += 1
    let raw
    if (body[i] === '"') {
      raw = readQuoted()
      skipInline()
      if (body[i] !== '|') fail('A line label in |...| never ends with |.')
    } else {
      const end = body.indexOf('|', i)
      const eol = body.indexOf('\n', i)
      if (end < 0 || (eol >= 0 && end > eol)) fail('A line label in |...| never ends with |.')
      raw = body.slice(i, end)
      i = end
    }
    i += 1
    link.text = decodeLabel(raw)
    return link
  }

  function statement() {
    let from = readGroup()
    for (;;) {
      const save = i
      skipInline()
      // A line may start with its start marker right after a space: A <--> B, A o--o B.
      const link = readLink()
      if (!link) {
        i = save
        break
      }
      skipInline()
      const to = readGroup()
      if (edges.length + from.length * to.length > MERMAID_LIMITS.lines) throw tooManyLines()
      for (const a of from) for (const b of to) edges.push({ from: a, to: b, ...link })
      from = to
    }
  }

  function subgraphHeader(at) {
    const line = restOfLine().trim()
    let id = null
    let title
    let m
    if ((m = line.match(/^([^\s[\]"]+)\s*\[\s*("(?:[^"]*)"|[^\]]*)\s*\]\s*$/))) {
      id = m[1]
      title = decodeLabel(m[2])
    } else if ((m = line.match(/^"([^"]*)"\s*$/))) title = decodeLabel(m[1])
    else if ((m = line.match(/^([^\s"[\]]+)\s*$/))) {
      id = m[1]
      title = m[1]
    } else if (line) title = decodeLabel(line)
    else fail('A subgraph needs a name.', at)
    // A subgraph without a name of its own is named as Mermaid names it, when it closes.
    if (open.length >= MERMAID_LIMITS.depth)
      throw tooLarge(`Subgraphs here sit more than ${MERMAID_LIMITS.depth} deep, one inside another; Slatebox draws frames up to ${MERMAID_LIMITS.depth} deep.`)
    if (subgraphs.length + open.length >= MERMAID_LIMITS.notes) throw tooManyNotes()
    generated += 1
    const key = id ?? `\u0000subgraph${generated}`
    mention(key)
    open.push({ id: key, unnamed: id === null, title, mentions: [], seen: new Set(), direction: null, line: lineAt(at) })
  }

  function closeSubgraph(at) {
    const block = open.pop()
    if (!block) fail('end closes a subgraph that was never opened.', at)
    if (block.unnamed) {
      const named = `subGraph${subgraphs.length}`
      for (const outer of open) {
        outer.mentions = outer.mentions.map((id) => (id === block.id ? named : id))
        outer.seen.delete(block.id)
        outer.seen.add(named)
      }
      block.id = named
    }
    const members = block.mentions.filter((id) => id !== block.id && !claimed.has(id))
    members.forEach((id) => claimed.add(id))
    subgraphs.push({ id: block.id, title: block.title, nodes: members, direction: block.direction })
  }

  const keyword = (word) => {
    if (!body.startsWith(word, i)) return false
    const next = body[i + word.length]
    return next === undefined || /[\s;]/.test(next)
  }
  const keywordWithArgs = (word) => body.startsWith(word, i) && isSpace(body[i + word.length] ?? '')

  while (i < n) {
    while (i < n && /[\s;]/.test(body[i])) i += 1
    if (i >= n) break
    const at = i
    if (keywordWithArgs('subgraph')) {
      i += 'subgraph'.length
      subgraphHeader(at)
    } else if (keyword('end')) {
      i += 3
      closeSubgraph(at)
    } else if (keywordWithArgs('direction')) {
      i += 'direction'.length
      const dir = restOfLine().trim()
      if (open.length) open[open.length - 1].direction = DIRECTIONS[dir.toUpperCase()] || null
    } else if (keywordWithArgs('classDef')) {
      i += 'classDef'.length
      const [, names = '', props = ''] = restOfLine().trim().match(/^(\S+)\s+(.*)$/) || []
      for (const name of names.split(',')) classDefs.set(name.trim(), styleProps(props))
    } else if (keywordWithArgs('class')) {
      i += 'class'.length
      const [, ids = '', cls = ''] = restOfLine().trim().match(/^(\S+)\s+(\S+)/) || []
      for (const id of ids.split(',')) classOf.set(id.trim(), [...(classOf.get(id.trim()) || []), cls])
    } else if (keywordWithArgs('style')) {
      i += 'style'.length
      const [, id = '', props = ''] = restOfLine().trim().match(/^(\S+)\s+(.*)$/) || []
      styleOf.set(id, { ...(styleOf.get(id) || {}), ...styleProps(props) })
    } else if (keywordWithArgs('linkStyle') || keywordWithArgs('accTitle') || /^accTitle\s*:/.test(body.slice(i, i + 12))) {
      restOfLine()
    } else if (/^accDescr\s*\{/.test(body.slice(i, i + 20))) {
      const end = body.indexOf('}', i)
      i = end < 0 ? n : end + 1
    } else if (/^accDescr\s*:/.test(body.slice(i, i + 12))) {
      restOfLine()
    } else if (keywordWithArgs('click')) {
      i += 'click'.length
      const m = restOfLine().trim().match(/^(\S+)\s+(?:href\s+)?"([^"]+)"/)
      if (m && /^https?:\/\//i.test(m[2])) links.set(m[1], m[2])
    } else {
      statement()
      skipInline()
      if (i < n && body[i] !== '\n' && body[i] !== ';')
        fail(`Unexpected "${body.slice(i, i + 12).split('\n')[0]}". Each line holds steps and the lines between them.`)
    }
  }
  if (open.length) throw invalid(`The subgraph ${open[open.length - 1].id} is never closed with end.`, open[open.length - 1].line)

  // A subgraph named as a step is the subgraph, not a step of its own.
  const subgraphIds = new Set(subgraphs.map((s) => s.id))
  for (const id of subgraphIds) {
    const item = nodes.get(id)
    if (item && !item.given) nodes.delete(id)
  }
  if (nodes.size + subgraphs.length > MERMAID_LIMITS.notes) throw tooManyNotes()
  for (const [id, item] of nodes) {
    const look = {}
    for (const cls of classOf.get(id) || []) Object.assign(look, classDefs.get(cls) || {})
    Object.assign(look, styleOf.get(id) || {})
    if (Object.keys(look).length) item.style = look
    if (links.has(id)) item.link = links.get(id)
  }
  return {
    type: 'flowchart',
    direction,
    nodes: [...nodes.values()].map(({ id, text, shape, style, link }) => ({
      id, text, shape, ...(style && { style }), ...(link && { link }),
    })),
    edges,
    subgraphs,
    warnings,
  }
}

/** fill / stroke / color from `fill:#f9f,stroke:#333,color:#fff`. */
function styleProps(text) {
  const out = {}
  for (const part of `${text}`.replace(/;\s*$/, '').split(',')) {
    const [key, value] = part.split(':').map((s) => s?.trim())
    if (!key || !value) continue
    if (['fill', 'stroke', 'color'].includes(key) && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([^)]*\))$/.test(value))
      out[key] = value
  }
  return out
}

// ─── Mind map ───────────────────────────────────────────────────────────

const MIND_SHAPES = [
  ['((', '))', 'circle'],
  ['))', '((', 'bang'],
  [')', '(', 'cloud'],
  ['{{', '}}', 'hexagon'],
  ['(', ')', 'rounded'],
  ['[', ']', 'square'],
]

function parseMindmapNode(content, line) {
  for (const [open, close, shape] of MIND_SHAPES) {
    const at = content.indexOf(open)
    if (at < 0 || !content.endsWith(close)) continue
    const id = content.slice(0, at).trim()
    if (/\s/.test(id)) continue
    const inner = content.slice(at + open.length, content.length - close.length)
    if (!inner.trim() && shape !== 'square') continue
    return { id: id || null, text: decodeLabel(inner), shape }
  }
  if (/^["`]/.test(content) || !/[[\](){}]/.test(content)) return { id: null, text: decodeLabel(content), shape: 'default' }
  throw invalid(`Couldn't read "${content}" as a mind map idea.`, line)
}

function parseMindmap(lines, headLine) {
  const stack = []
  let root = null
  let count = 0
  for (let index = headLine + 1; index < lines.length; index += 1) {
    const raw = lines[index].replace(/\t/g, '    ')
    if (!raw.trim()) continue
    const content = raw.trim()
    if (/^::icon\(/.test(content) || /^:::/.test(content)) continue
    const indent = raw.length - raw.trimStart().length
    const parsed = parseMindmapNode(content, index + 1)
    if (count >= MERMAID_LIMITS.notes) throw tooManyNotes()
    count += 1
    const item = { id: parsed.id || `idea${count}`, text: parsed.text, shape: parsed.shape, children: [] }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (!stack.length) {
      if (root) throw invalid('A mind map has one central idea; this line is a second one. Indent it under the first.', index + 1)
      root = item
    } else stack[stack.length - 1].item.children.push(item)
    stack.push({ indent, item })
  }
  if (!root) throw invalid('This mind map has no ideas yet.', headLine + 1)
  return { type: 'mindmap', root, warnings: [] }
}

// ─── Gantt ──────────────────────────────────────────────────────────────

const TAGS = new Set(['active', 'done', 'crit', 'milestone'])
const DURATION = /^\d+(\.\d+)?(ms|s|m|h|d|w|M|y)$/

function parseGantt(lines, headLine) {
  const sections = []
  const tasks = []
  let title = null
  let dateFormat = 'YYYY-MM-DD'
  let section = null
  let previous = null
  let unnamed = 0
  for (let index = headLine + 1; index < lines.length; index += 1) {
    const content = lines[index].trim()
    if (!content) continue
    let m
    if ((m = content.match(/^title\s+(.*)$/))) title = m[1].trim()
    else if ((m = content.match(/^dateFormat\s+(.*)$/))) dateFormat = m[1].trim()
    else if (/^(axisFormat|tickInterval|excludes|includes|todayMarker|weekday|weekend|inclusiveEndDates|topAxis|displayMode|accTitle|accDescr)\b/.test(content)) continue
    else if ((m = content.match(/^section\s+(.*)$/))) {
      if (sections.length + tasks.length >= MERMAID_LIMITS.notes) throw tooManyNotes()
      section = { id: `section${sections.length + 1}`, title: decodeLabel(m[1]) }
      sections.push(section)
    } else if ((m = content.match(/^([^:]+?)\s*:\s*(.*)$/))) {
      if (sections.length + tasks.length >= MERMAID_LIMITS.notes) throw tooManyNotes()
      const name = decodeLabel(m[1])
      const parts = m[2].split(',').map((s) => s.trim()).filter(Boolean)
      const tags = []
      while (parts.length && TAGS.has(parts[0])) tags.push(parts.shift())
      let id = null
      let start = null
      let end = null
      if (parts.length >= 3) [id, start, end] = parts
      else if (parts.length === 2) [start, end] = parts
      else if (parts.length === 1) [end] = parts
      const after = start && /^after\s+/.test(start) ? start.replace(/^after\s+/, '').split(/\s+/).filter(Boolean) : []
      const task = {
        id: id || `task${(unnamed += 1)}`,
        name,
        section: section ? section.id : null,
        tags,
        start: start && !after.length ? start : null,
        after: after.length ? after : start ? [] : previous ? [previous.id] : [],
        duration: end && DURATION.test(end) ? end : null,
        end: end && !DURATION.test(end) ? end : null,
      }
      tasks.push(task)
      previous = task
    } else throw invalid(`Couldn't read "${content}" as a Gantt task (name : start, duration).`, index + 1)
  }
  if (!tasks.length) throw invalid('This Gantt chart has no tasks yet.', headLine + 1)
  if (tasks.reduce((sum, t) => sum + t.after.length, 0) > MERMAID_LIMITS.lines) throw tooManyLines()
  const known = new Set(tasks.map((t) => t.id))
  const warnings = []
  for (const task of tasks) {
    const missing = task.after.filter((id) => !known.has(id))
    if (missing.length) warnings.push(`${task.name} follows ${missing.join(', ')}, which is not a task here.`)
    task.after = task.after.filter((id) => known.has(id))
  }
  return { type: 'gantt', title, dateFormat, sections, tasks, warnings }
}
