// The browser's side of a voice session, as pure rules: what the session is doing (the state the
// mic button and its captions show), the captions of both sides, which agent audio still plays,
// how much of a turn was heard, and every sentence the page says about voice. The audio itself is
// public/voice/voice-worklet.js; the socket and the microphone are imports/ui/voice. No Meteor, no
// DOM: the unit tests run this (scripts/voice-client.test.mjs).
//
// Words: "the agent", never "AI"; US spelling. Nothing here mentions paying: a refusal the pay
// sheet answers is shown with the app's own PayNotice, whose words are the meter's.
import { ANSWER_CODES, CLOSE_CODES, CLOSING_REASONS, CLOSING_WORDS, LIMITS, MODES, VOICE_PATH, parseToolArgs } from './voice-protocol.mjs'

export { CLOSING_WORDS }

/** Said on the page when the person's AI settings were saved (a conversation asks again whether voice is set up). */
export const AI_SETTINGS_EVENT = 'slatebox:ai-settings'

/** Where the audio worklet is served (Meteor serves public/ at the root); the version keeps a cached copy from an older protocol out. */
export const WORKLET_URL = '/voice/voice-worklet.js?v=1'
export const FRAME_MS = 20

/** The one-time note before the microphone first turns on. */
export const MIC_NOTE = 'Your voice goes to the agent\'s voice service while the mic is on. Slatebox keeps no audio. What the agent passes on for you is kept as text in this conversation.'

export const VOICE_WORDS = Object.freeze({
  start: 'Talk with the agent',
  carryOn: 'Carry on talking with the agent',
  stop: 'Turn off voice',
  starting: 'Starting voice…',
  reconnecting: 'Reconnecting voice…',
  openMic: 'Open mic',
  pushToTalk: 'Push to talk',
  hold: 'Hold to talk, or tap to start and stop',
  holding: 'Talking… release or tap to send',
  talk: 'Talk',
  noteOk: 'Turn on the mic',
  noteCancel: 'Not now',
  headphones: 'If the agent hears itself, use headphones or switch to push to talk.',
  echoPtt: 'Push to talk is on because the agent may hear itself here. Use headphones for open mic.',
  captionsOff: 'Captions of what you say are off for this connection.',
  paused: 'Voice paused while the page reloads. Press the mic within a minute to carry on.',
})

// A minute before voice turns off on its own (the relay's notice), as the person reads it.
export const NOTICE_WORDS = Object.freeze({
  limit: 'Voice turns off in a minute: this session is reaching its time limit.',
  idle: 'Voice turns off in a minute if nobody speaks.',
})

// What the session is doing, as the person reads it (and a screen reader hears it).
export const ACTIVITY_WORDS = Object.freeze({
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'The agent is speaking',
  tool: 'Working on it',
})


// What went wrong before a session could start, in plain words.
export const START_WORDS = Object.freeze({
  insecure: 'Voice needs a secure address: open Slatebox over https (or on this computer, at localhost).',
  unsupported: 'This browser cannot do voice. Try a current Chrome, Edge, Firefox or Safari.',
  micBlocked: 'Slatebox cannot hear you: the microphone is blocked. Allow it for this site in your browser, then try again.',
  micMissing: 'No microphone was found. Connect one and try again.',
  micBusy: 'The microphone is in use by another app. Close it and try again.',
  failed: 'Voice could not start. Try again.',
  connect: 'Voice could not connect. Check your connection and try again.',
})

/** A getUserMedia failure → its sentence. */
export function micError(error) {
  const name = error?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return START_WORDS.micBlocked
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return START_WORDS.micMissing
  if (name === 'NotReadableError' || name === 'AbortError') return START_WORDS.micBusy
  return START_WORDS.failed
}

/** The reason that goes with a WebSocket close code, when the socket closed with no closing message. */
export function reasonOfCode(code) {
  const found = Object.entries(CLOSE_CODES).find(([, value]) => value === code)
  if (found) return found[0]
  return 'lost'
}

