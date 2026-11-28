// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Slack's live messages for recipes: the Events API's message.channels and message.groups (sent for
// the channels the connected people are in), and reaction_added / reaction_removed. The Slack events
// route (enterprise/server/slack/routes.mjs) has already checked Slack's signature and handled each
// event id once; it hands the event here after answering Slack.
//
// Only channels a recipe watches are kept: a message lands in the inbox (recipeInbox: ids, ts,
// thread, text capped at 4,000 characters, reaction counts; two days), and each matching recipe gets
// a debounced trigger, so a busy hour is one fold. An edit replaces the text; a deletion keeps only
// the ts and "deleted", so the next fold removes what came from that message. Direct messages, files
// and attachments are never kept.
import { inboxId, INBOX_MS } from './stores.mjs'
import { messageOf } from './session.mjs'

const CHANNEL = /^[CG][A-Z0-9]{6,24}$/
const TEAM = /^[TE][A-Z0-9]{2,24}$/
const TS = /^\d{9,11}\.\d{6}$/
const KEPT_SUBTYPES = new Set([undefined, 'thread_broadcast', 'me_message', 'file_share'])
export const SLACK_RECIPE_EVENTS = Object.freeze(['message', 'reaction_added', 'reaction_removed'])

/**
 * stores: stores.mjs; instances.matching(teamId, channel) → [instanceId] (active Slack recipes that
 * watch the channel); trigger(instanceId, trigger) (the queue's debounced trigger); log(entry).
 * → { handles(type), handle(body) → Promise<{ kept, triggered }> }
 */
export function createSlackIngest({ stores, instances, trigger, log = () => {}, now = Date.now }) {
  async function matched(teamId, channel) {
    if (!TEAM.test(teamId || '') || !CHANNEL.test(channel || '')) return []
    return (await instances.matching(teamId, channel)) || []
  }
  async function fire(ids, channel, event) {
    for (const id of ids) await trigger(id, { kind: 'vendor', event, channels: [channel] }).catch(() => log({ kind: 'recipe_trigger_failed', instanceId: id }))
    return ids.length
  }

  async function onMessage(teamId, event) {
    const channel = event.channel
    if (event.channel_type === 'im' || event.channel_type === 'mpim') return { kept: 0, triggered: 0 }
    const ids = await matched(teamId, channel)
    if (!ids.length) return { kept: 0, triggered: 0 }
    if (event.subtype === 'message_changed') {
      const m = messageOf(event.message || {})
      if (!m || !TS.test(m.ts)) return { kept: 0, triggered: 0 }
      await stores.inbox.patch(inboxId(teamId, channel, m.ts), { text: m.text })
      return { kept: 1, triggered: 0 }
    }
    if (event.subtype === 'message_deleted') {
      const ts = event.deleted_ts || event.previous_message?.ts
      if (!TS.test(ts || '')) return { kept: 0, triggered: 0 }
      await stores.inbox.put({ _id: inboxId(teamId, channel, ts), teamId, channel, ts, tsNum: Number(ts), deleted: true, text: '', user: null, instanceIds: ids, at: new Date(now()), expiresAt: new Date(now() + INBOX_MS) })
      return { kept: 1, triggered: await fire(ids, channel, 'slack.message') }
    }
    if (!KEPT_SUBTYPES.has(event.subtype)) return { kept: 0, triggered: 0 }
    const m = messageOf(event)
    if (!m || !TS.test(m.ts)) return { kept: 0, triggered: 0 }
    const { channel: _c, ...message } = m
    await stores.inbox.put({ _id: inboxId(teamId, channel, m.ts), teamId, channel, tsNum: Number(m.ts), ...message, instanceIds: ids, at: new Date(now()), expiresAt: new Date(now() + INBOX_MS) })
    return { kept: 1, triggered: await fire(ids, channel, 'slack.message') }
  }

  async function onReaction(teamId, event, delta) {
    const item = event.item
    if (item?.type !== 'message' || !TS.test(item.ts || '')) return { kept: 0, triggered: 0 }
    const id = inboxId(teamId, item.channel, item.ts)
    const row = await stores.inbox.get(id)
    if (!row) return { kept: 0, triggered: 0 }
    const name = String(event.reaction || '').replace(/::skin-tone-\d$/, '').slice(0, 60)
    const reactions = [...(row.reactions || [])]
    const at = reactions.findIndex((r) => r.name === name)
    if (at >= 0) reactions[at] = { name, count: Math.max(0, reactions[at].count + delta) }
    else if (delta > 0) reactions.push({ name, count: 1 })
    await stores.inbox.patch(id, { reactions: reactions.filter((r) => r.count > 0).slice(0, 20) })
    return { kept: 1, triggered: await fire(row.instanceIds || [], item.channel, 'slack.message') }
  }

  return {
    handles: (type) => SLACK_RECIPE_EVENTS.includes(type),
    async handle(body) {
      const teamId = body?.team_id
      const event = body?.event
      if (!event || typeof event !== 'object') return { kept: 0, triggered: 0 }
      if (event.type === 'message') return onMessage(teamId, event)
      if (event.type === 'reaction_added') return onReaction(teamId, event, 1)
      if (event.type === 'reaction_removed') return onReaction(teamId, event, -1)
      return { kept: 0, triggered: 0 }
    },
  }
}
