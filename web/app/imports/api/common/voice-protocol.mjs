// The voice client protocol: what the browser and the relay (server/voice) say to each other over
// the one full-duplex WebSocket at /voice/ws, whichever provider an administrator or the person
// chose (OpenAI Realtime or Gemini Live: the relay maps both to this). Shared by the browser and
// the server, so both validate the same shapes with the same limits. Pure: no Meteor, no Node
// Buffer (Uint8Array and DataView only), no dependency.
//
// Audio is binary frames. Byte 0 is the kind:
//   0x01 mic audio, browser → server: PCM16 little-endian mono at ready.inRate, 20 to 250 ms a frame
//   0x02 agent audio, server → browser: then a uint32 little-endian agent turn number, then PCM16
//        little-endian mono at ready.outRate
// Everything else is one JSON object a text frame, with a type:
//
//   browser → server
//     hello        { ticket, v, mode: 'open' | 'ptt' }      the first message, within 10 s
//     ptt          { state: 'down' | 'up' }                 push to talk (mode ptt)
//     mode         { mode: 'open' | 'ptt' }                 switch between open mic and push to talk
//     played       { turn, ms }                             how much of an agent turn was heard (on
//                                                           interrupt and at the end of a turn)
//     tool_result  { id, output?, ok?, code? }              the answer of a tool call: the screen's own
//                                                           text, or a code (ANSWER_CODES) the relay
//                                                           puts in the registry's words
//     pause        {}                                       the page is about to reload: hand over a
//                                                           ticket to carry on after it (closing moving)
//     end          {}                                       the person ended the session
//   server → browser
//     ready        { sessionId, v, inRate, outRate, mode, resumed, userCaptions,
//                    limits: { maxMinutes, idleSeconds } }  userCaptions: whether what the person says
//                                                           comes back as captions on this connection
//     notice       { reason: 'limit' | 'idle', seconds }   voice turns off in that many seconds
//     interrupt    { turn }                                 the person spoke over the agent: flush playback
//     transcript   { turn, role: 'user' | 'agent', text, final }
//     activity     { kind: 'listening' | 'thinking' | 'speaking' | 'tool', state: 'started' | 'done' | 'failed',
//                    turn?, name?, summary? }
//     tool         { id, name, args }                       run args through the surface's own submit, then
//                                                           answer with tool_result
//     tool_cancel  { id }                                   the agent no longer waits for that answer
//     closing      { reason, message, reconnect? }          the session ends; reconnect { ticket } to carry
//                                                           on (reason moving), within its 60 s
// Keepalive is WebSocket ping and pong (the relay pings every 20 s).

export const VOICE_PROTOCOL_VERSION = 1
export const VOICE_PATH = '/voice/ws'
export const FRAME = Object.freeze({ MIC: 0x01, AGENT: 0x02 })
export const MODES = Object.freeze(['open', 'ptt'])
export const ROLES = Object.freeze(['user', 'agent'])
export const ACTIVITY_KINDS = Object.freeze(['listening', 'thinking', 'speaking', 'tool'])
export const ACTIVITY_STATES = Object.freeze(['started', 'done', 'failed'])
// Why a session ends: ended (either side ended it), cap (the spend cap or the person's credits),
// idle (nobody spoke for a while), moving (this server is restarting: reconnect), limit (the
// session's time limit), busy (this server has as many sessions as it takes), denied (no valid
// ticket), unavailable (no voice model, or the provider refused), error (anything else).
export const CLOSING_REASONS = Object.freeze(['ended', 'cap', 'idle', 'moving', 'limit', 'busy', 'denied', 'unavailable', 'error'])
// The WebSocket close code that goes with each reason (4000-4999 are the application's own).
export const CLOSE_CODES = Object.freeze({
  ended: 1000, cap: 4002, idle: 4003, moving: 4004, limit: 4005, busy: 4006, denied: 4401, unavailable: 4503, error: 1011,
})
export const TOOL_NAME = 'send_to_slatebox'
export const TOOL_CONFIRM = Object.freeze(['keep', 'discard'])
// What a tool call's answer can be instead of the screen's own text (the relay puts each in the
// registry's words, prompts voice.answer.<code>): nothing waiting to keep or discard, the preview
// discarded, a keep the person has not said yes to since it was offered (the relay checks that
// itself), no words to pass on, and a surface that could not take the request just then.
export const ANSWER_CODES = Object.freeze(['none', 'discarded', 'unconfirmed', 'empty', 'busy'])
export const NOTICE_REASONS = Object.freeze(['limit', 'idle'])

