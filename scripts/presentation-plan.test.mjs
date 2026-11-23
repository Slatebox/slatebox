// A presentation is a plan of segments: an overview of the whole slate, then viewpoints that
// each frame a group of related notes (a cluster, a branch, a lane, a note with its connected
// neighbours), then a closing overview. The AI makes the plan; the local plan (shown at once,
// and whenever the AI is unavailable) groups the notes the same way.
import test from 'node:test'
import assert from 'node:assert/strict'
import buildFallbackPresentation, { reconcileViewpoints } from '../web/app/imports/ui/components/presentations/buildFallbackPresentation.mjs'
import {
  groupNotes, normalizePresentationPlan, needsPlan, planFailureReason, planHints, PLAN_VERSION,
} from '../web/app/imports/ui/components/presentations/presentationPlan.mjs'
import { rotatedBounds, viewpointFrame, fitFrame } from '../web/app/imports/ui/components/presentations/presentationFraming.mjs'
import calculateViewpointMetrics from '../web/app/imports/ui/components/presentations/calculateViewpointMetrics.js'
import { workshopScenes } from '../web/app/imports/ui/components/presentations/workshopScenes.mjs'
import { planWithAI } from '../web/app/server/methods/presentationRequest.mjs'
import { startView, stepOf } from '../web/app/imports/ui/components/presentations/presentationSteps.mjs'

const note = (nodeId, x, y, description = nodeId, extra = {}) => ({
  nodeId, description, metrics: { rotation: 0, bbox: { x, y, width: 120, height: 60 } }, childrenNodes: [], ...extra,
})

// Eight notes in three clusters: two connected trees and a pair of unconnected neighbours.
const threeClusters = () => ({
  nodes: [
    note('a-root', 0, 0, 'Goals', { childrenNodes: [note('a-left', 0, 160, 'Grow reach'), note('a-right', 220, 160, 'Keep it free')] }),
    note('b-root', 1000, 0, 'Risks', { childrenNodes: [note('b-one', 1000, 160, 'Budget', { childrenNodes: [note('b-two', 1200, 160, 'Hosting cost')] })] }),
    note('b-three', 1200, 300, 'Support load'),
    note('c-one', 450, 800, 'Next steps'),
    note('c-two', 600, 800, 'Ship the beta'),
  ],
})
// b-three is near b-two (a connected cluster's neighbour) only by distance: 80 below it.
const ALL = ['a-root', 'a-left', 'a-right', 'b-root', 'b-one', 'b-two', 'b-three', 'c-one', 'c-two']

const sorted = (ids) => [...ids].sort()

test('the local plan groups notes by connection and proximity, in reading order', () => {
  const groups = groupNotes(threeClusters())
  assert.deepEqual(groups.map(sorted), [
    sorted(['a-root', 'a-left', 'a-right']),
    sorted(['b-root', 'b-one', 'b-two', 'b-three']),
    sorted(['c-one', 'c-two']),
  ])
})

test('the local presentation opens and closes on the whole slate, with one segment per group', () => {
  const plan = buildFallbackPresentation(threeClusters(), 'Plan')
  const ids = plan.viewpoints.map((viewpoint) => sorted(viewpoint.nodeIds))
  assert.equal(plan.viewpoints.length, 5)
  assert.deepEqual(ids[0], sorted(ALL))
  assert.deepEqual(ids[4], sorted(ALL))
  assert.deepEqual(ids.slice(1, 4), [
    sorted(['a-root', 'a-left', 'a-right']), sorted(['b-root', 'b-one', 'b-two', 'b-three']), sorted(['c-one', 'c-two']),
  ])
  // A segment is never one note per step when its notes belong together.
  assert.ok(plan.viewpoints.slice(1, -1).every((viewpoint) => viewpoint.nodeIds.length > 1))
  // Every viewpoint says something, in plain words taken from the notes.
  for (const viewpoint of plan.viewpoints) {
    assert.equal(typeof viewpoint.narrative, 'string')
    assert.ok(viewpoint.narrative.length > 0)
    assert.ok(viewpoint.duration >= 2000)
  }
  assert.match(plan.viewpoints[1].narrative, /Goals/)
  assert.match(plan.viewpoints[2].narrative, /Risks/)
})

