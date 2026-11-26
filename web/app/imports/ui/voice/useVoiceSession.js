// One voice session with the agent, from a conversation's mic button: voice.open for a ticket, the
// one full-duplex socket at /voice/ws (hello, ready, audio both ways, transcripts, activity, tool
// calls, notices, closing), and the microphone and speakers (voiceAudio.js). The rules are pure
// (voice-client.mjs); this is the wiring.
//
// A tool call (send_to_slatebox) runs through the surface's own submit, `run({ text, confirm })`,
// the same one its message box uses (Preview and Keep, the meter and the audit trail are that
// path's), and its answer goes back as tool_result for the agent to say. Calls run one at a time,
// in order. A call the relay stopped waiting for still answers if it ran (the agent hears what
// happened); one that had not started yet does not run.
//
// A closing that hands over a reconnect ticket (the server is moving) opens a new socket with it,
// trying again for as long as the ticket lasts (a rollout's first try can land on the server that
// is stopping); the audio carries on. A Keep that reloads the page (voiceReload.js) lets the agent
// say what was kept, then pauses: the ticket waits in sessionStorage and the mic carries on after
// the reload.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../api/common/constants'
import { VOICE_PROTOCOL_VERSION, decodeFrame, encodeMicFrame, parseServerMessage, parseToolArgs } from '../../api/common/voice-protocol.mjs'
import {
  START_WORDS, createPlayedLedger, createTurnGate, initialVoiceState, micError, peekCarry, saveCarry, saveMode, savedMode, sendsMic, socketUrl,
  startMode, takeCarry, toolResult, voiceReducer,
} from '../../api/common/voice-client.mjs'
import { createVoiceAudio, micAllowedHere, voiceSupported } from './voiceAudio'
import { registerVoice } from './voiceReload'

const M = CONSTANTS.methods.voice
const OPEN = 1
// a reconnect ticket lasts 60 s: tries stop a little before
const RECONNECT_MS = 55_000
// how long a reload waits for the agent to say what was kept, and for the relay's ticket
const PAUSE_SAY_MS = 10_000
const PAUSE_TICKET_MS = 3_000
// push to talk: what the mic still has in flight when released goes before the release
const RELEASE_TAIL_MS = 80
// a press shorter than this is a tap: talking stays on until the next tap
const TAP_MS = 300

const store = (name) => { try { return globalThis[name] ?? null } catch { return null } }

/**
 * surface: 'voice.chat' | 'voice.interview'; shareId: the slate or board (voice.chat);
 * run({ text, confirm }) → Promise<string | { text, ok } | { code }> (throws a Meteor.Error when it fails).
 * → { state, carryOn (a session paused by a reload can carry on), start(), stop(), setMode(mode), press(), release() }
 */
