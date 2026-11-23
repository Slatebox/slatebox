// Writing Mermaid, and the round trip. Every golden file (fixtures/mermaid/export) is what the
// exporter writes for a stored slate, and Mermaid's own parser (tests only) reads it back as the
// slate: the same steps, words, lines, arrow ends, line styles and subgraphs. Text of any kind
// survives (a seeded fuzz run of quotes, brackets, markup, entities and Unicode). Mermaid read
// into a slate and written out again keeps its structure.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import {
  slateToMermaid, slateGraph, parseMermaid, diagramPlans, importOrigin, MermaidError, OPERATIONS_PER_PLAN,
} from '../web/app/imports/api/common/mermaid/index.mjs'
import { EXPORT_CASES } from './mermaid-cases.mjs'
import { mermaidStructure, mermaidAccepts } from './mermaid-oracle.mjs'

const { applyPlanToJSON } = createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/operations')
const fixtures = new URL('./fixtures/mermaid/', import.meta.url)
const slateFile = async (name) => JSON.parse(await readFile(new URL(`slates/${name}`, fixtures), 'utf8'))

for (const c of EXPORT_CASES) {
  test(`writes ${c.name} as its golden file, and Mermaid reads it`, async () => {
    const slate = await slateFile(c.slate)
    const out = slateToMermaid(slate, c.options)
    const golden = await readFile(new URL(`export/${c.name}.mmd`, fixtures), 'utf8')
    assert.equal(out.mermaid + '\n', golden)
    assert.equal(out.markdown, '```mermaid\n' + out.mermaid + '\n```\n')
    assert.ok(await mermaidAccepts(out.mermaid))
    // The app's reader reads its own output as Mermaid does.
    const theirs = await mermaidStructure(out.mermaid)
    const ours = parseMermaid(out.mermaid)
    assert.equal(ours.type, theirs.type)
  })
}

test('a flowchart keeps every note, word, line, arrow end and line style', async () => {
  const slate = await slateFile('basic.json')
  const out = slateToMermaid(slate)
  const read = await mermaidStructure(out.mermaid)
  assert.equal(read.direction, 'LR', 'lines run left to right on the slate')
  const text = Object.fromEntries(read.nodes.map((n) => [n.id, n.text]))
  assert.deepEqual(text, {
    start: 'Customer opens cart',
    check: 'Card valid?\n(Luhn & expiry)',
    pay: 'Charge #1 <b>now</b>; send `receipt`',
    retry: 'Ask again — Émile 東京 🎉',
    n_end: '',
    done: 'Done',
  })
  const shape = Object.fromEntries(read.nodes.map((n) => [n.id, n.shape]))
  assert.deepEqual(shape, {
    start: 'stadium', check: 'diamond', pay: 'round', retry: 'lean_right', n_end: 'circle', done: 'hexagon',
  })
  assert.deepEqual(read.edges, [
    { from: 'start', to: 'check', text: 'clicks "Pay"', type: 'arrow_point', stroke: 'normal' },
    { from: 'check', to: 'pay', text: 'yes', type: 'arrow_point', stroke: 'thick' },
    { from: 'check', to: 'retry', text: 'no | try again', type: 'arrow_point', stroke: 'dotted' },
    { from: 'pay', to: 'done', text: '', type: 'double_arrow_point', stroke: 'normal' },
    { from: 'retry', to: 'start', text: '', type: 'arrow_open', stroke: 'normal' },
    // An arrow only at the line's start is the same line drawn the other way; a hidden line has no ends.
    { from: 'pay', to: 'n_end', text: '', type: 'arrow_open', stroke: 'invisible' },
  ])
  assert.deepEqual(out.warnings, [
    '1 line with an end on the open canvas is left out: Mermaid lines join two steps.',
    // check -> retry is stored dashed and read back dotted: Mermaid has one broken-line style.
    'Mermaid has one broken-line style: 1 dashed line is written as dotted (-.->), and comes back dotted.',
  ])
  assert.deepEqual([out.notes, out.lines, out.subgraphs], [6, 6, 0])
})

test('a note drawn behind notes it holds is a subgraph of them, nested as drawn', async () => {
  const read = await mermaidStructure(slateToMermaid(await slateFile('frames.json')).mermaid)
  const sub = Object.fromEntries(read.subgraphs.map((s) => [s.id, { title: s.title, nodes: [...s.nodes].sort() }]))
  assert.deepEqual(sub, {
    inner: { title: 'Inner squad', nodes: ['a2'] },
    teamA: { title: 'Team A [platform]', nodes: ['a1', 'inner', 'on-top'] },
  })
  assert.deepEqual(read.edges.map((e) => [e.from, e.to, e.text]), [['a1', 'a2', ''], ['a2', 'b1', 'calls'], ['b1', 'inner', 'reports to']])
})

