// Mermaid sync: a diagram read back onto the slate it came from changes only what the diagram
// changed (add, text, shape, line changes, deletions of what the last sync held), never moves a
// note, and leaves notes a person added or touched alone. Round trip property: for every read
// fixture, import, then canonical export, then sync import gives zero operations.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import {
  canonicalBody,
  canonicalFromModel,
  canonicalGraph,
  diagramPlans,
  parseMermaid,
  slateToMermaid,
  syncPlans,
} from '../web/app/imports/api/common/mermaid/index.mjs'

const { applyPlanToJSON } = createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/operations')
const READ = new URL('./fixtures/mermaid/read/', import.meta.url)

function draw(text) {
  const drawn = diagramPlans(parseMermaid(text), { origin: { x: 0, y: 0 } })
  let slate = { shareId: 'demo', revision: 4, options: { name: 'Drawn' }, nodes: [] }
  for (const plan of drawn.plans) slate = applyPlanToJSON(slate, plan, { userMessage: 'import', requireMatches: true }).slate
  return slate
}
function apply(slate, plans) {
  let out = slate
  for (const plan of plans) out = applyPlanToJSON(out, plan, { userMessage: 'sync', requireMatches: true }).slate
  return out
}
const geometry = (slate) =>
  Object.fromEntries(slate.nodes.map((n) => [n.options.id, [n.options.xPos, n.options.yPos, n.options.width, n.options.height]]))
const opCount = (plans) => plans.reduce((sum, p) => sum + p.operations.length, 0)

test('round trip: import, canonical export, sync import is zero operations for every fixture', async () => {
  const files = (await readdir(READ)).filter((f) => f.endsWith('.mmd'))
  assert.ok(files.length >= 6)
  for (const file of files) {
    const slate = draw(await readFile(new URL(file, READ), 'utf8'))
    const { mermaid } = slateToMermaid(slate, { canonical: true })
    const synced = diagramPlans(parseMermaid(mermaid), { sync: { current: slate, base: canonicalGraph(slate) } })
    assert.equal(opCount(synced.plans), 0, `${file}: ${JSON.stringify(synced.plans.map((p) => p.operations))}`)
    // and the canonical body read back is the same body
    const again = canonicalFromModel(parseMermaid(mermaid))
    assert.equal(again.nodes.length, canonicalGraph(slate).nodes.length, file)
  }
})

const SERVICE_MAP = `flowchart LR
  api["Api"]
  ledger["Ledger"]
  db(["Postgres"])
  api --> ledger
  ledger -->|"sql"| db`

test('a label rename and a new edge in the file give one update_nodes and one connect_nodes, no moves', () => {
  const slate = draw(SERVICE_MAP)
  const before = geometry(slate)
  const base = canonicalGraph(slate)
  // a person adds a note of their own on the slate after the last sync
  const withMine = apply(slate, [{ message: 'mine', operations: [{ kind: 'add_nodes', count: 1, ids: ['mine'], shape: 'rectangle', text: 'Ask payments', x: 900, y: 900 }] }])
  const { mermaid } = slateToMermaid(slate, { canonical: true })
  const edited = mermaid.replace('"Ledger"', '"Ledger service"').replace(/\n$/, '') + '\n  api --> db\n'
  const synced = diagramPlans(parseMermaid(edited), { sync: { current: withMine, base } })
  const ops = synced.plans.flatMap((p) => p.operations)
  assert.deepEqual(ops.map((op) => op.kind).sort(), ['connect_nodes', 'update_nodes'])
  assert.deepEqual(ops.find((op) => op.kind === 'update_nodes').changes, { text: 'Ledger service' })
  const after = apply(withMine, synced.plans)
  for (const [id, box] of Object.entries(before)) assert.deepEqual(geometry(after)[id], box, `${id} kept its place`)
  assert.ok(after.nodes.some((n) => n.options.id === 'mine'), 'the person-added note survives')
  // reading the same file again (now the base) changes nothing, and the person's note stays
  const reread = diagramPlans(parseMermaid(edited), { sync: { current: after, base: canonicalFromModel(parseMermaid(edited)) } })
  assert.equal(opCount(reread.plans), 0)
  // without the person's note, the synced slate exports exactly what the file says
  const theirs = apply(slate, diagramPlans(parseMermaid(edited), { sync: { current: slate, base } }).plans)
  assert.equal(slateToMermaid(theirs, { canonical: true }).body, canonicalBody(canonicalFromModel(parseMermaid(edited))))
})

