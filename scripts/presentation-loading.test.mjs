// Present loads at once and is never stuck: the local plan plays immediately, Slatebox's plan
// takes its place at the start (or is offered past it), a slate of one or two notes is not
// planned, planning stops at a hard time limit with the meter's hold given back, the prompt is
// compact, and a plan is kept for the slate version it was made for.
import test from 'node:test'
import { STYLE_IDS } from '../web/app/imports/ui/components/presentations/presentationStyles.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import buildFallbackPresentation from '../web/app/imports/ui/components/presentations/buildFallbackPresentation.mjs'
import { needsPlan, planKey, PLAN_VERSION } from '../web/app/imports/ui/components/presentations/presentationPlan.mjs'
import { planArrival, startView, stepOf } from '../web/app/imports/ui/components/presentations/presentationSteps.mjs'
import { fitFrame, inSvgPixels, unionFrame, wholeSlateFrame } from '../web/app/imports/ui/components/presentations/presentationFraming.mjs'
import {
  PLAN_FUNCTIONS, PLAN_OUTPUT_TOKENS, PLAN_TIME_LIMIT_MS, PLAN_TOO_SLOW, planWithAI, presentationPrompts, sanitizeLayout,
} from '../web/app/server/methods/presentationRequest.mjs'

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
// A run like runAIAction: it sees whether the counted request failed (the hold is given back).
const watched = () => {
  const seen = []
  const run = async (fn) => {
    try {
      const out = await fn()
      seen.push('kept')
      return out
    } catch (error) {
      seen.push('given back')
      throw error
    }
  }
  return { run, seen }
}

test('planning stops at the time limit: the local plan is kept and the meter gives the plan back', async () => {
  assert.ok(PLAN_TIME_LIMIT_MS <= 20_000)
  const { run, seen } = watched()
  let asked = null
  const started = Date.now()
  const out = await planWithAI({
    run, layout: threeClusters(), name: 'Slow', timeLimitMs: 80,
    request: (options) => { asked = options; return new Promise(() => {}) },
  })
  const took = Date.now() - started
  assert.ok(took < 1000, `took ${took} ms`)
  assert.equal(out.automatic, true)
  assert.equal(out.reason, PLAN_TOO_SLOW)
  assert.deepEqual(seen, ['given back'])
  // The request was told when to stop trying (its attempts and retries end there too).
  assert.ok(asked.deadline > started && asked.deadline <= started + 80 + 50)
  // What the person keeps: the grouped local plan of the whole slate.
  assert.deepEqual(out.plan.viewpoints.map((viewpoint) => sorted(viewpoint.nodeIds)), buildFallbackPresentation(threeClusters(), 'Slow').viewpoints.map((viewpoint) => sorted(viewpoint.nodeIds)))
  // An answer in time is kept and counted.
  const quick = watched()
  const answer = { name: 'N', opening: 'All of it', closing: 'That is all', segments: [{ nodeIds: ['a-root', 'a-left', 'a-right'], narrative: 'Goals', duration: 3000 }] }
  const done = await planWithAI({ run: quick.run, layout: threeClusters(), timeLimitMs: 500,
    request: async () => ({ json: { content: [{ type: 'tool_use', id: 't', input: answer }] } }) })
  assert.equal(done.automatic, false)
  assert.deepEqual(quick.seen, ['kept'])
  // The presenter waits a little longer than the server, so the server's answer reaches it.
  const presenter = readFileSync(new URL('../web/app/imports/ui/components/PresentSlate.jsx', import.meta.url), 'utf8')
  const waits = Number(presenter.match(/const PLAN_TIMEOUT_MS = ([\d_]+)/)[1].replace(/_/g, ''))
  assert.ok(waits > PLAN_TIME_LIMIT_MS && waits <= 20_000, String(waits))
})