test('a tiny slate is one overview', () => {
  assert.equal(buildFallbackPresentation({ nodes: [note('only', 0, 0)] }, 'Tiny').viewpoints.length, 1)
  const two = buildFallbackPresentation({ nodes: [note('one', 0, 0), note('two', 2000, 2000)] }, 'Tiny')
  assert.equal(two.viewpoints.length, 1)
  assert.deepEqual(sorted(two.viewpoints[0].nodeIds), ['one', 'two'])
  // Restated 2026-11-22: a slate of three notes or more always has segments, even when its
  // notes are one cluster: the cluster's branches (see the next test).
  const one = buildFallbackPresentation({ nodes: [note('r', 0, 0, 'Root', { childrenNodes: [note('c1', 0, 150), note('c2', 200, 150)] })] }, 'One')
  assert.equal(one.viewpoints.length, 4)
  assert.deepEqual(buildFallbackPresentation({ nodes: [] }, 'Empty').viewpoints, [])
})

test('a slate that is one connected cluster of more than three notes is presented branch by branch', () => {
  // An outage flow: a trigger with two branches of two notes each.
  const flow = { nodes: [note('trigger', 300, 0, 'Sign-in fails', { childrenNodes: [
    note('left', 0, 160, 'Check the identity provider', { childrenNodes: [note('left-2', 0, 320, 'Fail over to backup')] }),
    note('right', 600, 160, 'Check the session store', { childrenNodes: [note('right-2', 600, 320, 'Flush stale sessions')] }),
  ] })] }
  const plan = buildFallbackPresentation(flow, 'Outage')
  const segments = plan.viewpoints.slice(1, -1)
  assert.ok(segments.length >= 2, JSON.stringify(plan.viewpoints))
  assert.ok(segments.every((viewpoint) => viewpoint.nodeIds.length <= 3))
  assert.deepEqual(sorted(segments.flatMap((viewpoint) => viewpoint.nodeIds)), sorted(['trigger', 'left', 'left-2', 'right', 'right-2']))
  assert.deepEqual(sorted(segments[0].nodeIds), ['left', 'right', 'trigger'])
  // Restated 2026-11-22: three connected notes are an overview, their branches (none of them the
  // whole slate), and the closing overview; a plan of three notes or more never has no segment.
  const three = buildFallbackPresentation({ nodes: [note('r', 0, 0, 'Root', { childrenNodes: [note('c1', 0, 150), note('c2', 200, 150)] })] }, 'Three').viewpoints
  const parts = three.slice(1, -1)
  assert.ok(parts.length >= 2, JSON.stringify(three))
  assert.ok(parts.every((viewpoint) => viewpoint.nodeIds.length < 3))
  assert.deepEqual(sorted(parts.flatMap((viewpoint) => viewpoint.nodeIds)), ['c1', 'c2', 'r'])
  assert.deepEqual(sorted(three[0].nodeIds), ['c1', 'c2', 'r'])
  assert.deepEqual(sorted(three.at(-1).nodeIds), ['c1', 'c2', 'r'])
})

test('an AI plan of overviews only gets the local segments: a plan of three notes or more always has segments', () => {
  const overview = (narrative) => ({ nodeIds: ALL, narrative, duration: 4000 })
  for (const viewpoints of [[overview('All of it')], [overview('All'), overview('All again'), overview('The end')], [overview('All'), overview('End')]]) {
    const plan = normalizePresentationPlan({ viewpoints }, threeClusters())
    const segments = plan.viewpoints.slice(1, -1)
    assert.ok(segments.length >= 2, JSON.stringify(plan.viewpoints))
    assert.ok(segments.every((viewpoint) => viewpoint.nodeIds.length < ALL.length))
    assert.deepEqual(sorted(new Set(segments.flatMap((viewpoint) => viewpoint.nodeIds))), sorted(ALL))
    assert.equal(plan.viewpoints[0].narrative, viewpoints[0].narrative)
  }
  // One cluster of three notes: its branches.
  const cluster = { nodes: [note('r', 0, 0, 'Root', { childrenNodes: [note('c1', 0, 150), note('c2', 200, 150)] })] }
  const plan = normalizePresentationPlan({ viewpoints: [{ nodeIds: ['r', 'c1', 'c2'], narrative: 'Everything' }] }, cluster)
  const segments = plan.viewpoints.slice(1, -1)
  assert.ok(segments.length >= 2, JSON.stringify(plan.viewpoints))
  assert.deepEqual(sorted(segments.flatMap((viewpoint) => viewpoint.nodeIds)), ['c1', 'c2', 'r'])
  // Two notes: the overview is the whole presentation, as the local plan has it.
  assert.equal(normalizePresentationPlan({ viewpoints: [{ nodeIds: ['one', 'two'], narrative: 'Both' }] }, { nodes: [note('one', 0, 0), note('two', 500, 0)] }).viewpoints.length, 1)
})

