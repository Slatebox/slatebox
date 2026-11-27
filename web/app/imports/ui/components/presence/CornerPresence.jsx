// The canvas's bottom-left corner, beside Undo and Redo and on the zoom control's baseline: one calm
// pill with who's on the slate. People are round avatars (you first), agents are hexagons; the agent
// group opens the agents menu (each agent's details, Agent tasks, + Invite agent, Pause all agents)
// and carries a badge when tasks wait. It replaces the full-width strip with its dark border, the
// floating "+ Invite agent", the dashed agent chips with their loose Pause button and the separate
// Agent tasks pill. What it shows in each state is cornerModel's (corner-model.mjs).
//
// On a phone viewing the slate there are no controls: the pill is one button that lists everyone here,
// agents and who added them included, and it steps aside while Ask Slatebox's sheet is open.
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Snackbar from '@mui/material/Snackbar'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { agentOrigin } from 'slateboxjs'
import { collaborationUsers, huddleSpeaking } from '../../jotai/atoms'
import { AgentDetails, inviteAvailableAtom, inviteRequestAtom, openAgentAtom, togglePaused, useRosterAgents } from '../AgentPresenceListener'
import AgentTasksPanel, { agentTasksOpenAtom, useAgentTasks } from '../AgentTasksPanel'
import { agentChanges, cornerModel } from '../../../api/common/corner-model.mjs'
import { pillColors, triggerSx } from './marks'
import PeopleStack from './PeopleStack'
import AgentStack, { AgentMarks } from './AgentStack'
import AgentsMenu from './AgentsMenu'
import PeopleList from './PeopleList'

// The widest the full pill gets (4 avatars + N, 3 hexagons + N, Paused, the caret and the badge), in px.
const FULL_PILL = 310

/**
 * Whether the room from the end of Undo and Redo to the zoom control is short of the full pill. It
 * follows the window, Ask Slatebox opening or closing (the canvas page writes --sb-canvas-right on the
 * root's style) and Undo and Redo moving (--sb-undo-redo-end).
 */