test('a slate of one or two notes is not planned: nothing is sent or counted, and there is no planning', async () => {
  for (const nodes of [[note('only', 0, 0)], [note('one', 0, 0), note('two', 500, 0)]]) {
    let ran = false
    let sent = false
    const out = await planWithAI({
      layout: { nodes }, name: 'Tiny',
      run: async (fn) => { ran = true; return fn() },
      request: async () => { sent = true; return {} },
    })
    assert.equal(ran, false)
    assert.equal(sent, false)
    assert.equal(out.trivial, true)
    assert.equal(out.automatic, true)
    assert.equal(out.plan.viewpoints.length, 1)
    assert.deepEqual(sorted(out.plan.viewpoints[0].nodeIds), sorted(nodes.map((item) => item.nodeId)))
  }
  // Three notes are planned.
  let ran = false
  await planWithAI({ layout: { nodes: [note('a', 0, 0), note('b', 500, 0), note('c', 1000, 0)] },
    run: async (fn) => { ran = true; return fn() }, request: async () => ({ abort: true, abortMessage: 'down' }) })
  assert.equal(ran, true)
  // The presenter shows no planning for such a slate (it asks the server, which answers at once).
  const presenter = readFileSync(new URL('../web/app/imports/ui/components/PresentSlate.jsx', import.meta.url), 'utf8')
  assert.match(presenter, /const trivial = isTrivialLayout\(preziData\)\n\s+setPlanning\(\(authoring \|\| livePlanning\) && !resume && !trivial\)/)
})

test('Slatebox\'s plan takes the local plan\'s place at the start, and is offered past it, never jumping the viewer', () => {
  const local = buildFallbackPresentation(threeClusters(), 'Plan').viewpoints
  assert.equal(startView(local), 0)
  // At the start: before the overview is shown (-1) and on it (0), it is swapped in unseen.
  assert.equal(planArrival(-1, local), 'swap')
  assert.equal(planArrival(0, local), 'swap')
  // Past the start (a segment, the close): "Slatebox's plan is ready — Use it".
  for (let view = 1; view < local.length; view += 1) assert.equal(planArrival(view, local), 'offer')
  // A deck that does not open on an overview starts before its first viewpoint.
  const edited = [{ nodeIds: ['a-root'] }, { nodeIds: ['b-root'] }]
  assert.equal(planArrival(-1, edited), 'swap')
  assert.equal(planArrival(0, edited), 'offer')
  // The presenter: an offer is a control that applies the plan only when used.
  const presenter = readFileSync(new URL('../web/app/imports/ui/components/PresentSlate.jsx', import.meta.url), 'utf8')
  assert.match(presenter, /planArrival\(nowShowing\.current\.view, nowShowing\.current\.viewpoints\) === 'swap'\) applyDeck\(deck\)\n\s+else setReadyPlan\(deck\)/)
  assert.match(presenter, /Slatebox's plan is ready<\/Typography>/)
  assert.match(presenter, /closest\('\[tabindex="-1"\]'\)\?\.focus\(\)\n\s+applyDeck\(readyPlan\)\n\s+\}\}>\s*Use it/)
  assert.doesNotMatch(presenter, /Planning with AI|AI planning is unavailable|The AI took too long/)
  assert.match(presenter, /const PLANNING = 'Planning with Slatebox…'/)
  // Presenting to everyone holds at the start while its deck is planned, so the plan never moves
  // the presenter back: the session starts on the deck they are on.
  assert.match(presenter, /holdAtStart=\{livePlanning && planning\}/)
  const base = readFileSync(new URL('../web/app/imports/ui/components/presentations/BasePresent.jsx', import.meta.url), 'utf8')
  assert.match(base, /const handleNavigate = \(direction\) => \{\n(\s+\/\/.*\n)+\s+if \(holdAtStart\) return/)
  assert.match(presenter, /<CircularProgress size=\{14\} color="inherit" aria-label=\{PLANNING\} \/>/)
})

