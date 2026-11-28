// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Intercepts: a developer's service steps into a run, synchronously, at a point the recipe offers.
//   graph.ready         { add: { nodes, edges }, update: [{ key, text?, link? }], drop: [key] }
//                       narrows or extends the recipe's own graph; added notes are keyed like the
//                       recipe's (ids still come from keys) and land only on the recipe's own slates
//   output.ready        { notes: [{ key, text, link? }] }  up to 12 notes beside the legend
//   writeback.proposed  { decision: 'approve'|'veto'|'defer', body? }  may approve inside the grant,
//                       veto or defer; never widen it (body edits stay in the grant's scope)
// One POST of the signed envelope (type intercept.<point>), 5 s. The answer (256 KB at most) is
// checked against the point's schema and quarantined (plain text, capped, links checked). When the
// service does not answer well: failMode open (the default) carries on without it; closed skips
// the run (skipped: hook_failed).
import { validate } from '/server/actions/schema.mjs'
import { envelope } from '../../../common/recipes/events.mjs'
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, liveSecrets, signatureHeader } from './sign.mjs'

export const INTERCEPT_LIMITS = Object.freeze({ timeoutMs: 5000, answerBytes: 256 * 1024, notes: 12, nodes: 200, edges: 400, textChars: 500 })

const text = { type: 'string', maxLength: INTERCEPT_LIMITS.textChars }
const key = { type: 'string', minLength: 1, maxLength: 200 }
const link = { type: 'string', maxLength: 2048 }
export const INTERCEPT_SCHEMAS = Object.freeze({
  'graph.ready': {
    type: 'object', additionalProperties: false,
    properties: {
      add: {
        type: 'object', additionalProperties: false,
        properties: {
          nodes: { type: 'array', maxItems: INTERCEPT_LIMITS.nodes, items: { type: 'object', additionalProperties: false, required: ['key', 'text'], properties: { key, text, link, slate: key, group: key } } },
          edges: { type: 'array', maxItems: INTERCEPT_LIMITS.edges, items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: key, to: key, label: text, slate: key } } },
        },
      },
      update: { type: 'array', maxItems: INTERCEPT_LIMITS.nodes, items: { type: 'object', additionalProperties: false, required: ['key'], properties: { key, text, link, slate: key } } },
      drop: { type: 'array', maxItems: INTERCEPT_LIMITS.nodes, items: key },
    },
  },
  'output.ready': {
    type: 'object', additionalProperties: false, required: ['notes'],
    properties: { notes: { type: 'array', maxItems: INTERCEPT_LIMITS.notes, items: { type: 'object', additionalProperties: false, required: ['key', 'text'], properties: { key, text, link, slate: key } } } },
  },
  'writeback.proposed': {
    type: 'object', additionalProperties: false, required: ['decision'],
    properties: { decision: { type: 'string', enum: ['approve', 'veto', 'defer'] }, body: { type: 'object' } },
  },
})

export class InterceptFailed extends Error {
  constructor(point, code) {
    super(`The ${point} webhook did not answer well (${code}).`)
    this.name = 'InterceptFailed'
    this.code = 'hook_failed'
    this.point = point
  }
}

