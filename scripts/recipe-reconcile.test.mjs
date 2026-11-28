// Writing to slates without losing people's edits (enterprise/server/recipes/reconcile.mjs and
// ownership.mjs): the catalog's R1–R6, each a test, against the real engine's applier.
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPlanToJSON } from 'slateboxjs/operations'
import { noteId, connectorId, reconcileSlate, reconcileBoard, matchNewItems, layoutGraph, NOTE_ID_PATTERN } from '../enterprise/server/recipes/reconcile.mjs'
import { touchedSince, flipTouched } from '../enterprise/server/recipes/ownership.mjs'

const apply = (slate, plans) => plans.reduce((s, plan) => applyPlanToJSON(s, plan, { requireMatches: false }).slate, slate)
const node = (slate, id) => slate.nodes.find((n) => n.options.id === id)
const graph = (nodes, edges = []) => ({ role: 'map', key: '', name: 'Service map', graph: { nodes, edges, layout: 'layered' } })
const own = (rows) => new Map(rows.map((r) => [r.noteId, r]))
const run = (desired, current, owned = new Map(), extra = {}) => reconcileSlate({ desired, current, owned, prefix: 'ga', instanceId: 'i1', slateId: 's1', ...extra })

test('R1: ids come from keys, and fit the note id pattern', () => {
  const id = noteId('ga', 'service:api')
  assert.match(id, /^ga_[a-z2-7]{12}$/)
  assert.match(id, NOTE_ID_PATTERN)
  assert.equal(noteId('ga', 'service:api'), id)
  assert.notEqual(noteId('ga', 'service:web'), id)
  assert.equal(connectorId('a', 'b'), 'a->b')
})

test('a first build adds notes and lines; a second identical run changes nothing', () => {
  const desired = graph([{ key: 'api', text: 'api' }, { key: 'db', text: 'db' }, { key: 'web', text: 'web' }], [{ from: 'web', to: 'api' }, { from: 'api', to: 'db', label: 'reads' }])
  const first = run(desired, { nodes: [] })
  assert.equal(first.stats.added, 3)
  const slate = apply({ nodes: [] }, first.plans)
  assert.equal(slate.nodes.length, 3)
  const api = node(slate, noteId('ga', 'node:api'))
  assert.equal(api.relationships.associations[0].childId, noteId('ga', 'node:db'))
  const second = run(desired, slate, own(first.ownedUpdates))
  assert.equal(second.plans.length, 0)
  assert.equal(second.stats.unchanged, 3)
})

test('R2: notes a person moved stay where they put them; new notes go near the recipe\'s, clear of all notes', () => {
  const d1 = graph([{ key: 'api', text: 'api' }, { key: 'db', text: 'db' }], [{ from: 'api', to: 'db' }])
  const first = run(d1, { nodes: [] })
  let slate = apply({ nodes: [] }, first.plans)
  const apiId = noteId('ga', 'node:api')
  // a person drags the whole map 2000 px right
  slate = apply(slate, [{ message: 'move', operations: slate.nodes.map((n) => ({ kind: 'update_nodes', target: { ids: [n.options.id] }, changes: { x: n.options.xPos + 2000 } })) }])
  const moved = node(slate, apiId).options.xPos
  const d2 = graph([{ key: 'api', text: 'api' }, { key: 'db', text: 'db' }, { key: 'cache', text: 'cache' }], [{ from: 'api', to: 'db' }, { from: 'api', to: 'cache' }])
  const second = run(d2, slate, own(first.ownedUpdates))
  assert.ok(second.plans[0].operations.every((op) => op.kind !== 'update_nodes' || !('x' in op.changes)), 'never moves a placed note')
  slate = apply(slate, second.plans)
  assert.equal(node(slate, apiId).options.xPos, moved)
  const cache = node(slate, noteId('ga', 'node:cache')).options
  assert.ok(cache.xPos > 1500, 'the new note follows the moved map')
  for (const other of slate.nodes.filter((n) => n.options.id !== cache.id)) {
    const o = other.options
    const apart = cache.xPos >= o.xPos + o.width || o.xPos >= cache.xPos + cache.width || cache.yPos >= o.yPos + o.height || o.yPos >= cache.yPos + cache.height
    assert.ok(apart, 'clear of every note')
  }
})

test('R3: a note a person retexted is theirs: never changed or deleted again', () => {
  const d1 = graph([{ key: 'api', text: 'api' }, { key: 'db', text: 'db' }])
  const first = run(d1, { nodes: [] })
  let slate = apply({ nodes: [] }, first.plans)
  const apiId = noteId('ga', 'node:api')
  slate = apply(slate, [{ message: 'person', operations: [{ kind: 'update_nodes', target: { ids: [apiId] }, changes: { text: 'API (owned by payments)' } }] }])
  const touched = touchedSince([{ slateId: 's1', revision: 2, actor: { kind: 'person', userId: 'ana' }, properties: [[apiId, 'text']] }], 's1', 1, 'recipe:i1')
  const owned = own(first.ownedUpdates)
  // the source renames it and later drops it: the person's note is left, with one comment
  const d2 = graph([{ key: 'api', text: 'api-gateway' }, { key: 'db', text: 'db' }])
  const second = run(d2, slate, owned, { touched })
  assert.equal(second.plans.length, 0)
  assert.equal(second.stats.keptByPerson, 1)
  assert.equal(owned.get(apiId).owner, 'person')
  const third = run(graph([{ key: 'db', text: 'db' }]), slate, owned, { source: 'acme/api @ abc1234' })
  assert.equal(third.plans.length, 0)
  assert.deepEqual(third.comments, [{ noteId: apiId, text: 'Removed from acme/api @ abc1234.' }])
})

