// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One run of the timeline: fold new messages into the ledger, then each channel's plan and board.
// Events come from what changed since this instance's last run: a moved date, a slip, a task done.
import { channelLedgers } from '../_slack-ledger/channels.mjs'
import { daysBetween, isoDayIn } from '../_slack-ledger/dates.mjs'
import { diffSeen } from '../_shared/changes.mjs'
import { count } from '../_shared/text.mjs'
import { timelineSlate } from './render.mjs'

export default async function run(ctx) {
  const config = ctx.instance.config
  const read = await channelLedgers(ctx, { channels: config.channels, config })
  const owners = [...new Set(read.channels.flatMap((c) => c.rows.filter((r) => r.kind === 'commitment').map((r) => r.data.owner).filter(Boolean)))]
  const names = owners.length ? await ctx.vendor.slack.names(owners) : new Map()
  const today = isoDayIn(ctx.now(), config.tz || 'UTC')
  const slates = []
  let tasks = 0
  let slipped = 0
  for (const channel of read.channels) {
    const made = timelineSlate(channel, channel.rows, names, { config, today })
    slates.push(made.slate)
    tasks += made.tasks.length
    slipped += made.slipped.length
  }

  const rows = read.channels.flatMap((c) => c.rows.filter((r) => r.kind === 'commitment').map((r) => ({ r, c })))
  const byKey = new Map(rows.map((x) => [x.r.key, x]))
  const diff = diffSeen(ctx.instance.cursor?.seen, new Map(rows.map(({ r }) => [r.key, `${r.data.due || ''}|${r.data.done ? 1 : 0}`])))
  for (const change of diff.changed) {
    const { r, c } = byKey.get(change.key)
    const [fromDue, fromDone] = change.from.split('|')
    const base = { channelId: c.id, key: r.key, permalink: r.data.permalink || null }
    if (fromDue !== (r.data.due || '') && r.data.due) {
      const latest = r.data.dueHistory?.[r.data.dueHistory.length - 1]
      ctx.emit('timeline.date_changed', { ...base, from: fromDue || null, to: r.data.due, permalink: latest?.permalink || base.permalink })
      if (fromDue && daysBetween(fromDue, r.data.due) > 0) ctx.emit('timeline.slipped', { ...base, from: fromDue, to: r.data.due, days: daysBetween(fromDue, r.data.due) })
    }
    if (fromDone === '0' && r.data.done) ctx.emit('timeline.done', { ...base, permalink: r.data.donePermalink || base.permalink })
  }
  ctx.setCursor({ seen: diff.seen })

  return {
    desired: { slates, ...(read.partial && { partial: read.partial }) },
    summary: `${count(tasks, 'task', 'tasks')} on the plan, ${slipped} slipped, from ${count(read.channels.length, 'channel', 'channels')}`,
    stats: { modelCalls: read.stats.modelCalls, folded: read.stats.folded },
  }
}
