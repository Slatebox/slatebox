// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The channel ledger's fold (recipes catalog, "Slack ingest"): new messages in a channel become typed
// rows (decision, commitment, question, concept) that the decision log, the timeline, the concept
// map and the weekly digest all read. One fold per channel, whichever recipe runs first; the others
// read the rows. One model call per fold at most, over the threads that score only (≤ 40 threads,
// ≤ 1,600 characters each, ≤ 16k tokens in, 2k out). Rows hold extracts, permalinks, author ids and
// quotes of at most 280 characters, never message bodies. Re-folding is idempotent: rows are keyed
// by channel and thread, so a later reply updates its row (revisited, reversed, a moved date, done).
import { daysBetween, isoDayIn } from './dates.mjs'
import { conceptsIn, isNoise, overlap, QUOTE_CHARS, readThread, scoreThread, slackPlain, threadsOf, tsMillis } from './signals.mjs'
import { hashOf, normalKey, plain } from '../_shared/text.mjs'

export const FOLD_LIMITS = Object.freeze({ threads: 40, threadChars: 1600, maxIn: 16000, maxOut: 2000, minScore: 3, history: 8, concepts: 400 })

export const ledgerKey = {
  decision: (channel, threadTs) => `dec:${channel}:${threadTs}`,
  commitment: (channel, threadTs, what) => `com:${channel}:${threadTs}:${hashOf(normalKey(what), 8)}`,
  question: (channel, ts) => `q:${channel}:${ts}`,
  concept: (channel, term) => `con:${channel}:${normalKey(term)}`,
}

/** A message's Slack link (the workspace's url from the sign-in), or null. */
export function permalinkOf(account, channel, ts, threadTs = null) {
  if (!account?.url || !/^https:\/\//.test(account.url) || !channel || !ts) return null
  const base = account.url.endsWith('/') ? account.url : account.url + '/'
  return `${base}archives/${channel}/p${String(ts).replace('.', '')}${threadTs && threadTs !== ts ? `?thread_ts=${threadTs}&cid=${channel}` : ''}`
}

const DECISION_STATUS = ['decided', 'revisited', 'reversed']
const ISO_DAY = /^20\d{2}-\d{2}-\d{2}$/
const USER = /^[UW][A-Z0-9]{2,20}$/

/** The structured answer the fold asks the model for (strict: nothing else is read). */
export const FOLD_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['threads'],
  properties: {
    threads: {
      type: 'array',
      maxItems: FOLD_LIMITS.threads,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
          decisions: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['title', 'status', 'confidence', 'message'], properties: { title: { type: 'string' }, rationale: { type: 'string' }, decidedBy: { type: 'array', items: { type: 'string' } }, status: { enum: DECISION_STATUS }, confidence: { type: 'number' }, message: { type: 'integer' } } } },
          commitments: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['what', 'status', 'message'], properties: { what: { type: 'string' }, owner: { type: ['string', 'null'] }, due: { type: ['string', 'null'] }, status: { enum: ['open', 'moved', 'done'] }, message: { type: 'integer' } } } },
          questions: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['text', 'answered', 'message'], properties: { text: { type: 'string' }, answered: { type: 'boolean' }, message: { type: 'integer' } } } },
          concepts: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['term'], properties: { term: { type: 'string' }, definition: { type: ['string', 'null'] }, relatedTerms: { type: 'array', items: { type: 'string' } } } } },
        },
      },
    },
  },
})

// The model's view of the candidate threads: numbered messages, author ids with names, the day each
// was sent, and what the ledger already says about the thread. Trimmed to the per-thread cap.
function promptOf(candidates, { names, tz, channelName, prior }) {
  const lines = [
    `Read these Slack threads from #${channelName} and return what they decided, committed to (with dates as YYYY-MM-DD, resolved against the day each message was sent), asked, and the vocabulary they use.`,
    'Only what the messages say. A decision someone later walks back in the same thread is "reversed"; one reopened for discussion is "revisited". A commitment whose date a later message changes is "moved", with the new date. Owners and deciders are the U… ids shown. message is the number of the message the row comes from.',
    '',
  ]
  candidates.forEach((thread, i) => {
    const id = 'T' + (i + 1)
    thread.promptId = id
    const known = prior(thread.ts)
    const head = [`## ${id}`, known ? `Already recorded: ${known}` : null].filter(Boolean)
    let used = 0
    const body = []
    thread.messages.forEach((m, n) => {
      const text = slackPlain(m.text, names).replace(/\s+/g, ' ')
      const line = `${n}. [${isoDayIn(tsMillis(m.ts), tz)}] ${m.user || 'someone'} (${names.get(m.user) || 'someone'}): ${text}`
      if (used + line.length > FOLD_LIMITS.threadChars) return
      used += line.length
      body.push(line)
    })
    lines.push(...head, ...body, '')
  })
  return lines.join('\n')
}

