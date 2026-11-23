import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import buildFallbackPresentation, { reconcileViewpoints } from '../imports/ui/components/presentations/buildFallbackPresentation.mjs'
import { workshopScenes } from '../imports/ui/components/presentations/workshopScenes.mjs'
import {
  exportPresentationSvg,
  extractPresentationLayout,
  findPresentationBackground,
  findPresentationDimmableElements,
  findPresentationViewpointElements,
  presentationNodeParts,
  resolvePresentationFrameNodeIds,
  resolvePresentationViewport,
  withPresentationTimeout,
} from '../imports/ui/components/presentations/presentationRuntime.mjs'

const fallback = buildFallbackPresentation(
  {
    nodes: [
      {
        nodeId: 'later',
        description: 'Later',
        metrics: { bbox: { x: 20, y: 200, width: 100, height: 50 } },
        childrenNodes: [],
      },
      {
        nodeId: 'first',
        description: 'First idea',
        metrics: {
          rotation: 15,
          bbox: { x: 40, y: 10, width: 100, height: 50 },
        },
        childrenNodes: [
          {
            nodeId: 'child',
            description: '',
            metrics: { bbox: { x: 200, y: 12, width: 100, height: 50 } },
          },
        ],
      },
    ],
  },
  'Demo'
)

assert.equal(fallback.name, 'Demo — automatic')
// Restated 2026-11-21: this pinned one viewpoint per note in canvas order ("first", "child",
// "later"), the step-by-step tour the owner reported as "no analysis". The local plan now opens
// and closes on the whole slate and frames each group of related notes together: "first" with
// the note it connects to, then "later" on its own.
const sortedIds = (viewpoint) => [...viewpoint.nodeIds].sort()
assert.deepEqual(fallback.viewpoints.map(sortedIds), [
  ['child', 'first', 'later'], ['child', 'first'], ['later'], ['child', 'first', 'later'],
])
assert.equal(fallback.viewpoints[1].narrative, 'First idea — with 1 related note')
assert.equal(fallback.viewpoints[2].narrative, 'Later')
assert.ok(fallback.viewpoints.every((viewpoint) => viewpoint.duration >= 2000))

const v3Engine = {
  svg: () => '<svg data-runtime="v3" />',
  getOrientation: () => ({ width: 640, height: 360, left: 0, top: 0 }),
  presentation: {
    extractPresentationLayout: () => ({ nodes: [{ nodeId: 'v3' }] }),
  },
}
const v3Facade = { v2: v3Engine }
assert.deepEqual(await exportPresentationSvg(v3Facade, {}), {
  svg: '<svg data-runtime="v3" />',
  orient: { width: 640, height: 360, left: 0, top: 0 },
})
assert.deepEqual(extractPresentationLayout(v3Facade), {
  nodes: [{ nodeId: 'v3' }],
})

const legacySlate = {
  svg: (_options, callback) =>
    callback({
      svg: '<svg data-runtime="v1" />',
      orient: { width: 800, height: 450 },
    }),
  extractPresentationLayout: () => ({ nodes: [{ nodeId: 'v1' }] }),
}
assert.deepEqual(await exportPresentationSvg(legacySlate, {}), {
  svg: '<svg data-runtime="v1" />',
  orient: { width: 800, height: 450 },
})
assert.deepEqual(extractPresentationLayout(legacySlate), {
  nodes: [{ nodeId: 'v1' }],
})

assert.equal(
  await withPresentationTimeout(Promise.resolve('planned'), 50),
  'planned'
)
await assert.rejects(
  withPresentationTimeout(new Promise(() => {}), 5),
  /planning timed out/i
)

const nestedNodeRect = {
  tagName: 'rect',
  getAttribute: (name) => (name === 'rel' ? 'node-1' : null),
}
const exportBackground = {
  tagName: 'rect',
  getAttribute: () => null,
}
assert.equal(
  findPresentationBackground({ children: [nestedNodeRect, exportBackground] }),
  exportBackground
)
assert.equal(findPresentationBackground({ children: [nestedNodeRect] }), null)