export default function useVoiceSession({ surface, shareId = null, run }) {
  // the state in a ref as well: the socket's and the mic's handlers read it between renders
  const [state, setState] = useState(initialVoiceState)
  const stateRef = useRef(state)
  const dispatch = useCallback((event) => {
    const next = voiceReducer(stateRef.current, event, Date.now())
    if (next === stateRef.current) return
    stateRef.current = next
    setState(next)
  }, [])
  const runRef = useRef(run)
  runRef.current = run
  const live = useRef(null)
  const [carryOn, setCarryOn] = useState(() => Boolean(peekCarry(store('sessionStorage'), { surface, shareId })))

  const teardown = useCallback((s = live.current) => {
    if (!s) return
    if (live.current === s) live.current = null
    s.gone = true
    clearTimeout(s.retryTimer)
    clearTimeout(s.releaseTimer)
    s.unregister?.()
    try {
      if (s.ws?.readyState === OPEN) s.ws.send(JSON.stringify({ type: 'end' }))
    } catch { /* closing anyway */ }
    try { s.ws?.close(1000) } catch { /* closed */ }
    s.audio?.close()
  }, [])

  const send = (s, msg) => {
    if (s.ws?.readyState === OPEN) s.ws.send(JSON.stringify(msg))
  }

  // A tool call: through the surface's own submit, one at a time. A call canceled before it
  // started does not run; one canceled while it ran still answers (the relay tells the agent).
  const onTool = (s, msg) => {
    dispatch({ type: 'tool-start', id: msg.id, args: msg.args })
    s.tools = s.tools.then(async () => {
      if (s.gone || s.canceled.has(msg.id)) return
      let outcome
      try {
        outcome = await runRef.current(parseToolArgs(msg.args))
      } catch (error) {
        outcome = error instanceof Error ? error : new Error(String(error?.reason || error?.message || error || ''))
        if (error?.reason) outcome.reason = error.reason
      }
      if (s.gone) return
      send(s, toolResult(msg.id, outcome))
      dispatch({ type: 'tool-done', id: msg.id })
    })
  }

  // The agent turn just played out (or was cut): the relay hears it once, the state line too.
  const onHeard = (s, { turn, ms }) => {
    const msg = s.ledger.report(turn, ms)
    if (!msg || s.gone) return
    send(s, msg)
    s.heardTurn = Math.max(s.heardTurn, turn)
    dispatch({ type: 'heard', turn })
    for (const wait of [...s.heardWaits]) {
      if (turn < wait.turn) continue
      s.heardWaits.delete(wait)
      wait.resolve()
    }
  }

  const fail = (s, error) => {
    if (s.gone) return
    dispatch({ type: 'failed', error })
    teardown(s)
  }

  const connect = (s, ticket) => {
    const ws = new WebSocket(socketUrl(window.location))
    ws.binaryType = 'arraybuffer'
    s.ws = ws
    ws.onopen = () => {
      if (s.gone || s.ws !== ws) return
      ws.send(JSON.stringify({ type: 'hello', ticket, v: VOICE_PROTOCOL_VERSION, mode: stateRef.current.mode }))
    }
    ws.onmessage = (event) => {
      if (s.gone || s.ws !== ws) return
      if (typeof event.data !== 'string') {
        let frame
        try { frame = decodeFrame(event.data) } catch { return }
        if (frame.kind === 'agent' && s.gate.plays(frame.turn)) {
          s.agentTurn = Math.max(s.agentTurn, frame.turn)
          s.audio.push(frame.turn, frame.pcm)
        }
        return
      }
      let msg
      try { msg = parseServerMessage(event.data) } catch { return }
      switch (msg.type) {
        case 'ready':
          // the new socket took over: its ticket is spent
          s.reconnect = null
          try {
            if (s.rate) s.audio.setRate(msg.inRate)
            else s.audio.start(msg.inRate)
          } catch {
            fail(s, { code: 'mic', message: START_WORDS.failed })
            return
          }
          s.rate = msg.inRate
          break
        case 'interrupt':
          s.gate.cut(msg.turn)
          s.audio.flush(msg.turn)
          break
        case 'activity':
          if (msg.kind === 'speaking' && msg.state === 'done' && Number.isInteger(msg.turn)) s.audio.end(msg.turn)
          break
        case 'tool':
          onTool(s, msg)
          return
        case 'tool_cancel':
          s.canceled.add(msg.id)
          break
        case 'closing':
          s.reconnect = msg.reason === 'moving' && msg.reconnect?.ticket ? { ticket: msg.reconnect.ticket, until: Date.now() + RECONNECT_MS, tries: 0 } : null
          // a reload is waiting for this ticket: keep it for after the reload, and stop here
          if (s.pausing && s.reconnect) {
            saveCarry(store('sessionStorage'), { surface, shareId, ticket: s.reconnect.ticket, mode: stateRef.current.mode })
            s.reconnect = null
            const done = s.pausing
            s.pausing = null
            teardown(s)
            done()
            return
          }
          break
        default:
          break
      }
      dispatch({ type: 'server', msg })
    }
    ws.onclose = (event) => {
      if (s.gone || s.ws !== ws) return
      const again = s.reconnect
      if (again && Date.now() < again.until && stateRef.current.phase !== 'ended') {
        // what was queued from the old connection stops; the turn numbers start again on the new one
        if (!again.tries) {
          s.audio.reset()
          s.gate = createTurnGate()
          s.ledger = createPlayedLedger()
          s.canceled = new Set()
          s.agentTurn = 0
          s.heardTurn = -1
          dispatch({ type: 'connecting' })
        }
        // the first try at once, then a little longer each time, while the ticket lasts
        const wait = again.tries ? Math.min(500 * 2 ** (again.tries - 1), 5000) : 0
        again.tries += 1
        s.retryTimer = setTimeout(() => {
          if (s.gone || s.reconnect !== again) return
          try { connect(s, again.ticket) } catch { fail(s, { code: 'connect', message: START_WORDS.connect }) }
        }, wait)
        return
      }
      s.reconnect = null
      dispatch({ type: 'socket-closed', code: event.code })
      teardown(s)
    }
    ws.onerror = () => { /* onclose follows with the code */ }
  }

  // A Keep is about to reload the page: the answer goes back, the agent says it, then the relay
  // hands over a ticket for after the reload (or the reload goes on without one).
  const pauseForReload = (s) => (async () => {
    if (s.gone || stateRef.current.phase !== 'live') return
    await s.tools.catch(() => {})
    if (s.gone) return
    // the agent's next turn, heard to its end (a turn after the one playing when the answer went back)
    const after = Math.max(s.agentTurn, s.heardTurn)
    await new Promise((resolve) => {
      const wait = { turn: after + 1, resolve }
      s.heardWaits.add(wait)
      setTimeout(resolve, PAUSE_SAY_MS)
    })
    if (s.gone) return
    await new Promise((resolve) => {
      s.pausing = resolve
      send(s, { type: 'pause' })
      setTimeout(() => {
        if (s.pausing !== resolve) return
        s.pausing = null
        resolve()
      }, PAUSE_TICKET_MS)
    })
  })()

  const start = useCallback(() => {
    if (live.current) return
    if (!voiceSupported()) { dispatch({ type: 'start' }); dispatch({ type: 'failed', error: { code: 'unsupported', message: START_WORDS.unsupported } }); return }
    if (!micAllowedHere()) { dispatch({ type: 'start' }); dispatch({ type: 'failed', error: { code: 'insecure', message: START_WORDS.insecure } }); return }
    // a session a reload paused carries on with its ticket (no voice.open, no new greeting)
    const carried = takeCarry(store('sessionStorage'), { surface, shareId })
    setCarryOn(false)
    dispatch({ type: 'start' })
    const s = {
      gone: false, ws: null, rate: null, reconnect: null, retryTimer: null, releaseTimer: null, pausing: null, tools: Promise.resolve(),
      canceled: new Set(), gate: createTurnGate(), ledger: createPlayedLedger(), agentTurn: 0, heardTurn: -1, heardWaits: new Set(), pressedAt: 0, latched: false,
    }
    live.current = s
    s.unregister = registerVoice({ pauseForReload: () => pauseForReload(s) })
    // the audio starts inside this click (Safari and iOS start a context only in one)
    s.audio = createVoiceAudio({
      onFrame: (pcm) => {
        if (s.gone || !sendsMic(stateRef.current) || s.ws?.readyState !== OPEN) return
        // a socket that cannot keep up drops mic audio rather than queue it
        if (s.ws.bufferedAmount > 64 * 1024) return
        s.ws.send(encodeMicFrame(new Uint8Array(pcm)))
      },
      onPlayed: (played) => onHeard(s, played),
    })
    s.audio.ready.then(async () => {
      if (s.gone) return
      if (s.audio.echoRisk) dispatch({ type: 'echo-risk' })
      // open mic or push to talk: the person's last choice; where the agent may hear itself, push to talk
      const mode = carried?.mode || startMode({ saved: savedMode(store('localStorage')), echoRisk: s.audio.echoRisk })
      dispatch({ type: 'mode', mode })
      let ticket = carried?.ticket ?? null
      if (!ticket) {
        let opened
        try {
          opened = await Meteor.callAsync(M.open, surface === 'voice.chat' ? { surface, shareId } : { surface })
        } catch (error) {
          fail(s, { code: error?.error || 'failed', message: error?.reason || START_WORDS.failed, ...(error?.details && { details: error.details }) })
          return
        }
        ticket = opened.ticket
      }
      if (s.gone) return
      dispatch({ type: 'connecting' })
      try {
        connect(s, ticket)
      } catch {
        fail(s, { code: 'connect', message: START_WORDS.connect })
      }
    }, (error) => {
      if (error?.name === 'AbortError' && s.gone) return
      fail(s, { code: 'mic', message: micError(error) })
    })
  }, [surface, shareId, teardown])

  const stop = useCallback(() => {
    dispatch({ type: 'stop' })
    teardown()
  }, [teardown])

  const setMode = useCallback((mode) => {
    dispatch({ type: 'mode', mode })
    saveMode(store('localStorage'), mode)
    const s = live.current
    if (s) send(s, { type: 'mode', mode })
  }, [])

  // Push to talk: held (press, release) or tapped (a short press keeps talking until the next tap).
  const press = useCallback(() => {
    const s = live.current
    if (!s || stateRef.current.mode !== 'ptt') return
    if (s.latched) {
      // the second tap: send what was said
      s.latched = false
      s.releasing = true
      return
    }
    if (stateRef.current.pressed) return
    s.pressedAt = Date.now()
    // talking over the agent: its audio stops here at once (the relay says so too)
    if (stateRef.current.activity === 'speaking' && s.agentTurn) {
      s.gate.cut(s.agentTurn)
      s.audio.flush(s.agentTurn)
    }
    dispatch({ type: 'press' })
    send(s, { type: 'ptt', state: 'down' })
  }, [])
  const release = useCallback(() => {
    const s = live.current
    if (!s || !stateRef.current.pressed) return
    if (!s.releasing && Date.now() - s.pressedAt < TAP_MS && !s.latched) {
      s.latched = true
      return
    }
    if (s.latched) return
    s.releasing = false
    // the frames still in flight, and the part-filled one, go before the release
    s.audio.flushMic()
    clearTimeout(s.releaseTimer)
    s.releaseTimer = setTimeout(() => {
      if (s.gone) return
      dispatch({ type: 'release' })
      send(s, { type: 'ptt', state: 'up' })
    }, RELEASE_TAIL_MS)
  }, [])

  // Leaving the page or the conversation ends the session.
  useEffect(() => () => teardown(), [teardown])
  useEffect(() => {
    const leave = () => teardown()
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [teardown])

  return { state, carryOn, start, stop, setMode, press, release }
}
