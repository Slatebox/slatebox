// Reading Mermaid: the app's small parser (imports/api/common/mermaid/parse.mjs) reads what
// Mermaid's own parser reads, for every fixture in fixtures/mermaid/read. Mermaid itself runs
// only here, in the test, never in the app.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import { parseMermaid, extractMermaid, MermaidError, NAMED_SHAPES } from '../web/app/imports/api/common/mermaid/parse.mjs'
import { mermaidStructure } from './mermaid-oracle.mjs'

const dir = new URL('./fixtures/mermaid/read/', import.meta.url)
const fixtures = (await readdir(dir)).filter((name) => name.endsWith('.mmd')).sort()

const byId = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const sortedSubgraphs = (list) => byId(list.map((s) => ({ id: s.id, title: s.title, nodes: [...s.nodes].sort() })))

for (const name of fixtures) {
  test(`reads ${name} as Mermaid does`, async () => {
    const text = await readFile(new URL(name, dir), 'utf8')
    const ours = parseMermaid(text)
    const theirs = await mermaidStructure(text)
    assert.equal(ours.type, theirs.type)
    if (ours.type === 'flowchart') {
      assert.equal(ours.direction, theirs.direction)
      assert.deepEqual(
        byId(ours.nodes.map(({ id, text: label, shape }) => ({ id, text: label, shape }))),
        // Mermaid 11's named shapes (A@{ shape: cyl }) are read as the classic shape they draw.
        byId(theirs.nodes.map((node) => ({ ...node, shape: NAMED_SHAPES[node.shape] ?? node.shape }))),
      )
      assert.deepEqual(
        ours.edges.map(({ from, to, text: label, type, stroke }) => ({ from, to, text: label, type, stroke })),
        theirs.edges,
      )
      assert.deepEqual(sortedSubgraphs(ours.subgraphs), sortedSubgraphs(theirs.subgraphs))
    }
    if (ours.type === 'mindmap') {
      const strip = (node) => ({ text: node.text, shape: node.shape, children: node.children.map(strip) })
      assert.deepEqual(strip(ours.root), theirs.root)
    }
    if (ours.type === 'gantt') {
      const sectionTitle = Object.fromEntries(ours.sections.map((s) => [s.id, s.title]))
      assert.deepEqual(
        ours.tasks.map((t) => ({ id: t.id, name: t.name, section: sectionTitle[t.section] })),
        theirs.tasks.map((t) => ({ id: t.id, name: t.name, section: t.section })),
      )
      // Each task starts where Mermaid starts it: after the tasks it names, or on its date.
      const end = new Map(theirs.tasks.map((t) => [t.id, +t.end]))
      for (const [index, task] of ours.tasks.entries()) {
        const start = +theirs.tasks[index].start
        if (task.after.length) assert.equal(start, Math.max(...task.after.map((id) => end.get(id))), task.name)
      }
    }
  })
}

test('styles, classes and links are read onto the steps they name', () => {
  const model = parseMermaid(`flowchart LR
  classDef hot fill:#f96,stroke:#333,color:#fff
  A:::hot --> B
  class C hot
  style B fill:#bbf,stroke:#f66
  click A "https://slatebox.com" _blank
  click B "javascript:alert(1)"
  B --> C`)
  const node = Object.fromEntries(model.nodes.map((n) => [n.id, n]))
  assert.deepEqual(node.A.style, { fill: '#f96', stroke: '#333', color: '#fff' })
  assert.deepEqual(node.B.style, { fill: '#bbf', stroke: '#f66' })
  assert.deepEqual(node.C.style, { fill: '#f96', stroke: '#333', color: '#fff' })
  assert.equal(node.A.link, 'https://slatebox.com')
  assert.equal(node.B.link, undefined, 'only web addresses are kept as links')
})

test('a Markdown document gives its first mermaid block', () => {
  const doc = '# Readme\n\nSome words.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nmindmap\n  x\n```\n'
  assert.equal(extractMermaid(doc), 'flowchart LR\n  A --> B')
  assert.equal(parseMermaid(doc).edges.length, 1)
})

test('another kind of diagram is refused with its name and a plain reason', () => {
  for (const [text, kind] of [
    ['sequenceDiagram\n  Alice->>Bob: Hi', 'sequence diagram'],
    ['classDiagram\n  Animal <|-- Duck', 'class diagram'],
    ['stateDiagram-v2\n  [*] --> Still', 'state diagram'],
    ['erDiagram\n  A ||--o{ B : has', 'entity relationship diagram'],
    ['pie title Pets\n  "Dogs" : 386', 'pie chart'],
  ]) {
    assert.throws(() => parseMermaid(text), (error) => {
      assert.ok(error instanceof MermaidError)
      assert.equal(error.code, 'mermaid_unsupported')
      assert.equal(error.status, 422)
      assert.match(error.message, new RegExp(`This is a ${kind}`))
      assert.match(error.message, /nothing was added/)
      return true
    })
  }
})

test('a mistake names its line', () => {
  for (const [text, line, words] of [
    ['flowchart TD\n  A --> B\n  C["never closed --> D\n', 3, /never ends/],
    ['flowchart TD\n  subgraph one\n  A --> B\n', 2, /never closed/],
    ['flowchart TD\n  A --> B\nend\n', 3, /never opened/],
    ['hello world', 1, /doesn't start like a Mermaid diagram/],
    ['mindmap\n  a\n b\n', 3, /one central idea/],
  ]) {
    assert.throws(() => parseMermaid(text), (error) => {
      assert.equal(error.code, 'mermaid_invalid')
      assert.equal(error.details?.line, line, text)
      assert.match(error.message, words)
      return true
    })
  }
  assert.throws(() => parseMermaid('   '), /Paste or upload some Mermaid first/)
  assert.throws(() => parseMermaid('flowchart TD\n' + 'A-->B\n'.repeat(20000)), /takes up to 100,000/)
})