test('moves and resizes never change whose a note is', () => {
  const touched = touchedSince([{ slateId: 's1', revision: 5, actor: { kind: 'person' }, properties: [['n1', 'x'], ['n1', 'y'], ['n1', 'width']] }], 's1', 4, 'recipe:i1')
  const owned = own([{ noteId: 'n1', key: 'node:a', owner: 'recipe', kind: 'note' }])
  const { changed } = flipTouched(owned, touched, new Set(['n1']))
  assert.equal(changed.length, 0)
  assert.equal(owned.get('n1').owner, 'recipe')
})

test('the recipe\'s own saves are not a person\'s edits', () => {
  const touched = touchedSince([{ slateId: 's1', revision: 5, actor: { kind: 'agent', tokenId: 'recipe:i1' }, properties: [['n1', 'text']] }], 's1', 4, 'recipe:i1')
  assert.equal(touched.size, 0)
})

test('a note a person deleted is not made again', () => {
  const d = graph([{ key: 'api', text: 'api' }, { key: 'db', text: 'db' }])
  const first = run(d, { nodes: [] })
  let slate = apply({ nodes: [] }, first.plans)
  const dbId = noteId('ga', 'node:db')
  slate = apply(slate, [{ message: 'person', operations: [{ kind: 'delete_nodes', target: { ids: [dbId] } }] }])
  const owned = own(first.ownedUpdates)
  const second = run(d, slate, owned)
  assert.equal(second.plans.length, 0)
  assert.equal(owned.get(dbId).owner, 'person')
})

test('R4: a locked note is pinned', () => {
  const d1 = graph([{ key: 'api', text: 'api' }])
  const first = run(d1, { nodes: [] })
  let slate = apply({ nodes: [] }, first.plans)
  const apiId = noteId('ga', 'node:api')
  slate = apply(slate, [{ message: 'lock', operations: [{ kind: 'update_nodes', target: { ids: [apiId] }, changes: { locked: true } }] }])
  const second = run(graph([{ key: 'api', text: 'api v2' }]), slate, own(first.ownedUpdates))
  assert.equal(second.plans.length, 0)
  assert.equal(second.stats.keptByPerson, 1)
  const third = run(graph([]), slate, own(first.ownedUpdates))
  assert.equal(third.plans.length, 0, 'not deleted either')
})

test('R5: what the source dropped goes when it is the recipe\'s; lines go with it', () => {
  const d1 = graph([{ key: 'api', text: 'api' }, { key: 'db', text: 'db' }, { key: 'old', text: 'old' }], [{ from: 'api', to: 'db' }, { from: 'api', to: 'old' }])
  const first = run(d1, { nodes: [] })
  const slate = apply({ nodes: [] }, first.plans)
  const owned = own(first.ownedUpdates)
  const second = run(graph([{ key: 'api', text: 'api' }, { key: 'db', text: 'db' }], [{ from: 'api', to: 'db' }]), slate, owned)
  const after = apply(slate, second.plans)
  assert.equal(after.nodes.length, 2)
  assert.equal(node(after, noteId('ga', 'node:api')).relationships.associations.length, 1)
  assert.ok(second.ownedRemovals.includes(noteId('ga', 'node:old')))
})

test('incremental runs remove only what gone names', () => {
  const d1 = graph([{ key: 'a', text: 'a' }, { key: 'b', text: 'b' }, { key: 'c', text: 'c' }])
  const first = run(d1, { nodes: [] })
  const slate = apply({ nodes: [] }, first.plans)
  const second = run(graph([{ key: 'a', text: 'a!' }]), slate, own(first.ownedUpdates), { gone: ['b'] })
  const after = apply(slate, second.plans)
  assert.deepEqual(after.nodes.map((n) => n.options.text).sort(), ['a!', 'c'])
})

test('R6: notes people added are invisible; selectors are always ids', () => {
  const d = graph([{ key: 'api', text: 'api' }])
  let slate = apply({ nodes: [] }, [{ message: 'person', operations: [{ kind: 'add_nodes', count: 1, ids: ['mine'], shape: 'rectangle', text: 'api', x: 0, y: 0, width: 150, height: 70 }] }])
  const first = run(d, slate)
  slate = apply(slate, first.plans)
  const second = run(graph([]), slate, own(first.ownedUpdates))
  for (const plan of [...first.plans, ...second.plans]) for (const op of plan.operations) {
    for (const sel of [op.target, op.from, op.to].filter(Boolean)) {
      assert.ok(Array.isArray(sel.ids) && !sel.text, 'ids only')
      assert.ok(!sel.ids.includes('mine'))
    }
  }
  assert.equal(apply(slate, second.plans).nodes.map((n) => n.options.id).join(), 'mine')
})

