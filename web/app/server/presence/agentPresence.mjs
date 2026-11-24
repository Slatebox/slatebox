// Agents on the canvas: the server's record of each agent run that is saving to a slate, which
// every screen that may read the slate draws as a named pointer with the run's plan
// (agentPresence.forSlate, AgentPresenceListener, the engine's createAgentPresence).
//
// The server writes it, never a page: after a saved slates.applyOperations or workshop edit
// (never a preview, never a held plan), and on presence.plan / presence.step. Mongo carries it
// to every app process. The label is built here from the token owner's account; a client name
// an MCP client reported is cleaned and only ever shown after "{name}'s agent ·".
//
// One record per run and slate. A run is an exec run (its execId), an in-app conversation's
// kept preview, or, for a raw API call, the token itself. Nothing published names the token or
// the account: agentKey is an HMAC of the token and the slate, so it cannot be followed across
// slates.
import { createHash, createHmac } from 'node:crypto'
import { problem } from '../actions/errors.mjs'

export const PRESENCE_LIMITS = Object.freeze({
  writeGapMs: 250, // at most 4 presence writes a second per run and slate: the latest wins
  plans: 3, // presence.plan calls per run
  steps: 40, // presence.step calls per run
  livePerOwner: 3, // live agent records per owner per slate; the oldest is ended
  silentMs: 30000, // a run with no write for this long is hidden (and later deleted)
  endedMs: 8000, // an ended run stays this long (screens show the final list for 6 s, then fade)
  planSteps: 8,
  stepChars: 80,
  clientChars: 40,
  targets: 20,
})

export const PALETTE_SIZE = 6
export const SLATEBOX_AGENT_LABEL = 'Slatebox agent'
// publicId: the id a screen knows the record by (an HMAC of the record's own id), so two runs of
// one token on one slate are two pointers, and neither id can be followed back to the token.
// point, say and sayAt: where the pointer goes before its targets and the short line it says
// there (choreography). origin, via, invitedBy, iconUrl: where the agent comes from. agentId: the
// agent across its runs on this slate (its suggestions, activity and undo are filed under it).
export const PUBLIC_FIELDS = Object.freeze([
  'slateId', 'agentKey', 'label', 'initial', 'colorIndex', 'targets', 'plan', 'message', 'status', 'updatedAt', 'endedAt', 'expiresAt',
  'point', 'say', 'sayAt', 'origin', 'via', 'invitedBy', 'iconUrl', 'agentId',
])

// A short line said over the pointer ("Suggesting 3 notes"): plain, one line, 60 characters.
export const SAY_CHARS = 60
// An invited agent's icon: an https: address or a small raster data URL, never anything that runs.
export const ICON_URL_CHARS = 2048
export function safeIconUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 64 * 1024) return null
  if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(raw)) return raw
  if (raw.length > ICON_URL_CHARS) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
const finitePoint = (point) =>
  point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) && Math.abs(point.x) < 1e7 && Math.abs(point.y) < 1e7
    ? { x: Math.round(Number(point.x)), y: Math.round(Number(point.y)) }
    : null

import { agentLabel, cleanStepText, firstNameOf, initialOf, sameName, sanitizeClientName } from '../../imports/api/common/agent-label.mjs'

export { agentLabel, cleanStepText, firstNameOf, sanitizeClientName }

export const agentKeyFor = (secret, tokenId, slateId) =>
  createHmac('sha256', secret).update(String(tokenId) + ':' + String(slateId)).digest('hex').slice(0, 12)

const recordId = (runId, slateId) => createHash('sha256').update(String(runId) + '\u0000' + String(slateId)).digest('hex').slice(0, 32)
const runOf = (principal) => principal.runId || 'token:' + principal.tokenId

// A suggestion an invited agent is showing on the slate (a ghost note, not saved yet) is drawn
// under ghost-<id>, where the server made the id: a pointer may point at it too.
export const GHOST_TARGET = /^ghost-ag[0-9a-f]{16}$/

