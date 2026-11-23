// Present on a slate of any size and shape, from anyone who may edit it: the server does a bounded
// amount of work and sends a bounded prompt, the AI's plan is held to segments of related notes,
// a saved plan follows the slate as it changes, and the camera never cuts a note off.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  groupNotes, localPlan, planHints, normalizePresentationPlan, needsPlan, completeDeck, PLAN_VERSION, MAX_PLAN_SEGMENTS,
} from '../web/app/imports/ui/components/presentations/presentationPlan.mjs'
import { viewpointFrame, fitFrame } from '../web/app/imports/ui/components/presentations/presentationFraming.mjs'
import { resolvePresentationFrameNodeIds } from '../web/app/imports/ui/components/presentations/presentationRuntime.mjs'
import {
  sanitizeLayout, planEstimateMicros, planWithAI, singleFlight, reusableDeck, presentationPrompts,
  MAX_PLAN_NOTES, MAX_NOTE_TEXT, MAX_LAYOUT_CHARS, MAX_REFINEMENT_CHARS, EMPTY_SLATE,
} from '../web/app/server/methods/presentationRequest.mjs'
import { actionCeilingMicros, aiPrice } from '../web/app/server/metering/prices.mjs'

const note = (nodeId, x, y, description = nodeId, extra = {}) => ({
  nodeId, description, metrics: { rotation: 0, bbox: { x, y, width: 120, height: 60 } }, childrenNodes: [], ...extra,
})
const sorted = (ids) => [...ids].sort()
const threeClusters = () => ({
  nodes: [
    note('a-root', 0, 0, 'Goals', { childrenNodes: [note('a-left', 0, 160, 'Grow reach'), note('a-right', 220, 160, 'Keep it free')] }),
    note('b-root', 1000, 0, 'Risks', { childrenNodes: [note('b-one', 1000, 160, 'Budget', { childrenNodes: [note('b-two', 1200, 160, 'Hosting cost')] })] }),
    note('b-three', 1200, 300, 'Support load'),
    note('c-one', 450, 800, 'Next steps'),
    note('c-two', 600, 800, 'Ship the beta'),
  ],
})
const ALL = ['a-root', 'a-left', 'a-right', 'b-root', 'b-one', 'b-two', 'b-three', 'c-one', 'c-two']
const GROUPS = [['a-root', 'a-left', 'a-right'], ['b-root', 'b-one', 'b-two', 'b-three'], ['c-one', 'c-two']]

// A chain of notes, each the child of the one before, as the review's stress slate.
function chain(n, prefix = 'n') {
  let root = null
  let cur = null
  for (let i = 0; i < n; i += 1) {
    const node = { nodeId: prefix + i, description: 'note ' + i, metrics: { bbox: { x: i * 300, y: (i % 7) * 50, width: 150, height: 100 }, rotation: 0 }, childrenNodes: [] }
    if (!root) root = node
    else cur.childrenNodes.push(node)
    cur = node
  }
  return { nodes: [root] }
}
const grid = (n) => {
  const side = Math.ceil(Math.sqrt(n))
  return { nodes: Array.from({ length: n }, (_, i) => note('g' + i, (i % side) * 160, Math.floor(i / side) * 110)) }
}
const timed = (fn) => {
  const start = performance.now()
  fn()
  return performance.now() - start
}

test('grouping a large slate takes a bounded time, whatever its shape', () => {
  for (const [name, layout] of [['chain', chain(2000)], ['grid', grid(2000)]]) {
    const hints = timed(() => planHints(layout))
    const plan = timed(() => localPlan(layout, 'x'))
    assert.ok(hints < 1500, `${name}: planHints took ${Math.round(hints)} ms`)
    assert.ok(plan < 3000, `${name}: localPlan took ${Math.round(plan)} ms`)
  }
  // Still every note, in groups of at most six.
  const groups = groupNotes(chain(500))
  assert.equal(groups.flat().length, 500)
  assert.equal(new Set(groups.flat()).size, 500)
  assert.ok(groups.every((group) => group.length <= 6))
})

