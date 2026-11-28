// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// G2 run: for each pull request the trigger names (at most 5 a run), read the base's facts (kept
// between runs, scan.mjs) and the head's changed files, compare the two models, and keep one slate
// per pull request; propose one comment (the runtime posts it only under the permission, else it
// becomes an action card). Skipped: the skip label, drafts (unless asked), and pull requests under
// the size floor with no manifest or infrastructure change. A merged pull request's slate moves to
// Pull requests › Merged; a closed one is deleted after 14 days unless a person edited it.
import { contextPath } from '../_github-code/context.mjs'
import { buildModel, diffModels } from '../_github-code/model.mjs'
import { factsAt, headFacts } from '../_github-code/scan.mjs'
import { match as isCompose } from '../_github-code/extract/compose.mjs'
import { match as isHelm } from '../_github-code/extract/helm.mjs'
import { match as isTerraform } from '../_github-code/extract/terraform.mjs'
import { match as isServerless } from '../_github-code/extract/serverless.mjs'
import { match as isOpenapi } from '../_github-code/extract/openapi.mjs'
import { impactOf, prComment, prSlate } from './render.mjs'

const PER_RUN = 5
const SUMMARY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['bullets'],
  properties: { bullets: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 200 } } },
})
const isInfra = (path) => contextPath(path) || isCompose(path) || isHelm(path) || isTerraform(path) || isServerless(path) || isOpenapi(path) || /(^|\/)(k8s|kubernetes|deploy|manifests)\/.*\.ya?ml$/.test(path)

/** The pull requests a trigger names: [{ repo, number, action }]. */
function pullsOf(trigger) {
  const list = []
  const take = (t) => t?.repo && Number.isInteger(t.number) && list.push({ repo: t.repo, number: t.number, action: t.action ?? null })
  if (trigger?.kind === 'manual' || trigger?.kind === 'inbound') take(trigger.input || trigger.data || {})
  else {
    take(trigger)
    for (const p of trigger?.prs || []) take(p)
  }
  const seen = new Set()
  return list.filter((p) => !seen.has(`${p.repo}#${p.number}`) && seen.add(`${p.repo}#${p.number}`))
}

