// Talking with the agent, in a conversation's message box (ConversationComposer): the mic button,
// and while voice is on what the session is doing (listening, thinking, speaking, a tool running and
// what it is doing), live captions of both sides, open mic or push to talk, and Stop. The first
// time, a note says where the voice goes and what is kept. Errors and why a session ended are said
// in plain words; a refusal the pay sheet answers shows the app's own PayNotice, before the mic is
// asked for when voice.status already knows it. While voice is on and the conversation is hidden
// (the slate settings cover it, the phone sheet is down during a drag), a small bar with Stop stays
// on screen. Loaded only where voice is offered (useVoiceAvailable), as its own chunk.
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, Button, IconButton, Paper, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import MicIcon from '@mui/icons-material/Mic'
import StopIcon from '@mui/icons-material/Stop'
import { Meteor } from 'meteor/meteor'
import PayNotice, { isCreditRefusal } from '../components/PayNotice'
import CONSTANTS from '../../api/common/constants'
import { MIC_NOTE, VOICE_WORDS, noteSeen, rememberNote, statusLine } from '../../api/common/voice-client.mjs'
import useVoiceSession from './useVoiceSession'

const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }
const ACTIVE = ['starting', 'connecting', 'live', 'reconnecting']

// Whether an element is out of sight (display: none above it): it has no box at all.
function useHidden(ref) {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const check = () => setHidden(el.getClientRects().length === 0)
    const observer = new ResizeObserver(check)
    observer.observe(el)
    check()
    return () => observer.disconnect()
  }, [ref])
  return hidden
}

/**
 * surface: 'voice.chat' | 'voice.interview'; shareId (voice.chat); run({ text, confirm }) → the
 * surface's answer; status: voice.status's answer for the part (a refusal the pay sheet answers
 * shows at once, with no mic prompt).
 */
