// Gemini Live (BidiGenerateContent) behind the voice client protocol. Pure: messages in, events
// out; the relay (session.mjs) owns the socket. Source of the shapes: the Live API reference
// (https://aistudio.google.com/api-reference/live), its capabilities, tools and session-management
// guides (2026-11-26).
//
//   up:   setup (first, then nothing until setupComplete), realtimeInput.audio (PCM16 16 kHz),
//         realtimeInput.activityStart / activityEnd (push to talk: automatic detection off),
//         realtimeInput.text (words from the relay mid-session), clientContent (only the first
//         turn: the opening, or what was said before a move), toolResponse.functionResponses
//   down: setupComplete, serverContent (modelTurn audio PCM16 24 kHz, interrupted, turnComplete,
//         inputTranscription, outputTranscription), toolCall, toolCallCancellation, goAway,
//         sessionResumptionUpdate, usageMetadata
// The key goes in the x-goog-api-key header (never the URL, which proxies log). Sessions are
// unlimited with sliding-window compression; a goAway or a mode switch moves to a new connection
// with the latest resumption handle (session.mjs).

export const PROTOCOL = 'gemini-live'
export const IN_RATE = 16000
export const OUT_RATE = 24000
// Gemini's transcripts come in pieces with no final mark: a turn's text is final when the turn ends
export const EXPLICIT_FINALS = false
// No limit on a session's length (sliding-window compression; goAway moves it to a new connection)
export const MAX_MINUTES = null
/** Whether what the person says comes back as captions (inputAudioTranscription is always on). */
export const userCaptions = () => true
const PATH = '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

// Gemini's function declarations take the OpenAPI subset with upper-case types.
function geminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue
    if (key === 'type' && typeof value === 'string') out.type = value.toUpperCase()
    else if (key === 'properties') out.properties = Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, geminiSchema(inner)]))
    else if (key === 'items') out.items = geminiSchema(value)
    else out[key] = value
  }
  return out
}

export const b64 = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
const modelName = (model) => (model.startsWith('models/') ? model : `models/${model}`)

/** Where to connect: { url, headers }. baseUrl: the provider's wss origin. */
export function connectInfo({ baseUrl, apiKey }) {
  return { url: `${baseUrl.replace(/\/+$/, '')}${PATH}`, headers: { 'x-goog-api-key': apiKey } }
}

/**
 * The first message. config: { model, voice, instructions, tool: { name, description, parameters },
 * mode, resumeHandle? }.
 */
export function setup(config) {
  const generationConfig = { responseModalities: ['AUDIO'] }
  if (config.voice) generationConfig.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } } }
  return [{
    setup: {
      model: modelName(config.model),
      generationConfig,
      systemInstruction: { parts: [{ text: config.instructions }] },
      // NON_BLOCKING: the agent may say "One moment" while the slate's own path works; the answer
      // is taken when it is idle (toolResult's scheduling WHEN_IDLE)
      tools: [{ functionDeclarations: [{ name: config.tool.name, description: config.tool.description, parameters: geminiSchema(config.tool.parameters), behavior: 'NON_BLOCKING' }] }],
      realtimeInputConfig: config.mode === 'ptt' ? { automaticActivityDetection: { disabled: true } } : {},
      sessionResumption: config.resumeHandle ? { handle: config.resumeHandle } : {},
      contextWindowCompression: { slidingWindow: {} },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  }]
}

/**
 * What to send once the session is ready: nothing when it carries on from a handle (Gemini has the
 * conversation); what was said so far (voice.resume) when it carries on without one, as history
 * that waits for the person (turnComplete false); else the opening, which starts the turn.
 */
export function begin(config) {
  if (config.resumeHandle) return []
  if (config.resumeText) return [{ clientContent: { turns: [{ role: 'user', parts: [{ text: config.resumeText }] }], turnComplete: false } }]
  if (!config.opening) return []
  return [{ clientContent: { turns: [{ role: 'user', parts: [{ text: config.opening }] }], turnComplete: true } }]
}

