// One voice session in the relay: the browser's socket on one side, the provider's on the other.
// The browser speaks the voice client protocol (imports/api/common/voice-protocol.mjs); the
// provider speaks its own (adapters/*.mjs map both ways). Keys, prompts, the tool, transcripts and
// spend stay here: the browser sees audio, transcript rows, activity and tool calls, never a key,
// a prompt or the provider's own messages.
//
// The life of a session:
//   1. hello { ticket } within 5 s, else closing denied. The ticket is taken once (tickets.mjs).
//      Only then does the session count toward the server's and the person's limits (admit: the
//      relay's), so sockets that never say hello cannot fill a server.
//   2. prepare(binding): the person's route for the part again (their own connection or the
//      server's binding; an administrator's off switch wins), with its key opened from the vault.
//   3. The meter's first minute is held (meter.mjs); then the provider socket opens with the
//      part's registry prompts, the binding's voice and send_to_slatebox (config.mjs).
//   4. ready, then audio both ways, interruptions, transcripts, activity and tool calls until
//      someone ends it, a limit is reached, or the server restarts (moving: a new ticket to carry on).
// Gemini's goAway (and a switch between open mic and push to talk) moves the provider side to a
// new connection resumed with the latest handle, without the browser noticing; while a tool call
// is open it waits for the call's answer and the handle after it (a handle from before the call
// would resume a model that never made it). OpenAI's 60-minute sessions move the browser to a new
// one before the provider ends it (moving, with what was said).
//
// Barge-in: both providers make an answer faster than it plays, so the agent is still audible
// after the provider says the turn is done. The turn stays audible until the browser's played
// for it arrives, and the person speaking (or pressing push to talk) over it is an interruption.
//
// A tool call's answer reaches the model in the registry's words (voice.answer: the screen's text,
// wrapped as data, since it quotes notes anyone wrote; voice.answer.<code>: a code the browser
// sends instead). A keep (confirm: keep) goes to the browser only when the person has spoken since
// the last answer went back: a note on the slate, or the agent itself, cannot say yes for them.
//
// Pure apart from the injected sockets, stores and timers, so the integration test runs it
// against a fake provider.
import {
  CLOSE_CODES, CLOSING_WORDS, LIMITS, TOOL_NAME, VOICE_PROTOCOL_VERSION, VoiceProtocolError, decodeFrame, encodeAgentFrame, parseClientMessage, parseToolArgs, serverMessage,
} from '../../imports/api/common/voice-protocol.mjs'
import { adapterFor } from './adapters/index.mjs'
import { voiceConfig } from './config.mjs'
import { VOICE_LIMITS, voiceTick } from './meter.mjs'
import { promptText } from '../ai-control/prompts/index.mjs'

const OPEN = 1
const MIN = 60_000
export const SESSION_TIMING = Object.freeze({
  helloMs: 5_000, connectMs: 15_000, pingMs: 20_000, tickMs: 60_000, toolMs: 120_000, maxPendingTools: 4,
  // what a slow browser (or provider) may have queued before the session gives up on it (bytes)
  maxClientBuffer: 4 * 1024 * 1024, maxProviderBuffer: 1024 * 1024, maxEarlier: 8000,
  // JSON messages a browser may send in a second (a conversation needs a few), and how often the mode may change
  maxMessagesPerSecond: 20, modeEveryMs: 2_000,
  // how long a closing session (or a provider connection it moved away from) waits for the
  // provider's last usage report: an answer still being made is billed when it is done
  usageGraceMs: 2_000,
  // a minute check that fails this many times in a row ends the session
  allowedFailures: 2,
})

// What the person reads when a session ends (the browser shows it as it is): one copy, shared with the browser.
export const CLOSING_COPY = CLOSING_WORDS