export default function VoiceControl({ surface, shareId = null, run, status = null }) {
  const voice = useVoiceSession({ surface, shareId, run })
  const { state } = voice
  const active = ACTIVE.includes(state.phase)
  const [asking, setAsking] = useState(false)
  const [refusedFirst, setRefusedFirst] = useState(null)
  const root = useRef(null)
  const micButton = useRef(null)
  const noteOk = useRef(null)
  const stopButton = useRef(null)
  const wasActive = useRef(false)
  const hidden = useHidden(root)

  // Focus follows the session when the person is on it: onto Stop when voice comes on, back to the
  // mic when it ends, only if focus was in the voice controls (never out of a note or the message box).
  useEffect(() => {
    const inVoice = () => Boolean(document.activeElement?.closest?.('[data-voice]'))
    if (active && !wasActive.current && inVoice()) requestAnimationFrame(() => stopButton.current?.focus({ preventScroll: true }))
    if (!active && wasActive.current && (inVoice() || document.activeElement === document.body)) requestAnimationFrame(() => micButton.current?.focus({ preventScroll: true }))
    wasActive.current = active
  }, [active])
  useEffect(() => { if (asking) requestAnimationFrame(() => noteOk.current?.focus({ preventScroll: true })) }, [asking])

  // a refusal the pay sheet answers (voice.status knew it): said at the press, before any mic prompt
  const knownRefusal = status && status.code && (isCreditRefusal(status.code) || status.pay) ? { code: status.code, message: status.message, details: status.pay ? { pay: status.pay } : undefined } : null
  const begin = () => {
    if (knownRefusal && !voice.carryOn) { setRefusedFirst(knownRefusal); return }
    setRefusedFirst(null)
    if (!noteSeen(globalThis.localStorage)) { setAsking(true); return }
    voice.start()
  }
  const accept = () => {
    rememberNote(globalThis.localStorage)
    setAsking(false)
    voice.start()
  }
  const dismissNote = () => { setAsking(false); requestAnimationFrame(() => micButton.current?.focus()) }
  const stopKeys = (event) => {
    if (event.key !== 'Escape') return
    if (asking) { event.stopPropagation(); dismissNote(); return }
    if (event.key === 'Escape' && active) { event.stopPropagation(); voice.stop() }
  }
  // Push to talk: held with the pointer, or with Space or Enter while the button has focus; a tap
  // starts it and the next tap sends (for anyone who cannot hold a key or a pointer down).
  const holdKeys = {
    onKeyDown: (event) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); voice.press() } },
    onKeyUp: (event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); voice.release() } },
    onPointerDown: (event) => { event.currentTarget.setPointerCapture?.(event.pointerId); voice.press() },
    onPointerUp: () => voice.release(),
    onPointerCancel: () => voice.release(),
    onBlur: () => voice.release(),
    onContextMenu: (event) => event.preventDefault(),
  }
  // A session the meter stopped (cap): the refusal a new one would get, so the pay sheet can answer it.
  const [capRefusal, setCapRefusal] = useState(null)
  const capped = !active && state.closing?.reason === 'cap'
  useEffect(() => {
    setCapRefusal(null)
    if (!capped) return undefined
    let gone = false
    Meteor.callAsync(CONSTANTS.methods.voice.status, { surface }).then((out) => {
      if (gone || !out?.code || !(isCreditRefusal(out.code) || out.pay)) return
      setCapRefusal({ code: out.code, message: out.message || state.closing.message, details: out.pay ? { pay: out.pay } : undefined })
    }).catch(() => {})
    return () => { gone = true }
  }, [capped, state.sessionId])
  const error = (active ? null : state.error ?? capRefusal) ?? refusedFirst
  const pays = error && (isCreditRefusal(error.code) || Boolean(error.details?.pay))
  const line = statusLine(state)
  const live = state.phase === 'live'
  const echoNote = live && state.echoRisk ? (state.mode === 'ptt' ? VOICE_WORDS.echoPtt : VOICE_WORDS.headphones) : null

  const stop = <Button ref={stopButton} size="small" variant="outlined" color="inherit" startIcon={<StopIcon />} onClick={voice.stop} data-voice-stop="">{VOICE_WORDS.stop}</Button>

  return <Box ref={root} data-voice="" data-voice-phase={state.phase} onKeyDown={stopKeys} sx={{ display: 'flex', flexDirection: 'column', gap: .5, minWidth: 0 }}>
    {/* What a screen reader is told: voice on, reconnecting, a notice, the person's own words, why it ended. */}
    <Box role="status" aria-live="polite" sx={visuallyHidden}>{state.announce ? <span key={state.announce.at}>{state.announce.words}</span> : null}</Box>
    {asking && !active && <Box role="group" aria-label="About the microphone" data-voice-note="" sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="body2">{MIC_NOTE}</Typography>
      <Box sx={{ display: 'flex', gap: .5, mt: .5 }}>
        <Button ref={noteOk} size="small" variant="contained" onClick={accept}>{VOICE_WORDS.noteOk}</Button>
        <Button size="small" onClick={dismissNote}>{VOICE_WORDS.noteCancel}</Button>
      </Box>
    </Box>}
    {!active && !asking && <Box sx={{ display: 'flex', alignItems: 'center', gap: .5 }}>
      <Tooltip title={voice.carryOn ? VOICE_WORDS.carryOn : VOICE_WORDS.start}>
        <IconButton ref={micButton} size="small" aria-label={voice.carryOn ? VOICE_WORDS.carryOn : VOICE_WORDS.start} data-voice-start="" onClick={begin}
          color={voice.carryOn ? 'primary' : 'default'}><MicIcon fontSize="small" /></IconButton>
      </Tooltip>
      {voice.carryOn && <Typography variant="caption" color="text.secondary" data-voice-carry="">{VOICE_WORDS.paused}</Typography>}
    </Box>}
    {active && <Box role="group" aria-label="Voice" data-voice-bar="" sx={{ display: 'flex', flexDirection: 'column', gap: .5, p: 1, border: 1, borderColor: 'primary.main', borderRadius: 1 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: .5 }}>
        <MicIcon fontSize="small" color={live && (state.mode === 'open' || state.pressed) ? 'primary' : 'disabled'} aria-hidden="true" />
        <Typography variant="body2" data-voice-status="" sx={{ flex: '1 1 120px', minWidth: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{line}</Typography>
        {stop}
      </Box>
      {live && <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: .5 }}>
        <ToggleButtonGroup size="small" exclusive value={state.mode} aria-label="How the mic listens" onChange={(_, mode) => { if (mode) voice.setMode(mode) }}>
          <ToggleButton value="open" sx={{ textTransform: 'none', py: .25 }}>{VOICE_WORDS.openMic}</ToggleButton>
          <ToggleButton value="ptt" sx={{ textTransform: 'none', py: .25 }}>{VOICE_WORDS.pushToTalk}</ToggleButton>
        </ToggleButtonGroup>
        {/* One fixed name, its pressed state says whether it is talking (the status line says how). */}
        {state.mode === 'ptt' && <Button size="small" variant={state.pressed ? 'contained' : 'outlined'} aria-pressed={state.pressed} data-voice-hold="" {...holdKeys}
          sx={{ touchAction: 'none', userSelect: 'none' }}>{VOICE_WORDS.talk}</Button>}
      </Box>}
      {state.notice && <Typography variant="caption" color="warning.main" data-voice-notice="">{state.notice}</Typography>}
      {echoNote && <Typography variant="caption" color="text.secondary" data-voice-echo="">{echoNote}</Typography>}
      {live && !state.userCaptions && <Typography variant="caption" color="text.secondary" data-voice-no-captions="">{VOICE_WORDS.captionsOff}</Typography>}
      {/* Live captions of both sides: what the person said and what the agent says, as it is said. */}
      {state.captions.length > 0 && <Box component="ul" aria-label="Captions" data-voice-captions="" sx={{ listStyle: 'none', m: 0, p: 0, maxHeight: 96, overflowY: 'auto' }}>
        {state.captions.slice(-4).map(row => <Typography component="li" key={row.key} variant="body2" color={row.final ? 'text.primary' : 'text.secondary'} sx={{ overflowWrap: 'anywhere' }}>
          <b>{row.role === 'user' ? 'You' : 'Agent'}:</b> {row.text}
        </Typography>)}
      </Box>}
    </Box>}
    {!active && state.closing && state.closing.reason !== 'ended' && !capRefusal &&
      <Typography variant="body2" color="text.secondary" role="note" data-voice-closed={state.closing.reason}>{state.closing.message}</Typography>}
    {!active && error && (pays
      ? <PayNotice refusal={{ error: error.code, reason: error.message, details: error.details }} from="voice" retry={() => { setRefusedFirst(null); voice.start() }} inline />
      : <Typography variant="body2" color="error" role="alert" data-voice-error={error.code}>{error.message}</Typography>)}
    {/* The conversation is out of sight while voice is on: what it is doing, and Stop, stay in view. */}
    {active && hidden && typeof document !== 'undefined' && createPortal(
      <Paper elevation={6} role="group" aria-label="Voice" data-voice-chip="" sx={{ position: 'fixed', left: 16, bottom: 16, zIndex: 1400, display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: .75, maxWidth: 'calc(100vw - 32px)' }}>
        <MicIcon fontSize="small" color={live && (state.mode === 'open' || state.pressed) ? 'primary' : 'disabled'} aria-hidden="true" />
        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{line}</Typography>
        <Button size="small" variant="outlined" color="inherit" startIcon={<StopIcon />} onClick={voice.stop} data-voice-chip-stop="">{VOICE_WORDS.stop}</Button>
      </Paper>, document.body)}
  </Box>
}