export default async function run(ctx) {
  const config = { mode: 'both', skipLabel: 'no-slatebox', includeDrafts: false, minFiles: 3, summary: true, ...ctx.instance.config }
  const github = ctx.vendor.github
  const now = ctx.now()
  const slates = []
  const writes = []
  let partial = null
  const done = []
  const pulls = pullsOf(ctx.run.trigger).filter((p) => (config.repos || []).includes(p.repo))
  if (pulls.length > PER_RUN) ctx.log('warn', 'many_pulls', `${pulls.length - PER_RUN} pull requests wait for the next run`)

  for (const { repo, number } of pulls.slice(0, PER_RUN)) {
    const pr = await github.pull(repo, number)
    const key = `${repo}#${number}`
    const kept = (await ctx.ledger.get(`pr:${key}`)) ?? null
    const labels = (pr.labels || []).map((l) => l.name)
    if (config.skipLabel && labels.includes(config.skipLabel)) {
      ctx.log('info', 'skipped_label', `#${number} has the ${config.skipLabel} label`)
      continue
    }
    if (pr.draft && !config.includeDrafts) {
      ctx.log('info', 'skipped_draft', `#${number} is a draft`)
      continue
    }
    // Closed: the slate kept from its last push moves (merged) or is set to go (closed), no new reading.
    if (pr.state === 'closed') {
      if (kept?.slate) {
        const slate = prSlate({ ...kept.render, pr: { ...kept.render.pr, head: pr.head }, merged: Boolean(pr.merged), closed: true, now })
        if (config.mode !== 'comment') slates.push(slate)
        await ctx.ledger.upsert([{ key: `pr:${key}`, kind: 'pr', data: { ...kept, state: pr.merged ? 'merged' : 'closed', slate } }])
      }
      continue
    }
    if (kept?.headSha === pr.head.sha && kept.state === 'open') {
      ctx.log('info', 'unchanged', `#${number} is at the same commit`)
      continue
    }
    const files = await github.pullFiles(repo, number)
    if (files.length < config.minFiles && !files.some((f) => isInfra(f.path))) {
      ctx.log('info', 'skipped_small', `#${number} changes ${files.length} file${files.length === 1 ? '' : 's'}`)
      continue
    }
    const stored = (await ctx.ledger.get(`facts:${repo}`)) ?? null
    const base = await factsAt(github, repo, pr.base.sha, { config, stored })
    await ctx.ledger.upsert([{ key: `facts:${repo}`, kind: 'facts', data: { sha: base.sha, configKey: base.configKey, facts: base.facts, context: base.context } }])
    const head = await headFacts(github, repo, base, files, pr.head.sha, { config })
    if (head.unread.length) ctx.log('warn', 'files_unread', `${head.unread.length} changed files counted by path only`)
    const baseModel = buildModel({ repo, sha: pr.base.sha, facts: base.facts, context: base.context, config })
    const headModel = buildModel({ repo, sha: pr.head.sha, facts: head.facts, context: head.context, config })
    const delta = diffModels(baseModel, headModel)
    const impact = impactOf(baseModel, headModel, delta, files.flatMap((f) => [f.path, f.previous].filter(Boolean)))

    let summary = null
    if (config.summary !== false && !impact.empty) {
      const answer = await ctx.ai.json({
        purpose: 'pr_summary',
        schema: SUMMARY_SCHEMA,
        maxIn: 4000,
        maxOut: 250,
        prompt: {
          task: 'Summarize the architectural impact of this pull request in at most 3 short bullets.',
          title: `${pr.title ?? ''}`.slice(0, 200),
          body: ctx.quarantine(`${pr.body ?? ''}`.slice(0, 2000)),
          modules: impact.modules.map((m) => ({ name: m.name, change: m.kind })),
          newDependencies: delta.added.moduleEdges.map((e) => [e.from, e.to]),
          droppedDependencies: delta.removed.moduleEdges.map((e) => [e.from, e.to]),
          endpoints: { added: impact.endpoints.added.map((e) => `${e.method} ${e.path}`), removed: impact.endpoints.removed.map((e) => `${e.method} ${e.path}`) },
        },
      })
      if (answer?.bullets?.length) summary = answer.bullets.slice(0, 3).map((b) => `- ${`${b}`.replace(/\s+/g, ' ').trim()}`).join('\n')
      else partial = 'ai_refused'
    }
    const render = { repo, pr: { number, title: `${pr.title ?? ''}`.slice(0, 200), head: { sha: pr.head.sha } }, impact, summary }
    const slate = prSlate({ ...render, now })
    if (config.mode !== 'comment') slates.push(slate)
    if (config.mode !== 'slate') {
      writes.push({
        kind: 'github.pr_comment',
        target: { repo, number },
        body: { ...prComment({ impact, summary, marker: `pr-impact:${ctx.instance.id}` }), slate: { role: 'pr', key } },
        key: `pr-comment:${key}`,
      })
    }
    await ctx.ledger.upsert([{ key: `pr:${key}`, kind: 'pr', data: { headSha: pr.head.sha, state: 'open', render, slate } }])
    ctx.emit('pr_impact.ready', { repo, number, headSha: pr.head.sha, ...impact.counts })
    for (const e of delta.added.moduleEdges.slice(0, 20)) ctx.emit('pr_impact.new_dependency', { repo, number, from: e.from, to: e.to })
    if (impact.counts.servicesChanged || files.some((f) => isInfra(f.path) && !contextPath(f.path)))
      ctx.emit('pr_impact.service_changed', { repo, number, added: impact.services.added.map((s) => s.key), removed: impact.services.removed.map((s) => s.key) })
    done.push(`#${number}`)
  }
  return {
    desired: { slates, ...(partial && { partial }) },
    writes,
    summary: done.length ? `Impact of ${done.join(', ')}.` : 'No pull request to draw.',
  }
}
