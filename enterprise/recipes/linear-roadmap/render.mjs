// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The roadmap's three slates, from Linear's projects (pure):
//   Roadmap        a team board per group (team, initiative or lead): lanes Overdue, This quarter,
//                  Next quarter, Later, No target date; one card per open project, "Checkout v2 ·
//                  Dec 19 · at risk · slipped +9d". Past 24 projects a group splits into boards of 24
//                  (a board holds 24), 8 boards a slate, then a second slate.
//   Dependencies   every open project as a note colored by health, in a frame per team; a line from
//                  a project to each project it blocks, labeled with how many issues ("3 issues"),
//                  dashed and marked "late" when the blocker is due after what it blocks.
//   Project health a note per project: health, days since the last update, the update's first words,
//                  linked to it; "Stale update" past the configured days. Worst health first.
import { plain, count } from '../_shared/text.mjs'
import { HEALTH_COLORS, HEALTH_WORDS, ROADMAP_LANES, collapseBlockers, dayWords, daysBetween, groupOf, isClosedProject, keyOf, quarterOf, roadmapLane } from '../_linear/workgraph.mjs'

export const ROADMAP_LIMITS = Object.freeze({ cards: 24, boardsPerSlate: 8, projects: 200 })
const SEVERITY = { offTrack: 0, atRisk: 1, onTrack: 2 }

/** A project's card words (80 characters at most: a board card's limit). */
export function cardLabel(project, { now, slipDays = 0 }) {
  const parts = [plain(project.name, 50)]
  if (project.targetDate) parts.push(dayWords(project.targetDate, now))
  if (project.health === 'atRisk' || project.health === 'offTrack') parts.push(HEALTH_WORDS[project.health].toLowerCase())
  if (slipDays > 0) parts.push(`slipped +${slipDays}d`)
  return plain(parts.join(' · '), 80)
}

/**
 * The roadmap slates. groupsBefore: board keys a past run drew (a group gone now gets an empty board,
 * so its cards go). placed: { boardKey: [projectId] } and slateOfBoard: { boardKey: slate index } from
 * the run before: a project stays on its board while that board has room, and a board stays on its
 * slate, so a 25th project or a new group sorting in never moves cards (and people's moves on them)
 * to another board or slate. → [slate]
 */
export function roadmapSlates({ org, projects, by, today, now, slips = {}, reclaim = new Set(), teams = [], groupsBefore = [], quarterLine = '', placed = {}, slateOfBoard = {} }) {
  const open = projects.filter((p) => !isClosedProject(p))
  const boardOf = new Map(Object.entries(placed || {}).flatMap(([key, ids]) => (Array.isArray(ids) ? ids.map((id) => [id, key]) : [])))
  const groups = new Map()
  for (const p of open) {
    const g = groupOf(p, by)
    if (!groups.has(g.key)) groups.set(g.key, { ...g, projects: [] })
    groups.get(g.key).projects.push(p)
  }
  const boards = []
  const lanes = () => ROADMAP_LANES.map((l) => ({ ...l }))
  for (const g of [...groups.values()].sort((a, b) => a.title.localeCompare(b.title))) {
    const sorted = g.projects.sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999') || a.name.localeCompare(b.name))
    const keyAt = (n) => (n === 1 ? g.key : `${g.key}/${n}`)
    const indexOf = (key) => (key === g.key ? 1 : key?.startsWith(`${g.key}/`) && /^\d+$/.test(key.slice(g.key.length + 1)) ? Number(key.slice(g.key.length + 1)) : null)
    const bins = new Map() // n -> projects
    const rest = []
    for (const p of sorted) {
      const n = indexOf(boardOf.get(p.id))
      if (n && (bins.get(n)?.length || 0) < ROADMAP_LIMITS.cards) {
        if (!bins.has(n)) bins.set(n, [])
        bins.get(n).push(p)
      } else rest.push(p)
    }
    for (const p of rest) {
      let n = 1
      while ((bins.get(n)?.length || 0) >= ROADMAP_LIMITS.cards) n += 1
      if (!bins.has(n)) bins.set(n, [])
      bins.get(n).push(p)
    }
    const used = [...bins.keys()].sort((a, b) => a - b)
    for (const n of used) boards.push({
      key: keyAt(n),
      component: 'team-board',
      title: plain(used.length > 1 || n > 1 ? `${g.title} (${n})` : g.title, 80),
      lanes: lanes(),
      cards: bins.get(n).map((p) => ({
        key: keyOf(org, 'project', p.id),
        label: cardLabel(p, { now, slipDays: slips[p.id] || 0 }),
        lane: roadmapLane(p.targetDate, today),
        ...(p.url && { link: { url: p.url } }),
        // Linear changed this project's date since the last run: a card a person moved follows it again.
        ...(reclaim.has(p.id) && { reclaim: true }),
      })),
    })
  }
  const drawn = new Set(boards.map((b) => b.key))
  for (const key of groupsBefore) if (!drawn.has(key)) boards.push({ key, component: 'team-board', title: 'No open projects', lanes: lanes(), cards: [] })
  const legend = `From Linear (${teams.join(', ') || 'your teams'}): each open project in the lane its target date puts it, as of ${dayWords(today, now)}. ${quarterLine} Move a card to plan on the slate; Linear's next change to that project moves it back.`
  // Boards onto slates of 8: each on the slate it was on while that one has room, the rest in order.
  const sets = []
  const room = (s) => (sets[s]?.length || 0) < ROADMAP_LIMITS.boardsPerSlate
  const put = (s, board) => {
    while (sets.length <= s) sets.push([])
    sets[s].push(board)
  }
  const later = []
  for (const board of boards) {
    const s = slateOfBoard[board.key]
    if (Number.isInteger(s) && s >= 0 && s < 50 && room(s)) put(s, board)
    else later.push(board)
  }
  for (const board of later) {
    let s = 0
    while (!room(s)) s += 1
    put(s, board)
  }
  return sets.map((set, s) => ({ set, s })).filter(({ set, s }) => set.length || s === 0).map(({ set, s }) => ({
    role: 'roadmap',
    ...(s && { key: String(s + 1) }),
    name: s ? `Roadmap (${s + 1})` : 'Roadmap',
    boards: set,
    notes: [{ key: 'legend', anchor: 'legend', text: plain(legend, 400) }],
  }))
}

