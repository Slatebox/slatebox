// Mermaid at its limits, and on messy data (the hostile review of feat/mermaid). An import is
// refused early, with a plain reason, when it would draw more than a slate holds (1,000 notes,
// 5,000 lines) or nest subgraphs too deeply, before any layout work; nothing it accepts blocks
// the server or overflows the stack. Export stays fast on any stored slate, a Gantt chart's
// names can never be read as Gantt commands, a wide subgraph keeps its notes in its frame, and a
// workshop with odd data is written without inventing or crashing.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import {
  slateToMermaid, parseMermaid, diagramPlans, MermaidError, MERMAID_LIMITS,
} from '../web/app/imports/api/common/mermaid/index.mjs'
import { waitForRun } from '../web/app/imports/api/client/waitForRun.mjs'
import { mermaidStructure, plainText } from './mermaid-oracle.mjs'

const { applyPlanToJSON } = createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/operations')

const timed = (fn) => {
  const start = performance.now()
  const value = fn()
  return { value, ms: performance.now() - start }
}
const tooLarge = (pattern) => (error) =>
  error instanceof MermaidError && error.code === 'mermaid_too_large' && error.status === 422 && pattern.test(error.message)
const names = (prefix, count) => Array.from({ length: count }, (_, k) => `${prefix}${k}`)

function draw(text) {
  const drawn = diagramPlans(parseMermaid(text), { origin: { x: 0, y: 0 } })
  let slate = { options: { name: 'x' }, nodes: [] }
  for (const plan of drawn.plans) slate = applyPlanToJSON(slate, plan, { requireMatches: true }).slate
  return { slate, drawn }
}

// ─── 1. A small text that names every pair ──────────────────────────────

test('A & B --> C & D past 5,000 lines is refused while reading, in moments and without the memory', () => {
  // 100 x 100 names: 200 notes, 10,000 lines.
  const lines = `flowchart TD\n${names('a', 100).join(' & ')} --> ${names('b', 100).join(' & ')}`
  const { ms } = timed(() => assert.throws(() => parseMermaid(lines), tooLarge(/5,000 lines/)))
  assert.ok(ms < 200, `${ms} ms`)
  // The review's 9,794-character text (1,000 x 1,000) and its 50,594-character one (4,400 x 4,400).
  for (const k of [1000, 4400]) {
    const text = `flowchart TD\n${names('a', k).join('&')}-->${names('b', k).join('&')}`
    const heap = process.memoryUsage().heapUsed
    const run = timed(() => assert.throws(() => parseMermaid(text), tooLarge(/1,000 notes|5,000 lines/)))
    assert.ok(run.ms < 300, `${k}: ${run.ms} ms`)
    assert.ok(process.memoryUsage().heapUsed - heap < 200e6, `${k}: heap grew too much`)
  }
  // At the limit it is drawn.
  const fits = `flowchart TD\n${names('a', 70).join(' & ')} --> ${names('b', 70).join(' & ')}`
  assert.equal(parseMermaid(fits).edges.length, 4900)
})

test('more than 1,000 notes (subgraphs count, they are frames) is refused with a plain reason', () => {
  assert.equal(MERMAID_LIMITS.notes, 1000)
  assert.equal(MERMAID_LIMITS.lines, 5000)
  const many = `flowchart TD\n${names('n', 1001).join('\n')}`
  assert.throws(() => parseMermaid(many), tooLarge(/1,000 notes/))
  assert.equal(parseMermaid(`flowchart TD\n${names('n', 1000).join('\n')}`).nodes.length, 1000)
  const framed = `flowchart TD\n${names('n', 990).join('\n')}\n${names('s', 11).map((s) => `subgraph ${s}\n  m${s}\nend`).join('\n')}`
  assert.throws(() => parseMermaid(framed), tooLarge(/1,000 notes/))
  const mind = `mindmap\n  root\n${names('idea', 1000).map((n) => `    ${n}`).join('\n')}`
  assert.throws(() => parseMermaid(mind), tooLarge(/1,000 notes/))
  const gantt = `gantt\n${names('t', 1001).map((n) => `  ${n} : ${n}, 2026-01-01, 1d`).join('\n')}`
  assert.throws(() => parseMermaid(gantt), tooLarge(/1,000 notes/))
})

// ─── 2. Long chains and deep nesting ────────────────────────────────────

test('a long chain is refused past the limit (not a stack overflow) and drawn quickly at it', () => {
  const chain = (count) => `flowchart LR\n${names('a', count).join('-->')}`
  // The review's 99 KB chain (about 12,000 notes) gave a RangeError from the layout.
  assert.throws(() => parseMermaid(chain(12000)), tooLarge(/1,000 notes/))
  const { ms, value } = timed(() => diagramPlans(parseMermaid(chain(1000))))
  assert.equal(value.notes, 1000)
  assert.ok(ms < 1500, `${ms} ms`)
  // The same chain written one line per step, each closing a cycle back to the start.
  const cyclic = `flowchart TD\n${names('c', 999).map((n, k) => `${n} --> c${k + 1}`).join('\n')}\nc999 --> c0`
  assert.equal(diagramPlans(parseMermaid(cyclic)).notes, 1000)
})

