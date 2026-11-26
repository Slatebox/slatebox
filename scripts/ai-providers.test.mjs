// Providers are named presets: what the provider IS ("Meta (Muse)" at https://api.meta.ai/v1),
// never "OpenAI-compatible endpoint". The wire protocol is an internal detail. Only "Other
// (OpenAI-compatible)" takes an address of its own, checked by the endpoint rules; a new address
// revokes the provider's keys. Models per provider with prices; a Test with the active key. The
// real req() sends the stored key, the provider's tool choice, and falls back once to the default
// model after a failing service. Fake keys throughout.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { PRESET_IDS, PROTOCOL_TEXT, PROVIDER_PRESETS, presetForUrl, providerFromPreset } from '../web/app/server/ai-control/provider-presets.mjs'
import { BUILTIN_PROVIDERS, chatConnectionTypes, normalizeProvider } from '../web/app/server/ai-control/providers.mjs'
import { authFor, connectionRequest } from '../web/app/server/methods/ai/connection-request.mjs'
import { connectionType, setProviderSource } from '../web/app/server/methods/ai/connections.mjs'
import { checkEndpointUrl, endpointRules } from '../web/app/server/methods/ai/endpoint-policy.mjs'
import { aiControlWorld, asAgent, asPerson, bodyOf, registryFor } from './ai-control-kit.mjs'
import { dbPriceFor } from '../web/app/server/ai-control/models.mjs'
import { aiCostMicros, setDbPriceSource } from '../web/app/server/metering/prices.mjs'

