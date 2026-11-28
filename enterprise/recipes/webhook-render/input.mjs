// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A posted payload, checked before anything is drawn: its shape (a JSON pointer to the first
// problem), its size (1,000 notes, 5,000 connectors, 256 KB), keys that repeat, connectors and cards
// that name what is not there. The same check answers the inbound hook (400 bad_payload, 413
// too_big) and recipes.run.
import { https } from '../_shared/text.mjs'
import { schemaProblem } from '../_shared/schema.mjs'
import { INPUT_SCHEMA, RENDER_LIMITS } from './manifest.mjs'

export class RenderInputError extends Error {
  constructor(status, code, pointer, message) {
    super(`${pointer} ${message}`)
    this.name = 'RenderInputError'
    this.status = status
    this.code = code
    this.pointer = pointer
  }
}
const bad = (pointer, message) => new RenderInputError(400, 'bad_payload', pointer, message)
const big = (pointer, message) => new RenderInputError(413, 'too_big', pointer, message)

/** → { format, key, title, data } or throws RenderInputError. */
export function checkRenderInput(data, config = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('/', 'must be an object with your graph, mermaid, board or text')
  if (Buffer.byteLength(JSON.stringify(data)) > RENDER_LIMITS.bytes) throw big('/', `is over ${RENDER_LIMITS.bytes / 1024} KB`)
  const nodes = data.graph?.nodes
  if (Array.isArray(nodes) && nodes.length > RENDER_LIMITS.nodes) throw big('/graph/nodes', `holds ${nodes.length}; a slate takes up to ${RENDER_LIMITS.nodes}`)
  if (Array.isArray(data.graph?.edges) && data.graph.edges.length > RENDER_LIMITS.edges) throw big('/graph/edges', `holds ${data.graph.edges.length}; a slate takes up to ${RENDER_LIMITS.edges}`)
  const problem = schemaProblem(INPUT_SCHEMA, data)
  if (problem) throw bad(problem.pointer, problem.message)

  const format = data.format || config.format || (data.mermaid ? 'mermaid' : data.board ? 'board' : data.text ? 'text' : 'graph')
  if (format !== 'graph' && format !== 'mermaid' && format !== 'board' && format !== 'text') throw bad('/format', 'must be graph, mermaid, board or text')
  if (!data[format]) throw bad('/' + format, `is required for format ${format}`)
  if (format === 'text' && config.text !== true) throw bad('/text', 'prose needs "turn prose into a diagram" on in the recipe\'s setup')
  if (data.callbackUrl !== undefined && !https(data.callbackUrl)) throw bad('/callbackUrl', 'must be an https address')

  if (format === 'graph') {
    const keys = new Set()
    data.graph.nodes.forEach((n, i) => {
      if (keys.has(n.key)) throw bad(`/graph/nodes/${i}/key`, `repeats "${n.key}"`)
      keys.add(n.key)
      if (n.link !== undefined && !https(n.link)) throw bad(`/graph/nodes/${i}/link`, 'must be an https address')
    })
    ;(data.graph.edges || []).forEach((e, i) => {
      if (!keys.has(e.from)) throw bad(`/graph/edges/${i}/from`, `names no node "${e.from}"`)
      if (!keys.has(e.to)) throw bad(`/graph/edges/${i}/to`, `names no node "${e.to}"`)
    })
  }
  if (format === 'board') {
    const lanes = new Set(data.board.lanes.map((l) => l.key))
    if (data.board.cards.length > RENDER_LIMITS.cards * RENDER_LIMITS.boards) throw big('/board/cards', `holds ${data.board.cards.length}; a slate takes up to ${RENDER_LIMITS.cards * RENDER_LIMITS.boards} (${RENDER_LIMITS.boards} boards of ${RENDER_LIMITS.cards})`)
    const keys = new Set()
    data.board.cards.forEach((c, i) => {
      if (keys.has(c.key)) throw bad(`/board/cards/${i}/key`, `repeats "${c.key}"`)
      keys.add(c.key)
      if (!lanes.has(c.lane)) throw bad(`/board/cards/${i}/lane`, `names no lane "${c.lane}"`)
      if (c.link !== undefined && !https(c.link)) throw bad(`/board/cards/${i}/link`, 'must be an https address')
    })
    data.board.cards.forEach((c, i) => (c.dependsOn || []).forEach((d, j) => {
      if (!keys.has(d)) throw bad(`/board/cards/${i}/dependsOn/${j}`, `names no card "${d}"`)
    }))
  }
  return { format, key: data.key || 'main', title: data.title || config.name || null, data }
}