test('the AI answers with segments only; the overviews are added around them', async () => {
  const { run } = watched()
  const answer = {
    name: 'Goals and risks', opening: 'What we want and what could stop us', closing: 'Grow, carefully',
    segments: [
      { nodeIds: ['a-root', 'a-left', 'a-right'], narrative: 'What we want', duration: 3000 },
      { nodeIds: ['b-root', 'b-one', 'b-two', 'b-three'], narrative: 'What could stop us', duration: 3500 },
      { nodeIds: ['c-one', 'c-two'], narrative: 'What happens next', duration: 3000 },
    ],
  }
  const out = await planWithAI({ run, layout: threeClusters(), request: async () => ({ json: { content: [{ type: 'tool_use', id: 't', input: answer }] } }) })
  assert.equal(out.automatic, false)
  assert.deepEqual(out.plan.viewpoints.map((viewpoint) => viewpoint.narrative),
    ['What we want and what could stop us', 'What we want', 'What could stop us', 'What happens next', 'Grow, carefully'])
  assert.deepEqual(sorted(out.plan.viewpoints[0].nodeIds), sorted(ALL))
  assert.deepEqual(sorted(out.plan.viewpoints.at(-1).nodeIds), sorted(ALL))
  // The function asks for segments and the overviews' words, not the overviews' notes, and for
  // the deck's art direction (its style and title card); the answer stays bounded.
  const shape = PLAN_FUNCTIONS[0].parameters
  assert.deepEqual(shape.required, ['name', 'description', 'opening', 'segments', 'closing', 'style', 'title'])
  assert.equal(shape.properties.viewpoints, undefined)
  assert.ok(PLAN_OUTPUT_TOKENS <= 4000)
  // An answer without art direction is still directed: from its segments, in the slate's style.
  assert.ok(STYLE_IDS.includes(out.plan.direction.style.id))
  assert.deepEqual(out.plan.direction.steps.slice(1).map((step) => step.caption).slice(0, 2), ['What we want', 'What could stop us'])
})

test('the prompt is compact: the slate as rows of numbers and words, far smaller than the layout', () => {
  // A 60-note slate of six branches, long ids like the app's, long texts.
  const id = (i) => 'n' + String(i).padStart(9, 'x')
  const nodes = Array.from({ length: 6 }, (_, b) => note(id(b * 10), b * 400, 0, 'Branch ' + b + ' — what this part of the plan is about, in a sentence or two', {
    childrenNodes: Array.from({ length: 9 }, (__, k) => note(id(b * 10 + k + 1), b * 400 + (k % 3) * 130, 150 + Math.floor(k / 3) * 80, 'Detail ' + k + ' of branch ' + b)),
  }))
  const { layout } = sanitizeLayout(JSON.stringify({ nodes }))
  const before = JSON.stringify(layout).length
  const prompt = presentationPrompts({ layout, scenes: [] }).user
  const slatePart = prompt.slice(0, prompt.indexOf('. Suggested groups'))
  assert.ok(slatePart.length < before * 0.6, `${slatePart.length} vs ${before}`)
  for (const item of nodes) assert.ok(prompt.includes(JSON.stringify(item.nodeId)))
})

test('a plan is kept for the slate version it was made for: Present on the same slate opens it at once', () => {
  const layout = threeClusters()
  const key = planKey(layout)
  // The same slate drawn again (a fraction of a unit apart) is the same version.
  const redrawn = JSON.parse(JSON.stringify(layout))
  redrawn.nodes[0].metrics.bbox.x += 0.4
  assert.equal(planKey(redrawn), key)
  const deck = { viewpoints: [{ nodeIds: ['a-root'] }], planVersion: PLAN_VERSION, layoutKey: key }
  assert.equal(needsPlan(deck, redrawn), false)
  // A note's words, a note moved, a note added, a connection: a new version, planned again.
  const changes = [
    (slate) => { slate.nodes[0].description = 'Goals for next year' },
    (slate) => { slate.nodes[3].metrics.bbox.y += 300 },
    (slate) => { slate.nodes.push(note('d-one', 2000, 2000, 'New')) },
    (slate) => { slate.nodes[4].childrenNodes.push(note('c-two-b', 700, 900, 'Linked')) },
  ]
  for (const change of changes) {
    const changed = JSON.parse(JSON.stringify(layout))
    change(changed)
    assert.notEqual(planKey(changed), key)
    assert.equal(needsPlan(deck, changed), true)
  }
  // A published deck (or one edited by hand) is kept whatever changed; an automatic one is planned again.
  const moved = JSON.parse(JSON.stringify(layout))
  moved.nodes[0].description = 'Changed'
  assert.equal(needsPlan({ ...deck, isPublished: true }, moved), false)
  assert.equal(needsPlan({ ...deck, automatic: true }, layout), true)
})

