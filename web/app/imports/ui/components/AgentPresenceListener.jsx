// Agents on the canvas. The server publishes a record for each agent run saving to this slate
// (agentPresence.forSlate); the engine draws each one as a named pointer with its plan
// (createAgentPresence). People's cursors come from the relay and look different: nothing a page
// sets there can draw an agent here. The corner's agents menu lists each agent; its details show the full plan.
//
// What an agent suggests is published too (agentSuggestions.forSlate) and drawn live, in place, as
// ghosts on every screen (the engine's createAgentSuggestions): each answer is one framed group with
// Keep all / Discard all on it, a ghost's own Keep and Discard show under the pointer for people who
// may edit, and Keep all, Discard all, the agent's activity with Undo, and
// Edit directly sit in its details (AgentDetails, opened from the corner's agents menu). Each choice calls suggestions.decide or agents.control, the same
// actions a token calls; the server checks the edit right again.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Snackbar from '@mui/material/Snackbar'
import { visibleAgents, agentStepText, agentChecklist, agentOrigin, AGENT_PALETTE, compat } from 'slateboxjs'
import { AgentPresence, AgentSuggestions } from '../../api/common/models'
import { clockOffset, onScreenClock } from '../../api/common/agent-clock.mjs'
import { activityLine, agentsOnRoster, pendingCount, withWaiting } from '../../api/common/agent-roster.mjs'
import EnterpriseSlot from '../common/EnterpriseSlot'
import Hexagon from './AgentMark'
import { expectOwnRuns } from '../../api/client/ownRuns.mjs'

// Whether this person may edit the slate (Canvas sets it): Keep, Discard, Undo and Pause show only then.
export const agentControlsAtom = atom(false)
// Agents that stay on the roster while they are on the slate, working or not: invited agents
// (enterprise/ fills it; empty where enterprise code is locked). Each is one chip, like every agent.
export const rosterExtrasAtom = atom([])
// Open one agent's details (its agentId), e.g. right after it was invited: from its row in the corner's
// agents menu when that is open, else from the agent trigger on the corner's pill (CornerPresence).
export const openAgentAtom = atom(null)
// "+ Invite agent" in the corner's agents menu: the element to open the invite panel at, or null. The
// menu sets it; enterprise/ (AgentsOnSlate) opens its quick panel or walkthrough there.
export const inviteRequestAtom = atom(null)
// Whether this page can invite agents (enterprise/ sets it while AgentsOnSlate offers invites); the
// menu shows + Invite agent only then, so it is never an item that does nothing.
export const inviteAvailableAtom = atom(false)
// An agent's colour, from its colorIndex, as its chip, pointer and ghosts draw it.
export const agentColor = (colorIndex) => AGENT_PALETTE[(Number(colorIndex) || 0) % AGENT_PALETTE.length]

