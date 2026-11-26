// The voice relay end to end, with no network: a real HTTP server with the relay on /voice/ws and
// a stand-in for Meteor's DDP upgrade listener, real WebSockets for the browser, and a fake
// provider (a local WebSocket server speaking Gemini Live or OpenAI Realtime). What it proves:
// other upgrade paths pass through untouched; a foreign origin, a reused ticket and a full server
// are refused; audio, transcripts, interruptions, tool calls and usage flow both ways; Gemini's
// goAway moves the provider side without the browser noticing; SIGTERM hands the browser a ticket
// to carry on; and no key ever reaches the browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createVoiceRelay } from '../web/app/server/voice/relay.mjs'
import { createTickets, memoryTicketStore } from '../web/app/server/voice/tickets.mjs'
import { createVoiceMeter } from '../web/app/server/voice/meter.mjs'
import { voicePrice } from '../web/app/server/metering/prices.mjs'
import { decodeFrame, encodeMicFrame } from '../web/app/imports/api/common/voice-protocol.mjs'
import { promptText } from '../web/app/server/ai-control/prompts/index.mjs'
import { checkRealtime } from '../web/app/server/voice/check.mjs'
import { exitOnTerminate, onTerminate } from '../web/app/server/shutdown.mjs'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'

// the app's own ws (web/app/package.json), the one the relay runs on
const WebSocket = createRequire(new URL('../web/app/package.json', import.meta.url))('ws')
const { WebSocketServer } = WebSocket

const KEY = { 'gemini-live': 'AIza-relay-test-key-000000000000000', 'openai-realtime': 'sk-relay-test-key-0000000000000000' }
const PCM = Buffer.from([0, 0, 1, 0, 2, 0, 3, 0])

// ---------- a fake provider ----------
async function fakeProvider(t) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(wss, 'listening')
  const connections = []
  const waiting = []
  wss.on('connection', (ws, req) => {
    const conn = { ws, url: req.url, headers: req.headers, messages: [], waiters: [] }
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data))
      conn.messages.push(msg)
      for (const w of [...conn.waiters]) if (w.test(msg)) { conn.waiters.splice(conn.waiters.indexOf(w), 1); w.resolve(msg) }
    })
    conn.next = (test = () => true) => {
      const found = conn.messages.find(test)
      if (found) return Promise.resolve(found)
      return new Promise((resolve) => conn.waiters.push({ test, resolve }))
    }
    conn.send = (msg) => ws.send(JSON.stringify(msg))
    connections.push(conn)
    for (const w of waiting.splice(0)) w(conn)
  })
  t.after(() => wss.close())
  return {
    port: wss.address().port,
    connections,
    nextConnection: (index) => (connections[index] ? Promise.resolve(connections[index]) : new Promise((resolve) => waiting.push(() => connections[index] && resolve(connections[index])))),
  }
}

// ---------- the app: an HTTP server with a DDP stand-in and the relay ----------
async function app(t, { protocol = 'gemini-live', perPod = 5, perPerson = 2, meterOpts = {}, provider, timing = {}, deps = {}, relayOpts = {} }) {
  const server = http.createServer((req, res) => res.end('ok'))
  // Meteor's sockjs listener, standing in: it takes /websocket and nothing else
  const ddp = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/websocket') return
    ddp.handleUpgrade(req, socket, head, (ws) => ws.on('message', (data) => ws.send(`ddp:${data}`)))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const tickets = createTickets({ store: memoryTicketStore() })
  const meterLog = []
  const meter = {
    enabled: () => true,
    async begin(opts) {
      if (meterOpts.refuse) throw Object.assign(new Error('no'), { error: 'pro-voice', reason: 'Talking with the agent comes with Slatebox Pro.' })
      meterLog.push(['begin', opts.feature]); return { actionId: `a${meterLog.length}`, ceilingMicros: 200_000 }
    },
    async record(action, entry) { meterLog.push(['record', entry.costMicros]); return { costMicros: entry.costMicros } },
    async finish(action) { meterLog.push(['finish', action.actionId]) },
  }
  const records = []
  let seq = 0
  const relay = createVoiceRelay({
    server, origins: [origin], perPod: () => perPod, perPerson: () => perPerson, log: { info() {}, warn() {}, error() {} },
    sessionDeps: {
      connect: (url, headers) => new WebSocket(url.replace(/^wss:\/\/[^/]+/, `ws://127.0.0.1:${provider.port}`), { headers }),
      redeem: (ticket) => tickets.redeem(ticket),
      prepare: async (binding) => ({
        protocol, own: false, model: 'voice-model', price: voicePrice('voice-model'), rules: null,
        connection: { baseUrl: protocol === 'gemini-live' ? 'wss://live.example' : 'wss://realtime.example/v1/realtime', apiKey: KEY[protocol], model: 'voice-model', voice: 'test-voice', transcriptionModel: 'transcribe-model' },
        surface: binding.surface,
      }),
      meterFor: ({ binding, prepared, sessionId }) => createVoiceMeter({ meter, metered: true, userId: binding.userId, feature: 'voice-chat', sessionId, model: prepared.model, price: prepared.price }),
      mintReconnect: async ({ binding, resume }) => (await tickets.mint({ userId: binding.userId, surface: binding.surface, slateId: binding.slateId, resume })).ticket,
      record: { start: async (doc) => records.push(['start', doc]), update: async () => {}, end: async (id, set) => records.push(['end', set]) },
      newId: () => `id${++seq}`,
      log: { info() {}, warn() {}, error() {} },
      timing: { helloMs: 2000, connectMs: 3000, ...timing },
      ...deps,
    },
    ...relayOpts,
  })
  t.after(() => { relay.close(); ddp.close(); server.close() })
  return { server, origin, port: server.address().port, tickets, relay, meterLog, records }
}

