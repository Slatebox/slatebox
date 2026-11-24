// The runs a page caused itself: its person's Keep in Ask Slatebox, an import into this slate. The
// server saves them and every open canvas draws them (SlateOperationListener); on the page that
// caused them they are its person's own step, which they can undo, and on every other page they are
// someone else's change, which no undo there takes away.
const pages = new WeakMap()

function of(slate) {
  let own = pages.get(slate)
  if (!own) pages.set(slate, (own = { pending: new Set(), revisions: new Set() }))
  return own
}

/**
 * `answer` is the server's answer to a request that saves runs on this slate; `revisionsOf` reads the
 * revisions those runs were stored at from it (a number, a list, or nothing). Until it answers, runs
 * reaching the page wait to be told whose they are.
 */
export function expectOwnRuns(slate, answer, revisionsOf = (value) => value) {
  if (!slate || !answer || typeof answer.then !== 'function') return answer
  const own = of(slate)
  const settled = Promise.resolve(answer).then((value) => {
    const found = revisionsOf(value)
    for (const revision of [].concat(found ?? [])) if (Number.isInteger(revision)) own.revisions.add(revision)
  }, () => {})
  own.pending.add(settled)
  settled.finally(() => own.pending.delete(settled))
  return answer
}

/** Whether `run` was saved by a request of this page's own (waits for any still unanswered). */
export async function isOwnRun(slate, run) {
  if (!slate || !run) return false
  const own = pages.get(slate)
  if (!own) return false
  while (own.pending.size) await Promise.all([...own.pending])
  return Number.isInteger(run.revision) && own.revisions.has(run.revision)
}