const PRESETS = {
  meta: ['Meta (Muse)', 'https://api.meta.ai/v1', 'openai-chat', 'auto'],
  openai: ['OpenAI', 'https://api.openai.com/v1', 'openai-chat', 'named'],
  anthropic: ['Anthropic', 'https://api.anthropic.com/v1', 'anthropic-messages', 'named'],
  deepinfra: ['DeepInfra', 'https://api.deepinfra.com/v1/openai', 'openai-chat', 'named'],
  together: ['Together AI', 'https://api.together.xyz/v1', 'openai-chat', 'auto'],
  groq: ['Groq', 'https://api.groq.com/openai/v1', 'openai-chat', 'auto'],
  fireworks: ['Fireworks AI', 'https://api.fireworks.ai/inference/v1', 'openai-chat', 'auto'],
  openrouter: ['OpenRouter', 'https://openrouter.ai/api/v1', 'openai-chat', 'auto'],
  mistral: ['Mistral', 'https://api.mistral.ai/v1', 'openai-chat', 'auto'],
  xai: ['xAI (Grok)', 'https://api.x.ai/v1', 'openai-chat', 'auto'],
  gemini: ['Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'openai-chat', 'auto'],
  // voice (2026-11-26): the realtime providers the relay holds the socket to
  'openai-realtime': ['OpenAI Realtime (voice)', 'wss://api.openai.com/v1/realtime', 'openai-realtime', 'auto'],
  'gemini-live': ['Google Gemini Live (voice)', 'wss://generativelanguage.googleapis.com', 'gemini-live', 'auto'],
  other: ['Other (OpenAI-compatible)', null, 'openai-chat', 'auto'],
}

test('the presets: every named provider with its fixed address, protocol and tool choice', () => {
  assert.deepEqual(PRESET_IDS, Object.keys(PRESETS))
  for (const [id, [label, baseUrl, protocol, toolChoice]] of Object.entries(PRESETS)) {
    const p = PROVIDER_PRESETS[id]
    assert.deepEqual([p.label, p.baseUrl, p.protocol, p.toolChoice], [label, baseUrl, protocol, toolChoice], id)
    assert.equal(p.baseUrlLocked, id !== 'other', id)
  }
  assert.equal(PROVIDER_PRESETS.anthropic.auth.name, 'x-api-key')
  assert.deepEqual(PROVIDER_PRESETS.meta.models.map((m) => [m.model, m.prices.inputPerM, m.prices.outputPerM]), [['muse-ember-1.0', 0.3, 1.5], ['muse-spark-1.3', 1.25, 4.25]])
  assert.equal(PROTOCOL_TEXT['openai-chat'], 'speaks the OpenAI API')
  assert.equal(presetForUrl('https://api.meta.ai/v1/').id, 'meta')
  assert.equal(presetForUrl('https://example.org/v1'), null)
  assert.ok(!Object.values(PROVIDER_PRESETS).some((p) => /OpenAI-compatible endpoint/.test(p.label)), 'no provider is called "OpenAI-compatible endpoint"')
})

test('a named preset keeps its own address, protocol and key style whatever the input says; Other takes an address', () => {
  const meta = normalizeProvider({ preset: 'meta', baseUrl: 'https://evil.example/v1', protocol: 'anthropic-messages', auth: { style: 'none' } })
  assert.deepEqual([meta._id, meta.label, meta.baseUrl, meta.protocol, meta.auth.style], ['meta', 'Meta (Muse)', 'https://api.meta.ai/v1', 'openai-chat', 'bearer'])
  assert.throws(() => normalizeProvider({ preset: 'other', id: 'local' }), /address up to \/v1/)
  const other = normalizeProvider({ preset: 'other', id: 'local', label: 'Our models', baseUrl: 'https://models.example.org/v1', auth: { style: 'header', name: 'x-api-key' }, extraHeaders: { 'x-client': 'slatebox' } })
  assert.deepEqual([other.baseUrl, other.auth, other.extraHeaders], ['https://models.example.org/v1', { style: 'header', name: 'x-api-key' }, { 'x-client': 'slatebox' }])
  assert.throws(() => normalizeProvider({ preset: 'other', id: 'local', baseUrl: 'https://x.example/v1', extraHeaders: { 'x-api-token': 'a' } }), /credential/)
  assert.throws(() => normalizeProvider({ preset: 'nope' }), /preset is one of/)
  assert.throws(() => normalizeProvider({ preset: 'other', id: 'stability', baseUrl: 'https://x.example/v1' }), /service of this server/)
  // Other's address goes through the endpoint rules of the server's own configuration
  const rules = endpointRules({ hosted: true, level: 'server' })
  assert.throws(() => normalizeProvider({ preset: 'other', id: 'meta-data', baseUrl: 'http://169.254.169.254/v1' }, { checkUrl: (url) => checkEndpointUrl(url, rules) }))
})

test('a stored provider is a connection type at once; its tool choice and key style go on the wire', () => {
  setProviderSource(() => ({ local: { ...providerFromPreset('other', { id: 'local', baseUrl: 'https://models.example.org/v1' }), auth: { style: 'header', name: 'x-api-key' } } }))
  assert.equal(connectionType('local').label, 'Other (OpenAI-compatible)')
  assert.equal(connectionType('meta').baseUrl, 'https://api.meta.ai/v1', 'every named preset is a type')
  assert.equal(connectionType('openai-compatible').label, 'Other (OpenAI-compatible)', 'people connect their own endpoint under this type')
  const wire = connectionRequest({ type: 'local', baseUrl: 'https://models.example.org/v1', model: 'm', apiKey: 'sk-test-local-1234' })
  assert.equal(wire.headers['x-api-key'], 'sk-test-local-1234')
  assert.equal(wire.apiKey, undefined, 'not as a bearer key')
  assert.equal(connectionRequest({ type: 'deepinfra', baseUrl: 'https://api.deepinfra.com/v1/openai', model: 'm', apiKey: 'k' }).toolChoice, 'named')
  assert.equal(connectionRequest({ type: 'meta', baseUrl: 'https://api.meta.ai/v1', model: 'muse-ember-1.0', apiKey: 'k' }).toolChoice, 'auto')
  assert.equal(authFor({ type: 'anthropic', apiKey: 'sk-ant-test-1' }).headers['x-api-key'], 'sk-ant-test-1', 'Anthropic takes x-api-key')
  assert.deepEqual(Object.keys(chatConnectionTypes({})).filter((id) => BUILTIN_PROVIDERS[id]), [], 'the services are not model types')
  setProviderSource(null)
})

test('add a provider from its preset with its suggested models and prices; rename it; Other\'s new address revokes its keys only after revokeKeys', async () => {
  const w = await aiControlWorld()
  const added = await w.catalog.addProvider({ actor: w.actor, input: { preset: 'meta' }, models: ['muse-ember-1.0'] })
  assert.equal(added.provider.label, 'Meta (Muse)')
  assert.equal(added.provider.baseUrl, 'https://api.meta.ai/v1')
  assert.equal(w.snapshot().models['meta:muse-ember-1.0'].prices.outputPerM, 1.5)
  await assert.rejects(w.catalog.addProvider({ actor: w.actor, input: { preset: 'meta' } }), /already a provider meta/)
  await w.catalog.saveProvider({ actor: w.actor, input: { id: 'meta', label: 'Meta Muse' } })
  assert.equal(w.snapshot().providers.meta.label, 'Meta Muse')
  assert.equal(w.snapshot().providers.meta.baseUrl, 'https://api.meta.ai/v1', 'a named preset never takes another address')

  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'other', id: 'local', label: 'Our models', baseUrl: 'https://models.example.org/v1' } })
  const key = await w.keyStore.add({ actor: w.actor, provider: 'local', apiKey: 'sk-test-local-000000000000000001' })
  await assert.rejects(w.catalog.saveProvider({ actor: w.actor, input: { id: 'local', baseUrl: 'https://elsewhere.example.org/v1' } }), (error) => error.status === 409 && /never sent to a new address/.test(error.message))
  const moved = await w.catalog.saveProvider({ actor: w.actor, input: { id: 'local', baseUrl: 'https://elsewhere.example.org/v1' }, revokeKeys: true, reason: 'moved host' })
  assert.deepEqual(moved.revokedKeys, [key.id])
  assert.equal(w.keys.rows.find((row) => row._id === key.id).status, 'revoked')
})

