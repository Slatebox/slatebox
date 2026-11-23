// Agent tasks: the work people and agents hand to agents on a slate, and the one place two or
// more agents see each other's work. A person asks (an @Slatebox comment, the panel, or
// ask_agent from any MCP client, the CLI or the API); an agent claims a task (one at a time, on
// a lease), works through exec as usual, writes notes to the task's log, and finishes it or hands
// it to another agent. The Slatebox agent (server/agents/teammate.mjs) takes tasks assigned to it.
//
// States are A2A's TaskState names (submitted, working, input-required, completed, failed,
// canceled), so an A2A adapter can serve these records as they are.
//
// Every change is a compare-and-set on the task's rev: two agents claiming at once, one wins.
// What a reader receives is publicTask(): labels only, never a token, an account id or the writes
// a held task keeps for its approval.
import { problem } from '../actions/errors.mjs'

export const TASK_LIMITS = Object.freeze({
  openPerSlate: 20,
  logEntries: 100,
  textChars: 500,
  leaseMs: 5 * 60_000,
  // Every task is deleted this long after its last change, open or ended.
  keepMs: 30 * 24 * 3600_000,
})
export const TASK_STATES = Object.freeze(['submitted', 'working', 'input-required', 'completed', 'failed', 'canceled'])
export const OPEN_STATES = Object.freeze(['submitted', 'working', 'input-required'])
export const ASSIGNEES = Object.freeze(['slatebox', 'any'])
export const SLATEBOX_AGENT = Object.freeze({ key: 'slatebox', label: 'Slatebox agent' })

// Control and direction characters, zero-width characters: never shown.
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/gu

/** Task and log text as it may be shown: plain text, no markup, at most 500 characters. */
export function cleanTaskText(raw) {
  if (typeof raw !== 'string') return ''
  return raw.normalize('NFKC').replace(INVISIBLE, '').replace(/[<>]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, TASK_LIMITS.textChars).trim()
}

/**
 * A task as a screen or an agent reads it. callerKey: the reader's claim key, so an agent can
 * tell its own claim ("yours") without seeing anyone's key.
 */
export function publicTask(doc, { callerKey = null, now = Date.now() } = {}) {
  if (!doc) return null
  const claim = doc.claim && new Date(doc.claim.until).getTime() > now ? doc.claim : null
  return {
    id: doc._id,
    shareId: doc.shareId,
    status: doc.status,
    text: doc.text,
    assignee: doc.assignee,
    askedBy: doc.askedBy?.label ?? 'Someone',
    ...(doc.nodeId && { nodeId: doc.nodeId }),
    claimedBy: claim?.label ?? null,
    yours: Boolean(claim && callerKey && claim.key === callerKey),
    ...(doc.waiting && { waiting: doc.waiting }),
    log: (doc.log || []).map(({ at, by, kind, text }) => ({ at: new Date(at).toISOString(), by, kind, text })),
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  }
}

/**
 * The store. collection: a MongoDB driver collection (agentTasks). newId(): a task id.
 */
