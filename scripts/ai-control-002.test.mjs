// ai-control-002, part 2: the catalogue import. On the prod-shaped settings (fake keys) every part
// of Slatebox answers with exactly the model it answers with today: conversation, drafts and
// presentations on Meta Muse Ember (the default), shapes on DeepInfra Gemini 3.5 Flash, reading
// images on DeepInfra Qwen3 235B, generated pictures on the built-in Stability service. The
// self-check aborts on any difference and leaves the marker unset; older documents are converted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { aiControlWorld } from './ai-control-kit.mjs'
import { AI_CONTROL_002, importSettingsKeys, oldRoutes, planCatalogue, runAIControl002, selfCheck } from '../web/app/server/migrations/ai-control-002.mjs'
import { resolveModel } from '../web/app/server/ai-control/resolve.mjs'
import { seal } from '../web/app/server/metering/vault.mjs'
import { BINDABLE_SURFACES } from '../web/app/server/ai-control/bindings.mjs'

const META = 'sk-test-meta-1111111111111111111111aaaa'
const DEEPINFRA = 'test-deepinfra-5555555555555555eeee'
const prodSettings = () => ({
  public: { env: 'prod' },
  ai: {
    connections: { 'meta-muse': { type: 'openai-compatible', baseUrl: 'https://api.meta.ai/v1', model: 'muse-ember-1.0', apiKey: META, toolChoice: 'auto', capabilities: { tools: true } } },
    use: { presentation: 'meta-muse', generation: 'meta-muse', chat: 'meta-muse' },
    features: { layout: { provider: 'deepinfra', engine: 'Qwen/Qwen3-235B-A22B-Instruct-2507' }, presentation: { provider: 'deepinfra', engine: 'google/gemini-3.5-flash' } },
  },
  openai: { apiKey: 'sk-test-openai-22222222222222222222bbbb' },
  stabilityai: { apiKey: 'sk-test-stab-44444444444444444444dddd' },
})
const ENV = { API_KEY_DEEP_INFRA: DEEPINFRA }
const quiet = { info() {}, warn() {}, error() {} }

// today's routing on prod (§0 of the plan)
const TODAY = {
  chat: 'api.meta.ai muse-ember-1.0', 'chat.route': 'api.meta.ai muse-ember-1.0', generation: 'api.meta.ai muse-ember-1.0',
  presentation: 'api.meta.ai muse-ember-1.0', workshop: 'api.meta.ai muse-ember-1.0', 'workshop.draft': 'api.meta.ai muse-ember-1.0',
  canvas: 'api.meta.ai muse-ember-1.0', 'agent.slatebox': 'api.meta.ai muse-ember-1.0', library: 'api.meta.ai muse-ember-1.0', connectors: 'api.meta.ai muse-ember-1.0',
  shape: 'api.deepinfra.com google/gemini-3.5-flash', vision: 'api.deepinfra.com Qwen/Qwen3-235B-A22B-Instruct-2507', images: 'stability',
}
const shown = (resolved) => {
  if (resolved.source === 'stability') return 'stability'
  const r = resolved.route
  return `${new URL(r.baseUrl).host} ${r.model}`
}

async function migrated(settings = prodSettings(), env = ENV) {
  const w = await aiControlWorld({ settings })
  await importSettingsKeys({ settings, env, keys: w.keyStore, catalog: w.catalog, log: quiet })
  const out = await runAIControl002({ raw: { ...w.raw, keys: w.keys, choices: w.choices }, store: w.store, master: null, settings, env, log: quiet })
  await w.holder.refresh({ force: true })
  return { w, out }
}

test('today\'s routes, read from the prod-shaped settings, are the table in the plan', () => {
  const routes = oldRoutes({ settings: prodSettings(), env: ENV })
  for (const [surface, want] of Object.entries(TODAY)) {
    const route = routes[surface]
    assert.equal(route.kind === 'stability' ? 'stability' : `${new URL(route.baseUrl).host} ${route.model}`, want, surface)
  }
})

test('after the import every part answers exactly as today: default Ember, shapes and images-reading pinned to DeepInfra, pictures on Stability', async () => {
  const { w, out } = await migrated()
  assert.equal(out.done, true)
  const snap = w.snapshot()
  assert.deepEqual(Object.keys(snap.bindings).sort(), ['default', 'shape', 'vision'])
  assert.equal(snap.bindings.default.model, 'meta:muse-ember-1.0')
  assert.equal(snap.bindings.shape.model, 'deepinfra:google/gemini-3.5-flash')
  assert.equal(snap.bindings.vision.model, 'deepinfra:Qwen/Qwen3-235B-A22B-Instruct-2507')
  for (const [surface, want] of Object.entries(TODAY)) assert.equal(shown(resolveModel(snap, { surface })), want, surface)
  // chat, drafts and presentations use the default: no binding of their own
  for (const surface of ['chat', 'generation', 'presentation']) assert.equal(resolveModel(snap, { surface }).source, 'default', surface)
  assert.equal(snap.models['meta:muse-ember-1.0'].prices.inputPerM, 0.3, 'the price data model is kept')
  assert.ok(await w.raw.state.findOne({ _id: AI_CONTROL_002 }), 'the marker is set')
  // and the request path answers with the stored keys
  const chat = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.equal(chat.connection.apiKey, META)
  assert.equal(chat.connection.model, 'muse-ember-1.0')
  const shape = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'shape', request: { tools: true } })
  assert.equal(shape.connection.apiKey, DEEPINFRA)
  assert.equal(shape.connection.baseUrl, 'https://api.deepinfra.com/v1/openai')
  assert.equal(shape.connection.toolChoice, 'named')
})