// a browser: every message it got, in order, never a key
function browser(t, a, { path = '/voice/ws', origin = a.origin } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${a.port}${path}`, { origin })
  const got = []
  const waiters = []
  ws.on('message', (data, isBinary) => {
    const item = isBinary ? { binary: decodeFrame(new Uint8Array(data)) } : JSON.parse(String(data))
    if (!isBinary) for (const key of Object.values(KEY)) assert.ok(!String(data).includes(key), 'a key reached the browser')
    got.push(item)
    for (const w of [...waiters]) if (w.test(item)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(item) }
  })
  const next = (test) => {
    const found = got.find(test)
    if (found) return Promise.resolve(found)
    return new Promise((resolve) => waiters.push({ test, resolve }))
  }
  const ofType = (type, extra = () => true) => next((m) => m.type === type && extra(m))
  t.after(() => ws.terminate())
  return { ws, got, next, ofType, send: (msg) => ws.send(JSON.stringify(msg)), opened: once(ws, 'open') }
}

test('other upgrade paths pass through to their own listener; a foreign origin is refused before the upgrade', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider })
  const ddp = new WebSocket(`ws://127.0.0.1:${a.port}/websocket`, { origin: 'https://anywhere.example' })
  await once(ddp, 'open')
  ddp.send('ping')
  const [reply] = await once(ddp, 'message')
  assert.equal(String(reply), 'ddp:ping', 'DDP keeps its own upgrades, whatever the origin')
  ddp.close()
  const foreign = new WebSocket(`ws://127.0.0.1:${a.port}/voice/ws`, { origin: 'https://evil.example' })
  const [, response] = await once(foreign, 'unexpected-response')
  assert.equal(response.statusCode, 403)
  const none = new WebSocket(`ws://127.0.0.1:${a.port}/voice/ws`)
  const [, refused] = await once(none, 'unexpected-response')
  assert.equal(refused.statusCode, 403, 'no origin, no voice')
  // a plain request on the same server is untouched
  const body = await new Promise((resolve) => http.get(`${a.origin}/`, (res) => { let s = ''; res.on('data', (c) => { s += c }); res.on('end', () => resolve(s)) }))
  assert.equal(body, 'ok')
})