// What the person reads when a session ends (the relay sends it; the browser falls back to it).
export const CLOSING_WORDS = Object.freeze({
  ended: 'Voice ended.',
  cap: 'Voice stopped: it is not available on your account right now.',
  denied: 'This voice session could not be opened. Turn voice on again.',
  busy: 'This server is talking with as many people as it can. Try voice again in a minute.',
  another: 'Voice is already on in another tab or window. Turn it off there to talk here.',
  idle: 'Voice turned off after a quiet stretch.',
  limit: 'This voice session reached its time limit. Turn voice on again to carry on.',
  moving: 'Reconnecting voice…',
  unavailable: 'Voice is not available right now. Try again in a minute.',
  error: 'Voice stopped because of a problem. Try again.',
  slow: 'Voice stopped: the connection is too slow for it.',
  unreadable: 'Voice stopped: a message from this page could not be read.',
  flood: 'Voice stopped: this page sent more messages than a conversation needs.',
  lost: 'The voice connection was lost. Turn voice on again to carry on.',
})

export const LIMITS = Object.freeze({
  // one JSON text frame, either way
  messageBytes: 16 * 1024,
  ticket: 128,
  text: 4000,
  toolOutput: 8000,
  transcript: 8000,
  message: 500,
  id: 64,
  // mic frames: at most 250 ms at 24 kHz (12,000 bytes of PCM16) plus the kind byte
  micFrameBytes: 1 + 12000,
  // agent frames: kind byte, turn number, then PCM16 (a provider chunk can be long: up to 2 s at 24 kHz)
  agentFrameBytes: 5 + 96000,
  turn: 0xffffffff,
  playedMs: 60 * 60 * 1000,
})

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isText = (value, max, { empty = false } = {}) => typeof value === 'string' && value.length <= max && (empty || value.length > 0)
const isTurn = (value) => Number.isInteger(value) && value >= 0 && value <= LIMITS.turn
const ID = /^[A-Za-z0-9_-]{1,64}$/
const TICKET = /^[A-Za-z0-9_-]{16,128}$/

export class VoiceProtocolError extends Error {
  constructor(message) {
    super(message)
    this.name = 'VoiceProtocolError'
  }
}

const textBytes = (text) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length * 3)
const toText = (data) => {
  if (typeof data === 'string') return data
  if (data instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer)) return new TextDecoder().decode(data)
  return null
}

function parseJson(data) {
  const text = toText(data)
  if (text === null) throw new VoiceProtocolError('A message is JSON text.')
  if (textBytes(text) > LIMITS.messageBytes) throw new VoiceProtocolError(`A message is at most ${LIMITS.messageBytes} bytes.`)
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    throw new VoiceProtocolError('A message is JSON text.')
  }
  if (!isObject(msg) || typeof msg.type !== 'string') throw new VoiceProtocolError('A message is an object with a type.')
  return msg
}

const only = (msg, keys) => {
  const extra = Object.keys(msg).find((key) => key !== 'type' && !keys.includes(key))
  if (extra) throw new VoiceProtocolError(`${msg.type} takes no ${String(extra).slice(0, 40)}.`)
}

