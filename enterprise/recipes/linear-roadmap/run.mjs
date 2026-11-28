// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One roadmap run: the teams' projects (1 call per 50, with each one's latest update and milestones;
// with initiatives when grouped by them and Linear allows it), the open issues that block another
// project's (1 call per 100), then the three slates. 0 tokens, unless the weekly summary is on: one
// call over the update excerpts (at most 25 of 280 characters), once a week.
//
// Between runs the cursor keeps, per project, the target date Linear showed first and last (a slip
// is today's target past the first one), a short signature (what changed, for the events), and the
// board keys drawn, with where each card and board was drawn (a card stays on its board, a board on
// its slate). A project whose target date changed since the last run is reclaimed: a card a
// person moved follows Linear again. The edges seen, for roadmap.new_blocker.
import { hashOf, plain } from '../_shared/text.mjs'
import { daysBetween, isClosedProject, quarterOf, nextQuarter, todayIso } from '../_linear/workgraph.mjs'
import { dependencySlate, healthSlate, roadmapPlacement, roadmapSlates } from './render.mjs'

const SUMMARY_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string', maxLength: 600 } } })
const WEEK = 7 * 86400000

export default async function run(ctx) {
  const config = { groupBy: 'team', blockers: true, staleDays: 14, summary: false, ...ctx.instance.config }
  const linear = ctx.vendor.linear
  const now = ctx.now()
  const cursor = ctx.instance.cursor || {}

  const wantInitiatives = config.groupBy === 'initiative'
  const got = await linear.projects(config.teams, { initiatives: wantInitiatives })
  let by = config.groupBy
  if (wantInitiatives && !got.initiatives) {
    by = 'team'
    ctx.log('warn', 'no_initiatives', 'Linear shows initiatives only to an admin\'s install for the workspace, so projects are grouped by team.')
  }
  if (!got.complete) ctx.log('warn', 'many_projects', 'More than 200 open projects: the first 200 are drawn.')
  const projects = got.projects.slice(0, 200)
  // "Today" (lanes, stale updates) is the day in the first picked team's time zone, as Linear has it.
  const zone = projects.flatMap((p) => p.teams || []).find((t) => config.teams.includes(t.id) && t.timezone)?.timezone || null
  const today = todayIso(now, zone)
  // The workspace's URL key (linear.app/<key>/...) names its notes' keys, the same every run.
  const org = cursor.org || projects.map((p) => /^https:\/\/linear\.app\/([a-z0-9-]+)\//i.exec(p.url || '')?.[1]).find(Boolean) || 'ws'
  const open = projects.filter((p) => !isClosedProject(p))

  let relations = []
  if (config.blockers && open.length) {
    const found = await linear.blockers(open.map((p) => p.id))
    relations = found.relations
    if (!found.complete) ctx.log('warn', 'many_blockers', 'Many open issues: the blockers of the first 600 are drawn.')
  }

  // What changed since the last run: target dates (slips and reclaims) and each project's signature.
  const first = { ...(cursor.firstTarget || {}) }
  const last = cursor.lastTarget || {}
  const slips = {}
  const reclaim = new Set()
  const slipped = []
  for (const p of open) {
    if (!(p.id in first)) first[p.id] = p.targetDate || null
    if (p.targetDate && first[p.id] && p.targetDate > first[p.id]) slips[p.id] = daysBetween(first[p.id], p.targetDate)
    if (p.id in last && last[p.id] !== (p.targetDate || null)) {
      reclaim.add(p.id)
      if (last[p.id] && p.targetDate && p.targetDate > last[p.id]) slipped.push({ project: p.id, from: last[p.id], to: p.targetDate, url: p.url || '' })
    }
  }
  const signature = Object.fromEntries(projects.map((p) => [p.id, hashOf([p.name, p.state, p.targetDate, p.health, p.lastUpdate?.at], 10)]))
  const before = cursor.sig || {}
  const added = projects.filter((p) => !(p.id in before)).length
  const changed = projects.filter((p) => p.id in before && before[p.id] !== signature[p.id]).length
  const removed = Object.keys(before).filter((id) => !(id in signature)).length

  const quarter = quarterOf(today)
  const quarterLine = `This quarter is ${quarter.label}; next is ${nextQuarter(quarter).label}.`
  const teamNames = [...new Set(projects.flatMap((p) => p.teams || []).filter((t) => config.teams.includes(t.id)).map((t) => t.key))]
  const roadmap = roadmapSlates({ org, projects, by, today, now, slips, reclaim, teams: teamNames, groupsBefore: cursor.boards || [], quarterLine, placed: cursor.placed || {}, slateOfBoard: cursor.slateOfBoard || {} })
  const deps = dependencySlate({ org, projects, blockers: relations, now })

  // The weekly summary: once a week at most, over the update excerpts only.
  let summary = cursor.summary || null
  let summaryAt = cursor.summaryAt || 0
  if (config.summary && now - summaryAt >= WEEK) {
    const excerpts = open.filter((p) => p.lastUpdate?.excerpt).sort((a, b) => String(b.lastUpdate.at).localeCompare(String(a.lastUpdate.at))).slice(0, 25)
    if (excerpts.length) {
      const answer = await ctx.ai.json({
        purpose: 'roadmap_week', schema: SUMMARY_SCHEMA, maxIn: 6000, maxOut: 300,
        prompt: { task: 'Write three plain sentences on how the roadmap stands this week, from these project updates. Name the projects at risk.', updates: excerpts.map((p) => ({ project: p.name, health: p.health, update: ctx.quarantine(p.lastUpdate.excerpt) })) },
      })
      if (answer?.summary) {
        summary = plain(answer.summary, 600)
        summaryAt = now
      }
    }
  }
  if (!config.summary) summary = null
  const health = healthSlate({ org, projects, today, staleDays: config.staleDays, summary })

  // Events: slips, stale updates (once per project until it posts again), new blocking edges.
  for (const s of slipped.slice(0, 20)) ctx.emit('roadmap.slipped', s)
  const staleSeen = new Set(cursor.stale || [])
  for (const s of health.stale.filter((x) => !staleSeen.has(x.id)).slice(0, 20)) ctx.emit('roadmap.stale_update', { project: s.id, days: s.days })
  const edgeIds = deps.edges.map((e) => `${e.from}->${e.to}`)
  if (cursor.edges) for (const e of deps.edges.filter((x) => !cursor.edges.includes(`${x.from}->${x.to}`)).slice(0, 20)) ctx.emit('roadmap.new_blocker', { from: e.from, to: e.to, issues: e.count })
  if (added || changed || removed) ctx.emit('roadmap.updated', { slates: ['roadmap', 'dependencies', 'health'], added, changed, removed })

  ctx.setCursor({
    org,
    firstTarget: Object.fromEntries(Object.entries(first).filter(([id]) => id in signature)),
    lastTarget: Object.fromEntries(open.map((p) => [p.id, p.targetDate || null])),
    sig: signature,
    boards: roadmap.flatMap((s) => s.boards.filter((b) => b.cards.length).map((b) => b.key)),
    ...roadmapPlacement(roadmap),
    stale: health.stale.map((s) => s.id),
    edges: edgeIds,
    summary,
    summaryAt,
  })
  return {
    desired: { slates: [...roadmap, deps.slate, health.slate] },
    summary: `${open.length} open projects, ${deps.edges.length} blocking ${deps.edges.length === 1 ? 'link' : 'links'}, ${health.stale.length} stale ${health.stale.length === 1 ? 'update' : 'updates'}.`,
    source: 'Linear',
    stats: { projects: projects.length },
  }
}
