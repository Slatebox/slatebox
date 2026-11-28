// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One run of the concept map. Terms come from the channel ledger (counted on every fold, no model).
// Clustering is one model call over the terms (≤ 6k in, 1.5k out), on the weekly schedule, Run now,
// or once 10 new terms arrived; between clusterings new terms hang off the center. With the model
// off the map is one ring around the channel, still useful. A term the model folds into another
// ("3DS" into "3DS2") is an alias: a new alias gets no note; an old note stays and points at the
// term it now means.
import { channelLedgers } from '../_slack-ledger/channels.mjs'
import { channelLabel } from '../_slack-ledger/config.mjs'
import { diffSeen } from '../_shared/changes.mjs'
import { count, normalKey, plain } from '../_shared/text.mjs'

export const CONCEPT_LIMITS = Object.freeze({ newTermsToCluster: 10, maxIn: 6000, maxOut: 1500, big: 10, clusters: 8 })

export const CLUSTER_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['clusters'],
  properties: {
    clusters: { type: 'array', maxItems: CONCEPT_LIMITS.clusters, items: { type: 'object', additionalProperties: false, required: ['label', 'terms'], properties: { label: { type: 'string' }, terms: { type: 'array', items: { type: 'string' } } } } },
    aliases: { type: 'array', maxItems: 40, items: { type: 'object', additionalProperties: false, required: ['alias', 'term'], properties: { alias: { type: 'string' }, term: { type: 'string' } } } },
  },
})

const termKey = (term) => normalKey(term)

