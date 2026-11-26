// Whether a conversation offers voice on a part (voice.chat, voice.interview): a signed-in person
// with an account (guests have no voice), the part on (ai.surfaces.status: an administrator's
// switch), and something to talk with (voice.status: the server's binding or the person's own voice
// connection). A refusal the pay sheet answers still offers it: pressing the mic says why at once
// (the status goes to VoiceControl), before any microphone prompt. Asked again when the person's AI
// settings are saved on this page, and when the tab comes back into view (saved in another tab).
// Small, so the message box can ask on every slate; the session itself loads only when the mic is pressed.
import { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import CONSTANTS from '../../api/common/constants'
import { useAISurface } from '../../api/client/aiSurfacesStatus'
import { AI_SETTINGS_EVENT } from '../../api/common/voice-client.mjs'

/** → { available, status } (status: voice.status's answer, or null) */
export default function useVoiceAvailable(surface) {
  const who = useTracker(() => {
    const user = Meteor.user()
    return { id: Meteor.userId(), member: user?.isAnonymous === false }
  }, [])
  const part = useAISurface(surface || 'voice')
  const [status, setStatus] = useState(null)
  const [asked, setAsked] = useState(0)
  const asks = Boolean(surface && who.id && who.member && part.enabled)
  useEffect(() => {
    if (!asks) return undefined
    const again = () => setAsked((n) => n + 1)
    const shown = () => { if (document.visibilityState === 'visible') again() }
    window.addEventListener(AI_SETTINGS_EVENT, again)
    document.addEventListener('visibilitychange', shown)
    return () => {
      window.removeEventListener(AI_SETTINGS_EVENT, again)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [asks])
  useEffect(() => {
    if (!asks) { setStatus(null); return undefined }
    let gone = false
    Meteor.callAsync(CONSTANTS.methods.voice.status, { surface })
      .then((out) => { if (!gone) setStatus(out) })
      .catch(() => { if (!gone) setStatus(null) })
    return () => { gone = true }
  }, [asks, surface, who.id, asked])
  return { available: asks && status?.available === true, status: asks ? status : null }
}
