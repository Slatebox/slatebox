// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// G1's models as the slates the project keeps (a DesiredSet, design B.2): by key, never by place,
// so a run says what should be there and reconcile changes only what differs.
//   service-map      one slate: a frame per repository, a layered diagram by tier (ways in, services,
//                    queues, stores, outside), connections labeled with their protocol
//   modules/<repo>   the modules (at most 60), import lines as wide as their count, cycles in red,
//                    colors by owner; each module with more than 8 files links to its drill-down
//   drill/<module>   one module's folders (at most 80) and the imports between them
//   api/<repo>       a frame per tag or resource with its endpoints (each linking to its file and
//                    line on GitHub), and a column of the services that call it
//   changes          a lane board: This week, Last week, Earlier (24 cards; older ones on the archive)
import { blobUrl, commitUrl, IMPACT, KIND_COLORS, LINE, MODULE_COLOR, ownerColors, SHAPES, shortSha, TIERS, weightWidth } from '../_github-code/look.mjs'

const DAY = 86400000
// Links name the default branch, not a commit: a push changes a note's link only when that note's own
// file or line moved.
const refOf = (m) => m.branch || m.sha
export const BOARD_CARDS = 24
const ARCHIVE_NOTES = 200

// The legend names the commit, never a time: a run that changes nothing changes no note.
function legend(models) {
  return models.map((m) => ({ key: `legend:${m.repo}`, text: `Synced from ${m.repo} @ ${shortSha(m.sha)}`, ...(m.sha && { link: { url: commitUrl(m.repo, m.sha) } }), anchor: 'legend' }))
}

export function serviceMap(models, { deploys = {}, now = Date.now() } = {}) {
  const nodes = []
  const edges = []
  const frames = []
  const notes = legend(models)
  for (const m of models) {
    const members = []
    for (const s of m.services) {
      members.push(s.key)
      nodes.push({ key: s.key, text: s.label, shape: SHAPES[s.kind] || SHAPES.service, colors: KIND_COLORS[s.kind] || KIND_COLORS.service, group: TIERS[s.kind] ?? 1, ...(s.file && refOf(m) && { link: { url: blobUrl(m.repo, refOf(m), s.file) } }) })
    }
    for (const e of m.serviceEdges) edges.push({ from: e.from, to: e.to, ...(e.protocol && { label: e.protocol }) })
    if (members.length) frames.push({ key: `repo:${m.repo}`, text: m.repo, members })
    for (const w of m.warnings.filter((x) => /^Helm/.test(x))) notes.push({ key: `warn:${m.repo}:${w.slice(0, 60)}`, text: w, anchor: 'legend' })
  }
  if (!nodes.length) notes.push({ key: 'empty', text: 'No services found yet: the map is drawn from docker-compose, Kubernetes, Terraform, Helm and serverless files.', anchor: 'top-left' })
  for (const [env, d] of Object.entries(deploys).sort()) notes.push({ key: `deploy:${env}`, text: `Deployed ${d.version} to ${env}${d.service ? ` (${d.service})` : ''} · ${new Date(d.at).toISOString().slice(0, 10)}`, anchor: 'legend' })
  return { role: 'service-map', key: 'service-map', name: 'Service map', graph: { nodes, edges, frames, layout: 'layered' }, notes }
}