test('the server keeps only what a plan needs from the presenter\'s layout, within limits', () => {
  // What the presenter sends, with extra fields and a long text.
  const raw = { nodes: [{ ...note('a', 0, 0, 'x'.repeat(5000)), image: 'data:'.padEnd(9000, 'A'), extra: { deep: true },
    childrenNodes: [note('b', 0, 100, 'B', { childrenNodes: [note('a', 0, 200, 'repeat of a')] })] }] }
  const { layout, count, tooMany } = sanitizeLayout(JSON.stringify(raw))
  assert.equal(count, 2)
  assert.equal(tooMany, false)
  const a = layout.nodes[0]
  assert.deepEqual(Object.keys(a).sort(), ['childrenNodes', 'description', 'metrics', 'nodeId'])
  assert.equal(a.description.length, MAX_NOTE_TEXT)
  assert.deepEqual(a.metrics, { rotation: 0, bbox: { x: 0, y: 0, width: 120, height: 60 } })
  assert.equal(a.childrenNodes[0].nodeId, 'b')
  // A note met again (a cycle or a repeat) is not walked twice.
  assert.deepEqual(a.childrenNodes[0].childrenNodes, [])
  // Too many notes: the count says so and nothing is kept to plan.
  const big = sanitizeLayout(chain(MAX_PLAN_NOTES + 1))
  assert.equal(big.tooMany, true)
  assert.equal(big.layout, null)
  assert.ok(big.count > MAX_PLAN_NOTES)
  // A deep chain is walked without recursion limits; the cap is the guard, not the stack.
  assert.equal(sanitizeLayout(JSON.stringify(chain(MAX_PLAN_NOTES))).count, MAX_PLAN_NOTES)
  // An oversized payload, bad JSON or a missing layout are not parsed.
  assert.equal(sanitizeLayout('x'.repeat(MAX_LAYOUT_CHARS + 1)).layout, null)
  assert.equal(sanitizeLayout('{not json').layout, null)
  assert.equal(sanitizeLayout(null).count, 0)
  // Bad metrics are dropped, not passed on as text.
  const odd = sanitizeLayout({ nodes: [{ nodeId: 7, description: { a: 1 }, metrics: { bbox: { x: 'x' }, rotation: 'r' } }] })
  assert.deepEqual(odd.layout.nodes[0], { nodeId: '7', description: '', metrics: { rotation: 0, bbox: null }, childrenNodes: [] })
  assert.ok(MAX_REFINEMENT_CHARS >= 1000)
})

test('the largest slate the server plans costs no more than a request may spend, and the meter holds that', () => {
  const layout = sanitizeLayout(grid(MAX_PLAN_NOTES).nodes.map((item) => ({ ...item, description: 'w'.repeat(MAX_NOTE_TEXT) }))
    .reduce((acc, item) => (acc.nodes.push(item), acc), { nodes: [] })).layout
  const prompts = presentationPrompts({ name: 'Big', layout, scenes: [] })
  const chars = prompts.system.length + prompts.user.length
  const dearest = aiPrice('a model no one has priced')
  const estimate = planEstimateMicros(chars, [dearest])
  assert.ok(estimate <= actionCeilingMicros('presentation'), `estimate ${estimate} over the ceiling ${actionCeilingMicros('presentation')}`)
  // The estimate grows with the prompt, and a small slate's is small.
  const small = planEstimateMicros(2000, [aiPrice('Qwen/Qwen3-235B-A22B-Instruct-2507')])
  assert.ok(small < estimate)
  assert.ok(planEstimateMicros(20000, [dearest]) > planEstimateMicros(2000, [dearest]))
})