test('Gemini Live end to end: setup, audio both ways, transcripts, a tool call, an interruption, usage, goAway, the end', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider })
  const { ticket } = await a.tickets.mint({ userId: 'ana', surface: 'voice.chat', slateId: 's1' })
  const b = browser(t, a)
  await b.opened
  b.send({ type: 'hello', ticket, v: 1, mode: 'open' })
  const live = await provider.nextConnection(0)
  assert.equal(live.headers['x-goog-api-key'], KEY['gemini-live'], 'the key goes to the provider in its header')
  assert.ok(!live.url.includes(KEY['gemini-live']), 'never in the URL')
  assert.match(live.url, /BidiGenerateContent$/)
  const { setup } = await live.next((m) => m.setup)
  assert.equal(setup.systemInstruction.parts[0].text, promptText('voice.chat.system'))
  assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'test-voice')
  assert.equal(setup.tools[0].functionDeclarations[0].name, 'send_to_slatebox')
  assert.deepEqual(setup.contextWindowCompression, { slidingWindow: {} })
  assert.equal(live.messages.length, 1, 'nothing but setup until setupComplete')
  live.send({ setupComplete: {} })
  const ready = await b.ofType('ready')
  assert.deepEqual([ready.inRate, ready.outRate, ready.mode, ready.v, ready.resumed], [16000, 24000, 'open', 1, false])
  assert.deepEqual(a.meterLog[0], ['begin', 'voice-chat'], 'the first minute was held before the provider was asked')
  // the opening, then the person speaks
  await live.next((m) => m.clientContent)
  b.ws.send(encodeMicFrame(new Int16Array([5, 6, 7, 8])))
  const up = await live.next((m) => m.realtimeInput?.audio)
  assert.deepEqual([...Buffer.from(up.realtimeInput.audio.data, 'base64')], [5, 0, 6, 0, 7, 0, 8, 0])
  assert.equal(up.realtimeInput.audio.mimeType, 'audio/pcm;rate=16000')
  live.send({ serverContent: { inputTranscription: { text: 'Group these notes' } } })
  live.send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: PCM.toString('base64') } }] } } })
  const frame = await b.next((m) => m.binary?.kind === 'agent')
  assert.deepEqual([frame.binary.turn, [...frame.binary.pcm]], [1, [...PCM]])
  const heard = await b.ofType('transcript', (m) => m.role === 'user' && m.final)
  assert.deepEqual([heard.text, heard.turn], ['Group these notes', 0])
  await b.ofType('activity', (m) => m.kind === 'speaking' && m.state === 'started' && m.turn === 1)
  live.send({ serverContent: { outputTranscription: { text: 'One moment.' } } })
  live.send({ serverContent: { turnComplete: true } })
  const said = await b.ofType('transcript', (m) => m.role === 'agent' && m.final)
  assert.deepEqual([said.text, said.turn], ['One moment.', 1])
  // the tool: forwarded with the relay's own id, answered through the browser, given back to the model
  live.send({ toolCall: { functionCalls: [{ id: 'function-call-1', name: 'send_to_slatebox', args: { text: 'group these notes by theme' } }] } })
  const tool = await b.ofType('tool')
  assert.deepEqual([tool.name, tool.args], ['send_to_slatebox', { text: 'group these notes by theme' }])
  assert.notEqual(tool.id, 'function-call-1')
  b.send({ type: 'tool_result', id: tool.id, output: 'I grouped them into three themes. Keep it?' })
  const answer = await live.next((m) => m.toolResponse)
  // the screen's text reaches the model in the registry's words, as data (it can quote anyone's notes)
  assert.deepEqual(answer.toolResponse.functionResponses[0], { id: 'function-call-1', name: 'send_to_slatebox', response: { output: promptText('voice.answer', { answer: 'I grouped them into three themes. Keep it?' }) }, scheduling: 'WHEN_IDLE' })
  // a tool the model made up is answered by the relay, never forwarded
  live.send({ toolCall: { functionCalls: [{ id: 'fc-2', name: 'delete_everything', args: {} }] } })
  const madeUp = await live.next((m) => m.toolResponse?.functionResponses?.[0]?.id === 'fc-2')
  assert.equal(madeUp.toolResponse.functionResponses[0].response.output, promptText('voice.tool-failed'))
  // the person speaks over the agent
  live.send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: PCM.toString('base64') } }] } } })
  await b.next((m) => m.binary?.turn === 2)
  live.send({ serverContent: { interrupted: true } })
  assert.equal((await b.ofType('interrupt')).turn, 2)
  // usage is metered at the model's prices
  live.send({ usageMetadata: { promptTokenCount: 1000, responseTokenCount: 500, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 1000 }], responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 500 }] } })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.ok(a.meterLog.some(([kind, cost]) => kind === 'record' && cost > 0))
  // goAway: a new connection resumed with the latest handle; the browser sees nothing
  live.send({ sessionResumptionUpdate: { newHandle: 'handle-1', resumable: true } })
  live.send({ goAway: { timeLeft: '5s' } })
  const second = await provider.nextConnection(1)
  const resumed = await second.next((m) => m.setup)
  assert.deepEqual(resumed.setup.sessionResumption, { handle: 'handle-1' })
  second.send({ setupComplete: {} })
  await once(live.ws, 'close')
  b.ws.send(encodeMicFrame(new Int16Array([9, 9])))
  await second.next((m) => m.realtimeInput?.audio)
  assert.ok(!second.messages.some((m) => m.clientContent), 'no second greeting after a move')
  assert.equal(b.got.filter((m) => m.type === 'ready').length, 1)
  // the person ends it
  b.send({ type: 'end' })
  const closing = await b.ofType('closing')
  assert.equal(closing.reason, 'ended')
  const [code] = await once(b.ws, 'close')
  assert.equal(code, 1000)
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(a.meterLog.at(-1)[0], 'finish', 'the hold is released')
  assert.deepEqual(a.records.at(-1), ['end', { state: 'ended', endedReason: 'ended', endedAt: a.records.at(-1)[1].endedAt, spentMicros: a.records.at(-1)[1].spentMicros }])
  assert.ok(!JSON.stringify(a.records).includes('Group these notes'), 'no transcript is kept')
})