/** Where each project's card and each board were drawn (for the next run's roadmapSlates): { placed: { boardKey: [projectId] }, slateOfBoard }. */
export function roadmapPlacement(slates) {
  const placed = {}
  const slateOfBoard = {}
  for (const slate of slates) {
    const s = slate.key ? Number(slate.key) - 1 : 0
    for (const board of slate.boards) {
      if (!board.cards.length) continue
      slateOfBoard[board.key] = s
      placed[board.key] = board.cards.map((card) => card.key.slice(card.key.lastIndexOf(':') + 1))
    }
  }
  return { placed, slateOfBoard }
}

/** The dependency map: projects in team frames, blocking edges with issue counts. */
export function dependencySlate({ org, projects, blockers, now }) {
  const open = projects.filter((p) => !isClosedProject(p))
  const byId = new Map(open.map((p) => [p.id, p]))
  const edges = collapseBlockers(blockers, open.map((p) => p.id))
  const node = (p) => ({ key: keyOf(org, 'project', p.id), text: plain([p.name, [p.health ? HEALTH_WORDS[p.health] : 'No health yet', p.targetDate ? `target ${dayWords(p.targetDate, now)}` : 'no target'].join(' · ')].join('\n'), 200, { lines: true }), shape: 'roundedrectangle', colors: HEALTH_COLORS[p.health || 'none'], ...(p.url && { link: { url: p.url } }) })
  const late = (e) => {
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    return Boolean(from?.targetDate && to?.targetDate && from.targetDate > to.targetDate)
  }
  const frames = new Map()
  for (const p of open) {
    const team = p.teams?.[0]
    const key = team ? `team:${team.id}` : 'team:none'
    if (!frames.has(key)) frames.set(key, { key, text: team ? plain(team.name || team.key, 80) : 'No team', members: [] })
    frames.get(key).members.push(keyOf(org, 'project', p.id))
  }
  const lines = edges.map((e) => ({ from: keyOf(org, 'project', e.from), to: keyOf(org, 'project', e.to), label: `${count(e.count, 'issue', 'issues')}${late(e) ? ' · late' : ''}`, ...(late(e) && { style: 'dashed' }) }))
  const lonely = open.filter((p) => !edges.some((e) => e.from === p.id || e.to === p.id)).length
  return {
    slate: {
      role: 'dependencies',
      name: 'Dependencies',
      graph: { nodes: open.map(node), edges: lines, frames: [...frames.values()], layout: 'layered' },
      notes: [{ key: 'legend', anchor: 'legend', text: plain(`A line runs from a project to each project it blocks, with how many open issues block it. Dashed and "late": the blocker is due after what it blocks. ${count(lonely, 'project has', 'projects have')} no blockers across projects.`, 400) }],
    },
    edges,
  }
}

/** The project health cards, worst health first; stale updates flagged. → { slate, stale: [{ id, days }] } */
export function healthSlate({ org, projects, today, staleDays = 14, summary = null }) {
  const open = projects.filter((p) => !isClosedProject(p))
  const stale = []
  const nodes = open
    .sort((a, b) => (SEVERITY[a.health] ?? 3) - (SEVERITY[b.health] ?? 3) || a.name.localeCompare(b.name))
    .map((p) => {
      const update = p.lastUpdate
      const days = update?.at ? daysBetween(update.at.slice(0, 10), today) : null
      const isStale = days === null || days >= staleDays
      if (isStale && days !== null) stale.push({ id: p.id, name: p.name, days })
      const when = days === null ? 'No update yet' : days === 0 ? 'Updated today' : `Updated ${count(days, 'day', 'days')} ago`
      const lines = [p.name, `${p.health ? HEALTH_WORDS[p.health] : 'No health yet'} · ${when}${isStale && days !== null ? ' · Stale update' : ''}`]
      if (update?.excerpt) lines.push(plain(update.excerpt, 180))
      return { key: keyOf(org, 'project', p.id), text: plain(lines.join('\n'), 300, { lines: true }), shape: 'rectangle', colors: HEALTH_COLORS[p.health || 'none'], ...((update?.url || p.url) && { link: { url: update?.url || p.url } }) }
    })
  const notes = [{ key: 'legend', anchor: 'legend', text: plain(`Each open project's latest update from Linear, worst health first. "Stale update": nothing posted for ${staleDays} days or more. ${quarterOf(today).label}.`, 300) }]
  if (summary) notes.push({ key: 'summary', anchor: 'legend', text: plain(`This week: ${summary}`, 600, { lines: true }) })
  return { slate: { role: 'health', name: 'Project health', graph: { nodes, edges: [], frames: [], layout: 'grid' }, notes }, stale }
}
