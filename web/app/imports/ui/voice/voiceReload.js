// A Keep that reloads the page while voice is on (a drawing saved with the slate, a workshop's
// notes): the reload waits until the agent has said what was kept, and the session is handed a
// ticket to carry on after it (useVoiceSession: pause, then sessionStorage for this tab, about a
// minute). After the reload the mic carries on the same conversation: the agent does not greet
// again. With no voice on, the page reloads at once, as it always did.
let live = null

/** useVoiceSession registers its live session: { pauseForReload() → Promise }. → unregister */
export function registerVoice(session) {
  live = session
  return () => { if (live === session) live = null }
}

/** Reload the page, letting a live voice session finish its sentence and hand itself over first. */
export function reloadPage() {
  const session = live
  if (!session) {
    window.location.reload()
    return
  }
  Promise.resolve(session.pauseForReload()).catch(() => {}).finally(() => window.location.reload())
}
