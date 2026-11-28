// X1, render from a webhook (enterprise/recipes/webhook-render), against the catalog's acceptance
// criteria (the parts that are the recipe's; the signed hook, replay and rate limit are the
// runtime's inbound route): posting the same graph twice asks for the same slate (zero operations);
// removing one node and adding one changes exactly those two; a wrong payload is a 400 with a JSON
// pointer; past 1,000 notes, 5,000 connectors or 256 KB a 413. Plus Mermaid, boards, prose (only
// when turned on, one model call), append mode and a person's own slate as the target.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-webhook-render.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import X1 from '../enterprise/recipes/webhook-render/index.mjs'
import { fakeAi, recipeContext } from './fakes/recipe-lite-context.mjs'

const graph = (keys, edges = []) => ({ graph: { nodes: keys.map((key) => ({ key, label: key.toUpperCase(), group: key === 'db' ? 'Data' : 'Services' })), edges: edges.map(([from, to]) => ({ from, to })) } })
async function post(data, config = {}, ai = null) {
  const instance = { _id: 'x1', name: 'CI graph', config, projectId: 'proj1' }
  const world = recipeContext({ instance, ai, trigger: { kind: 'inbound', input: data } })
  return { result: await X1.run(world.ctx), ...world }
}

test('the same graph twice: the same slate; one node removed and one added: exactly those two change, nothing moves', async () => {
  const a = await post({ key: 'deps', title: 'Service dependencies', ...graph(['web', 'api', 'db'], [['web', 'api'], ['api', 'db']]) })
  const b = await post({ key: 'deps', title: 'Service dependencies', ...graph(['web', 'api', 'db'], [['web', 'api'], ['api', 'db']]) })
  assert.deepEqual(b.result.desired, a.result.desired)
  const [slate] = a.result.desired.slates
  assert.equal(slate.role, 'render')
  assert.equal(slate.key, 'deps')
  assert.equal(slate.name, 'Service dependencies')
  assert.deepEqual(slate.graph.frames.map((f) => [f.text, f.members]), [['Services', ['web', 'api']], ['Data', ['db']]])
  const c = await post({ key: 'deps', title: 'Service dependencies', ...graph(['web', 'api', 'cache'], [['web', 'api'], ['api', 'cache']]) })
  const before = new Set(slate.graph.nodes.map((n) => n.key))
  const after = new Set(c.result.desired.slates[0].graph.nodes.map((n) => n.key))
  assert.deepEqual([...before].filter((k) => !after.has(k)), ['db'])
  assert.deepEqual([...after].filter((k) => !before.has(k)), ['cache'])
  assert.ok(c.result.desired.slates[0].graph.nodes.every((n) => !('x' in n) && !('y' in n)), 'no positions: layout runs for new notes only')
  assert.deepEqual(a.events, [{ event: 'webhook.rendered', data: { key: 'deps', format: 'graph', size: 3 } }])
})

test('a run with a wrong payload fails with the same 400 and pointer the hook gives', async () => {
  const e = await post({ graph: { nodes: [{ key: 'a' }], edges: [{ from: 'a', to: 'zz' }] } }).then(() => null, (error) => error)
  assert.deepEqual([e.status, e.code, e.pointer, e.message], [400, 'bad_payload', '/graph/edges/0/to', '/graph/edges/0/to names no node "zz"'])
})

