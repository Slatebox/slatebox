/**
 * Stop when asked. The k8s image runs `node main.js` as PID 1, and PID 1 ignores any signal it has no
 * handler for: without this, a rollout's SIGTERM did nothing, the old pod kept serving (the previous
 * build) for the whole 30 s grace period, and then SIGKILL cut every open DDP connection mid-session
 * ("Disconnected… retrying"), long after `kubectl rollout status` had said the new pod was in charge.
 *
 * On SIGTERM or SIGINT: stop taking new connections, give calls in flight `drainMs` to finish, then exit,
 * so browsers reconnect at once to the server that replaced this one. Answers the stop function.
 */
// What else must happen before the process exits (the voice relay hands each open session a ticket
// to carry on elsewhere and settles its meter and record: server/voice/meteor.js). Each runs once,
// at the signal; the exit waits for them (at least drainMs, at most hookMs).
const hooks = new Set()
export function onTerminate(fn) {
  hooks.add(fn)
  return () => hooks.delete(fn)
}

export function exitOnTerminate({ proc = process, server = null, drainMs = 1000, hookMs = 10_000, log = console.log } = {}) {
  let stopping = false
  const stop = signal => {
    if (stopping) return
    stopping = true
    log(`${signal}: stopping; open connections move to the next server.`)
    // the hooks still working (a hook that is done at once is not waited for)
    const running = []
    for (const hook of hooks) {
      try {
        const out = hook(signal)
        if (out && typeof out.then === 'function') running.push(Promise.resolve(out).catch(error => log(`${signal}: ${error?.message || error}`)))
      } catch (error) { log(`${signal}: ${error?.message || error}`) }
    }
    try { server?.close() } catch { /* already closed */ }
    // the drain time for open connections, and the hooks' own work (a meter released, a record
    // closed), whichever is longer, but never past hookMs (k8s ends the pod at its grace period)
    let drained = false
    let settled = !running.length
    let gone = false
    const exit = () => { if (!gone) { gone = true; proc.exit(0) } }
    if (running.length) Promise.allSettled(running).then(() => { settled = true; if (drained) exit() })
    setTimeout(() => { drained = true; if (settled) exit() }, drainMs)
    setTimeout(exit, Math.max(drainMs, hookMs))
  }
  const signals = ['SIGTERM', 'SIGINT']
  signals.forEach(signal => proc.on(signal, () => stop(signal)))
  return stop
}
