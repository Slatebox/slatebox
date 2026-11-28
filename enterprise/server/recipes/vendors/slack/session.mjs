// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// ctx.vendor.slack for one recipe run (design B.7): the owner's own Slack token, so a recipe reads
// only what the owner can see in Slack. Every Slack call counts against the run's vendor budget.
//
// Slack's limits for an app not yet in the Marketplace, kept here:
//   conversations.history / .replies  once a minute per workspace, 15 messages: the same gate as the
//                                     Slack agent on a slate (slackReadGates, id "<team>:<method>"),
//                                     so a recipe and a person's ask never both spend the minute
//   search.messages                   Tier 2 (about 20 a minute): at most 5 pages a backfill
//   users.conversations, users.info   Tier 3 / Tier 4
//   a 429                             its Retry-After holds the gate for every process; the run reads
//                                     what it has and says "threads still loading"
// Live messages come from the Events API (ingest.mjs), which is not limited that way, so a fold
// reads the inbox, not Slack.
import { SIGN_IN_CODES } from './api.mjs'
import { FOLD_LEASE_MS, LEDGER_DAYS } from './stores.mjs'
import { spendVendorCall } from '../spend.mjs'

export const SESSION_LIMITS = Object.freeze({ searchPages: 5, searchCount: 100, channelPages: 5, channelsPage: 200, names: 30, historyLimit: 15 })

const USER = /^[UW][A-Z0-9]{2,20}$/
const CHANNEL = /^[CG][A-Z0-9]{6,24}$/
const day = (ms) => new Date(ms - 86400000).toISOString().slice(0, 10) // search's after: is exclusive

export class RecipeSignInNeeded extends Error {
  constructor(message = 'Connect Slack again on the Integrations page.') {
    super(message)
    this.name = 'SignInNeeded'
    this.code = 'needs_sign_in'
  }
}

/** A message as recipes read it (from search, replies or the inbox): ids, ts, text, reactions. */
export function messageOf(raw, channel) {
  if (!raw || typeof raw.ts !== 'string') return null
  let threadTs = typeof raw.thread_ts === 'string' ? raw.thread_ts : null
  if (!threadTs && typeof raw.permalink === 'string') threadTs = raw.permalink.match(/[?&]thread_ts=(\d+\.\d+)/)?.[1] || null
  return {
    ts: raw.ts,
    threadTs: threadTs && threadTs !== raw.ts ? threadTs : null,
    user: typeof raw.user === 'string' && USER.test(raw.user) ? raw.user : null,
    text: typeof raw.text === 'string' ? raw.text.slice(0, 4000) : '',
    ...(raw.subtype && { subtype: String(raw.subtype).slice(0, 40) }),
    ...((raw.bot_id || raw.subtype === 'bot_message') && { bot: true }),
    ...(Array.isArray(raw.reactions) && { reactions: raw.reactions.slice(0, 20).map((r) => ({ name: String(r.name || '').slice(0, 60), count: Number(r.count) || 0 })) }),
    ...(channel && { channel }),
  }
}

/**
 * deps: { token, teamId, slackUserId, account { url }, instanceId, call (api.mjs), gates
 * (slackReadGates: claim/get/hold), listed (Marketplace or internal app: no once-a-minute gate),
 * historyLimit, stores (stores.mjs), budget (the run's: spend or take, see ../spend.mjs) | null, signal, now,
 * ledgerDays }
 */
