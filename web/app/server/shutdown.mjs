/**
 * Stop when asked. The k8s image runs `node main.js` as PID 1, and PID 1 ignores any signal it has no
 * handler for: without this, a rollout's SIGTERM did nothing, the old pod kept serving (the previous
 * build) for the whole 30 s grace period, and then SIGKILL cut every open DDP connection mid-session
 * ("Disconnected… retrying"), long after `kubectl rollout status` had said the new pod was in charge.
 *
 * On SIGTERM or SIGINT: stop taking new connections, give calls in flight `drainMs` to finish, then exit,
 * so browsers reconnect at once to the server that replaced this one. Answers the stop function.
 */
export function exitOnTerminate({ proc = process, server = null, drainMs = 1000, log = console.log } = {}) {
  let stopping = false
  const stop = signal => {
    if (stopping) return
    stopping = true
    log(`${signal}: stopping; open connections move to the next server.`)
    try { server?.close() } catch { /* already closed */ }
    setTimeout(() => proc.exit(0), drainMs)
  }
  const signals = ['SIGTERM', 'SIGINT']
  signals.forEach(signal => proc.on(signal, () => stop(signal)))
  return stop
}
