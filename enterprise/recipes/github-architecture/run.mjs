// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// G1 run: for each repository the trigger names (a push names one; a schedule, Run now or an
// inbound call names all), read its facts at the default branch's head as cheaply as possible
// (scan.mjs), build the model, compare it with the last one, and say what the project should hold.
// Model use is optional and small: a short name per module whose files changed, from its file list
// only (never code), within the run's token budget; when the model is refused or the budget is used,
// the run is partial and every slate is still complete (names fall back to folders, earlier names stay).
//
// Ledger rows (this instance's): facts:<repo> (paths and names), model:<repo>, labels:<repo>,
// chg:<repo>:<sha>:<what> (the What changed cards). The cursor keeps shas and deploy stamps.
import { buildModel, diffModels } from '../_github-code/model.mjs'
import { factsAt } from '../_github-code/scan.mjs'
import { commitUrl, shortSha } from '../_github-code/look.mjs'
import { apiSurface, changeBoards, changeRows, drillDown, moduleGraph, serviceMap } from './render.mjs'

const LABEL_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['label', 'purpose'],
  properties: { label: { type: 'string', maxLength: 80 }, purpose: { type: 'string', maxLength: 200 } },
})
const MAX_LABEL_CALLS = 24
const MERGE_LINE = /^Merge pull request #(\d+) from \S+(?:\n+([^\n]+))?/

/** The repositories a trigger is about. */
function reposOf(trigger, config) {
  const all = config.repos || []
  if (trigger?.kind === 'vendor' && trigger.event === 'github.push') {
    const named = [trigger.repo, ...(trigger.repos || [])].filter(Boolean)
    return all.filter((r) => named.includes(r))
  }
  return all
}

const fileHash = (files) => {
  let h = 0
  for (const f of files.join('\n')) h = (Math.imul(h, 31) + f.charCodeAt(0)) | 0
  return (h >>> 0).toString(16)
}

async function nameModules(ctx, model, labels, changedModules) {
  const out = { ...labels }
  let refused = false
  let calls = 0
  for (const mod of model.modules) {
    const hash = fileHash(mod.files)
    if (out[mod.key]?.hash === hash) continue
    if (!changedModules.has(mod.key) && out[mod.key]) continue
    if (refused || calls >= MAX_LABEL_CALLS) {
      refused = true
      continue
    }
    calls += 1
    const files = mod.files.slice(0, 40).map((f) => (mod.path ? f.slice(mod.path.length + 1) : f))
    const result = await ctx.ai.json({
      purpose: 'module_label',
      schema: LABEL_SCHEMA,
      maxIn: 1500,
      maxOut: 80,
      prompt: { task: 'Name this code module in 2 to 4 words and say its purpose in one short sentence, from its file names only.', module: mod.name, path: mod.path, repo: model.repo, files, owner: mod.owner },
    })
    if (!result) {
      refused = true
      continue
    }
    const label = `${result.label}`.split(/\s+/).slice(0, 12).join(' ').trim()
    if (label) out[mod.key] = { label, purpose: `${result.purpose ?? ''}`.slice(0, 200), hash }
  }
  return { labels: out, partial: refused }
}

