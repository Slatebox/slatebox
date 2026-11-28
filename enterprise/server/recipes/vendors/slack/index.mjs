// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Slack as a recipe vendor (design F.1, the vendor plug-in): a run's session as the owner, which
// recipes match a Slack event, and the one outside change a Slack recipe may make (slack.post: a
// message in a channel the owner granted, never another). Slack's events arrive on the Slack route
// that already exists (enterprise/server/slack/routes.mjs, signature-checked there), so routes() adds
// none; ingest() is what that route hands recipe events to.
import { createSlackCall, SlackRecipeError } from './api.mjs'
import { createSlackIngest } from './ingest.mjs'
import { createSlackRecipeSession, RecipeSignInNeeded } from './session.mjs'

export const SLACK_POST_CHARS = 3000
const CHANNEL = /^[CG][A-Z0-9]{6,24}$/

/** The hard limit no grant lifts: a post only in a channel the grant names, never empty, never too long. */
export function checkSlackHardLimits(write, grant = null) {
  if (write?.kind !== 'slack.post') return 'refused'
  const channel = write.target?.channel
  if (!CHANNEL.test(channel || '')) return 'refused'
  if (grant && !(grant.scope?.channels || []).includes(channel)) return 'refused'
  const text = write.body?.text
  if (typeof text !== 'string' || !text.trim() || text.length > SLACK_POST_CHARS) return 'refused'
  return null
}

/**
 * deps:
 *   integrationOf(userId) → the owner's Slack integration row ({ status, slackTeamId, slackUserId, account })
 *   tokenFor(userId)      → the owner's Slack user token (vault.tokenFor(userId, SLACK_ADDRESS))
 *   fetch, config()       → slackOnlyFetch and slackSettings (enterprise/server/slack/slack.mjs)
 *   gates                 → slackReadGates (claim/get/hold), shared with the Slack agent
 *   stores                → stores.mjs (inbox, ledger, folds)
 *   instances             → { matching(teamId, channel) → [instanceId] }
 *   trigger(instanceId, trigger), log, now
 */
export function createVendor({ integrationOf, tokenFor, fetch, config, gates, stores, instances, trigger = async () => {}, log = () => {}, now = Date.now, call = null }) {
  const slackCall = call || ((...args) => createSlackCall({ fetch, apiBase: config().apiBase })(...args))
  const ingest = createSlackIngest({ stores, instances, trigger, log, now })

  async function signedIn(instance) {
    const row = await integrationOf(instance.ownerId)
    if (!row || row.status === 'needs_sign_in') throw new RecipeSignInNeeded('Connect Slack on the Integrations page, then resume this recipe.')
    const teamId = row.slackTeamId || row.account?.teamId
    const want = instance.match?.slack?.teamId
    if (want && teamId !== want) throw new RecipeSignInNeeded('This recipe reads another Slack workspace than the one connected. Connect that workspace again.')
    let token
    try {
      token = await tokenFor(instance.ownerId)
    } catch (error) {
      throw new RecipeSignInNeeded()
    }
    if (!token) throw new RecipeSignInNeeded()
    return { row, teamId, token }
  }

  return {
    name: 'slack',

    async session(instance, { signal = null, budget = null } = {}) {
      const { row, teamId, token } = await signedIn(instance)
      const cfg = config()
      return createSlackRecipeSession({ token, teamId, slackUserId: row.slackUserId || null, account: row.account || {}, instanceId: instance._id, call: slackCall, gates, listed: cfg.listed, historyLimit: cfg.historyLimit, historyPerMinute: cfg.historyPerMinute, stores, budget, signal, now })
    },

    routes: () => [],

    /** The workspace a new Slack recipe reads: the owner's connected one (setup never types it). */
    async resolveMatch(match, ownerId) {
      if (match?.slack?.teamId) return match
      const row = await integrationOf(ownerId)
      const teamId = row?.slackTeamId || row?.account?.teamId || null
      if (!teamId) throw Object.assign(new Error('Connect Slack on the Integrations page first.'), { status: 409, code: 'slack_not_connected' })
      return { ...match, slack: { ...match.slack, teamId } }
    },

    /** The channels the owner is in, for the setup picker: [{ value, label }]. */
    async channelsFor(ownerId) {
      const { row, teamId, token } = await signedIn({ ownerId, match: {} })
      const cfg = config()
      const session = createSlackRecipeSession({ token, teamId, slackUserId: row.slackUserId || null, account: row.account || {}, instanceId: 'picker', call: slackCall, gates, listed: cfg.listed, historyLimit: cfg.historyLimit, historyPerMinute: cfg.historyPerMinute, stores, budget: null, signal: null, now })
      return (await session.channels()).map((c) => ({ value: c.id, label: `${c.private ? '' : '#'}${c.name}` }))
    },

    /** The Slack events route's recipe hand-off (message, reaction_added, reaction_removed). */
    ingest,

    /** Recipes a Slack event is for: active ones that watch its workspace and channel. */
    matchInstances(event) {
      return { state: 'active', 'match.slack.teamId': event.teamId, 'match.slack.channels': event.channel }
    },

    checkHardLimits: (write, grant) => checkSlackHardLimits(write, grant),

    /** A post the owner allowed (a standing grant, or an approved card), as the owner, once per key. */
    async perform(write, { instance, grant = null, signal = null } = {}) {
      if (checkSlackHardLimits(write, grant)) throw Object.assign(new Error('refused by a hard limit'), { code: 'refused' })
      const { token } = await signedIn(instance)
      // The slate to link (body.slateRef { role, key }) is the runtime's to resolve once the slate exists: body.slateUrl.
      const slateUrl = typeof write.body.slateUrl === 'string' && /^https:\/\//.test(write.body.slateUrl) ? write.body.slateUrl : null
      const text = slateUrl ? `${write.body.text}\n${slateUrl}` : write.body.text
      const posted = await slackCall(token, 'chat.postMessage', { channel: write.target.channel, text, unfurl_links: true, ...(write.body.thread_ts && { thread_ts: write.body.thread_ts }) }, { signal })
      const link = await slackCall(token, 'chat.getPermalink', { channel: write.target.channel, message_ts: posted.ts }, { signal }).catch(() => null)
      return { ref: typeof link?.permalink === 'string' && link.permalink.startsWith('https://') ? link.permalink : posted.ts }
    },

    /** Deleting an instance: its share of the inbox and the ledger goes (rows no other instance reads are deleted). */
    async forget(instanceId) {
      await stores.inbox.dropInstance(instanceId)
      await stores.ledger.dropInstance(instanceId)
    },
  }
}

export { SlackRecipeError }