/**
 * deps: {
 *   admit?(binding)       → { ok: true } | { ok: false, reason, message }: whether this session may
 *                           start now (the relay: the server's and the person's limits)
 *   client                ws-like browser socket: send(data, opts), close(code, reason), ping(), terminate(),
 *                         on('message' | 'close' | 'pong'), readyState, bufferedAmount
 *   connect(url, headers, { rules }) → ws-like provider socket (on 'open' | 'message' | 'close' | 'error');
 *                         rules: the endpoint rules of an own connection's level (its names' addresses are checked)
 *   redeem(ticket)        → { userId, surface, slateId, resume } | null (tickets.mjs)
 *   prepare(binding)      → { protocol, connection: { baseUrl, apiKey, model, voice?, transcriptionModel? },
 *                             own, price, model } | { error: 'denied' | 'unavailable' | 'turned-off', message }
 *   meterFor({ binding, prepared, sessionId }) → meter.mjs createVoiceMeter
 *   mintReconnect({ binding, resume }) → ticket string (tickets.mjs mint)
 *   allowed?(binding)     → whether the person may still talk (checked every minute: signed out, an
 *                           administrator turned the part off)
 *   record?               { start(doc), update(id, set), end(id, set) } (VoiceSessions; never audio)
 *   limits, timing, now(), setTimer, clearTimer, setTick, clearTick, newId(), log, text (promptText)
 * }
 * → { id, close(reason, message?), moving(), done (a promise that settles when it is closed), state() }
 */
