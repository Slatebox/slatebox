// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The decision log's slates from the ledger's decision rows. A channel's board holds at most 24
// cards (a board's limit): cards older than 30 days, then the oldest past 24, roll onto that month's
// archive slate, which holds boards of 24 (up to 8 a slate, then a second slate). Each card's key is
// its ledger key, so reconcile finds the same card every run.
import { DECISION_LANES } from './manifest.mjs'
import { channelLabel } from '../_slack-ledger/config.mjs'
import { plain } from '../_shared/text.mjs'

export const LOG_LIMITS = Object.freeze({ boardCards: 24, boardsPerSlate: 8, liveDays: 30 })
const MONTH = (day) => day.slice(0, 7)
const monthName = (month) => new Date(month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export function decisionCard(row, names) {
  const d = row.data
  const by = (d.decidedBy || []).map((id) => names.get(id) || 'someone').join(', ')
  return {
    key: row.key,
    label: plain(d.title, 90),
    lane: d.status,
    fields: {
      ...(d.rationale && { why: plain(d.rationale, 140) }),
      ...(by && { by }),
      date: d.day,
      ...(d.reversedFrom && { was: plain(d.reversedFrom, 90) }),
      ...(row.channel && { channel: channelLabel(row.channel) }),
    },
    ...(d.permalink && { link: d.permalink }),
  }
}

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size))

/** → { slates, live, archived } for one channel. today is an ISO day. */
export function channelSlates(channel, rows, names, { today }) {
  const decisions = rows.filter((r) => r.kind === 'decision').sort((a, b) => Number(b.data.ts) - Number(a.data.ts))
  const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - LOG_LIMITS.liveDays * 86400000).toISOString().slice(0, 10)
  const recent = decisions.filter((r) => r.data.day >= cutoff)
  const live = recent.slice(0, LOG_LIMITS.boardCards)
  const liveKeys = new Set(live.map((r) => r.key))
  const archived = decisions.filter((r) => !liveKeys.has(r.key))
  const byMonth = new Map()
  for (const row of archived) {
    const month = MONTH(row.data.day)
    if (!byMonth.has(month)) byMonth.set(month, [])
    byMonth.get(month).push(row)
  }
  const label = channelLabel(channel)
  const slates = []
  const contents = [...byMonth].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, list]) => `${monthName(month)} (${list.length})`)
  slates.push({
    role: 'decisions',
    key: channel.id,
    name: `Decision log — ${label}`,
    boards: [{ key: 'log', component: 'team-board', title: `Decisions in ${label}`, lanes: DECISION_LANES.map((l) => ({ ...l })), cards: live.map((r) => decisionCard(r, names)) }],
    notes: [
      { key: 'legend', anchor: 'legend', text: `Decisions from ${label}, newest first. Move a card to make it yours: the agent never moves it again.` },
      ...(contents.length ? [{ key: 'contents', anchor: 'top-left', text: plain(`Archive: ${contents.join(', ')}`, 400) }] : []),
    ],
  })
  for (const [month, list] of byMonth) {
    const boards = chunk(list, LOG_LIMITS.boardCards)
    chunk(boards, LOG_LIMITS.boardsPerSlate).forEach((group, part) => {
      slates.push({
        role: 'archive',
        key: `${channel.id}/${month}${part ? '/' + (part + 1) : ''}`,
        name: `Decision log — ${label} — ${monthName(month)}${part ? ` (${part + 1})` : ''}`,
        folder: ['Decision archive'],
        boards: group.map((cards, i) => ({ key: `${month}-${part * LOG_LIMITS.boardsPerSlate + i + 1}`, component: 'team-board', title: `${monthName(month)}${group.length > 1 || part ? ` · ${part * LOG_LIMITS.boardsPerSlate + i + 1}` : ''}`, lanes: DECISION_LANES.map((l) => ({ ...l })), cards: cards.map((r) => decisionCard(r, names)) })),
      })
    })
  }
  return { slates, live, archived }
}

/** The "All decisions" slate: the newest 24 across channels, when the log reads two or more. */
export function allSlate(channels, names) {
  const rows = channels.flatMap((c) => c.rows.filter((r) => r.kind === 'decision' && r.data.status !== 'maybe').map((r) => ({ ...r, channel: c })))
  rows.sort((a, b) => Number(b.data.ts) - Number(a.data.ts))
  return {
    role: 'all',
    key: 'all',
    name: 'All decisions',
    boards: [{ key: 'all', component: 'team-board', title: 'All decisions', lanes: DECISION_LANES.filter((l) => l.key !== 'maybe').map((l) => ({ ...l })), cards: rows.slice(0, LOG_LIMITS.boardCards).map((r) => ({ ...decisionCard(r, names), key: 'all:' + r.key })) }],
  }
}
