// One owner for putting the terminal back: raw mode off and the cursor shown again, whatever ends
// the run (a normal exit, Ctrl-C between questions, SIGTERM, or a crash). Process-wide handlers
// are added only for the real terminal, never for the fake ones tests pass in.

const SHOW_CURSOR = '\x1b[?25h'

/**
 * @param {{input: any, output: any, onInterrupt?: () => void}} streams
 * @returns {{restore: () => void, dispose: () => void}}
 */
export function terminalGuard({ input, output, onInterrupt }) {
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    try { if (input?.isTTY && typeof input.setRawMode === 'function') input.setRawMode(false) } catch { /* already closed */ }
    try { output?.write(SHOW_CURSOR) } catch { /* already closed */ }
  }
  const real = input === process.stdin
  const handlers = []
  if (real) {
    const on = (event, handler) => { process.on(event, handler); handlers.push([event, handler]) }
    on('exit', restore)
    // Between questions the terminal is not raw, so Ctrl-C arrives as SIGINT.
    on('SIGINT', () => { restore(); onInterrupt ? onInterrupt('SIGINT') : process.exit(130) })
    on('SIGTERM', () => { restore(); process.exit(143) })
    on('uncaughtException', error => { restore(); process.stderr.write(`${error?.stack || error}\n`); process.exit(1) })
  }
  return {
    restore,
    /** Put the terminal back and stop watching (the run is over). */
    dispose() {
      restore()
      for (const [event, handler] of handlers) process.off(event, handler)
    },
    /** A new question is open: restore again at the end. */
    arm() { restored = false },
  }
}