export const audio = (pcm) => ({ realtimeInput: { audio: { data: b64(pcm), mimeType: `audio/pcm;rate=${IN_RATE}` } } })
// words the relay adds mid-session (a late answer): realtime input, as the person's are
export const text = (value) => [{ realtimeInput: { text: value } }]
export const ptt = (state) => [{ realtimeInput: state === 'down' ? { activityStart: {} } : { activityEnd: {} } }]
// automatic detection is part of setup: a new mode is a new connection (resumed with the handle)
export const mode = () => ({ reconnect: true })
// Gemini truncates its own history on an interruption; how much was heard changes nothing here
export const played = () => []
export const cancel = () => []
export const toolResult = ({ callId, name, output }) => [{
  toolResponse: { functionResponses: [{ id: callId, name, response: { output }, scheduling: 'WHEN_IDLE' }] },
}]

// usageMetadata by modality: { promptTokenCount, responseTokenCount, toolUsePromptTokenCount,
// thoughtsTokenCount, promptTokensDetails: [{ modality, tokenCount }], responseTokensDetails }
function usageOf(meta) {
  const sum = (list, modality) => (Array.isArray(list) ? list : []).filter((d) => d?.modality === modality).reduce((n, d) => n + (Number(d.tokenCount) || 0), 0)
  const audioIn = sum(meta.promptTokensDetails, 'AUDIO')
  const audioOut = sum(meta.responseTokensDetails, 'AUDIO')
  const prompt = Number(meta.promptTokenCount) || 0
  const response = Number(meta.responseTokenCount) || 0
  return {
    audioIn, audioOut,
    textIn: Math.max(0, prompt - audioIn) + (Number(meta.toolUsePromptTokenCount) || 0),
    textOut: Math.max(0, response - audioOut) + (Number(meta.thoughtsTokenCount) || 0),
    cachedAudioIn: 0,
  }
}

const seconds = (value) => {
  const match = typeof value === 'string' && /^(\d+(?:\.\d+)?)s$/.exec(value)
  return match ? Math.round(Number(match[1]) * 1000) : null
}

/**
 * One provider message → provider-neutral events:
 *   ready | audio { pcm } | interrupted | transcript { role, text, final } | turn-done |
 *   tool-call { callId, name, args } | tool-cancel { callIds } | go-away { timeLeftMs } |
 *   resume-handle { handle } | usage { usage } | speech-started | error { message }
 */
export function read(msg) {
  const out = []
  if (!msg || typeof msg !== 'object') return out
  if (msg.setupComplete) out.push({ type: 'ready' })
  const content = msg.serverContent
  if (content) {
    if (content.interrupted) out.push({ type: 'interrupted' })
    if (content.inputTranscription?.text) out.push({ type: 'transcript', role: 'user', text: content.inputTranscription.text, final: false })
    for (const part of content.modelTurn?.parts || []) {
      if (part?.inlineData?.data && /^audio\/pcm/.test(part.inlineData.mimeType || 'audio/pcm')) out.push({ type: 'audio', pcm: Buffer.from(part.inlineData.data, 'base64') })
    }
    if (content.outputTranscription?.text) out.push({ type: 'transcript', role: 'agent', text: content.outputTranscription.text, final: false })
    if (content.turnComplete) out.push({ type: 'turn-done' })
  }
  for (const call of msg.toolCall?.functionCalls || []) out.push({ type: 'tool-call', callId: String(call.id ?? ''), name: call.name, args: call.args ?? {} })
  if (Array.isArray(msg.toolCallCancellation?.ids)) out.push({ type: 'tool-cancel', callIds: msg.toolCallCancellation.ids.map(String) })
  if (msg.goAway) out.push({ type: 'go-away', timeLeftMs: seconds(msg.goAway.timeLeft) })
  const update = msg.sessionResumptionUpdate
  if (update?.resumable && update.newHandle) out.push({ type: 'resume-handle', handle: update.newHandle })
  if (msg.usageMetadata) out.push({ type: 'usage', usage: usageOf(msg.usageMetadata) })
  if (msg.voiceActivity?.voiceActivityType === 'ACTIVITY_START') out.push({ type: 'speech-started' })
  return out
}
