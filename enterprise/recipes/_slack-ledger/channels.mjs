// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What a Slack recipe run does before it renders: for each channel it watches, check the owner is
// still in it, fold what arrived since the last fold (one fold per channel across every recipe that
// reads it: a lease says who folds), and read the channel's ledger rows.
//
// Slack's limits for an app that is not in the Marketplace: conversations.history and .replies once a
// minute per workspace, 15 messages each. So live intake is the Events API (not limited that way),
// backfill on setup is search.messages (Tier 2), and the replies of a busy thread found by the
// backfill are read one gated call at a time across runs ("threads still loading").
import { foldChannel } from './fold.mjs'
import { DECISION } from './signals.mjs'

export const CHANNEL_LIMITS = Object.freeze({ channels: 10, backfillDays: 14, staleMs: 36 * 3600000, repliesPerRun: 3, pendingThreads: 40 })

const maxTs = (messages, start) => messages.reduce((top, m) => (Number(m.ts) > Number(top || 0) ? m.ts : top), start || null)

/**
 * → { channels: [{ id, name, rows }], stats: { folded, modelCalls, messages, newConcepts }, partial }
 * fold: true folds what arrived and reads history where needed (search on setup, gated replies);
 * 'inbox' folds only what the Events API delivered (no Slack history or search call); false reads
 * the ledger as it is.
 */
export async function channelLedgers(ctx, { channels, fold = true, config = {}, purpose = 'ledger' }) {
  const slack = ctx.vendor.slack
  if (!slack) throw Object.assign(new Error('Slack is not connected'), { code: 'needs_sign_in' })
  const tz = config.tz || 'UTC'
  const out = []
  const stats = { folded: 0, modelCalls: 0, messages: 0, newConcepts: 0 }
  let partial = null
  for (const channelId of (channels || []).slice(0, CHANNEL_LIMITS.channels)) {
    if (!(await slack.isMember(channelId))) {
      ctx.log('warn', 'not_in_channel', `Skipped ${channelId}: the owner is not in it.`)
      continue
    }
    const channel = await slack.channelInfo(channelId)
    const ledger = slack.ledger(channelId)
    if (fold && (await slack.claimFold(channelId))) {
      let foldedTs = null
      try {
        const state = (await slack.foldState(channelId)) || null
        const fresh = await slack.inbox(channelId)
        let messages = [...fresh]
        const pending = [...(state?.pendingThreads || [])]
        // First fold, or the inbox (kept two days) may have lost messages while nothing folded: search back.
        const history = fold === true
        let backfilled = Boolean(state?.backfilled)
        if (history && (!backfilled || Date.parse(state.lastFoldAt || 0) < ctx.now() - CHANNEL_LIMITS.staleMs)) {
          const since = backfilled && state?.foldedTs ? Number(state.foldedTs) * 1000 : ctx.now() - CHANNEL_LIMITS.backfillDays * 86400000
          backfilled = true
          const back = await slack.backfill(channelId, { since })
          const seen = new Set(messages.map((m) => m.ts))
          // What an earlier fold already read is not read twice.
          const already = state?.backfilled && state?.foldedTs ? Number(state.foldedTs) : 0
          messages = [...back.messages.filter((m) => !seen.has(m.ts) && Number(m.ts) > already), ...messages]
          // A thread is read in full when the search saw 3 or more replies, or a decision in it.
          const marked = new Set(back.messages.filter((m) => DECISION.test(String(m.text || ''))).map((m) => m.threadTs || m.ts))
          for (const t of back.threads || []) if ((t.replies >= 3 || marked.has(t.ts)) && !pending.includes(t.ts)) pending.push(t.ts)
          if (back.partial) partial = partial || 'threads_loading'
        }
        // Busy threads the search found: their replies, one gated read at a time.
        for (let i = 0; history && i < CHANNEL_LIMITS.repliesPerRun && pending.length; i++) {
          const replies = await slack.replies(channelId, pending[0])
          if (!replies) break
          pending.shift()
          const seen = new Set(messages.map((m) => m.ts))
          messages.push(...replies.filter((m) => !seen.has(m.ts)))
        }
        if (history && pending.length) partial = partial || 'threads_loading'
        foldedTs = maxTs(messages, state?.foldedTs)
        if (messages.length) {
          const rows = await ledger.all()
          const names = await slack.names([...new Set(messages.map((m) => m.user).filter(Boolean))])
          const folded = await foldChannel({ channel, messages, rows, ai: ctx.ai, names, account: slack.account, tz, config, now: ctx.now(), purpose })
          if (folded.upserts.length) await ledger.upsert(folded.upserts)
          if (folded.removed.length) await ledger.remove(folded.removed)
          stats.folded++
          stats.modelCalls += folded.stats.modelCalls
          stats.messages += folded.stats.messages
          stats.newConcepts += folded.stats.newConcepts
          if (folded.stats.partial === 'ai_refused') partial = partial || 'ai_refused'
        }
        if (fresh.length) await slack.markFolded(channelId, fresh.map((m) => m.ts))
        await slack.releaseFold(channelId, { foldedTs, lastFoldAt: new Date(ctx.now()).toISOString(), backfilled, pendingThreads: pending.slice(0, CHANNEL_LIMITS.pendingThreads) })
      } catch (error) {
        await slack.releaseFold(channelId, null).catch(() => {})
        throw error
      }
    }
    out.push({ id: channelId, name: channel.name, rows: await ledger.all() })
  }
  return { channels: out, stats, partial }
}
