// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One cycle's slate (pure), "ENG cycle 48 (Nov 24 – Dec 7)":
//   the board   a team board with lanes To do, In progress, Done, Canceled; a card per issue,
//               "ENG-212 Fix refunds · Ana · 3 pts · blocked". A board holds 24 cards: a bigger
//               cycle is split by assignee (each person's issues stay on one board).
//   blockers    each blocked issue as an amber note, a line from each issue blocking it; another
//               team's issues in a frame for that team; a blocker already done is grey.
//   scope       one note: planned at the start, added after it started, removed since.
import { plain, count } from '../_shared/text.mjs'
import { CYCLE_LANES, STATE_COLORS, cycleLaneOf, dayWords, keyOf } from '../_linear/workgraph.mjs'

export const CYCLE_LIMITS = Object.freeze({ cards: 24, boards: 6, blockers: 80 })
const isOpen = (state) => !['completed', 'canceled'].includes(state?.type)

export const cycleKey = (team, cycle) => `${team.key}-${cycle.number}`
export function cycleName(team, cycle, now) {
  const span = cycle.startsAt && cycle.endsAt ? ` (${dayWords(cycle.startsAt.slice(0, 10), now)} – ${dayWords(cycle.endsAt.slice(0, 10), now)})` : ''
  return plain(`${team.key} ${cycle.name ? cycle.name : `cycle ${cycle.number}`}${span}`, 120)
}

/** The issues that block this one and are not done yet. */
export const openBlockers = (issue) => (issue.blockedBy || []).filter((b) => isOpen(b.state))

export function issueCard(org, issue, { reclaim = false } = {}) {
  const parts = [plain(`${issue.identifier} ${issue.title}`, 60)]
  if (issue.assignee) parts.push(plain(issue.assignee, 20))
  if (issue.estimate) parts.push(`${issue.estimate} ${issue.estimate === 1 ? 'pt' : 'pts'}`)
  if (openBlockers(issue).length && isOpen(issue.state)) parts.push('blocked')
  return { key: keyOf(org, 'issue', issue.id), label: plain(parts.join(' · '), 80), lane: cycleLaneOf(issue.state.type), ...(issue.url && { link: { url: issue.url } }), ...(reclaim && { reclaim: true }) }
}

/** People's issues packed onto boards of at most 24, a person's issues never split (one over 24 is cut). */
export function packByAssignee(issues) {
  const people = new Map()
  for (const i of issues) {
    const who = i.assignee || 'No one yet'
    if (!people.has(who)) people.set(who, [])
    people.get(who).push(i)
  }
  const boards = []
  for (const [who, list] of [...people].sort((a, b) => a[0].localeCompare(b[0]))) {
    const last = boards[boards.length - 1]
    if (last && last.issues.length + list.length <= CYCLE_LIMITS.cards) {
      last.people.push(who)
      last.issues.push(...list)
    } else boards.push({ people: [who], issues: list.slice(0, CYCLE_LIMITS.cards) })
  }
  return boards
}

export function cycleSlate({ org, team, cycle, now, reclaim = new Set(), removed = [], subIssues = false }) {
  const issues = cycle.issues.filter((i) => subIssues || !i.parentId).sort((a, b) => a.identifier.localeCompare(b.identifier, 'en', { numeric: true }))
  const lanes = CYCLE_LANES.map(({ key, label }) => ({ key, label }))
  const groups = issues.length <= CYCLE_LIMITS.cards ? [{ people: null, issues }] : packByAssignee(issues)
  const boards = groups.slice(0, CYCLE_LIMITS.boards).map((g, n) => ({
    key: g.people ? `people:${n + 1}` : 'cycle',
    component: 'team-board',
    title: plain(g.people ? g.people.join(', ') : `${team.key} cycle ${cycle.number}`, 80),
    lanes,
    cards: g.issues.map((i) => issueCard(org, i, { reclaim: reclaim.has(i.id) })),
  }))

  // Blockers: a line from each blocking issue to the cycle issue it blocks.
  const nodes = new Map()
  const edges = []
  const frames = new Map()
  const note = (x, colors) => {
    const key = keyOf(org, 'issue', x.id)
    if (!nodes.has(key)) nodes.set(key, { key, text: plain(`${x.identifier} ${x.title || ''}`, 120), shape: 'roundedrectangle', colors, ...(x.url && { link: { url: x.url } }) })
    if (x.team?.key && x.team.key !== team.key) {
      if (!frames.has(x.team.key)) frames.set(x.team.key, { key: `team:${x.team.key}`, text: `${x.team.key} (another team)`, members: [] })
      if (!frames.get(x.team.key).members.includes(key)) frames.get(x.team.key).members.push(key)
    }
    return key
  }
  const blocked = []
  for (const issue of issues) {
    const by = issue.blockedBy || []
    if (!by.length) continue
    const stillBlocked = isOpen(issue.state) && openBlockers(issue).length > 0
    const to = note({ ...issue, team: { key: team.key } }, stillBlocked ? STATE_COLORS.blocked : isOpen(issue.state) ? STATE_COLORS.open : STATE_COLORS.done)
    if (stillBlocked) blocked.push({ issue: issue.identifier, blockedBy: openBlockers(issue).map((b) => b.identifier) })
    for (const b of by) {
      const from = note(b, isOpen(b.state) ? STATE_COLORS.open : STATE_COLORS.done)
      edges.push({ from, to, label: isOpen(b.state) ? 'blocks' : 'done' })
    }
  }
  const blockerNodes = [...nodes.values()].slice(0, CYCLE_LIMITS.blockers)
  const kept = new Set(blockerNodes.map((n) => n.key))

  const start = cycle.startsAt ? Date.parse(cycle.startsAt) : null
  const added = start ? issues.filter((i) => i.addedToCycleAt && Date.parse(i.addedToCycleAt) > start) : []
  const scope = `Scope: ${count(issues.length - added.length, 'issue', 'issues')} planned at the start, +${added.length} added after it started${removed.length ? `, −${removed.length} removed since` : ''}.`
  const legend = `From Linear: ${team.name || team.key}'s current cycle. Each issue is in its status lane; move a card to change its status in Linear when this recipe may (Permissions), otherwise the move waits for your approval on the recipe's status slate. ${count(blocked.length, 'issue is', 'issues are')} blocked.`
  return {
    slate: {
      role: 'cycle',
      key: cycleKey(team, cycle),
      name: cycleName(team, cycle, now),
      folder: ['Cycles'],
      boards,
      graph: { nodes: blockerNodes, edges: edges.filter((e) => kept.has(e.from) && kept.has(e.to)), frames: [...frames.values()].map((f) => ({ ...f, members: f.members.filter((m) => kept.has(m)) })).filter((f) => f.members.length), layout: 'layered' },
      notes: [{ key: 'legend', anchor: 'legend', text: plain(legend, 400) }, { key: 'scope', anchor: 'legend', text: plain(scope, 300) }],
    },
    blocked,
    added: added.map((i) => i.identifier),
    issues,
  }
}
