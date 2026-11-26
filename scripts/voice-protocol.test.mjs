// The voice client protocol (web/app/imports/api/common/voice-protocol.mjs): the one shape the
// browser and the relay share, whichever provider talks. Every message is checked, with its size
// limits, before anything acts on it; audio frames are bytes with a kind (and the agent's turn).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANSWER_CODES, CLOSE_CODES, CLOSING_REASONS, FRAME, LIMITS, TOOL_NAME, VOICE_PATH, VOICE_PROTOCOL_VERSION, VoiceProtocolError,
  decodeFrame, encodeAgentFrame, encodeMicFrame, parseClientMessage, parseServerMessage, parseToolArgs, pcmMs, serverMessage,
} from '../web/app/imports/api/common/voice-protocol.mjs'

const TICKET = 'a'.repeat(43)
const send = (msg) => parseClientMessage(JSON.stringify(msg))

test('the browser messages, each with only its own fields', () => {
  assert.deepEqual(send({ type: 'hello', ticket: TICKET, v: 1 }), { type: 'hello', ticket: TICKET, v: 1, mode: 'open' })
  assert.equal(send({ type: 'hello', ticket: TICKET, v: 1, mode: 'ptt' }).mode, 'ptt')
  assert.deepEqual(send({ type: 'ptt', state: 'down' }), { type: 'ptt', state: 'down' })
  assert.deepEqual(send({ type: 'mode', mode: 'ptt' }), { type: 'mode', mode: 'ptt' })
  assert.deepEqual(send({ type: 'played', turn: 3, ms: 1250.7 }), { type: 'played', turn: 3, ms: 1250 })
  assert.deepEqual(send({ type: 'tool_result', id: 'abc_1', output: 'Grouped into three themes. Keep it?' }), { type: 'tool_result', id: 'abc_1', output: 'Grouped into three themes. Keep it?', ok: true })
  assert.equal(send({ type: 'tool_result', id: 'abc_1', output: '', ok: false }).ok, false)
  // an answer the screen has no words for is a code (the relay says it in the registry's words)
  for (const code of ANSWER_CODES) assert.deepEqual(send({ type: 'tool_result', id: 'abc_1', code }), { type: 'tool_result', id: 'abc_1', output: '', ok: true, code })
  assert.deepEqual(send({ type: 'pause' }), { type: 'pause' })
  assert.deepEqual(send({ type: 'end' }), { type: 'end' })
  // a Buffer or bytes of JSON read the same as text
  assert.equal(parseClientMessage(Buffer.from(JSON.stringify({ type: 'end' }))).type, 'end')
})

test('anything else is refused, with a reason, before it is acted on', () => {
  const refused = [
    'not json', '[]', '{"no":"type"}', { type: 'nope' }, { type: '__proto__' }, { type: 'constructor' },
    { type: 'hello', v: 1 }, { type: 'hello', ticket: 'short', v: 1 }, { type: 'hello', ticket: TICKET, v: 2 },
    { type: 'hello', ticket: TICKET, v: 1, mode: 'shout' }, { type: 'hello', ticket: TICKET, v: 1, resume: 'x' },
    { type: 'ptt', state: 'sideways' }, { type: 'mode', mode: 'loud' },
    { type: 'played', turn: -1, ms: 0 }, { type: 'played', turn: 1.5, ms: 0 }, { type: 'played', turn: 1, ms: -1 }, { type: 'played', turn: 1, ms: LIMITS.playedMs + 1 },
    // typed words are the surface's own message box, not a voice message
    { type: 'text', text: 'Group these notes' },
    { type: 'tool_result', id: 'bad id!', output: '' }, { type: 'tool_result', id: 'a', output: 'x'.repeat(LIMITS.toolOutput + 1) }, { type: 'tool_result', id: 'a', output: 3 },
    { type: 'tool_result', id: 'a', code: 'yes' }, { type: 'pause', now: true },
    { type: 'end', extra: true },
  ]
  for (const msg of refused) assert.throws(() => parseClientMessage(typeof msg === 'string' ? msg : JSON.stringify(msg)), VoiceProtocolError, JSON.stringify(msg))
  // the whole message is bounded too
  assert.throws(() => parseClientMessage(JSON.stringify({ type: 'tool_result', id: 'a', output: 'é'.repeat(9000) })), /at most 16384 bytes/)
})