test('a wrong payload: 400 bad_payload with a JSON pointer; too big: 413 (checkInput, which the inbound hook calls before queueing)', () => {
  const check = (data, config) => {
    try {
      X1.checkInput(data, config)
      return null
    } catch (e) {
      return [e.status, e.code, e.pointer]
    }
  }
  assert.deepEqual(check({ graph: { nodes: [{ key: 'a' }, { key: 'b', label: 7 }] } }), [400, 'bad_payload', '/graph/nodes/1/label'])
  assert.deepEqual(check({ graph: { nodes: [{ key: 'a' }, { key: 'a' }] } }), [400, 'bad_payload', '/graph/nodes/1/key'])
  assert.deepEqual(check({ graph: { nodes: [{ key: 'a' }], edges: [{ from: 'a', to: 'zz' }] } }), [400, 'bad_payload', '/graph/edges/0/to'])
  assert.deepEqual(check({ graph: { nodes: [{ key: 'a', link: 'http://plain.example.com' }] } }), [400, 'bad_payload', '/graph/nodes/0/link'])
  assert.deepEqual(check({ graph: { nodes: [] }, extra: true }), [400, 'bad_payload', '/extra'])
  assert.deepEqual(check({ format: 'mermaid' }), [400, 'bad_payload', '/mermaid'])
  assert.deepEqual(check({ text: 'a web app talks to a database' }), [400, 'bad_payload', '/text'])
  assert.deepEqual(check({ text: 'a web app talks to a database' }, { text: true }), null)
  assert.deepEqual(check({ graph: { nodes: [{ key: 'a' }] }, callbackUrl: 'http://x.example.com' }), [400, 'bad_payload', '/callbackUrl'])
  assert.deepEqual(check({ board: { component: 'team-board', lanes: [{ key: 'todo', label: 'To do' }], cards: [{ key: 'c1', label: 'A', lane: 'done' }] } }), [400, 'bad_payload', '/board/cards/0/lane'])
  assert.deepEqual(check({ board: { component: 'not-a-component', lanes: [{ key: 'todo', label: 'To do' }], cards: [] } }), [400, 'bad_payload', '/board/component'])
  assert.deepEqual(check({ graph: { nodes: Array.from({ length: 1001 }, (_, i) => ({ key: 'n' + i })) } }), [413, 'too_big', '/graph/nodes'])
  assert.deepEqual(check({ graph: { nodes: [{ key: 'a' }], edges: Array.from({ length: 5001 }, () => ({ from: 'a', to: 'a' })) } }), [413, 'too_big', '/graph/edges'])
  assert.deepEqual(check({ graph: { nodes: Array.from({ length: 900 }, (_, i) => ({ key: 'n' + i, label: 'x'.repeat(300) })) } }), [413, 'too_big', '/'])
  assert.deepEqual(check([]), [400, 'bad_payload', '/'])
})

test('Mermaid, a board and prose; append mode and a person\'s own slate as the target', async () => {
  const m = await post({ key: 'flow', mermaid: 'flowchart LR\n  a[Build] --> b[Test]\n  b --> c[Deploy]' })
  assert.deepEqual(m.result.desired.slates[0].graph.nodes.map((n) => [n.key, n.text]), [['a', 'Build'], ['b', 'Test'], ['c', 'Deploy']])
  const bad = await post({ mermaid: 'sequenceDiagram\n  A->>B: hi' }).catch((e) => e)
  assert.deepEqual([bad.status, bad.pointer], [422, '/mermaid'])
  assert.match(bad.message, /sequence diagram/)
  const cards = Array.from({ length: 30 }, (_, i) => ({ key: 'c' + i, label: 'Card ' + i, lane: i % 2 ? 'doing' : 'todo', due: '2026-12-01' }))
  const b = await post({ title: 'Release', board: { component: 'team-board', lanes: [{ key: 'todo', label: 'To do' }, { key: 'doing', label: 'Doing' }], cards } })
  assert.deepEqual(b.result.desired.slates[0].boards.map((x) => [x.title, x.cards.length]), [['Release (1)', 24], ['Release (2)', 6]])
  const ai = fakeAi(() => ({ nodes: [{ key: 'web', label: 'Web app' }, { key: 'db', label: 'Database' }], edges: [{ from: 'web', to: 'db', label: 'reads' }] }))
  const t = await post({ text: 'A web app reads from a database.' }, { text: true }, ai)
  assert.equal(ai.calls.length, 1)
  assert.deepEqual(t.result.desired.slates[0].graph.edges, [{ from: 'web', to: 'db', label: 'reads' }])
  const appended = await post({ ...graph(['a']) }, { merge: 'append', targetShareId: 'myslate01' })
  assert.equal(appended.result.desired.slates[0].incremental, true)
  assert.deepEqual(appended.result.desired.slates[0].target, { shareId: 'myslate01' })
  const nothing = await post(undefined)
  assert.deepEqual(nothing.result.desired, { slates: [] })
})