test('subgraphs nested past 50 deep are refused; 50 deep is drawn quickly', () => {
  const nested = (depth) => `flowchart TD\n${names('s', depth).map((s) => `subgraph ${s}`).join('\n')}\nx\n${'end\n'.repeat(depth)}`
  for (const depth of [51, 1500, 3372]) {
    const { ms } = timed(() => assert.throws(() => parseMermaid(nested(depth)), tooLarge(/50 deep/)))
    assert.ok(ms < 300, `${depth}: ${ms} ms`)
  }
  const { ms, value } = timed(() => diagramPlans(parseMermaid(nested(50))))
  assert.equal(value.frames, 50)
  assert.ok(ms < 500, `${ms} ms`)
})

test('reading many notes takes time in step with the text, not its square', () => {
  const text = (count) => `flowchart TD\n${names('n', count).map((n) => `${n}["${'word '.repeat(18)}"]`).join('\n')}`
  // Warm up, then compare 250 notes and 1,000 notes: four times the text, well under 16 times the time.
  parseMermaid(text(1000))
  const small = Math.max(0.5, Math.min(...[1, 2, 3].map(() => timed(() => parseMermaid(text(250))).ms)))
  const large = Math.min(...[1, 2, 3].map(() => timed(() => parseMermaid(text(1000))).ms))
  assert.ok(large < small * 10 + 20, `250: ${small} ms, 1000: ${large} ms`)
})

// ─── 3. Export time ──────────────────────────────────────────────────────

test('a slate of 1,000 notes each inside the last exports in well under a second', () => {
  const n = 1000
  const nodes = []
  for (let i = 0; i < n; i += 1)
    nodes.push({ options: { id: `n${i}`, text: `t${i}`, xPos: i * 5, yPos: i * 5, width: 20000 - i * 10, height: 20000 - i * 10 }, relationships: { associations: [] } })
  for (let i = 0; i < n - 1; i += 1) nodes[i].relationships.associations.push({ parentId: `n${i}`, childId: `n${n - 1 - i}` })
  const { ms, value } = timed(() => slateToMermaid({ options: { name: 'x' }, nodes }))
  assert.equal(value.subgraphs, n - 1)
  assert.ok(ms < 1000, `${ms} ms`)
})

// ─── 4. Gantt names are never Gantt commands ─────────────────────────────

const GANTT_HOSTILE = [
  'section evil', 'title pwn', 'excludes weekends', 'includes 2026-01-02', 'dateFormat X', 'axisFormat %Y',
  'tickInterval 1day', 'todayMarker off', 'inclusiveEndDates', 'topAxis', 'weekday monday', 'weekend friday',
  'click t_c1 href "javascript:alert(1)"', 'call alert()', 'href "x"', 'gantt', 'accTitle: x', 'accDescr: y',
  'accDescr { z }', 'accDescription q', '2026-01-01 launch', 'SECTION shouting', 'Title Case', '  section padded',
]

test('a card, lane or slate named like a Gantt command stays a name, as Mermaid reads it', async () => {
  for (const label of GANTT_HOSTILE) {
    const workshop = {
      kind: 'release-plan',
      lanes: [{ id: 'L1', label }],
      cards: [{ id: 'c1', laneId: 'L1', label, points: 2 }, { id: 'c2', laneId: 'L1', label: 'ok', points: 1 }],
    }
    const out = slateToMermaid({ options: { name: label }, nodes: [], creative: { model: { kind: 'workshop', workshop } } }, { format: 'gantt', start: '2026-01-01' })
    let read
    try {
      read = await mermaidStructure(out.mermaid)
    } catch (error) {
      assert.fail(`${label}: Mermaid refused\n${out.mermaid}\n${error.message}`)
    }
    assert.deepEqual(read.tasks.map((t) => [t.name, t.section]), [[label.trim(), label.trim()], ['ok', label.trim()]], `${label}\n${out.mermaid}`)
    assert.equal(plainText(read.title), label.trim(), out.mermaid)
    assert.deepEqual(read.tasks.map((t) => Math.round((t.end - t.start) / 86400000)), [2, 1], `${label}: the schedule changed\n${out.mermaid}`)
  }
})

// ─── 5. A wide subgraph keeps its notes ──────────────────────────────────

const inside = (frame, note) =>
  note.xPos >= frame.xPos && note.yPos >= frame.yPos &&
  note.xPos + note.width <= frame.xPos + frame.width && note.yPos + note.height <= frame.yPos + frame.height

