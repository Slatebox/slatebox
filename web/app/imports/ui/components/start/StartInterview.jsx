import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import createAnonymousUser from '../../../api/client/createAnonymousUser'
import { BOARD_KIND_LABELS, START_LIMITS, START_OPENING, START_WORDS, planTurnText, startHistoryFor } from '../../../api/common/start-interview.mjs'
import { tileBuildWords } from '../../../api/common/personal-tiles.mjs'
import ConversationPanel, { ConversationComposer } from '../ConversationPanel'
import ChatTurn, { ChatThinking } from '../ChatTurn'
import PayNotice, { isCreditRefusal } from '../PayNotice'
import { SPACE } from '../../common/AccountLayout'

// The start page's "Talk it through with Slatebox" (/new?talk=1): the agent asks what the person
// wants Slatebox to make and a few specific questions, one a turn, then proposes a plan of one to
// four boards. The plan is kept as their own tile under "Yours" (it is there from the moment it is
// proposed), and Build it makes the slate. Until it is built the person can go on talking to change
// it (the same tile, revised: tileId), or Start over. The opening question is the page's own (no model is
// asked until the person answers); each answer is one call (start.interview.turn,
// server/start/meteor.js) and the transcript is text, so the voice branch's mic sits on the same
// message box (ConversationComposer) and drives the same turns. A visitor with no account yet gets
// a guest on their first answer, as the start page's other ways in do. When the meter refuses a
// turn, its refusal is the agent's turn, with its way on (PayNotice), in the meter's own words.
const M = CONSTANTS.methods.start
// "Make my plan now" sends the same words a person would type to finish.
const PLAN_WORDS = 'That is everything. Make the plan.'
const reason = (error, fallback) => error?.reason || error?.message || fallback
const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }
let nextId = 0
const newId = () => {
  nextId += 1
  return `start-turn-${nextId}`
}

