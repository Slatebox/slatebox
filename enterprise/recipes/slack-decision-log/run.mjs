// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One run of the decision log: fold the channels' new messages into the ledger (one model call per
// channel at most, none when nothing arrived), then the boards from the ledger's decisions.
import { channelLedgers } from '../_slack-ledger/channels.mjs'
import { isoDayIn } from '../_slack-ledger/dates.mjs'
import { diffSeen } from '../_shared/changes.mjs'
import { count } from '../_shared/text.mjs'
import { allSlate, channelSlates } from './render.mjs'

export default async function run(ctx) {
  const config = ctx.instance.config
  const read = await channelLedgers(ctx, { channels: config.channels, config })
  const ids = [...new Set(read.channels.flatMap((c) => c.rows.filter((r) => r.kind === 'decision').flatMap((r) => r.data.decidedBy || [])))]
  const names = ids.length ? await ctx.vendor.slack.names(ids) : new Map()
  const today = isoDayIn(ctx.now(), config.tz || 'UTC')
  const slates = []
  let live = 0
  let archived = 0
  for (const channel of read.channels) {
    const made = channelSlates(channel, channel.rows, names, { today })
    slates.push(...made.slates)
    live += made.live.length
    archived += made.archived.length
  }
  if (read.channels.length >= 2) slates.push(allSlate(read.channels, names))

  // Events: a decision recorded, revisited or reversed since the last run (this instance's view).
  const rows = read.channels.flatMap((c) => c.rows.filter((r) => r.kind === 'decision').map((r) => ({ r, c })))
  const next = new Map(rows.map(({ r }) => [r.key, r.data.status]))
  const diff = diffSeen(ctx.instance.cursor?.seen, next)
  const byKey = new Map(rows.map(({ r, c }) => [r.key, { r, c }]))
  // Ids, status and the thread's link only (a receiver reads the card's words through the API).
  const data = ({ r, c }) => ({ channelId: c.id, key: r.key, status: r.data.status, permalink: r.data.permalink || null })
  for (const key of diff.added) if (byKey.get(key).r.data.status !== 'maybe') ctx.emit(byKey.get(key).r.data.status === 'reversed' ? 'decision.reversed' : 'decision.recorded', data(byKey.get(key)))
  for (const change of diff.changed) {
    const event = { decided: 'decision.recorded', revisited: 'decision.revisited', reversed: 'decision.reversed' }[change.to]
    if (event) ctx.emit(event, data(byKey.get(change.key)))
  }
  ctx.setCursor({ seen: diff.seen })

  const summary = `${count(live, 'decision', 'decisions')} on the log, ${archived} archived, from ${count(read.channels.length, 'channel', 'channels')}`
  return {
    desired: { slates, ...(read.partial && { partial: read.partial }) },
    summary,
    stats: { modelCalls: read.stats.modelCalls, folded: read.stats.folded, added: diff.added.length, changed: diff.changed.length },
  }
}