test('a subgraph too long for one frame row wraps inside its frame, and the round trip keeps every note in it', async () => {
  const text = `flowchart LR\n  subgraph S["Big"]\n    ${names('s', 40).join(' --> ')}\n  end\n  s0 --> outside\n`
  const { slate } = draw(text)
  const frame = slate.nodes.find((node) => node.options.id === 'S').options
  assert.ok(frame.width <= 5000 && frame.height <= 5000)
  for (const id of names('s', 40)) assert.ok(inside(frame, slate.nodes.find((node) => node.options.id === id).options), id)
  const again = await mermaidStructure(slateToMermaid(slate).mermaid)
  assert.deepEqual([...again.subgraphs.find((s) => s.id === 'S').nodes].sort(), names('s', 40).sort())
  assert.equal(again.edges.length, 40)
})

test('a subgraph with hundreds of notes fits its frame; one that cannot fit is refused with its name', () => {
  const crowd = (count) => `flowchart TD\n  subgraph Crowd["Everyone"]\n${names('p', count).map((n) => `    ${n}`).join('\n')}\n  end\n`
  const { slate } = draw(crowd(400))
  const frame = slate.nodes.find((node) => node.options.id === 'Crowd').options
  assert.ok(frame.width <= 5000 && frame.height <= 5000)
  for (const node of slate.nodes) if (node.options.id !== 'Crowd') assert.ok(inside(frame, node.options), node.options.id)
  const wordy = `flowchart TD\n  subgraph Crowd["Everyone"]\n${names('p', 400).map((n) => `    ${n}["${'a long label that wraps '.repeat(6)}"]`).join('\n')}\n  end\n`
  assert.throws(() => diagramPlans(parseMermaid(wordy)), tooLarge(/Everyone/))
})

// ─── 6. Round-trip losses are named ─────────────────────────────────────