const v3NodePath = { getAttribute: () => null }
const v3NodeText = { getAttribute: () => null }
const v3NodeGroup = {
  getAttribute: (name) => (name === 'data-node-id' ? 'node-1' : null),
  querySelectorAll: () => [v3NodePath, v3NodeText],
}
const legacyNodeText = {
  getAttribute: (name) => (name === 'rel' ? 'text-node-1' : null),
}
const legacyRelationship = {
  getAttribute: (name) => (name === 'rel' ? 'association-node-1-node-2' : null),
}
const unrelatedNode = {
  getAttribute: (name) => (name === 'data-node-id' ? 'node-2' : null),
  querySelectorAll: () => [],
}
const viewpointSvg = {
  querySelectorAll: () => [
    v3NodeGroup,
    v3NodePath,
    v3NodeText,
    legacyNodeText,
    legacyRelationship,
    unrelatedNode,
  ],
}
assert.deepEqual(findPresentationViewpointElements(viewpointSvg, 'node-1'), [
  v3NodeGroup,
  v3NodePath,
  v3NodeText,
  legacyNodeText,
  legacyRelationship,
])
assert.deepEqual(findPresentationViewpointElements(viewpointSvg, 'missing'), [])

let markerPath
const relationshipMarker = {
  getAttribute: (name) => (name === 'id' ? 'edge-arrow' : null),
  querySelectorAll: () => [markerPath],
}
markerPath = {
  getAttribute: () => null,
  closest: (selector) => (selector === 'marker' ? relationshipMarker : null),
}
const v3Relationship = {
  getAttribute: (name) =>
    ({
      'data-source-node-id': 'node-1',
      'data-target-node-id': 'node-2',
      'marker-end': 'url(#edge-arrow)',
      connectortype: 'default',
    })[name] || null,
  querySelectorAll: () => [],
  closest: () => null,
}
const v3RelationshipSvg = {
  querySelectorAll: (selector) =>
    selector === '[id]'
      ? [relationshipMarker]
      : [v3Relationship, relationshipMarker, markerPath],
}
assert.deepEqual(
  findPresentationViewpointElements(v3RelationshipSvg, 'node-1'),
  [v3Relationship, relationshipMarker, markerPath]
)

const structuralGroup = {
  getAttribute: () => null,
  closest: () => null,
}
const nodeChildPath = {
  getAttribute: () => null,
  closest: (selector) => (selector === '[data-node-id]' ? v3NodeGroup : null),
}
const dimmableNodeGroup = {
  getAttribute: (name) => (name === 'data-node-id' ? 'node-1' : null),
  closest: () => null,
}
const dimmableSvg = {
  querySelectorAll: () => [
    structuralGroup,
    dimmableNodeGroup,
    nodeChildPath,
    v3Relationship,
    markerPath,
  ],
}
assert.deepEqual(findPresentationDimmableElements(dimmableSvg), [
  dimmableNodeGroup,
  v3Relationship,
])

const unownedV3Relationship = {
  getAttribute: (name) => (name === 'connectortype' ? 'default' : null),
  closest: () => null,
}
assert.deepEqual(
  findPresentationDimmableElements({
    querySelectorAll: () => [unownedV3Relationship],
  }),
  []
)

const connectionTree = {
  nodes: [
    {
      nodeId: 'welcome',
      childrenNodes: [
        {
          nodeId: 'star',
          childrenNodes: [{ nodeId: 'detail', childrenNodes: [] }],
        },
        { nodeId: 'unrelated', childrenNodes: [] },
      ],
    },
  ],
}
assert.deepEqual(
  resolvePresentationFrameNodeIds(connectionTree, ['star'], ['welcome']),
  ['star', 'welcome']
)
assert.deepEqual(
  resolvePresentationFrameNodeIds(connectionTree, ['star'], ['detail']),
  ['star', 'detail']
)
assert.deepEqual(
  resolvePresentationFrameNodeIds(connectionTree, ['star'], ['unrelated']),
  ['star']
)
assert.deepEqual(
  resolvePresentationFrameNodeIds(connectionTree, ['star'], ['missing']),
  ['star']
)

assert.deepEqual(
  resolvePresentationViewport('9960 9960 203.524 148.718', {
    width: 143.524,
    height: 88.718,
  }),
  {
    x: 9990,
    y: 9990,
    width: 143.524,
    height: 88.718,
  }
)
assert.deepEqual(
  resolvePresentationViewport('-1040 -540 2080 1080', {
    width: 2020,
    height: 1020,
  }),
  { x: -1010, y: -510, width: 2020, height: 1020 }
)
assert.deepEqual(
  resolvePresentationViewport(null, { width: 640, height: 360 }),
  { x: 0, y: 0, width: 640, height: 360 }
)