// ---------- browser → server ----------
const CLIENT = {
  hello(msg) {
    only(msg, ['ticket', 'v', 'mode'])
    if (typeof msg.ticket !== 'string' || !TICKET.test(msg.ticket)) throw new VoiceProtocolError('hello carries the ticket voice.open gave.')
    if (msg.v !== VOICE_PROTOCOL_VERSION) throw new VoiceProtocolError(`This server speaks voice protocol ${VOICE_PROTOCOL_VERSION}.`)
    const mode = msg.mode ?? 'open'
    if (!MODES.includes(mode)) throw new VoiceProtocolError('mode is open or ptt.')
    return { type: 'hello', ticket: msg.ticket, v: msg.v, mode }
  },
  ptt(msg) {
    only(msg, ['state'])
    if (!['down', 'up'].includes(msg.state)) throw new VoiceProtocolError('ptt state is down or up.')
    return { type: 'ptt', state: msg.state }
  },
  mode(msg) {
    only(msg, ['mode'])
    if (!MODES.includes(msg.mode)) throw new VoiceProtocolError('mode is open or ptt.')
    return { type: 'mode', mode: msg.mode }
  },
  played(msg) {
    only(msg, ['turn', 'ms'])
    if (!isTurn(msg.turn)) throw new VoiceProtocolError('played names the agent turn.')
    if (!Number.isFinite(msg.ms) || msg.ms < 0 || msg.ms > LIMITS.playedMs) throw new VoiceProtocolError('played ms is how many milliseconds of the turn were heard.')
    return { type: 'played', turn: msg.turn, ms: Math.floor(msg.ms) }
  },
  tool_result(msg) {
    only(msg, ['id', 'output', 'ok', 'code'])
    if (typeof msg.id !== 'string' || !ID.test(msg.id)) throw new VoiceProtocolError('tool_result names the tool call id.')
    const output = msg.output ?? ''
    if (!isText(output, LIMITS.toolOutput, { empty: true })) throw new VoiceProtocolError(`tool_result output is text of at most ${LIMITS.toolOutput} characters.`)
    if (msg.ok !== undefined && typeof msg.ok !== 'boolean') throw new VoiceProtocolError('tool_result ok is true or false.')
    if (msg.code !== undefined && !ANSWER_CODES.includes(msg.code)) throw new VoiceProtocolError(`tool_result code is one of ${ANSWER_CODES.join(', ')}.`)
    return { type: 'tool_result', id: msg.id, output, ok: msg.ok !== false, ...(msg.code && { code: msg.code }) }
  },
  pause(msg) {
    only(msg, [])
    return { type: 'pause' }
  },
  end(msg) {
    only(msg, [])
    return { type: 'end' }
  },
}

/** A browser message, checked. → the message with only its own fields. Throws VoiceProtocolError. */
export function parseClientMessage(data) {
  const msg = parseJson(data)
  const read = Object.hasOwn(CLIENT, msg.type) ? CLIENT[msg.type] : null
  if (!read) throw new VoiceProtocolError(`${String(msg.type).slice(0, 40)} is not a voice message.`)
  return read(msg)
}

// ---------- server → browser ----------
const SERVER = {
  ready(msg) {
    if (typeof msg.sessionId !== 'string' || !ID.test(msg.sessionId)) throw new VoiceProtocolError('ready names the session.')
    if (!Number.isInteger(msg.inRate) || !Number.isInteger(msg.outRate)) throw new VoiceProtocolError('ready gives the audio rates.')
    if (!MODES.includes(msg.mode)) throw new VoiceProtocolError('ready gives the mode.')
    return msg
  },
  interrupt(msg) {
    if (!isTurn(msg.turn)) throw new VoiceProtocolError('interrupt names the agent turn.')
    return msg
  },
  notice(msg) {
    if (!NOTICE_REASONS.includes(msg.reason) || !Number.isInteger(msg.seconds) || msg.seconds < 0) throw new VoiceProtocolError('notice is { reason, seconds }.')
    return msg
  },
  transcript(msg) {
    if (!isTurn(msg.turn) || !ROLES.includes(msg.role) || !isText(msg.text, LIMITS.transcript, { empty: true }) || typeof msg.final !== 'boolean') throw new VoiceProtocolError('transcript is { turn, role, text, final }.')
    return msg
  },
  activity(msg) {
    if (!ACTIVITY_KINDS.includes(msg.kind) || !ACTIVITY_STATES.includes(msg.state)) throw new VoiceProtocolError('activity is { kind, state }.')
    return msg
  },
  tool(msg) {
    if (typeof msg.id !== 'string' || !ID.test(msg.id) || msg.name !== TOOL_NAME || !isObject(msg.args)) throw new VoiceProtocolError('tool is { id, name, args }.')
    return msg
  },
  tool_cancel(msg) {
    if (typeof msg.id !== 'string' || !ID.test(msg.id)) throw new VoiceProtocolError('tool_cancel names the tool call id.')
    return msg
  },
  closing(msg) {
    if (!CLOSING_REASONS.includes(msg.reason) || typeof msg.message !== 'string') throw new VoiceProtocolError('closing is { reason, message }.')
    return msg
  },
}