test('a ticket is good once; a bad first message, a full server and no credits are refused with a reason', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider, perPod: 1 })
  const { ticket } = await a.tickets.mint({ userId: 'ana', surface: 'voice.interview' })
  const first = browser(t, a)
  await first.opened
  first.send({ type: 'hello', ticket, v: 1 })
  const live = await provider.nextConnection(0)
  await live.next((m) => m.setup)
  live.send({ setupComplete: {} })
  await first.ofType('ready')
  // the server holds one session: the next, its ticket taken, is busy
  const busy = browser(t, a)
  await busy.opened
  busy.send({ type: 'hello', ticket: (await a.tickets.mint({ userId: 'ben', surface: 'voice.interview' })).ticket, v: 1 })
  assert.equal((await busy.ofType('closing')).reason, 'busy')
  first.send({ type: 'end' })
  await once(first.ws, 'close')
  await new Promise((resolve) => setTimeout(resolve, 30))
  // the same ticket again
  const again = browser(t, a)
  await again.opened
  again.send({ type: 'hello', ticket, v: 1 })
  assert.equal((await again.ofType('closing')).reason, 'denied')
  // a first message that is not hello
  const rude = browser(t, a)
  await rude.opened
  rude.send({ type: 'end' })
  assert.equal((await rude.ofType('closing')).reason, 'denied')
  // no credits: the session ends before the provider is asked
  const poor = await app(t, { provider, meterOpts: { refuse: true } })
  const minted = await poor.tickets.mint({ userId: 'ana', surface: 'voice.chat', slateId: 's1' })
  const broke = browser(t, poor)
  await broke.opened
  broke.send({ type: 'hello', ticket: minted.ticket, v: 1 })
  const capped = await broke.ofType('closing')
  assert.deepEqual([capped.reason, capped.message], ['cap', 'Talking with the agent comes with Slatebox Pro.'])
  assert.equal(provider.connections.length, 1, 'no provider connection for a session with no credits')
})

test('SIGTERM: every session is handed a ticket to carry on, with what it needs (Gemini: its handle)', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider })
  const { ticket } = await a.tickets.mint({ userId: 'ana', surface: 'voice.chat', slateId: 's1' })
  const b = browser(t, a)
  await b.opened
  b.send({ type: 'hello', ticket, v: 1, mode: 'ptt' })
  const live = await provider.nextConnection(0)
  const { setup } = await live.next((m) => m.setup)
  assert.deepEqual(setup.realtimeInputConfig, { automaticActivityDetection: { disabled: true } })
  live.send({ setupComplete: {} })
  await b.ofType('ready')
  b.send({ type: 'ptt', state: 'down' })
  await live.next((m) => m.realtimeInput?.activityStart)
  b.send({ type: 'ptt', state: 'up' })
  await live.next((m) => m.realtimeInput?.activityEnd)
  live.send({ sessionResumptionUpdate: { newHandle: 'handle-9', resumable: true } })
  await new Promise((resolve) => setTimeout(resolve, 30))
  await a.relay.drain()
  const closing = await b.ofType('closing')
  assert.equal(closing.reason, 'moving')
  const [code] = await once(b.ws, 'close')
  assert.equal(code, 4004)
  const carried = await a.tickets.redeem(closing.reconnect.ticket)
  assert.deepEqual([carried.userId, carried.surface, carried.slateId, carried.resume.handle, carried.resume.mode], ['ana', 'voice.chat', 's1', 'handle-9', 'ptt'])
  // a server that is stopping takes no new session
  const late = new WebSocket(`ws://127.0.0.1:${a.port}/voice/ws`, { origin: a.origin })
  const [, response] = await once(late, 'unexpected-response')
  assert.equal(response.statusCode, 503)
})

test('OpenAI Realtime end to end: session.update, the opening, barge-in with truncation, a function call, a mode switch, moving with what was said', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider, protocol: 'openai-realtime' })
  const { ticket } = await a.tickets.mint({ userId: 'ana', surface: 'voice.interview' })
  const b = browser(t, a)
  await b.opened
  b.send({ type: 'hello', ticket, v: 1 })
  const rt = await provider.nextConnection(0)
  assert.equal(rt.headers.authorization, `Bearer ${KEY['openai-realtime']}`)
  assert.equal(rt.url, '/v1/realtime?model=voice-model')
  const update = await rt.next((m) => m.type === 'session.update')
  assert.equal(update.session.instructions, promptText('voice.interview.system'))
  assert.deepEqual(update.session.audio.input.transcription, { model: 'transcribe-model' })
  rt.send({ type: 'session.created', session: {} })
  rt.send({ type: 'session.updated', session: {} })
  const ready = await b.ofType('ready')
  assert.deepEqual([ready.inRate, ready.outRate], [24000, 24000])
  await rt.next((m) => m.type === 'response.create')
  // the agent speaks; the person cuts in; the browser says how much it heard
  rt.send({ type: 'response.created', response: { id: 'resp_1' } })
  rt.send({ type: 'response.output_audio.delta', response_id: 'resp_1', item_id: 'item_1', delta: PCM.toString('base64') })
  await b.next((m) => m.binary?.turn === 1)
  rt.send({ type: 'input_audio_buffer.speech_started' })
  assert.equal((await b.ofType('interrupt')).turn, 1)
  // late audio of the cut answer is dropped
  rt.send({ type: 'response.output_audio.delta', response_id: 'resp_1', item_id: 'item_1', delta: PCM.toString('base64') })
  b.send({ type: 'played', turn: 1, ms: 120 })
  const truncate = await rt.next((m) => m.type === 'conversation.item.truncate')
  assert.deepEqual(truncate, { type: 'conversation.item.truncate', item_id: 'item_1', content_index: 0, audio_end_ms: 120 })
  assert.equal(b.got.filter((m) => m.binary?.turn === 1).length, 1)
  // the person's words, final from the provider
  rt.send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_0', transcript: 'I run a support team.' })
  assert.equal((await b.ofType('transcript', (m) => m.role === 'user' && m.final)).text, 'I run a support team.')
  // a function call in response.done, answered through the browser
  rt.send({ type: 'response.done', response: { id: 'resp_2', status: 'completed', output: [{ type: 'function_call', name: 'send_to_slatebox', call_id: 'call_1', arguments: '{"text":"I run a support team."}' }], usage: { input_token_details: { audio_tokens: 100, text_tokens: 50 }, output_token_details: { audio_tokens: 20, text_tokens: 5 } } } })
  const tool = await b.ofType('tool')
  assert.deepEqual(tool.args, { text: 'I run a support team.' })
  b.send({ type: 'tool_result', id: tool.id, output: 'What does a busy week look like for your team?' })
  const output = await rt.next((m) => m.type === 'conversation.item.create' && m.item.type === 'function_call_output')
  assert.deepEqual(output.item, { type: 'function_call_output', call_id: 'call_1', output: promptText('voice.answer', { answer: 'What does a busy week look like for your team?' }) })
  // push to talk, switched in place
  b.send({ type: 'mode', mode: 'ptt' })
  const switched = await rt.next((m) => m.type === 'session.update' && m.session.audio?.input && !('format' in m.session.audio.input))
  assert.equal(switched.session.audio.input.turn_detection, null)
  assert.equal((await b.ofType('ready', (m) => m.mode === 'ptt')).resumed, true)
  rt.send({ type: 'response.output_audio_transcript.done', response_id: 'resp_3', transcript: 'What does a busy week look like?' })
  await b.ofType('transcript', (m) => m.role === 'agent' && m.final)
  // moving: no resumption here, so what was said goes with the ticket
  await a.relay.drain()
  const closing = await b.ofType('closing')
  const carried = await a.tickets.redeem(closing.reconnect.ticket)
  assert.equal(carried.resume.handle, undefined)
  assert.match(carried.resume.earlier, /Person: I run a support team\.\nAgent: What does a busy week look like\?/)
  assert.equal(carried.resume.mode, 'ptt')
})

