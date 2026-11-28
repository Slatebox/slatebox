// W2, design doc to diagram (enterprise/recipes/google-design-doc), against the catalog's acceptance
// criteria: a doc with 2 Mermaid blocks gives 2 frames, matching parseMermaid; editing one block's
// label in the doc changes one note; a doc without Mermaid gives one model call, then none on
// unchanged (or barely changed) reruns; the heading links open the right section. Plus the doc map,
// a components table as notes and connectors, and "Proposed vs current" against the project's
// living architecture map.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-google-design-doc.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import W2 from '../enterprise/recipes/google-design-doc/index.mjs'
import { parseMermaid } from '../web/app/imports/api/common/mermaid/parse.mjs'
import { fakeAi } from './fakes/recipe-lite-context.mjs'
import { docContent, googleWorld } from './fakes/google-recipe-world.mjs'

const DOC = 'doc0123456789abcdef'
const PAYMENTS = 'flowchart LR\n  web[Checkout web] --> api[Payments API]\n  api --> psp((Adyen))'
const EVENTS = 'flowchart TD\n  api[Payments API] --> bus[Event bus]\n  bus --> ledger[Ledger]'

function designDoc({ payments = PAYMENTS, events = EVENTS, withTable = true } = {}) {
  return docContent([
    ['TITLE', 'Checkout v2 design'],
    ['HEADING_1', 'Overview', 'h.over'],
    ['NORMAL_TEXT', 'This replaces the legacy checkout.'],
    ['HEADING_1', 'Payments', 'h.pay'],
    ['NORMAL_TEXT', '```mermaid'],
    ...payments.split('\n').map((line) => ['NORMAL_TEXT', line]),
    ['NORMAL_TEXT', '```'],
    ['HEADING_2', 'Events', 'h.events'],
    ['NORMAL_TEXT', '```mermaid'],
    ...events.split('\n').map((line) => ['NORMAL_TEXT', line]),
    ['NORMAL_TEXT', '```'],
    ...(withTable ? [['HEADING_1', 'Components', 'h.comp'], { table: [['Component', 'Purpose', 'Depends on'], ['Payments API', 'Takes payments', 'Ledger, Fraud service'], ['Ledger', 'Books every movement', '']] }] : []),
  ])
}
const files = (content, version = 1) => ({ [DOC]: { name: 'Checkout v2 design', mimeType: 'application/vnd.google-apps.document', version, content } })

test('two Mermaid blocks: two frames whose notes match parseMermaid; the doc map links each heading; a components table as notes and connectors', async () => {
  const w = googleWorld({ files: files(designDoc()) })
  const instance = w.addInstance('d1', 'google-design-doc', { fileIds: [DOC] })
  const run = await w.run(W2, instance)
  const [slate] = run.result.desired.slates
  assert.equal(slate.name, 'Design — Checkout v2 design')
  const diagramFrames = slate.graph.frames.filter((f) => f.key.startsWith('frame:mm/'))
  assert.deepEqual(diagramFrames.map((f) => f.text), ['Diagram in Payments', 'Diagram in Events'])
  for (const [frame, source] of [[diagramFrames[0], PAYMENTS], [diagramFrames[1], EVENTS]]) {
    const model = parseMermaid(source)
    const texts = frame.members.map((key) => slate.graph.nodes.find((n) => n.key === key).text)
    assert.deepEqual(texts, model.nodes.map((n) => n.text))
  }
  assert.ok(slate.graph.edges.some((e) => e.from === 'mm/h:h.pay#1/web' && e.to === 'mm/h:h.pay#1/api'))
  const map = slate.graph.nodes.filter((n) => n.key.startsWith('map/h:'))
  assert.deepEqual(map.map((n) => [n.text, n.link]), [
    ['Overview', `https://docs.google.com/document/d/${DOC}/edit#heading=h.over`],
    ['Payments', `https://docs.google.com/document/d/${DOC}/edit#heading=h.pay`],
    ['Events', `https://docs.google.com/document/d/${DOC}/edit#heading=h.events`],
    ['Components', `https://docs.google.com/document/d/${DOC}/edit#heading=h.comp`],
  ])
  assert.ok(slate.graph.edges.some((e) => e.from === 'map/h:h.pay' && e.to === 'map/h:h.events'), 'Events sits under Payments')
  const api = slate.graph.nodes.find((n) => n.key === 'comp/payments api')
  assert.equal(api.text, 'Payments API — Takes payments')
  assert.ok(slate.graph.edges.some((e) => e.from === 'comp/payments api' && e.to === 'comp/fraud service'))
  assert.deepEqual(run.events.map((e) => e.event), ['design_doc.updated'])
  assert.deepEqual(run.events[0].data, { docId: DOC, diagrams: 2, drafted: false }, 'ids and counts, never the doc\'s words')
  assert.deepEqual(w.state.calls, { 'files.get': 1, 'documents.get': 1 })
})