export function moduleGraph(m, { labels = {}, colorByOwner = true, now = Date.now() } = {}) {
  const colors = colorByOwner ? ownerColors(m.modules.map((x) => x.owner)) : new Map()
  const carry = new Map((m.renamed || []).map((r) => [r.to, r.from]))
  const nodes = m.modules.map((mod) => {
    const label = labels[mod.key]?.label
    return {
      key: mod.key,
      ...(carry.has(mod.key) && { carryFrom: carry.get(mod.key) }),
      text: label ? `${label}\n${mod.name}` : mod.name,
      shape: SHAPES.module,
      colors: (mod.owner && colors.get(mod.owner)) || MODULE_COLOR,
      ...(mod.drill ? { link: { slate: { role: 'drill', key: mod.key } } } : mod.path && refOf(m) ? { link: { url: `https://github.com/${m.repo}/tree/${refOf(m)}/${mod.path}` } } : {}),
    }
  })
  const edges = m.moduleEdges.map((e) => ({ from: e.from, to: e.to, style: e.cycle ? { ...LINE.cycle } : { lineWidth: weightWidth(e.weight) }, ...(e.weight > 1 && { label: `${e.weight}` }) }))
  const frames = []
  if (m.externals.length) {
    for (const x of m.externals) nodes.push({ key: x.key, text: `${x.name}\n${x.fanIn} imports`, shape: 'hexagon', colors: KIND_COLORS.external })
    frames.push({ key: `outside:${m.repo}`, text: 'Outside packages', members: m.externals.map((x) => x.key) })
  }
  const notes = legend([m])
  for (const c of m.cycles) notes.push({ key: `cycle:${c.join('|')}`, text: `Import cycle: ${c.map((k) => m.modules.find((x) => x.key === k)?.name ?? k).join(' → ')}`, anchor: 'legend' })
  const name = (k) => m.modules.find((x) => x.key === k)?.name ?? k
  if (m.hotspots.fanIn.length) notes.push({ key: 'hot:in', text: `Most depended on: ${m.hotspots.fanIn.map((h) => `${name(h.key)} (${h.count})`).join(', ')}`, anchor: 'legend' })
  if (m.hotspots.fanOut.length) notes.push({ key: 'hot:out', text: `Depends on most: ${m.hotspots.fanOut.map((h) => `${name(h.key)} (${h.count})`).join(', ')}`, anchor: 'legend' })
  if (colorByOwner && colors.size) notes.push({ key: 'owners', text: `Owners: ${[...colors.keys()].join(', ')}`, anchor: 'legend' })
  return { role: 'modules', key: m.repo, name: `Modules — ${m.repo}`, graph: { nodes, edges, frames, layout: 'layered' }, notes }
}

export function drillDown(m, mod) {
  const drill = m.drills[mod.key]
  return {
    role: 'drill',
    key: mod.key,
    name: `Modules — ${m.repo} › ${mod.name}`,
    folder: ['Modules'],
    graph: {
      nodes: drill.groups.map((g) => ({ key: g.key, text: `${g.name}\n${g.files} file${g.files === 1 ? '' : 's'}`, shape: SHAPES.module, colors: MODULE_COLOR, ...(refOf(m) && { link: { url: `https://github.com/${m.repo}/tree/${refOf(m)}/${mod.path ? `${mod.path}/` : ''}${g.name}` } }) })),
      edges: drill.edges.map((e) => ({ from: e.from, to: e.to, style: { lineWidth: weightWidth(e.weight) } })),
      layout: 'layered',
    },
    notes: [{ key: 'back', text: `Part of ${mod.name} in ${m.repo}`, link: { slate: { role: 'modules', key: m.repo } }, anchor: 'top-left' }],
  }
}

export function apiSurface(m, { now = Date.now() } = {}) {
  const groups = new Map()
  for (const e of m.endpoints) (groups.get(e.group) || groups.set(e.group, []).get(e.group)).push(e)
  const nodes = []
  const frames = []
  for (const [group, list] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const members = []
    for (const e of list) {
      members.push(e.key)
      nodes.push({ key: e.key, text: `${e.method} ${e.path}`, shape: 'rectangle', colors: KIND_COLORS.service, ...(e.file && refOf(m) && { link: { url: blobUrl(m.repo, refOf(m), e.file, e.line) } }) })
    }
    frames.push({ key: `group:${m.repo}:${group}`, text: group, members })
  }
  // Consumers: services that call a service built from the module holding the endpoints.
  const edges = []
  const consumers = []
  const owning = new Set(m.services.filter((s) => s.module && m.endpoints.some((e) => e.module === s.module)).map((s) => s.key))
  for (const se of m.serviceEdges) {
    if (!owning.has(se.to)) continue
    const caller = m.services.find((s) => s.key === se.from)
    if (!caller) continue
    const key = `consumer:${caller.key}`
    if (!consumers.includes(key)) {
      consumers.push(key)
      nodes.push({ key, text: caller.label, shape: SHAPES[caller.kind] || SHAPES.service, colors: KIND_COLORS.external })
    }
    for (const f of frames) edges.push({ from: key, to: f.key })
  }
  if (consumers.length) frames.push({ key: `consumers:${m.repo}`, text: 'Consumers', members: consumers })
  const notes = legend([m])
  if (!nodes.length) notes.push({ key: 'empty', text: 'No endpoints found yet: the surface is read from OpenAPI, GraphQL and .proto files and from routes in code.', anchor: 'top-left' })
  return { role: 'api', key: m.repo, name: `API surface — ${m.repo}`, graph: { nodes, edges, frames, layout: 'grid' }, notes }
}