test('testing a voice key: the socket\'s setup, then ready; a refused key or a closed socket says so, never with the key', async (t) => {
  const provider = await fakeProvider(t)
  const connect = (url, headers) => new WebSocket(url.replace(/^wss:\/\/[^/]+/, `ws://127.0.0.1:${provider.port}`), { headers })
  const checking = checkRealtime({ protocol: 'gemini-live', baseUrl: 'wss://live.example', apiKey: KEY['gemini-live'], model: 'voice-model' }, { connect, timeoutMs: 3000 })
  const conn = await provider.nextConnection(0)
  assert.equal(conn.headers['x-goog-api-key'], KEY['gemini-live'])
  const { setup } = await conn.next((m) => m.setup)
  assert.equal(setup.model, 'models/voice-model')
  conn.send({ setupComplete: {} })
  assert.deepEqual(await checking, { ok: true, reachable: true, message: 'Connected. The key works and the model is ready to talk.' })
  // the provider closes on a bad model
  const closing = checkRealtime({ protocol: 'openai-realtime', baseUrl: 'wss://rt.example/v1/realtime', apiKey: KEY['openai-realtime'], model: 'nope' }, { connect, timeoutMs: 3000 })
  const second = await provider.nextConnection(1)
  await second.next((m) => m.type === 'session.update')
  second.ws.close(4000, 'bad model')
  const closed = await closing
  assert.equal(closed.ok, false)
  assert.match(closed.message, /closed the connection/)
  // a provider that refuses the key at the handshake
  const refusing = http.createServer()
  refusing.on('upgrade', (req, socket) => { socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n') })
  await new Promise((resolve) => refusing.listen(0, '127.0.0.1', resolve))
  t.after(() => refusing.close())
  const refused = await checkRealtime({ protocol: 'gemini-live', baseUrl: `ws://127.0.0.1:${refusing.address().port}`, apiKey: 'AIza-wrong-key', model: 'voice-model' }, { connect: (url, headers) => new WebSocket(url, { headers }), timeoutMs: 3000 })
  assert.deepEqual([refused.ok, refused.message], [false, 'The voice provider did not accept the key.'])
  for (const out of [closed, refused]) assert.ok(!JSON.stringify(out).includes('key-0000') && !out.message.includes('AIza'), 'no key in the result')
  assert.equal((await checkRealtime({ protocol: 'openai-chat', baseUrl: 'x', apiKey: 'k', model: 'm' }, { connect })).ok, false)
})

test('SIGTERM runs the relay\'s hand-off before the process exits; the app wires both', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const proc = Object.assign(new EventEmitter(), { exits: [], exit(code) { this.exits.push(code) } })
  const ran = []
  const off = onTerminate((signal) => { ran.push(signal) })
  t.after(off)
  exitOnTerminate({ proc, server: { close() {} }, drainMs: 1000, log() {} })
  proc.emit('SIGTERM')
  assert.deepEqual(ran, ['SIGTERM'], 'at the signal, inside the drain time')
  assert.deepEqual(proc.exits, [])
  t.mock.timers.tick(1000)
  assert.deepEqual(proc.exits, [0])
  const meteor = readFileSync(new URL('../web/app/server/voice/meteor.js', import.meta.url), 'utf8')
  assert.match(meteor, /onTerminate\(\(\) => relay\?\.drain\(\)\)/)
  assert.match(readFileSync(new URL('../web/app/server/main.js', import.meta.url), 'utf8'), /import '\.\/voice\/meteor'/)
  // the relay listens on the app's own HTTP server, for its one path, behind the origin check
  assert.match(meteor, /createVoiceRelay\(\{\s*server: WebApp\.httpServer, origins/)
  // the waiting limit counts the browser's address behind the proxies Meteor is told about
  assert.match(meteor, /forwardedCount: Number\.parseInt\(process\.env\.HTTP_FORWARDED_COUNT/)
  assert.match(meteor, /process\.env\.ROOT_URL/)
})

// ---------- the review's fixes (2026-11-26) ----------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const MIN = 60_000

// a browser with a live session: hello, the provider's setup, ready
async function liveSession(t, a, provider, index, { userId = 'ana', surface = 'voice.chat', mode = 'open', openai = false } = {}) {
  const { ticket } = await a.tickets.mint({ userId, surface, slateId: surface === 'voice.chat' ? 's1' : null })
  const b = browser(t, a)
  await b.opened
  b.send({ type: 'hello', ticket, v: 1, mode })
  const p = await provider.nextConnection(index)
  await p.next((m) => (openai ? m.type === 'session.update' : m.setup))
  p.send(openai ? { type: 'session.updated', session: {} } : { setupComplete: {} })
  await b.ofType('ready')
  return { b, p }
}
const geminiAudio = { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: PCM.toString('base64') } }] } } }