// Restated 2026-11-21: these checks pinned the old dialogue's MUI Container (maxWidth={false},
// disableGutters), which made the player span the screen. The presenter's frame is now a
// full-screen dialog whose player area has no width cap or gutters; that is what is checked.
const frameSource = readFileSync(
  new URL('../imports/ui/components/presentations/PresenterFrame.jsx', import.meta.url),
  'utf8'
)
assert.match(frameSource, /<Dialog fullScreen/)
assert.doesNotMatch(frameSource, /maxWidth|<Container/)
const dialogueSource = readFileSync(
  new URL('../imports/ui/components/PresentSlateDialogue.jsx', import.meta.url),
  'utf8'
)
assert.match(dialogueSource, /<PresenterFrame/)

const basePresentSource = readFileSync(
  new URL(
    '../imports/ui/components/presentations/BasePresent.jsx',
    import.meta.url
  ),
  'utf8'
)
// Restated 2026-11-21: this pinned the old narrative bar's full-width layout (left: 0, right: 0)
// at the top or bottom. The narrative now always sits over the top of the presenter, as wide as
// the screen allows on a phone and capped on a wide screen.
assert.match(basePresentSource, /width: 'min\(900px, calc\(100% - 24px\)\)'/)
assert.match(basePresentSource, /resolvePresentationFrameNodeIds/)

// A slate with a workshop: its lanes open the presentation in their authored order, each with its
// cards, then the slate's other notes follow in canvas order.
const workshop = {
  version: 1, title: 'Listening walk',
  lanes: [{ id: 'quay', label: 'At the quay' }, { id: 'bridge', label: 'Under the bridge' }, { id: 'market', label: 'Market square' }],
  cards: [{ id: 'bell', label: 'Bicycle bell', laneId: 'market' }, { id: 'ferry', label: 'Ferry horn', laneId: 'quay' }],
  presentationOrder: ['market', 'quay', 'bridge'],
}
const scenes = workshopScenes(workshop)
assert.deepEqual(scenes, [
  { nodeIds: ['lane-market', 'card-bell'], label: 'Market square', narrative: 'Market square' },
  { nodeIds: ['lane-quay', 'card-ferry'], label: 'At the quay', narrative: 'At the quay' },
  { nodeIds: ['lane-bridge'], label: 'Under the bridge', narrative: 'Under the bridge' },
])
const map = {
  version: 1, title: 'Route',
  lanes: [
    { id: 'start', label: 'Start', station: { column: 0, row: 0, next: ['end'], outcome: 'Start' } },
    { id: 'end', label: 'Arrive', station: { column: 1, row: 0, next: [], outcome: 'The parcel is delivered.' } },
  ],
  cards: [{ id: 'parcel', label: 'Parcel', laneId: 'start' }],
}
assert.deepEqual(workshopScenes(map).map((scene) => scene.narrative), ['Start', 'Arrive — The parcel is delivered.'])
assert.deepEqual(workshopScenes(null), [])
assert.deepEqual(workshopScenes({ version: 1, lanes: [] }), [])

const at = (nodeId, x, y, description = '') => ({ nodeId, description, metrics: { bbox: { x, y, width: 100, height: 50 } }, childrenNodes: [] })
const workshopLayout = {
  nodes: [
    at('note-low', 10, 600, 'Low note'), at('note-high', 10, 0, 'High note'),
    at('lane-quay', 400, 100), at('lane-bridge', 600, 100), at('lane-market', 800, 100),
    at('card-ferry', 400, 200), at('card-bell', 800, 200),
  ],
}
const withWorkshop = buildFallbackPresentation(workshopLayout, 'Walk', { scenes })
// Restated 2026-11-21: the lanes and the other notes' groups now sit between an opening and a
// closing overview of the whole slate.
const everyNote = workshopLayout.nodes.map((node) => node.nodeId).sort()
assert.deepEqual(withWorkshop.viewpoints.map((viewpoint) => viewpoint.nodeIds), [
  withWorkshop.viewpoints[0].nodeIds,
  ['lane-market', 'card-bell'], ['lane-quay', 'card-ferry'], ['lane-bridge'], ['note-high'], ['note-low'],
  withWorkshop.viewpoints.at(-1).nodeIds,
])
assert.deepEqual([...withWorkshop.viewpoints[0].nodeIds].sort(), everyNote)
assert.deepEqual([...withWorkshop.viewpoints.at(-1).nodeIds].sort(), everyNote)
assert.deepEqual(withWorkshop.viewpoints.map((viewpoint) => viewpoint.narrative).slice(1, 5),
  ['Market square', 'At the quay', 'Under the bridge', 'High note'])
