// Mermaid's own parser, for tests only: what Mermaid itself reads from a text, in the shape of
// the app's model (imports/api/common/mermaid/parse.mjs). It needs a DOM, so it runs on jsdom.
// The app never loads Mermaid; this proves the app's output and reading against the real thing.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const appRequire = createRequire(new URL('../web/app/package.json', import.meta.url))
const { JSDOM } = appRequire('jsdom')

let ready
async function load() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  globalThis.window ??= dom.window
  globalThis.document ??= dom.window.document
  const root = dirname(appRequire.resolve('mermaid/package.json'))
  const { default: mermaid } = await import(pathToFileURL(join(root, 'dist/mermaid.core.mjs')).href)
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
  return mermaid
}
export const mermaidModule = () => (ready ??= load())

// Mermaid keeps entity codes as placeholders (ﬂ°quot¶ß, ﬂ°°35¶ß) and writes them out as HTML
// entities when it draws; a browser then shows each entity as its character, once. This is that.
const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: '\u00a0' }
export function plainText(text) {
  return `${text ?? ''}`
    .replace(/ﬂ°°(\d+)¶ß/g, '&#$1;')
    .replace(/ﬂ°(\w+)¶ß/g, '&$1;')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&#(\d+);|&(quot|amp|lt|gt|apos|nbsp);/g, (whole, n, name) => (n ? String.fromCodePoint(Number(n)) : NAMED[name]))
    .trim()
}

/** Throws Mermaid's own error when Mermaid cannot read the text. */
export async function mermaidAccepts(text) {
  const mermaid = await mermaidModule()
  await mermaid.parse(text)
  return true
}

/** What Mermaid reads, in the app model's shape. */
export async function mermaidStructure(text) {
  const mermaid = await mermaidModule()
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(text)
  const db = diagram.db
  if (typeof db.getVertices === 'function') {
    const subgraphs = db.getSubGraphs()
    const subgraphIds = new Set(subgraphs.map((s) => s.id))
    return {
      type: 'flowchart',
      direction: (db.getDirection() || 'TB').replace('TD', 'TB'),
      nodes: [...db.getVertices().values()]
        .filter((v) => !subgraphIds.has(v.id))
        .map((v) => ({ id: v.id, text: plainText(v.text), shape: v.type || 'square' })),
      edges: db.getEdges().map((e) => ({
        from: e.start, to: e.end, text: plainText(e.text), type: e.type, stroke: e.stroke,
      })),
      subgraphs: subgraphs.map((s) => ({ id: s.id, title: plainText(s.title), nodes: [...s.nodes] })),
    }
  }
  if (typeof db.getMindmap === 'function') {
    const shapeName = { 0: 'default', 1: 'rounded', 2: 'square', 3: 'circle', 4: 'cloud', 5: 'bang', 6: 'hexagon' }
    const walk = (node) => ({
      text: plainText(node.descr),
      shape: shapeName[node.type] ?? 'default',
      children: (node.children || []).map(walk),
    })
    return { type: 'mindmap', root: walk(db.getMindmap()) }
  }
  if (typeof db.getTasks === 'function') {
    return {
      type: 'gantt',
      title: db.getDiagramTitle?.() || null,
      tasks: db.getTasks().map((t) => ({
        id: t.id,
        name: plainText(t.task),
        section: plainText(t.section),
        start: t.startTime,
        end: t.endTime,
        startData: t.raw?.startTime?.startData ?? null,
      })),
    }
  }
  throw new Error('This test oracle reads flowcharts, mind maps and Gantt charts.')
}