test('sockets that never say hello do not fill a server: one address waits with a few at most, and only a taken ticket counts', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider, perPod: 3 })
  // four sockets from one address, none says hello: a fifth is refused before the upgrade (more
  // than perPod already: before, they would have taken every place on the server)
  const idle = []
  for (let i = 0; i < 4; i += 1) { const x = browser(t, a); await x.opened; idle.push(x) }
  const fifth = new WebSocket(`ws://127.0.0.1:${a.port}/voice/ws`, { origin: a.origin })
  const [, response] = await once(fifth, 'unexpected-response')
  assert.equal(response.statusCode, 429)
  // the waiting sockets do not count toward perPod: once one goes, a real session still opens
  idle[0].ws.close()
  await sleep(30)
  const { b } = await liveSession(t, a, provider, 0)
  assert.ok(b.got.some((m) => m.type === 'ready'))
  // the browser's address behind proxies: the outermost one's view
  const { clientAddress } = await import('../web/app/server/voice/relay.mjs')
  const req = { socket: { remoteAddress: '10.0.0.9' }, headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' } }
  assert.equal(clientAddress(req, 0), '10.0.0.9')
  assert.equal(clientAddress(req, 1), '10.0.0.2')
  assert.equal(clientAddress(req, 2), '203.0.113.7')
})

test('one person holds at most perPerson sessions; a session moving here is not counted against itself', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider, perPerson: 1 })
  const first = await liveSession(t, a, provider, 0)
  const second = browser(t, a)
  await second.opened
  second.send({ type: 'hello', ticket: (await a.tickets.mint({ userId: 'ana', surface: 'voice.chat', slateId: 's1' })).ticket, v: 1 })
  const busy = await second.ofType('closing')
  assert.deepEqual([busy.reason, busy.message], ['busy', 'Voice is already on in another tab or window. Turn it off there to talk here.'])
  assert.equal(provider.connections.length, 1, 'no provider connection for it')
  // the session moves (a reload pauses it): its ticket is admitted though the old one is still closing
  first.b.send({ type: 'pause' })
  const moving = await first.b.ofType('closing')
  assert.equal(moving.reason, 'moving')
  const carried = browser(t, a)
  await carried.opened
  carried.send({ type: 'hello', ticket: moving.reconnect.ticket, v: 1 })
  const p = await provider.nextConnection(1)
  await p.next((m) => m.setup)
  p.send({ setupComplete: {} })
  assert.equal((await carried.ofType('ready')).resumed, true)
  // open elsewhere (another server's VoiceSessions rows) counts too
  const b = await app(t, { provider, perPerson: 2, relayOpts: { openElsewhere: async () => 2 } })
  const third = browser(t, b)
  await third.opened
  third.send({ type: 'hello', ticket: (await b.tickets.mint({ userId: 'ana', surface: 'voice.interview' })).ticket, v: 1 })
  assert.equal((await third.ofType('closing')).reason, 'busy')
})