test('a big cluster is split into a hub with its neighbours and then its branches, none larger than six', () => {
  const leaves = Array.from({ length: 9 }, (_, i) => note('leaf-' + i, (i % 3) * 400 - 400, 300 + Math.floor(i / 3) * 400))
  const hub = note('hub', 0, 0, 'Hub', { childrenNodes: leaves })
  const groups = groupNotes({ nodes: [hub] })
  assert.ok(groups.every((group) => group.length <= 6), JSON.stringify(groups))
  assert.deepEqual(sorted(groups.flat()), sorted(['hub', ...leaves.map((leaf) => leaf.nodeId)]))
  assert.ok(groups[0].includes('hub'))
  // A grid of twelve unconnected sticky notes touching each other is split into rows.
  const grid = Array.from({ length: 12 }, (_, i) => note('g' + i, (i % 4) * 130, Math.floor(i / 4) * 70))
  const rows = groupNotes({ nodes: grid })
  assert.ok(rows.length >= 2 && rows.every((group) => group.length <= 6))
  assert.deepEqual(sorted(rows.flat()), sorted(grid.map((item) => item.nodeId)))
})

test('a workshop\'s lanes are segments after the overview, then the other groups', () => {
  const workshop = {
    version: 1, title: 'Walk',
    lanes: [{ id: 'quay', label: 'At the quay' }, { id: 'market', label: 'Market square' }],
    cards: [{ id: 'ferry', label: 'Ferry horn', laneId: 'quay' }],
  }
  const scenes = workshopScenes(workshop)
  const layout = { nodes: [
    note('lane-quay', 400, 100), note('lane-market', 800, 100), note('card-ferry', 400, 200),
    note('x1', 0, 900, 'Extra one'), note('x2', 140, 900, 'Extra two'),
  ] }
  const plan = buildFallbackPresentation(layout, 'Walk', { scenes })
  assert.deepEqual(plan.viewpoints.map((viewpoint) => sorted(viewpoint.nodeIds)), [
    sorted(['lane-quay', 'lane-market', 'card-ferry', 'x1', 'x2']),
    ['card-ferry', 'lane-quay'], ['lane-market'], ['x1', 'x2'],
    sorted(['lane-quay', 'lane-market', 'card-ferry', 'x1', 'x2']),
  ])
  assert.deepEqual(plan.viewpoints.slice(1, 3).map((viewpoint) => viewpoint.narrative), ['At the quay', 'Market square'])
  // The overview frames every lane: it stays where it is when the deck is played over the slate.
  const played = reconcileViewpoints(plan.viewpoints, layout, scenes)
  assert.deepEqual(played.map((viewpoint) => viewpoint.narrative), plan.viewpoints.map((viewpoint) => viewpoint.narrative))
})

// The workshop of the post-deploy specs (app-workshops, app-concept-map): three lanes in an
// authored order that is not the board's, and a map whose steps have outcomes.
const pilots = {
  version: 1, title: 'Review the winter shutdown pilots',
  lanes: [{ id: 'proposed', label: 'Proposed trials' }, { id: 'pilot', label: 'Fund this quarter' }, { id: 'evidence', label: 'Gather evidence' }],
  cards: [
    { id: 'sensors', label: 'Sensors', laneId: 'pilot' }, { id: 'training', label: 'Training', laneId: 'pilot' },
    { id: 'spares', label: 'Spares', laneId: 'evidence' }, { id: 'cooling', label: 'Cooling', laneId: 'evidence' },
  ],
}
const pilotsLayout = () => ({ nodes: [
  note('lane-proposed', 0, 0), note('lane-pilot', 300, 0), note('lane-evidence', 600, 0),
  note('card-sensors', 300, 100), note('card-training', 300, 200), note('card-spares', 600, 100), note('card-cooling', 600, 200),
] })
const PILOT_NOTES = pilotsLayout().nodes.map((item) => item.nodeId)
const LANE_STEPS = [['lane-proposed'], ['card-sensors', 'card-training', 'lane-pilot'], ['card-cooling', 'card-spares', 'lane-evidence']]

