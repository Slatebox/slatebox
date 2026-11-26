// Bindings: one simple choice per part of Slatebox: a provider's model, "Use the default", or
// turned off. The default ("Everything not set") is Meta Muse Ember until an administrator picks
// another. A plain Save writes only the rows that changed, one audit row each. The per-binding
// parameters, tools, limits, fallback chains, prompt pins, drafts and versions are gone: the API
// refuses them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { aiControlWorld, asAgent, asPerson, bodyOf, registryFor } from './ai-control-kit.mjs'
import { BINDABLE_SURFACES } from '../web/app/server/ai-control/bindings.mjs'

async function world() {
  const w = await aiControlWorld()
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'meta' }, models: ['muse-ember-1.0', 'muse-spark-1.3'] })
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'deepinfra' }, models: ['google/gemini-3.5-flash', 'Qwen/Qwen3-235B-A22B-Instruct-2507'] })
  return w
}

test('the parts that can be bound: default and every part a call site sends', () => {
  assert.deepEqual(BINDABLE_SURFACES, ['default', 'chat', 'chat.route', 'generation', 'presentation', 'vision', 'images', 'shape', 'workshop', 'workshop.draft', 'canvas', 'agent.slatebox', 'library', 'connectors', 'interview', 'eval'])
  // the interview (S2, 2026-11-26): an administrator binds it, or turns it off, like any part
})

test('set, clear and turn off per part; the next request goes to the new model', async () => {
  const w = await world()
  await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: 'sk-test-meta-0000000000000000000001' })
  await w.keyStore.add({ actor: w.actor, provider: 'deepinfra', apiKey: 'test-deepinfra-00000000000000000002' })
  assert.equal((await w.aiSettings.resolveFor({ userId: 'ana', feature: 'shape' })).connection.model, 'muse-ember-1.0', 'nothing set: the built-in default')
  const out = await w.bindings.set({ actor: w.actor, changes: [{ surface: 'shape', use: 'model', model: 'deepinfra:google/gemini-3.5-flash' }] })
  assert.deepEqual(out.changed, ['shape'])
  const shape = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'shape' })
  assert.equal(shape.connection.model, 'google/gemini-3.5-flash')
  assert.equal(shape.connection.apiKey, 'test-deepinfra-00000000000000000002')
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'shape', use: 'off' }] })
  assert.equal((await w.aiSettings.resolveFor({ userId: 'ana', feature: 'shape' })).disabled, true)
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'shape', use: 'default' }] })
  assert.equal(w.snapshot().bindings.shape, undefined, 'use the default: no document')
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'default', use: 'model', model: 'meta:muse-spark-1.3' }] })
  assert.equal((await w.aiSettings.resolveFor({ userId: 'ana', feature: 'shape' })).connection.model, 'muse-spark-1.3', 'the default row moves every part not set')
  const listed = w.bindings.list()
  assert.equal(listed.surfaces.find((s) => s.surface === 'shape').binding.use, 'default')
  assert.equal(listed.surfaces.find((s) => s.surface === 'shape').resolved.source, 'default')
  assert.equal(listed.surfaces.find((s) => s.surface === 'workshop').followsTitle, 'Conversation and edits')
})

test('an unknown model, a disabled one, a capability gap and turning the default off are refused, and nothing is written', async () => {
  const w = await world()
  await assert.rejects(w.bindings.set({ actor: w.actor, changes: [{ surface: 'shape', use: 'model', model: 'meta:nope' }] }), /no model meta:nope/)
  await w.catalog.saveModels({ actor: w.actor, models: [{ provider: 'meta', model: 'muse-ember-1.0', capabilities: { tools: false } }] })
  await assert.rejects(w.bindings.set({ actor: w.actor, changes: [{ surface: 'chat', use: 'model', model: 'meta:muse-ember-1.0' }] }), /cannot call tools, which conversation and edits needs/)
  await assert.rejects(w.bindings.set({ actor: w.actor, changes: [{ surface: 'images', use: 'model', model: 'meta:muse-spark-1.3' }] }), /cannot make images/)
  await assert.rejects(w.bindings.set({ actor: w.actor, changes: [{ surface: 'default', use: 'off' }] }), /cannot be turned off here/)
  await w.catalog.saveModels({ actor: w.actor, models: [{ provider: 'meta', model: 'muse-spark-1.3', status: 'disabled' }] })
  await assert.rejects(w.bindings.set({ actor: w.actor, changes: [{ surface: 'generation', use: 'off' }, { surface: 'shape', use: 'model', model: 'meta:muse-spark-1.3' }] }), /turned off on the Models tab/)
  assert.equal(w.snapshot().bindings.generation, undefined, 'the whole change is checked before anything is written')
})