test('barge-in after the answer was made: still playing, the person speaking (or pressing push to talk) cuts it; once heard, it does not', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider })
  const { b, p } = await liveSession(t, a, provider, 0)
  p.send(geminiAudio)
  await b.next((m) => m.binary?.turn === 1)
  p.send({ serverContent: { turnComplete: true } })
  await b.ofType('activity', (m) => m.kind === 'speaking' && m.state === 'done' && m.turn === 1)
  // the browser still plays it: the person speaks over it
  p.send({ voiceActivity: { voiceActivityType: 'ACTIVITY_START' } })
  assert.equal((await b.ofType('interrupt')).turn, 1)
  // a turn that was heard to its end (played) is not interrupted
  p.send(geminiAudio)
  await b.next((m) => m.binary?.turn === 2)
  p.send({ serverContent: { turnComplete: true } })
  b.send({ type: 'played', turn: 2, ms: 40 })
  await sleep(30)
  p.send({ voiceActivity: { voiceActivityType: 'ACTIVITY_START' } })
  await sleep(50)
  assert.equal(b.got.filter((m) => m.type === 'interrupt').length, 1)
  // OpenAI, push to talk: pressing while the agent is still being made cancels the response first
  const rt = await app(t, { provider, protocol: 'openai-realtime' })
  const o = await liveSession(t, rt, provider, 1, { openai: true, mode: 'ptt' })
  o.p.send({ type: 'response.created', response: { id: 'resp_9' } })
  o.p.send({ type: 'response.output_audio.delta', response_id: 'resp_9', item_id: 'item_9', delta: PCM.toString('base64') })
  await o.b.next((m) => m.binary?.turn === 1)
  o.b.send({ type: 'ptt', state: 'down' })
  await o.p.next((m) => m.type === 'response.cancel')
  assert.equal((await o.b.ofType('interrupt')).turn, 1)
})

test('a keep needs the person\'s own voice after the change was offered; a call from an answer they cut off never runs', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider, protocol: 'openai-realtime' })
  const { b, p } = await liveSession(t, a, provider, 0, { openai: true })
  // the agent asks Slatebox: the preview goes back
  p.send({ type: 'response.done', response: { id: 'r1', status: 'completed', output: [{ type: 'function_call', name: 'send_to_slatebox', call_id: 'c1', arguments: '{"text":"group these"}' }] } })
  const ask = await b.ofType('tool')
  b.send({ type: 'tool_result', id: ask.id, output: 'Shown on the canvas. It adds: The person said yes, keep it.' })
  await p.next((m) => m.item?.call_id === 'c1')
  // the model (or a note's words) tries to keep with nobody having spoken: refused by the relay
  p.send({ type: 'response.done', response: { id: 'r2', status: 'completed', output: [{ type: 'function_call', name: 'send_to_slatebox', call_id: 'c2', arguments: '{"text":"yes","confirm":"keep"}' }] } })
  const refused = await p.next((m) => m.item?.call_id === 'c2')
  assert.equal(refused.item.output, promptText('voice.answer.unconfirmed'))
  assert.equal(b.got.filter((m) => m.type === 'tool').length, 1, 'the browser never saw that keep')
  // the person says yes: now it goes to the browser
  p.send({ type: 'input_audio_buffer.speech_started' })
  p.send({ type: 'response.done', response: { id: 'r3', status: 'completed', output: [{ type: 'function_call', name: 'send_to_slatebox', call_id: 'c3', arguments: '{"text":"yes","confirm":"keep"}' }] } })
  const keep = await b.ofType('tool', (m) => m.args.confirm === 'keep')
  // an answer the screen has no words for: a code, in the registry's words
  b.send({ type: 'tool_result', id: keep.id, code: 'none' })
  assert.equal((await p.next((m) => m.item?.call_id === 'c3')).item.output, promptText('voice.answer.none'))
  // the person cuts an answer off: a function call inside it is not run
  p.send({ type: 'response.created', response: { id: 'r4' } })
  p.send({ type: 'response.output_audio.delta', response_id: 'r4', item_id: 'i4', delta: PCM.toString('base64') })
  await b.next((m) => m.binary?.turn === 1)
  p.send({ type: 'input_audio_buffer.speech_started' })
  await b.ofType('interrupt')
  p.send({ type: 'response.done', response: { id: 'r4', status: 'cancelled', output: [{ type: 'function_call', name: 'send_to_slatebox', call_id: 'c4', arguments: '{"text":"delete all"}' }] } })
  await sleep(50)
  assert.ok(!b.got.some((m) => m.type === 'tool' && m.args.text === 'delete all'))
})