test('an AI plan of a workshop keeps its lanes as the segments, in order, each named by its lane', () => {
  const scenes = workshopScenes(pilots)
  // The AI starts with the evidence, joins two lanes in one step, names a lane its own way and
  // leaves the proposed trials out.
  const ai = {
    viewpoints: [
      { nodeIds: PILOT_NOTES, narrative: 'Where the pilots stand', duration: 4000 },
      { nodeIds: ['lane-evidence', 'card-spares'], narrative: 'Gather evidence — spares and cooling need numbers first', duration: 5000 },
      { nodeIds: ['lane-pilot', 'card-sensors', 'lane-evidence'], narrative: 'Money and proof', duration: 3000 },
      { nodeIds: ['lane-pilot', 'card-training'], narrative: 'Sensors and training are funded now', duration: 4500 },
      { nodeIds: PILOT_NOTES, narrative: 'Back to the board', duration: 3000 },
    ],
  }
  const plan = normalizePresentationPlan(ai, pilotsLayout(), { name: pilots.title, scenes })
  assert.deepEqual(plan.viewpoints.map((viewpoint) => sorted(viewpoint.nodeIds)), [sorted(PILOT_NOTES), ...LANE_STEPS.map(sorted), sorted(PILOT_NOTES)])
  assert.deepEqual(plan.viewpoints.map((viewpoint) => viewpoint.narrative), [
    'Where the pilots stand',
    'Proposed trials',
    'Fund this quarter — Sensors and training are funded now',
    'Gather evidence — spares and cooling need numbers first',
    'Back to the board',
  ])
  assert.deepEqual(plan.viewpoints.map((viewpoint) => viewpoint.duration), [4000, 3000, 4500, 5000, 3000])
  // Played over the board, the lanes stay where the plan put them.
  const played = reconcileViewpoints(plan.viewpoints, pilotsLayout(), scenes)
  assert.deepEqual(played.map((viewpoint) => viewpoint.narrative), plan.viewpoints.map((viewpoint) => viewpoint.narrative))
  // Each lane step's narrative is the lane's name, then (maybe) " — " and more: what viewers see.
  scenes.forEach((scene, index) => assert.match(plan.viewpoints[index + 1].narrative, new RegExp('^' + scene.label + '( — .*)?$')))
})

test('an AI plan of a map keeps each step\'s outcome and the slate\'s other notes after the steps', () => {
  const map = {
    version: 1, title: 'Last shuttle',
    lanes: [
      { id: 'lift', label: 'Market St lift', station: { column: 0, row: 0, next: ['depot'], outcome: 'Market St lift' } },
      { id: 'depot', label: 'Depot', station: { column: 1, row: 0, next: [], outcome: 'Dispatch records the arrival.' } },
    ],
    cards: [{ id: 'rider', label: 'Last rider', laneId: 'depot' }],
  }
  const scenes = workshopScenes(map)
  const layout = { nodes: [note('lane-lift', 0, 0), note('lane-depot', 300, 0), note('card-rider', 300, 100), note('legend', 0, 900, 'How to read the map')] }
  const plan = normalizePresentationPlan({ viewpoints: [
    { nodeIds: ['legend'], narrative: 'Start with the key', duration: 3000 },
    { nodeIds: ['lane-depot', 'card-rider'], narrative: 'Depot: the rider arrives and is logged', duration: 3000 },
  ] }, layout, { name: map.title, scenes })
  assert.deepEqual(plan.viewpoints.slice(1, -1).map((viewpoint) => [viewpoint.narrative, sorted(viewpoint.nodeIds)]), [
    ['Market St lift', ['lane-lift']],
    ['Depot — Dispatch records the arrival. The rider arrives and is logged', ['card-rider', 'lane-depot']],
    ['Start with the key', ['legend']],
  ])
  // Words that only repeat the lane's own are not said twice.
  const same = normalizePresentationPlan({ viewpoints: [{ nodeIds: ['lane-depot'], narrative: 'Depot — Dispatch records the arrival.' }] }, layout, { scenes })
  assert.equal(same.viewpoints[2].narrative, 'Depot — Dispatch records the arrival.')
})

