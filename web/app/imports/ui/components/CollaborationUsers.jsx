import React, { Suspense, lazy, useState } from 'react'
import { useAtomValue } from 'jotai'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Grid from '@mui/material/Grid2'
import Chip from '@mui/material/Chip'
import { HuddleCalls } from '../../api/common/models'
import { Avatar } from './AccountMenu'
import { slateHuddleType, huddleEnabled, collaborationUsers } from '../jotai/atoms'
import { AgentChips, rosterExtrasAtom, useAgentPresence, useAgentSuggestions } from './AgentPresenceListener'
import { agentsOnRoster } from '../../api/common/agent-roster.mjs'

// Daily (calls, about 340 KB) loads the first time this person starts or joins a huddle, never with the page.
const HuddleIsland = lazy(() => import('./huddle/HuddleIsland'))

/**
 * Who is on the slate: one chip per person (you once, then each other person) and the agents saving to it,
 * at the foot of the canvas. Until this person first turns the huddle on, that is all it is, with no Daily;
 * from then on the huddle (HuddleIsland) draws it, with the call's participants while the call is on.
 */
export default function CollaborationUsers({ localCollaborator, slate, aiListening = false }) {
  const on = useAtomValue(huddleEnabled)
  const [wanted, setWanted] = useState(false)
  if (on && !wanted) setWanted(true)
  const presence = <Presence localCollaborator={localCollaborator} slate={slate} />
  if (!wanted) return presence
  return (
    <Suspense fallback={presence}>
      <HuddleIsland localCollaborator={localCollaborator} slate={slate} aiListening={aiListening} />
    </Suspense>
  )
}

/** The people on the slate, as the huddle draws them while no call is on (CollaborationHuddle). */
function Presence({ localCollaborator, slate }) {
  const slateHuddle = useAtomValue(slateHuddleType)
  const call = useTracker(() => {
    if (!slate?.shareId) return null
    Meteor.subscribe('meter.calls', slate.shareId)
    return HuddleCalls.findOne({ shareId: slate.shareId, state: 'open' })
  }, [slate?.shareId])
  const huddleType = call ? (call.mode === 'video' ? 'video' : 'audio') : slateHuddle
  const currentCollaborators = useAtomValue(collaborationUsers)
  const agents = useAgentPresence(slate?.shareId).shown
  // An agent with suggestions waiting (or a recent action to undo) is on the roster too.
  const { actions } = useAgentSuggestions(slate?.shareId)
  const extras = useAtomValue(rosterExtrasAtom)
  const onRoster = agentsOnRoster(agents, actions, Date.now(), extras).length
  if (!(currentCollaborators.length > 0 || onRoster > 0)) return null
  return (
    <Grid container spacing={1} component="section" aria-label="Huddle"
      sx={{
        position: 'fixed', left: 0, right: 'var(--sb-canvas-right, 0px)', bottom: 'var(--sb-canvas-bottom, 0px)', width: 'auto',
        boxSizing: 'border-box', paddingLeft: '10px', marginBottom: huddleType === 'video' ? '100px' : '68px',
        height: '68px', borderTop: '1px solid black', paddingTop: '5px', backgroundColor: 'rgba(255, 255, 255, 0.1)',
        // Over the canvas, only the people take the pointer: the strip's empty room leaves the notes under it
        // to be held and dragged (as CollaborationHuddle draws it).
        pointerEvents: 'none', '& > *': { pointerEvents: 'auto' },
      }}>
      {[{ key: 'you', userName: 'You', color: localCollaborator?.color }, ...currentCollaborators].map((person) => (
        <Chip key={person.key} label={person.userName}
          avatar={<Avatar name={person.key === 'you' ? 'You' : person.userName} colour={person.color} size={24} />} />
      ))}
      <AgentChips records={agents} shareId={slate?.shareId} />
    </Grid>
  )
}
