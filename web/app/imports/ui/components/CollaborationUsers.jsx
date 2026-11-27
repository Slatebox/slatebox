import React, { Suspense, lazy, useState } from 'react'
import { useAtomValue } from 'jotai'
import { huddleEnabled } from '../jotai/atoms'

// Daily (calls, about 340 KB) loads the first time this person starts or joins a huddle, never with the page.
const HuddleIsland = lazy(() => import('./huddle/HuddleIsland'))

/**
 * The slate's huddle. Who is on the slate (people and agents) is the corner's presence pill
 * (presence/CornerPresence.jsx), which needs no Daily. Until this person first turns the huddle on this
 * draws nothing; from then on the huddle (HuddleIsland) holds the call, with its tiles while it is on.
 */
export default function CollaborationUsers({ localCollaborator, slate, aiListening = false }) {
  const on = useAtomValue(huddleEnabled)
  const [wanted, setWanted] = useState(false)
  if (on && !wanted) setWanted(true)
  if (!wanted) return null
  return (
    <Suspense fallback={null}>
      <HuddleIsland localCollaborator={localCollaborator} slate={slate} aiListening={aiListening} />
    </Suspense>
  )
}