test('a mind map that is one tree is written as a mindmap; any slate can be asked for one', async () => {
  const mind = await slateFile('mindmap.json')
  const read = await mermaidStructure(slateToMermaid(mind).mermaid)
  const walk = (n) => [n.text, n.children.map(walk)]
  assert.deepEqual(walk(read.root), ['Launch', [['Marketing (paid + "organic")', [['Blog post\nwith [links]', []]]], ['Engineering', []]]])
  // Not a tree: written under the slate's name, extra lines left out with a reason.
  const out = slateToMermaid(await slateFile('frames.json'), { format: 'mindmap' })
  assert.equal((await mermaidStructure(out.mermaid)).root.text, 'Team map')
  assert.match(out.warnings.join(' '), /no line labels/)
  // A slate not in mind map mode, or not a tree, is a flowchart unless asked.
  assert.equal(slateToMermaid({ ...mind, options: { ...mind.options, mindMapMode: false } }).format, 'flowchart')
})

test('a workshop is its own notes plus a subgraph of cards per lane; a launch plan can be a Gantt chart', async () => {
  const plan = await slateFile('workshop.json')
  const flow = await mermaidStructure(slateToMermaid(plan).mermaid)
  assert.deepEqual(flow.subgraphs.map((s) => [s.id, s.title, [...s.nodes].sort()]), [
    ['lane-now', 'Sprint 1: build', ['card-api', 'card-docs']],
    ['lane-next', 'Sprint 2', ['card-beta']],
  ])
  assert.deepEqual(flow.edges.map((e) => [e.from, e.to]), [['card-api', 'card-beta']])
  const gantt = await mermaidStructure(slateToMermaid(plan, { format: 'gantt', start: '2026-12-01' }).mermaid)
  assert.deepEqual(gantt.tasks.map((t) => [t.id, t.name, t.section]), [
    ['card-api', 'Public API', 'Sprint 1: build'],
    ['card-docs', 'Docs: quick start', 'Sprint 1: build'],
    ['card-beta', 'Beta invite #1', 'Sprint 2'],
  ])
  // Points are days; the next lane starts when this lane's cards are done.
  const days = (t) => Math.round((t.end - t.start) / 86400000)
  assert.deepEqual(gantt.tasks.map(days), [5, 2, 3])
  assert.equal(+gantt.tasks[2].start, +gantt.tasks[0].end)
  // Without a launch plan there is no Gantt chart, and the reason says so.
  const basic = await slateFile('basic.json')
  assert.throws(() => slateToMermaid(basic, { format: 'gantt' }), (e) => e instanceof MermaidError && e.code === 'mermaid_unavailable' && /launch plan/.test(e.message))
  assert.deepEqual(slateToMermaid(plan).formats, ['flowchart', 'mindmap', 'gantt'])
})

test('an empty slate is a valid, empty flowchart', async () => {
  const out = slateToMermaid({ options: { name: '' }, nodes: [] })
  assert.equal(out.mermaid, 'flowchart TD')
  assert.ok(await mermaidAccepts(out.mermaid))
  assert.throws(() => slateToMermaid({ nodes: [] }, { format: 'mindmap' }), /at least one note/)
})

// ─── Any text ─────────────────────────────────────────────────────────