export default async function run(ctx) {
  const config = { views: {}, colorByOwner: true, labels: true, ...ctx.instance.config }
  const views = { serviceMap: true, modules: true, api: true, ...config.views }
  const trigger = ctx.run.trigger || {}
  const now = ctx.now()
  const cursor = { repos: {}, deploys: {}, ...(ctx.instance.cursor || {}) }
  const github = ctx.vendor.github
  const stats = { repos: 0, full: 0, incremental: 0, same: 0 }
  const writes = []
  let partial = null
  const touched = reposOf(trigger, config)

  for (const repo of touched) {
    const head = await github.head(repo)
    const stored = (await ctx.ledger.get(`facts:${repo}`)) ?? null
    const scan = await factsAt(github, repo, head.sha, { config, stored })
    stats.repos += 1
    stats[scan.mode] += 1
    if (scan.mode === 'same' && (await ctx.ledger.get(`model:${repo}`))) {
      ctx.log('info', 'unchanged', `${repo} is at ${shortSha(head.sha)} as before`)
      continue
    }
    const model = { ...buildModel({ repo, sha: head.sha, facts: scan.facts, context: scan.context, config }), branch: head.defaultBranch, at: now }
    const before = (await ctx.ledger.get(`model:${repo}`)) ?? null
    const delta = diffModels(before, model)
    // A module renamed in code (the same files under a new folder): its note takes the person's
    // words and colors from the old one (reconcile reads carryFrom once).
    model.renamed = before ? delta.renamed : []
    await ctx.ledger.upsert([
      { key: `facts:${repo}`, kind: 'facts', data: { sha: scan.sha, configKey: scan.configKey, facts: scan.facts, context: scan.context }, sourceRef: commitUrl(repo, head.sha) },
      { key: `model:${repo}`, kind: 'model', data: model, sourceRef: commitUrl(repo, head.sha) },
    ])
    if (scan.skipped?.length) ctx.log('warn', 'files_skipped', `${scan.skipped.length} files over 1 MB in ${repo} were not read`)
    ctx.log('info', `scan_${scan.mode}`, `${repo} @ ${shortSha(head.sha)}: ${model.modules.length} modules, ${model.services.length} services, ${model.endpoints.length} endpoints`)

    // What changed, when there was a before to compare with (a first scan is not a change).
    if (before) {
      const merged = []
      for (const c of scan.commits || []) {
        const m = MERGE_LINE.exec(c.message)
        if (m) merged.push({ number: Number(m[1]), title: (m[2] || '').slice(0, 120) })
      }
      const rows = changeRows(repo, head.sha, delta, { at: now, before, after: model, merged })
      if (rows.length) await ctx.ledger.upsert(rows)
      for (const e of delta.added.moduleEdges.slice(0, 20)) ctx.emit('architecture.new_dependency', { repo, from: e.from, to: e.to })
      for (const c of delta.newCycles.slice(0, 10)) ctx.emit('architecture.cycle_detected', { repo, modules: c })
      for (const r of delta.renamed) ctx.emit('architecture.renamed', { repo, from: r.from, to: r.to, overlap: r.overlap })
      if (!delta.empty)
        ctx.emit('architecture.updated', {
          repo,
          sha: head.sha,
          // flat: an event's data is names and numbers (enterprise/common/recipes/events.mjs)
          modulesAdded: delta.added.modules.length, edgesAdded: delta.added.moduleEdges.length, servicesAdded: delta.added.services.length, endpointsAdded: delta.added.endpoints.length,
          modulesRemoved: delta.removed.modules.length, edgesRemoved: delta.removed.moduleEdges.length, servicesRemoved: delta.removed.services.length, endpointsRemoved: delta.removed.endpoints.length,
        })
      if (config.checkRun && trigger.event === 'github.push') {
        const changedModules = delta.added.modules.length + delta.removed.modules.length
        writes.push({
          kind: 'github.check_run',
          target: { repo, headSha: head.sha },
          body: {
            name: 'Slatebox architecture',
            title: delta.empty ? 'No architectural change' : 'Architecture changed',
            summary: `${changedModules} module${changedModules === 1 ? '' : 's'} changed, ${delta.added.moduleEdges.length} new dependenc${delta.added.moduleEdges.length === 1 ? 'y' : 'ies'}, ${model.cycles.length} cycle${model.cycles.length === 1 ? '' : 's'}.`,
            detailsSlate: { role: 'service-map', key: 'service-map' },
          },
          key: `check:${repo}:${head.sha}`,
        })
      }
    }

    // Names for modules whose files changed (or that have none yet).
    if (config.labels !== false && ctx.ai) {
      const labelsNow = (await ctx.ledger.get(`labels:${repo}`)) ?? {}
      const changed = new Set([...delta.added.modules.map((m) => m.key), ...model.modules.filter((m) => !before || scan.changed.some((p) => m.files.includes(p))).map((m) => m.key)])
      const named = await nameModules(ctx, model, labelsNow, changed)
      if (named.partial) partial = 'ai_refused'
      if (JSON.stringify(named.labels) !== JSON.stringify(labelsNow)) await ctx.ledger.upsert([{ key: `labels:${repo}`, kind: 'labels', data: named.labels }])
    }
    cursor.repos[repo] = { sha: head.sha, at: now }
  }

  // An inbound deploy stamp ({ env, version }) lands on the service map's legend.
  if (trigger.kind === 'inbound' && trigger.input?.env && trigger.input?.version) {
    cursor.deploys[trigger.input.env] = { version: trigger.input.version, service: trigger.input.service ?? null, at: now }
  }
  ctx.setCursor(cursor)

  // What the project holds: every repository's slates, from the models kept (no vendor calls).
  const models = []
  const labels = {}
  for (const repo of config.repos) {
    const m = await ctx.ledger.get(`model:${repo}`)
    if (!m) continue
    models.push(m)
    Object.assign(labels, (await ctx.ledger.get(`labels:${repo}`)) ?? {})
  }
  const slates = []
  if (views.serviceMap) slates.push(serviceMap(models, { deploys: cursor.deploys, now }))
  for (const m of models) {
    if (views.modules) {
      slates.push(moduleGraph(m, { labels, colorByOwner: config.colorByOwner !== false, now }))
      for (const mod of m.modules.filter((x) => x.drill && m.drills[x.key])) slates.push(drillDown(m, mod))
    }
    if (views.api) slates.push(apiSurface(m, { now }))
  }
  slates.push(...changeBoards(await ctx.ledger.since(now - 365 * 86400000, 'change'), { now }))
  const summary = models.length
    ? `${models.map((m) => `${m.repo} @ ${shortSha(m.sha)}`).join(', ')}: ${models.reduce((n, m) => n + m.modules.length, 0)} modules, ${models.reduce((n, m) => n + m.services.length, 0)} services, ${models.reduce((n, m) => n + m.endpoints.length, 0)} endpoints.`
    : 'No repository read yet.'
  return { desired: { slates, ...(partial && { partial }) }, writes, summary, stats }
}
