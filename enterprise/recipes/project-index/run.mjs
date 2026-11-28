// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One run of the project index: the project's slates (ctx.project.listSlates, the projects API's
// listSlates with folders) and which recipe keeps which (ctx.project.recipes), as a note per slate
// in a frame per folder, newest first. The index never lists itself. 0 tokens, 0 vendor calls.
import { count, plain, shortDate } from '../_shared/text.mjs'

export const INDEX_LIMITS = Object.freeze({ slates: 600 })

export default async function run(ctx) {
  if (typeof ctx.project?.listSlates !== 'function') throw Object.assign(new Error('The project index needs the project\'s slate list.'), { code: 'unsupported' })
  const config = ctx.instance.config || {}
  const staleDays = config.stale || 30
  const [slates, recipes, folders] = await Promise.all([
    ctx.project.listSlates({ folders: true }),
    typeof ctx.project.recipes === 'function' ? ctx.project.recipes() : [],
    typeof ctx.project.folders === 'function' ? ctx.project.folders() : [],
  ])
  const self = new Set(Object.values((recipes || []).find((r) => r.id === ctx.instance.id)?.slateMap || {}))
  const keeper = new Map()
  for (const r of recipes || []) for (const slateId of Object.values(r.slateMap || {})) if (!keeper.has(slateId)) keeper.set(slateId, r.agentName || r.name)
  const folderName = new Map((folders || []).map((f) => [f._id, f.name]))
  const listed = (slates || []).filter((s) => !self.has(s._id)).sort((a, b) => new Date(b.lastSaved) - new Date(a.lastSaved)).slice(0, INDEX_LIMITS.slates)

  const nodes = []
  const byFolder = new Map()
  for (const s of listed) {
    const by = keeper.get(s._id)
    const days = Math.floor((ctx.now() - new Date(s.lastSaved).getTime()) / 86400000)
    const key = 'slate:' + s._id
    nodes.push({
      key,
      text: plain(`${s.name || 'Untitled slate'} · changed ${shortDate(s.lastSaved)}${by ? ' · kept by ' + by : ''}${days >= staleDays ? ' · not changed in ' + count(days, 'day', 'days') : ''}`, 200),
      ...(s.url && { link: s.url }),
    })
    const folder = s.projectId && s.projectId !== ctx.instance.projectId ? s.projectId : 'root'
    if (!byFolder.has(folder)) byFolder.set(folder, [])
    byFolder.get(folder).push(key)
  }
  const frames = [...byFolder].map(([folder, members]) => ({ key: 'folder:' + folder, text: folder === 'root' ? 'In this project' : plain(folderName.get(folder) || 'Folder', 80), members }))
  return {
    desired: { slates: [{ role: 'index', key: 'index', name: 'Project index', graph: { nodes, edges: [], frames, layout: 'grid' }, notes: [{ key: 'legend', anchor: 'legend', text: 'Every slate in this project, newest first. Updated every hour.' }] }] },
    summary: `${count(listed.length, 'slate', 'slates')} listed`,
    stats: { slates: listed.length },
  }
}
