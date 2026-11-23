// How long an open canvas waits for one replayed run before drawing the next (see
// SlateOperationListener). A run is waited for as long as it keeps drawing: the next run may join
// notes this one makes, so starting it early would leave those lines out on this screen. Only a
// run that has stopped changing the canvas for a whole quiet window is let go, so a run whose
// notes never finish drawing cannot hold back every run after it.

/**
 * Resolves 'finished' when the run settles, 'failed' when it rejects, or 'stalled' when
 * progress() (any value that changes as the canvas changes) stays the same for stallMs.
 */
export function waitForRun(run, { progress, stallMs = 10000 }) {
  return new Promise((resolve) => {
    let last = progress()
    let timer = null
    const done = (outcome) => {
      clearTimeout(timer)
      resolve(outcome)
    }
    const check = () => {
      const now = progress()
      if (now === last) {
        done('stalled')
        return
      }
      last = now
      timer = setTimeout(check, stallMs)
    }
    timer = setTimeout(check, stallMs)
    Promise.resolve(run).then(
      () => done('finished'),
      () => done('failed')
    )
  })
}
