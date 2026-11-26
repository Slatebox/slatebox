// Voice in AI control: the realtime presets, model rows with their voices and audio prices, one
// binding (voice) for every voice part with each part bindable on its own, a voice per binding, and
// the rule both ways: a voice part takes only a model that talks, and a model that talks answers
// nothing else. A person's or team's own voice connection serves the voice parts first; a text
// choice (theirs or the server's default) never reaches them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { aiControlWorld } from './ai-control-kit.mjs'
import { SURFACES, VOICE_SURFACES, followChain, isVoiceSurface, rootSurface, surface } from '../web/app/server/ai-control/catalogue.mjs'
import { normalizeModel } from '../web/app/server/ai-control/models.mjs'
import { resolveModel } from '../web/app/server/ai-control/resolve.mjs'
import { buildSnapshot, capabilityGap } from '../web/app/server/ai-control/snapshot.mjs'
import { PROVIDER_PRESETS } from '../web/app/server/ai-control/provider-presets.mjs'
import { chatConnectionTypes, isRealtimeProtocol } from '../web/app/server/ai-control/providers.mjs'
import { checkUse, resolveAIChoice, capabilityGap as connectionGap } from '../web/app/server/methods/ai/connections.mjs'
import { VOICE_PRICES, voiceCostMicros, voicePrice } from '../web/app/server/metering/prices.mjs'
import { readFileSync } from 'node:fs'
import { validate } from '../web/app/server/actions/schema.mjs'
import { modelInput } from '../web/app/server/actions/ai-control-schemas.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'

async function world() {
  const w = await aiControlWorld()
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'meta' }, models: ['muse-ember-1.0'] })
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'openai-realtime' }, models: ['gpt-realtime-2.1', 'gpt-realtime-2.1-mini'] })
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'gemini-live' }, models: ['gemini-3.8-live'] })
  await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: 'sk-test-meta-0000000000000000000001' })
  await w.keyStore.add({ actor: w.actor, provider: 'gemini-live', apiKey: 'AIza-test-live-00000000000000000000' })
  return w
}

test('the catalogue: a voice root that follows default, voice.chat and voice.interview under it, needing voice only', () => {
  assert.deepEqual(VOICE_SURFACES, ['voice.chat', 'voice.interview'])
  assert.deepEqual(followChain('voice.chat'), ['voice.chat', 'voice', 'default'])
  assert.deepEqual(followChain('voice.interview'), ['voice.interview', 'voice', 'default'])
  for (const id of ['voice', ...VOICE_SURFACES]) {
    assert.deepEqual([...surface(id).needs], ['voice'], id)
    assert.equal(rootSurface(id), 'voice', id)
    assert.ok(surface(id).requestFeatures.length && surface(id).meterFeatures.length, id)
  }
  assert.deepEqual(SURFACES.filter((s) => isVoiceSurface(s.id)).map((s) => s.id), ['voice', 'voice.chat', 'voice.interview'])
  // the copy says agent, not AI
  for (const id of ['voice', ...VOICE_SURFACES]) assert.doesNotMatch(surface(id).title, /\bAI\b/, id)
})

test('the realtime presets: fixed wss addresses, their protocols, keys in headers, suggested models with voices and audio prices', () => {
  const oa = PROVIDER_PRESETS['openai-realtime']
  const gl = PROVIDER_PRESETS['gemini-live']
  assert.deepEqual([oa.protocol, gl.protocol], ['openai-realtime', 'gemini-live'])
  assert.ok(isRealtimeProtocol(oa.protocol) && isRealtimeProtocol(gl.protocol) && !isRealtimeProtocol('openai-chat'))
  assert.deepEqual(gl.auth, { style: 'header', name: 'x-goog-api-key' })
  for (const m of [...oa.models, ...gl.models]) {
    assert.equal(m.capabilities.voice, true, m.model)
    assert.ok(m.voices.length > 3, m.model)
    const row = VOICE_PRICES.find((p) => p.model === m.model)
    assert.deepEqual([m.prices.audioInputPerM, m.prices.audioOutputPerM, m.prices.inputPerM, m.prices.outputPerM], [row.audioInPerMillion, row.audioOutPerMillion, row.textInPerMillion, row.textOutPerMillion], m.model)
  }
  // people's and teams' own connections may name them too
  const types = chatConnectionTypes({})
  assert.equal(types['openai-realtime'].protocol, 'openai-realtime')
  assert.equal(types['gemini-live'].keyRequired, true)
})