test('editing one label in the doc changes exactly one note; nothing else moves or changes', async () => {
  const w = googleWorld({ files: files(designDoc()) })
  const instance = w.addInstance('d1', 'google-design-doc', { fileIds: [DOC] })
  const first = (await w.run(W2, instance)).result.desired.slates[0].graph
  w.state.files[DOC].content = designDoc({ events: EVENTS.replace('Event bus', 'Kafka') })
  w.state.files[DOC].version = 2
  const second = await w.run(W2, instance)
  const next = second.result.desired.slates[0].graph
  const before = new Map(first.nodes.map((n) => [n.key, n.text]))
  const changed = next.nodes.filter((n) => before.get(n.key) !== n.text)
  assert.deepEqual(changed.map((n) => [n.key, n.text]), [['mm/h:h.events#1/bus', 'Kafka']])
  assert.equal(next.nodes.length, first.nodes.length)
  assert.deepEqual(next.edges, first.edges)
  assert.equal(second.events.length, 1, 'a new revision')
})

test('a doc with no diagram: one drafted graph (≤ 12k in), reused on unchanged and barely changed reruns, redrafted when the text really changes', async () => {
  const text = 'The checkout web app calls the payments API. The payments API charges cards through Adyen and writes every movement to the ledger. A nightly job reconciles the ledger with Adyen settlement reports and alerts finance when they differ. '
  const doc = (body) => docContent([['TITLE', 'Payments notes'], ['HEADING_1', 'How it works', 'h.how'], ['NORMAL_TEXT', body]])
  const w = googleWorld({ files: files(doc(text.repeat(3))) })
  const instance = w.addInstance('d1', 'google-design-doc', { fileIds: [DOC] })
  const ai = fakeAi(() => ({ nodes: [{ key: 'web', label: 'Checkout web' }, { key: 'api', label: 'Payments API' }, { key: 'adyen', label: 'Adyen' }, { key: 'ledger', label: 'Ledger' }], edges: [{ from: 'web', to: 'api', label: 'calls' }, { from: 'api', to: 'adyen', label: 'charges' }, { from: 'api', to: 'ledger', label: 'writes' }] }))
  const first = await w.run(W2, instance, { ai })
  assert.equal(ai.calls.length, 1)
  assert.ok(ai.calls[0].maxIn === 12000 && ai.calls[0].maxOut === 1000)
  const [slate] = first.result.desired.slates
  const frame = slate.graph.frames.find((f) => f.key === 'frame:draft')
  assert.equal(frame.text, 'Drafted by the agent from the doc')
  assert.deepEqual(frame.members, ['draft/web', 'draft/api', 'draft/adyen', 'draft/ledger'])
  assert.equal(first.events[0].data.drafted, true)
  await w.run(W2, instance, { ai })
  assert.equal(ai.calls.length, 1, 'unchanged: no call')
  w.state.files[DOC].content = doc(text.repeat(3).replace('nightly', 'daily'))
  const small = await w.run(W2, instance, { ai })
  assert.equal(ai.calls.length, 1, 'a one-word edit: the draft stays')
  assert.deepEqual(small.result.desired.slates[0].graph.nodes.map((n) => n.key), slate.graph.nodes.map((n) => n.key))
  w.state.files[DOC].content = doc('Orders are now placed through a new mobile app that talks to an order service, which queues fulfilment requests for three regional warehouses and a returns desk.')
  await w.run(W2, instance, { ai })
  assert.equal(ai.calls.length, 2, 'the text changed: one new draft')
})

test('only the chosen sections; an unreadable block says why in plain words; a file that is not a Doc is skipped', async () => {
  const w = googleWorld({ files: { ...files(designDoc({ payments: 'sequenceDiagram\n  A->>B: hi' })), sheet0123456789abc: { name: 'A sheet', mimeType: 'application/vnd.google-apps.spreadsheet', version: 1 } } })
  const instance = w.addInstance('d1', 'google-design-doc', { fileIds: [DOC, 'sheet0123456789abc'], headings: ['Payments'] })
  const run = await w.run(W2, instance)
  assert.equal(run.result.desired.slates.length, 1)
  assert.deepEqual(run.logs, [{ level: 'warn', code: 'not_a_doc', msg: 'Skipped sheet0123456789abc: not a Google Doc.' }])
  const { nodes, frames } = run.result.desired.slates[0].graph
  assert.match(nodes.find((n) => n.key.endsWith('/unreadable')).text, /could not be drawn: .*sequence diagram/)
  assert.deepEqual(frames.filter((f) => f.key.startsWith('frame:mm/')).map((f) => f.text), ['Diagram in Events'], 'Events sits under Payments; Components is out of scope')
  assert.ok(!nodes.some((n) => n.key.startsWith('comp/')))
})

test('proposed vs current: names in the design the architecture map lacks, in a note and design_doc.drift', async () => {
  const w = googleWorld({ files: files(designDoc()) })
  const instance = w.addInstance('d1', 'google-design-doc', { fileIds: [DOC] })
  const project = { slatesByRecipe: async (recipeId, role) => (recipeId === 'github-architecture' && role === 'service-map' ? [{ notes: [{ text: 'Payments API' }, { text: 'Checkout web' }, { text: 'Ledger' }] }] : []) }
  const run = await w.run(W2, instance, { project })
  const drift = run.result.desired.slates[0].notes.find((n) => n.key === 'drift')
  assert.equal(drift.text, 'Proposed vs current: not yet in the architecture map: Adyen, Event bus, Fraud service')
  assert.deepEqual(run.events.find((e) => e.event === 'design_doc.drift').data, { docId: DOC, missing: 3 })
  const again = await w.run(W2, instance, { project })
  assert.ok(!again.events.some((e) => e.event === 'design_doc.drift'), 'the same drift is reported once')
})
