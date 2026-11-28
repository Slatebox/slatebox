// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Linear as a recipe vendor:
//   session(instance)  ctx.vendor.linear: fixed GraphQL reads as the owner (session.mjs)
//   routes()           POST /integrations/linear/events: the OAuth app's webhook, one URL for every
//                      workspace that authorized the app (Linear creates it per workspace). Checked
//                      first (Linear-Signature over the raw body, a timestamp within a minute); a
//                      delivery that fails gets 401 and nothing else. Each Linear-Delivery is handled
//                      once. The answer comes at once; a matching recipe gets a debounced trigger,
//                      never a run inline. "OAuthApp revoked" signs the workspace's people out and
//                      pauses their recipes with the reconnect words. Nothing Linear sent is kept
//                      beyond ids and type names in the trigger.
//   matchInstances(e)  the RecipeInstances selector for an event: the workspace, and the team when
//                      the event names one
//   resolveMatch       a new instance's workspace: the owner's connected one
//   perform(write)     linear.update_item (one issue's workflow state) and linear.comment (one
//                      comment), only after permissions said allow or a person approved its card
//   checkHardLimits(w) never creates, deletes or archives anything; never changes a field but the
//                      state; only issues of the teams the grant names
import { createLinearRecipeSession, LinearSignInNeeded, IDENTIFIER } from './session.mjs'
import { freshDelivery, linearHeaders, verifyLinearSignature, LINEAR_VERIFY_LIMITS } from './verify.mjs'

export const LINEAR_EVENTS_PATH = '/integrations/linear/events'
const ID = /^[0-9a-f-]{8,64}$/i
const isId = (v) => typeof v === 'string' && ID.test(v)

// Linear's resource type → the recipe event it triggers.
const EVENT_OF = Object.freeze({ Project: 'linear.project', ProjectUpdate: 'linear.project', Initiative: 'linear.project', InitiativeUpdate: 'linear.project', Issue: 'linear.issue', Cycle: 'linear.cycle' })

/** A delivery as the trigger a recipe gets (ids and type names, no titles or text). → { match, trigger } | null */
export function triggerOf(body) {
  const event = EVENT_OF[body?.type]
  const organizationId = body?.organizationId
  if (!event || !isId(organizationId) || !['create', 'update', 'remove'].includes(body.action)) return null
  const data = body.data || {}
  const teamIds = [...new Set([data.teamId, ...(Array.isArray(data.teamIds) ? data.teamIds : []), data.team?.id].filter(isId))].slice(0, 20)
  const projectId = body.type === 'Project' ? data.id : body.type === 'ProjectUpdate' ? data.projectId || data.project?.id : data.projectId
  return {
    match: { vendor: 'linear', event, organizationId, teamIds },
    trigger: {
      kind: 'vendor', event, type: body.type, action: body.action, id: isId(data.id) ? data.id : null, organizationId,
      ...(teamIds.length && { teamIds }),
      ...(isId(projectId) && { projectId }),
      ...(isId(data.cycleId) && { cycleId: data.cycleId }),
      ...(typeof data.identifier === 'string' && IDENTIFIER.test(data.identifier) && { identifier: data.identifier }),
      // which fields changed (names only): a target date, a state, a cycle
      ...(body.updatedFrom && typeof body.updatedFrom === 'object' && { changed: Object.keys(body.updatedFrom).filter((k) => /^[a-zA-Z]{1,40}$/.test(k)).slice(0, 20) }),
    },
  }
}

/** The one change linear.update_item may make (an issue's state) and linear.comment's one comment. */
export function checkLinearHardLimits(write, grant = null) {
  const t = write?.target || {}
  if (!isId(t.issueId) || !isId(t.teamId)) return 'refused'
  if (write.body?.delete || write.body?.archive || write.body?.create || write.target?.delete) return 'refused'
  if (write.kind === 'linear.update_item') {
    const fields = Object.keys(write.body || {})
    if (fields.length !== 1 || fields[0] !== 'stateId' || !isId(write.body.stateId)) return 'refused'
    if (grant && !(grant.scope?.fields || ['state']).includes('state')) return 'refused'
  } else if (write.kind === 'linear.comment') {
    if (typeof write.body?.text !== 'string' || !write.body.text.trim() || write.body.text.length > 2000 || Object.keys(write.body).length !== 1) return 'refused'
  } else return 'refused'
  if (grant && Array.isArray(grant.scope?.teams) && !grant.scope.teams.includes(t.teamId)) return 'refused'
  return null
}

/**
 * deps:
 *   accountOf(userId) → the owner's Linear account row ({ status, organizationId }) or null
 *   tokenFor(userId, { force }) → their Linear token (vault.tokenFor(userId, LINEAR_ADDRESS, { force }))
 *   fetch          Linear's hosts only
 *   signingSecret() → the OAuth app's webhook signing secret
 *   clientId()     → the OAuth app's client id (an "app revoked" for another app is ignored)
 *   deliveries     { claim(id, expiresAt) → bool } (each Linear-Delivery once)
 *   revokedFor(organizationId) (the Linear service: its people sign in again)
 *   endpoint, log, now, later
 */