test('a workshop planned by the AI (a stubbed provider) and without it opens with its lanes in order', async () => {
  const scenes = workshopScenes(pilots)
  const run = async (fn) => fn()
  const reply = { name: 'Pilots', viewpoints: [
    { nodeIds: PILOT_NOTES, narrative: 'All of it', duration: 4000 },
    { nodeIds: ['lane-evidence', 'card-spares', 'card-cooling'], narrative: 'Proof first', duration: 3000 },
    { nodeIds: ['lane-proposed'], narrative: 'Ideas on the table', duration: 3000 },
    { nodeIds: ['lane-pilot', 'card-sensors', 'card-training'], narrative: 'Funded', duration: 3000 },
  ] }
  const planned = await planWithAI({ run, layout: pilotsLayout(), name: pilots.title, scenes,
    request: async () => ({ json: { content: [{ type: 'tool_use', id: 't', input: reply }] } }) })
  assert.equal(planned.automatic, false)
  const unplanned = await planWithAI({ run, layout: pilotsLayout(), name: pilots.title, scenes, request: async () => { throw new Error('HTTP 500') } })
  assert.equal(unplanned.automatic, true)
  for (const { plan } of [planned, unplanned]) {
    assert.deepEqual(plan.viewpoints.map((viewpoint) => sorted(viewpoint.nodeIds)), [sorted(PILOT_NOTES), ...LANE_STEPS.map(sorted), sorted(PILOT_NOTES)])
    scenes.forEach((scene, index) => assert.match(plan.viewpoints[index + 1].narrative, new RegExp('^' + scene.label + '( — .*)?$')))
  }
  assert.deepEqual(planned.plan.viewpoints.slice(1, 4).map((viewpoint) => viewpoint.narrative),
    ['Proposed trials — Ideas on the table', 'Fund this quarter — Funded', 'Gather evidence — Proof first'])
})

test('a plan starts on its overview: step 0 is the whole slate with its narrative, step 1 the first segment', () => {
  // The local plan of a workshop: overview, the lanes, the other notes, the closing overview.
  const local = buildFallbackPresentation(pilotsLayout(), pilots.title, { scenes: workshopScenes(pilots) }).viewpoints
  assert.equal(startView(local), 0)
  assert.deepEqual(stepOf(-1, local), { step: 0, total: local.length - 1, start: 0 })
  assert.deepEqual(stepOf(0, local), { step: 0, total: local.length - 1, start: 0 })
  assert.equal(local[0].narrative, `${pilots.title}: the whole slate`)
  assert.equal(stepOf(1, local).step, 1)
  assert.equal(local[1].narrative, 'Proposed trials')
  // The closing overview is the last step: "N / N".
  assert.deepEqual(stepOf(local.length - 1, local), { step: local.length - 1, total: local.length - 1, start: 0 })
  assert.deepEqual(sorted(local.at(-1).nodeIds), sorted(PILOT_NOTES))
  // The AI's plan of the same board, and of a plain slate, start the same way.
  const ai = normalizePresentationPlan({ viewpoints: [{ nodeIds: ['lane-pilot'], narrative: 'Funded' }] }, pilotsLayout(), { scenes: workshopScenes(pilots) })
  assert.equal(startView(ai.viewpoints), 0)
  assert.equal(startView(normalizePresentationPlan({ viewpoints: [{ nodeIds: ['a-root'], narrative: 'Goals' }] }, threeClusters()).viewpoints), 0)
  // A deck edited by hand that does not open with the whole slate starts before its first
  // viewpoint, as before: "0 / N" is the slate, step 1 its first viewpoint.
  const edited = [{ nodeIds: ['a-root', 'a-left'] }, { nodeIds: ['b-root'] }, { nodeIds: ['c-one'] }]
  assert.equal(startView(edited), -1)
  assert.deepEqual(stepOf(-1, edited), { step: 0, total: 3, start: -1 })
  assert.deepEqual(stepOf(0, edited), { step: 1, total: 3, start: -1 })
  assert.equal(startView([]), -1)
})