test('what a round trip changes is said: dashed lines, lines to themselves, and "1 point"', () => {
  const note = (id, x) => ({ options: { id, text: id, xPos: x, yPos: 0, width: 100, height: 50 }, relationships: { associations: [] } })
  const a = note('a', 0)
  const b = note('b', 300)
  a.relationships.associations.push({ parentId: 'a', childId: 'b', lineDash: 'dashed' })
  b.relationships.associations.push({ parentId: 'b', childId: 'a', lineDash: 'dotted' })
  const out = slateToMermaid({ options: { name: 'x' }, nodes: [a, b] })
  assert.ok(out.warnings.some((w) => /1 dashed line is written as dotted/.test(w)), out.warnings.join(' | '))
  assert.ok(!out.warnings.some((w) => /dotted lines? (is|are) written/.test(w)))

  const loops = diagramPlans(parseMermaid('flowchart TD\n  A --> A\n  A --> B\n  A --> B'))
  assert.equal(loops.lines, 1)
  assert.ok(loops.warnings.some((w) => /1 line from a step to itself is left out/.test(w)), loops.warnings.join(' | '))
  assert.ok(loops.warnings.some((w) => /1 line repeating another was drawn once/.test(w)), loops.warnings.join(' | '))
  assert.ok(!loops.warnings.some((w) => /joining a step to itself/.test(w)))

  const workshop = { kind: 'release-plan', lanes: [{ id: 'L', label: 'Now' }], cards: [{ id: 'c', laneId: 'L', label: 'One', points: 1 }, { id: 'd', laneId: 'L', label: 'Two', points: 2 }] }
  const flow = slateToMermaid({ options: {}, nodes: [], creative: { model: { kind: 'workshop', workshop } } }).mermaid
  assert.match(flow, /One<br>1 point"/)
  assert.match(flow, /Two<br>2 points"/)
})

// ─── 7. Messy workshop data ─────────────────────────────────────────────

const workshopSlate = (workshop) => ({ options: { name: 'Plan' }, nodes: [], creative: { model: { kind: 'workshop', workshop: { kind: 'release-plan', ...workshop } } } })

test('a launch plan with odd data is written without crashing or inventing anything', async () => {
  // presentationOrder without lanes.
  for (const format of ['gantt', 'flowchart'])
    assert.doesNotThrow(() => slateToMermaid(workshopSlate({ presentationOrder: ['L1'], cards: [] }), { format, start: '2026-01-01' }))

  // A lane missing from presentationOrder is still written, after the ordered ones.
  const unordered = workshopSlate({
    presentationOrder: ['L2'],
    lanes: [{ id: 'L1', label: 'First' }, { id: 'L2', label: 'Second' }],
    cards: [{ id: 'a', laneId: 'L1', label: 'A', points: 1 }, { id: 'b', laneId: 'L2', label: 'B', points: 1 }],
  })
  const ordered = await mermaidStructure(slateToMermaid(unordered, { format: 'gantt', start: '2026-01-01' }).mermaid)
  assert.deepEqual(ordered.tasks.map((t) => [t.name, t.section]), [['B', 'Second'], ['A', 'First']])

  // A dependency on a deleted card: left out with a reason, never drawn as a note of its own.
  const ghost = workshopSlate({ lanes: [{ id: 'L1', label: 'a' }], cards: [{ id: 'c1', laneId: 'L1', label: 'x', points: 1, dependsOn: ['ghost'] }] })
  for (const format of ['gantt', 'flowchart']) {
    const out = slateToMermaid(ghost, { format, start: '2026-01-01' })
    assert.doesNotMatch(out.mermaid, /ghost/, out.mermaid)
    assert.ok(out.warnings.some((w) => /no longer on the board/.test(w)), out.warnings.join(' | '))
    const read = await mermaidStructure(out.mermaid)
    if (format === 'gantt') assert.equal(read.tasks.length, 1)
    else assert.deepEqual(read.nodes.map((n) => n.id), ['card-c1'])
  }

  // Missing labels are not the word "undefined".
  const blank = workshopSlate({ lanes: [{ id: 'L1' }], cards: [{ id: 'c1', laneId: 'L1', points: 1 }] })
  for (const format of ['gantt', 'flowchart']) {
    const out = slateToMermaid(blank, { format, start: '2026-01-01' })
    assert.doesNotMatch(out.mermaid, /undefined/, out.mermaid)
    await mermaidStructure(out.mermaid)
  }

  // Cards that depend on each other: every task still has a start, and the loop is named.
  const cycle = workshopSlate({ lanes: [{ id: 'L1', label: 'a' }], cards: [{ id: 'c1', laneId: 'L1', label: 'x', points: 1, dependsOn: ['c2'] }, { id: 'c2', laneId: 'L1', label: 'y', points: 1, dependsOn: ['c1'] }] })
  const out = slateToMermaid(cycle, { format: 'gantt', start: '2026-01-01' })
  assert.ok(out.warnings.some((w) => /depend on each other/.test(w)), out.warnings.join(' | '))
  const read = await mermaidStructure(out.mermaid)
  assert.equal(read.tasks.length, 2)
  for (const task of read.tasks) assert.ok(Number.isFinite(+task.start) && Number.isFinite(+task.end), out.mermaid)
  // A card in a later lane named as coming before a card in an earlier lane is a loop too.
  const backwards = workshopSlate({
    lanes: [{ id: 'L1', label: 'one' }, { id: 'L2', label: 'two' }],
    cards: [{ id: 'a', laneId: 'L1', label: 'A', points: 1, dependsOn: ['b'] }, { id: 'b', laneId: 'L2', label: 'B', points: 1 }],
  })
  const back = await mermaidStructure(slateToMermaid(backwards, { format: 'gantt', start: '2026-01-01' }).mermaid)
  for (const task of back.tasks) assert.ok(Number.isFinite(+task.start), 'every task has a start')
})

// ─── 9. Notes with no lines ──────────────────────────────────────────────

test('notes with no lines are laid out in rows, not one strip', () => {
  const drawn = diagramPlans(parseMermaid(`flowchart TD\n${names('n', 1000).join('\n')}`))
  assert.ok(drawn.bounds.width <= 5000, `width ${drawn.bounds.width}`)
  assert.ok(drawn.bounds.height <= 20000, `height ${drawn.bounds.height}`)
})

// ─── 8. Replayed runs on an open canvas ──────────────────────────────────

test('a replayed run is waited for while it keeps drawing, and let go only once it stalls', async () => {
  // Finishes: resolves with it.
  assert.equal(await waitForRun(Promise.resolve('done'), { progress: () => 0, stallMs: 50 }), 'finished')
  // Slow but drawing (progress changes every 20 ms, finishing after 200 ms, past several stall windows).
  let count = 0
  const ticker = setInterval(() => { count += 1 }, 20)
  const slow = new Promise((resolve) => { setTimeout(resolve, 200) })
  const started = Date.now()
  assert.equal(await waitForRun(slow, { progress: () => count, stallMs: 50 }), 'finished')
  clearInterval(ticker)
  assert.ok(Date.now() - started >= 190)
  // Never finishes and nothing changes: let go after one quiet window.
  const stuck = new Promise(() => {})
  const t0 = Date.now()
  assert.equal(await waitForRun(stuck, { progress: () => 7, stallMs: 50 }), 'stalled')
  assert.ok(Date.now() - t0 < 500)
  // A run that fails is reported, not thrown.
  assert.equal(await waitForRun(Promise.reject(new Error('x')), { progress: () => 0, stallMs: 50 }), 'failed')
})
