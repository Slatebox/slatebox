// The one resolver (ai-control/resolve.mjs): AI off for everyone, then the part's own choice, the
// part it follows, generated pictures on Stability while nothing is set, the default binding, then
// the built-in default (Meta Muse Ember). A person's own AI comes first, on a self-hosted server and
// on Slatebox Cloud alike (owner, 2026-11-26), and never before a part an administrator turned off.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_DEFAULT, CODE_LIMITS, STABILITY_ROUTE, defaultRoute, resolveModel, toSurface } from '../web/app/server/ai-control/resolve.mjs'
import { buildSnapshot, emptySnapshot } from '../web/app/server/ai-control/snapshot.mjs'
import { providerFromPreset } from '../web/app/server/ai-control/provider-presets.mjs'
import { aiControlWorld } from './ai-control-kit.mjs'

const meta = providerFromPreset('meta')
const deepinfra = providerFromPreset('deepinfra')
const model = (provider, id, extra = {}) => ({ _id: `${provider}:${id}`, provider, model: id, capabilities: { tools: true }, status: 'enabled', ...extra })
const snap = ({ bindings = [], state = null, keys = {} } = {}) => buildSnapshot({
  state,
  providers: [meta, deepinfra],
  models: [model('meta', 'muse-ember-1.0', { label: 'Muse Ember' }), model('meta', 'muse-spark-1.3'), model('deepinfra', 'google/gemini-3.5-flash'), model('deepinfra', 'Qwen/Qwen3-235B-A22B-Instruct-2507', { capabilities: { tools: true, vision: true } })],
  bindings,
  keys,
})
const bind = (surface, use, modelId) => ({ _id: surface, surface, use, ...(modelId && { model: modelId }) })

test('the built-in default is Meta Muse Ember, from the preset even with an empty snapshot', () => {
  assert.deepEqual(BUILTIN_DEFAULT, { preset: 'meta', model: 'muse-ember-1.0' })
  const resolved = resolveModel(emptySnapshot(), { surface: 'chat' })
  assert.equal(resolved.source, 'builtin')
  assert.equal(resolved.route.provider, 'meta')
  assert.equal(resolved.route.providerLabel, 'Meta (Muse)')
  assert.equal(resolved.route.baseUrl, 'https://api.meta.ai/v1')
  assert.equal(resolved.route.model, 'muse-ember-1.0')
  assert.equal(resolved.route.prices.inputPerM, 0.3)
  assert.equal(defaultRoute(emptySnapshot()).model, 'muse-ember-1.0')
})

test('a part binding wins; a part that is not set uses the default binding, then the built-in default', () => {
  const s = snap({ bindings: [bind('default', 'model', 'meta:muse-spark-1.3'), bind('shape', 'model', 'deepinfra:google/gemini-3.5-flash')] })
  assert.equal(resolveModel(s, { surface: 'shape' }).source, 'part')
  assert.equal(resolveModel(s, { surface: 'shape' }).route.modelId, 'deepinfra:google/gemini-3.5-flash')
  assert.equal(resolveModel(s, { surface: 'presentation' }).source, 'default')
  assert.equal(resolveModel(s, { surface: 'presentation' }).route.model, 'muse-spark-1.3')
  assert.equal(resolveModel(snap(), { surface: 'presentation' }).source, 'builtin')
})

test('an unset sub-part follows its parent before the default (workshop → chat; agent → canvas → chat)', () => {
  const s = snap({ bindings: [bind('chat', 'model', 'meta:muse-spark-1.3')] })
  const workshop = resolveModel(s, { surface: 'workshop' })
  assert.equal(workshop.source, 'followed')
  assert.equal(workshop.followed, 'chat')
  assert.equal(workshop.route.model, 'muse-spark-1.3')
  assert.equal(resolveModel(s, { surface: 'agent' }).followed, 'chat', 'a request feature resolves through its part')
  assert.equal(resolveModel(s, { surface: 'lane-chat' }).surface, 'workshop')
  assert.equal(toSurface('welcome-route'), 'chat.route')
})

test('turned off: the part and the parts that follow it answer with the administrator\'s message; AI off for everyone wins over everything', () => {
  const s = snap({ bindings: [bind('chat', 'off'), bind('canvas', 'model', 'meta:muse-spark-1.3')] })
  const chat = resolveModel(s, { surface: 'chat' })
  assert.equal(chat.enabled, false)
  assert.equal(chat.disabledMessage, 'Conversation and edits is turned off by your administrator.')
  const workshop = resolveModel(s, { surface: 'workshop' })
  assert.equal(workshop.enabled, false)
  assert.equal(workshop.disabledBy, 'chat')
  assert.equal(resolveModel(s, { surface: 'canvas' }).enabled, true, 'a part with its own model is not turned off by its parent')
  const off = snap({ state: { aiEnabled: false, aiDisabledMessage: 'Maintenance until noon.' }, bindings: [bind('shape', 'model', 'deepinfra:google/gemini-3.5-flash')] })
  for (const surface of ['shape', 'chat', 'images']) {
    assert.equal(resolveModel(off, { surface }).enabled, false, surface)
    assert.equal(resolveModel(off, { surface }).disabledMessage, 'Maintenance until noon.')
  }
})