test('the whole slate is framed with what is drawn around the notes (a lane\'s column)', () => {
  const layout = { nodes: [note('lane-a', 0, 0), note('lane-b', 400, 0), note('card-x', 0, 100)] }
  const notes = wholeSlateFrame(layout)
  // The columns are drawn under the lanes, taller than the notes reach.
  const drawn = { x: -10, y: -10, width: 540, height: 600 }
  const frame = unionFrame(notes, drawn)
  const left = frame.centerX - frame.width / 2
  const top = frame.centerY - frame.height / 2
  assert.deepEqual([left, top, left + frame.width, top + frame.height], [-10, -10, 530, 590])
  assert.equal(frame.rotation, 0)
  // Nothing drawn measured: the notes' frame.
  assert.deepEqual(unionFrame(notes, null), { ...notes })
  assert.equal(unionFrame(null, null), null)
})

test('a one-note slate is framed large and centred, with no "0 / 0" counter', async () => {
  // The guest's first slate: one note far from the origin, as the editor places it.
  const layout = { nodes: [note('welcome', 9990, 9990, 'Welcome!')] }
  const { plan } = await planWithAI({ layout, name: 'New Slate', run: async (fn) => fn(), request: async () => ({}) })
  // One overview, nothing to step through: the presenter shows no counter, and says "whole slate" live.
  const { step, total } = stepOf(startView(plan.viewpoints), plan.viewpoints)
  assert.deepEqual([step, total], [0, 0])
  const base = readFileSync(new URL('../web/app/imports/ui/components/presentations/BasePresent.jsx', import.meta.url), 'utf8')
  assert.match(base, /\{total > 0 && \(\n\s+<Tooltip title="Presentation steps">/)
  const live = readFileSync(new URL('../web/app/imports/ui/components/presentations/useLivePresentation.jsx', import.meta.url), 'utf8')
  assert.match(live, /view < start \|\| total === 0 \? 'whole slate'/)
  // The note is framed on its own, at the most the camera zooms in: never from the origin.
  const frame = wholeSlateFrame(layout)
  assert.deepEqual([frame.centerX, frame.centerY, frame.width, frame.height], [10050, 10020, 120, 60])
  const fit = fitFrame(frame, { width: 1161, height: 844, top: 110, bottom: 120 })
  assert.equal(fit.scale, 3)
  // What is drawn is measured in the slate's own SVG (the one in the camera), not the first SVG in
  // the presenter, which may be an icon: measured there, the note was framed from 0, 0 at 6 %.
  assert.match(base, /const slateSvg = \(\) => containerRef\.current\?\.querySelector\('\.sb-presentation-camera svg'\)/)
  assert.doesNotMatch(base, /containerRef\.current\?\.querySelector\('svg'\)/)
})

test('what is drawn is measured in the SVG\'s own pixels, not its user units (a viewBox far from 0)', () => {
  // As on test.slatebox.com: the presented SVG is 143.5 px wide, its viewBox starts at 9990, the
  // camera shows it at 6 %, and the note is drawn 10 px in. Its box joins the layout's at 10, 10.
  const scale = 0.0604
  const svgBox = { left: 275, top: 145, width: 143.524 * scale, height: 88.717 * scale }
  const note = { left: 275 + 10 * scale, top: 145 + 10 * scale, width: 124 * scale, height: 69 * scale }
  const drawn = inSvgPixels(note, svgBox, 143.524)
  assert.deepEqual([drawn.x, drawn.y, drawn.width, drawn.height].map(Math.round), [10, 10, 124, 69])
  const frame = unionFrame({ centerX: 72, centerY: 44.5, width: 124, height: 69, rotation: 0 }, drawn)
  assert.deepEqual([frame.centerX, frame.centerY, frame.width, frame.height].map(Math.round), [72, 45, 124, 69])
  // At full size the screen box is the SVG's pixels.
  assert.deepEqual(inSvgPixels({ left: 110, top: 220, width: 50, height: 20 }, { left: 100, top: 200, width: 300, height: 200 }, 300),
    { x: 10, y: 20, width: 50, height: 20 })
  const base = readFileSync(new URL('../web/app/imports/ui/components/presentations/BasePresent.jsx', import.meta.url), 'utf8')
  assert.match(base, /const next = inSvgPixels\(onScreen, svgBox, svgWidth\)/)
  assert.doesNotMatch(base, /getScreenCTM/)
})
