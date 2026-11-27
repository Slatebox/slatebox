import React, { useCallback, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useNavigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import { FACT_KINDS, KIND_LABELS, LIMITS } from '../../../api/common/personal-facts.mjs'
import { INTERVIEW_LIMITS, freshProposals, historyFor, keepOutcome, keptSummary } from '../../../api/common/interview.mjs'
import ConversationPanel, { ConversationComposer } from '../ConversationPanel'
import ChatTurn, { ChatThinking } from '../ChatTurn'
import PayNotice, { isCreditRefusal } from '../PayNotice'
import { FinePrint, SPACE } from '../../common/AccountLayout'
import { ANSWER, interviewAnswer, keptFactsAnswer, replyAnswer } from '../../../api/common/voice-answers.mjs'

// Profile › About you › Talk with Slatebox: the agent asks about the person's work, one question a
// turn, and proposes what it heard as small chips under its turn (Keep, Edit, Skip). Nothing is
// saved until they keep it. "Done for now" ends with what was kept. One turn is one method call
// (interview.start, interview.turn: server/methods/interview.js) and the transcript is text. Voice
// sits on the same message box (ConversationComposer's mic, voice.interview) and the same turns:
// what the person says goes through send, and "yes, keep them" keeps the open chips.
// When the meter refuses a turn (today's free talk used up, no Pro or balance), the refusal is the
// agent's turn with its ways on in it (PayNotice: Get Pro, top up, use your own key), in the meter's
// own words, and the turn runs again once paid.
const M = CONSTANTS.methods.interview
// "Skip this question" sends the same words a person would type to skip.
const SKIP_WORDS = "I'd rather skip that one."
const reason = (error, fallback) => error?.reason || error?.message || fallback
const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }
let nextId = 0
const newId = () => {
  nextId += 1
  return `turn-${nextId}`
}

const factShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  kind: PropTypes.string.isRequired,
  text: PropTypes.string.isRequired,
  state: PropTypes.oneOf(['open', 'kept', 'skipped']).isRequired,
  error: PropTypes.string,
})

// One proposed fact: what the agent heard, its kind, and Keep, Edit, Skip. Once kept or skipped it
// says so, and focus moves to the next open chip (or the message box).
function FactChip({ fact, onKeep, onSkip, saving }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(fact.text)
  const [kind, setKind] = useState(fact.kind)
  const field = useRef(null)
  const editButton = useRef(null)
  const wasEditing = useRef(false)
  useEffect(() => {
    if (editing) field.current?.focus()
    else if (wasEditing.current) editButton.current?.focus()
    wasEditing.current = editing
  }, [editing])
  const label = `${KIND_LABELS[fact.kind] || fact.kind}: ${fact.text}`
  const chip = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: SPACE.tight, rowGap: SPACE.hair, px: SPACE.text, py: SPACE.hair,
    border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', listStyle: 'none' }
  if (fact.state !== 'open') {
    return (
      <Box component="li" sx={{ ...chip, color: 'text.secondary' }} data-interview-fact={fact.id}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {fact.state === 'kept' ? `Kept: ${fact.text}` : `Skipped: ${fact.text}`}
        </Typography>
      </Box>
    )
  }
  if (editing) {
    const save = async (event) => {
      event.preventDefault()
      if (!text.trim()) return
      if (await onKeep(fact, { kind, text: text.trim() })) setEditing(false)
    }
    return (
      <Box component="li" sx={{ ...chip, py: SPACE.tight }} data-interview-fact={fact.id}>
        <Box component="form" onSubmit={save} aria-label={`Change before keeping: ${fact.text}`}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }}
          sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: SPACE.tight, width: '100%' }}>
          <TextField id={`${fact.id}-text`} inputRef={field} size="small" label="What Slatebox should know" value={text} onChange={(e) => setText(e.target.value)}
            slotProps={{ htmlInput: { maxLength: LIMITS.text } }} sx={{ flex: '1 1 200px' }} required />
          <TextField id={`${fact.id}-kind`} select size="small" label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ minWidth: 160 }}>
            {FACT_KINDS.map((option) => <MenuItem key={option} value={option}>{KIND_LABELS[option]}</MenuItem>)}
          </TextField>
          <Button type="submit" size="small" variant="contained" color="secondary" disabled={!text.trim() || saving}>Keep</Button>
          <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>
        </Box>
        {fact.error && <Alert severity="warning" role="alert" sx={{ flexBasis: '100%' }}>{fact.error}</Alert>}
      </Box>
    )
  }
  return (
    <Box component="li" sx={chip} data-interview-fact={fact.id}>
      <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{KIND_LABELS[fact.kind] || fact.kind}</Typography>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{fact.text}</Typography>
      </Box>
      <Button size="small" color="secondary" onClick={() => onKeep(fact)} disabled={saving} aria-label={`Keep: ${label}`} data-interview-keep="">Keep</Button>
      <Button size="small" ref={editButton} onClick={() => { setText(fact.text); setKind(fact.kind); setEditing(true) }} aria-label={`Edit: ${label}`}>Edit</Button>
      <Button size="small" onClick={() => onSkip(fact)} aria-label={`Skip: ${label}`}>Skip</Button>
      {fact.error && <Alert severity="warning" role="alert" sx={{ flexBasis: '100%' }}>{fact.error}</Alert>}
    </Box>
  )
}

