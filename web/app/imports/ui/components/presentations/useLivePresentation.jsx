import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useAtomValue } from 'jotai'
import PresentSlate from '../PresentSlate'
import PresenterFrame from './PresenterFrame'
import FollowPresentation from './FollowPresentation'
import { NativePresentationStates, livePresentationTicket } from '../../../api/client/creativeSlateStates'
import { currentPresentation, slateBackgroundColorAtom } from '../../jotai/atoms'
import { stepOf } from './presentationSteps.mjs'

// The step everyone is on, counted as the presenter counts it (see presentationSteps).
const where = (view, viewpoints) => {
  const { step, total, start } = stepOf(view, viewpoints)
  // A deck of one overview has no steps to count: it is the whole slate.
  return view < start || total === 0 ? 'whole slate' : `${step} of ${total}`
}

// Presenting to everyone on a slate, and following someone who is. Both use the presenter: the
// person presenting plays the slate's presentation and everyone following sees the same
// viewpoint over their own drawing of the slate. The header owns the buttons: "Present to
// everyone here" is an item in Present ▾ (`canStart`, `start`), and while someone else presents,
// "Follow presentation" takes Present's place (`live`, `follow`). This hook owns the session
// ({ sessionId, step, revision, expiresAt }, and the deck it plays, published apart so that it is
// sent once per session), and `view` is the presenter and its notices.
export function useLivePresentation({ enabled = true, shareId, title, workshop, mayLead = false }) {
  const storageKey = 'slatebox.livePresentation.' + shareId
  const { session, liveDeck, canLead, connected } = useTracker(() => {
    if (!enabled || !shareId) return {}
    Meteor.subscribe('slates.presentationState', shareId)
    const state = NativePresentationStates.findOne(shareId, { fields: { livePresentation: 1, liveDeck: 1, canEdit: 1 } })
    return { session: state?.livePresentation, liveDeck: state?.liveDeck, canLead: state?.canEdit, connected: Meteor.status().connected }
  }, [shareId, enabled])
  const latest = useRef(session)
  latest.current = session
  const background = useAtomValue(slateBackgroundColorAtom)
  const playing = useAtomValue(currentPresentation)
  const [ticket, setTicket] = useState(() => shareId ? livePresentationTicket(shareId) : null)
  const [opening, setOpening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // One header serves every slate opened in this tab: each slate keeps its own ticket.
  useEffect(() => { setTicket(shareId ? livePresentationTicket(shareId) : null); setOpening(false); setNotice(''); setError('') }, [shareId])
  const active = Boolean(session && ticket?.sessionId === session.sessionId)
  const controlKey = active && canLead && ticket.controlKey
  // The deck does not change during a session; keep one object so the follower draws once.
  const deckSession = session && liveDeck?.sessionId === session.sessionId ? session.sessionId : null
  const deck = useMemo(() => deckSession ? { name: liveDeck.name, viewpoints: liveDeck.viewpoints } : null, [deckSession])
  const seen = useRef(null)
  // Where the presenter has asked to be, and what the server has: a quick run of steps is sent
  // one after another, each with the revision the previous one returned.
  const lead = useRef({ wanted: null, sent: null, revision: null, sending: false })

  function remember(next) {
    setTicket(next)
    try {
      if (next) sessionStorage.setItem(storageKey, JSON.stringify(next))
      else sessionStorage.removeItem(storageKey)
    } catch { /* The current tab can still take part without storage. */ }
  }

  useEffect(() => {
    if (active) seen.current = session.sessionId
    else if (seen.current && seen.current === ticket?.sessionId && connected) {
      seen.current = null
      remember(null)
      setError('')
      setNotice('The live presentation has ended.')
    }
  }, [active, connected, session?.sessionId, ticket?.sessionId])

  // The notice is said once; it does not stay in the toolbar.
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  // A move that fails stays wanted: it is sent again, from the session as the server now has it,
  // on the next renewal or reconnection, so the presenter and everyone following meet again.
  async function send() {
    const state = lead.current
    const now = latest.current
    if (state.sending || !controlKey || !connected || !now || state.wanted === null || state.wanted === state.sent) return
    state.sending = true
    const step = state.wanted
    let moved = false
    try {
      const result = await Meteor.callAsync('creativeSlates.movePresentation', shareId, now.sessionId, controlKey,
        state.revision ?? now.revision, step)
      state.revision = result.revision
      state.sent = result.step
      moved = true
      setError('')
    } catch (err) {
      state.revision = null
      setError(err.reason || err.message || 'Could not update the live presentation. Please try again.')
    } finally { state.sending = false }
    if (moved) send()
  }

  useEffect(() => {
    if (!controlKey || !connected) return undefined
    lead.current.revision ??= session.revision
    lead.current.sent ??= session.step
    // Keep the session while its presenter is still in the room.
    const timer = window.setInterval(() => {
      const state = lead.current
      const now = latest.current
      if (state.sending || !now) return
      if (state.wanted !== null && state.wanted !== state.sent) { send(); return }
      Meteor.callAsync('creativeSlates.movePresentation', shareId, now.sessionId, controlKey,
        state.revision ?? now.revision, state.sent ?? now.step).catch(() => {})
    }, 40000)
    return () => window.clearInterval(timer)
  }, [shareId, controlKey, connected, session?.sessionId])

  async function command(action) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try { await action() }
    catch (err) { setError(err.reason || err.message || 'Could not update the live presentation. Please try again.') }
    finally { setBusy(false) }
  }

  // The presenter opens first: it builds the slate's presentation, then the session starts with it.
  function start() {
    setError('')
    setNotice('')
    lead.current = { wanted: null, sent: null, revision: null, sending: false }
    setOpening(true)
  }
  function begin(nextDeck) {
    if (session) return
    command(async () => {
      try {
        const started = await Meteor.callAsync('creativeSlates.startPresentation', shareId, nextDeck)
        lead.current = { wanted: lead.current.wanted ?? started.step, sent: started.step, revision: started.revision, sending: false }
        remember({ sessionId: started.sessionId, controlKey: started.controlKey })
      } catch (err) {
        setOpening(false)
        throw err
      }
    })
  }
  // The presenter stays open from the moment it opens until the session it started arrives.
  useEffect(() => { if (active) setOpening(false) }, [active])
  // Where the presenter went while the session was starting is sent once it has started.
  useEffect(() => { send() }, [controlKey, connected])
  function moveTo(step) {
    lead.current.wanted = step
    send()
  }
  // The presenter could not draw the slate: it closes, and says why, before anything is shared.
  function fail(message) {
    if (active) setError(message)
    else command(async () => { setOpening(false); throw new Error(message) })
  }

  function leave() {
    setOpening(false)
    if (controlKey && connected) {
      command(async () => {
        // A step still on its way is let through first: ending carries the revision it returns.
        await new Promise((resolve) => {
          const check = () => (lead.current.sending ? setTimeout(check, 50) : resolve())
          check()
        })
        const end = (revision) => Meteor.callAsync('creativeSlates.endPresentation', shareId, session.sessionId, controlKey, revision)
        try {
          await end(lead.current.revision ?? latest.current?.revision ?? session.revision)
        } catch (err) {
          // The session moved on meanwhile (a renewal, a step sent again): end it as the server has it now.
          const now = latest.current?.revision
          if (now === undefined || now === lead.current.revision) throw err
          await end(now)
        }
        lead.current = { wanted: null, sent: null, revision: null, sending: false }
        remember(null)
        setNotice('The live presentation has ended.')
      })
    } else {
      remember(null)
      setError('')
    }
  }

  const follow = () => {
    setNotice('')
    setError('')
    remember({ sessionId: session.sessionId })
  }

  let view = null
  if (opening || (active && controlKey)) {
    // A presenter back in a session it leads (this tab reloaded) plays the session's deck from
    // where everyone is.
    const resume = active && !opening && deck ? { deck, step: session.step } : null
    view = <PresenterFrame open keepOutOfFullScreen escapeExits={false} label="Live presentation" title={title} background={background} error={error}
      status={!connected ? 'Reconnecting…' : active ? 'Presenting to everyone here · ' + where(playing.currentView, playing.viewpoints) : 'Starting…'}
      exitLabel={active ? 'End presentation' : 'Exit presentation'} onExit={leave}>
      <PresentSlate slate={window.slate} workshop={workshop} live={{ onDeck: begin, onViewChange: moveTo, onFail: fail, resume }} />
    </PresenterFrame>
  } else if (active && deck) {
    view = <PresenterFrame open keepOutOfFullScreen label="Live presentation" title={title} background={background} error={error}
      status={!connected ? 'Reconnecting…' : 'Following the presenter · ' + where(session.step, deck.viewpoints)}
      exitLabel="Leave presentation" onExit={leave}>
      <FollowPresentation slate={window.slate} deck={deck} step={session.step} workshop={workshop} />
    </PresenterFrame>
  } else if (notice || error) view = <>
    {notice && <p className="sb-live-notice" role="status">{notice}</p>}
    {error && <p className="sb-live-notice" role="alert">{error}</p>}
  </>
  if (!enabled) return { canStart: false, live: false, view: null }
  return {
    // Someone (another person, or this person in another tab) is presenting and this tab is not in it.
    live: Boolean(session) && !active,
    // Until the session state has arrived, the header's own say on who may edit decides.
    canStart: Boolean(!session && (canLead ?? mayLead) && !opening),
    starting: busy || opening,
    disabled: busy || !connected,
    start, follow, view,
  }
}