export function createSlackRecipeSession({ token, teamId, slackUserId = null, account = {}, instanceId, call, gates, listed = false, historyLimit = SESSION_LIMITS.historyLimit, historyPerMinute = 1, stores, budget = null, signal = null, now = Date.now, ledgerDays = LEDGER_DAYS }) {
  const calls = {}
  async function slack(method, params) {
    if (signal?.aborted) throw Object.assign(new Error('timeout'), { name: 'AbortError', code: 'timeout' })
    spendVendorCall(budget)
    calls[method] = (calls[method] || 0) + 1
    try {
      return await call(token, method, params, { signal })
    } catch (error) {
      if (SIGN_IN_CODES.has(error?.slack)) throw new RecipeSignInNeeded()
      throw error
    }
  }

  // The gated reads: claimed once a minute per workspace and method, shared with the agent's tools.
  async function gated(method, params) {
    const id = `${teamId}:${method}`
    if (!listed) {
      const at = now()
      const claimed = await gates.claim(id, new Date(at), new Date(at + Math.ceil(60000 / historyPerMinute)))
      if (!claimed) return null
    }
    try {
      return await slack(method, params)
    } catch (error) {
      if (error?.code === 'ratelimited') {
        await gates.hold(id, new Date(now() + (error.retryAfter || 60) * 1000)).catch(() => {})
        return null
      }
      throw error
    }
  }

  // The owner's channels (users.conversations): membership, and names for slate titles. Once a run.
  let mine = null
  async function channels() {
    if (mine) return mine
    mine = new Map()
    let cursor
    for (let page = 0; page < SESSION_LIMITS.channelPages; page++) {
      const json = await slack('users.conversations', { types: 'public_channel,private_channel', exclude_archived: true, limit: SESSION_LIMITS.channelsPage, ...(slackUserId && { user: slackUserId }), ...(cursor && { cursor }) })
      for (const c of json.channels || []) if (typeof c?.id === 'string' && CHANNEL.test(c.id)) mine.set(c.id, { id: c.id, name: String(c.name || c.id).slice(0, 80), private: c.is_private === true })
      cursor = json.response_metadata?.next_cursor
      if (!cursor) break
    }
    return mine
  }

  const names = new Map()
  const leaseBy = `${instanceId}:${Math.random().toString(36).slice(2, 10)}`
  const expiresAt = () => new Date(now() + ledgerDays * 86400000)

  return {
    name: 'slack',
    // Each Slack call is counted against the run's budget here (not per method).
    countsOwnCalls: true,
    teamId,
    account: { url: typeof account.url === 'string' ? account.url : null, teamId },
    calls,

    /** Whether the owner is in the channel (the recipe reads nothing from one they left). */
    async isMember(channel) {
      return (await channels()).has(channel)
    },
    /** { id, name } of one of the owner's channels. */
    async channelInfo(channel) {
      return (await channels()).get(channel) || { id: channel, name: channel }
    },
    /** The owner's channels, for setup's channel picker. */
    async listChannels() {
      return [...(await channels()).values()]
    },

    /** Messages Slack sent that no fold has read yet (no Slack call). */
    inbox: (channel) => stores.inbox.list(teamId, channel),
    /** Those messages, folded (each message is folded once across every recipe). */
    markFolded: (channel, list) => stores.inbox.markFolded(teamId, channel, list),

    /**
     * A channel's messages since a time, through search (backfill on setup, or after a long pause).
     * → { messages, threads: [{ ts, replies }], partial } (partial: Slack asked to slow down, or pages ran out).
     */
    async backfill(channel, { since }) {
      const info = (await channels()).get(channel)
      if (!info) return { messages: [], threads: [], partial: 'not_in_channel' }
      const query = `in:#${info.name} after:${day(since)}`
      const found = []
      let partial = null
      for (let page = 1; page <= SESSION_LIMITS.searchPages; page++) {
        let json
        try {
          json = await slack('search.messages', { query, count: SESSION_LIMITS.searchCount, page, sort: 'timestamp', sort_dir: 'asc' })
        } catch (error) {
          if (error?.code === 'ratelimited') {
            partial = 'rate_limited'
            break
          }
          throw error
        }
        const matches = json.messages?.matches || []
        for (const raw of matches) if (raw?.channel?.id === channel || !raw?.channel) found.push(messageOf(raw))
        const pages = json.messages?.paging?.pages || json.messages?.pagination?.page_count || 1
        if (page >= pages || !matches.length) break
        if (page === SESSION_LIMITS.searchPages) partial = 'more_history'
      }
      const messages = found.filter((m) => m && Number(m.ts) * 1000 >= since - 86400000)
      const replies = new Map()
      for (const m of messages) if (m.threadTs) replies.set(m.threadTs, (replies.get(m.threadTs) || 0) + 1)
      return { messages, threads: [...replies].map(([ts, n]) => ({ ts, replies: n })), partial }
    },

    /** A thread's replies through the once-a-minute gate (null when the minute is taken). */
    async replies(channel, threadTs) {
      const json = await gated('conversations.replies', { channel, ts: threadTs, limit: historyLimit })
      if (!json) return null
      return (json.messages || []).slice(0, historyLimit).map((m) => messageOf(m)).filter(Boolean)
    },

    /** People's names (users.info), for cards and digests. Map(userId → name). */
    async names(ids) {
      const out = new Map()
      for (const id of [...new Set(ids || [])].filter((x) => typeof x === 'string' && USER.test(x))) {
        if (names.has(id)) {
          out.set(id, names.get(id))
          continue
        }
        if (names.size >= SESSION_LIMITS.names) continue
        const json = await slack('users.info', { user: id }).catch((error) => {
          if (error instanceof RecipeSignInNeeded || error?.code === 'budget') throw error
          return null
        })
        const p = json?.user
        const name = String(p?.profile?.display_name || p?.real_name || p?.profile?.real_name || p?.name || '').replace(/\s+/g, ' ').trim().slice(0, 60)
        if (name) {
          names.set(id, name)
          out.set(id, name)
        }
      }
      return out
    },

    /** A channel's ledger rows (shared by every recipe that reads the channel). */
    ledger: (channel) => ({
      all: () => stores.ledger.all(teamId, channel),
      upsert: (rows) => stores.ledger.upsert(teamId, channel, instanceId, rows, expiresAt()),
      remove: (keys) => stores.ledger.remove(teamId, channel, keys),
    }),

    foldState: (channel) => stores.folds.get(teamId, channel),
    claimFold: (channel) => stores.folds.claim(teamId, channel, leaseBy, now() + FOLD_LEASE_MS, now()),
    releaseFold: (channel, patch) => stores.folds.release(teamId, channel, leaseBy, patch),
  }
}