// Plain one-line text; a link only when it is https.
const plain = (value, max = INTERCEPT_LIMITS.textChars) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const safeLink = (raw) => {
  try {
    const url = new URL(String(raw))
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

/** An answer made safe to draw: text plain and capped, links https only. */
export function quarantineAnswer(point, answer) {
  if (point === 'graph.ready') {
    const node = (n) => ({ key: plain(n.key, 200), text: plain(n.text), ...(n.link && safeLink(n.link) && { link: safeLink(n.link) }), ...(n.slate && { slate: plain(n.slate, 200) }), ...(n.group && { group: plain(n.group, 200) }) })
    return {
      add: { nodes: (answer.add?.nodes || []).map(node), edges: (answer.add?.edges || []).map((e) => ({ from: plain(e.from, 200), to: plain(e.to, 200), ...(e.label && { label: plain(e.label, 120) }), ...(e.slate && { slate: plain(e.slate, 200) }) })) },
      update: (answer.update || []).map((u) => ({ key: plain(u.key, 200), ...(u.text !== undefined && { text: plain(u.text) }), ...(u.link && safeLink(u.link) && { link: safeLink(u.link) }), ...(u.slate && { slate: plain(u.slate, 200) }) })),
      drop: (answer.drop || []).map((k) => plain(k, 200)),
    }
  }
  if (point === 'output.ready') return { notes: answer.notes.slice(0, INTERCEPT_LIMITS.notes).map((n) => ({ key: plain(n.key, 200), text: plain(n.text), ...(n.link && safeLink(n.link) && { link: safeLink(n.link) }), ...(n.slate && { slate: plain(n.slate, 200) }) })) }
  return { decision: answer.decision, ...(answer.body && typeof answer.body === 'object' && { body: answer.body }) }
}

const slateOf = (desired, name) => {
  const graphs = desired.slates.filter((s) => s.graph)
  return (name && graphs.find((s) => s.key === name || `${s.role}/${s.key}` === name)) || graphs[0] || null
}

/** graph.ready's answer applied to a DesiredSet (a copy). Adds land only on the recipe's own slates. */
export function applyGraphPatch(desired, patch) {
  const out = structuredClone(desired)
  for (const n of patch.add?.nodes || []) {
    const slate = slateOf(out, n.slate)
    if (!slate) continue
    if (slate.graph.nodes.some((x) => x.key === n.key)) continue
    slate.graph.nodes.push({ key: n.key, text: n.text, ...(n.link && { link: n.link }), ...(n.group && { group: n.group }), from: 'hook' })
  }
  for (const e of patch.add?.edges || []) {
    const slate = slateOf(out, e.slate)
    if (!slate) continue
    const keys = new Set(slate.graph.nodes.map((x) => x.key))
    if (!keys.has(e.from) || !keys.has(e.to)) continue
    if (!slate.graph.edges.some((x) => x.from === e.from && x.to === e.to)) slate.graph.edges.push({ from: e.from, to: e.to, ...(e.label && { label: e.label }) })
  }
  for (const u of patch.update || []) {
    for (const slate of out.slates) {
      const node = slate.graph?.nodes.find((x) => x.key === u.key && (!u.slate || slate.key === u.slate))
      if (!node) continue
      if (u.text !== undefined) node.text = u.text
      if (u.link) node.link = u.link
    }
  }
  const drop = new Set(patch.drop || [])
  if (drop.size) {
    for (const slate of out.slates) {
      if (!slate.graph) continue
      slate.graph.nodes = slate.graph.nodes.filter((x) => !drop.has(x.key))
      slate.graph.edges = slate.graph.edges.filter((e) => !drop.has(e.from) && !drop.has(e.to))
      for (const f of slate.graph.frames || []) f.members = f.members.filter((m) => !drop.has(m))
    }
  }
  return out
}

/** output.ready's notes added beside the legend of the slate they name (else the first). */
export function applyOutputNotes(desired, { notes }) {
  const out = structuredClone(desired)
  for (const n of notes) {
    const slate = (n.slate && out.slates.find((s) => s.key === n.slate)) || out.slates[0]
    if (!slate) continue
    slate.notes = [...(slate.notes || []).filter((x) => x.key !== `hook:${n.key}`), { key: `hook:${n.key}`, text: n.text, ...(n.link && { link: n.link }), anchor: 'legend' }]
  }
  return out
}

/**
 * deps: { store, clock, fetch, sealer, randomId }
 * call(point, { instance, run, data }) → the quarantined answer, null (no hook, or failMode open
 * after a bad answer), or throws InterceptFailed (failMode closed).
 */
export function createIntercepts({ store, clock = Date.now, fetch, sealer, randomId, log = () => {}, limits = INTERCEPT_LIMITS }) {
  const newId = randomId || (() => Math.random().toString(36).slice(2, 14))
  async function hookFor(instance, point) {
    const list = await store.hooks.find({ direction: 'intercept', state: 'active', point, $or: [{ 'scope.instanceId': instance._id }, { 'scope.projectId': instance.projectId }] }, { limit: 4 }).toArray()
    // the instance's own hook wins over the project's
    return list.find((h) => h.scope?.instanceId === instance._id) || list[0] || null
  }
  async function call(point, { instance, run = null, data = {}, signal = null }) {
    const hook = await hookFor(instance, point)
    if (!hook) return null
    const failed = (code) => {
      log('warn', 'intercept_failed', `${point}: ${code}`)
      if (hook.failMode === 'closed') throw new InterceptFailed(point, code)
      return null
    }
    const now = clock()
    const secrets = liveSecrets(hook.secrets, now).map((s) => ({ plain: sealer.open(hook._id, s.sealed) })).filter((s) => s.plain)
    if (!secrets.length) return failed('no_secret')
    const id = `int_${newId()}`
    const body = JSON.stringify(envelope({ id, type: `intercept.${point}`, at: now, instance, run, data }))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs)
    const onAbort = () => controller.abort()
    signal?.addEventListener?.('abort', onAbort)
    let raw
    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signatureHeader(secrets, body, Math.floor(now / 1000)), [EVENT_HEADER]: `intercept.${point}`, [DELIVERY_HEADER]: id },
        body,
        signal: controller.signal,
      })
      if (response.status < 200 || response.status >= 300) return failed(`status_${response.status}`)
      raw = await response.text()
    } catch (error) {
      if (signal?.aborted) throw error
      return failed(controller.signal.aborted ? 'timeout' : 'network')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
    if (Buffer.byteLength(raw || '') > limits.answerBytes) return failed('too_large')
    let answer
    try {
      answer = JSON.parse(raw || 'null')
    } catch {
      return failed('not_json')
    }
    if (validate(INTERCEPT_SCHEMAS[point], answer)) return failed('bad_answer')
    return quarantineAnswer(point, answer)
  }
  return { call, hookFor }
}
