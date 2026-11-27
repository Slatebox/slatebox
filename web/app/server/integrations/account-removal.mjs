// What a removed account leaves of its integrations: nothing (privacy policy: deleting your account
// deletes your integration sign-ins). Integrations are enterprise code (enterprise/server, Slatebox
// as an MCP client); the MIT core never imports it. Where it runs, it fills `forgetPerson` at start
// (enterprise/server/meteor.js through setAccountIntegrations): every integration the person
// connected is disconnected as Disconnect does, and each sign-in is revoked at its vendor first.
// Then, whether or not that ran or finished (enterprise code off, its kill switch on, a vendor
// down), every row the person owns in the integration collections is removed here.
//
// Only the person's own rows: a teammate's integrations, sign-ins and agents (on the same team, on
// the same slates) are never touched. Each collection is matched on the field that names its owner.
//
//   forgetPerson(userId) → anything (awaited, at most FORGET_LIMITS.ms; its failures are logged
//       here, without tokens, and never stop the account's removal)

export const FORGET_LIMITS = Object.freeze({ ms: 20000 })

// [collection, the field naming the person who owns its row]
export const INTEGRATION_ROWS = Object.freeze([
  Object.freeze(['integrations', 'ownerId']), // each person's connected agent servers
  Object.freeze(['mcpCredentials', 'ownerId']), // their sign-ins: sealed tokens, keys and secrets
  Object.freeze(['mcpConnections', 'ownerId']), // the agents they invited onto slates
  Object.freeze(['mcpOutsideActions', 'ownerId']), // their agents' action cards and act-without-asking changes
  Object.freeze(['mcpSignins', 'userId']), // sign-ins they started (10 minutes, used once)
  Object.freeze(['googleDocLinks', 'userId']), // Google: their last Doc per slate
  Object.freeze(['googleSlateFiles', 'userId']), // Google: the Drive files they picked for a slate
])

// Their agents' suggestions (server/agents/suggestions.mjs, ownerId: the account an agent runs
// as, so an integration's agent is its owner's): what an agent of theirs fetched (Slack messages, a
// Drive file) waits there as text for up to 7 days. An action with nothing kept or applied from it
// goes; one a teammate kept part of stays for that teammate's undo, its waiting items withdrawn.
export const SUGGESTIONS = 'agentSuggestions'
const KEPT_STATES = Object.freeze(['kept', 'applied'])

const hooks = { forgetPerson: null }

export function setAccountIntegrations(next = {}) {
  hooks.forgetPerson = typeof next.forgetPerson === 'function' ? next.forgetPerson : null
}

/**
 * Removes everything a person's integrations left, before their account goes. Revoking at the
 * vendors is best effort and bounded in time; removing the rows is not optional (a database error
 * reaches the caller, so the account is not removed with its sign-ins still kept).
 * collection(name) → { deleteMany(filter) } (Mongo's own collections)
 */
// eslint-disable-next-line no-console
export async function removeIntegrationsOf(userId, { collection, log = console.warn, ms = FORGET_LIMITS.ms } = {}) {
  if (typeof userId !== 'string' || !userId) return { removed: 0 }
  if (hooks.forgetPerson) {
    const forgetting = Promise.resolve()
      .then(() => hooks.forgetPerson(userId))
      .then(() => true, (error) => {
        log('[integrations] revoking sign-ins failed; removing them anyway:', String(error?.message || error).slice(0, 200))
        return true
      })
    let timer
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms) })
    const finished = await Promise.race([forgetting, late])
    clearTimeout(timer)
    if (!finished) log('[integrations] revoking sign-ins took too long; removing them anyway')
  }
  const results = await Promise.all(INTEGRATION_ROWS.map(([name, field]) => collection(name).deleteMany({ [field]: userId })))
  const suggestions = collection(SUGGESTIONS)
  results.push(await suggestions.deleteMany({ ownerId: userId, items: { $not: { $elemMatch: { state: { $in: KEPT_STATES } } } } }))
  await suggestions.updateMany(
    { ownerId: userId, 'items.state': 'pending' },
    { $set: { 'items.$[waiting].state': 'discarded', 'items.$[waiting].reason': 'withdrawn', 'items.$[waiting].decidedAt': new Date() } },
    { arrayFilters: [{ 'waiting.state': 'pending' }] },
  )
  const removed = results.reduce((sum, result) => sum + (result?.deletedCount || 0), 0)
  return { removed }
}