test('every intention plans segments of related notes, never one note at a time', () => {
  const prompts = presentationPrompts({ name: 'P', layout: threeClusters(), scenes: [] })
  for (const intention of ['dynamic', 'slideDeck', 'nonTemplate', 'template']) {
    const system = prompts.systemFor({ intentionId: intention === 'nonTemplate' || intention === 'template' ? undefined : intention, isTemplate: intention === 'template' })
    assert.match(system, /segments/)
    assert.doesNotMatch(system, /individually|no grouping|single node to focus/i, intention)
  }
  // Restated 2026-11-22: the user prompt holds the kept layout, compact (each note as [id, text,
  // x, y, width, height], connections as pairs, no key names or nesting), and the suggested groups.
  assert.match(prompts.user, /^Please plan the presentation of this slate\. Notes \[id, text, x, y, width, height\]: \[\["a-root","Goals",0,0,120,60\],/)
  assert.match(prompts.user, /Connections \[from, to\]: \[\["a-root","a-left"\],\["a-root","a-right"\],\["b-root","b-one"\],\["b-one","b-two"\]\]/)
  assert.match(prompts.user, /Suggested groups/)
  assert.doesNotMatch(prompts.user, /metrics|childrenNodes|bbox|rotation|<svg/)
})

test('an AI plan of one note per step becomes segments of related notes, with the AI\'s words', () => {
  const layout = threeClusters()
  const singles = {
    viewpoints: [
      { nodeIds: ALL, narrative: 'All of it', duration: 4000 },
      ...ALL.map((id) => ({ nodeIds: [id], narrative: 'About ' + id, duration: 2000 })),
      { nodeIds: ALL, narrative: 'The end', duration: 3000 },
    ],
  }
  const plan = normalizePresentationPlan(singles, layout).viewpoints
  assert.deepEqual(plan.map((viewpoint) => sorted(viewpoint.nodeIds)), [sorted(ALL), ...GROUPS.map(sorted), sorted(ALL)])
  assert.equal(plan[0].narrative, 'All of it')
  assert.equal(plan[1].narrative, 'About a-root')
  assert.equal(plan.at(-1).narrative, 'The end')
  // However many steps the AI sends, the plan has at most the cap of segments.
  const many = { viewpoints: Array.from({ length: 300 }, (_, i) => ({ nodeIds: ['g' + (i % 40)], narrative: 'x', duration: 99999 })) }
  const capped = normalizePresentationPlan(many, grid(40)).viewpoints
  assert.ok(capped.length <= MAX_PLAN_SEGMENTS + 2, String(capped.length))
  assert.ok(capped.slice(1, -1).filter((viewpoint) => viewpoint.nodeIds.length === 1).length <= capped.length / 2)
  // A plan with a few notes that stand on their own is kept.
  const fine = {
    viewpoints: [
      { nodeIds: ALL, narrative: 'All', duration: 4000 },
      { nodeIds: GROUPS[0], narrative: 'Goals', duration: 3000 },
      { nodeIds: ['b-root'], narrative: 'The big risk', duration: 3000 },
      { nodeIds: ['b-one', 'b-two', 'b-three'], narrative: 'Its parts', duration: 3000 },
      { nodeIds: GROUPS[2], narrative: 'Next', duration: 3000 },
      { nodeIds: ALL, narrative: 'End', duration: 3000 },
    ],
  }
  assert.deepEqual(normalizePresentationPlan(fine, layout).viewpoints, fine.viewpoints)
})

test('a saved AI plan is planned again when the slate has notes it does not show', () => {
  const deck = {
    planVersion: PLAN_VERSION,
    viewpoints: [{ nodeIds: ALL }, ...GROUPS.map((nodeIds) => ({ nodeIds })), { nodeIds: ALL }],
  }
  assert.equal(needsPlan(deck, threeClusters()), false)
  const grown = threeClusters()
  grown.nodes.push(note('d-one', 3000, 3000, 'New'), note('d-two', 3150, 3000, 'Newer'))
  assert.equal(needsPlan(deck, grown), true)
  // Most of its notes gone: planned again too.
  assert.equal(needsPlan(deck, { nodes: [note('a-root', 0, 0), note('c-one', 450, 800), note('zz', 0, 900)] }), true)
  // A published or hand-edited deck is kept; it is brought up to date when it is played.
  assert.equal(needsPlan({ ...deck, isPublished: true }, grown), false)
  assert.equal(needsPlan({ ...deck, viewpointsManuallyChanged: { updated: [{ nodeIds: ['a-root'] }], deleted: [] } }, grown), false)
})

test('a kept deck played over a grown slate opens and closes on every note and shows the new ones', () => {
  const grown = threeClusters()
  grown.nodes.push(note('d-one', 3000, 3000, 'Later idea'), note('d-two', 3150, 3000, 'Another'))
  const viewpoints = [
    { nodeIds: ALL, narrative: 'Open' }, ...GROUPS.map((nodeIds, i) => ({ nodeIds, narrative: 'Seg ' + i })), { nodeIds: ALL, narrative: 'Close' },
  ]
  const played = completeDeck(viewpoints, grown)
  const all = [...ALL, 'd-one', 'd-two']
  assert.deepEqual(sorted(played[0].nodeIds), sorted(all))
  assert.deepEqual(sorted(played.at(-1).nodeIds), sorted(all))
  assert.equal(played[0].narrative, 'Open')
  assert.deepEqual(sorted(played.at(-2).nodeIds), ['d-one', 'd-two'])
  assert.equal(played.length, viewpoints.length + 1)
  // Nothing new: the deck is as it was.
  assert.deepEqual(completeDeck(viewpoints, threeClusters()), viewpoints)
})

test('a segment after an overview is framed by its own notes only', () => {
  const layout = threeClusters()
  assert.deepEqual(sorted(resolvePresentationFrameNodeIds(layout, GROUPS[0], ALL)), sorted(GROUPS[0]))
  assert.deepEqual(sorted(resolvePresentationFrameNodeIds(layout, ['b-one', 'b-two'], ['b-root', 'b-three'])), ['b-one', 'b-two'])
})

test('the camera never puts a note behind the narrative or the controls, even on a phone held sideways', () => {
  const frame = viewpointFrame(GROUPS[1], threeClusters())
  for (const screen of [
    { width: 844, height: 390, top: 90, bottom: 200 },
    { width: 844, height: 390, top: 140, bottom: 220 },
    { width: 390, height: 844, top: 120, bottom: 170 },
  ]) {
    const fit = fitFrame(frame, screen)
    const top = fit.y - (frame.height / 2) * fit.scale
    const bottom = fit.y + (frame.height / 2) * fit.scale
    assert.ok(top >= screen.top - 0.01, JSON.stringify({ screen, top }))
    assert.ok(bottom <= screen.height - screen.bottom + 0.01, JSON.stringify({ screen, bottom }))
    assert.ok(fit.scale > 0)
  }
})

test('a provider failure gives back the plan it was counted as, and the person sees why', async () => {
  const layout = threeClusters()
  let ran = 0
  const run = async (fn) => {
    ran += 1
    return fn()
  }
  // The AI answers: its plan, checked against the slate.
  const good = await planWithAI({ run, layout, request: async () => ({ json: { content: [{ type: 'tool_use', id: 't1', input: { name: 'N', viewpoints: [{ nodeIds: ALL, narrative: 'All', duration: 4000 }, ...GROUPS.map((nodeIds) => ({ nodeIds, narrative: 'S', duration: 3000 })), { nodeIds: ALL, narrative: 'End', duration: 3000 }] } }] } }) })
  assert.equal(good.automatic, false)
  assert.equal(good.plan.viewpoints.length, 5)
  assert.equal(good.toolUse.id, 't1')
  // The provider fails, aborts, or sends nothing: the run that counted it sees a failure (so the
  // meter gives the plan back), and the person gets the grouped automatic plan and the reason.
  const seen = []
  const watching = async (fn) => {
    try {
      const out = await fn()
      seen.push('ok')
      return out
    } catch (error) {
      seen.push('failed')
      throw error
    }
  }
  for (const request of [
    async () => { throw new Error('HTTP 500') },
    async () => ({ abort: true, abortMessage: 'Sorry, I ran into a problem. Bad gateway.' }),
    async () => ({ json: { content: [{ type: 'tool_use', input: { viewpoints: [{ nodeIds: ['ghost'] }] } }] } }),
  ]) {
    const out = await planWithAI({ run: watching, layout, request, name: 'Plan' })
    assert.equal(out.automatic, true)
    assert.ok(out.reason.length > 0)
    assert.deepEqual(out.plan.viewpoints.map((viewpoint) => sorted(viewpoint.nodeIds)), [sorted(ALL), ...GROUPS.map(sorted), sorted(ALL)])
  }
  assert.deepEqual(seen, ['failed', 'failed', 'failed'])
  assert.equal((await planWithAI({ run: watching, layout, request: async () => { throw new Error('HTTP 500') } })).reason, 'HTTP 500')
  // A refusal before anything is sent is said as the meter said it.
  const refused = await planWithAI({ run: async () => { throw Object.assign(new Error("You have used today's free presentation plans."), { error: 'presentations-today' }) }, layout, request: async () => assert.fail('sent') })
  assert.equal(refused.reason, "You have used today's free presentation plans.")
  // A refinement the AI cannot make is an error, not an automatic plan.
  await assert.rejects(planWithAI({ run, layout, refining: true, request: async () => { throw new Error('HTTP 500') } }), /HTTP 500/)
  assert.ok(ran >= 2)
})

test('an empty slate is not planned, counted or saved', () => {
  assert.equal(sanitizeLayout(JSON.stringify({ nodes: [] })).count, 0)
  assert.match(EMPTY_SLATE, /no notes/i)
})

test('two presses at once share one plan', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const work = () => singleFlight('u1:slate', async () => { calls += 1; await gate; return { version: calls } })
  const both = Promise.all([work(), work()])
  release()
  const [a, b] = await both
  assert.equal(calls, 1)
  assert.equal(a, b)
  // Once done, the next press plans again; a failure is not kept either.
  assert.equal((await work()).version, 2)
  await assert.rejects(singleFlight('u1:slate', async () => { throw new Error('no') }), /no/)
  assert.equal((await work()).version, 3)
})

test('while the AI is unavailable, Present reuses the person\'s automatic deck instead of adding versions', () => {
  assert.equal(reusableDeck({ automatic: true, viewpoints: [{}] })?.automatic, true)
  assert.equal(reusableDeck({ automatic: true, viewpoints: [{}], isPublished: true }), null)
  assert.equal(reusableDeck({ automatic: true, viewpoints: [{}], viewpointsManuallyChanged: { updated: [{}], deleted: [] } }), null)
  assert.equal(reusableDeck({ viewpoints: [{}], planVersion: PLAN_VERSION }), null)
  assert.equal(reusableDeck(null), null)
})
