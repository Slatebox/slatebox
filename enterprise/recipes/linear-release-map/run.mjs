// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One release-map run. Linear: the teams' keys (1 call), the issues new releases name (1 call per
// 50), and the state now of every issue still open on the map (1 call per 50). GitHub: each repo's
// newest releases (1 call a repo) and, once per new release, the compare with the release before
// it (1 call: its commit messages, at most 250). 0 tokens.
//
// A release is read once and kept in the recipe's ledger (release:<repo>@<tag>): the issues its
// commits name with their project and state then, and each project's progress then. Later runs only
// refresh whether those issues are closed in Linear, so the drift board empties as Linear catches up.
import { plain } from '../_shared/text.mjs'
import { identifiersIn } from '../_linear/workgraph.mjs'
import { RELEASE_LIMITS, releaseKey, releaseSlate } from './render.mjs'

const LIVE_MAX = 100

export default async function run(ctx) {
  const config = { releases: 6, prereleases: false, ...ctx.instance.config }
  const linear = ctx.vendor.linear
  const github = ctx.vendor.github
  const now = ctx.now()
  const cursor = ctx.instance.cursor || {}

  const teams = await linear.teams()
  const keys = teams.filter((t) => config.teams.includes(t.id)).map((t) => t.key)
  if (!keys.length) ctx.log('warn', 'no_teams', 'None of the picked Linear teams are visible to you now.')

  const shown = []
  const fresh = []
  for (const repo of config.repos) {
    const all = (await github.releases(repo)).filter((r) => config.prereleases || !r.prerelease)
    const newest = all.slice(0, config.releases)
    for (const [n, release] of newest.entries()) {
      const id = releaseKey(repo, release.tag)
      const kept = await ctx.ledger.get(`release:${id}`)
      if (kept) {
        shown.push(kept)
        continue
      }
      const before = all[n + 1] || null
      let messages = []
      if (before) messages = (await github.compare(repo, before.tag, release.tag)).commits.map((c) => c.message)
      fresh.push({ repo, tag: release.tag, publishedAt: release.publishedAt, url: release.url, ids: identifiersIn(messages, { teams: keys }), compared: Boolean(before) })
    }
  }

  // The new releases' issues, as Linear has them now (that is "then", for a release just published).
  const wanted = [...new Set(fresh.flatMap((r) => r.ids))]
  const found = wanted.length ? await linear.issuesByIdentifier(wanted) : []
  const byId = new Map(found.map((i) => [i.identifier, i]))
  const rows = []
  for (const r of fresh) {
    const issues = r.ids.map((k) => byId.get(k)).filter(Boolean)
    const projects = {}
    for (const i of issues) if (i.project && Object.keys(projects).length < 10) projects[i.project.id] = { n: plain(i.project.name, 60), pp: i.project.progress }
    const record = {
      repo: r.repo, tag: r.tag, publishedAt: r.publishedAt, url: r.url, compared: r.compared,
      issues: issues.slice(0, RELEASE_LIMITS.issuesPerRelease).map((i) => ({ k: i.identifier, t: plain(i.title, 70), s: i.state.type, done: i.done, ...(i.project && { p: i.project.id, pn: plain(i.project.name, 60) }) })),
      more: Math.max(0, issues.length - RELEASE_LIMITS.issuesPerRelease),
      projects,
    }
    rows.push({ key: `release:${releaseKey(r.repo, r.tag)}`, kind: 'release', data: record })
    shown.push(record)
    ctx.emit('release_map.updated', { repo: r.repo, tag: r.tag, issues: issues.length, drift: issues.filter((i) => !i.done).length })
  }
  if (rows.length) await ctx.ledger.upsert(rows)

  // Every issue still open on the map: is it closed in Linear now?
  const open = [...new Set(shown.flatMap((r) => r.issues.filter((i) => !i.done).map((i) => i.k)))].filter((k) => !byId.has(k)).slice(0, LIVE_MAX)
  const live = new Map(found.map((i) => [i.identifier, { done: i.done, s: i.state.type }]))
  if (open.length) for (const i of await linear.issuesByIdentifier(open)) live.set(i.identifier, { done: i.done, s: i.state.type })

  const workspace = cursor.workspace || found.map((i) => /^https:\/\/linear\.app\/([a-z0-9-]+)\//i.exec(i.url || '')?.[1]).find(Boolean) || null
  const ordered = shown.sort((a, b) => String(a.publishedAt || '').localeCompare(String(b.publishedAt || '')) || a.tag.localeCompare(b.tag))
  const drawn = releaseSlate({ releases: ordered, live, now, workspace })
  const seen = new Set(cursor.drift || [])
  for (const d of drawn.drift.filter((x) => !seen.has(`${x.tag}:${x.issue}`)).slice(0, 20)) ctx.emit('release_map.drift', { issue: d.issue, tag: d.tag })
  ctx.setCursor({ workspace, drift: drawn.drift.map((d) => `${d.tag}:${d.issue}`) })
  return {
    desired: { slates: [drawn.slate] },
    summary: `${ordered.length} releases, ${fresh.length} new; ${drawn.drift.length} shipped but not closed in Linear.`,
    source: 'GitHub and Linear',
  }
}
