// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Releases slate (pure), from the releases the recipe recorded (ledger rows, newest kept):
//   a frame per release, oldest to newest: "acme/platform v1.4.0 · Nov 20"; inside it a note per
//     Linear issue its commits name ("ENG-201 Fix refunds", its project under it), grey when done in
//     Linear and orange when still open ("not closed in Linear"), and a note per project with its
//     progress at this release against the release before ("Fraud rules: 40% → 55% done")
//   a board "Shipped but not closed in Linear": a card per issue a release shipped that Linear still
//     has open, in its status lane; it leaves the board once Linear closes it
// Keys: xr:<repo>@<tag>:<issue>, so a late-linked commit adds one note and people's notes in a frame stay.
import { plain, count } from '../_shared/text.mjs'
import { STATE_COLORS, cycleLaneOf, dayWords } from '../_linear/workgraph.mjs'

export const RELEASE_LIMITS = Object.freeze({ issuesPerRelease: 35, drift: 24 })
export const releaseKey = (repo, tag) => `${repo}@${tag}`

/**
 * releases: [{ repo, tag, publishedAt, url, issues: [{ k, t, s, done, p, pn }], projects: { id: { n, pp, late } }, more, compared }]
 * (late: the release was already out when the recipe first read it, so its progress then is not known)
 * oldest first. live: Map(identifier → { done, s }) Linear's state now (overrides the recorded one).
 * workspace: the Linear workspace's URL key, for each issue's link.
 */
export function releaseSlate({ releases, live = new Map(), now, workspace = null }) {
  const nodes = []
  const frames = []
  const drift = []
  const previous = new Map() // repo → the release before, for "before → after"
  for (const r of releases) {
    const rk = releaseKey(r.repo, r.tag)
    const members = []
    for (const issue of r.issues) {
      const state = live.get(issue.k) || { done: issue.done, s: issue.s }
      const key = `xr:${rk}:${issue.k}`
      const words = [plain(`${issue.k} ${issue.t || ''}`, 120), issue.pn ? plain(issue.pn, 60) : null, state.done ? null : 'not closed in Linear'].filter(Boolean)
      nodes.push({ key, text: words.join('\n'), shape: 'roundedrectangle', colors: state.done ? STATE_COLORS.done : STATE_COLORS.drift, ...(workspace && { link: { url: `https://linear.app/${workspace}/issue/${issue.k}` } }) })
      members.push(key)
      if (!state.done && drift.length < RELEASE_LIMITS.drift) drift.push({ key: `xr:drift:${rk}:${issue.k}`, label: plain(`${issue.k} ${issue.t || ''} · ${r.tag}`, 80), lane: cycleLaneOf(state.s), issue: issue.k, tag: r.tag })
    }
    const before = previous.get(r.repo)
    for (const [id, p] of Object.entries(r.projects || {})) {
      const was = before?.projects?.[id]?.pp
      const key = `xr:${rk}:project:${id}`
      const change = Number.isFinite(p.pp) ? (Number.isFinite(was) ? `${was}% → ${p.pp}% done` : `${p.pp}% done`) : p.late ? 'progress at this release not recorded' : 'progress unknown'
      nodes.push({ key, text: plain(`${p.n}: ${change}`, 120), shape: 'rectangle', colors: STATE_COLORS.open })
      members.push(key)
    }
    if (!members.length) {
      const key = `xr:${rk}:none`
      nodes.push({ key, text: r.compared === false ? 'The first release here: nothing to compare it with.' : 'No Linear issues named in its commits.', shape: 'rectangle', colors: STATE_COLORS.done })
      members.push(key)
    }
    if (r.more) {
      const key = `xr:${rk}:more`
      nodes.push({ key, text: `${count(r.more, 'more issue', 'more issues')} not shown`, shape: 'rectangle' })
      members.push(key)
    }
    frames.push({ key: `release:${rk}`, text: plain(`${r.repo} ${r.tag}${r.publishedAt ? ` · ${dayWords(r.publishedAt.slice(0, 10), now)}` : ''}`, 120), members })
    previous.set(r.repo, r)
  }
  const board = {
    key: 'drift',
    component: 'team-board',
    title: 'Shipped but not closed in Linear',
    lanes: [{ key: 'todo', label: 'Not started' }, { key: 'started', label: 'In progress' }],
    cards: drift.map(({ key, label, lane }) => ({ key, label, lane: lane === 'started' ? 'started' : 'todo' })),
  }
  const legend = `Each release on GitHub, oldest to newest, with the Linear issues its commits name and each project's progress at that release against the one before. Orange: shipped, but still open in Linear (also on the board).`
  return {
    slate: { role: 'releases', name: 'Releases', graph: { nodes, edges: [], frames, layout: 'layered' }, boards: [board], notes: [{ key: 'legend', anchor: 'legend', text: plain(legend, 400) }] },
    drift,
  }
}