test('a model row: a realtime provider\'s models talk, with a checked voices list and audio prices; no other model does', () => {
  const providers = { live: { _id: 'live', protocol: 'gemini-live', status: 'active' }, meta: { _id: 'meta', protocol: 'openai-chat', status: 'active' } }
  const row = normalizeModel({ provider: 'live', model: 'gemini-3.8-live', voices: ['Kore', 'Puck'], prices: { inputPerM: 0.75, outputPerM: 4.5, audioInputPerM: 3, audioOutputPerM: 12 } }, { providers })
  assert.equal(row.capabilities.voice, true)
  assert.deepEqual(row.voices, ['Kore', 'Puck'])
  assert.deepEqual(row.prices, { inputPerM: 0.75, outputPerM: 4.5, imageEach: null, currency: 'USD', audioInputPerM: 3, audioOutputPerM: 12 })
  assert.throws(() => normalizeModel({ provider: 'live', model: 'm', voices: ['Kore', 'Kore'] }, { providers }), /listed twice/)
  assert.throws(() => normalizeModel({ provider: 'live', model: 'm', voices: ['bad voice!'] }, { providers }), /not a voice name/)
  assert.throws(() => normalizeModel({ provider: 'live', model: 'm', voices: new Array(65).fill(0).map((_, i) => `v${i}`) }, { providers }), /at most 64/)
  assert.throws(() => normalizeModel({ provider: 'live', model: 'm', prices: { audioInputPerM: 3 } }, { providers }), /both the audio input and audio output/)
  assert.throws(() => normalizeModel({ provider: 'meta', model: 'm', voices: ['Kore'] }, { providers }), /Only a voice provider/)
  assert.throws(() => normalizeModel({ provider: 'meta', model: 'm', capabilities: { voice: true } }, { providers }), /Only a voice provider/)
  assert.throws(() => normalizeModel({ provider: 'meta', model: 'm', prices: { inputPerM: 1, outputPerM: 1, audioInputPerM: 3, audioOutputPerM: 3 } }, { providers }), /Only a voice provider/)
  assert.throws(() => normalizeModel({ provider: 'meta', model: 'm', transcriptionModel: 't' }, { providers }), /Only a voice provider/)
  assert.equal(normalizeModel({ provider: 'meta', model: 'm' }, { providers }).voices, undefined)
})

test('a voice part takes only a model that talks; a text part (and the default) never takes one', () => {
  const talks = { capabilities: { voice: true, tools: true } }
  const text = { capabilities: { tools: true } }
  assert.equal(capabilityGap('voice.chat', talks), null)
  assert.equal(capabilityGap('voice.chat', text), 'voice')
  assert.equal(capabilityGap('chat', talks), 'text')
  assert.equal(capabilityGap('default', talks), 'text')
  assert.equal(capabilityGap('chat', text), null)
})

