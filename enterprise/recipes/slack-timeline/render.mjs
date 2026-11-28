// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A channel's timeline from its commitment rows: the launch plan (12 tasks at most: the dated
// commitments in the horizon, nearest first; the rest listed on the nearest task), and the
// Commitments board (Open, Done, Slipped; 24 cards, newest first). Lanes are the person's milestone
// lanes, or the channel's most used terms that its commitments name, else one "Commitments" lane.
import { COMMITMENT_LANES } from './manifest.mjs'
import { channelLabel } from '../_slack-ledger/config.mjs'
import { daysBetween } from '../_slack-ledger/dates.mjs'
import { overlap } from '../_slack-ledger/signals.mjs'
import { normalKey, plain, shortDate } from '../_shared/text.mjs'

export const TIMELINE_LIMITS = Object.freeze({ tasks: 12, cards: 24, alsoPerTask: 6, inferredLanes: 3 })

const slipText = (days) => (days > 0 ? `slipped +${days}d` : days < 0 ? `pulled in ${-days}d` : null)

/** The lane for a commitment: the first lane whose words it names, else the last lane. */
function laneOf(row, lanes) {
  const text = normalKey(row.data.what)
  const hit = lanes.find((l) => l.key !== 'other' && normalKey(l.label).split(' ').some((w) => w.length > 2 && text.includes(w)))
  return (hit || lanes[lanes.length - 1]).key
}

export function lanesFor(config, rows, concepts) {
  if (config.lanes?.length) return [...config.lanes.map((label) => ({ key: normalKey(label).replace(/ /g, '-') || 'lane', label: plain(label, 40) })), { key: 'other', label: 'Other' }]
  const named = concepts
    .sort((a, b) => b.data.mentions - a.data.mentions)
    .filter((c) => rows.some((r) => normalKey(r.data.what).includes(normalKey(c.data.term))))
    .slice(0, TIMELINE_LIMITS.inferredLanes)
  if (!named.length) return [{ key: 'commitments', label: 'Commitments' }]
  return [...named.map((c) => ({ key: normalKey(c.data.term).replace(/ /g, '-'), label: c.data.term })), { key: 'other', label: 'Other' }]
}

/** → { slate, tasks, slipped } for one channel. today: an ISO day. */
export function timelineSlate(channel, rows, names, { config, today }) {
  const commitments = rows.filter((r) => r.kind === 'commitment')
  const concepts = rows.filter((r) => r.kind === 'concept')
  const lanes = lanesFor(config, commitments, concepts)
  const past = config.pastDays ?? 14
  const ahead = config.futureDays ?? 60
  const dated = commitments.filter((r) => r.data.due && daysBetween(today, r.data.due) >= -past && daysBetween(today, r.data.due) <= ahead)
  dated.sort((a, b) => (a.data.due < b.data.due ? -1 : a.data.due > b.data.due ? 1 : Number(a.data.ts) - Number(b.data.ts)))
  // The 12 nearest to today (either side), then back in date order.
  const nearest = [...dated].sort((a, b) => Math.abs(daysBetween(today, a.data.due)) - Math.abs(daysBetween(today, b.data.due))).slice(0, TIMELINE_LIMITS.tasks)
  const keep = new Set(nearest.map((r) => r.key))
  const tasks = dated.filter((r) => keep.has(r.key))
  const rest = dated.filter((r) => !keep.has(r.key))
  const also = new Map()
  for (const r of rest) {
    const host = [...tasks].sort((a, b) => Math.abs(daysBetween(a.data.due, r.data.due)) - Math.abs(daysBetween(b.data.due, r.data.due)))[0]
    if (!host) continue
    if (!also.has(host.key)) also.set(host.key, [])
    if (also.get(host.key).length < TIMELINE_LIMITS.alsoPerTask) also.get(host.key).push(`${plain(r.data.what, 60)} (${shortDate(r.data.due)})`)
  }
  const owner = (r) => (r.data.owner ? names.get(r.data.owner) || 'someone' : null)
  const slipped = (r) => !r.data.done && ((r.data.slipDays || 0) > 0 || r.data.due < today)
  const plan = tasks.map((r) => {
    const dependsOn = r.data.after ? tasks.filter((t) => t.key !== r.key && overlap(t.data.what, r.data.after) >= 0.5).map((t) => t.key).slice(0, 3) : []
    return {
      key: r.key,
      label: plain(r.data.what, 90),
      lane: laneOf(r, lanes),
      due: r.data.due,
      ...(owner(r) && { owner: owner(r) }),
      ...(dependsOn.length && { dependsOn }),
      ...(r.data.permalink && { link: r.data.permalink }),
      fields: {
        status: r.data.done ? 'done' : slipped(r) ? 'slipped' : 'open',
        ...(slipText(r.data.slipDays || 0) && { slip: slipText(r.data.slipDays) }),
        ...(also.has(r.key) && { also: also.get(r.key).join('; ') }),
      },
    }
  })
  const board = [...commitments].sort((a, b) => Number(b.data.ts) - Number(a.data.ts)).slice(0, TIMELINE_LIMITS.cards).map((r) => ({
    key: 'c:' + r.key,
    label: plain(r.data.what, 90),
    lane: r.data.done ? 'done' : slipped(r) ? 'slipped' : 'open',
    ...(r.data.due && { due: r.data.due }),
    ...(owner(r) && { owner: owner(r) }),
    ...(r.data.permalink && { link: r.data.permalink }),
    fields: { ...(r.data.due ? { due: shortDate(r.data.due) } : { due: r.data.vague ? plain(r.data.vague, 30) : 'no date' }), ...(slipText(r.data.slipDays || 0) && { slip: slipText(r.data.slipDays) }) },
  }))
  const label = channelLabel(channel)
  return {
    tasks: plan,
    slipped: commitments.filter(slipped),
    slate: {
      role: 'timeline',
      key: channel.id,
      name: `Timeline — ${label}`,
      boards: [
        { key: 'plan', component: 'launch-plan', title: `Plan for ${label}`, lanes, cards: plan },
        { key: 'commitments', component: 'team-board', title: 'Commitments', lanes: COMMITMENT_LANES.map((l) => ({ ...l })), cards: board },
      ],
      notes: [
        { key: 'today', anchor: 'top-left', text: `Today: ${shortDate(today)}` },
        { key: 'legend', anchor: 'legend', text: `Dates people committed to in ${label}. Change a date or owner on the board and it stays yours.` },
      ],
    },
  }
}