/** The same-origin address of the relay. */
export function socketUrl(location, path = VOICE_PATH) {
  const secure = location.protocol === 'https:'
  return `${secure ? 'wss' : 'ws'}://${location.host}${path}`
}

/**
 * Whether playback goes through the loopback RTCPeerConnection: Chromium's echo cancellation hears
 * only WebRTC audio as what the speakers play (Chromium bug 687574); played through Web Audio
 * alone, the agent can hear itself and cut itself off. Firefox and Safari cancel Web Audio already.
 */
export function needsLoopback({ userAgent = '', brands = null, hasPeerConnection = false } = {}) {
  if (!hasPeerConnection) return false
  if (Array.isArray(brands) && brands.length) return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b?.brand || ''))
  if (/Firefox\//.test(userAgent)) return false
  return /Chrome\/|Chromium\/|Edg\//.test(userAgent)
}

// ---------- the session's state ----------
export const PHASES = Object.freeze(['idle', 'starting', 'connecting', 'live', 'reconnecting', 'ended'])

export const initialVoiceState = Object.freeze({
  phase: 'idle',
  mode: 'open',
  activity: null,
  tool: null,
  captions: [],
  pressed: false,
  inRate: null,
  outRate: null,
  sessionId: null,
  limits: null,
  closing: null,
  error: null,
  // playback could not go through the loopback, so the agent may hear itself (open mic)
  echoRisk: false,
  // whether what the person says comes back as captions on this connection (ready)
  userCaptions: true,
  // the agent turn still playing after it was made (the speakers, until it is heard)
  speakingTurn: null,
  // voice turns off soon (the relay's notice): its words
  notice: null,
  // what a screen reader is told next (a change of state, the person's own final words; the
  // agent's are heard already); `at` makes the same words repeatable
  announce: null,
})

const CAPTION_ROWS = 6
const said = (words, at) => ({ words, at })

/** The captions with one transcript row applied: one row per role and turn, partial rows growing until final. */
export function applyTranscript(captions, { role, turn, text, final }) {
  const key = `${role}:${turn}`
  const words = String(text || '').slice(-LIMITS.transcript)
  const at = captions.findIndex((row) => row.key === key)
  if (at >= 0) {
    if (captions[at].final && !final) return captions
    const next = captions.slice()
    next[at] = { ...captions[at], text: words, final: Boolean(final) }
    return next
  }
  if (!words.trim()) return captions
  return [...captions, { key, role, turn, text: words, final: Boolean(final) }].slice(-CAPTION_ROWS)
}