export function createVoiceSession(deps) {
  const {
    client, connect, redeem, prepare, meterFor, mintReconnect, allowed = async () => true, record = null, admit = async () => ({ ok: true }),
    limits = VOICE_LIMITS, now = Date.now, newId, log = console, text = promptText,
  } = deps
  const timing = { ...SESSION_TIMING, ...(deps.timing || {}) }
  const setTimer = deps.setTimer || setTimeout
  const clearTimer = deps.clearTimer || clearTimeout
  const setTick = deps.setTick || setInterval
  const clearTick = deps.clearTick || clearInterval
  const id = newId()

  let phase = 'hello'
  let binding = null
  let connectedAt = null
  let prepared = null
  let adapter = null
  let config = null
  let meter = null
  let upstream = null
  let swapping = null
  let resumeHandle = null
  let startedAt = null
  let lastActivityAt = now()
  let tickIndex = 0
  let agentTurn = 0
  let turnOpen = false
  let userTurn = 0
  let userText = ''
  let agentText = ''
  let discardResponse = null
  let currentResponse = null
  let earlier = ''
  let awaitingPong = false
  let pingTimer = null
  // the agent turn the browser may still be playing: from its first audio until its played arrives
  let audibleTurn = null
  // the provider is making an answer (its usage comes when it is done)
  let generating = false
  // the person spoke (or pressed push to talk), and a tool answer went back: a keep needs the first after the second
  let heardSeq = 0
  let answeredSeq = 0
  let seq = 0
  // JSON messages this second, and the last mode switch
  let windowAt = 0
  let windowCount = 0
  let modeAt = -Infinity
  let modeTimer = null
  let allowFails = 0
  const warned = new Set()
  // a provider move waiting for the open tool calls' answers: { why, timer }
  let swapWanted = null
  // provider connections moved away from, kept open a moment for their last usage
  const retired = new Set()
  // tool calls the relay stopped waiting for (the browser may still answer: a late answer)
  const canceledCalls = new Map()
  let finishing = null
  const turnItems = new Map()
  const pending = new Map()
  const timers = new Set()
  let doneResolve
  const done = new Promise((resolve) => { doneResolve = resolve })

  const later = (fn, ms) => {
    const handle = setTimer(() => { timers.delete(handle); fn() }, ms)
    timers.add(handle)
    return handle
  }
  const cancelTimer = (handle) => {
    if (!handle) return
    clearTimer(handle)
    timers.delete(handle)
  }

  // ---------- to the browser ----------
  const clientOpen = () => client.readyState === OPEN
  function toClient(type, fields) {
    if (!clientOpen()) return
    client.send(serverMessage(type, fields))
  }
  function audioToClient(pcm) {
    if (!clientOpen()) return
    if ((client.bufferedAmount || 0) > timing.maxClientBuffer) {
      close('error', CLOSING_COPY.slow)
      return
    }
    // a provider chunk can be longer than one frame the browser reads: sent as several
    const most = LIMITS.agentFrameBytes - 5
    for (let at = 0; at < pcm.length; at += most) client.send(encodeAgentFrame(agentTurn, pcm.subarray(at, at + most)), { binary: true })
  }
  const activity = (kind, state, extra = {}) => toClient('activity', { kind, state, ...extra })

  // ---------- to the provider ----------
  function toProvider(messages, sock = upstream) {
    if (!sock || sock.readyState !== OPEN) return
    // a provider that cannot keep up: the session stops rather than queue without end
    if ((sock.bufferedAmount || 0) > timing.maxProviderBuffer) {
      if (phase !== 'closed') close('error', CLOSING_COPY.slow)
      return
    }
    for (const msg of Array.isArray(messages) ? messages : [messages]) sock.send(JSON.stringify(msg))
  }

  // ---------- transcripts (shown, never stored: the surface's own text path keeps the turns) ----------
  function remember(role, line) {
    if (!line) return
    earlier = `${earlier}${earlier ? '\n' : ''}${role === 'user' ? 'Person' : 'Agent'}: ${line}`.slice(-timing.maxEarlier)
  }
  function finishUser(final = null) {
    const line = (final ?? userText).trim()
    if (!line && final === null) return
    toClient('transcript', { turn: userTurn, role: 'user', text: line.slice(0, LIMITS.transcript), final: true })
    remember('user', line)
    userText = ''
    userTurn += 1
  }
  function finishAgent(final = null) {
    const line = (final ?? agentText).trim()
    if (!line && final === null) return
    toClient('transcript', { turn: agentTurn, role: 'agent', text: line.slice(0, LIMITS.transcript), final: true })
    remember('agent', line)
    agentText = ''
  }

  // ---------- provider events ----------
  function recordUsage(usage) {
    if (!meter) return undefined
    return meter.usage(usage).then((out) => {
      if (!out.ok && phase !== 'closed') close('cap', out.message)
    }, (error) => {
      log.error?.(`[voice] ${id}: usage not recorded: ${error?.message}`)
      if (phase !== 'closed') close('error', CLOSING_COPY.error)
    })
  }

  const heard = () => { heardSeq = ++seq }

  function onProviderEvent(event, sock) {
    const live = sock === upstream
    // usage is billed whichever of this session's connections reports it, and while it closes
    if (event.type === 'usage') return recordUsage(event.usage)
    if (phase === 'closed') {
      // the answer that was being made is done: its usage came with it
      if (event.type === 'turn-done' && live) finishing?.()
      return undefined
    }
    switch (event.type) {
      case 'ready':
        if (sock === swapping?.sock) return finishSwap()
        if (live && phase === 'connecting') return goLive()
        return undefined
      case 'resume-handle':
        if (live || sock === swapping?.sock) resumeHandle = event.handle
        if (live && swapWanted && !pending.size) return swapNow()
        return undefined
      case 'go-away':
        if (live) return moveProvider('go-away', { timeLeftMs: event.timeLeftMs })
        return undefined
      default:
        break
    }
    if (!live || phase !== 'live') return undefined
    switch (event.type) {
      case 'response-started':
        currentResponse = event.responseId
        generating = true
        return undefined
      case 'audio': {
        if (discardResponse && event.responseId === discardResponse) return undefined
        if (!turnOpen) {
          // the agent starts answering: what the person said before it is final (a provider that
          // sends its own final transcript of the person says so itself)
          if (!adapter.EXPLICIT_FINALS && userText.trim()) finishUser()
          agentTurn += 1
          turnOpen = true
          generating = true
          activity('speaking', 'started', { turn: agentTurn })
        }
        audibleTurn = agentTurn
        if (event.itemId) turnItems.set(agentTurn, event.itemId)
        lastActivityAt = now()
        return audioToClient(event.pcm)
      }
      case 'transcript':
        lastActivityAt = now()
        if (event.role === 'user') {
          // (Gemini has no speech-start of its own: its words of the person are the sign; OpenAI's
          // final transcript can come after an answer went back, so only its speech start counts)
          if (event.text?.trim() && !adapter.EXPLICIT_FINALS) heard()
          if (event.final) return finishUser(event.text)
          userText += event.text
          return toClient('transcript', { turn: userTurn, role: 'user', text: userText.slice(-LIMITS.transcript), final: false })
        }
        if (discardResponse && event.responseId === discardResponse) return undefined
        if (event.final) return finishAgent(event.text)
        agentText += event.text
        return toClient('transcript', { turn: agentTurn, role: 'agent', text: agentText.slice(-LIMITS.transcript), final: false })
      case 'speech-started':
        lastActivityAt = now()
        heard()
        if (turnOpen || audibleTurn !== null) return interrupted()
        return activity('listening', 'started')
      case 'interrupted':
        generating = false
        return interrupted()
      case 'turn-done':
        generating = false
        if (event.responseId && event.responseId === discardResponse) {
          discardResponse = null
          return undefined
        }
        if (agentText.trim()) finishAgent()
        // made, not yet heard: the browser still plays it (audibleTurn) until its played arrives
        if (turnOpen) {
          turnOpen = false
          activity('speaking', 'done', { turn: agentTurn })
        }
        return undefined
      case 'tool-call':
        // a call inside an answer the person cut off is not theirs to run
        if (event.responseId && event.responseId === discardResponse) return undefined
        lastActivityAt = now()
        return toolCall(event)
      case 'tool-cancel':
        for (const [toolId, call] of pending) {
          if (!event.callIds.includes(call.callId)) continue
          stopWaiting(toolId, call)
          activity('tool', 'failed', { name: call.name })
        }
        return undefined
      case 'error':
        // OpenAI reports refusals of one client event here (cancelling when nothing runs); the socket goes on
        log.warn?.(`[voice] ${id}: the provider reported ${String(event.code || 'an error').slice(0, 60)}`)
        return
      default:
        return
    }
  }

  // The person spoke over the agent while it was being made or still playing: the browser flushes
  // what is queued, and an answer still being made is dropped.
  function interrupted() {
    if (!turnOpen && audibleTurn === null) return
    if (turnOpen) discardResponse = currentResponse
    turnOpen = false
    audibleTurn = null
    toClient('interrupt', { turn: agentTurn })
    if (agentText.trim()) finishAgent()
    activity('speaking', 'done', { turn: agentTurn })
    activity('listening', 'started')
  }

  // the relay's own answer to a tool call it could not hand on (model-facing: a registry prompt)
  const toolFailed = () => text('voice.tool-failed', {})

  // A tool call's answer as the model reads it: a code's own words, or the screen's text as data.
  function answerText(msg) {
    if (msg.code) return text(`voice.answer.${msg.code}`, {})
    if (!msg.output.trim()) return msg.ok ? text('voice.answer.busy', {}) : toolFailed()
    return text('voice.answer', { answer: msg.output })
  }

  // The relay stops waiting for a call: the browser is told, and an answer it still sends is a late one.
  function stopWaiting(toolId, call) {
    cancelTimer(call.timer)
    pending.delete(toolId)
    canceledCalls.set(toolId, call.name)
    if (canceledCalls.size > 16) canceledCalls.delete(canceledCalls.keys().next().value)
    toClient('tool_cancel', { id: toolId })
  }

  function toolCall(event) {
    if (event.name !== TOOL_NAME) return toProvider(adapter.toolResult({ callId: event.callId, name: event.name, output: toolFailed() }))
    let args
    try {
      args = parseToolArgs(event.args)
    } catch {
      return toProvider(adapter.toolResult({ callId: event.callId, name: event.name, output: toolFailed() }))
    }
    if (pending.size >= timing.maxPendingTools) return toProvider(adapter.toolResult({ callId: event.callId, name: event.name, output: toolFailed() }))
    // a keep needs the person's own voice after the change was offered: nothing they said since
    // the last answer went back, nothing kept (the agent asks them)
    if (args.confirm === 'keep' && heardSeq <= answeredSeq) {
      answeredSeq = ++seq
      return toProvider(adapter.toolResult({ callId: event.callId, name: TOOL_NAME, output: text('voice.answer.unconfirmed', {}) }))
    }
    const toolId = newId()
    const timer = later(() => {
      const call = pending.get(toolId)
      if (!call) return
      stopWaiting(toolId, call)
      activity('tool', 'failed', { name: TOOL_NAME })
      toProvider(adapter.toolResult({ callId: event.callId, name: TOOL_NAME, output: toolFailed() }))
    }, timing.toolMs)
    pending.set(toolId, { callId: event.callId, name: TOOL_NAME, timer })
    activity('tool', 'started', { name: TOOL_NAME })
    toClient('tool', { id: toolId, name: TOOL_NAME, args })
  }

  // ---------- browser messages ----------
  async function onClientMessage(data, isBinary) {
    if (phase === 'closed' || phase === 'closing') return
    if (isBinary) {
      if (phase !== 'live') return
      let frame
      try {
        frame = decodeFrame(data)
      } catch {
        return close('error', CLOSING_COPY.unreadable)
      }
      if (frame.kind !== 'mic') return close('error', CLOSING_COPY.unreadable)
      if (!upstream || upstream.readyState !== OPEN || (upstream.bufferedAmount || 0) > timing.maxProviderBuffer) return
      upstream.send(JSON.stringify(adapter.audio(frame.pcm)))
      return
    }
    let msg
    try {
      msg = parseClientMessage(data)
    } catch (error) {
      if (error instanceof VoiceProtocolError) return close(phase === 'hello' ? 'denied' : 'error', phase === 'hello' ? CLOSING_COPY.denied : CLOSING_COPY.unreadable)
      throw error
    }
    if (phase === 'hello') {
      if (msg.type !== 'hello') return close('denied', CLOSING_COPY.denied)
      return hello(msg)
    }
    // a page that floods the relay is not having a conversation
    const at = now()
    if (at - windowAt >= 1000) { windowAt = at; windowCount = 0 }
    windowCount += 1
    if (windowCount > timing.maxMessagesPerSecond) return close('error', CLOSING_COPY.flood)
    if (phase !== 'live') return undefined
    switch (msg.type) {
      case 'ptt': {
        lastActivityAt = now()
        const speaking = turnOpen
        if (msg.state === 'down' && (turnOpen || audibleTurn !== null)) interrupted()
        // a push to talk said something (its release ends what they said)
        if (msg.state === 'up') heard()
        return toProvider(adapter.ptt(msg.state, { speaking }))
      }
      case 'mode': return switchMode(msg.mode)
      case 'played': {
        if (msg.turn === audibleTurn) audibleTurn = null
        const itemId = turnItems.get(msg.turn)
        return toProvider(adapter.played({ itemId, ms: msg.ms }))
      }
      case 'tool_result': {
        const call = pending.get(msg.id)
        if (!call) {
          // the relay stopped waiting, but the surface finished it: the model hears what happened
          if (canceledCalls.has(msg.id) && msg.ok && msg.output.trim() && !msg.code) {
            canceledCalls.delete(msg.id)
            answeredSeq = ++seq
            toProvider(adapter.text(text('voice.late-answer', { answer: msg.output })))
          }
          return undefined
        }
        cancelTimer(call.timer)
        pending.delete(msg.id)
        lastActivityAt = now()
        answeredSeq = ++seq
        activity('tool', msg.ok ? 'done' : 'failed', { name: call.name })
        // a provider move waiting for this answer goes with the next handle (resume-handle)
        return toProvider(adapter.toolResult({ callId: call.callId, name: call.name, output: answerText(msg) }))
      }
      // the page is about to reload: a ticket to carry on after it
      case 'pause': return moving()
      case 'end': return close('ended', CLOSING_COPY.ended)
      default: return undefined
    }
  }

  async function hello(msg) {
    phase = 'preparing'
    const taken = await redeem(msg.ticket).catch(() => null)
    if (!taken) return close('denied', CLOSING_COPY.denied)
    binding = taken
    const admitted = await Promise.resolve(admit(binding)).catch(() => ({ ok: false, reason: 'unavailable' }))
    if (phase !== 'preparing') return undefined
    if (!admitted?.ok) return close(admitted?.reason || 'busy', admitted?.message || CLOSING_COPY[admitted?.reason] || CLOSING_COPY.busy)
    const ready = await prepare(binding).catch((error) => ({ error: 'unavailable', message: CLOSING_COPY.unavailable, cause: error }))
    if (phase !== 'preparing') return
    if (ready?.error) return close(ready.error === 'denied' ? 'denied' : 'unavailable', ready.message || CLOSING_COPY.unavailable)
    prepared = ready
    adapter = adapterFor(prepared.protocol)
    if (!adapter) return close('unavailable', CLOSING_COPY.unavailable)
    const mode = binding.resume?.mode || msg.mode
    config = voiceConfig({ surface: binding.surface, route: prepared.connection, mode, resume: binding.resume, text })
    resumeHandle = config.resumeHandle
    meter = meterFor({ binding, prepared, sessionId: id })
    const held = await meter.start()
    if (phase !== 'preparing') return
    if (!held.ok) return close('cap', held.message)
    phase = 'connecting'
    upstream = openProvider(config)
    const timer = later(() => { if (phase === 'connecting') close('unavailable', CLOSING_COPY.unavailable) }, timing.connectMs)
    upstream.connectTimer = timer
  }

  function openProvider(withConfig) {
    const info = adapter.connectInfo({ baseUrl: prepared.connection.baseUrl, apiKey: prepared.connection.apiKey, model: withConfig.model })
    const sock = connect(info.url, info.headers, { rules: prepared.rules ?? null })
    sock.on('open', () => toProvider(adapter.setup(withConfig), sock))
    sock.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'))
      } catch {
        return
      }
      for (const event of adapter.read(msg)) onProviderEvent(event, sock)
    })
    sock.on('error', () => {})
    sock.on('close', (code) => {
      // the code only: a provider's close reason can quote what it was sent
      if (sock === upstream && phase === 'live' && code !== 1000) log.warn?.(`[voice] ${id}: the provider closed with ${code}`)
      onProviderClose(sock)
    })
    return sock
  }

  const readyFields = (mode, resumed) => ({
    sessionId: id, v: VOICE_PROTOCOL_VERSION, inRate: adapter.IN_RATE, outRate: adapter.OUT_RATE, mode, resumed,
    userCaptions: adapter.userCaptions ? adapter.userCaptions(config) : true,
    limits: { maxMinutes: limits.maxMinutes, idleSeconds: limits.idleMinutes * 60 },
  })

  function goLive() {
    cancelTimer(upstream.connectTimer)
    phase = 'live'
    connectedAt = now()
    // a session that moved keeps its time: the time limit counts from where it began
    const carried = Number.isInteger(binding.resume?.elapsedMs) ? Math.max(0, Math.min(binding.resume.elapsedMs, limits.maxMinutes * MIN)) : 0
    startedAt = connectedAt - carried
    lastActivityAt = connectedAt
    toClient('ready', readyFields(config.mode, Boolean(binding.resume)))
    toProvider(adapter.begin(config))
    activity('listening', 'started')
    record?.start({
      _id: id, userId: binding.userId, surface: binding.surface, slateId: binding.slateId, protocol: prepared.protocol, model: prepared.model,
      own: Boolean(prepared.own), metered: meter.metered, state: 'open', startedAt: new Date(connectedAt), lastTickAt: new Date(connectedAt), tickIndex: 0,
      ...(binding.resume?.sessionId && { resumedFrom: binding.resume.sessionId }),
    }).catch((error) => log.warn?.(`[voice] ${id}: session not recorded: ${error?.message}`))
    ticker = setTick(() => { tick().catch((error) => log.error?.(`[voice] ${id}: tick failed: ${error?.message}`)) }, timing.tickMs)
  }

  let ticker = null
  async function tick() {
    if (phase !== 'live') return
    const out = voiceTick({ session: { startedAt, lastActivityAt, lastTickAt: now(), tickIndex }, now: now(), limits })
    tickIndex = out.set.tickIndex
    if (out.decision === 'end') return close(out.reason, CLOSING_COPY[out.reason])
    // a minute before the end: said once (the quiet one again after the person speaks)
    if (now() - lastActivityAt < MIN) warned.delete('idle')
    if (out.warn && !warned.has(out.warn)) {
      warned.add(out.warn)
      toClient('notice', { reason: out.warn, seconds: Math.round(timing.tickMs / 1000) })
    }
    // a check that fails (the database) counts; twice in a row ends the session
    let still
    try {
      still = await allowed(binding)
      allowFails = 0
    } catch (error) {
      allowFails += 1
      log.warn?.(`[voice] ${id}: the minute check failed: ${error?.message}`)
      still = allowFails < timing.allowedFailures
    }
    if (phase !== 'live') return undefined
    if (!still) return close('denied', CLOSING_COPY.denied)
    // a provider whose sessions end at a set length (OpenAI's 60 minutes): carry on in a new one first
    if (adapter.MAX_MINUTES && now() - connectedAt >= (adapter.MAX_MINUTES - 2) * MIN) return moving()
    const held = await meter.tick()
    if (phase !== 'live') return undefined
    if (!held.ok) return close('cap', held.message)
    record?.update(id, { lastTickAt: new Date(now()), tickIndex, spentMicros: meter.spentMicros() }).catch(() => {})
  }

  // ---------- moving the provider side (Gemini: goAway, a mode switch) ----------
  // While a tool call is open, Gemini's handles do not include it: the move waits for its answer
  // and the next handle (until timeLeftMs, or connectMs), then cancels what is still open.
  function moveProvider(why, { timeLeftMs = null } = {}) {
    if (swapping || phase !== 'live') return undefined
    if (adapter.PROTOCOL !== 'gemini-live') return moving()
    // nothing open: now (with no handle yet, the browser carries on with what was said: moving)
    if (!pending.size) return resumeHandle ? startSwap(why) : moving()
    if (swapWanted) return undefined
    const waitMs = Number.isFinite(timeLeftMs) ? Math.max(0, timeLeftMs - 1000) : timing.connectMs
    swapWanted = {
      why,
      timer: later(() => {
        if (!swapWanted) return
        const wanted = swapWanted.why
        swapWanted = null
        for (const [toolId, call] of pending) stopWaiting(toolId, call)
        startSwap(wanted)
      }, waitMs),
    }
    return undefined
  }
  function swapNow() {
    cancelTimer(swapWanted.timer)
    const wanted = swapWanted.why
    swapWanted = null
    return startSwap(wanted)
  }
  function startSwap(why) {
    if (swapping || phase !== 'live') return undefined
    if (!resumeHandle) return moving()
    const next = { ...config, resumeHandle }
    const sock = openProvider(next)
    swapping = { sock, why, timer: later(() => { if (swapping?.sock === sock) moving() }, timing.connectMs) }
    return undefined
  }

  // a connection moved away from stays open a moment for its last usage report
  function retire(sock) {
    if (!sock) return
    retired.add(sock)
    const timer = setTimer(() => {
      retired.delete(sock)
      try { sock.close() } catch { /* already closed */ }
    }, timing.usageGraceMs)
    sock.retireTimer = timer
  }

  function finishSwap() {
    const old = upstream
    upstream = swapping.sock
    cancelTimer(swapping.timer)
    const why = swapping.why
    swapping = null
    config = { ...config, resumeHandle }
    connectedAt = now()
    generating = false
    turnOpen = false
    retire(old)
    if (why === 'mode') toClient('ready', readyFields(config.mode, true))
  }

  function switchMode(next) {
    if (next === config.mode && !modeTimer) return undefined
    // switches come at most every modeEveryMs: the latest one wins
    const wait = modeAt + timing.modeEveryMs - now()
    if (wait > 0 || swapping || swapWanted) {
      cancelTimer(modeTimer)
      modeTimer = later(() => { modeTimer = null; switchMode(next) }, Math.max(wait, 200))
      return undefined
    }
    if (next === config.mode) return undefined
    modeAt = now()
    config = { ...config, mode: next }
    const out = adapter.mode(next)
    if (out.reconnect) return moveProvider('mode')
    toProvider(out.messages)
    toClient('ready', readyFields(next, true))
    return undefined
  }

  function onProviderClose(sock) {
    if (retired.has(sock)) {
      retired.delete(sock)
      clearTimer(sock.retireTimer)
      return undefined
    }
    if (sock === swapping?.sock) {
      cancelTimer(swapping.timer)
      swapping = null
      if (phase === 'live') moving()
      return undefined
    }
    if (sock !== upstream) return undefined
    if (phase === 'closed') return finishing?.()
    if (phase === 'closing') return undefined
    if (phase === 'live' && resumeHandle && adapter.PROTOCOL === 'gemini-live') {
      // the connection is gone: calls it made cannot be answered on the next one
      if (swapWanted) { cancelTimer(swapWanted.timer); swapWanted = null }
      for (const [toolId, call] of pending) stopWaiting(toolId, call)
      return startSwap('closed')
    }
    // a provider that ends its sessions at a set length did so: carry on in a new one
    if (phase === 'live' && adapter.MAX_MINUTES && now() - connectedAt >= (adapter.MAX_MINUTES - 5) * MIN) return moving()
    close('unavailable', CLOSING_COPY.unavailable)
    return undefined
  }

  // ---------- the end ----------
  /** This server is stopping (SIGTERM) or the provider cannot follow: hand the browser a ticket to carry on. */
  async function moving() {
    if (phase === 'closing' || phase === 'closed') return
    if (phase !== 'live' || !binding) return close('moving', CLOSING_COPY.moving)
    phase = 'closing'
    let ticket = null
    try {
      if (agentText.trim()) finishAgent()
      if (userText.trim()) finishUser()
      const resume = {
        sessionId: id, mode: config.mode, elapsedMs: Math.max(0, Math.round(now() - startedAt)),
        ...(resumeHandle && adapter.PROTOCOL === 'gemini-live' && !pending.size ? { handle: resumeHandle } : { earlier }),
      }
      ticket = await mintReconnect({ binding, resume })
    } catch (error) {
      log.warn?.(`[voice] ${id}: no reconnect ticket: ${error?.message}`)
    }
    phase = 'live'
    return close('moving', CLOSING_COPY.moving, ticket ? { reconnect: { ticket } } : {})
  }

  function close(reason, message = CLOSING_COPY[reason] || CLOSING_COPY.error, extra = {}) {
    if (phase === 'closed') return done
    if (phase === 'closing' && reason !== 'moving') return done
    phase = 'closed'
    for (const handle of timers) clearTimer(handle)
    timers.clear()
    if (ticker) clearTick(ticker)
    ticker = null
    if (pingTimer) clearTick(pingTimer)
    for (const [toolId] of pending) toClient('tool_cancel', { id: toolId })
    pending.clear()
    try {
      if (clientOpen()) {
        client.send(serverMessage('closing', { reason, message, ...extra }))
        client.close(CLOSE_CODES[reason] ?? 1011, reason)
      }
    } catch { /* the browser is gone */ }
    // An answer still being made is billed when it is done (OpenAI's response.done carries its
    // usage): it is stopped, and the provider gets a moment to say what it cost.
    let finished = false
    finishing = () => {
      if (finished) return
      finished = true
      for (const sock of [upstream, swapping?.sock, ...retired]) {
        try { sock?.close() } catch { /* already closed */ }
        if (sock?.retireTimer) clearTimer(sock.retireTimer)
      }
      retired.clear()
      swapping = null
      const ended = meter ? meter.end().catch(() => ({ ok: false })) : Promise.resolve()
      ended.then(() => record && startedAt
        ? record.end(id, { state: 'ended', endedReason: reason, endedAt: new Date(now()), spentMicros: meter?.spentMicros() ?? 0 }).catch(() => {})
        : null).finally(() => doneResolve({ reason }))
    }
    if (meter?.metered && generating && upstream?.readyState === OPEN) {
      try { toProvider(adapter.cancel()) } catch { /* closing anyway */ }
      setTimer(() => finishing(), timing.usageGraceMs)
    } else {
      finishing()
    }
    return done
  }

  // ---------- wiring ----------
  const helloTimer = later(() => { if (phase === 'hello') close('denied', CLOSING_COPY.denied) }, timing.helloMs)
  /** Whether the ticket was taken (the relay counts a session toward its limits only then). */
  const admittedState = () => binding !== null
  client.on('message', (data, isBinary) => {
    onClientMessage(data, isBinary).catch((error) => {
      log.error?.(`[voice] ${id}: ${error?.message}`)
      close('error', CLOSING_COPY.error)
    })
  })
  client.on('close', () => {
    cancelTimer(helloTimer)
    if (phase !== 'closed') close('ended', CLOSING_COPY.ended)
  })
  client.on('pong', () => { awaitingPong = false })
  // a frame past the size limit or a broken one: ws closes the socket (1009, 1002) and says so here
  client.on('error', () => {})
  pingTimer = setTick(() => {
    if (!clientOpen()) return
    if (awaitingPong) {
      try { client.terminate?.() } catch { /* gone */ }
      close('error', CLOSING_COPY.error)
      return
    }
    awaitingPong = true
    try { client.ping?.() } catch { /* gone */ }
    try { upstream?.readyState === OPEN && upstream.ping?.() } catch { /* gone */ }
  }, timing.pingMs)

  return { id, close, moving, done, state: () => phase, userId: () => binding?.userId ?? null, admitted: admittedState }
}
