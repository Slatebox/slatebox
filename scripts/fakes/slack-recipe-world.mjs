// A Slack workspace for the Slack recipes' tests (MIT, test support): the Slack vendor
// (enterprise/server/recipes/vendors/slack) over a fake Web API and memory stores, the Events API
// intake, and a helper that runs a recipe the way the runtime will (session, context, run).
import { createVendor } from '../../enterprise/server/recipes/vendors/slack/index.mjs'
import { memorySlackStores } from '../../enterprise/server/recipes/vendors/slack/stores.mjs'
import { ACCOUNT, CHANNEL, MESSAGES, OTHER_CHANNEL, searchMatches, TEAM, USERS } from '../../enterprise/recipes/_slack-ledger/fixtures/checkout.mjs'
import { countingBudget, fakeSlackApi, memoryGates, recipeContext } from './recipe-lite-context.mjs'

export const OWNER = 'owner1'
export const TOKEN = 'xoxp-test-token-not-real'

export function slackWorld({ messages = MESSAGES, listed = false, search = null } = {}) {
  const api = {
    token: TOKEN,
    me: 'U0ANA',
    channels: [{ id: CHANNEL.id, name: CHANNEL.name, members: ['U0ANA', 'U0DANA', 'U0RAJ', 'U0LEE', 'U0SAM'] }, { id: OTHER_CHANNEL.id, name: OTHER_CHANNEL.name, members: ['U0RAJ'] }],
    users: USERS,
    search: search || ((query, page) => (page === 1 && query.includes(`in:#${CHANNEL.name}`) ? { matches: searchMatches(messages), pages: 1 } : { matches: [], pages: 1 })),
    replies: {},
  }
  const fake = fakeSlackApi(api)
  const stores = memorySlackStores()
  const gates = memoryGates()
  const instances = new Map()
  const triggers = []
  const clock = { at: Date.parse('2026-11-27T18:00:00Z'), now() { return this.at } }
  const integration = { status: 'active', slackTeamId: TEAM, slackUserId: 'U0ANA', account: ACCOUNT }
  const vendor = createVendor({
    integrationOf: async (userId) => (userId === OWNER ? integration : null),
    tokenFor: async (userId) => (userId === OWNER ? TOKEN : null),
    config: () => ({ apiBase: 'https://slack.com', listed, historyLimit: 15, historyPerMinute: 1 }),
    call: fake.call,
    gates,
    stores,
    instances: { matching: async (teamId, channel) => [...instances.values()].filter((i) => i.state === 'active' && i.match.slack.teamId === teamId && i.match.slack.channels.includes(channel)).map((i) => i._id) },
    trigger: async (instanceId, trigger) => triggers.push({ instanceId, trigger }),
    now: () => clock.now(),
  })

  function addInstance(id, recipeId, config) {
    const instance = { _id: id, recipeId, name: recipeId, ownerId: OWNER, projectId: 'proj1', state: 'active', config, cursor: {}, match: { slack: { teamId: TEAM, channels: config.channels } } }
    instances.set(id, instance)
    return instance
  }

  /** The Events API delivering messages (as Slack sends message.channels). */
  async function deliver(list) {
    for (const msg of list) {
      const event = { type: 'message', channel: CHANNEL.id, channel_type: 'channel', ts: msg.ts, user: msg.user, text: msg.text, ...(msg.threadTs && { thread_ts: msg.threadTs }), ...(msg.subtype && { subtype: msg.subtype }), ...(msg.bot && { bot_id: 'B0BOT' }) }
      await vendor.ingest.handle({ type: 'event_callback', team_id: TEAM, event_id: 'Ev' + msg.ts.replace('.', ''), event })
      for (const r of msg.reactions || []) for (let i = 0; i < r.count; i++) await vendor.ingest.handle({ type: 'event_callback', team_id: TEAM, event: { type: 'reaction_added', reaction: r.name, user: 'U0SAM', item: { type: 'message', channel: CHANNEL.id, ts: msg.ts } } })
    }
  }

  /** One run of a recipe module for an instance: its session, a context, run(). */
  async function run(recipe, instance, { ai = null, budget = countingBudget({ vendorCalls: 200 }), trigger = { kind: 'manual' } } = {}) {
    const session = await vendor.session(instance, { budget })
    const world = recipeContext({ instance, vendor: { slack: session }, ai, now: clock, trigger })
    const result = await recipe.run(world.ctx)
    return { result, ...world, session, budget }
  }

  return { api, fake, stores, gates, vendor, instances, triggers, clock, integration, addInstance, deliver, run }
}