export function createAgentTasks({ collection, now = Date.now, newId }) {
  if (!collection || typeof newId !== 'function') throw new Error('agent tasks need a collection and newId')

  const entry = (by, kind, text) => ({ at: new Date(now()), by, kind, text: cleanTaskText(text) })
  const leaseLive = (doc) => Boolean(doc.claim && new Date(doc.claim.until).getTime() > now())

  async function load(slateId, taskId) {
    const doc = typeof taskId === 'string' ? await collection.findOne({ _id: taskId }) : null
    if (!doc || doc.slateId !== slateId) throw problem(404, 'not_found', 'There is no such task on this slate.')
    return doc
  }

  // One change: compare-and-set on rev. The log keeps its last 100 entries.
  async function change(doc, set, logEntry, unset = null) {
    const at = new Date(now())
    const log = [...(doc.log || []), ...(logEntry ? [logEntry] : [])].slice(-TASK_LIMITS.logEntries)
    const update = {
      $set: { ...set, log, updatedAt: at, expiresAt: new Date(at.getTime() + TASK_LIMITS.keepMs) },
      $inc: { rev: 1 },
      ...(unset && { $unset: unset }),
    }
    const result = await collection.updateOne({ _id: doc._id, rev: doc.rev }, update)
    if (!result?.matchedCount) throw problem(409, 'task_changed', 'Someone else changed this task. Read it again.')
    return collection.findOne({ _id: doc._id })
  }

  /**
   * A person or an agent asks. by: { userId, label }. assignee: 'slatebox' (the Slatebox agent
   * starts on it) or 'any' (open for any agent to claim).
   */
  async function create({ slate, by, text, assignee = 'any', nodeId = null, commentId = null }) {
    const cleaned = cleanTaskText(text)
    if (!cleaned) throw problem(400, 'invalid_request', 'Say what the agent should do, in 1 to 500 characters.')
    if (!ASSIGNEES.includes(assignee)) throw problem(400, 'invalid_request', 'assignee is "slatebox" or "any".')
    const open = await collection.find({ slateId: slate._id, status: { $in: [...OPEN_STATES] } }).toArray()
    if (open.length >= TASK_LIMITS.openPerSlate)
      throw problem(429, 'task_limit', `A slate has at most ${TASK_LIMITS.openPerSlate} open agent tasks. Finish or cancel one first.`)
    const at = new Date(now())
    const doc = {
      _id: newId(),
      slateId: slate._id,
      shareId: slate.shareId,
      status: 'submitted',
      text: cleaned,
      assignee,
      // Whose rights the Slatebox agent works with: the person who last assigned it the task.
      assignedBy: by.userId,
      askedBy: { userId: by.userId, label: by.label },
      nodeId: typeof nodeId === 'string' ? nodeId.slice(0, 64) : null,
      commentId: typeof commentId === 'string' ? commentId.slice(0, 64) : null,
      claim: null,
      log: [entry(by.label, 'asked', cleaned)],
      rev: 0,
      createdAt: at,
      updatedAt: at,
      expiresAt: new Date(at.getTime() + TASK_LIMITS.keepMs),
    }
    await collection.insertOne(doc)
    return doc
  }

  async function list(slateId, { open = true } = {}) {
    const rows = await collection.find({ slateId, ...(open && { status: { $in: [...OPEN_STATES] } }) }, { sort: { createdAt: 1 } }).toArray()
    return rows
  }

  /**
   * An agent takes a task: one claimant at a time, for a lease. claimant: { key, label, builtin }.
   * The Slatebox agent claims tasks assigned to it; an outside agent claims open ("any") tasks.
   * A claim whose lease lapsed may be taken over.
   */
  async function claim(slateId, taskId, claimant) {
    const doc = await load(slateId, taskId)
    if (!OPEN_STATES.includes(doc.status)) throw problem(409, 'task_closed', 'This task is finished.')
    if (doc.status === 'input-required') throw problem(409, 'task_waiting', 'This task is waiting for a person to approve or cancel it.')
    if (leaseLive(doc) && doc.claim.key !== claimant.key)
      throw problem(409, 'task_claimed', `${doc.claim.label} is on this task.`, { details: { claimedBy: doc.claim.label } })
    const wanted = claimant.builtin ? 'slatebox' : 'any'
    if (doc.assignee !== wanted)
      throw problem(409, 'task_assigned', doc.assignee === 'slatebox' ? 'This task is for the Slatebox agent. Hand-offs come back as open tasks.' : 'This task is open to outside agents.')
    const until = new Date(now() + TASK_LIMITS.leaseMs)
    return change(doc, { status: 'working', claim: { key: claimant.key, label: claimant.label, until } }, entry(claimant.label, 'claimed', 'Started on it'))
  }

  const holds = (doc, claimant) => leaseLive(doc) && doc.claim.key === claimant.key

  /** The claimant writes to the shared log, and renews its lease. */
  async function note(slateId, taskId, claimant, text) {
    const doc = await load(slateId, taskId)
    if (!holds(doc, claimant)) throw problem(409, 'not_claimed', 'Claim the task before writing to it.')
    if (!cleanTaskText(text)) throw problem(400, 'invalid_request', 'Write a note of 1 to 500 characters.')
    return change(doc, { claim: { ...doc.claim, until: new Date(now() + TASK_LIMITS.leaseMs) } }, entry(claimant.label, 'note', text))
  }

  /** The claimant is still at it: its lease runs on, with nothing written to the log. */
  async function renew(slateId, taskId, claimant) {
    const doc = await load(slateId, taskId)
    if (!holds(doc, claimant) || doc.status !== 'working') throw problem(409, 'not_claimed', 'This task is no longer yours to work.')
    return change(doc, { claim: { ...doc.claim, until: new Date(now() + TASK_LIMITS.leaseMs) } }, null)
  }

  /** Whether the claimant still holds this task and may go on with it. */
  async function stillHolds(slateId, taskId, claimant) {
    const doc = await collection.findOne({ _id: taskId })
    return Boolean(doc && doc.slateId === slateId && doc.status === 'working' && holds(doc, claimant))
  }

  /**
   * Claims that lapsed while a task was being worked (a crash, a lost agent): a task for the
   * Slatebox agent fails with the reason, so its slot is free; an outside agent's task opens again
   * for any agent. isRunning(taskId): a run this server still has going is left alone.
   */
  async function expireClaims({ isRunning = () => false, limit = 100 } = {}) {
    const rows = await collection.find({ status: 'working', 'claim.until': { $lt: new Date(now()) } }).toArray()
    const expired = []
    for (const doc of rows.slice(0, limit)) {
      if (isRunning(doc._id)) continue
      const builtin = doc.assignee === 'slatebox'
      const done = await change(
        doc,
        builtin ? { status: 'failed', claim: null } : { status: 'submitted', claim: null },
        entry(doc.claim?.label || 'Slatebox', builtin ? 'failed' : 'expired', builtin ? 'The agent stopped before it finished. Ask again.' : 'The claim lapsed; open for any agent again.')
      ).catch(() => null)
      if (done) expired.push(done)
    }
    return expired
  }

  /** A slate was deleted: its tasks go with it. */
  async function removeForSlate(slateId) {
    if (typeof collection.deleteMany === 'function') await collection.deleteMany({ slateId })
  }

  /**
   * Hand the task on: to the Slatebox agent, or back to any agent. The claimant hands off its own
   * task; a task no one holds may be handed on by anyone who may edit the slate (actor.person).
   * assignedBy becomes the handing principal's account: the Slatebox agent never works with more
   * rights than whoever gave it the task.
   */
  async function handoff(slateId, taskId, actor, { to, text = '' }) {
    if (!ASSIGNEES.includes(to)) throw problem(400, 'invalid_request', 'to is "slatebox" or "any".')
    const doc = await load(slateId, taskId)
    if (!OPEN_STATES.includes(doc.status) || doc.status === 'input-required')
      throw problem(409, 'task_closed', 'Only a task that is waiting for an agent or being worked on can be handed on.')
    if (leaseLive(doc) ? doc.claim.key !== actor.key : !actor.person)
      throw problem(409, 'not_claimed', leaseLive(doc) ? `${doc.claim.label} is on this task.` : 'Claim the task before handing it on.')
    const said = cleanTaskText(text)
    const where = to === 'slatebox' ? 'the Slatebox agent' : 'any agent'
    return change(
      doc,
      { status: 'submitted', assignee: to, claim: null, assignedBy: actor.userId },
      entry(actor.label, 'handoff', said ? `Handed to ${where}: ${said}` : `Handed to ${where}`)
    )
  }

  /**
   * A step that needs a person: the task waits (input-required) with what it would do. held (the
   * writes to save on approval) is kept as JSON text, server-side only.
   */
  async function hold(slateId, taskId, claimant, { summary, held }) {
    const doc = await load(slateId, taskId)
    if (!holds(doc, claimant)) throw problem(409, 'not_claimed', 'Claim the task before holding it.')
    return change(doc, { status: 'input-required', claim: null, waiting: cleanTaskText(summary), held: JSON.stringify(held ?? null) }, entry(claimant.label, 'held', `Waiting for you: ${summary}`))
  }

  /** The claimant finishes: completed or failed, with what happened. */
  async function finish(slateId, taskId, claimant, outcome, text = '') {
    if (!['completed', 'failed'].includes(outcome)) throw problem(400, 'invalid_request', 'outcome is completed or failed.')
    const doc = await load(slateId, taskId)
    if (!holds(doc, claimant)) throw problem(409, 'not_claimed', 'Claim the task before finishing it.')
    return change(doc, { status: outcome, claim: null }, entry(claimant.label, outcome === 'completed' ? 'done' : 'failed', text || (outcome === 'completed' ? 'Done' : 'Could not finish')), { waiting: '', held: '' })
  }

  /**
   * A person approves a held task: it goes back to the Slatebox agent, claimed, with the writes it
   * held (returned once, to the runner, never published). Only a person approves.
   */
  async function approve(slateId, taskId, person) {
    const doc = await load(slateId, taskId)
    if (doc.status !== 'input-required') throw problem(409, 'task_not_waiting', 'This task is not waiting for approval.')
    const until = new Date(now() + TASK_LIMITS.leaseMs)
    const updated = await change(
      doc,
      { status: 'working', claim: { key: SLATEBOX_AGENT.key, label: SLATEBOX_AGENT.label, until }, assignedBy: person.userId },
      entry(person.label, 'approved', 'Approved'),
      { waiting: '', held: '' }
    )
    let held = null
    try {
      held = JSON.parse(doc.held || 'null')
    } catch {
      held = null
    }
    return { task: updated, held }
  }

  /** Cancel: a person (any open task), or the claimant (its own). */
  async function cancel(slateId, taskId, actor, text = '') {
    const doc = await load(slateId, taskId)
    if (!OPEN_STATES.includes(doc.status)) throw problem(409, 'task_closed', 'This task is finished.')
    if (!actor.person && !holds(doc, actor)) throw problem(409, 'not_claimed', 'Only a person, or the agent on it, can cancel this task.')
    return change(doc, { status: 'canceled', claim: null }, entry(actor.label, 'canceled', text || 'Canceled'), { waiting: '', held: '' })
  }

  async function ensureIndexes() {
    await collection.createIndex({ slateId: 1, status: 1, createdAt: 1 })
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  }

  return { create, list, load, claim, renew, stillHolds, note, handoff, hold, finish, approve, cancel, expireClaims, removeForSlate, ensureIndexes }
}