test('an AI plan is kept as the AI made it when it is well formed', () => {
  const layout = threeClusters()
  const ai = {
    name: 'Goals and risks',
    viewpoints: [
      { nodeIds: ALL, narrative: 'The plan at a glance', duration: 4000 },
      { nodeIds: ['a-root', 'a-left', 'a-right'], narrative: 'What we want', duration: 3000 },
      { nodeIds: ['b-root', 'b-one', 'b-two', 'b-three'], narrative: 'What could stop us', duration: 3500 },
      { nodeIds: ['c-one', 'c-two'], narrative: 'What happens next', duration: 3000 },
      { nodeIds: ALL, narrative: 'Back to the whole picture', duration: 3000 },
    ],
  }
  assert.deepEqual(normalizePresentationPlan(ai, layout).viewpoints, ai.viewpoints)
})

test('an AI plan is repaired: unknown and repeated notes go, overviews and missing notes are added', () => {
  const layout = threeClusters()
  const repaired = normalizePresentationPlan({
    viewpoints: [
      { nodeIds: ['a-root', 'a-left', 'a-left', 'ghost'], narrative: '  What we want  ', duration: 50 },
      { nodeIds: ['ghost'], narrative: 'Gone', duration: 3000 },
      { nodeIds: 'b-root', narrative: 'Risks', duration: 999999 },
    ],
  }, layout, { name: 'Plan' })
  const ids = repaired.viewpoints.map((viewpoint) => sorted(viewpoint.nodeIds))
  assert.deepEqual(ids[0], sorted(ALL))
  assert.deepEqual(ids.at(-1), sorted(ALL))
  assert.deepEqual(ids[1], ['a-left', 'a-root'])
  assert.deepEqual(ids[2], ['b-root'])
  assert.equal(repaired.viewpoints[1].narrative, 'What we want')
  assert.ok(repaired.viewpoints.every((viewpoint) => viewpoint.duration >= 1500 && viewpoint.duration <= 10000))
  // Every note is in some segment between the overviews.
  assert.deepEqual(sorted(new Set(repaired.viewpoints.slice(1, -1).flatMap((viewpoint) => viewpoint.nodeIds))), sorted(ALL))
  // A tiny slate's plan is one overview, whatever the AI said.
  const tiny = normalizePresentationPlan({ viewpoints: [{ nodeIds: ['one'], narrative: 'Hello', duration: 3000 }, { nodeIds: ['two'], narrative: 'Bye', duration: 3000 }] },
    { nodes: [note('one', 0, 0), note('two', 500, 0)] })
  assert.equal(tiny.viewpoints.length, 1)
  assert.equal(tiny.viewpoints[0].narrative, 'Hello')
})

test('the AI is given the groups the local plan found', () => {
  const hints = planHints(threeClusters())
  assert.equal(hints.length, 3)
  assert.deepEqual(sorted(hints[0]), sorted(['a-root', 'a-left', 'a-right']))
})

test('a deck is planned again unless it is a current AI plan or one a person changed', () => {
  assert.equal(needsPlan(null), true)
  assert.equal(needsPlan({ automatic: true, viewpoints: [{}] }), true)
  // a deck from the old one-note-per-step planner
  assert.equal(needsPlan({ viewpoints: [{}] }), true)
  assert.equal(needsPlan({ planVersion: PLAN_VERSION, viewpoints: [{}] }), false)
  assert.equal(needsPlan({ viewpoints: [{}], isPublished: true }), false)
  assert.equal(needsPlan({ viewpoints: [{}], viewpointsManuallyChanged: { updated: [{ nodeIds: ['a'] }], deleted: [] } }), false)
  assert.equal(needsPlan({ automatic: true, viewpoints: [{}], isPublished: true }), true)
})