test('the catalogue import runs once per database', async () => {
  const { w } = await migrated()
  const rows = w.raw.audit.rows.length
  const again = await runAIControl002({ raw: { ...w.raw, keys: w.keys, choices: w.choices }, store: w.store, master: null, settings: prodSettings(), env: ENV, log: quiet })
  assert.equal(again.done, false)
  assert.equal(w.raw.audit.rows.length, rows)
})

test('a fresh self-hosted server with no keys gets the Meta provider, Ember and the default, and pins nothing it could not answer with', async () => {
  const { w, out } = await migrated({ public: { env: 'selfhost' } }, {})
  assert.equal(out.done, true)
  assert.deepEqual(Object.keys(w.snapshot().bindings), ['default'])
  for (const surface of BINDABLE_SURFACES.filter((s) => s !== 'default' && s !== 'images')) assert.equal(resolveModel(w.snapshot(), { surface }).route.model, 'muse-ember-1.0', surface)
})

test('the self-check: when the plan would change an answer, nothing is written and the marker stays unset', () => {
  const plan = planCatalogue(oldRoutes({ settings: prodSettings(), env: ENV }))
  assert.deepEqual(selfCheck(plan), [])
  delete plan.bindings.shape
  const differences = selfCheck(plan)
  assert.deepEqual(differences.map((d) => d.surface), ['shape'])
  assert.match(differences[0].was, /gemini-3\.5-flash/)
})

test('older documents are converted: a model chain binding, a connection-named model, a server connection with its key, the server\'s choices and binding versions', async () => {
  const w = await aiControlWorld({ settings: { public: { env: 'selfhost' } } })
  const master = (await import('./ai-control-kit.mjs')).fakeMaster()
  const keyOwner = { ownerType: 'server', ownerId: 'server', provider: 'openai-compatible' }
  await w.keys.insertOne({ _id: 'conn1', ownerType: 'server', ownerId: 'server', name: 'gem', provider: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', cipher: seal({ master, owner: keyOwner, plaintext: 'AIza-test-gem-000000000000000000000' }), last4: '0000' })
  await w.raw.models.insertOne({ _id: 'gem:gemini-3.8-flash', connection: 'server:gem', model: 'gemini-3.8-flash', capabilities: { tools: true }, status: 'enabled' })
  await w.raw.bindings.insertOne({ _id: 'shape|server', surface: 'shape', scope: { level: 'server' }, chain: [{ model: 'gem:gemini-3.8-flash' }, { connection: 'builtin', on: ['infra'] }], params: { timeoutMs: 30000 }, status: 'published', version: 3 })
  await w.choices.insertOne({ _id: 'server:server', use: { chat: 'server:gem' }, ownProviders: true })
  const versions = (await import('./ai-control-kit.mjs')).memoryCollection()
  await versions.insertOne({ _id: 'v1', bindingId: 'shape|server', version: 1, status: 'superseded' })
  const dropped = []
  const out = await runAIControl002({ raw: { ...w.raw, keys: w.keys, choices: w.choices, bindingVersions: versions }, store: w.store, master, settings: { public: { env: 'selfhost' } }, env: {}, log: quiet, drop: async (name) => dropped.push(name) })
  assert.equal(out.done, true)
  await w.holder.refresh({ force: true })
  const snap = w.snapshot()
  assert.equal(snap.providers.gemini.label, 'Google Gemini', 'the connection\'s address names its provider')
  assert.equal(snap.bindings.shape.model, 'gemini:gemini-3.8-flash')
  assert.equal(snap.bindings.chat.model, 'gemini:gemini-3.8-flash')
  assert.equal(snap.bindings.shape.params, undefined, 'no parameters survive')
  assert.equal(await w.raw.bindings.findOne({ _id: 'shape|server' }), null)
  assert.equal(await w.raw.models.findOne({ _id: 'gem:gemini-3.8-flash' }), null)
  assert.equal(await w.keys.findOne({ _id: 'conn1' }), null, 'the connection document goes')
  assert.equal((await w.keyStore.keyFor('gemini')).apiKey, 'AIza-test-gem-000000000000000000000', 'its key, sealed again for its provider')
  assert.equal((await w.choices.findOne({ _id: 'server:server' })).use, undefined)
  assert.equal((await w.choices.findOne({ _id: 'server:server' })).ownProviders, true)
  assert.deepEqual(dropped, ['aiBindingVersions'])
  assert.ok(w.raw.audit.rows.some((row) => row.action === 'ai.bindings.history'))
})

test('a self-hosted server set up with one model for everything (SLATEBOX_AI_URL, use.default) gets that model as its default, not a binding per part', async () => {
  const LOCAL = 'test-local-7777777777777777gggg'
  const settings = {
    public: { env: 'selfhost' },
    ai: { connections: { server: { type: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', model: 'llama-3.3-70b', apiKey: LOCAL } }, use: { default: 'server' } },
  }
  const { w, out } = await migrated(settings, {})
  assert.equal(out.done, true)
  const snap = w.snapshot()
  assert.equal(snap.bindings.default.model, 'server:llama-3.3-70b')
  assert.deepEqual(Object.keys(snap.bindings), ['default'], 'no binding per part')
  for (const surface of BINDABLE_SURFACES.filter((s) => s !== 'default' && s !== 'images')) {
    assert.equal(resolveModel(snap, { surface }).route.model, 'llama-3.3-70b', surface)
  }
  // a chat model cannot draw: generated pictures keep the built-in image service (before, they failed
  // with "cannot make images"; the self-check no longer blocks the whole move on that)
  assert.equal(resolveModel(snap, { surface: 'images' }).source, 'stability')
  assert.equal(snap.health.length, 0)
  const chat = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.equal(chat.connection.apiKey, LOCAL)
  assert.equal(chat.connection.baseUrl, 'https://llm.example.com/v1')
})