test('generated pictures use the built-in Stability service while nothing is set for them (Ember cannot draw)', () => {
  const s = snap({ bindings: [bind('default', 'model', 'meta:muse-ember-1.0')] })
  const images = resolveModel(s, { surface: 'image-generation' })
  assert.equal(images.source, 'stability')
  assert.equal(images.route, STABILITY_ROUTE)
  assert.equal(resolveModel(s, { surface: 'image-search' }).builtinOnly, true)
})

test('a binding whose model or provider is gone resolves to a plain error, never to another model', () => {
  const s = buildSnapshot({ providers: [meta], models: [model('meta', 'muse-ember-1.0')], bindings: [bind('shape', 'model', 'meta:muse-ember-1.0')] })
  const gone = { ...s, models: {} }
  assert.match(resolveModel(gone, { surface: 'shape' }).route.error, /no longer in Admin → AI control/)
  const archived = { ...s, providers: { meta: { ...s.providers.meta, status: 'archived' } } }
  assert.match(resolveModel(archived, { surface: 'shape' }).route.error, /provider .* no longer/)
})

test('the route says which key the provider has (a fingerprint), never the key; the code keeps its own limits', () => {
  const s = snap({ keys: { meta: { id: 'k1', keyFingerprint: 'sha256:abcd1234…WXYZ' } } })
  assert.equal(resolveModel(s, { surface: 'chat' }).route.keyFingerprint, 'sha256:abcd1234…WXYZ')
  assert.deepEqual(CODE_LIMITS, { timeoutMs: 90000, infraRetries: 2, shapeRetries: 3 })
  assert.equal(resolveModel(s, { surface: 'chat' }).route.toolChoice, 'auto', 'Meta takes auto')
  assert.equal(resolveModel(snap({ bindings: [bind('shape', 'model', 'deepinfra:google/gemini-3.5-flash')] }), { surface: 'shape' }).route.toolChoice, 'named', 'DeepInfra takes a named tool')
})

// Restated 2026-11-26 (owner: own keys on Cloud too): Cloud used to skip a person's own AI; it now
// ranks it as a self-hosted server does, and an administrator's off still wins there.
test('a person\'s own AI comes first on a self-hosted server and on Cloud, and never before a part turned off', async () => {
  const selfHost = await aiControlWorld({ settings: { public: { env: 'selfhost' } }, hosted: false })
  await selfHost.catalog.addProvider({ actor: selfHost.actor, input: { preset: 'meta' }, models: ['muse-ember-1.0'] })
  await selfHost.keyStore.add({ actor: selfHost.actor, provider: 'meta', apiKey: 'sk-test-meta-server-000000000000' })
  await selfHost.choices.insertOne({ _id: 'user:ana', use: { chat: 'me:desk' } })
  await selfHost.keys.insertOne({ _id: 'own1', ownerType: 'user', ownerId: 'ana', name: 'desk', provider: 'openai-compatible', baseUrl: 'https://desk.example.org/v1', model: 'local-model', capabilities: { tools: true }, cipher: null, last4: '' })
  const own = await selfHost.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.equal(own.ref, 'me:desk')
  assert.equal(own.own, true)
  assert.equal((await selfHost.aiSettings.resolveFor({ userId: 'ana', feature: 'shape' })).scope, 'server', 'a part she did not choose is the server\'s')
  const viewed = await selfHost.control.effective({ surface: 'chat', userId: 'ana' })
  assert.equal(viewed.surfaces[0].resolved.own.ref, 'me:desk')
  await selfHost.bindings.set({ actor: selfHost.actor, changes: [{ surface: 'chat', use: 'off' }] })
  assert.equal((await selfHost.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })).disabled, true, 'an administrator\'s off wins over her own AI')

  const cloud = await aiControlWorld({ settings: { public: { env: 'prod' } }, hosted: true })
  await cloud.choices.insertOne({ _id: 'user:ana', use: { chat: 'me:desk' } })
  await cloud.keys.insertOne({ _id: 'own1', ownerType: 'user', ownerId: 'ana', name: 'desk', provider: 'openai-compatible', baseUrl: 'https://desk.example.org/v1', model: 'local-model', cipher: null, last4: '' })
  const onCloud = await cloud.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.equal(onCloud.ref, 'me:desk', 'her own AI comes first on Cloud too')
  assert.equal(onCloud.own, true)
  assert.equal(onCloud.rules.publicOnly, true, 'on Cloud an own connection is held to public addresses')
  await cloud.bindings.set({ actor: cloud.actor, changes: [{ surface: 'chat', use: 'off' }] })
  assert.equal((await cloud.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })).disabled, true, 'an administrator\'s off wins over her own AI on Cloud')
})

test('the eval judge part: bound, it answers with its own model; unset, the default; never a person\'s choice', () => {
  const bound = resolveModel(snap({ bindings: [bind('eval', 'model', 'deepinfra:google/gemini-3.5-flash')] }), { surface: 'eval' })
  assert.equal(bound.source, 'part')
  assert.equal(bound.route.model, 'google/gemini-3.5-flash')
  assert.equal(resolveModel(snap({ bindings: [bind('eval', 'model', 'deepinfra:google/gemini-3.5-flash')] }), { surface: 'workshop.draft' }).route.model, 'muse-ember-1.0', 'drafting is untouched')
  assert.equal(resolveModel(snap(), { surface: 'eval' }).source, 'builtin')
  assert.equal(resolveModel(snap({ bindings: [bind('default', 'model', 'meta:muse-spark-1.3')] }), { surface: 'eval' }).route.model, 'muse-spark-1.3')
})
