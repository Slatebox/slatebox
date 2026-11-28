// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One run of the weekly digest. It reads the channel ledgers (folding only what the Events API
// delivered since the last fold, so no Slack history or search call), picks last week's rows, and lays out one frame per channel. One model call writes a
// three-sentence summary per channel (≤ 8k in, 1.5k out); with the model off the sections stand
// alone. A rerun in the same week updates the same slate (its key is the week's Monday). The post,
// when the owner set one up, is proposed as a write: it goes out only under the owner's standing
// permission for that one channel, or after they approve its card.
import { channelLedgers } from '../_slack-ledger/channels.mjs'
import { channelLabel } from '../_slack-ledger/config.mjs'
import { daysBetween, isoDayIn, localDay } from '../_slack-ledger/dates.mjs'
import { tsMillis } from '../_slack-ledger/signals.mjs'
import { count, plain, shortDate } from '../_shared/text.mjs'
import { DIGEST_SECTIONS } from './manifest.mjs'

export const DIGEST_LIMITS = Object.freeze({ perSection: 6, concepts: 5, openDays: 3, questionDays: 14, maxIn: 8000, maxOut: 1500 })

export const SUMMARY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['channels'],
  properties: { channels: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'summary'], properties: { id: { type: 'string' }, summary: { type: 'string' } } } } },
})

/** The Monday (ISO day) of the week a digest run covers: the week holding yesterday, in the owner's zone. */
export function weekOf(now, tz) {
  const yesterday = localDay(now - 86400000, tz)
  const back = (yesterday.weekday + 6) % 7
  const date = new Date(Date.UTC(yesterday.y, yesterday.m, yesterday.d - back))
  return date.toISOString().slice(0, 10)
}

const inWeek = (day, start) => day && daysBetween(start, day) >= 0 && daysBetween(start, day) < 7