const clean = {
  title: (t) => plain(t, 90),
  rationale: (t) => plain(t, 140),
  users: (list) => [...new Set((Array.isArray(list) ? list : []).filter((u) => typeof u === 'string' && USER.test(u)))].slice(0, 8),
}

// The model's rows for one thread, in readThread's shape, checked against the messages sent.
function modelRows(answer, thread) {
  const at = (n) => thread.messages[Number.isInteger(n) && n >= 0 && n < thread.messages.length ? n : 0]
  const rows = { decisions: [], commitments: [], questions: [], concepts: [] }
  for (const d of answer.decisions || []) {
    const m = at(d.message)
    if (!clean.title(d.title)) continue
    rows.decisions.push({ title: clean.title(d.title), rationale: clean.rationale(d.rationale || ''), decidedBy: clean.users(d.decidedBy).length ? clean.users(d.decidedBy) : [m.user].filter(Boolean), ts: m.ts, quote: plain(slackPlain(m.text), QUOTE_CHARS), status: DECISION_STATUS.includes(d.status) ? d.status : 'decided', confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0)) })
  }
  for (const c of answer.commitments || []) {
    const m = at(c.message)
    const what = plain(c.what, 90)
    if (!what) continue
    rows.commitments.push({ what, owner: typeof c.owner === 'string' && USER.test(c.owner) ? c.owner : null, due: typeof c.due === 'string' && ISO_DAY.test(c.due) ? c.due : null, moved: c.status === 'moved', done: c.status === 'done', doneOnly: c.status === 'done' && !c.due, ts: m.ts })
  }
  for (const q of answer.questions || []) {
    const m = at(q.message)
    if (plain(q.text, 200)) rows.questions.push({ text: plain(q.text, 200), askedBy: m.user || null, ts: m.ts, answered: q.answered === true })
  }
  for (const c of answer.concepts || []) {
    const term = plain(c.term, 40)
    if (term && normalKey(term)) rows.concepts.push({ term, definition: c.definition ? plain(c.definition, 140) : null, relatedTerms: (c.relatedTerms || []).map((t) => plain(t, 40)).filter(Boolean).slice(0, 6) })
  }
  return rows
}

/**
 * Folds new messages into a channel's ledger rows.
 *   channel   { id, name }
 *   messages  new messages since the last fold [{ ts, threadTs?, user, text, reactions?, subtype?, bot?, deleted? }]
 *   rows      the channel's current ledger rows [{ key, kind, data, sourceRef, at }]
 *   ai        ctx.ai (json({ prompt, schema, maxIn, maxOut, purpose }) → object | null), or null
 *   names     Map(userId → name), for the prompt only (rows keep ids)
 *   account   { url } (the workspace's address), for permalinks
 *   config    { confidence = 0.7, threadsOnly = false, deciders = [] (anyone), keepBots = false }
 * → { upserts: rows to write, removed: keys to delete, stats: { messages, threads, candidates, modelCalls, partial, newConcepts } }
 */
