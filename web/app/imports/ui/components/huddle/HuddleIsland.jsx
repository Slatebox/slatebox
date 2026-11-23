import React, { useEffect, useState } from 'react'
import DailyIframe from '@daily-co/daily-js'
import { DailyProvider } from '@daily-co/daily-react'
import { useStore } from 'jotai'
import CollaborationHuddle from './CollaborationHuddle'
import AIAudioListener from '../ai/AIAudioListener'
import { setDailyCall } from './daily-call.mjs'

// Daily, loaded with the first huddle this page starts or joins (CollaborationUsers imports this lazily):
// the page's one call object, its provider, the slate's people in the call, and the AI listening to the call
// when the slate has an AI conversation. It stays mounted after the huddle ends.
export default function HuddleIsland({ localCollaborator, slate, aiListening = false }) {
  // Daily keeps its state in the page's jotai store, the one the huddle's own atoms (huddleEnabled, the
  // people on the slate) live in: without it, DailyProvider makes a store of its own and the huddle under it
  // would read fresh atoms.
  const store = useStore()
  const [callObject] = useState(() => DailyIframe.getCallInstance() ?? DailyIframe.createCallObject())
  useEffect(() => {
    setDailyCall(callObject)
    return () => setDailyCall(null)
  }, [callObject])
  return (
    <DailyProvider callObject={callObject} jotaiStore={store}>
      <CollaborationHuddle localCollaborator={localCollaborator} slate={slate} />
      {aiListening && <AIAudioListener />}
    </DailyProvider>
  )
}