function random(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const PIECES = [
  '"', "'", '`', '``', '[', ']', '(', ')', '{', '}', '<', '>', '<b>', '</script>', '&', '&amp;', '#', '#quot;', '#35;',
  '%%', '%', '|', ';', ':', '::', ':::', '-->', '---', '==>', '-.->', '~~~', '\\', '/', '*', '**bold**', '_x_', '\n', ' ',
  'end', 'subgraph', 'style', 'click', 'é', 'ß', '東京', '🎉', '👩🏽‍💻', 'מזל', 'ключ', ' ', 'A', 'node', '1.', '- item',
]
const SHAPES = ['rectangle', 'roundedrectangle', 'ellipse', 'circle', 'diamond', 'hexagon', 'parallelogram', 'trapezium', 'rarrow', 'star', 'triangle']

function fuzzSlate(seed) {
  const r = random(seed)
  const pick = (list) => list[Math.floor(r() * list.length)]
  const words = () => Array.from({ length: 1 + Math.floor(r() * 6) }, () => pick(PIECES)).join(r() < 0.5 ? '' : ' ')
  const count = 2 + Math.floor(r() * 8)
  const ids = Array.from({ length: count }, (_, k) => pick(['n', 'end', 'a-b', 'x.y', '9lives', 'o', 'graph', 'Ünï', 'end-x', 'o-1', 'x-ray', 'a.b-c', 'style-', 'x']) + k)
  const nodes = ids.map((id, k) => ({
    options: { id, text: words(), shape: pick(SHAPES), xPos: k * 250, yPos: Math.floor(r() * 400), width: 160, height: 80 },
    relationships: { associations: [] },
  }))
  const pairs = new Set()
  for (let k = 0; k < count * 1.5; k += 1) {
    const a = Math.floor(r() * count)
    const b = Math.floor(r() * count)
    if (a === b || pairs.has(`${a}>${b}`)) continue
    pairs.add(`${a}>${b}`)
    nodes[a].relationships.associations.push({
      id: `${ids[a]}->${ids[b]}`, parentId: ids[a], childId: ids[b],
      label: r() < 0.6 ? words() : '', showChildArrow: r() < 0.7, showParentArrow: r() < 0.2,
      lineDash: pick(['solid', 'dashed', 'dotted']), lineWidth: pick([3, 6]),
    })
  }
  return { options: { name: words() }, nodes }
}

test('any text survives: Mermaid reads back every word and label exactly (seeded fuzz)', async () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const slate = fuzzSlate(seed)
    const out = slateToMermaid(slate)
    let read
    try {
      read = await mermaidStructure(out.mermaid)
    } catch (error) {
      assert.fail(`seed ${seed}: Mermaid could not read\n${out.mermaid}\n${error.message}`)
    }
    const graph = slateGraph(slate)
    const want = graph.notes.map((n) => n.text.trim()).sort()
    assert.deepEqual(read.nodes.map((n) => n.text).sort(), want, `seed ${seed}\n${out.mermaid}`)
    assert.deepEqual(
      read.edges.map((e) => e.text).sort(),
      graph.lines.map((l) => l.label).sort(),
      `seed ${seed}`,
    )
    // The app's own reader agrees with Mermaid on the same text.
    const ours = parseMermaid(out.mermaid)
    assert.deepEqual(ours.nodes.map((n) => [n.id, n.text]).sort(), read.nodes.map((n) => [n.id, n.text]).sort(), `seed ${seed}`)
    assert.deepEqual(ours.edges.map((e) => [e.from, e.to, e.text, e.type, e.stroke]), read.edges.map((e) => [e.from, e.to, e.text, e.type, e.stroke]), `seed ${seed}`)
  }
})

// ─── Round trip ───────────────────────────────────────────────────────

/** A Mermaid text drawn on a new slate the way an import draws it (engine applier, real plans). */
export function drawOnNewSlate(text) {
  const model = parseMermaid(text)
  const drawn = diagramPlans(model, { origin: { x: 0, y: 0 } })
  let slate = { options: { name: drawn.title || 'Imported', mindMapMode: drawn.mindMap }, nodes: [] }
  for (const plan of drawn.plans) {
    assert.ok(plan.operations.length <= OPERATIONS_PER_PLAN)
    slate = applyPlanToJSON(slate, plan, { userMessage: 'import', requireMatches: true }).slate
  }
  return { slate, drawn, model }
}