test('models: add, edit price, remove (refused while a part uses it), Find models and Test with the active key; archive waits until nothing uses the provider', async () => {
  const seen = []
  const w = await aiControlWorld({
    check: async (connection) => { seen.push(['check', connection.model, connection.apiKey]); return { ok: true, tools: 'yes', message: 'Connected.' } },
    listModels: async (connection) => { seen.push(['list', connection.baseUrl, connection.apiKey]); return { ok: true, models: [{ id: 'muse-ember-1.0' }], message: '1 model listed.' } },
  })
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'deepinfra' } })
  await w.catalog.saveModels({ actor: w.actor, models: [{ provider: 'deepinfra', model: 'google/gemini-3.5-flash', label: 'Gemini Flash', capabilities: { tools: true }, prices: { inputPerM: 1.5, outputPerM: 9 } }] })
  await assert.rejects(w.catalog.saveModels({ actor: w.actor, models: [{ provider: 'nope', model: 'x' }] }), /no provider nope/)
  await assert.rejects(w.catalog.saveModels({ actor: w.actor, models: [{ provider: 'deepinfra', model: 'x', prices: { inputPerM: 1 } }] }), /both the input and output price/)
  await assert.rejects(w.catalog.discoverModels({ provider: 'deepinfra' }), /has no active key/)
  await w.keyStore.add({ actor: w.actor, provider: 'deepinfra', apiKey: 'test-deepinfra-000000000000000009' })
  assert.equal((await w.catalog.discoverModels({ provider: 'deepinfra' })).ok, true)
  assert.equal((await w.catalog.testModel({ id: 'deepinfra:google/gemini-3.5-flash' })).ok, true)
  assert.deepEqual(seen, [['list', 'https://api.deepinfra.com/v1/openai', 'test-deepinfra-000000000000000009'], ['check', 'google/gemini-3.5-flash', 'test-deepinfra-000000000000000009']])
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'shape', use: 'model', model: 'deepinfra:google/gemini-3.5-flash' }] })
  await assert.rejects(w.catalog.removeModel({ actor: w.actor, id: 'deepinfra:google/gemini-3.5-flash', reason: 'x' }), /still use Gemini Flash: shape/)
  await assert.rejects(w.catalog.archiveProvider({ actor: w.actor, id: 'deepinfra', reason: 'x' }), /still use DeepInfra: shape/)
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'shape', use: 'default' }] })
  await w.catalog.removeModel({ actor: w.actor, id: 'deepinfra:google/gemini-3.5-flash', reason: 'not needed' })
  await w.catalog.archiveProvider({ actor: w.actor, id: 'deepinfra', reason: 'not used' })
  assert.equal(w.snapshot().providers.deepinfra, undefined)
})

