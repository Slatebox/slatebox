// "Add a slate" in a project (/new?projectId=...): the new slate's first save carries the project,
// so it is made in the drive or folder rather than moved there afterwards. /new may pass through the
// start page, a template or the library first, so the choice waits in this tab's session storage
// until the first save of a new slate claims it, once (api/client/saveSlate.js). It lapses after 15
// minutes, so a slate started later in the day is never filed into a project by surprise.
// The server checks the person may add slates there (server/projects/place.mjs checkPlacement).
export const PENDING_PROJECT_KEY = 'sb.newSlateProject'
export const PENDING_PROJECT_TTL_MS = 15 * 60 * 1000

const read = (storage) => {
  try {
    const raw = storage?.getItem(PENDING_PROJECT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
const write = (storage, value) => {
  try {
    if (value) storage?.setItem(PENDING_PROJECT_KEY, JSON.stringify(value))
    else storage?.removeItem(PENDING_PROJECT_KEY)
  } catch {
    // Storage that throws (a private window): the slate is made in My slates, and can be moved.
  }
}

/** /new was opened with ?projectId=: remember it for the next new slate. No id forgets any earlier one. */
export function rememberProjectForNew(storage, projectId, now = Date.now()) {
  write(storage, typeof projectId === 'string' && /^[\w-]{1,64}$/.test(projectId) ? { projectId, at: now } : null)
}

/** The project a new slate's first save goes to, or null. Claimed once: later saves carry nothing. */
export function claimProjectForSave(storage, now = Date.now()) {
  const pending = read(storage)
  if (!pending) return null
  write(storage, null)
  if (typeof pending.projectId !== 'string' || !(now - Number(pending.at) <= PENDING_PROJECT_TTL_MS)) return null
  return pending.projectId
}

/** The project /new will file the slate into (the start page names it), without claiming it. */
export function peekPendingProject(storage, now = Date.now()) {
  const pending = read(storage)
  return pending && now - Number(pending.at) <= PENDING_PROJECT_TTL_MS ? pending.projectId : null
}