test('moving notes never changes the canonical text; adding a note and a line does', () => {
  const slate = draw(SERVICE_MAP)
  const one = slateToMermaid(slate, { canonical: true })
  const moved = apply(slate, [{ message: 'move', operations: [{ kind: 'update_nodes', target: { ids: ['api'] }, changes: { x: 1400, y: -300 } }, { kind: 'update_nodes', target: { ids: ['db'] }, changes: { x: 40, y: 900 } }] }])
  const two = slateToMermaid({ ...moved, revision: 9 }, { canonical: true })
  assert.equal(two.body, one.body)
  assert.equal(two.hash, one.hash)
  assert.notEqual(two.mermaid, one.mermaid, 'only the header revision moves')
  const grown = apply(moved, [{ message: 'add', operations: [{ kind: 'add_nodes', count: 1, ids: ['cache'], shape: 'rectangle', text: 'Cache', x: 0, y: 0 }, { kind: 'connect_nodes', from: { ids: ['api'] }, to: { ids: ['cache'] }, ids: ['api->cache'] }] }])
  const three = slateToMermaid(grown, { canonical: true })
  const added = three.body.split('\n').filter((line) => !one.body.split('\n').includes(line))
  assert.equal(added.length, 2, added.join('\n'))
  assert.match(three.mermaid, /^%% slatebox:demo rev:4 hash:[0-9a-f]{16}\n/)
})

test('drops: only what the base held is deleted, and a touched note is kept', () => {
  const slate = draw(SERVICE_MAP)
  const base = canonicalGraph(slate)
  const desired = canonicalFromModel(parseMermaid('flowchart LR\n  api["Api"]\n'))
  const plain = syncPlans(desired, { current: slate, base })
  assert.deepEqual(plain.deleted.sort(), ['db', 'ledger'])
  const touched = syncPlans(desired, { current: slate, base, touched: new Map([['ledger', new Set(['text'])]]) })
  assert.deepEqual(touched.deleted, ['db'])
  assert.deepEqual(touched.kept, ['ledger'])
  const noBase = syncPlans(desired, { current: slate })
  assert.deepEqual(noBase.deleted, [], 'with no base nothing is deleted')
})

test('a touched text keeps the canvas words; a new note in an existing frame lands inside it', () => {
  const slate = draw('flowchart LR\n  subgraph repo["acme/api"]\n    a["A"]\n    b["B"]\n  end\n  a --> b')
  const base = canonicalGraph(slate)
  const desired = canonicalFromModel(parseMermaid('flowchart LR\n  subgraph repo["acme/api"]\n    a["A2"]\n    b["B"]\n    c["C"]\n  end\n  a --> b\n  b --> c'))
  const kept = syncPlans(desired, { current: slate, base, touched: { a: ['text'] } })
  assert.deepEqual(kept.kept, ['a'])
  const after = apply(slate, kept.plans)
  assert.equal(after.nodes.find((n) => n.options.id === 'a').options.text, 'A')
  const graph = canonicalGraph(after)
  assert.equal(graph.nodes.find((n) => n.id === 'c').frame, 'repo', 'c is drawn inside its frame')
  assert.ok(graph.edges.some((e) => e.id === 'b->c'))
})

test('a header names the slate, its revision and the body hash', async () => {
  const { readCanonicalHeader, bodyHashOf } = await import('../web/app/imports/api/common/mermaid/index.mjs')
  const slate = draw(SERVICE_MAP)
  const out = slateToMermaid(slate, { canonical: true })
  const header = readCanonicalHeader(out.mermaid)
  assert.deepEqual({ shareId: header.shareId, revision: header.revision }, { shareId: 'demo', revision: 4 })
  assert.equal(header.hash, header.bodyHash)
  assert.equal(bodyHashOf(out.mermaid), out.hash)
  assert.equal(bodyHashOf(out.body), out.hash, 'a file with no header hashes the same body the same')
  assert.equal(readCanonicalHeader('flowchart LR\n a'), null)
})