test('one binding covers every voice part, each can be bound on its own, with a voice the model offers; nothing falls to a text model', async () => {
  const w = await world()
  // nothing bound: the voice parts have no server model (never Ember, the default)
  for (const id of ['voice', ...VOICE_SURFACES]) assert.deepEqual([resolveModel(w.snapshot(), { surface: id }).source, resolveModel(w.snapshot(), { surface: id }).route], ['unset', null], id)
  const unset = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'voice-chat' })
  assert.equal(unset.connection, null)
  assert.match(unset.error, /No model is set/)
  await assert.rejects(w.bindings.set({ actor: w.actor, changes: [{ surface: 'voice', use: 'model', model: 'meta:muse-ember-1.0' }] }), /cannot talk in real time/)
  await assert.rejects(w.bindings.set({ actor: w.actor, changes: [{ surface: 'default', use: 'model', model: 'gemini-live:gemini-3.8-live' }] }), /cannot answer in text/)
  await assert.rejects(w.bindings.set({ actor: w.actor, changes: [{ surface: 'chat', use: 'model', model: 'gemini-live:gemini-3.8-live' }] }), /cannot answer in text/)
  await assert.rejects(w.bindings.set({ actor: w.actor, changes: [{ surface: 'voice', use: 'model', model: 'gemini-live:gemini-3.8-live', voice: 'marin' }] }), /has no voice marin/)
  await assert.rejects(w.bindings.set({ actor: w.actor, changes: [{ surface: 'chat', use: 'off', voice: 'Kore' }] }), /takes a voice/)
  const out = await w.bindings.set({ actor: w.actor, changes: [{ surface: 'voice', use: 'model', model: 'gemini-live:gemini-3.8-live', voice: 'Kore' }] })
  assert.deepEqual(out.changed, ['voice'])
  // the root covers both parts, with its voice and the provider's key
  for (const feature of ['voice-chat', 'voice-interview']) {
    const choice = await w.aiSettings.resolveFor({ userId: 'ana', feature, forRequest: true })
    assert.equal(choice.connection.model, 'gemini-3.8-live', feature)
    assert.equal(choice.connection.voice, 'Kore', feature)
    assert.equal(choice.connection.protocol, 'gemini-live', feature)
    assert.equal(choice.connection.apiKey, 'AIza-test-live-00000000000000000000', feature)
    assert.equal(choice.gap, undefined, feature)
  }
  // a part bound on its own wins; the voice change alone is a change
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'voice.interview', use: 'model', model: 'openai-realtime:gpt-realtime-2.1-mini', voice: 'marin' }] })
  const interview = resolveModel(w.snapshot(), { surface: 'voice.interview' })
  assert.deepEqual([interview.source, interview.route.model, interview.route.voice, interview.route.transcriptionModel], ['part', 'gpt-realtime-2.1-mini', 'marin', 'gpt-realtime-whisper'])
  assert.deepEqual((await w.bindings.set({ actor: w.actor, changes: [{ surface: 'voice', use: 'model', model: 'gemini-live:gemini-3.8-live', voice: 'Puck' }] })).changed, ['voice'])
  assert.equal(resolveModel(w.snapshot(), { surface: 'voice.chat' }).route.voice, 'Puck')
  assert.equal(w.bindings.list().surfaces.find((s) => s.surface === 'voice').binding.voice, 'Puck')
  // the text parts are untouched
  assert.equal(resolveModel(w.snapshot(), { surface: 'chat' }).route.model, 'muse-ember-1.0')
  // an administrator's off switch for the root turns every voice part off, whatever anyone chose
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'voice', use: 'off' }, { surface: 'voice.interview', use: 'default' }] })
  assert.equal((await w.aiSettings.resolveFor({ userId: 'ana', feature: 'voice-interview' })).disabled, true)
})

test('a stored binding with a voice its model does not offer is skipped, named in health', () => {
  const snap = buildSnapshot({
    providers: [{ _id: 'gemini-live', preset: 'gemini-live', label: 'Live', baseUrl: 'wss://generativelanguage.googleapis.com', protocol: 'gemini-live', auth: { style: 'header', name: 'x-goog-api-key' }, toolChoice: 'auto', extraHeaders: {}, status: 'active' }],
    models: [{ _id: 'gemini-live:m', provider: 'gemini-live', model: 'm', capabilities: { voice: true }, voices: ['Kore'], status: 'enabled' }],
    bindings: [{ _id: 'voice', surface: 'voice', use: 'model', model: 'gemini-live:m', voice: 'marin' }, { _id: 'voice.chat', surface: 'voice.chat', use: 'model', model: 'gemini-live:m', voice: 'Kore' }],
  })
  assert.equal(snap.bindings.voice, undefined)
  assert.match(snap.health.find((h) => h.id === 'voice').problem, /no voice marin/)
  assert.equal(snap.bindings['voice.chat'].voice, 'Kore')
})