/** A server message as the browser reads it, checked. Throws VoiceProtocolError. */
export function parseServerMessage(data) {
  const msg = parseJson(data)
  const read = Object.hasOwn(SERVER, msg.type) ? SERVER[msg.type] : null
  if (!read) throw new VoiceProtocolError(`${String(msg.type).slice(0, 40)} is not a voice message.`)
  return read(msg)
}

/** The arguments of a send_to_slatebox call, checked: { text, confirm? }. Throws VoiceProtocolError. */
export function parseToolArgs(args) {
  let value = args
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value || '{}')
    } catch {
      throw new VoiceProtocolError('The tool arguments are not JSON.')
    }
  }
  if (!isObject(value)) throw new VoiceProtocolError('The tool arguments are an object.')
  const text = value.text ?? ''
  if (typeof text !== 'string' || text.length > LIMITS.text) throw new VoiceProtocolError(`text is at most ${LIMITS.text} characters.`)
  if (value.confirm !== undefined && value.confirm !== null && !TOOL_CONFIRM.includes(value.confirm)) throw new VoiceProtocolError('confirm is keep or discard.')
  return { text, ...(value.confirm && { confirm: value.confirm }) }
}

// ---------- binary audio ----------
const bytesOf = (data) => {
  if (data instanceof Uint8Array) return data
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView?.(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new VoiceProtocolError('An audio frame is bytes.')
}

/** A mic frame (browser): the kind byte and the PCM16 bytes. pcm: Int16Array or bytes. → Uint8Array */
export function encodeMicFrame(pcm) {
  const bytes = pcm instanceof Int16Array ? new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) : bytesOf(pcm)
  if (bytes.length + 1 > LIMITS.micFrameBytes) throw new VoiceProtocolError(`A mic frame is at most ${LIMITS.micFrameBytes} bytes.`)
  const out = new Uint8Array(bytes.length + 1)
  out[0] = FRAME.MIC
  out.set(bytes, 1)
  return out
}

/** An agent frame (server): the kind byte, the turn and the PCM16 bytes. → Uint8Array */
export function encodeAgentFrame(turn, pcm) {
  const bytes = bytesOf(pcm)
  if (!isTurn(turn)) throw new VoiceProtocolError('An agent frame names its turn.')
  const out = new Uint8Array(bytes.length + 5)
  out[0] = FRAME.AGENT
  new DataView(out.buffer).setUint32(1, turn, true)
  out.set(bytes, 5)
  return out
}

/**
 * A binary frame, checked: { kind: 'mic', pcm } or { kind: 'agent', turn, pcm } (pcm: the PCM16
 * bytes, an even number of them, never empty). Throws VoiceProtocolError.
 */
export function decodeFrame(data) {
  const bytes = bytesOf(data)
  if (bytes.length < 3) throw new VoiceProtocolError('An audio frame carries audio.')
  if (bytes[0] === FRAME.MIC) {
    if (bytes.length > LIMITS.micFrameBytes) throw new VoiceProtocolError(`A mic frame is at most ${LIMITS.micFrameBytes} bytes.`)
    const pcm = bytes.subarray(1)
    if (pcm.length % 2) throw new VoiceProtocolError('Mic audio is 16-bit samples.')
    return { kind: 'mic', pcm }
  }
  if (bytes[0] === FRAME.AGENT) {
    if (bytes.length < 7 || bytes.length > LIMITS.agentFrameBytes) throw new VoiceProtocolError('An agent frame is a turn and audio.')
    const turn = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, true)
    const pcm = bytes.subarray(5)
    if (pcm.length % 2) throw new VoiceProtocolError('Agent audio is 16-bit samples.')
    return { kind: 'agent', turn, pcm }
  }
  throw new VoiceProtocolError('An audio frame starts with its kind.')
}

/** Milliseconds of PCM16 mono audio in a number of bytes at a rate. */
export const pcmMs = (bytes, rate) => Math.floor((bytes / 2) * 1000 / rate)

/** A server message as JSON text, for the relay. */
export const serverMessage = (type, fields = {}) => JSON.stringify({ type, ...fields })