// The records of this slate, newest per agent, as the engine would show them now. Re-read every
// second while any is shown, so a silent or ended run leaves on time: the server's time, carried
// over to this screen's clock, so a clock that is off neither hides a live agent nor keeps a
// stale one.
export function useAgentPresence(shareId) {
  const { records, offset } = useTracker(() => {
    if (!shareId) return { records: [], offset: 0 }
    Meteor.subscribe('agentPresence.forSlate', shareId)
    const clock = AgentPresence.findOne('clock')
    return {
      records: AgentPresence.find({ agentKey: { $exists: true } }, { sort: { updatedAt: -1 } }).fetch(),
      offset: clockOffset(clock),
    }
  }, [shareId])
  const [, tick] = useState(0)
  useEffect(() => {
    if (!records.length) return undefined
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [records.length])
  // One pointer per agent: its newest run on this slate (an agent's earlier run, such as an
  // invited agent's greeting, never draws a second pointer beside the one at work).
  const newest = new Map()
  for (const record of records) {
    const who = record.agentId || record.agentKey
    if (!newest.has(who)) newest.set(who, onScreenClock(record, offset))
  }
  return { all: [...newest.values()], shown: visibleAgents([...newest.values()], Date.now()).map((item) => item.record) }
}

/** What agents suggested on this slate, oldest first, and its agent controls (paused, who edits directly). */
export function useAgentSuggestions(shareId) {
  return useTracker(() => {
    if (!shareId) return { actions: [], controls: { paused: false, modes: {}, editDirectly: false } }
    Meteor.subscribe('agentSuggestions.forSlate', shareId)
    const controls = AgentSuggestions.findOne('controls') || { paused: false, modes: {}, editDirectly: false }
    const actions = AgentSuggestions.find({ actionId: { $exists: true } }, { sort: { createdAt: 1 } }).fetch()
    return { actions, controls }
  }, [shareId])
}

// The canvas's edges a panel covers, in screen pixels: Canvas.jsx keeps the visible canvas area's
// distance from the window's right and bottom edges in --sb-canvas-right and --sb-canvas-bottom.
export function coveredEdges(engine) {
  try {
    const svg = engine?.canvas?.node?.getBoundingClientRect?.()
    if (!svg?.width) return null
    const css = getComputedStyle(document.documentElement)
    const right = parseFloat(css.getPropertyValue('--sb-canvas-right')) || 0
    const bottom = parseFloat(css.getPropertyValue('--sb-canvas-bottom')) || 0
    return { right: Math.max(0, svg.right - (window.innerWidth - right)), bottom: Math.max(0, svg.bottom - (window.innerHeight - bottom)) }
  } catch {
    return null
  }
}

// The canvas each open slate draws on (AgentPresenceListener sets it). A Keep is this person's own change: the
// run it saves is drawn on their canvas as one step of their undo history (ownRuns.mjs, SlateOperationListener
// draws it with ownStep), and on every other page as someone else's change. Discard saves nothing; an agent
// action's Undo is that agent's own (per action), drawn as anyone else's change.
const keepers = new Map()
const decide = (shareId, input) => {
  const asked = Meteor.callAsync('suggestions.decide', { shareId, ...input })
  const slate = input.decision === 'keep' ? keepers.get(shareId) : null
  return slate ? expectOwnRuns(slate, asked, (out) => (out?.kept?.length ? out.revision : null)) : asked
}

// Edit directly is offered to the person who brought the agent, and to the slate's owner (the server checks again).
export const mayDirect = (controls, agentId) => Boolean(controls?.owner || (Array.isArray(controls?.mine) && controls.mine.includes(agentId)))

export default function AgentPresenceListener({ slate, canEdit = false }) {
  const { all: records } = useAgentPresence(slate.shareId)
  const { actions } = useAgentSuggestions(slate.shareId)
  // Each pointer knows whether its agent's suggestion still waits: its tag says "Waiting for you" then, never "Done".
  const all = useMemo(() => withWaiting(records, actions), [records, actions])
  const setControls = useSetAtom(agentControlsAtom)
  useEffect(() => { setControls(Boolean(canEdit)) }, [canEdit, setControls])
  const presence = useRef(null)
  const ghosts = useRef(null)
  const latest = useRef({ all, actions })
  latest.current = { all, actions }
  const canAct = useRef(canEdit)
  canAct.current = canEdit
  const [told, setTold] = useState('')
  // Each drawing loads only when it is needed: the agents' pointers (slateboxjs/presence) when the first agent
  // arrives, the suggestions (slateboxjs/suggestions: ghosts, frames, Keep and Discard) when the first suggestion
  // waits. A slate no agent works on fetches neither.
  const wantPointers = all.length > 0
  const wantGhosts = actions.some((action) => pendingCount(action) > 0)
  useEffect(() => {
    const shareId = slate?.shareId
    if (!shareId) return undefined
    keepers.set(shareId, slate)
    return () => { if (keepers.get(shareId) === slate) keepers.delete(shareId) }
  }, [slate])
  // The page holds the v1 facade; the engine's own slate (its svg.js canvas) is slate.v2.
  const engineOf = (s) => s?.v2 ?? s
  const said = (error) => setTold(error?.reason || error?.message || 'That did not work. Try again.')
  useEffect(() => {
    const engine = engineOf(slate)
    if (!wantGhosts || typeof engine?.canvas?.group !== 'function') return undefined
    let gone = false
    const shareId = slate.shareId
    import('slateboxjs/suggestions')
      .then(({ createAgentSuggestions }) => {
        if (gone) return
        ghosts.current = createAgentSuggestions(engine, {
          canAct: () => canAct.current,
          onKeep: ({ actionId, itemId }) => decide(shareId, { decision: 'keep', actionId, itemIds: [itemId] }).catch(said),
          onDiscard: ({ actionId, itemId }) => decide(shareId, { decision: 'discard', actionId, itemIds: [itemId] }).catch(said),
          // Keep all / Discard all on an answer's frame: its waiting items at once (one save, one Undo).
          onKeepAll: (actionId) => decide(shareId, { decision: 'keep', actionId }).catch(said),
          onDiscardAll: (actionId) => decide(shareId, { decision: 'discard', actionId }).catch(said),
          // An action card (a change outside Slatebox) shows Approve and Decline, which are Keep and Discard of its note
          // alone. Try again anyway, on a card whose change may have been made already, sends it once more on purpose.
          onTryAgain: ({ actionId, itemId }) => {
            const cardId = latest.current.actions.find((a) => a.actionId === actionId)?.items?.find((i) => i.id === itemId)?.card?.id
            if (cardId) Meteor.callAsync('connectors.approve', { cardId, again: true }).then((out) => { if (out?.say) setTold(out.say) }).catch(said)
          },
          toNode: compat.v1NodeToV2,
        })
        ghosts.current.set(latest.current.actions)
      })
      .catch((error) => console.warn('Suggestions on this slate could not be drawn.', error))
    return () => {
      gone = true
      ghosts.current?.destroy()
      ghosts.current = null
    }
  }, [slate, wantGhosts])
  useEffect(() => {
    const engine = engineOf(slate)
    if (!wantPointers || typeof engine?.canvas?.group !== 'function') return undefined
    let gone = false
    import('slateboxjs/presence')
      .then(({ createAgentPresence }) => {
        if (gone) return
        // What Ask Slatebox or the settings cover of the canvas is not view: pointers, tags and the
        // edge marker of an agent working out of sight stay in what people can see. A pointer can point
        // at a ghost (ghost-<id>) as soon as it is drawn, whichever entry loaded first.
        presence.current = createAgentPresence(engine, { insets: () => coveredEdges(engine) })
        presence.current.set(latest.current.all)
      })
      .catch((error) => console.warn('Agents on this slate could not be drawn.', error))
    return () => {
      gone = true
      presence.current?.destroy()
      presence.current = null
    }
  }, [slate, wantPointers])
  useEffect(() => {
    ghosts.current?.set(actions)
  }, [actions, canEdit])
  useEffect(() => {
    presence.current?.set(all)
  }, [all])
  return <Snackbar open={Boolean(told)} autoHideDuration={5000} onClose={() => setTold('')} message={told} />
}

AgentPresenceListener.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  slate: PropTypes.object.isRequired,
  canEdit: PropTypes.bool,
}

