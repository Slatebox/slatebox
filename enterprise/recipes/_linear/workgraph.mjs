// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Linear's data as the work graph the tracker recipes share (recipes catalog A10): containers
// (projects, initiatives, cycles), items (issues, milestones), dependencies (blocks) and updates
// (project health posts), keyed lin:<workspace>:<kind>:<id> so a renamed project lands on the same
// note. Pure: plain data in (what ctx.vendor.linear answers), plain data out; no network, no clock
// but the one passed in.

export const HEALTH_WORDS = Object.freeze({ onTrack: 'On track', atRisk: 'At risk', offTrack: 'Off track' })
// Note colors by health (a slate note's background and text), and for issues by where they stand.
export const HEALTH_COLORS = Object.freeze({
  onTrack: { backgroundColor: '#d8f3dc', foregroundColor: '#1b4332' },
  atRisk: { backgroundColor: '#ffe8a3', foregroundColor: '#5c4400' },
  offTrack: { backgroundColor: '#ffc9c9', foregroundColor: '#7a1010' },
  none: { backgroundColor: '#e9ecef', foregroundColor: '#212529' },
})
export const STATE_COLORS = Object.freeze({
  blocked: { backgroundColor: '#ffe8a3', foregroundColor: '#5c4400' },
  done: { backgroundColor: '#dee2e6', foregroundColor: '#495057' },
  open: { backgroundColor: '#d0ebff', foregroundColor: '#0b3d66' },
  drift: { backgroundColor: '#ffd8a8', foregroundColor: '#5c2b00' },
})

const DAY = 86400000
export const dayNumber = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY)
export const todayIso = (now) => new Date(now).toISOString().slice(0, 10)
/** Calendar days from a to b (ISO days). */
export const daysBetween = (a, b) => dayNumber(b) - dayNumber(a)
/** "Dec 19" (and the year when it is not this one). */
export function dayWords(iso, now = null) {
  const date = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)))
  const sameYear = now === null || new Date(now).getUTCFullYear() === date.getUTCFullYear()
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(!sameYear && { year: 'numeric' }), timeZone: 'UTC' })
}