export default async function run(ctx) {
  const config = ctx.instance.config
  const max = config.max || 40
  const read = await channelLedgers(ctx, { channels: config.channels, config })
  const cursor = ctx.instance.cursor || {}
  const state = { ...(cursor.channels || {}) }
  const slates = []
  const added = []
  const addedKeys = []
  const merged = []
  let modelCalls = read.stats.modelCalls
  let partial = read.partial

  for (const channel of read.channels) {
    const all = channel.rows.filter((r) => r.kind === 'concept')
    const saved = state[channel.id] || { clusters: {}, aliases: {}, terms: 0, drawn: [] }
    const mine = { ...saved, clusters: { ...saved.clusters }, aliases: { ...saved.aliases }, drawn: [...(saved.drawn || [])] }
    const due = ctx.run.trigger.kind !== 'vendor' || all.length - (mine.terms || 0) >= CONCEPT_LIMITS.newTermsToCluster
    if (due && all.length) {
      const top = [...all].sort((a, b) => b.data.mentions - a.data.mentions).slice(0, Math.min(80, max * 2))
      const prompt = [
        `Group these terms from the Slack channel ${channelLabel(channel)} into at most ${CONCEPT_LIMITS.clusters} clusters of related ideas, with a short label each (sentence case).`,
        'List as aliases only terms that mean exactly the same thing as another listed term (an abbreviation, an older name).',
        '',
        ...top.map((r) => `- ${r.data.term}${r.data.definition ? ': ' + plain(r.data.definition, 120) : ''}${r.data.relatedTerms?.length ? ' (related: ' + r.data.relatedTerms.join(', ') + ')' : ''}`),
      ].join('\n')
      modelCalls++
      const answer = await ctx.ai.json({ prompt, schema: CLUSTER_SCHEMA, maxIn: CONCEPT_LIMITS.maxIn, maxOut: CONCEPT_LIMITS.maxOut, purpose: 'clusters' })
      if (answer?.clusters) {
        const known = new Set(all.map((r) => termKey(r.data.term)))
        mine.clusters = {}
        for (const c of answer.clusters) for (const t of c.terms || []) if (known.has(termKey(t))) mine.clusters[termKey(t)] = plain(c.label, 40)
        for (const a of answer.aliases || []) {
          const alias = termKey(a.alias)
          const term = termKey(a.term)
          if (alias !== term && known.has(alias) && known.has(term) && !mine.aliases[term]) mine.aliases[alias] = term
        }
      } else partial = partial || 'ai_refused'
      mine.terms = all.length
    }

    // The terms on the map: the most mentioned (aliases fold into their term), up to max.
    const byTerm = new Map(all.map((r) => [termKey(r.data.term), r]))
    const canonical = (k) => mine.aliases[k] || k
    const mentions = new Map()
    for (const r of all) mentions.set(canonical(termKey(r.data.term)), (mentions.get(canonical(termKey(r.data.term))) || 0) + r.data.mentions)
    const shown = [...mentions].filter(([k]) => byTerm.has(k)).sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k)
    const big = new Set(shown.slice(0, CONCEPT_LIMITS.big))
    const drawnBefore = new Set(mine.drawn || [])
    const center = 'center'
    const nodes = [{ key: center, text: channelLabel(channel), shape: 'circle', size: 'large' }]
    const edges = []
    const clusterKeys = new Set()
    for (const k of shown) {
      const r = byTerm.get(k)
      const aliases = Object.entries(mine.aliases).filter(([, t]) => t === k).map(([a]) => byTerm.get(a)?.data.term).filter(Boolean)
      const text = plain(`${r.data.term}${aliases.length ? ` (also ${aliases.join(', ')})` : ''}${r.data.definition ? ' — ' + r.data.definition : ''}`, 200)
      nodes.push({ key: r.key, text, ...(r.data.firstPermalink && { link: r.data.firstPermalink }), ...(big.has(k) && { size: 'large' }) })
      const cluster = mine.clusters[k]
      if (cluster) {
        const ck = 'cluster:' + normalKey(cluster)
        if (!clusterKeys.has(ck)) {
          clusterKeys.add(ck)
          nodes.push({ key: ck, text: cluster, shape: 'roundedrectangle' })
          edges.push({ from: center, to: ck })
        }
        edges.push({ from: ck, to: r.key })
      } else edges.push({ from: center, to: r.key })
    }
    // An alias drawn before it was known to be one keeps its note, pointing at its term.
    for (const [alias, term] of Object.entries(mine.aliases)) {
      const r = byTerm.get(alias)
      if (!r || !drawnBefore.has(r.key) || !shown.includes(term)) continue
      nodes.push({ key: r.key, text: plain(`${r.data.term} (same as ${byTerm.get(term).data.term})`, 200) })
      edges.push({ from: r.key, to: byTerm.get(term).key, label: 'same as' })
      if (!(cursor.merged || []).includes(r.key)) merged.push(r.data.term)
    }
    mine.drawn = nodes.filter((n) => n.key.startsWith('con:')).map((n) => n.key).slice(0, 200)
    state[channel.id] = mine
    const diff = diffSeen(Object.fromEntries([...drawnBefore].map((k) => [k, 1])), new Map(mine.drawn.map((k) => [k, 1])))
    added.push(...diff.added.map((k) => channel.rows.find((r) => r.key === k)?.data.term).filter(Boolean))
    addedKeys.push(...diff.added)
    slates.push({ role: 'concepts', key: channel.id, name: `Concepts — ${channelLabel(channel)}`, graph: { nodes, edges, frames: [], layout: 'mindmap' }, notes: [{ key: 'legend', anchor: 'legend', text: `The words ${channelLabel(channel)} uses. Reword a definition and it stays yours.` }] })
  }

  ctx.setCursor({ channels: state, merged: [...new Set([...(cursor.merged || []), ...merged])].slice(-200) })
  if (added.length || merged.length) ctx.emit('concepts.updated', { added: added.length, merged: merged.length, addedKeys: addedKeys.slice(0, 50) })
  return {
    desired: { slates, ...(partial && { partial }) },
    summary: `${count(added.length, 'new term', 'new terms')}, ${count(slates.reduce((n, s) => n + s.graph.nodes.filter((x) => x.key.startsWith('con:')).length, 0), 'term', 'terms')} on the map`,
    stats: { modelCalls },
  }
}