/** The agents on this slate's roster, as the corner's pill and menu list them (agentsOnRoster). */
export function useRosterAgents(shareId) {
  const records = useAgentPresence(shareId).shown
  const { actions, controls } = useAgentSuggestions(shareId)
  const extras = useAtomValue(rosterExtrasAtom)
  const agents = useMemo(() => agentsOnRoster(records, actions, Date.now(), extras), [records, actions, extras])
  return { agents, controls }
}

/** Pause all agents on the slate, or resume them (agents.control; the server checks the edit right). */
export const togglePaused = (shareId, controls) => Meteor.callAsync('agents.control', { shareId, paused: !controls.paused })

/**
 * One agent's details, opened from its row in the corner's agents menu (or the agent trigger): the
 * plan, Keep all and Discard all, the agent's activity with Undo, Edit directly where settings allow
 * it, and an invited agent's own controls (the agents.chip slot: ask, sign in again, remove).
 */
export function AgentDetails({ agent, anchorEl = null, onClose, shareId = null }) {
  const { controls } = useAgentSuggestions(shareId)
  const canEdit = useAtomValue(agentControlsAtom)
  const [told, setTold] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (work) => {
    setBusy(true)
    try {
      await work()
    } catch (error) {
      setTold(error?.reason || error?.message || 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const decideAll = (which, decision) => run(async () => {
    for (const action of which.actions.filter((a) => pendingCount(a) > 0)) await decide(shareId, { decision, actionId: action.actionId })
  })
  const openAgent = agent
  return (
    <>
      <Popover
        open={Boolean(openAgent && anchorEl)}
        anchorEl={anchorEl}
        onClose={onClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: -1, borderRadius: 2.5 } } }}
      >
        {openAgent && (
          <Box sx={{ p: 2, width: 340, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box' }} aria-label={openAgent.label + ' details'} data-agent-panel="">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Hexagon color={agentColor(openAgent.colorIndex)} size={22} style={{}} />
              <Typography variant="subtitle2">{openAgent.label}</Typography>
            </Box>
            {agentOrigin(openAgent) && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{agentOrigin(openAgent)}</Typography>}
            {openAgent.record && (agentChecklist(openAgent.record).length ? (
              <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }}>
                {agentChecklist(openAgent.record).map((line, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <Typography component="li" variant="body2" key={index}>{line}</Typography>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" sx={{ mt: 1 }}>{agentStepText({ ...openAgent.record, waiting: openAgent.waiting > 0 }) || 'Working on this slate'}</Typography>
            ))}
            {!canEdit && controls.paused && <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>Agents are paused on this slate.</Typography>}
            {/* Enterprise: an invited agent's own controls (ask it, sign in again, remove it). Empty where enterprise code is locked. */}
            {openAgent.invited && (
              <EnterpriseSlot name="agents.chip" agentId={openAgent.agentId} shareId={shareId} canEdit={canEdit} paused={Boolean(controls.paused)} waiting={openAgent.waiting} />
            )}
            {openAgent.waiting > 0 && (
              <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: '1 1 140px' }}>{openAgent.waiting} suggestion{openAgent.waiting === 1 ? '' : 's'} on the slate</Typography>
                {canEdit && (
                  <>
                    <Button size="small" variant="contained" disabled={busy} data-keep-all="" onClick={() => decideAll(openAgent, 'keep')}>Keep all</Button>
                    <Button size="small" disabled={busy} data-discard-all="" onClick={() => decideAll(openAgent, 'discard')}>Discard all</Button>
                  </>
                )}
              </Box>
            )}
            {openAgent.actions.length > 0 && (
              <Box sx={{ mt: 1.5 }} aria-label="Activity" data-agent-activity="">
                <Typography variant="overline" sx={{ lineHeight: 1.5 }}>Activity</Typography>
                {[...openAgent.actions].reverse().slice(0, 8).map((action) => (
                  <Box key={action.actionId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }} data-agent-action={action.actionId}>
                    <Typography variant="body2" sx={{ flex: 1 }}>{activityLine(action)}</Typography>
                    {canEdit && action.undoable && (
                      <Button size="small" disabled={busy} data-undo-action="" onClick={() => run(() => decide(shareId, { decision: 'undo', actionId: action.actionId }))}>Undo</Button>
                    )}
                  </Box>
                ))}
              </Box>
            )}
            {controls.editDirectly && openAgent.agentId && controls.modes?.[openAgent.agentId] === 'direct' && !mayDirect(controls, openAgent.agentId) && (
              <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }} data-agent-direct-by="">
                <Typography variant="body2" sx={{ flex: 1 }}>
                  Edits directly{controls.modeBy?.[openAgent.agentId] ? ` (set by ${controls.modeBy[openAgent.agentId]})` : ''}
                </Typography>
                {canEdit && (
                  <Button size="small" disabled={busy} data-agent-back-to-suggest=""
                    onClick={() => run(() => Meteor.callAsync('agents.control', { shareId, agentId: openAgent.agentId, editing: 'suggest' }))}>Back to suggestions</Button>
                )}
              </Box>
            )}
            {canEdit && controls.editDirectly && openAgent.agentId && !Meteor.user()?.isAnonymous && mayDirect(controls, openAgent.agentId) && (
              <FormControlLabel
                sx={{ mt: 1 }}
                control={(
                  <Switch size="small" checked={controls.modes?.[openAgent.agentId] === 'direct'} disabled={busy}
                    onChange={(event) => run(() => Meteor.callAsync('agents.control', { shareId, agentId: openAgent.agentId, editing: event.target.checked ? 'direct' : 'suggest' }))} />
                )}
                label={<Typography variant="body2">Edit directly (no suggestions; each change can be undone)</Typography>}
              />
            )}
          </Box>
        )}
      </Popover>
      <Snackbar open={Boolean(told)} autoHideDuration={5000} onClose={() => setTold('')} message={told} />
    </>
  )
}
AgentDetails.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  agent: PropTypes.object,
  // eslint-disable-next-line react/forbid-prop-types
  anchorEl: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  shareId: PropTypes.string,
}