function PlanCard({ plan, tile, onBuild, building }) {
  const words = tileBuildWords(tile)
  return (
    <Box data-start-plan={tile.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', p: SPACE.text, display: 'flex', flexDirection: 'column', gap: SPACE.tight }}>
      <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{plan.title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{plan.blurb}</Typography>
      <Box component="ol" aria-label="The boards it makes" sx={{ m: 0, pl: SPACE.block, display: 'flex', flexDirection: 'column', gap: SPACE.hair }}>
        {plan.boards.map((board, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={index}><Typography variant="body2"><strong>{board.name}</strong> ({BOARD_KIND_LABELS[board.kind]}). {board.why}</Typography></li>
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary">Kept under Yours on this page, so you can make it again any time. Want something changed? Say it below before you build it.</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.tight }}>
        <Button variant="contained" color="secondary" onClick={() => { if (!building) onBuild(tile) }} aria-disabled={building || undefined} aria-label={words.button} data-start-build="">
          {building ? 'Building…' : 'Build it'}
        </Button>
      </Box>
    </Box>
  )
}

const planShape = PropTypes.shape({
  title: PropTypes.string.isRequired,
  blurb: PropTypes.string.isRequired,
  boards: PropTypes.arrayOf(PropTypes.shape({ kind: PropTypes.string.isRequired, name: PropTypes.string.isRequired, why: PropTypes.string.isRequired })).isRequired,
})
PlanCard.propTypes = {
  plan: planShape.isRequired,
  tile: PropTypes.shape({ id: PropTypes.string.isRequired, title: PropTypes.string.isRequired }).isRequired,
  onBuild: PropTypes.func.isRequired,
  building: PropTypes.bool.isRequired,
}

/**
 * The talk, in place on the start page. `onPlanned(tile)` runs when the plan is kept (the page reads
 * its tiles again); `onBuild(tile)` builds it (the page's own build, shared with the tiles); `onClose`
 * when the person leaves the talk.
 */
const openingTurns = () => [{ id: newId(), role: 'assistant', content: START_OPENING, local: true }]

export default function StartInterview({ onPlanned, onBuild, onClose, building }) {
  // [{ id, role: 'assistant' | 'user', content, local?, plan? }]: the opening question is the page's own, never sent;
  // a plan's turn is sent as its words (planTurnText), so a turn that changes it knows what was proposed
  const [turns, setTurns] = useState(openingTurns)
  const [message, setMessage] = useState('')
  const [waiting, setWaiting] = useState(null) // null | 'ask' | 'plan'
  const [error, setError] = useState(null) // null | { code, message }
  const [refusal, setRefusal] = useState(null)
  const [made, setMade] = useState(null) // { plan, tile }
  const [status, setStatus] = useState('')
  const inputRef = useRef(null)
  const planRef = useRef(null)

  // The talk is announced the moment it opens: focus goes to the message box under the opening question.
  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })) }, [])

  const answers = turns.filter((turn) => turn.role === 'user').length
  const send = async (said = message, planNow = false) => {
    const words = String(said).trim()
    const typed = said === message
    if (!words || waiting) return
    const history = startHistoryFor(turns.filter((turn) => !turn.local))
    const mine = { id: newId(), role: 'user', content: words }
    setTurns((all) => [...all, mine])
    if (typed) setMessage('')
    setError(null)
    setRefusal(null)
    const planning = planNow || Boolean(made) || answers + 1 >= START_LIMITS.planBy
    setWaiting(planning ? 'plan' : 'ask')
    setStatus(planning ? START_WORDS.planning : START_WORDS.thinking)
    try {
      // The guest is made on the first answer: a visitor who leaves before answering leaves nothing behind.
      if (!Meteor.userId()) await createAnonymousUser()
      // once a plan is kept, a turn changes that tile's plan (before it is built) instead of keeping another
      const out = await Meteor.callAsync(M.interview.turn, { message: words, history, planNow, ...(made && { tileId: made.tile.id }) })
      if (out.plan) {
        const changed = Boolean(made)
        setMade({ plan: out.plan, tile: out.tile })
        setTurns((all) => [...all, { id: newId(), role: 'assistant', content: planTurnText(out.plan), plan: true }])
        setStatus(changed ? `Your plan is changed: ${out.plan.title}.` : `Your plan is ready: ${out.plan.title}. It is kept under Yours.`)
        onPlanned(out.tile)
        requestAnimationFrame(() => planRef.current?.focus())
      } else {
        setTurns((all) => [...all, { id: newId(), role: 'assistant', content: out.reply }])
        setStatus('')
      }
    } catch (requestError) {
      // Their words come back to the box, and the turn that did not go is taken away.
      setTurns((all) => all.filter((turn) => turn.id !== mine.id))
      if (typed) setMessage(words)
      setStatus('')
      if (isCreditRefusal(requestError?.error)) setRefusal({ error: requestError.error, reason: requestError.reason, details: requestError.details, message: words })
      else setError({ code: requestError?.error, message: reason(requestError, START_WORDS.failed) })
    } finally {
      setWaiting(null)
    }
  }

  // Start over: a new talk from the opening question. A plan already proposed stays under Yours.
  const startOver = () => {
    setTurns(openingTurns())
    setMade(null)
    setMessage('')
    setError(null)
    setRefusal(null)
    setStatus('A new talk. What do you want Slatebox to make?')
    requestAnimationFrame(() => inputRef.current?.focus())
  }
  const hold = waiting ? { reason: waiting === 'plan' ? START_WORDS.planning : START_WORDS.thinking } : null
  const full = answers >= START_LIMITS.answers
  const lastPlan = turns.findLastIndex((turn) => turn.plan)
  const composer = (
    <>
      <ConversationComposer
        inputRef={inputRef}
        value={message}
        onChange={setMessage}
        onSubmit={() => send()}
        hold={hold}
        canSubmit={Boolean(message.trim()) && !waiting && !full}
        submitLabel="Send"
        placeholder={made ? 'Say what to change' : 'Answer in your own words'}
        helperText={full ? START_WORDS.done : made ? START_WORDS.revise : 'You can skip any question. Nothing is built until you choose Build it.'}
        maxLength={START_LIMITS.message}
        starters={!waiting && (made || answers >= 2) ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.tight, mb: SPACE.hair }}>
            {!made && <Button size="small" onClick={() => send(PLAN_WORDS, true)} data-start-plan-now="">Make my plan now</Button>}
            {made && <Button size="small" onClick={startOver} data-start-over="">Start over</Button>}
          </Box>
        ) : null}
        error={error?.message || ''}
      />
      {error?.code === 'guest' && (
        <Box sx={{ mt: SPACE.hair }}><Button size="small" variant="outlined" component={RouterLink} to="/signup" data-start-save-account="">Save your account</Button></Box>
      )}
    </>
  )

  return (
    <Box data-start-interview="">
      <ConversationPanel title="Talk it through with Slatebox" headingLevel="h1" inline returnFocus="[data-start-talk]" onClose={onClose} composer={composer}>
        <Box component="ol" aria-label="The conversation" sx={{ m: 0, p: 0 }}>
          {turns.map((turn, index) => (turn.plan ? (
            // a plan's turn: the latest is its card (Build it), an earlier one only says it was changed after
            <ChatTurn key={turn.id} who="slatebox" after={index === lastPlan && made ? (
              <Box ref={planRef} tabIndex={-1} role="region" aria-label={`Your plan: ${made.plan.title}`} sx={{ outline: 'none' }}>
                <PlanCard plan={made.plan} tile={made.tile} onBuild={onBuild} building={building === made.tile.id} />
              </Box>
            ) : null}>{index === lastPlan ? 'Here is your plan.' : 'A plan, changed below.'}</ChatTurn>
          ) : <ChatTurn key={turn.id} who={turn.role === 'user' ? 'you' : 'slatebox'}>{turn.content}</ChatTurn>))}
          {refusal && !waiting && (
            <ChatTurn who="slatebox">
              <PayNotice refusal={refusal} from="draft" retry={() => send(refusal.message)} inline ownKey keepReason />
            </ChatTurn>
          )}
          {waiting && <ChatThinking />}
        </Box>
        {error && !made && error.code === 'tiles-full' && <Alert severity="info" sx={{ my: SPACE.tight }}>{error.message}</Alert>}
        <Box role="status" aria-live="polite" sx={visuallyHidden}>{status}</Box>
      </ConversationPanel>
    </Box>
  )
}

StartInterview.propTypes = {
  onPlanned: PropTypes.func.isRequired,
  onBuild: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  building: PropTypes.string,
}
StartInterview.defaultProps = { building: null }