test('the server messages the browser reads are checked the same way', () => {
  assert.equal(parseServerMessage(serverMessage('ready', { sessionId: 's1', v: 1, inRate: 16000, outRate: 24000, mode: 'open', resumed: false, limits: { maxMinutes: 30, idleSeconds: 300 } })).inRate, 16000)
  assert.equal(parseServerMessage(serverMessage('interrupt', { turn: 2 })).turn, 2)
  assert.equal(parseServerMessage(serverMessage('transcript', { turn: 0, role: 'user', text: 'hi', final: true })).role, 'user')
  assert.equal(parseServerMessage(serverMessage('activity', { kind: 'tool', state: 'started', name: TOOL_NAME })).kind, 'tool')
  assert.equal(parseServerMessage(serverMessage('tool', { id: 't1', name: TOOL_NAME, args: { text: 'hi' } })).name, TOOL_NAME)
  assert.equal(parseServerMessage(serverMessage('tool_cancel', { id: 't1' })).id, 't1')
  assert.equal(parseServerMessage(serverMessage('notice', { reason: 'limit', seconds: 60 })).reason, 'limit')
  assert.throws(() => parseServerMessage(serverMessage('notice', { reason: 'soon', seconds: 60 })), VoiceProtocolError)
  assert.equal(parseServerMessage(serverMessage('closing', { reason: 'moving', message: 'Reconnecting voice…', reconnect: { ticket: TICKET } })).reconnect.ticket, TICKET)
  assert.throws(() => parseServerMessage(serverMessage('closing', { reason: 'because', message: '' })), VoiceProtocolError)
  assert.throws(() => parseServerMessage(serverMessage('tool', { id: 't1', name: 'run_anything', args: {} })), VoiceProtocolError)
  // every closing reason has its close code; the application's own are 4000-4999
  for (const reason of CLOSING_REASONS) assert.ok(Number.isInteger(CLOSE_CODES[reason]), reason)
  assert.equal(VOICE_PATH, '/voice/ws')
  assert.equal(VOICE_PROTOCOL_VERSION, 1)
})

test('send_to_slatebox arguments: text and an optional keep or discard, as an object or JSON text', () => {
  assert.deepEqual(parseToolArgs({ text: 'group these' }), { text: 'group these' })
  assert.deepEqual(parseToolArgs('{"text":"yes","confirm":"keep"}'), { text: 'yes', confirm: 'keep' })
  assert.deepEqual(parseToolArgs({}), { text: '' }, 'empty text begins the interview')
  assert.throws(() => parseToolArgs({ text: 'x', confirm: 'maybe' }), /keep or discard/)
  assert.throws(() => parseToolArgs('{oops'), /not JSON/)
  assert.throws(() => parseToolArgs({ text: 'x'.repeat(LIMITS.text + 1) }), /at most/)
})

test('audio frames: a kind byte, the agent turn, then PCM16; odd, empty, oversized or unknown frames are refused', () => {
  const pcm = new Int16Array([0, 1, -1, 32767])
  const mic = encodeMicFrame(pcm)
  assert.equal(mic[0], FRAME.MIC)
  const read = decodeFrame(mic)
  assert.equal(read.kind, 'mic')
  assert.deepEqual([...new Int16Array(read.pcm.slice().buffer)], [0, 1, -1, 32767])
  const agent = encodeAgentFrame(7, new Uint8Array([1, 0, 2, 0]))
  assert.deepEqual(decodeFrame(agent), { kind: 'agent', turn: 7, pcm: new Uint8Array([1, 0, 2, 0]) })
  assert.deepEqual(decodeFrame(Buffer.from(agent)).turn, 7, 'a Node Buffer reads the same')
  assert.throws(() => decodeFrame(new Uint8Array([FRAME.MIC, 1, 2, 3])), /16-bit/)
  assert.throws(() => decodeFrame(new Uint8Array([FRAME.MIC])), /carries audio/)
  assert.throws(() => decodeFrame(new Uint8Array([9, 0, 0, 0])), /kind/)
  assert.throws(() => decodeFrame(new Uint8Array(LIMITS.micFrameBytes + 2).fill(1, 0, 1)), /at most/)
  assert.throws(() => encodeMicFrame(new Uint8Array(LIMITS.micFrameBytes)), /at most/)
  // 250 ms at 24 kHz is the largest mic frame
  assert.equal(pcmMs(LIMITS.micFrameBytes - 1, 24000), 250)
  assert.equal(pcmMs(640, 16000), 20)
})