// A lane that is not drawn (yet) is not presented; nor is a card that is not drawn.
const partly = buildFallbackPresentation({ nodes: [at('lane-quay', 0, 0), at('other', 0, 100)] }, 'Walk', { scenes })
assert.deepEqual(partly.viewpoints.map((viewpoint) => viewpoint.nodeIds), [['lane-quay', 'other']])

// A saved deck plays over the slate as it is now: the bell has moved to the quay since it was saved,
// a note it framed has been deleted, and the bridge lane is not in it.
const moved = { ...workshop, cards: [{ id: 'bell', label: 'Bicycle bell', laneId: 'quay' }, { id: 'ferry', label: 'Ferry horn', laneId: 'quay' }] }
const saved = [
  { nodeIds: ['lane-market', 'card-bell'], narrative: 'The market', duration: 4000 },
  { nodeIds: ['lane-quay', 'card-ferry', 'note-high'], narrative: 'The quay', duration: 3000 },
  { nodeIds: ['gone'], narrative: 'Deleted', duration: 3000 },
  { nodeIds: ['note-low', 'gone'], narrative: 'Low', duration: 3000 },
]
assert.deepEqual(reconcileViewpoints(saved, workshopLayout, workshopScenes(moved)), [
  { nodeIds: ['lane-market'], narrative: 'The market', duration: 4000 },
  { nodeIds: ['note-high', 'lane-quay', 'card-bell', 'card-ferry'], narrative: 'The quay', duration: 3000 },
  { nodeIds: ['lane-bridge'], narrative: 'Under the bridge', duration: 3000 },
  { nodeIds: ['note-low'], narrative: 'Low', duration: 3000 },
])
// The authored lane order wins over a saved deck's: the lanes take the deck's lane places in
// that order, a lane the deck does not know follows them, and the other viewpoints stay put.
const reordered = reconcileViewpoints([
  { nodeIds: ['note-high'], narrative: 'Intro', duration: 1 },
  { nodeIds: ['lane-quay'], narrative: 'Quay', duration: 1 },
  { nodeIds: ['note-low'], narrative: 'Between', duration: 1 },
  { nodeIds: ['lane-market'], narrative: 'Market', duration: 1 },
], workshopLayout, scenes)
assert.deepEqual(reordered.map((viewpoint) => [viewpoint.narrative, viewpoint.nodeIds]), [
  ['Intro', ['note-high']], ['Market', ['lane-market', 'card-bell']], ['Between', ['note-low']],
  ['Quay', ['lane-quay', 'card-ferry']], ['Under the bridge', ['lane-bridge']],
])
// A deck saved before the slate had a workshop: the lanes open it.
assert.deepEqual(reconcileViewpoints([{ nodeIds: ['note-low'], narrative: 'Low', duration: 1 }], workshopLayout, scenes)
  .map((viewpoint) => viewpoint.nodeIds[0]), ['lane-market', 'lane-quay', 'lane-bridge', 'note-low'])
// A follower keeps the presenter's step numbers: nothing is dropped or moved.
assert.equal(reconcileViewpoints(saved, workshopLayout, workshopScenes(moved), { keep: true }).length, saved.length)

// Framing a lane keeps its column, caption and picture lit with it; other notes keep their own parts.
assert.deepEqual(presentationNodeParts('lane-quay'), ['lane-quay', 'column-quay', 'caption-quay', 'image-quay'])
assert.deepEqual(presentationNodeParts('card-bell'), ['card-bell'])
const laneGroup = (id) => ({ getAttribute: (name) => (name === 'data-node-id' ? id : null), querySelectorAll: () => [] })
const laneSvg = { querySelectorAll: () => ['lane-quay', 'column-quay', 'caption-quay', 'column-bridge', 'card-ferry'].map(laneGroup) }
assert.deepEqual(findPresentationViewpointElements(laneSvg, 'lane-quay').map((element) => element.getAttribute('data-node-id')),
  ['lane-quay', 'column-quay', 'caption-quay'])

console.log('presentation fallback checks passed')