/** A record as a screen receives it: the public fields only, its targets those on this slate. */
export function publicRecord(doc, slateIds) {
  const out = {}
  for (const field of PUBLIC_FIELDS) if (doc[field] !== undefined) out[field] = doc[field]
  out.targets = (Array.isArray(doc.targets) ? doc.targets : []).filter((id) => slateIds.has(id) || GHOST_TARGET.test(id))
  return out
}

/** The ids a record may point at on this slate: its notes, and its workshop's cards and lanes as drawn. */
export function slateTargetIds(slate) {
  const ids = new Set()
  for (const node of slate?.nodes || []) if (typeof node?.options?.id === 'string') ids.add(node.options.id)
  const workshop = slate?.creative?.model?.workshop
  for (const card of workshop?.cards || []) ids.add('card-' + card.id)
  for (const lane of workshop?.lanes || []) ids.add('lane-' + lane.id)
  return ids
}

/**
 * The presence store. collection: a MongoDB driver collection. findUser(userId) and
 * findToken(tokenId) read the owner's account and the token's lastClient. secret: the HMAC key.
 */
export function createAgentPresence({
  collection,
  findUser,
  findToken = async () => null,
  secret,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
  log = (line) => console.error(line),
}) {
  if (!secret) throw new Error('agent presence needs a secret')
  // The key may be read from the database once, on first use.
  let key = typeof secret === 'function' ? null : secret
  const keyOf = async () => (key ??= await secret())
  // Coalescing, per record: when it was last written, and the latest write still waiting.
  const pacing = new Map()

  // Who an agent is on this slate, as everyone there sees it: its name, colour and where it comes
  // from. agentId stays the same across the agent's runs on this slate (never across slates).
  async function identity(principal, slate) {
    const who = await name(principal, slate)
    return { ...who, agentId: who.agentKey }
  }

  async function name(principal, slate) {
    // An outside agent a person invited (Slatebox Cloud builds this principal): the name the person
    // gave it, never the server's own words alone, then "added by" the person who invited it.
    if (principal.connector) {
      const [user] = await Promise.all([findUser(principal.userId).catch(() => null)])
      const label = sanitizeClientName(principal.connector.name) || 'Invited agent'
      const agentKey = agentKeyFor(await keyOf(), 'connector:' + principal.connector.id, slate._id)
      return {
        agentKey, label, initial: label.charAt(0).toUpperCase(),
        // the colour its chip and ghost suggestions wear too, chosen when it was invited
        colorIndex: Number.isInteger(principal.connector.colorIndex) ? principal.connector.colorIndex % PALETTE_SIZE : Number.parseInt(agentKey.slice(0, 4), 16) % PALETTE_SIZE,
        origin: 'invited', invitedBy: firstNameOf(user), via: null,
        iconUrl: safeIconUrl(principal.connector.iconUrl),
      }
    }
    // The Slatebox agent (server/agents/teammate.mjs) is named by the server alone: no client can
    // wear the name (sanitizeClientName refuses "Slatebox"), and it keeps one colour on every slate.
    if (principal.builtin === 'slatebox')
      return { agentKey: agentKeyFor(await keyOf(), principal.tokenId, slate._id), label: SLATEBOX_AGENT_LABEL, initial: 'S', colorIndex: 0, origin: 'slatebox', via: null, invitedBy: null, iconUrl: null }
    const [user, token] = await Promise.all([
      findUser(principal.userId).catch(() => null),
      principal.tokenId && !String(principal.tokenId).startsWith('session:') ? findToken(principal.tokenId).catch(() => null) : null,
    ])
    let first = firstNameOf(user)
    // Someone's agent on another person's slate whose name reads as that person's ("Ada" on
    // Ada's slate) is told apart by an initial: "Ada B.'s agent".
    if (slate.userId && slate.userId !== principal.userId) {
      const owner = await findUser(slate.userId).catch(() => null)
      const initial = owner && sameName(firstNameOf(owner), first) ? initialOf(user) : ''
      if (initial) first = first + ' ' + initial + '.'
    }
    const agentKey = agentKeyFor(await keyOf(), principal.tokenId, slate._id)
    return {
      agentKey,
      label: agentLabel(first, token?.lastClient),
      initial: first.charAt(0).toUpperCase(),
      colorIndex: Number.parseInt(agentKey.slice(0, 4), 16) % PALETTE_SIZE,
      // A visiting agent: its own MCP client (Claude, ChatGPT, a command line) calling Slatebox.
      origin: 'visiting',
      via: sanitizeClientName(token?.lastClient) || null,
      invitedBy: null,
      iconUrl: null,
    }
  }

  const isAgent = (principal) => principal?.kind === 'agent' && (principal.tokenId || principal.connector) && principal.userId

  // A run that ended stays ended: a call of it still running when it ended (a script that timed
  // out lets a pending save finish) saves its change, but its pointer does not come back. Null then.
  async function upsert(principal, slate, set, extra = {}) {
    const at = now()
    const _id = recordId(runOf(principal), slate._id)
    const existing = await collection.findOne({ _id }, { projection: { runEnded: 1 } })
    if (existing?.runEnded) return null
    const who = await identity(principal, slate)
    let doc
    try {
      doc = await collection.findOneAndUpdate(
        { _id, runEnded: { $ne: true } },
        {
          $set: { ...who, status: 'live', updatedAt: new Date(at), expiresAt: new Date(at + PRESENCE_LIMITS.silentMs), ...set },
          $unset: { endedAt: '' },
          $setOnInsert: {
            slateId: slate._id, runId: runOf(principal), ownerId: principal.userId, createdAt: new Date(at),
            publicId: createHmac('sha256', await keyOf()).update('record:' + _id).digest('hex').slice(0, 16),
            ...extra.onInsert,
          },
          ...(extra.inc && { $inc: extra.inc }),
        },
        { upsert: true, returnDocument: 'after' }
      )
    } catch (error) {
      // The run ended between the read and the write: the filter missed and the insert met its id.
      if (error?.code === 11000) return null
      throw error
    }
    await capOwner(principal.userId, slate._id, at)
    return doc?.value !== undefined && doc?.ok !== undefined ? doc.value : doc
  }

  // At most three live agents of one owner on one slate: the oldest is ended.
  async function capOwner(ownerId, slateId, at) {
    const live = await collection
      .find({ ownerId, slateId, status: 'live' }, { projection: { _id: 1, updatedAt: 1 }, sort: { updatedAt: -1 } })
      .toArray()
    for (const old of live.slice(PRESENCE_LIMITS.livePerOwner))
      await finish(old._id, 'done', at)
  }

  // ended: the run itself ended (exec's end), so nothing of it shows again. A record the owner
  // cap ends may come back when its run saves again.
  async function finish(_id, outcome, at, ended = false) {
    const doc = await collection.findOne({ _id })
    if (!doc) return
    if (doc.status !== 'live') {
      if (ended && !doc.runEnded) await collection.updateOne({ _id }, { $set: { runEnded: true } })
      return
    }
    const plan = doc.plan
      ? {
          ...doc.plan,
          steps: doc.plan.steps.map((step) =>
            step.status === 'doing' ? { ...step, status: outcome === 'stopped' ? 'stopped' : 'done' } : step
          ),
        }
      : doc.plan
    await collection.updateOne(
      { _id, status: 'live' },
      { $set: { status: outcome, plan, endedAt: new Date(at), updatedAt: new Date(at), expiresAt: new Date(at + PRESENCE_LIMITS.endedMs), ...(ended && { runEnded: true }) } }
    )
  }

  /**
   * After a saved write: the pointer goes to what it touched. targets: note ids, or card-<id>
   * and lane-<id>. message: the save's plan.message, shown when the run sent no plan.
   */
  async function saved(principal, slate, { targets = [], message = '', point = null, say = '' } = {}) {
    if (!isAgent(principal) || !slate?._id) return
    const _id = recordId(runOf(principal), slate._id)
    const said = cleanStepText(say).slice(0, SAY_CHARS)
    const write = {
      targets: [...new Set(targets.filter((id) => typeof id === 'string' && id))].slice(0, PRESENCE_LIMITS.targets),
      message: cleanStepText(message),
      // The spot the pointer goes to first (where a suggestion lands), and what it says there.
      point: finitePoint(point),
      say: said || null,
      sayAt: said ? new Date(now()) : null,
    }
    const at = now()
    forget(at)
    const pace = pacing.get(_id) || { lastAt: -Infinity, pending: null, timer: null }
    pacing.set(_id, pace)
    if (at - pace.lastAt >= PRESENCE_LIMITS.writeGapMs && !pace.timer) {
      pace.lastAt = at
      await upsert(principal, slate, write)
      return
    }
    // Too soon: the latest write waits for the gap, and replaces any write already waiting.
    pace.pending = { principal, slate, write }
    if (!pace.timer)
      pace.timer = setTimer(() => flush(_id).catch((error) => log('[presence] ' + error?.message)), Math.max(0, pace.lastAt + PRESENCE_LIMITS.writeGapMs - at))
  }

  // A run that is never ended (a raw API token's) leaves its pacing entry behind: entries with
  // nothing waiting and no write for as long as a silent record lasts are dropped.
  function forget(at) {
    for (const [id, pace] of pacing)
      if (!pace.timer && !pace.pending && at - pace.lastAt > PRESENCE_LIMITS.silentMs) pacing.delete(id)
  }

  async function flush(_id) {
    const pace = pacing.get(_id)
    if (!pace) return
    if (pace.timer) clearTimer(pace.timer)
    pace.timer = null
    const pending = pace.pending
    pace.pending = null
    if (!pending) return
    pace.lastAt = now()
    await upsert(pending.principal, pending.slate, pending.write)
  }

  /** presence.plan: 1 to 8 steps; the first is under way. At most 3 per run. */
  async function plan(principal, slate, steps) {
    const cleaned = Array.isArray(steps) ? steps.map(cleanStepText) : []
    if (!cleaned.length || cleaned.length > PRESENCE_LIMITS.planSteps || cleaned.some((text) => !text))
      throw problem(400, 'invalid_request', 'Send 1 to 8 steps of 1 to 80 plain characters.')
    const _id = recordId(runOf(principal), slate._id)
    const current = await collection.findOne({ _id }, { projection: { planCount: 1, runEnded: 1 } })
    if (current?.runEnded) throw problem(409, 'run_ended', 'This run has ended. A new run sets its own plan.')
    if ((current?.planCount ?? 0) >= PRESENCE_LIMITS.plans)
      throw problem(429, 'presence_limit', `A run sets its plan at most ${PRESENCE_LIMITS.plans} times.`)
    await flush(_id)
    const doc = await upsert(
      principal,
      slate,
      { plan: { steps: cleaned.map((text, index) => ({ text, status: index === 0 ? 'doing' : 'todo' })), current: 0 } },
      { inc: { planCount: 1 } }
    )
    return publicPlan(doc)
  }

  /**
   * presence.step: mark one step doing, done or skipped. A step still under way is done when
   * another step starts; when a step finishes and nothing is under way, the next one starts.
   */
  async function step(principal, slate, index, status) {
    if (!['doing', 'done', 'skipped'].includes(status)) throw problem(400, 'invalid_request', 'status is doing, done or skipped.')
    const _id = recordId(runOf(principal), slate._id)
    await flush(_id)
    const doc = await collection.findOne({ _id })
    if (doc?.runEnded) throw problem(409, 'run_ended', 'This run has ended. A new run sets its own plan.')
    if (!doc?.plan?.steps?.length) throw problem(409, 'no_plan', 'Set a plan with presence.plan first.')
    if (!Number.isInteger(index) || index < 0 || index >= doc.plan.steps.length)
      throw problem(400, 'invalid_request', `index is 0 to ${doc.plan.steps.length - 1}.`)
    if ((doc.stepCount ?? 0) >= PRESENCE_LIMITS.steps)
      throw problem(429, 'presence_limit', `A run ticks its steps at most ${PRESENCE_LIMITS.steps} times.`)
    const steps = doc.plan.steps.map((item, i) =>
      i !== index && item.status === 'doing' && status === 'doing' ? { ...item, status: 'done' } : { ...item }
    )
    steps[index].status = status
    if (status !== 'doing') {
      for (let i = 0; i < steps.length; i++) if (i !== index && steps[i].status === 'doing') steps[i].status = 'done'
      const next = steps.findIndex((item, i) => i > index && item.status === 'todo')
      if (next >= 0) steps[next].status = 'doing'
    }
    const doing = steps.findIndex((item) => item.status === 'doing')
    const updated = await upsert(principal, slate, { plan: { steps, current: doing >= 0 ? doing : index } }, { inc: { stepCount: 1 } })
    return publicPlan(updated)
  }

  const publicPlan = (doc) => ({ steps: doc?.plan?.steps ?? [], current: doc?.plan?.current ?? 0 })

  /** A run ended: what was under way is done (or stopped, when the run failed); screens fade it. */
  async function end(runId, outcome = 'done') {
    if (!runId) return
    // Every record of the run, live or not: one the owner cap already ended is marked ended too.
    const docs = await collection.find({ runId }, { projection: { _id: 1 } }).toArray()
    const at = now()
    for (const { _id } of docs) {
      await flush(_id).catch(() => {})
      await finish(_id, outcome === 'stopped' ? 'stopped' : 'done', at, true)
      pacing.delete(_id)
    }
  }

  async function ensureIndexes() {
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 60 })
    await collection.createIndex({ slateId: 1 })
    await collection.createIndex({ runId: 1, status: 1 })
    await collection.createIndex({ ownerId: 1, slateId: 1, status: 1 })
  }

  // pacingSize: how many runs are paced now (for tests).
  // identify: who an agent is on a slate (its suggestions are filed under the same name).
  return { saved, plan, step, end, flush, ensureIndexes, identify: identity, pacingSize: () => pacing.size }
}

/**
 * What one reader receives for one slate: the records of that slate only, public fields only,
 * targets filtered to ids on it. resolve(shareId, userId) answers the slate a reader may read
 * (the check creativeSlates.state makes) or null; list(slateId) the stored records.
 */
export function createPresenceReader({ resolve, list, ghosts = async () => [], now = Date.now }) {
  return async function read(shareId, userId) {
    const slate = await resolve(shareId, userId)
    if (!slate?._id) return null
    const ids = slateTargetIds(slate)
    // An agent's pointer may point at its own suggestion before anyone keeps it: the ghost of a
    // note still waiting on this slate (ghost-<id>, as the engine names it).
    for (const id of await ghosts(slate._id)) ids.add(id)
    const at = now()
    const docs = await list(slate._id)
    return {
      slateId: slate._id,
      records: docs
        .filter((doc) => doc.slateId === slate._id && new Date(doc.expiresAt).getTime() > at)
        // A screen knows each run by its own public id (two runs of one token are two pointers);
        // its colour still comes from the token's key on this slate.
        .map((doc) => ({ _id: doc.publicId ?? doc.agentKey, ...publicRecord(doc, ids), agentKey: doc.publicId ?? doc.agentKey })),
    }
  }
}