test('own connections: a voice connection serves only the voice parts, a text one never does; a text default never reaches voice', () => {
  const connections = [
    { name: 'my-voice', type: 'openai-realtime', baseUrl: 'wss://api.openai.com/v1/realtime', model: 'gpt-realtime-2.1', capabilities: {} },
    { name: 'my-text', type: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', model: 'm', capabilities: {} },
  ]
  const pick = (use, feature) => resolveAIChoice({ feature, person: { connections, use }, ownProviders: true })
  assert.equal(pick({ voice: 'me:my-voice' }, 'voice.chat').ref, 'me:my-voice')
  assert.equal(pick({ voice: 'me:my-voice' }, 'voice.interview').ref, 'me:my-voice')
  assert.equal(pick({ default: 'me:my-text' }, 'voice.chat').ref, 'builtin', 'a default text connection never talks')
  assert.equal(pick({ default: 'me:my-text' }, 'chat').ref, 'me:my-text')
  // legacy keys (a DeepInfra key for every feature) never reach voice
  const legacy = [{ name: 'deepinfra', type: 'deepinfra', model: 'x', capabilities: {}, legacy: 'all' }]
  assert.equal(resolveAIChoice({ feature: 'voice.chat', person: { connections: legacy, use: {} } }).ref, 'builtin')
  // a choice is refused at save time when it would never work
  const visible = { me: connections, team: [] }
  assert.deepEqual(checkUse({ voice: 'me:my-voice', chat: 'me:my-text' }, 'me', visible), { voice: 'me:my-voice', chat: 'me:my-text' })
  assert.throws(() => checkUse({ chat: 'me:my-voice' }, 'me', visible), /is a voice model/)
  assert.throws(() => checkUse({ 'voice.chat': 'me:my-text' }, 'me', visible), /cannot talk/)
  // and a request that reached the wrong kind anyway says so
  assert.equal(connectionGap({ feature: 'chat', connection: connections[0] }).need, 'text')
  assert.equal(connectionGap({ feature: 'voice.chat', connection: connections[1] }).need, 'voice')
  assert.equal(connectionGap({ feature: 'voice.chat', connection: connections[0] }), null)
})

test('voice prices: the model row\'s audio prices win, else the table, else the dearest voice row; per modality', () => {
  assert.equal(voicePrice('gemini-3.8-live').audioInPerMillion, 3)
  assert.equal(voicePrice('nobody-knows').model, 'gpt-realtime-2.1', 'unknown: the dearest voice row')
  const own = voicePrice('gemini-3.8-live', { audioInputPerM: 1, audioOutputPerM: 2, inputPerM: 0.5, outputPerM: 0.5 })
  assert.deepEqual([own.audioInPerMillion, own.audioOutPerMillion, own.textInPerMillion, own.source], [1, 2, 0.5, 'db'])
  // a minute of gpt-realtime-2.1: 600 tokens of the person (10/s), 1,200 of the agent (20/s), 1,000 of text
  assert.equal(voiceCostMicros({ audioIn: 600, audioOut: 1200, textIn: 1000 }, voicePrice('gpt-realtime-2.1')), 100_000)
  // cached audio at its own rate
  assert.equal(voiceCostMicros({ cachedAudioIn: 1_000_000 }, voicePrice('gpt-realtime-2.1')), 400_000)
  assert.equal(voiceCostMicros({ audioIn: -5, audioOut: 'x' }, voicePrice('gemini-3.8-live')), 0)
})

test('no model, provider default or voice name is chosen in the voice code: the binding (or the person) decides', () => {
  for (const path of ['session.mjs', 'open.mjs', 'config.mjs', 'meter.mjs', 'relay.mjs', 'tickets.mjs', 'meteor.js', 'adapters/gemini.mjs', 'adapters/openai.mjs']) {
    const source = readFileSync(new URL(`../web/app/server/voice/${path}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /gpt-realtime|gemini-3|gemini-2|whisper|\b(Kore|Puck|marin|cedar|alloy)\b/, path)
  }
})

test('the admin actions take a model\'s voices, transcription model and audio prices, and a binding\'s voice', () => {
  assert.equal(validate(modelInput, { provider: 'gemini-live', model: 'gemini-3.8-live', voices: ['Kore'], transcriptionModel: null, prices: { inputPerM: 0.75, outputPerM: 4.5, audioInputPerM: 3, audioOutputPerM: 12 } }), null)
  assert.notEqual(validate(modelInput, { provider: 'gemini-live', model: 'm', voices: ['not a voice'] }), null)
  const set = createAppRegistry().get('ai.bindings.set')
  assert.equal(validate(set.input, { changes: [{ surface: 'voice', use: 'model', model: 'gemini-live:gemini-3.8-live', voice: 'Kore' }] }), null)
  assert.notEqual(validate(set.input, { changes: [{ surface: 'voice', use: 'model', model: 'x:y', voice: '<script>' }] }), null)
})
