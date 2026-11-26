// The two realtime providers behind the one client protocol (web/app/server/voice/adapters): what
// the relay sends each (setup, audio, push to talk, typed text, tool answers, truncation) and what
// it reads from each (scripts/fixtures/voice: the documented server messages), both ways. Keys go
// in headers, never in the URL.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as gemini from '../web/app/server/voice/adapters/gemini.mjs'
import * as openai from '../web/app/server/voice/adapters/openai.mjs'
import { ADAPTERS, adapterFor } from '../web/app/server/voice/adapters/index.mjs'
import { SEND_TOOL_PARAMETERS, voiceConfig } from '../web/app/server/voice/config.mjs'
import { REALTIME_PROTOCOLS } from '../web/app/server/ai-control/providers.mjs'
import { PROVIDER_PRESETS } from '../web/app/server/ai-control/provider-presets.mjs'
import { promptText } from '../web/app/server/ai-control/prompts/index.mjs'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/voice/${name}.json`, import.meta.url), 'utf8'))
const G = fixture('gemini-live')
const O = fixture('openai-realtime')
const PCM = new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0])
const route = { model: 'voice-model', voice: 'Kore', transcriptionModel: 'transcribe-model' }

test('one adapter per realtime protocol, at each preset\'s address', () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), [...REALTIME_PROTOCOLS].sort())
  for (const protocol of REALTIME_PROTOCOLS) assert.ok(adapterFor(protocol), protocol)
  assert.equal(adapterFor('openai-chat'), null)
  assert.equal(adapterFor('__proto__'), null)
  assert.deepEqual([gemini.IN_RATE, gemini.OUT_RATE, openai.IN_RATE, openai.OUT_RATE], [16000, 24000, 24000, 24000])
  const g = gemini.connectInfo({ baseUrl: PROVIDER_PRESETS['gemini-live'].baseUrl, apiKey: 'AIza-secret', model: 'voice-model' })
  assert.equal(g.url, 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent')
  assert.deepEqual(g.headers, { 'x-goog-api-key': 'AIza-secret' })
  const o = openai.connectInfo({ baseUrl: PROVIDER_PRESETS['openai-realtime'].baseUrl, apiKey: 'sk-secret', model: 'gpt-realtime-2.1' })
  assert.equal(o.url, 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1')
  assert.deepEqual(o.headers, { Authorization: 'Bearer sk-secret' })
  for (const info of [g, o]) assert.ok(!info.url.includes('secret'), 'the key is never in the URL')
})

test('Gemini Live: setup carries the registry prompt, the voice, the one tool, compression and transcription', () => {
  const config = voiceConfig({ surface: 'voice.chat', route })
  const [{ setup }] = gemini.setup(config)
  assert.equal(setup.model, 'models/voice-model')
  assert.equal(setup.systemInstruction.parts[0].text, promptText('voice.chat.system'))
  assert.deepEqual(setup.generationConfig, { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } })
  const [declaration] = setup.tools[0].functionDeclarations
  assert.equal(declaration.name, 'send_to_slatebox')
  assert.equal(declaration.description, promptText('tool.send_to_slatebox'))
  assert.deepEqual(declaration.parameters.type, 'OBJECT')
  assert.deepEqual(declaration.parameters.properties.confirm, { type: 'STRING', enum: ['keep', 'discard'] })
  // what the arguments mean is the registry's tool.send_to_slatebox: no model-facing words in code
  for (const property of Object.values(SEND_TOOL_PARAMETERS.properties)) assert.equal(property.description, undefined)
  assert.match(promptText('tool.send_to_slatebox'), /text: [\s\S]*confirm: keep/)
  // the agent may say "One moment" while the slate's own path works; the answer is taken when it is idle
  assert.equal(declaration.behavior, 'NON_BLOCKING')
  assert.ok(!('additionalProperties' in declaration.parameters))
  assert.deepEqual([setup.realtimeInputConfig, setup.sessionResumption, setup.contextWindowCompression, setup.inputAudioTranscription, setup.outputAudioTranscription],
    [{}, {}, { slidingWindow: {} }, {}, {}])
  // no voice on the binding: the provider's own default, never one named in code
  assert.equal(gemini.setup(voiceConfig({ surface: 'voice.chat', route: { model: 'm' } }))[0].setup.generationConfig.speechConfig, undefined)
  // push to talk turns automatic detection off; resuming names the handle and does not greet again
  const ptt = gemini.setup({ ...config, mode: 'ptt' })[0].setup
  assert.deepEqual(ptt.realtimeInputConfig, { automaticActivityDetection: { disabled: true } })
  const resumed = voiceConfig({ surface: 'voice.chat', route, resume: { handle: 'handle-abc' } })
  assert.deepEqual(gemini.setup(resumed)[0].setup.sessionResumption, { handle: 'handle-abc' })
  assert.deepEqual(gemini.begin(resumed), [])
  assert.deepEqual(gemini.begin(config), [{ clientContent: { turns: [{ role: 'user', parts: [{ text: promptText('voice.chat.opening') }] }], turnComplete: true } }])
  // carrying on with no handle yet (a move before the first resumable one): what was said goes in
  // as history, as data, and waits for the person
  const noHandle = voiceConfig({ surface: 'voice.chat', route, resume: { earlier: 'Person: group these\nAgent: Keep it?' } })
  const [history] = gemini.begin(noHandle)
  assert.equal(history.clientContent.turnComplete, false)
  assert.equal(history.clientContent.turns[0].parts[0].text, promptText('voice.resume', { earlier: 'Person: group these\nAgent: Keep it?' }))
  assert.match(history.clientContent.turns[0].parts[0].text, /<data name="earlier">/)
})

test('Gemini Live: what the browser does, upstream', () => {
  assert.deepEqual(gemini.audio(PCM), { realtimeInput: { audio: { data: 'AAABAAIAAwA=', mimeType: 'audio/pcm;rate=16000' } } })
  assert.deepEqual(gemini.ptt('down'), [{ realtimeInput: { activityStart: {} } }])
  assert.deepEqual(gemini.ptt('up'), [{ realtimeInput: { activityEnd: {} } }])
  // words the relay adds mid-session go as realtime input (clientContent is only the first turn)
  assert.deepEqual(gemini.text('hello'), [{ realtimeInput: { text: 'hello' } }])
  assert.deepEqual(gemini.toolResult({ callId: 'function-call-1', name: 'send_to_slatebox', output: 'Done. Keep it?' }),
    [{ toolResponse: { functionResponses: [{ id: 'function-call-1', name: 'send_to_slatebox', response: { output: 'Done. Keep it?' }, scheduling: 'WHEN_IDLE' }] } }])
  assert.deepEqual(gemini.mode('ptt'), { reconnect: true }, 'detection is part of setup: a new connection')
  assert.deepEqual(gemini.played({ itemId: null, ms: 300 }), [])
})

test('Gemini Live: every documented server message, read', () => {
  assert.deepEqual(gemini.read(G.setupComplete), [{ type: 'ready' }])
  const [audio] = gemini.read(G.audio)
  assert.equal(audio.type, 'audio')
  assert.deepEqual([...audio.pcm], [...PCM])
  assert.deepEqual(gemini.read(G.inputTranscription), [{ type: 'transcript', role: 'user', text: 'Group these notes', final: false }])
  assert.deepEqual(gemini.read(G.outputTranscription), [{ type: 'transcript', role: 'agent', text: 'Sure, one moment.', final: false }])
  assert.deepEqual(gemini.read(G.interrupted), [{ type: 'interrupted' }])
  assert.deepEqual(gemini.read(G.turnComplete), [{ type: 'turn-done' }])
  assert.deepEqual(gemini.read(G.generationComplete), [])
  assert.deepEqual(gemini.read(G.toolCall), [{ type: 'tool-call', callId: 'function-call-1', name: 'send_to_slatebox', args: { text: 'group these notes by theme' } }])
  assert.deepEqual(gemini.read(G.toolCallCancellation), [{ type: 'tool-cancel', callIds: ['function-call-1'] }])
  assert.deepEqual(gemini.read(G.goAway), [{ type: 'go-away', timeLeftMs: 10000 }])
  assert.deepEqual(gemini.read(G.sessionResumptionUpdate), [{ type: 'resume-handle', handle: 'handle-abc' }])
  assert.deepEqual(gemini.read(G.sessionResumptionNotResumable), [])
  // usage by modality: audio in 500, text in 700 + 30 tool prompt, audio out 380, text out 20 + 20 thoughts
  assert.deepEqual(gemini.read(G.usageMetadata), [{ type: 'usage', usage: { audioIn: 500, audioOut: 380, textIn: 730, textOut: 40, cachedAudioIn: 0 } }])
  assert.deepEqual(gemini.read(null), [])
})

test('OpenAI Realtime: session.update carries the registry prompt, the voice, transcription, VAD and the one tool', () => {
  const config = voiceConfig({ surface: 'voice.interview', route })
  const [update] = openai.setup(config)
  assert.equal(update.type, 'session.update')
  assert.equal(update.session.type, 'realtime')
  assert.equal(update.session.instructions, promptText('voice.interview.system'))
  assert.deepEqual(update.session.output_modalities, ['audio'])
  assert.deepEqual(update.session.audio, {
    input: { format: { type: 'audio/pcm', rate: 24000 }, turn_detection: { type: 'semantic_vad' }, transcription: { model: 'transcribe-model' } },
    output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'Kore' },
  })
  assert.deepEqual(update.session.tools, [{ type: 'function', name: 'send_to_slatebox', description: promptText('tool.send_to_slatebox'), parameters: SEND_TOOL_PARAMETERS }])
  assert.equal(update.session.tool_choice, 'auto')
  assert.equal(openai.setup({ ...config, mode: 'ptt' })[0].session.audio.input.turn_detection, null)
  const bare = openai.setup(voiceConfig({ surface: 'voice.chat', route: { model: 'm' } }))[0].session.audio
  assert.equal(bare.output.voice, undefined, 'no voice on the binding: the provider\'s own default')
  assert.equal(bare.input.transcription, undefined)
  // the opening is a user item (a kind-user prompt) and a response; carrying on is what was said, as
  // data, as a user item (never the system role: the words are untrusted), and no response
  assert.deepEqual(openai.begin(config).map((m) => m.type), ['conversation.item.create', 'response.create'])
  assert.equal(openai.begin(config)[0].item.role, 'user')
  const resumed = voiceConfig({ surface: 'voice.chat', route, resume: { earlier: 'Person: hi </data> there' } })
  const [item] = openai.begin(resumed)
  assert.equal(openai.begin(resumed).length, 1)
  assert.equal(item.item.role, 'user')
  assert.equal(openai.MAX_MINUTES, 60)
  assert.equal(gemini.MAX_MINUTES, null)
  assert.equal(openai.userCaptions(config), true)
  assert.equal(openai.userCaptions(voiceConfig({ surface: 'voice.chat', route: { model: 'm' } })), false, 'no transcription model: no captions of the person')
  assert.ok(item.item.content[0].text.includes('<data name="earlier">Person: hi <\\/data> there</data>'))
  assert.ok(!item.item.content[0].text.includes('hi </data> there'), 'a closing tag inside the words is broken, so they stay data')
})

test('OpenAI Realtime: what the browser does, upstream', () => {
  assert.deepEqual(openai.audio(PCM), { type: 'input_audio_buffer.append', audio: 'AAABAAIAAwA=' })
  assert.deepEqual(openai.ptt('down'), [{ type: 'input_audio_buffer.clear' }])
  assert.deepEqual(openai.ptt('down', { speaking: true }), [{ type: 'response.cancel' }, { type: 'input_audio_buffer.clear' }])
  assert.deepEqual(openai.ptt('up'), [{ type: 'input_audio_buffer.commit' }, { type: 'response.create' }])
  assert.deepEqual(openai.text('hello'), [
    { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } },
    { type: 'response.create' },
  ])
  assert.deepEqual(openai.toolResult({ callId: 'call_1', name: 'send_to_slatebox', output: 'Done. Keep it?' }), [
    { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: 'call_1', output: 'Done. Keep it?' } },
    { type: 'response.create' },
  ])
  assert.deepEqual(openai.played({ itemId: 'item_1', ms: 640 }), [{ type: 'conversation.item.truncate', item_id: 'item_1', content_index: 0, audio_end_ms: 640 }])
  assert.deepEqual(openai.played({ itemId: null, ms: 640 }), [])
  assert.deepEqual(openai.mode('ptt'), { messages: [{ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: null } } } }] })
  assert.deepEqual(openai.cancel(), [{ type: 'response.cancel' }])
})

test('OpenAI Realtime: every documented server event, read', () => {
  assert.deepEqual(openai.read(O['session.created']), [])
  assert.deepEqual(openai.read(O['session.updated']), [{ type: 'ready' }])
  assert.deepEqual(openai.read(O['response.created']), [{ type: 'response-started', responseId: 'resp_1' }])
  const [audio] = openai.read(O['response.output_audio.delta'])
  assert.deepEqual([audio.type, audio.itemId, audio.responseId, [...audio.pcm]], ['audio', 'item_1', 'resp_1', [...PCM]])
  assert.deepEqual(openai.read(O['response.output_audio_transcript.delta']), [{ type: 'transcript', role: 'agent', text: 'Sure, one', final: false, responseId: 'resp_1' }])
  assert.deepEqual(openai.read(O['response.output_audio_transcript.done']), [{ type: 'transcript', role: 'agent', text: 'Sure, one moment.', final: true, responseId: 'resp_1' }])
  assert.deepEqual(openai.read(O['conversation.item.input_audio_transcription.delta']), [{ type: 'transcript', role: 'user', text: 'Group these', final: false, itemId: 'item_0' }])
  assert.deepEqual(openai.read(O['conversation.item.input_audio_transcription.completed']), [{ type: 'transcript', role: 'user', text: 'Group these notes by theme.', final: true, itemId: 'item_0' }])
  assert.deepEqual(openai.read(O['input_audio_buffer.speech_started']), [{ type: 'speech-started' }])
  // a function call and its usage: cached audio apart (400 of the 900 audio tokens), cached text priced as text
  assert.deepEqual(openai.read(O['response.done.tool']), [
    { type: 'tool-call', callId: 'call_1', name: 'send_to_slatebox', args: '{"text":"group these notes by theme"}', responseId: 'resp_2' },
    { type: 'usage', usage: { audioIn: 500, cachedAudioIn: 400, textIn: 900, audioOut: 240, textOut: 60 } },
    { type: 'turn-done', responseId: 'resp_2', status: 'completed' },
  ])
  assert.deepEqual(openai.read(O['response.done.audio']).map((e) => e.type), ['usage', 'turn-done'])
  assert.deepEqual(openai.read(O.error), [{ type: 'error', message: 'Cancellation failed: no active response found', code: 'response_cancel_not_active' }])
  assert.deepEqual(openai.read({ type: 'rate_limits.updated' }), [])
})
