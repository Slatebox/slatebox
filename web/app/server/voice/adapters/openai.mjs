// OpenAI Realtime (WebSocket, server to server) behind the voice client protocol. Pure: messages
// in, events out; the relay (session.mjs) owns the socket. Source of the shapes: the Realtime
// WebSocket, conversations, VAD and transcription guides and the client and server event reference
// (https://developers.openai.com/api/docs/guides/realtime-websocket, 2026-11-26).
//
//   up:   session.update (first), input_audio_buffer.append (PCM16 24 kHz, base64), .commit and
//         .clear (push to talk), conversation.item.create (words from the relay, a
//         function_call_output, the opening and what was said before a move as user items: they are
//         registry prompts of kind user, and what was said is untrusted), response.create, response.cancel,
//         conversation.item.truncate (how much of an interrupted answer was heard)
//   down: session.updated, response.created, response.output_audio.delta,
//         response.output_audio_transcript.delta / .done,
//         conversation.item.input_audio_transcription.delta / .completed,
//         input_audio_buffer.speech_started, response.done (function calls and usage), error
// The key goes in the Authorization header. A session lasts at most 60 minutes and cannot be
// resumed: a session that moves starts again with what was said (voice.resume).

import { b64 } from './gemini.mjs'

export const PROTOCOL = 'openai-realtime'
export const IN_RATE = 24000
export const OUT_RATE = 24000
// OpenAI says when a transcript is final (.completed, .done); the relay never guesses it
export const EXPLICIT_FINALS = true
// A Realtime session lasts at most 60 minutes: the relay moves it to a new one before then
export const MAX_MINUTES = 60
/** Whether what the person says comes back as captions: only with a transcription model. */
export const userCaptions = (config) => Boolean(config?.transcriptionModel)
const FORMAT = Object.freeze({ type: 'audio/pcm', rate: 24000 })
// Open mic: the model decides when the person finished by what they said (semantic VAD), and
// speaking over it cuts its answer (interrupt_response, the default).
const OPEN_MIC = Object.freeze({ type: 'semantic_vad' })

const turnDetection = (mode) => (mode === 'ptt' ? null : { ...OPEN_MIC })

/** Where to connect: { url, headers }. baseUrl: wss://…/v1/realtime. */
export function connectInfo({ baseUrl, apiKey, model }) {
  return { url: `${baseUrl.replace(/\/+$/, '')}?model=${encodeURIComponent(model)}`, headers: { Authorization: `Bearer ${apiKey}` } }
}

/**
 * The first message. config: { model, voice, instructions, tool, mode, transcriptionModel? }.
 */
export function setup(config) {
  const input = { format: { ...FORMAT }, turn_detection: turnDetection(config.mode) }
  if (config.transcriptionModel) input.transcription = { model: config.transcriptionModel }
  const output = { format: { ...FORMAT } }
  if (config.voice) output.voice = config.voice
  return [{
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: config.instructions,
      output_modalities: ['audio'],
      audio: { input, output },
      tools: [{ type: 'function', name: config.tool.name, description: config.tool.description, parameters: config.tool.parameters }],
      tool_choice: 'auto',
    },
  }]
}

const userItem = (text) => ({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })

/**
 * What to send once the session is ready: what was said before a move (voice.resume, then wait for
 * the person), or the opening and a response.
 */
export function begin(config) {
  if (config.resumeText) return [userItem(config.resumeText)]
  if (!config.opening) return []
  return [userItem(config.opening), { type: 'response.create' }]
}

export const audio = (pcm) => ({ type: 'input_audio_buffer.append', audio: b64(pcm) })
// words the relay adds mid-session (a late answer), answered at once
export const text = (value) => [userItem(value), { type: 'response.create' }]
export function ptt(state, { speaking = false } = {}) {
  if (state === 'down') return [...(speaking ? [{ type: 'response.cancel' }] : []), { type: 'input_audio_buffer.clear' }]
  return [{ type: 'input_audio_buffer.commit' }, { type: 'response.create' }]
}
export const mode = (next) => ({ messages: [{ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: turnDetection(next) } } } }] })
export const played = ({ itemId, ms }) => (itemId ? [{ type: 'conversation.item.truncate', item_id: itemId, content_index: 0, audio_end_ms: ms }] : [])
export const cancel = () => [{ type: 'response.cancel' }]
export const toolResult = ({ callId, output }) => [
  { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } },
  { type: 'response.create' },
]

// response.done usage: { input_tokens, output_tokens, input_token_details: { text_tokens,
// audio_tokens, cached_tokens, cached_tokens_details: { text_tokens, audio_tokens } },
// output_token_details: { text_tokens, audio_tokens } }
function usageOf(usage) {
  const n = (value) => Number(value) || 0
  const input = usage.input_token_details || {}
  const output = usage.output_token_details || {}
  const cached = input.cached_tokens_details || {}
  return {
    audioIn: Math.max(0, n(input.audio_tokens) - n(cached.audio_tokens)),
    cachedAudioIn: n(cached.audio_tokens),
    // cached text is priced as text (no cached text rate is kept)
    textIn: n(input.text_tokens),
    audioOut: n(output.audio_tokens),
    textOut: n(output.text_tokens),
  }
}

/**
 * One provider message → provider-neutral events (see gemini.mjs read), plus
 * response-started { responseId } and audio { pcm, itemId, responseId }.
 */
export function read(msg) {
  const out = []
  if (!msg || typeof msg.type !== 'string') return out
  switch (msg.type) {
    case 'session.updated': out.push({ type: 'ready' }); break
    case 'response.created': out.push({ type: 'response-started', responseId: msg.response?.id ?? null }); break
    case 'response.output_audio.delta':
      if (msg.delta) out.push({ type: 'audio', pcm: Buffer.from(msg.delta, 'base64'), itemId: msg.item_id ?? null, responseId: msg.response_id ?? null })
      break
    case 'response.output_audio_transcript.delta':
      if (msg.delta) out.push({ type: 'transcript', role: 'agent', text: msg.delta, final: false, responseId: msg.response_id ?? null })
      break
    case 'response.output_audio_transcript.done':
      out.push({ type: 'transcript', role: 'agent', text: msg.transcript ?? '', final: true, responseId: msg.response_id ?? null })
      break
    case 'conversation.item.input_audio_transcription.delta':
      if (msg.delta) out.push({ type: 'transcript', role: 'user', text: msg.delta, final: false, itemId: msg.item_id ?? null })
      break
    case 'conversation.item.input_audio_transcription.completed':
      out.push({ type: 'transcript', role: 'user', text: msg.transcript ?? '', final: true, itemId: msg.item_id ?? null })
      break
    case 'input_audio_buffer.speech_started': out.push({ type: 'speech-started' }); break
    case 'response.done': {
      const response = msg.response || {}
      for (const item of response.output || []) {
        if (item?.type === 'function_call') out.push({ type: 'tool-call', callId: String(item.call_id ?? ''), name: item.name, args: item.arguments ?? '{}', responseId: response.id ?? null })
      }
      if (response.usage) out.push({ type: 'usage', usage: usageOf(response.usage) })
      out.push({ type: 'turn-done', responseId: response.id ?? null, status: response.status ?? null })
      break
    }
    case 'error': out.push({ type: 'error', message: String(msg.error?.message || 'The voice provider reported an error.').slice(0, 300), code: msg.error?.code ?? null }); break
    default: break
  }
  return out
}
