// S2, the concept map (enterprise/recipes/slack-concepts), against the catalog's acceptance criteria:
// a mind map of at most max terms with no duplicates by alias, the channel at the center, related
// terms clustered, the 10 most used drawn larger, each linked to the message that defined it; a later
// week adds only new terms (the same keys for the old ones, so reconcile moves nothing); an alias
// found later keeps its old note, pointing at its term; with the model off, one ring, still useful.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-slack-concepts.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import S2 from '../enterprise/recipes/slack-concepts/index.mjs'
import { CHANNEL, foldModel, MESSAGES, tsAt } from '../enterprise/recipes/_slack-ledger/fixtures/checkout.mjs'
import { fakeAi } from './fakes/recipe-lite-context.mjs'
import { slackWorld } from './fakes/slack-recipe-world.mjs'

const clusterModel = (aliases = []) => (prompt, schema, purpose) => {
  if (purpose !== 'clusters') return foldModel(prompt)
  return { clusters: [{ label: 'Payments', terms: ['PSP', '3DS2', 'soft decline', '3DS'] }, { label: 'Platform', terms: ['API', 'PCI', 'EU'] }], aliases }
}

test('a mind map: the channel at the center, clusters, definitions, links, the most used larger, at most max terms', async () => {
  const w = slackWorld()
  const instance = w.addInstance('c1', 'slack-concepts', { channels: [CHANNEL.id], max: 10 })
  await w.deliver(MESSAGES)
  const ai = fakeAi(clusterModel())
  const run = await w.run(S2, instance, { ai, trigger: { kind: 'schedule' } })
  const [slate] = run.result.desired.slates
  assert.equal(slate.name, 'Concepts — #proj-checkout')
  assert.equal(slate.graph.layout, 'mindmap')
  const center = slate.graph.nodes.find((n) => n.key === 'center')
  assert.equal(center.text, '#proj-checkout')
  const terms = slate.graph.nodes.filter((n) => n.key.startsWith('con:'))
  assert.ok(terms.length <= 10)
  const psp = terms.find((n) => n.text.startsWith('PSP'))
  assert.match(psp.text, /PSP — payment service provider/)
  assert.match(psp.link, /^https:\/\/acme\.slack\.com\/archives\//)
  assert.equal(psp.size, 'large')
  const payments = slate.graph.nodes.find((n) => n.key === 'cluster:payments')
  assert.ok(payments)
  assert.ok(slate.graph.edges.some((e) => e.from === 'center' && e.to === 'cluster:payments'))
  assert.ok(slate.graph.edges.some((e) => e.from === 'cluster:payments' && e.to === psp.key))
  assert.deepEqual(ai.calls.map((c) => c.purpose), ['ledger', 'clusters'])
  assert.ok(ai.calls[1].maxIn === 6000 && ai.calls[1].maxOut === 1500)
  assert.equal(run.events[0].event, 'concepts.updated')
  assert.ok(run.events[0].data.added >= 5)
  assert.ok(run.events[0].data.addedKeys.includes(psp.key), 'keys and counts, never the words')
})

test('a later week: only new terms are added, the old notes keep their keys; fewer than 10 new terms on a message trigger: no clustering call', async () => {
  const w = slackWorld()
  const instance = w.addInstance('c1', 'slack-concepts', { channels: [CHANNEL.id] })
  await w.deliver(MESSAGES)
  const ai = fakeAi(clusterModel())
  const first = await w.run(S2, instance, { ai, trigger: { kind: 'schedule' } })
  w.clock.at += 7 * 86400000
  await w.deliver([{ ts: tsAt(20000), user: 'U0RAJ', text: 'The new SCA rules mean every EU card payment needs a challenge unless exempt' }])
  const second = await w.run(S2, instance, { ai, trigger: { kind: 'vendor', event: 'slack.message' } })
  const keys = (run) => run.result.desired.slates[0].graph.nodes.map((n) => n.key)
  for (const key of keys(first)) assert.ok(keys(second).includes(key), `${key} stays`)
  assert.ok(keys(second).some((k) => /:sca$/.test(k)), 'the new term')
  assert.deepEqual([second.events[0].data.added, second.events[0].data.addedKeys], [1, [`con:${CHANNEL.id}:sca`]])
  assert.equal(ai.calls.filter((c) => c.purpose === 'clusters').length, 1, 'one new term: no re-clustering')
})

test('aliases: a new alias gets no note; one drawn before it was known keeps its note, pointing at its term', async () => {
  const w = slackWorld()
  const instance = w.addInstance('c1', 'slack-concepts', { channels: [CHANNEL.id] })
  await w.deliver([...MESSAGES, { ts: tsAt(700), user: 'U0LEE', text: 'Is 3DS required for every card or only in the EU?' }])
  const first = await w.run(S2, instance, { ai: fakeAi(clusterModel()), trigger: { kind: 'schedule' } })
  const old = first.result.desired.slates[0].graph.nodes.find((n) => /^3DS(?!2)/.test(n.text))
  assert.ok(old, '3DS drawn as its own term at first')
  const second = await w.run(S2, instance, { ai: fakeAi(clusterModel([{ alias: '3DS', term: '3DS2' }])), trigger: { kind: 'manual' } })
  const nodes = second.result.desired.slates[0].graph.nodes
  assert.equal(nodes.find((n) => n.key === old.key).text, '3DS (same as 3DS2)')
  assert.match(nodes.find((n) => n.text.startsWith('3DS2')).text, /^3DS2 \(also 3DS\)/)
  assert.ok(second.result.desired.slates[0].graph.edges.some((e) => e.from === old.key && e.label === 'same as'))
  assert.equal(second.events[0].data.merged, 1)
  // A fresh map with the alias known from the start: no duplicate note for it.
  const fresh = slackWorld()
  const inst = fresh.addInstance('c2', 'slack-concepts', { channels: [CHANNEL.id] })
  inst.cursor = { channels: { [CHANNEL.id]: { clusters: {}, aliases: { '3ds': '3ds2' }, terms: 99, drawn: [] } } }
  await fresh.deliver([...MESSAGES, { ts: tsAt(700), user: 'U0LEE', text: 'Is 3DS required for every card or only in the EU?' }])
  const run = await fresh.run(S2, inst, { ai: fakeAi(() => null), trigger: { kind: 'vendor', event: 'slack.message' } })
  assert.equal(run.result.desired.slates[0].graph.nodes.filter((n) => /^3DS\b(?!2)/.test(n.text)).length, 0)
})

test('the model off: the terms in one ring around the channel', async () => {
  const w = slackWorld()
  const instance = w.addInstance('c1', 'slack-concepts', { channels: [CHANNEL.id] })
  await w.deliver(MESSAGES)
  const ai = fakeAi(() => null)
  ai.off = true
  const run = await w.run(S2, instance, { ai, trigger: { kind: 'schedule' } })
  const { nodes, edges } = run.result.desired.slates[0].graph
  assert.ok(nodes.filter((n) => n.key.startsWith('con:')).length >= 4)
  assert.ok(!nodes.some((n) => n.key.startsWith('cluster:')))
  assert.ok(edges.every((e) => e.from === 'center'))
  assert.ok(run.result.desired.partial, 'marked partial')
})