// What a round trip may change: shapes Slatebox has no exact counterpart for, ids it cannot
// use, and line lengths. Everything else is compared as Mermaid reads it.
const SHAPE_ROUND_TRIP = { subroutine: 'square', cylinder: 'square', doublecircle: 'circle', lean_left: 'lean_right', inv_trapezoid: 'trapezoid', triangle: 'square' }
const LINE_ROUND_TRIP = { arrow_circle: 'arrow_point', arrow_cross: 'arrow_point', double_arrow_circle: 'double_arrow_point', double_arrow_cross: 'double_arrow_point' }
// A name with a character a note id cannot hold (v1.2) comes back with _ in its place.
const sameName = (id) => id.replace(/[^A-Za-z0-9_-]/g, '_').replace(/style/g, 'Style')
function comparable(read) {
  const nodes = read.nodes.map((n) => ({ id: sameName(n.id), text: n.text, shape: SHAPE_ROUND_TRIP[n.shape] ?? n.shape })).sort((a, b) => (a.id < b.id ? -1 : 1))
  const edges = read.edges
    .map((e) => ({ from: sameName(e.from), to: sameName(e.to), text: e.stroke === 'invisible' ? '' : e.text, type: e.stroke === 'invisible' ? 'arrow_open' : LINE_ROUND_TRIP[e.type] ?? e.type, stroke: e.stroke }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const subgraphs = read.subgraphs.map((s) => ({ id: sameName(s.id), title: s.title, nodes: s.nodes.map(sameName).sort() })).sort((a, b) => (a.id < b.id ? -1 : 1))
  return { direction: read.direction, nodes, edges, subgraphs }
}

const roundTrips = [
  ...(await readdir(new URL('read/', fixtures))).filter((n) => /^(links|chains|shapes|subgraphs|text)\.mmd$/.test(n)).map((n) => `read/${n}`),
  'export/basic.mmd', 'export/frames.mmd', 'export/workshop.mmd',
]
for (const file of roundTrips) {
  test(`round trip keeps the structure: ${file} -> slate -> Mermaid`, async () => {
    const text = await readFile(new URL(file, fixtures), 'utf8')
    const { slate } = drawOnNewSlate(text)
    const again = slateToMermaid(slate).mermaid
    const before = comparable(await mermaidStructure(text))
    const after = comparable(await mermaidStructure(again))
    // The invisible line (~~~) has no direction of its own; links.mmd's A ~~~ M may come back as either way.
    assert.deepEqual(after, before, again)
    // And once more: the second trip changes nothing at all.
    assert.equal(slateToMermaid(drawOnNewSlate(again).slate).mermaid, again)
  })
}

test('round trip keeps a mind map', async () => {
  const text = await readFile(new URL('read/mindmap.mmd', fixtures), 'utf8')
  const { slate } = drawOnNewSlate(text)
  assert.equal(slate.options.mindMapMode, true)
  const out = slateToMermaid(slate)
  assert.equal(out.format, 'mindmap')
  const shape = { default: 'square' }
  const walk = (n) => [n.text, shape[n.shape] ?? n.shape, n.children.map(walk)]
  assert.deepEqual(walk((await mermaidStructure(out.mermaid)).root), walk((await mermaidStructure(text)).root))
})

test('a Gantt chart is drawn as its tasks in a frame per section, joined in order', async () => {
  const text = await readFile(new URL('read/gantt.mmd', fixtures), 'utf8')
  const { slate, drawn } = drawOnNewSlate(text)
  assert.deepEqual([drawn.notes, drawn.frames, drawn.lines], [6, 3, 6])
  const read = await mermaidStructure(slateToMermaid(slate).mermaid)
  assert.deepEqual(read.subgraphs.map((s) => [s.title, [...s.nodes].sort()]).sort(), [
    ['Build', ['api', 'fe', 'task1']],
    ['Design', ['r1', 'w1']],
    ['Launch', ['rel']],
  ])
  assert.deepEqual(read.edges.map((e) => `${e.from}>${e.to}`).sort(), ['api>rel', 'api>task1', 'fe>task1', 'r1>w1', 'w1>api', 'w1>fe'])
  const text1 = Object.fromEntries(read.nodes.map((n) => [n.id, n.text]))
  assert.equal(text1.api, 'API\n10d')
})

test('a large diagram is drawn in plans of at most 50 operations, all of them applied', () => {
  const lines = ['flowchart LR']
  for (let k = 0; k < 120; k += 1) lines.push(`  s${k}["Step ${k}"] --> s${k + 1}`)
  const { slate, drawn } = drawOnNewSlate(lines.join('\n'))
  assert.equal(drawn.plans.length, Math.ceil((121 + 120) / 50))
  assert.equal(slate.nodes.length, 121)
  assert.equal(slate.nodes.flatMap((n) => n.relationships.associations).length, 120)
})

test('an import lands to the right of what a slate already holds, with ids that do not collide', () => {
  const existing = [{ options: { id: 'A', xPos: 100, yPos: 50, width: 200, height: 100 }, relationships: { associations: [] } }]
  assert.deepEqual(importOrigin(existing), { x: 500, y: 50 })
  assert.deepEqual(importOrigin([]), { x: 5000, y: 5000 })
  const drawn = diagramPlans(parseMermaid('flowchart TD\n  A --> B'), { existingIds: ['A'], origin: importOrigin(existing) })
  const adds = drawn.plans[0].operations.filter((op) => op.kind === 'add_nodes')
  assert.deepEqual(adds.map((op) => op.ids[0]), ['A_2', 'B'])
  assert.ok(adds.every((op) => op.x >= 500))
  const slate = applyPlanToJSON({ options: {}, nodes: existing }, drawn.plans[0], { requireMatches: true }).slate
  assert.equal(slate.nodes.length, 3)
})