/** The quarter a day is in: { year, q, label: 'Q4 2026', start, end } (ISO days). */
export function quarterOf(iso) {
  const year = +iso.slice(0, 4)
  const q = Math.floor((+iso.slice(5, 7) - 1) / 3) + 1
  const start = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`
  const endMonth = q * 3
  const end = new Date(Date.UTC(year, endMonth, 0)).toISOString().slice(0, 10)
  return { year, q, label: `Q${q} ${year}`, start, end }
}
export const nextQuarter = (quarter) => quarterOf(new Date(Date.UTC(quarter.year, quarter.q * 3, 1)).toISOString().slice(0, 10))

// The roadmap's lanes, by target date against today. Stable keys and words (the quarter's name is in
// the legend, not the lane, so a new quarter moves cards instead of renaming lanes).
export const ROADMAP_LANES = Object.freeze([
  { key: 'overdue', label: 'Overdue' },
  { key: 'this-quarter', label: 'This quarter' },
  { key: 'next-quarter', label: 'Next quarter' },
  { key: 'later', label: 'Later' },
  { key: 'no-date', label: 'No target date' },
])

/** Which roadmap lane a project's target date puts it in, today. */
export function roadmapLane(targetDate, today) {
  if (!targetDate) return 'no-date'
  if (targetDate < today) return 'overdue'
  const now = quarterOf(today)
  if (targetDate <= now.end) return 'this-quarter'
  if (targetDate <= nextQuarter(now).end) return 'next-quarter'
  return 'later'
}

export const isClosedProject = (p) => ['completed', 'canceled'].includes(p.state)
export const keyOf = (org, kind, id) => `lin:${org}:${kind}:${id}`

/**
 * Cross-project blockers collapsed to project → project edges with how many issues ("3 issues").
 * A relation inside one project, to a project outside the set, or whose blocked issue is done is
 * not an edge. → [{ from, to, count, issues[] }] (sorted, so the same data draws the same lines)
 */
export function collapseBlockers(relations, projectIds) {
  const known = new Set(projectIds)
  const edges = new Map()
  for (const r of relations || []) {
    if (!r.fromProject || !r.toProject || r.fromProject === r.toProject || r.blockedDone) continue
    if (!known.has(r.fromProject) || !known.has(r.toProject)) continue
    const id = `${r.fromProject}->${r.toProject}`
    if (!edges.has(id)) edges.set(id, { from: r.fromProject, to: r.toProject, count: 0, issues: [] })
    const edge = edges.get(id)
    if (!edge.issues.includes(r.issue)) {
      edge.issues.push(r.issue)
      edge.count += 1
    }
  }
  return [...edges.values()].map((e) => ({ ...e, issues: e.issues.sort() })).sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to))
}

/** The group a project is drawn in: its first team, its first initiative, or its lead. */
export function groupOf(project, by) {
  if (by === 'initiative') return project.initiatives?.[0] ? { key: `initiative:${project.initiatives[0].id}`, title: project.initiatives[0].name } : { key: 'initiative:none', title: 'No initiative' }
  if (by === 'lead') return project.lead ? { key: `lead:${project.lead.toLowerCase()}`, title: project.lead } : { key: 'lead:none', title: 'No lead' }
  const team = project.teams?.[0]
  return team ? { key: `team:${team.id}`, title: team.name || team.key } : { key: 'team:none', title: 'No team' }
}

/**
 * The work graph of a workspace's projects (catalog A10). projects: session.projects(...).projects;
 * blockers: session.blockers(...).relations.
 */
export function roadmapWorkGraph({ org, projects, blockers = [] }) {
  const containers = []
  const seenInitiative = new Set()
  for (const p of projects) {
    for (const i of p.initiatives || []) {
      if (seenInitiative.has(i.id)) continue
      seenInitiative.add(i.id)
      containers.push({ key: keyOf(org, 'initiative', i.id), kind: 'initiative', title: i.name })
    }
    containers.push({ key: keyOf(org, 'project', p.id), kind: 'project', title: p.name, parentKey: p.initiatives?.[0] ? keyOf(org, 'initiative', p.initiatives[0].id) : null, start: p.startDate, target: p.targetDate, health: p.health, url: p.url })
  }
  const items = projects.flatMap((p) => (p.milestones || []).map((m) => ({ key: keyOf(org, 'milestone', m.id), containerKeys: [keyOf(org, 'project', p.id)], title: m.name, due: m.targetDate })))
  const deps = collapseBlockers(blockers, projects.map((p) => p.id)).map((e) => ({ from: keyOf(org, 'project', e.from), to: keyOf(org, 'project', e.to), kind: 'blocks', count: e.count }))
  const updates = projects.filter((p) => p.lastUpdate).map((p) => ({ containerKey: keyOf(org, 'project', p.id), at: p.lastUpdate.at, health: p.lastUpdate.health, bodyExcerpt: p.lastUpdate.excerpt, url: p.lastUpdate.url }))
  return { containers, items, deps, updates }
}

/** Linear's workflow state types as a cycle board's four lanes (≤ 5 a board). */
export const CYCLE_LANES = Object.freeze([
  { key: 'todo', label: 'To do', types: ['triage', 'backlog', 'unstarted'] },
  { key: 'started', label: 'In progress', types: ['started'] },
  { key: 'completed', label: 'Done', types: ['completed'] },
  { key: 'canceled', label: 'Canceled', types: ['canceled'] },
])
export const cycleLaneOf = (stateType) => (CYCLE_LANES.find((l) => l.types.includes(stateType)) || CYCLE_LANES[0]).key

/** The first workflow state of a lane, for write-back (lowest position among the lane's types). */
export function firstStateOf(states, laneKey) {
  const lane = CYCLE_LANES.find((l) => l.key === laneKey)
  if (!lane) return null
  return [...(states || [])].filter((s) => lane.types.includes(s.type)).sort((a, b) => lane.types.indexOf(a.type) - lane.types.indexOf(b.type) || a.position - b.position)[0] || null
}

/** Identifiers named in commit messages and branch names (ENG-123), uppercase, unique, in order. */
export function identifiersIn(texts, { teams = null } = {}) {
  const out = []
  const allowed = teams ? new Set(teams.map((t) => String(t).toUpperCase())) : null
  for (const text of texts || []) {
    for (const m of String(text).toUpperCase().matchAll(/(?:^|[^A-Z0-9])([A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,6})(?![0-9])/g)) {
      const id = m[1]
      if (allowed && !allowed.has(id.split('-')[0])) continue
      if (!out.includes(id)) out.push(id)
    }
  }
  return out
}