test('frames are drawn around their members; legend notes sit above', () => {
  const desired = { role: 'map', key: '', name: 'Map', graph: { nodes: [{ key: 'a', text: 'a' }, { key: 'b', text: 'b' }], edges: [], frames: [{ key: 'core', text: 'Core', members: ['a', 'b'] }], layout: 'layered' }, notes: [{ key: 'legend', text: 'Synced from acme/api @ abc1234' }] }
  const first = run(desired, { nodes: [] })
  const slate = apply({ nodes: [] }, first.plans)
  const frame = node(slate, noteId('ga', 'frame:core')).options
  for (const key of ['a', 'b']) {
    const n = node(slate, noteId('ga', `node:${key}`)).options
    assert.ok(n.xPos >= frame.xPos && n.yPos >= frame.yPos && n.xPos + n.width <= frame.xPos + frame.width && n.yPos + n.height <= frame.yPos + frame.height)
  }
  const legend = node(slate, noteId('ga', 'note:legend')).options
  assert.ok(legend.yPos < frame.yPos)
})

test('a waiting suggestion is not proposed twice; a discarded one is proposed again', () => {
  const d = graph([{ key: 'a', text: 'a' }])
  const first = run(d, { nodes: [] })
  const id = noteId('ga', 'node:a')
  const owned = own(first.ownedUpdates.map((r) => ({ ...r, pending: true })))
  const waiting = run(d, { nodes: [] }, owned, { waiting: new Set([id]) })
  assert.equal(waiting.plans.length, 0)
  const discarded = run(d, { nodes: [] }, owned)
  assert.equal(discarded.stats.added, 1)
})

test('plans hold at most 50 operations', () => {
  const nodes = Array.from({ length: 130 }, (_, k) => ({ key: `n${k}`, text: `n${k}` }))
  const result = run(graph(nodes), { nodes: [] })
  assert.equal(result.plans.length, 3)
  assert.ok(result.plans.every((p) => p.operations.length <= 50))
})

test('layouts are deterministic and layered by dependency', () => {
  const g = { nodes: [{ key: 'a', text: 'a' }, { key: 'b', text: 'b' }, { key: 'c', text: 'c' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], layout: 'layered' }
  const one = layoutGraph(g)
  assert.deepEqual([...layoutGraph(g)], [...one])
  assert.ok(one.get('a').y < one.get('b').y && one.get('b').y < one.get('c').y)
})

test('boards: cards added, renamed, moved and removed; a card a person moved is theirs', () => {
  const desired = { key: 'changes', component: 'team-board', title: 'What changed', lanes: [{ key: 'new', label: 'New' }, { key: 'done', label: 'Done' }], cards: [{ key: 'pr1', label: 'PR 1', lane: 'new' }, { key: 'pr2', label: 'PR 2', lane: 'new' }] }
  const first = reconcileBoard({ desired, current: { lanes: [], cards: [] }, instanceId: 'i1', slateId: 's1' })
  assert.deepEqual(first.edits.map((e) => e.kind), ['add_lane', 'add_lane', 'add_card', 'add_card'])
  const after = { lanes: [{ id: 'l1', label: 'New' }, { id: 'l2', label: 'Done' }], cards: [{ id: 'c1', label: 'PR 1', laneId: 'l1' }, { id: 'c2', label: 'PR 2', laneId: 'l1' }] }
  const made = matchNewItems(first.edits, { lanes: [], cards: [] }, after)
  assert.deepEqual(made.map((m) => m.key), ['lane:new', 'lane:done', 'card:pr1', 'card:pr2'])
  const rows = made.map((m) => ({ noteId: m.id, key: m.key, kind: m.kind, owner: 'recipe', hash: 'x' }))
  const owned = own(rows)
  const touched = new Map([['c2', new Set(['lane'])]])
  const next = reconcileBoard({ desired: { ...desired, cards: [{ key: 'pr1', label: 'PR 1 (merged)', lane: 'done' }, { key: 'pr2', label: 'PR 2', lane: 'done' }] }, current: after, owned, touched, instanceId: 'i1', slateId: 's1' })
  assert.deepEqual(next.edits, [{ kind: 'rename_card', card: 'c1', label: 'PR 1 (merged)' }, { kind: 'move_card', card: 'c1', lane: 'l2' }])
  assert.equal(next.stats.keptByPerson, 1)
  const gone = reconcileBoard({ desired: { ...desired, cards: [] }, current: after, owned, instanceId: 'i1', slateId: 's1' })
  assert.deepEqual(gone.edits, [{ kind: 'remove_card', card: 'c1' }])
})