/** The lane a change goes in, by age. */
const laneOf = (at, now) => (now - at < 7 * DAY ? 'this-week' : now - at < 14 * DAY ? 'last-week' : 'earlier')

/** The "What changed" board and its archive, from the ledger's change rows (newest first). */
export function changeBoards(rows, { now = Date.now() } = {}) {
  const sorted = [...rows].sort((a, b) => b.data.at - a.data.at || (a.key < b.key ? -1 : 1))
  const onBoard = sorted.slice(0, BOARD_CARDS)
  const older = sorted.slice(BOARD_CARDS, BOARD_CARDS + ARCHIVE_NOTES)
  const board = {
    role: 'changes',
    key: 'changes',
    name: 'What changed',
    boards: [{
      key: 'changes',
      component: 'team-board',
      title: 'What changed',
      lanes: [{ key: 'this-week', label: 'This week' }, { key: 'last-week', label: 'Last week' }, { key: 'earlier', label: 'Earlier' }],
      cards: onBoard.map((r) => ({ key: r.key, label: r.data.label, lane: laneOf(r.data.at, now), ...(r.data.link && { link: { url: r.data.link } }), fields: { repo: r.data.repo } })),
    }],
  }
  const archive = {
    role: 'changes-archive',
    key: 'changes-archive',
    name: 'What changed — archive',
    graph: { nodes: older.map((r) => ({ key: r.key, text: `${new Date(r.data.at).toISOString().slice(0, 10)} · ${r.data.label}`, shape: 'rectangle', colors: IMPACT.blast, ...(r.data.link && { link: { url: r.data.link } }) })), edges: [], layout: 'grid' },
    notes: [{ key: 'about', text: 'Older changes move here from the What changed board.', anchor: 'top-left' }],
  }
  return older.length ? [board, archive] : [board]
}

/** The change cards a model delta makes (labels in plain words, each linking to its commit). */
export function changeRows(repo, sha, delta, { at, before, after, merged = [] }) {
  const name = (key, model) => model?.modules.find((x) => x.key === key)?.name ?? model?.services.find((x) => x.key === key)?.label ?? key.split(':').pop()
  const link = sha ? commitUrl(repo, sha) : null
  const rows = []
  const add = (id, label) => rows.push({ key: `chg:${repo}:${shortSha(sha)}:${id}`, kind: 'change', data: { label, at, repo, link }, sourceRef: link })
  for (const r of delta.renamed) add(`ren:${r.from}`, `Renamed module ${name(r.from, before)} → ${name(r.to, after)}`)
  const renamedFrom = new Set(delta.renamed.map((r) => r.from))
  const renamedTo = new Set(delta.renamed.map((r) => r.to))
  for (const x of delta.added.modules) if (!renamedTo.has(x.key)) add(`mod+:${x.key}`, `Added module ${x.name}`)
  for (const x of delta.removed.modules) if (!renamedFrom.has(x.key)) add(`mod-:${x.key}`, `Removed module ${x.name}`)
  for (const e of delta.added.moduleEdges) add(`dep+:${e.from}->${e.to}`, `New dependency ${name(e.from, after)} → ${name(e.to, after)}`)
  for (const e of delta.removed.moduleEdges) add(`dep-:${e.from}->${e.to}`, `Dropped dependency ${name(e.from, before)} → ${name(e.to, before)}`)
  for (const c of delta.newCycles) add(`cyc:${c.join('|')}`, `Import cycle introduced: ${c.map((k) => name(k, after)).join(' → ')}`)
  for (const s of delta.added.services) add(`svc+:${s.key}`, `Added service ${s.label}`)
  for (const s of delta.removed.services) add(`svc-:${s.key}`, `Removed service ${s.label}`)
  for (const e of delta.added.endpoints) add(`api+:${e.key}`, `New endpoint ${e.method} ${e.path}`)
  for (const e of delta.removed.endpoints) add(`api-:${e.key}`, `Removed endpoint ${e.method} ${e.path}`)
  for (const pr of merged) rows.push({ key: `chg:${repo}:pr:${pr.number}`, kind: 'change', data: { label: `Merged #${pr.number}${pr.title ? ` ${pr.title}` : ''}`, at, repo, link: `https://github.com/${repo}/pull/${pr.number}` }, sourceRef: `https://github.com/${repo}/pull/${pr.number}` })
  return rows
}