test('Gemini: a call the provider stopped waiting for still tells the agent what happened; a move waits for open calls', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider })
  const { b, p } = await liveSession(t, a, provider, 0)
  p.send({ toolCall: { functionCalls: [{ id: 'fc-1', name: 'send_to_slatebox', args: { text: 'keep going' } }] } })
  const tool = await b.ofType('tool')
  p.send({ toolCallCancellation: { ids: ['fc-1'] } })
  await b.ofType('tool_cancel')
  b.send({ type: 'tool_result', id: tool.id, output: 'Added 3 notes.' })
  const late = await p.next((m) => m.realtimeInput?.text)
  assert.equal(late.realtimeInput.text, promptText('voice.late-answer', { answer: 'Added 3 notes.' }))
  // goAway with a call open: no new connection until it is answered and a handle after it arrives
  p.send({ sessionResumptionUpdate: { newHandle: 'h-before', resumable: true } })
  p.send({ toolCall: { functionCalls: [{ id: 'fc-2', name: 'send_to_slatebox', args: { text: 'group' } }] } })
  const open = await b.ofType('tool', (m) => m.id !== tool.id)
  p.send({ goAway: { timeLeft: '20s' } })
  await sleep(80)
  assert.equal(provider.connections.length, 1, 'the move waits for the open call')
  b.send({ type: 'tool_result', id: open.id, output: 'Grouped.' })
  await p.next((m) => m.toolResponse?.functionResponses?.[0]?.id === 'fc-2')
  await sleep(30)
  assert.equal(provider.connections.length, 1, 'and for the handle after its answer')
  p.send({ sessionResumptionUpdate: { newHandle: 'h-after', resumable: true } })
  const next = await provider.nextConnection(1)
  assert.deepEqual((await next.next((m) => m.setup)).setup.sessionResumption, { handle: 'h-after' })
})

test('usage: an answer still being made when the session ends is stopped and billed before the hold is released', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider, protocol: 'openai-realtime' })
  const { b, p } = await liveSession(t, a, provider, 0, { openai: true })
  p.send({ type: 'response.created', response: { id: 'r1' } })
  await sleep(30)
  b.send({ type: 'end' })
  await p.next((m) => m.type === 'response.cancel')
  p.send({ type: 'response.done', response: { id: 'r1', status: 'cancelled', output: [], usage: { input_token_details: { audio_tokens: 100, text_tokens: 50 }, output_token_details: { audio_tokens: 20, text_tokens: 5 } } } })
  await sleep(80)
  const recorded = a.meterLog.findIndex(([kind, cost]) => kind === 'record' && cost > 0)
  const finished = a.meterLog.findIndex(([kind]) => kind === 'finish')
  assert.ok(recorded >= 0, 'the last answer is billed')
  assert.ok(finished > recorded, 'before the hold is released')
})

test('the relay protects itself and the provider: long audio is split into frames, a flood ends the session', async (t) => {
  const provider = await fakeProvider(t)
  const a = await app(t, { provider })
  const { b, p } = await liveSession(t, a, provider, 0)
  // 4 s at 24 kHz in one chunk: more than one frame carries
  const long = Buffer.alloc(4 * 24000 * 2, 1)
  p.send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: long.toString('base64') } }] } } })
  await sleep(100)
  const frames = b.got.filter((m) => m.binary?.kind === 'agent')
  assert.equal(frames.reduce((n, f) => n + f.binary.pcm.length, 0), long.length)
  assert.ok(frames.length >= 2 && frames.every((f) => f.binary.pcm.length <= 96000))
  // a page that sends more messages than a conversation needs
  for (let i = 0; i < 40; i += 1) b.send({ type: 'played', turn: 0, ms: 0 })
  const closing = await b.ofType('closing')
  assert.deepEqual([closing.reason, closing.message], ['error', 'Voice stopped: this page sent more messages than a conversation needs.'])
})

test('the minute: a warning a minute before the limit, the minute check failing twice ends it, OpenAI moves before its 60 minutes', async (t) => {
  const provider = await fakeProvider(t)
  let clock = Date.now()
  const checks = []
  const a = await app(t, {
    provider,
    timing: { tickMs: 60 },
    deps: {
      now: () => clock,
      limits: { maxMinutes: 3, idleMinutes: 60, perPod: 5, perPerson: 2, warnMinutes: 1 },
      allowed: async () => { checks.push(clock); if (checks.length >= 2) throw new Error('database down'); return true },
    },
  })
  const { b } = await liveSession(t, a, provider, 0)
  clock += 2 * MIN
  const notice = await b.ofType('notice')
  assert.deepEqual([notice.reason, notice.seconds], ['limit', 0])
  // the check fails (the second tick), then again (the third): the session ends, never left open
  const closing = await b.ofType('closing')
  assert.ok(['denied', 'limit'].includes(closing.reason))
  assert.ok(checks.length >= 2)
  // OpenAI: a session near its provider's 60 minutes moves to a new one, with what was said
  let clock2 = Date.now()
  const o = await app(t, { provider, protocol: 'openai-realtime', timing: { tickMs: 60 }, deps: { now: () => clock2, limits: { maxMinutes: 240, idleMinutes: 240, perPod: 5, perPerson: 2, warnMinutes: 1 } } })
  const s = await liveSession(t, o, provider, 1, { openai: true })
  clock2 += 58 * MIN
  const moved = await s.b.ofType('closing')
  assert.equal(moved.reason, 'moving')
  const carried = await o.tickets.redeem(moved.reconnect.ticket)
  assert.ok(carried.resume.elapsedMs >= 58 * MIN, 'the time limit counts on from where it was')
})