export async function foldChannel({ channel, messages, rows = [], ai = null, names = new Map(), account = {}, tz = 'UTC', config = {}, now = Date.now(), purpose = 'ledger' }) {
  const threshold = typeof config.confidence === 'number' ? config.confidence : 0.7
  const deciders = new Set(config.deciders || [])
  const byKey = new Map(rows.map((row) => [row.key, structuredClone(row)]))
  const touched = new Set()
  const removed = new Set()
  const stats = { messages: 0, threads: 0, candidates: 0, modelCalls: 0, partial: null, newConcepts: 0 }
  const link = (ts, threadTs) => permalinkOf(account, channel.id, ts, threadTs)
  const put = (key, kind, data, sourceRef) => {
    const before = byKey.get(key)
    byKey.set(key, { key, kind, data, sourceRef, at: new Date(now).toISOString(), ...(before?.created ? { created: before.created } : { created: new Date(now).toISOString() }) })
    touched.add(key)
  }

  // A deleted message takes its rows with it (Slack is the source; nothing outlives its deletion).
  const deleted = new Set(messages.filter((m) => m.deleted).map((m) => m.ts))
  for (const [key, row] of byKey) if (deleted.has(row.sourceRef?.ts)) {
    byKey.delete(key)
    removed.add(key)
  }
  const kept = messages.filter((m) => !m.deleted && !isNoise(m, { keepBots: config.keepBots }))
  stats.messages = kept.length
  let threads = threadsOf(kept, channel.id)
  if (config.threadsOnly) threads = threads.filter((t) => t.messages.some((m) => m.threadTs && m.threadTs !== m.ts) || byKey.has(ledgerKey.decision(channel.id, t.ts)))
  stats.threads = threads.length

  // Vocabulary from every kept message (cheap, deterministic): mentions and first use.
  for (const m of kept) {
    for (const found of conceptsIn(m.text)) {
      const key = ledgerKey.concept(channel.id, found.term)
      if (!normalKey(found.term)) continue
      const row = byKey.get(key)
      if (!row && [...byKey.values()].filter((r) => r.kind === 'concept').length >= FOLD_LIMITS.concepts) continue
      const data = row ? { ...row.data } : { term: plain(found.term, 40), definition: null, relatedTerms: [], mentions: 0, firstTs: m.ts, firstPermalink: link(m.ts, m.threadTs), aliases: [] }
      data.mentions++
      if (found.definition && !data.definition) {
        data.definition = found.definition
        data.firstPermalink = link(m.ts, m.threadTs) || data.firstPermalink
      }
      if (!row) stats.newConcepts++
      put(key, 'concept', data, { channel: channel.id, ts: data.firstTs })
    }
  }

  // Threads worth reading closely: they score, or the ledger already holds their decision.
  const scored = threads.map((thread) => ({ thread, ...scoreThread(thread), known: byKey.has(ledgerKey.decision(channel.id, thread.ts)) }))
  const candidates = scored.filter((s) => s.score >= FOLD_LIMITS.minScore || s.known).sort((a, b) => b.score - a.score).slice(0, FOLD_LIMITS.threads).map((s) => s.thread).sort((a, b) => Number(a.ts) - Number(b.ts))
  stats.candidates = candidates.length

  let answered = new Map()
  if (candidates.length && ai) {
    const prior = (threadTs) => {
      const d = byKey.get(ledgerKey.decision(channel.id, threadTs))
      return d ? `decision "${d.data.title}" (${d.data.status})` : null
    }
    const prompt = promptOf(candidates, { names, tz, channelName: channel.name || channel.id, prior })
    stats.modelCalls++
    const answer = await ai.json({ prompt, schema: FOLD_SCHEMA, maxIn: FOLD_LIMITS.maxIn, maxOut: FOLD_LIMITS.maxOut, purpose }).catch(() => null)
    if (answer && Array.isArray(answer.threads)) {
      const byPrompt = new Map(candidates.map((t) => [t.promptId, t]))
      for (const entry of answer.threads) {
        const thread = byPrompt.get(entry?.id)
        if (thread) answered.set(thread.ts, modelRows(entry, thread))
      }
    } else stats.partial = 'ai_refused'
  } else if (candidates.length) stats.partial = 'ai_off'

  for (const thread of candidates) {
    const read = answered.get(thread.ts) || readThread(thread, { names, tz, known: byKey.has(ledgerKey.decision(channel.id, thread.ts)) })
    const root = thread.ts

    // Decisions: one row per thread; later messages revisit or reverse it.
    for (const d of read.decisions.slice(0, 1)) {
      if (deciders.size && !d.decidedBy.some((u) => deciders.has(u))) continue
      const key = ledgerKey.decision(channel.id, root)
      const row = byKey.get(key)
      const permalink = link(d.ts, root)
      if (!row) {
        if (!d.title) continue
        const status = d.status === 'decided' && d.confidence < threshold ? 'maybe' : d.status
        put(key, 'decision', { title: d.title, rationale: d.rationale, decidedBy: d.decidedBy, status, confidence: d.confidence, quote: d.quote, ts: d.ts, day: isoDayIn(tsMillis(d.ts), tz), permalink, history: [{ status, title: d.title, ts: d.ts, permalink }] }, { channel: channel.id, ts: d.ts, threadTs: root })
        continue
      }
      const data = { ...row.data, history: [...(row.data.history || [])] }
      const sameMessage = d.ts === data.ts
      if (d.status === 'reversed' && data.status !== 'reversed' && !sameMessage && d.title) {
        Object.assign(data, { status: 'reversed', reversedFrom: data.title, title: d.title, rationale: d.rationale || data.rationale, quote: d.quote, ts: d.ts, day: isoDayIn(tsMillis(d.ts), tz), permalink, confidence: Math.max(d.confidence, data.confidence) })
      } else if (d.status === 'revisited' && data.status === 'decided') data.status = 'revisited'
      else if (data.status === 'maybe' && d.confidence >= threshold) Object.assign(data, { status: 'decided', confidence: d.confidence })
      else if (data.status === 'revisited' && d.status === 'decided' && !sameMessage && d.title) Object.assign(data, { status: 'decided', title: d.title, rationale: d.rationale || data.rationale, ts: d.ts, permalink })
      if (data.status !== row.data.status || data.title !== row.data.title) data.history = [...data.history, { status: data.status, title: data.title, ts: data.ts, permalink: data.permalink }].slice(-FOLD_LIMITS.history)
      data.decidedBy = [...new Set([...(row.data.decidedBy || []), ...d.decidedBy])].slice(0, 8)
      if (JSON.stringify(data) !== JSON.stringify(row.data)) put(key, 'decision', data, row.sourceRef)
    }

    // Commitments: a moved date or "done" finds the open commitment it is about (same thread first, then the channel).
    for (const c of read.commitments) {
      const open = [...byKey.values()].filter((r) => r.kind === 'commitment' && !r.data.done)
      const sameThread = open.filter((r) => r.sourceRef?.threadTs === root)
      const match = (list) => list.map((r) => ({ r, score: overlap(r.data.what, c.what) })).filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score)[0]?.r
      const existing = (c.moved || c.doneOnly || c.done) ? match(sameThread) || match(open) : match(sameThread)
      const permalink = link(c.ts, root)
      if (existing) {
        const data = { ...existing.data, dueHistory: [...(existing.data.dueHistory || [])] }
        if (c.due && c.due !== data.due && (c.moved || !data.due)) {
          data.dueHistory = [...data.dueHistory, { due: c.due, ts: c.ts, permalink }].slice(-FOLD_LIMITS.history)
          data.due = c.due
          if (data.dueHistory.length > 1) data.slipDays = daysBetween(data.dueHistory[0].due, c.due)
        }
        if (c.done || c.doneOnly) Object.assign(data, { done: true, doneTs: c.ts, donePermalink: permalink })
        if (c.owner && !data.owner) data.owner = c.owner
        if (JSON.stringify(data) !== JSON.stringify(existing.data)) put(existing.key, 'commitment', data, existing.sourceRef)
        continue
      }
      // "done" and "moved to" with nothing open to match are not new commitments.
      if (c.doneOnly || c.moveOnly) continue
      const what = c.what
      const key = ledgerKey.commitment(channel.id, root, what)
      if (byKey.has(key)) continue
      put(key, 'commitment', { what, owner: c.owner, due: c.due, vague: c.vague || null, ...(c.after && { after: c.after }), dueHistory: c.due ? [{ due: c.due, ts: c.ts, permalink }] : [], done: Boolean(c.done), ts: c.ts, day: isoDayIn(tsMillis(c.ts), tz), permalink }, { channel: channel.id, ts: c.ts, threadTs: root })
    }

    // Questions: answered once someone else replies.
    for (const q of read.questions) {
      const key = ledgerKey.question(channel.id, q.ts)
      const row = byKey.get(key)
      if (row) {
        if (q.answered && !row.data.answered) put(key, 'question', { ...row.data, answered: true }, row.sourceRef)
        continue
      }
      put(key, 'question', { text: q.text, askedBy: q.askedBy, answered: q.answered, ts: q.ts, day: isoDayIn(tsMillis(q.ts), tz), permalink: link(q.ts, root) }, { channel: channel.id, ts: q.ts, threadTs: root })
    }

    // The model's definitions and related terms enrich the vocabulary rows.
    for (const c of read.concepts || []) {
      const key = ledgerKey.concept(channel.id, c.term)
      const row = byKey.get(key)
      const data = row ? { ...row.data } : { term: c.term, definition: null, relatedTerms: [], mentions: 1, firstTs: thread.ts, firstPermalink: link(thread.ts), aliases: [] }
      if (!row) stats.newConcepts++
      if (c.definition && !data.definition) data.definition = c.definition
      data.relatedTerms = [...new Set([...(data.relatedTerms || []), ...c.relatedTerms])].slice(0, 8)
      put(key, 'concept', data, { channel: channel.id, ts: data.firstTs })
    }
  }

  // Questions in every thread, read without the model where the model did not read the thread.
  const asked = new Set(candidates.filter((t) => answered.has(t.ts)).map((t) => t.ts))
  for (const thread of threads) {
    if (asked.has(thread.ts) || candidates.includes(thread)) continue
    for (const q of readThread(thread, { names, tz }).questions) {
      const key = ledgerKey.question(channel.id, q.ts)
      if (!byKey.has(key)) put(key, 'question', { text: q.text, askedBy: q.askedBy, answered: q.answered, ts: q.ts, day: isoDayIn(tsMillis(q.ts), tz), permalink: link(q.ts, thread.ts) }, { channel: channel.id, ts: q.ts, threadTs: thread.ts })
    }
  }
  // Questions in threads that got new replies (and were not candidates) can still be answered now.
  for (const thread of threads) {
    for (const row of byKey.values()) {
      if (row.kind !== 'question' || row.data.answered || row.sourceRef?.threadTs !== thread.ts) continue
      if (thread.messages.some((m) => Number(m.ts) > Number(row.data.ts) && m.user && m.user !== row.data.askedBy)) put(row.key, 'question', { ...row.data, answered: true }, row.sourceRef)
    }
  }

  return { upserts: [...touched].filter((key) => byKey.has(key)).map((key) => byKey.get(key)), removed: [...removed], stats }
}