export function createVendor({ accountOf, tokenFor, fetch, signingSecret = async () => null, clientId = async () => null, deliveries, revokedFor = async () => 0, endpoint, log = () => {}, now = Date.now, later = (fn) => setImmediate(fn) }) {
  async function signedIn(instance) {
    const row = await accountOf(instance.ownerId)
    if (!row || row.status !== 'active') throw new LinearSignInNeeded()
    if (instance.match?.linear?.organizationId && row.organizationId !== instance.match.linear.organizationId) throw new LinearSignInNeeded()
    return row
  }
  const after = (what, fn) => later(() => Promise.resolve().then(fn).catch((error) => log({ kind: 'linear_failed', what, code: error?.code ?? null })))

  async function events(req, res, hooks) {
    const raw = hooks?.rawBody || req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null)
    if (!raw || raw.length > LINEAR_VERIFY_LIMITS.maxBytes) return res.status(raw ? 413 : 400).end()
    const secret = await Promise.resolve(signingSecret()).catch(() => null)
    const { delivery, signature } = linearHeaders(req)
    if (!verifyLinearSignature({ secret, signature, raw })) {
      log({ kind: 'linear_unsigned' })
      return res.status(401).end()
    }
    let body
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      return res.status(400).end()
    }
    if (!freshDelivery(body, now())) {
      log({ kind: 'linear_stale' })
      return res.status(401).end()
    }
    if (typeof delivery !== 'string' || !/^[\w-]{1,80}$/.test(delivery)) return res.status(400).end()
    const first = await deliveries.claim(delivery, new Date(now() + 3600 * 1000)).catch(() => false)
    res.status(200).end()
    if (!first) return undefined
    log({ kind: 'linear_event', type: String(body.type || '').slice(0, 40), action: String(body.action || '').slice(0, 20) })
    // The workspace took Slatebox's access away: its people sign in again; their recipes pause.
    if (body.type === 'OAuthApp' && body.action === 'revoked' && isId(body.organizationId)) {
      const mine = await Promise.resolve(clientId()).catch(() => null)
      if (body.oauthClientId && mine && body.oauthClientId !== mine) return undefined
      return after('revoked', async () => {
        await revokedFor(body.organizationId)
        await hooks.pause?.({ vendor: 'linear', organizationId: body.organizationId }, 'needs_sign_in')
      })
    }
    const got = triggerOf(body)
    if (got) after(got.trigger.event, () => hooks.trigger(got.match, got.trigger))
    return undefined
  }

  return {
    name: 'linear',

    async session(instance, { signal = null, budget = null } = {}) {
      await signedIn(instance)
      return createLinearRecipeSession({ userId: instance.ownerId, tokenFor, fetch, endpoint, budget, signal })
    },

    routes: () => [{ method: 'POST', path: LINEAR_EVENTS_PATH, raw: true, handler: events }],

    matchInstances(event) {
      return {
        'match.linear.organizationId': event.organizationId,
        // an event naming teams reaches recipes that read one of them (or every team: an empty list)
        ...(event.teamIds?.length && { $or: [{ 'match.linear.teams': { $in: event.teamIds } }, { 'match.linear.teams': { $size: 0 } }] }),
      }
    },

    /** The workspace a new Linear recipe reads: the owner's connected one (setup never types it). */
    async resolveMatch(match, ownerId) {
      if (match?.linear?.organizationId) return match
      const row = await accountOf(ownerId)
      if (!row || row.status !== 'active') throw Object.assign(new Error('Connect Linear first.'), { status: 409, code: 'linear_not_connected' })
      return { ...match, linear: { ...match.linear, organizationId: row.organizationId } }
    },

    /** The teams the owner sees in Linear, for the setup picker: [{ value, label }]. */
    async teamsFor(ownerId) {
      const row = await accountOf(ownerId)
      if (!row || row.status !== 'active') return []
      const session = createLinearRecipeSession({ userId: ownerId, tokenFor, fetch, endpoint })
      return (await session.teams()).map((t) => ({ value: t.id, label: `${t.name} (${t.key})` }))
    },

    checkHardLimits: (write, grant = null) => checkLinearHardLimits(write, grant),

    async perform(write, { instance, grant = null, signal = null } = {}) {
      if (checkLinearHardLimits(write, grant)) return { refused: 'hard_limit' }
      // only a team the person picked for this recipe, whatever a permission's scope names
      const teams = instance?.match?.linear?.teams || []
      if (teams.length && !teams.includes(write.target.teamId)) return { refused: 'team_not_picked' }
      await signedIn(instance)
      const session = createLinearRecipeSession({ userId: instance.ownerId, tokenFor, fetch, endpoint, signal, writable: true })
      if (write.kind === 'linear.update_item') return session.updateIssueState(write.target.issueId, write.body.stateId)
      return session.createComment(write.target.issueId, write.body.text)
    },
  }
}