// Restated 2026-11-22: the presenter speaks of Slatebox, not "the AI".
test('why Slatebox could not plan, in plain words', () => {
  assert.equal(planFailureReason({ abortMessage: 'Sorry, I ran into a problem. Bad gateway.' }), 'Bad gateway.')
  assert.equal(planFailureReason({ abortMessage: 'deepinfra is not configured for this AI request.' }), "Slatebox's planner is not set up on this server.")
  assert.equal(planFailureReason(new Error('The provider returned no viewpoints.')), 'Slatebox returned no plan.')
  assert.equal(planFailureReason({ reason: "You have used today's free AI." }), "You have used today's free AI.")
  assert.equal(planFailureReason(null), 'Slatebox did not answer.')
  for (const message of ['deepinfra is not configured for this AI request.', 'The provider returned no viewpoints.', null]) {
    assert.doesNotMatch(planFailureReason(message && { abortMessage: message }), /\bAI\b/)
  }
})

test('a rotated note is framed by the box it covers once rotated', () => {
  const box = rotatedBounds({ x: 0, y: 0, width: 100, height: 100 }, 45)
  assert.ok(Math.abs(box.width - 141.42) < 0.1 && Math.abs(box.height - 141.42) < 0.1)
  assert.ok(Math.abs(box.x + 20.71) < 0.1 && Math.abs(box.y + 20.71) < 0.1)
  assert.deepEqual(rotatedBounds({ x: 5, y: 6, width: 10, height: 20 }, 0), { x: 5, y: 6, width: 10, height: 20 })
  const layout = { nodes: [note('flat', 0, 0), { ...note('tilted', 300, 0), metrics: { rotation: 30, bbox: { x: 300, y: 0, width: 200, height: 40 } } }] }
  // A group: the union of the boxes the notes cover, the camera not turned.
  const group = viewpointFrame(['flat', 'tilted'], layout)
  const tilted = rotatedBounds({ x: 300, y: 0, width: 200, height: 40 }, 30)
  assert.equal(group.rotation, 0)
  assert.ok(Math.abs(group.width - (tilted.x + tilted.width - 0)) < 0.01)
  assert.ok(Math.abs(group.height - (Math.max(60, tilted.y + tilted.height) - Math.min(0, tilted.y))) < 0.01)
  // One rotated note alone: the camera turns to straighten it, and frames its own size.
  const alone = viewpointFrame(['tilted'], layout)
  assert.deepEqual([alone.rotation, alone.width, alone.height, alone.centerX, alone.centerY], [-30, 200, 40, 400, 20])
  assert.equal(viewpointFrame(['missing'], layout), null)
  // The camera's metrics are the frame.
  assert.deepEqual(calculateViewpointMetrics(['flat', 'tilted'], layout), group)
})

// Where a point of the slate lands on screen under the fitted camera.
const onScreen = (fit, frame, x, y) => ({ x: (x - frame.centerX) * fit.scale + fit.x, y: (y - frame.centerY) * fit.scale + fit.y })

test('the camera fits a viewpoint inside the room the narrative and controls leave, with a margin', () => {
  const frame = viewpointFrame(['a-root', 'a-left', 'a-right'], threeClusters())
  for (const screen of [
    { width: 1440, height: 900, top: 90, bottom: 64 },
    { width: 390, height: 844, top: 120, bottom: 170 },
    { width: 390, height: 844, top: 0, bottom: 0 },
  ]) {
    const fit = fitFrame(frame, screen)
    const margin = Math.max(16, Math.min(screen.width, screen.height) * 0.04)
    const topLeft = onScreen(fit, frame, frame.centerX - frame.width / 2, frame.centerY - frame.height / 2)
    const bottomRight = onScreen(fit, frame, frame.centerX + frame.width / 2, frame.centerY + frame.height / 2)
    assert.ok(topLeft.x >= margin - 0.01 && bottomRight.x <= screen.width - margin + 0.01, JSON.stringify({ screen, topLeft, bottomRight }))
    assert.ok(topLeft.y >= screen.top + margin - 0.01 && bottomRight.y <= screen.height - screen.bottom - margin + 0.01, JSON.stringify({ screen, topLeft, bottomRight }))
  }
  // A single small note is not blown up past a sensible zoom.
  assert.ok(fitFrame(viewpointFrame(['c-one'], threeClusters()), { width: 1440, height: 900 }).scale <= 3)
})