/** What a tool call is doing, in a few words (shown beside "Working on it"). */
export function toolSummary(args) {
  let parsed
  try {
    parsed = parseToolArgs(args)
  } catch {
    return ''
  }
  if (parsed.confirm === 'keep') return 'Keeping the change'
  if (parsed.confirm === 'discard') return 'Discarding the preview'
  const text = parsed.text.trim().replace(/\s+/g, ' ')
  if (!text) return 'Getting started'
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

/**
 * The session's next state. Events: { type: 'start' } | { type: 'connecting' } | { type: 'server', msg }
 * | { type: 'tool-start', id, args } | { type: 'tool-done', id } | { type: 'mode', mode }
 * | { type: 'press' } | { type: 'release' } | { type: 'echo-risk' } | { type: 'heard', turn } (an agent turn finished
 * playing) | { type: 'socket-closed', code } | { type: 'failed', error } | { type: 'stop' }. `now` (a number)
 * only keeps announcements distinct.
 */
export function voiceReducer(state, event, now = 0) {
  switch (event.type) {
    case 'start':
      if (state.phase !== 'idle' && state.phase !== 'ended') return state
      return { ...initialVoiceState, mode: state.mode, phase: 'starting', announce: said(VOICE_WORDS.starting, now) }
    case 'connecting':
      if (state.phase !== 'starting' && state.phase !== 'reconnecting') return state
      return { ...state, phase: state.phase === 'reconnecting' ? 'reconnecting' : 'connecting' }
    case 'server':
      return serverEvent(state, event.msg, now)
    case 'tool-start':
      if (!live(state)) return state
      return { ...state, activity: 'tool', tool: { id: event.id, summary: toolSummary(event.args) } }
    case 'tool-done':
      if (state.tool?.id !== event.id) return state
      return { ...state, tool: null, activity: state.activity === 'tool' ? 'thinking' : state.activity }
    case 'echo-risk':
      return state.echoRisk ? state : { ...state, echoRisk: true }
    case 'heard':
      // the agent's turn has played out: it is listening again
      if (state.activity !== 'speaking' || state.speakingTurn === null || event.turn < state.speakingTurn) return state
      return { ...state, activity: 'listening', speakingTurn: null }
    case 'mode':
      if (!MODES.includes(event.mode)) return state
      return { ...state, mode: event.mode, pressed: false }
    case 'press':
      if (state.mode !== 'ptt' || !live(state)) return state
      return { ...state, pressed: true }
    case 'release':
      return state.pressed ? { ...state, pressed: false } : state
    case 'socket-closed': {
      // (while reconnecting, the hook tries again and says so only when it gives up)
      if (state.phase === 'ended' || state.phase === 'idle') return state
      const reason = reasonOfCode(event.code)
      const message = CLOSING_WORDS[reason] || CLOSING_WORDS.lost
      return ended(state, { reason, message }, now)
    }
    case 'failed': {
      const error = { code: event.error?.code || 'failed', message: event.error?.message || START_WORDS.failed, ...(event.error?.pay && { pay: event.error.pay }), ...(event.error?.details && { details: event.error.details }) }
      return { ...ended(state, null, now), error, announce: said(error.message, now) }
    }
    case 'stop':
      if (state.phase === 'idle' || state.phase === 'ended') return state
      return ended(state, { reason: 'ended', message: CLOSING_WORDS.ended }, now)
    default:
      return state
  }
}

const live = (state) => state.phase === 'live'

function ended(state, closing, now) {
  return { ...state, phase: 'ended', activity: null, tool: null, pressed: false, speakingTurn: null, notice: null, closing, announce: closing ? said(closing.message, now) : state.announce }
}

function serverEvent(state, msg, now) {
  if (!msg || state.phase === 'ended' || state.phase === 'idle') return state
  switch (msg.type) {
    case 'ready': {
      // voice is on once: a reconnect (the server moved) carries on without saying it again
      const first = state.phase !== 'live' && state.phase !== 'reconnecting'
      const back = state.phase === 'reconnecting'
      return {
        ...state, phase: 'live', mode: msg.mode, inRate: msg.inRate, outRate: msg.outRate, sessionId: msg.sessionId, limits: msg.limits ?? null,
        userCaptions: msg.userCaptions !== false,
        activity: first || back ? 'listening' : state.activity, pressed: msg.mode === 'ptt' ? state.pressed : false, closing: null, error: null,
        announce: first ? said(msg.mode === 'ptt' ? `Voice is on. ${VOICE_WORDS.hold}.` : `Voice is on. ${ACTIVITY_WORDS.listening}.`, now) : state.announce,
      }
    }
    case 'notice': {
      const words = NOTICE_WORDS[msg.reason]
      if (!words || !live(state)) return state
      return { ...state, notice: words, announce: said(words, now) }
    }
    case 'activity': {
      if (!live(state)) return state
      if (msg.state === 'started') {
        // a tool keeps its own row until its answer goes back
        if (state.tool && msg.kind !== 'tool' && msg.kind !== 'speaking') return state
        return { ...state, activity: msg.kind }
      }
      if (msg.kind !== state.activity) return state
      if (msg.kind === 'tool') return { ...state, activity: 'thinking', tool: null }
      // made, but still playing: "speaking" until the speakers are done with it (heard)
      if (msg.kind === 'speaking') return Number.isInteger(msg.turn) ? { ...state, speakingTurn: msg.turn } : { ...state, activity: 'listening' }
      return { ...state, activity: null }
    }
    case 'transcript': {
      const captions = applyTranscript(state.captions, msg)
      // the person's own words are announced; the agent's are already being heard
      const mine = msg.role === 'user' && msg.final && msg.text?.trim()
      const activity = msg.role === 'user' && msg.final && live(state) && state.activity === 'listening' ? 'thinking' : state.activity
      // someone spoke: the quiet-stretch notice is past
      const notice = msg.role === 'user' && state.notice === NOTICE_WORDS.idle ? null : state.notice
      return {
        ...state, captions, activity, notice,
        announce: mine ? said(`You: ${msg.text.trim()}`, now) : state.announce,
      }
    }
    case 'interrupt':
      return live(state) ? { ...state, activity: 'listening', speakingTurn: null } : state
    case 'tool_cancel':
      return state.tool?.id === msg.id ? { ...state, tool: null, activity: 'listening' } : state
    case 'closing': {
      if (msg.reason === 'moving' && msg.reconnect?.ticket) {
        return { ...state, phase: 'reconnecting', activity: null, tool: null, pressed: false, announce: said(VOICE_WORDS.reconnecting, now) }
      }
      const reason = CLOSING_REASONS.includes(msg.reason) ? msg.reason : 'error'
      return ended(state, { reason, message: (typeof msg.message === 'string' && msg.message.trim()) || CLOSING_WORDS[reason] }, now)
    }
    default:
      return state
  }
}

/** Whether a mic frame goes to the relay now: live, and in push to talk only while held. */
export const sendsMic = (state) => state.phase === 'live' && (state.mode === 'open' || state.pressed)

/** The words for the state line under the mic button. */
export function statusLine(state) {
  if (state.phase === 'starting' || state.phase === 'connecting') return VOICE_WORDS.starting
  if (state.phase === 'reconnecting') return VOICE_WORDS.reconnecting
  if (state.phase !== 'live') return ''
  if (state.activity === 'tool') return state.tool?.summary ? `${ACTIVITY_WORDS.tool}: ${state.tool.summary}` : ACTIVITY_WORDS.tool
  if (state.mode === 'ptt' && !state.pressed && (state.activity === 'listening' || !state.activity)) return VOICE_WORDS.hold
  if (state.mode === 'ptt' && state.pressed) return VOICE_WORDS.holding
  return ACTIVITY_WORDS[state.activity] || ACTIVITY_WORDS.listening
}

// ---------- agent audio and what was heard ----------

/**
 * Which agent turns still play: after an interrupt names a turn, its frames still in flight (and
 * any older turn's) are dropped. → { cut(turn), plays(turn) }
 */
export function createTurnGate() {
  let cutAt = -1
  return {
    cut(turn) { if (Number.isInteger(turn) && turn > cutAt) cutAt = turn },
    plays(turn) { return Number.isInteger(turn) && turn > cutAt },
  }
}

/**
 * The played messages to send: one per agent turn (on an interrupt, or once a finished turn's last
 * sample has played), never twice. → { report(turn, ms) → { type: 'played', turn, ms } | null }
 */
export function createPlayedLedger({ keep = 64 } = {}) {
  const sent = new Set()
  return {
    report(turn, ms) {
      if (!Number.isInteger(turn) || turn < 0 || sent.has(turn)) return null
      sent.add(turn)
      if (sent.size > keep) sent.delete(sent.values().next().value)
      return { type: 'played', turn, ms: clampMs(ms) }
    },
  }
}

/** Milliseconds played, as the protocol takes them: whole, never negative, at most an hour. */
export const clampMs = (ms) => Math.max(0, Math.min(LIMITS.playedMs, Math.floor(Number(ms) || 0)))

/** How many milliseconds a number of samples lasts at a rate (what the worklet reports). */
export const samplesToMs = (samples, rate) => clampMs((samples * 1000) / rate)

// ---------- a tool call's answer ----------

/**
 * The tool_result for what the surface's submit answered (or threw): its text, or { code } (one of
 * ANSWER_CODES: the relay puts it in the registry's words). Nothing answered is busy, never empty.
 */
export function toolResult(id, outcome) {
  if (outcome && typeof outcome === 'object' && ANSWER_CODES.includes(outcome.code)) return { type: 'tool_result', id, code: outcome.code, ok: true }
  if (outcome === undefined || outcome === null || outcome === '') return { type: 'tool_result', id, code: 'busy', ok: true }
  if (outcome instanceof Error || (outcome && typeof outcome === 'object' && ('reason' in outcome || 'error' in outcome) && !('text' in outcome))) {
    const words = outcome.reason || outcome.message || ''
    return { type: 'tool_result', id, output: String(words).slice(0, LIMITS.toolOutput), ok: false }
  }
  const text = typeof outcome === 'string' ? outcome : outcome?.text ?? ''
  const ok = typeof outcome === 'object' && outcome !== null && outcome.ok === false ? false : true
  return { type: 'tool_result', id, output: String(text).slice(0, LIMITS.toolOutput), ok }
}

// ---------- open mic or push to talk, remembered ----------
export const MODE_KEY = 'slatebox:voice-mode'
/** The mode the person last chose on this device, or null. */
export function savedMode(storage) {
  try {
    const mode = storage?.getItem(MODE_KEY)
    return MODES.includes(mode) ? mode : null
  } catch { return null }
}
export function saveMode(storage, mode) {
  try { if (MODES.includes(mode)) storage?.setItem(MODE_KEY, mode) } catch { /* private browsing */ }
}
/** The mode a session starts in: the person's choice, else push to talk where the agent may hear itself. */
export const startMode = ({ saved = null, echoRisk = false } = {}) => saved || (echoRisk ? 'ptt' : 'open')

// ---------- carrying on after a reload ----------
export const CARRY_KEY = 'slatebox:voice-carry'
const CARRY_MS = 55_000
const carryKey = (surface, shareId) => `${surface}:${shareId || ''}`
/** A ticket to carry on the same conversation after a reload (sessionStorage: this tab only). */
export function saveCarry(storage, { surface, shareId = null, ticket, mode }, now = Date.now()) {
  try { storage?.setItem(CARRY_KEY, JSON.stringify({ key: carryKey(surface, shareId), ticket, mode, until: now + CARRY_MS })) } catch { /* the next press starts afresh */ }
}
/** The ticket saved for this surface, still good, or null (it is read, not taken: takeCarry takes it). */
export function peekCarry(storage, { surface, shareId = null }, now = Date.now()) {
  try {
    const saved = JSON.parse(storage?.getItem(CARRY_KEY) || 'null')
    if (!saved || saved.key !== carryKey(surface, shareId) || !(saved.until > now) || typeof saved.ticket !== 'string') return null
    return { ticket: saved.ticket, mode: MODES.includes(saved.mode) ? saved.mode : null }
  } catch { return null }
}
export function takeCarry(storage, where, now = Date.now()) {
  const found = peekCarry(storage, where, now)
  try { storage?.removeItem(CARRY_KEY) } catch { /* gone */ }
  return found
}

// ---------- the mic note ----------
export const NOTE_KEY = 'slatebox:voice-mic-note'
/** Whether the one-time mic note was already accepted on this device. */
export function noteSeen(storage) {
  try { return storage?.getItem(NOTE_KEY) === '1' } catch { return false }
}
export function rememberNote(storage) {
  try { storage?.setItem(NOTE_KEY, '1') } catch { /* private browsing: the note shows again next time */ }
}