FactChip.propTypes = {
  fact: factShape.isRequired,
  onKeep: PropTypes.func.isRequired,
  onSkip: PropTypes.func.isRequired,
  saving: PropTypes.bool,
}
FactChip.defaultProps = { saving: false }

/**
 * The talk. `onKept` runs after each fact is kept (About you reads its list again); `onDone(kept)`
 * when the person closes the summary or the panel.
 */
export default function Interview({ onKept, onDone }) {
  const navigate = useNavigate()
  // [{ id, role: 'assistant' | 'user', content, proposed?: [{ id, kind, text, state, error? }] }]
  const [turns, setTurns] = useState([])
  const [message, setMessage] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')
  const [startFailed, setStartFailed] = useState(false)
  // The meter's refusal ({ error, reason, details, message }: message is the answer it refused, none for the first question)
  const [refusal, setRefusal] = useState(null)
  const [kept, setKept] = useState([])
  const [finished, setFinished] = useState(false)
  const [status, setStatus] = useState('')
  const inputRef = useRef(null)
  const summaryRef = useRef(null)
  const statusTimer = useRef(null)
  const keeping = useRef(false)
  // why the last Keep did not keep (beside its chip, and in what a voice session's agent hears)
  const keepError = useRef('')
  // One Keep saves at a time: the other Keep buttons wait (and say so) until it is done.
  const [saving, setSaving] = useState(false)

  // The talk is announced the moment it opens: focus goes to its name until the first question is here.
  useEffect(() => {
    requestAnimationFrame(() => document.querySelector('[data-interview-panel] [data-conversation-title]')?.focus({ preventScroll: true }))
  }, [])

  const announce = (words) => {
    setStatus('')
    window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setStatus(words), 100)
  }
  useEffect(() => () => window.clearTimeout(statusTimer.current), [])

  const start = useCallback(async () => {
    setWaiting(true)
    setError('')
    setStartFailed(false)
    setRefusal(null)
    try {
      const out = await Meteor.callAsync(M.start)
      setTurns([{ id: newId(), role: 'assistant', content: out.reply, proposed: [] }])
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
      return replyAnswer(out.reply)
    } catch (requestError) {
      if (isCreditRefusal(requestError?.error)) setRefusal({ error: requestError.error, reason: requestError.reason, details: requestError.details, message: null })
      else {
        setError(reason(requestError, 'The talk could not start. Try again.'))
        setStartFailed(true)
      }
      // a voice session's agent hears why, in the meter's own words when it refused
      return { text: reason(requestError, 'The talk could not start. Try again.'), ok: false }
    } finally {
      setWaiting(false)
    }
  }, [])
  useEffect(() => { start() }, [start])

  const send = async (said = message) => {
    const words = String(said).trim()
    const typed = said === message
    if (!words || waiting || !turns.length) return undefined
    const history = historyFor(turns)
    const mine = { id: newId(), role: 'user', content: words }
    setTurns((all) => [...all, mine])
    if (typed) setMessage('')
    setError('')
    setRefusal(null)
    setWaiting(true)
    try {
      const out = await Meteor.callAsync(M.turn, { message: words, history })
      // what is already a chip in this talk (kept, skipped or open) is not proposed again
      const proposed = freshProposals(out.proposed, turns).map((fact) => ({ ...fact, id: newId(), state: 'open' }))
      setTurns((all) => [...all, { id: newId(), role: 'assistant', content: out.reply, proposed }])
      if (proposed.length) announce(`The agent heard ${proposed.length === 1 ? 'one thing' : `${proposed.length} things`} to keep. Keep, edit or skip each.`)
      return interviewAnswer(out.reply, proposed, (kind) => KIND_LABELS[kind] || kind)
    } catch (requestError) {
      // Their words come back to the box, and the turn that did not go is taken away.
      setTurns((all) => all.filter((turn) => turn.id !== mine.id))
      if (typed) setMessage(words)
      if (isCreditRefusal(requestError?.error)) setRefusal({ error: requestError.error, reason: requestError.reason, details: requestError.details, message: words })
      else setError(reason(requestError, 'That did not go through. Try again.'))
      // a voice session's agent hears why, in the meter's own words when it refused
      return { text: reason(requestError, 'That did not go through. Try again.'), ok: false }
    } finally {
      setWaiting(false)
    }
  }

  const change = (factId, patch) => setTurns((all) => all.map((turn) => (turn.proposed?.some((fact) => fact.id === factId)
    ? { ...turn, proposed: turn.proposed.map((fact) => (fact.id === factId ? { ...fact, ...patch } : fact)) }
    : turn)))

  // After a chip is decided, focus goes to the next open chip's Keep in the same turn, else the
  // message box (never back up to an earlier turn).
  const focusNext = (fact) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const list = document.querySelector(`[data-interview-panel] [data-interview-fact="${fact.id}"]`)?.closest('ul')
    const next = list?.querySelector('[data-interview-keep]:not([disabled])')
    if (next) next.focus()
    else inputRef.current?.focus({ preventScroll: true })
  }))

  const keep = async (fact, edited = null) => {
    if (keeping.current) {
      announce('Saving…')
      return false
    }
    keeping.current = true
    setSaving(true)
    const chosen = edited || { kind: fact.kind, text: fact.text }
    try {
      const out = await Meteor.callAsync(M.keep, [chosen])
      // Kept only when About you has it now: a full About you, or words it could not take, say so.
      const outcome = keepOutcome(out)
      if (outcome.error) {
        change(fact.id, { error: outcome.error })
        keepError.current = outcome.error
        announce(outcome.error)
        return false
      }
      change(fact.id, { ...chosen, state: 'kept', error: '' })
      setKept((all) => [...all, chosen])
      announce(outcome.state === 'kept' ? `Kept: ${chosen.text}` : `You already had: ${chosen.text}`)
      onKept()
      focusNext(fact)
      return true
    } catch (requestError) {
      keepError.current = reason(requestError, 'That could not be kept. Try again.')
      change(fact.id, { error: keepError.current })
      return false
    } finally {
      keeping.current = false
      setSaving(false)
    }
  }
  const skip = (fact) => {
    change(fact.id, { state: 'skipped' })
    announce(`Skipped: ${fact.text}`)
    focusNext(fact)
  }

  // chips nobody decided on: still open above when the person finishes, and not kept
  const open = turns.reduce((count, turn) => count + (turn.proposed || []).filter((fact) => fact.state === 'open').length, 0)
  const finish = () => {
    setFinished(true)
    requestAnimationFrame(() => summaryRef.current?.focus())
  }

  // While the agent answers, the box waits with the reason beside it (and takes focus again after).
  const hold = waiting ? { reason: turns.length ? 'The agent is reading your answer…' : 'The agent is thinking of a first question…' } : null

  // Talking with the agent: empty words begin (the first question, already asked when the talk
  // opened), words are an answer (send), and "yes, keep them" keeps the open chips of the newest turn
  // (one Keep at a time, as the buttons do); "no" skips them.
  const turnsNow = useRef(turns)
  turnsNow.current = turns
  const voiceRun = async ({ text: said = '', confirm } = {}) => {
    const latest = [...turnsNow.current].reverse().find((turn) => turn.role === 'assistant')
    const openFacts = (latest?.proposed || []).filter((fact) => fact.state === 'open')
    if (confirm === 'keep' || confirm === 'discard') {
      if (!openFacts.length) return ANSWER.none
      if (confirm === 'discard') {
        openFacts.forEach(skip)
        return ANSWER.discarded
      }
      const results = []
      // One Keep at a time, in order: each save must finish before the next (About you's own queue).
      // eslint-disable-next-line no-restricted-syntax
      for (const fact of openFacts) {
        // keep() marks the chip and says why one could not be kept beside it
        keepError.current = ''
        // eslint-disable-next-line no-await-in-loop
        const ok = await keep(fact)
        results.push(ok ? { text: fact.text, state: 'kept' } : { text: fact.text, error: keepError.current || 'That could not be kept. Try again.' })
      }
      return keptFactsAnswer(results)
    }
    if (!said.trim()) {
      if (latest) return replyAnswer(latest.content)
      return (await start()) ?? ANSWER.busy
    }
    if (waiting) return hold?.reason || ANSWER.busy
    if (finished) return keptSummary(kept, { open })
    return (await send(said)) ?? ANSWER.busy
  }

  const composer = (
    <>
      {!finished && (
        <ConversationComposer
          voice={{ surface: 'voice.interview', run: voiceRun }}
          inputRef={inputRef}
          value={message}
          onChange={setMessage}
          onSubmit={() => send()}
          hold={hold}
          canSubmit={Boolean(message.trim()) && !waiting && turns.length > 0}
          submitLabel="Send"
          placeholder="Answer in your own words"
          helperText="You can skip any question. Nothing is kept until you choose Keep."
          maxLength={INTERVIEW_LIMITS.message}
          starters={turns.length > 0 && !waiting ? (
            <Button size="small" onClick={() => send(SKIP_WORDS)} sx={{ mb: SPACE.hair }} data-interview-skip-question="">Skip this question</Button>
          ) : null}
          error={startFailed ? '' : error}
        />
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: SPACE.tight, mt: finished ? 0 : SPACE.hair }}>
        {finished
          ? <Button size="small" variant="contained" color="secondary" onClick={() => onDone(kept)} data-interview-close="">Close</Button>
          : <Button size="small" onClick={finish} disabled={waiting} data-interview-done="">Done for now</Button>}
      </Box>
    </>
  )

  return (
    <Box data-interview-panel="">
      <ConversationPanel title="Your talk with the agent" headingLevel="h3" inline returnFocus="[data-interview-open]" onClose={() => onDone(kept)} composer={composer}>
        <Box component="ol" aria-label="The conversation" sx={{ m: 0, p: 0 }}>
          {turns.map((turn) => (turn.role === 'user'
            ? <ChatTurn key={turn.id} who="you">{turn.content}</ChatTurn>
            : (
              <ChatTurn key={turn.id} who="slatebox" after={turn.proposed?.length ? (
                <Box component="ul" aria-label="What the agent heard, to keep or skip" sx={{ m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: SPACE.hair }}>
                  {turn.proposed.map((fact) => <FactChip key={fact.id} fact={fact} onKeep={keep} onSkip={skip} saving={saving} />)}
                </Box>
              ) : null}>
                {turn.content}
              </ChatTurn>
            )))}
          {refusal && !waiting && (
            <ChatTurn who="slatebox">
              <PayNotice refusal={refusal} from="draft" retry={() => (refusal.message ? send(refusal.message) : start())} inline ownKey keepReason />
            </ChatTurn>
          )}
          {waiting && <ChatThinking />}
        </Box>
        {startFailed && (
          <Alert severity="warning" role="alert" sx={{ my: SPACE.text }} action={<Button color="inherit" size="small" onClick={start}>Retry</Button>}>{error}</Alert>
        )}
        {finished && (
          <Box ref={summaryRef} tabIndex={-1} role="status" data-interview-summary="" sx={{ my: SPACE.text, outline: 'none' }}>
            <Typography sx={{ fontWeight: 600 }}>Done for now</Typography>
            <Typography variant="body2">{keptSummary(kept, { open })}</Typography>
            <FinePrint>Everything you kept is in About you, where you can change, hide or remove it.</FinePrint>
            {/* For you on My slates, asked afresh so what was just kept shows in the ideas (only once something was kept) */}
            {kept.length > 0 && (
              <Button size="small" variant="outlined" color="secondary" sx={{ mt: SPACE.tight }} data-interview-for-you=""
                onClick={() => navigate('/', { state: { forYou: 'fresh' } })}>See ideas made for you</Button>
            )}
          </Box>
        )}
        <Box role="status" aria-live="polite" sx={visuallyHidden}>{status}</Box>
      </ConversationPanel>
    </Box>
  )
}

Interview.propTypes = {
  onKept: PropTypes.func,
  onDone: PropTypes.func.isRequired,
}
Interview.defaultProps = { onKept: () => {} }