export default async function run(ctx) {
  const config = ctx.instance.config
  const tz = config.tz || 'UTC'
  const sections = new Set(config.sections?.length ? config.sections : DIGEST_SECTIONS)
  const read = await channelLedgers(ctx, { channels: config.channels, fold: 'inbox', config })
  const week = weekOf(ctx.now(), tz)
  const today = isoDayIn(ctx.now(), tz)
  const people = [...new Set(read.channels.flatMap((c) => c.rows.flatMap((r) => [...(r.data.decidedBy || []), r.data.owner, r.data.askedBy]).filter(Boolean)))]
  const names = people.length ? await ctx.vendor.slack.names(people) : new Map()
  const who = (id) => (id ? names.get(id) || 'someone' : null)

  const picked = read.channels.map((channel) => {
    const rows = channel.rows
    const decisions = rows.filter((r) => r.kind === 'decision' && r.data.status !== 'maybe' && inWeek(r.data.day, week)).sort((a, b) => Number(a.data.ts) - Number(b.data.ts))
    const slips = rows.filter((r) => r.kind === 'commitment' && !r.data.done && ((r.data.dueHistory || []).some((h, i) => i > 0 && inWeek(isoDayIn(tsMillis(h.ts), tz), week)) || (r.data.due && r.data.due < today && inWeek(r.data.due, week))))
    const questions = rows.filter((r) => r.kind === 'question' && !r.data.answered && daysBetween(r.data.day, today) >= DIGEST_LIMITS.openDays && daysBetween(r.data.day, today) <= DIGEST_LIMITS.questionDays)
    const concepts = rows.filter((r) => r.kind === 'concept').sort((a, b) => b.data.mentions - a.data.mentions).slice(0, DIGEST_LIMITS.concepts)
    return { channel, decisions, slips, questions, concepts }
  })

  // One summary call over the week's rows (not messages), when asked for and there is something to say.
  let summaries = new Map()
  let partial = read.partial
  const worth = picked.filter((p) => p.decisions.length || p.slips.length || p.questions.length)
  if (sections.has('summary') && worth.length) {
    const prompt = [
      'Write a three-sentence summary of last week for each Slack channel below, for a leader who was not in it: what was decided, what slipped, what is still open. Plain words, no names of people you are not given.',
      '',
      ...worth.flatMap((p) => [
        `## ${p.channel.id} (${channelLabel(p.channel)})`,
        ...p.decisions.map((r) => `- decided (${r.data.status}): ${r.data.title}${r.data.rationale ? ', because ' + r.data.rationale : ''}`),
        ...p.slips.map((r) => `- slipped: ${r.data.what}, now due ${r.data.due}`),
        ...p.questions.map((r) => `- open question: ${r.data.text}`),
        '',
      ]),
    ].join('\n')
    const answer = await ctx.ai.json({ prompt, schema: SUMMARY_SCHEMA, maxIn: DIGEST_LIMITS.maxIn, maxOut: DIGEST_LIMITS.maxOut, purpose: 'summary' })
    if (answer?.channels) summaries = new Map(answer.channels.map((c) => [c.id, plain(c.summary, 500)]))
    else partial = partial || 'ai_refused'
  }

  const nodes = []
  const frames = []
  for (const p of picked) {
    const ch = p.channel.id
    const members = []
    const note = (key, text, link = null) => {
      nodes.push({ key: `${ch}/${key}`, text: plain(text, 240), ...(link && { link }) })
      members.push(`${ch}/${key}`)
    }
    if (sections.has('summary') && summaries.get(ch)) note('summary', summaries.get(ch))
    if (sections.has('decisions')) {
      if (!p.decisions.length) note('decisions:none', 'No decisions recorded this week.')
      for (const r of p.decisions.slice(0, DIGEST_LIMITS.perSection)) note('dec:' + r.key, `${r.data.status === 'reversed' ? 'Reversed' : 'Decided'}: ${r.data.title}${r.data.decidedBy?.length ? ' — ' + r.data.decidedBy.map(who).join(', ') : ''}`, r.data.permalink)
    }
    if (sections.has('slips')) {
      if (!p.slips.length) note('slips:none', 'Nothing slipped this week.')
      for (const r of p.slips.slice(0, DIGEST_LIMITS.perSection)) {
        const first = r.data.dueHistory?.[0]?.due
        note('slip:' + r.key, `Slipped: ${r.data.what}${first && first !== r.data.due ? `, ${shortDate(first)} → ${shortDate(r.data.due)}` : `, due ${shortDate(r.data.due)}`}${r.data.owner ? ' (' + who(r.data.owner) + ')' : ''}`, r.data.dueHistory?.[r.data.dueHistory.length - 1]?.permalink || r.data.permalink)
      }
    }
    if (sections.has('questions')) {
      if (!p.questions.length) note('questions:none', 'No open questions.')
      for (const r of p.questions.slice(0, DIGEST_LIMITS.perSection)) note('q:' + r.key, `Open: ${r.data.text}${r.data.askedBy ? ' (' + who(r.data.askedBy) + ', ' + count(daysBetween(r.data.day, today), 'day', 'days') + ')' : ''}`, r.data.permalink)
    }
    if (sections.has('concepts') && p.concepts.length) note('concepts', `Most used terms: ${p.concepts.map((r) => r.data.term).join(', ')}`)
    frames.push({ key: 'frame:' + ch, text: channelLabel(p.channel), members })
  }

  const name = `Week of ${shortDate(week + 'T00:00:00Z')}`
  const slate = {
    role: 'digest',
    key: week,
    name,
    folder: ['Digests'],
    graph: { nodes, edges: [], frames, layout: 'grid' },
    ...(config.presentation !== false && { presentation: { title: `${name}: ${read.channels.map(channelLabel).join(', ')}`, from: 'frames' } }),
  }

  const totals = { decisions: picked.reduce((n, p) => n + p.decisions.length, 0), slips: picked.reduce((n, p) => n + p.slips.length, 0), questions: picked.reduce((n, p) => n + p.questions.length, 0) }
  const writes = []
  if (config.post?.channel) {
    const head = `${name} digest for ${read.channels.map(channelLabel).join(', ')}: ${count(totals.decisions, 'decision', 'decisions')}, ${totals.slips} slipped, ${count(totals.questions, 'open question', 'open questions')}.`
    const bullets = config.post.format === 'bullets'
      ? picked.flatMap((p) => [...p.decisions.map((r) => `• ${r.data.title}`), ...p.slips.map((r) => `• Slipped: ${r.data.what}`)]).slice(0, 5)
      : []
    writes.push({ kind: 'slack.post', target: { channel: config.post.channel }, body: { text: [head, ...bullets].join('\n'), slateRef: { role: 'digest', key: week } }, key: `digest:${week}` })
  }
  ctx.emit('digest.published', { week, channels: read.channels.map((c) => c.id), ...totals, postProposed: writes.length > 0 })

  return {
    desired: { slates: [slate], ...(partial && { partial }) },
    writes,
    summary: `${name}: ${count(totals.decisions, 'decision', 'decisions')}, ${totals.slips} slipped, ${count(totals.questions, 'open question', 'open questions')}`,
    stats: { modelCalls: read.stats.modelCalls + (sections.has('summary') && worth.length ? 1 : 0) },
  }
}