function useShortRoom(off) {
  const [short, setShort] = useState(false)
  useLayoutEffect(() => {
    if (off || typeof document === 'undefined') return undefined
    const root = document.documentElement
    const measure = () => {
      const css = getComputedStyle(root)
      const start = (parseFloat(css.getPropertyValue('--sb-undo-redo-end')) || 8) + 8
      const zoom = document.querySelector('.slatebox-zoom-slider')
      const box = zoom?.getBoundingClientRect()
      const end = box && box.width ? box.left : window.innerWidth - (parseFloat(css.getPropertyValue('--sb-canvas-right')) || 0) - 260
      setShort(end - start - 12 < FULL_PILL)
    }
    measure()
    const watch = new MutationObserver(measure)
    watch.observe(root, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', measure)
    // The zoom control is drawn by the engine after the board loads.
    const later = setTimeout(measure, 1500)
    return () => { watch.disconnect(); window.removeEventListener('resize', measure); clearTimeout(later) }
  }, [off])
  return short
}

export default function CornerPresence({ slate, localCollaborator = null, canEdit = false, phoneView = false, chatOpen = false, embed = false }) {
  const shareId = slate?.shareId
  const theme = useTheme()
  const colors = pillColors(theme)
  const narrow = useMediaQuery('(max-width:599.95px)')
  const presenceOnly = Boolean(phoneView || embed)
  const signedIn = useTracker(() => Boolean(Meteor.userId() && !Meteor.user()?.isAnonymous), [])
  const others = useAtomValue(collaborationUsers)
  const speaking = useAtomValue(huddleSpeaking)
  const { agents: roster, controls } = useRosterAgents(shareId)
  const canTasks = Boolean(canEdit && signedIn && !presenceOnly)
  const { tasks, waiting, active } = useAgentTasks(shareId, canTasks)
  const canInvite = useAtomValue(inviteAvailableAtom)
  const setInvite = useSetAtom(inviteRequestAtom)
  const [tasksOpen, setTasksOpen] = useAtom(agentTasksOpenAtom)
  const [wantOpen, setWantOpen] = useAtom(openAgentAtom)

  const people = useMemo(() => [
    { key: 'you', name: 'You', color: localCollaborator?.color, you: true, speaking: Boolean(speaking?.you) },
    ...others.map((person) => ({ key: person.key, name: person.userName, color: person.color, speaking: Boolean(speaking?.name && speaking.name === person.userName) })),
  ], [others, localCollaborator?.color, speaking])
  const agents = useMemo(() => roster.map((agent) => ({ ...agent, name: agent.label || 'Agent', byline: agentOrigin(agent) })), [roster])
  const compact = useShortRoom(presenceOnly)
  const model = cornerModel({
    people, agents, tasks: { open: active, needYou: waiting }, paused: Boolean(controls.paused),
    canEdit, canTasks, canInvite, presenceOnly, compact,
  })

  const [pill, setPill] = useState(null)
  const trigger = useRef(null)
  const peopleButton = useRef(null)
  const menuId = useId()
  const [menuOpen, setMenuOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [details, setDetails] = useState(null) // the agent's key
  const [busy, setBusy] = useState(false)
  const [told, setTold] = useState('')

  // Asked to open one agent's details (just invited, or from Ask Slatebox): once it is on the roster,
  // open them at the agent trigger (the menu closes first, so its row is no anchor to keep).
  useEffect(() => {
    if (!wantOpen) return
    const agent = agents.find((a) => a.agentId === wantOpen)
    if (!agent || !trigger.current) return
    setMenuOpen(false)
    setDetails(agent.key)
    setWantOpen(null)
  }, [wantOpen, agents, setWantOpen])

  // A polite word when an agent joins or leaves (never on the first load).
  const [said, setSaid] = useState('')
  const seen = useRef(null)
  const roll = JSON.stringify(agents.map((a) => [a.key, a.name]))
  useEffect(() => {
    const now = agents.map((a) => ({ key: a.key, name: a.name }))
    if (seen.current) {
      const words = agentChanges(seen.current, now)
      if (words) setSaid(words)
    }
    seen.current = now
  }, [roll])

  const openAgent = details && agents.find((agent) => agent.key === details)
  if (!shareId) return null
  const hiddenNow = model.hidden || (narrow && chatOpen)
  const pause = async () => {
    setBusy(true)
    try {
      await togglePaused(shareId, controls)
    } catch (error) {
      setTold(error?.reason || error?.message || 'That did not work. Try again.')
    } finally {
      setBusy(false)
      setMenuOpen(false)
    }
  }
  // Beside Undo and Redo (UndoRedoControls keeps where it ends in --sb-undo-redo-end), on the zoom
  // control's baseline at the foot of the canvas (--sb-canvas-bottom, kept by the canvas page).
  const place = narrow
    ? { left: 'calc(var(--sb-undo-redo-end, 4px) + 8px)', bottom: 'calc(var(--sb-canvas-bottom, 0px) + var(--slatebox-zoom-offset, 0px) + 12px)' }
    : { left: 'calc(var(--sb-undo-redo-end, 8px) + 8px)', bottom: 'calc(var(--sb-canvas-bottom, 0px) + 21px)' }
  const divider = <Box component="span" aria-hidden="true" sx={{ width: '1px', height: 20, bgcolor: colors.border, mx: 0.5, flex: 'none' }} />
  return (
    <>
      <Box ref={setPill} role="group" aria-label="On this slate" data-corner-presence="" data-presence-only={presenceOnly ? '' : undefined}
        sx={{
          position: 'fixed', zIndex: 1200, ...place, display: hiddenNow ? 'none' : 'inline-flex', alignItems: 'center',
          boxSizing: 'border-box', height: 38, px: '4px', borderRadius: '19px', maxWidth: 'calc(100vw - var(--sb-undo-redo-end, 8px) - 24px)',
          bgcolor: colors.surface, color: colors.ink, border: `1px solid ${colors.border}`, boxShadow: colors.shadow,
        }}>
        {presenceOnly ? (
          <ButtonBase aria-haspopup="dialog" aria-expanded={listOpen ? 'true' : 'false'} aria-label={model.list + '. ' + model.people.label}
            data-people-open="" ref={peopleButton} onClick={() => setListOpen(true)} sx={triggerSx(colors)}>
            <PeopleStack people={model.people} colors={colors} />
            {model.agents.count > 0 && <>{divider}<AgentMarks agents={model.agents} colors={colors} /></>}
          </ButtonBase>
        ) : (
          <>
            <ButtonBase aria-haspopup="dialog" aria-expanded={listOpen ? 'true' : 'false'} aria-label={model.people.label}
              data-people-open="" ref={peopleButton} onClick={() => setListOpen(true)} sx={triggerSx(colors)}>
              <PeopleStack people={model.people} colors={colors} />
            </ButtonBase>
            {model.agents.show && (
              <>
                {divider}
                <AgentStack ref={trigger} agents={model.agents} canInvite={model.menu.invite} compact={model.compact} colors={colors} open={menuOpen} menuId={menuId} onOpen={() => setMenuOpen(true)} />
              </>
            )}
          </>
        )}
        <Box component="span" role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{said}</Box>
      </Box>
      <PeopleList anchorEl={peopleButton.current} open={listOpen && !hiddenNow} onClose={() => setListOpen(false)} people={people}
        rows={presenceOnly ? model.rows : []} agents={agents} paused={model.agents.paused} colors={colors} />
      {!presenceOnly && (
        <AgentsMenu id={menuId} anchorEl={trigger.current} open={menuOpen && model.agents.show && !hiddenNow} onClose={() => setMenuOpen(false)}
          model={model} agents={agents} colors={colors} busy={busy}
          onAgent={(key) => { setMenuOpen(false); setDetails(key) }}
          onTasks={() => { setMenuOpen(false); setTasksOpen(true) }}
          onInvite={() => { setMenuOpen(false); setInvite(trigger.current) }}
          onPause={pause} />
      )}
      <AgentDetails agent={openAgent || null} anchorEl={openAgent && !hiddenNow ? trigger.current || pill : null} shareId={shareId} onClose={() => setDetails(null)} />
      {canTasks && <AgentTasksPanel shareId={shareId} canEdit={canTasks} tasks={tasks} anchorEl={tasksOpen && !hiddenNow ? pill : null} />}
      <Snackbar open={Boolean(told)} autoHideDuration={5000} onClose={() => setTold('')} message={told} />
    </>
  )
}

CornerPresence.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  slate: PropTypes.object,
  // eslint-disable-next-line react/forbid-prop-types
  localCollaborator: PropTypes.object,
  canEdit: PropTypes.bool,
  phoneView: PropTypes.bool,
  chatOpen: PropTypes.bool,
  embed: PropTypes.bool,
}