test('an administrator\'s price applies to the provider that served the call', async () => {
  const w = await aiControlWorld()
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'meta' } })
  await w.catalog.saveModels({ actor: w.actor, models: [{ provider: 'meta', model: 'muse-ember-1.0', prices: { inputPerM: 2, outputPerM: 4 } }] })
  assert.deepEqual(dbPriceFor(w.snapshot(), 'muse-ember-1.0', { provider: 'meta' }), { inPerMillion: 2, outPerMillion: 4, id: 'meta:muse-ember-1.0' })
  assert.equal(dbPriceFor(w.snapshot(), 'muse-ember-1.0', { provider: 'deepinfra' }), null)
  setDbPriceSource((model, where) => dbPriceFor(w.snapshot(), model, where))
  const usage = { inputTokens: 1_000_000, outputTokens: 0 }
  assert.equal(aiCostMicros({ model: 'muse-ember-1.0', usage, connection: 'server:meta', provider: 'connection' }).costMicros, 2_000_000)
  assert.equal(aiCostMicros({ model: 'muse-ember-1.0', usage, connection: 'me:desk', provider: 'connection' }).costMicros, 300_000, 'a person\'s own connection is priced from the table')
  setDbPriceSource(null)
})

test('the provider and model actions: administrators only; an agent adds a named preset but not an Other address; archive and model remove are a person\'s', async () => {
  const w = await aiControlWorld()
  const registry = await registryFor(w)
  const added = bodyOf(await registry.run(asAgent(), 'ai.providers.add', { provider: { preset: 'meta' }, models: ['muse-ember-1.0'] }))
  assert.equal(added.provider.label, 'Meta (Muse)')
  await assert.rejects(registry.run(asAgent(), 'ai.providers.add', { provider: { preset: 'other', id: 'x', baseUrl: 'https://x.example.org/v1' } }), (error) => error.status === 403 && /Only a person/.test(error.message))
  await assert.rejects(registry.run(asPerson('ana'), 'ai.providers.add', { provider: { preset: 'openai' } }), { status: 403 })
  assert.deepEqual(registry.get('ai.providers.archive').principals, ['person'])
  assert.deepEqual(registry.get('ai.models.remove').principals, ['person'])
  assert.equal(registry.get('ai.models.save').input.properties.models.items.properties.connection, undefined, 'models are named by provider, not connection')
  assert.ok(w.raw.audit.rows.some((row) => row.action === 'ai.providers.add' && row.actor.principal === 'agent'))
})

test('the real req(): the stored key as a Bearer, the provider\'s named tool choice, audit rows naming part, route and model, one fallback to the default after a failing service, never for own AI, no redirects', () => {
  const out = JSON.parse(execFileSync(process.execPath, ['--no-deprecation', new URL('./ai-req-route.mjs', import.meta.url).pathname], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).replace(/^[^{]*\n(?=\{)/s, ''))
  const { KEY, DEFAULT_KEY } = out.keys
  assert.equal(out.stored.seen[0].authorization, `Bearer ${KEY}`)
  assert.deepEqual(out.stored.seen[0].toolChoice, { type: 'function', function: { name: 'propose_shapes' } })
  assert.deepEqual(out.stored.audits, [{ surface: 'shape', connection: 'server:stub', attempt: 0, modelId: 'stub:gemini-3.5-flash', model: 'gemini-3.5-flash', status: 'success' }])
  assert.equal(out.stored.result.abort, false)
  assert.deepEqual(out.fallback.audits.map((a) => [a.connection, a.attempt, a.status]), [['server:busy', 0, 'provider_error'], ['server:stub', 1, 'success']])
  assert.equal(out.fallback.seen[1].authorization, `Bearer ${DEFAULT_KEY}`)
  assert.equal(out.fallback.result.fallbackFrom.model, 'busy-model')
  assert.deepEqual(out.ownNoFallback.asked, ['part'], 'a person\'s own connection is never sent elsewhere')
  assert.equal(out.ownNoFallback.result.abort, true)
  assert.equal(out.sameModelNoFallback.seen.length, 1, 'no second try on the same model')
  assert.match(out.noKey.result.abortMessage, /has no active key/)
  assert.equal(out.noKey.seen.length, 0, 'nothing is sent without a key')
  assert.equal(out.redirect.other.length, 0, 'a redirect is never followed: the key never reaches the other host')
})