test('a plain Save writes only what changed, each change one audit row with who and the optional note', async () => {
  const w = await world()
  const before = w.raw.audit.rows.length
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'shape', use: 'model', model: 'deepinfra:google/gemini-3.5-flash' }, { surface: 'vision', use: 'model', model: 'deepinfra:Qwen/Qwen3-235B-A22B-Instruct-2507' }, { surface: 'chat', use: 'default' }], note: 'Faster shapes' })
  const rows = w.raw.audit.rows.slice(before)
  assert.deepEqual(rows.map((r) => [r.action, r.target.id]), [['ai.bindings.set', 'shape'], ['ai.bindings.set', 'vision']])
  assert.equal(rows[0].actor.userId, 'admin1')
  assert.equal(rows[0].reason, 'Faster shapes')
  assert.equal(rows[0].after.model, 'deepinfra:google/gemini-3.5-flash')
  const again = await w.bindings.set({ actor: w.actor, changes: [{ surface: 'shape', use: 'model', model: 'deepinfra:google/gemini-3.5-flash' }] })
  assert.deepEqual(again.changed, [], 'saving the same choice writes nothing')
})

test('the removed per-binding parameters, chains, tools, limits, prompt pins and drafts are no longer accepted by the API', async () => {
  const w = await world()
  const registry = await registryFor(w)
  for (const extra of [{ params: { timeoutMs: 1000 } }, { chain: [{ model: 'meta:muse-ember-1.0' }] }, { tools: { mode: 'auto' } }, { limits: { ceiling: 5 } }, { prompts: { system: 'shape.system@2' } }, { onTrip: 'fallback' }, { enabled: false }, { temperature: 0.2 }]) {
    await assert.rejects(registry.run(asPerson(), 'ai.bindings.set', { changes: [{ surface: 'shape', use: 'default', ...extra }] }), (error) => error.status === 400, JSON.stringify(extra))
  }
  for (const id of ['ai.bindings.saveDraft', 'ai.bindings.publish', 'ai.bindings.rollback', 'ai.connections.list', 'ai.connections.save', 'ai.connections.remove']) assert.equal(registry.get(id), undefined, `${id} is gone`)
  const done = bodyOf(await registry.run(asPerson(), 'ai.bindings.set', { changes: [{ surface: 'shape', use: 'model', model: 'deepinfra:google/gemini-3.5-flash' }] }))
  assert.deepEqual(done.changed, ['shape'])
  const listed = bodyOf(await registry.run(asAgent(), 'ai.bindings.list', {}))
  assert.equal(listed.surfaces.find((s) => s.surface === 'shape').binding.model, 'deepinfra:google/gemini-3.5-flash')
  await assert.rejects(registry.run(asPerson('ana'), 'ai.bindings.set', { changes: [{ surface: 'shape', use: 'default' }] }), { status: 403 })
})

test('reset: one part, or every part, back to the default; a token cannot switch back on a part turned off', async () => {
  const w = await world()
  const registry = await registryFor(w)
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'shape', use: 'model', model: 'deepinfra:google/gemini-3.5-flash' }, { surface: 'canvas', use: 'off' }] })
  const one = bodyOf(await registry.run(asPerson(), 'ai.control.reset', { target: 'binding', surface: 'shape', reason: 'back to default' }))
  assert.deepEqual(one.removed, ['shape'])
  await assert.rejects(registry.run(asAgent(), 'ai.control.reset', { target: 'bindings', reason: 'x' }), (error) => error.status === 403 && /turned off/.test(error.message))
  for (const target of ['use', 'dbLayer']) await assert.rejects(registry.run(asPerson(), 'ai.control.reset', { target, reason: 'x' }), { status: 400 }, `${target} is gone`)
  const all = bodyOf(await registry.run(asPerson(), 'ai.control.reset', { target: 'bindings', reason: 'start over' }))
  assert.deepEqual(all.removed, ['canvas'])
})
