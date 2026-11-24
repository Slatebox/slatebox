// The Slatebox agent: takes the agent tasks assigned to it and does them in the open.
//   claim → show its plan (its own pointer, "Slatebox agent") → preview the change through the
//   in-app conversation's path (AI when the person may draft, else the direct path) → if the
//   preview removes notes or would be held by the exec gate, wait for a person (input-required)
//   → else save it (the pointer glides to what changed) → reply where it was asked → complete.
//
// It has no rights of its own: every call runs as the person who last assigned it the task
// (task.assignedBy), through the same registry and checks as that person's own exec runs, on
// this one slate. What it reports is written from what the writes did (describeWrites), never
// from the model's words.
import { createHash, randomBytes } from 'node:crypto'
import { deriveKey, newExecId as defaultExecId } from '../exec/keys.mjs'
import { SLATEBOX_AGENT } from './agentTasks.mjs'
import { promptText } from '../ai-control/prompts/index.mjs'

export const TEAMMATE_PLAN = Object.freeze(['Read the request', 'Make the change', 'Report back'])
const CLAIMANT = Object.freeze({ key: SLATEBOX_AGENT.key, label: SLATEBOX_AGENT.label, builtin: true })

/** The principal a task runs as: the assigning person's account, as the Slatebox agent, one run. */
export const teammatePrincipal = (task, runId) => ({
  kind: 'agent',
  userId: task.assignedBy,
  tokenId: 'agent:slatebox:' + task._id,
  tokenName: SLATEBOX_AGENT.label,
  scopes: ['slates:read', 'slates:write'],
  runId,
  builtin: 'slatebox',
})

// One line of text: every run of whitespace, line or paragraph separator and control character
// (escape sequences included) becomes one space, so nothing written can start a line of its own.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu
export const oneLine = (text, max = 500) => String(text ?? '').normalize('NFKC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

// The words the model is given: the request on one line, then (on the AI path) other agents'
// notes as a JSON array of { by, text } on one line, labelled as data. JSON escapes quotes and
// brackets; oneLine has already removed anything that could end the line.
export function requestText(task, withNotes) {
  const request = oneLine(task.text, 500)
  const notes = withNotes ? (task.log || []).filter((entry) => entry.kind === 'handoff' || entry.kind === 'note').slice(-3) : []
  if (!notes.length) return request
  const data = []
  for (const entry of notes) {
    data.push({ by: oneLine(entry.by, 60), text: oneLine(entry.text, 300) })
    while (JSON.stringify(data).length > 1000) data.shift()
  }
  if (!data.length) return request
  // the envelope is a prompt an administrator can edit (agent.request.notes)
  return promptText('agent.request.notes', { request, notes: JSON.stringify(data) })
}

// ---- what a held change touches ------------------------------------------------------------
// At the hold, every object the held writes act on gets a content hash: each note the writes name
// (by id, or by its exact text), each line to or from such a note, and the workshop when a write
// edits it. An approval saves only if every hash is unchanged, so nothing anyone did since the
// hold is overwritten; changes elsewhere on the slate do not stop it.
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' && !(value instanceof Date)
      ? `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value instanceof Date ? value.toISOString() : value ?? null)
const digest = (value) => createHash('sha256').update(canonical(value)).digest('base64url').slice(0, 22)

function stringsIn(value, out = new Set()) {
  if (typeof value === 'string') out.add(value).add(plain(value))
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) stringsIn(item, out)
  return out
}
const mentionsWorkshop = (value) =>
  Boolean(value && typeof value === 'object' && (Array.isArray(value) ? value.some(mentionsWorkshop) : Object.entries(value).some(([key, item]) => key === 'workshop' || /workshop|card|lane/.test(String(value.kind ?? '')) || mentionsWorkshop(item))))

/** { revision, objects: { 'note:<id>' | 'line:<id>' | 'workshop': hash } } for the writes. */
export function touchedState(board, writes) {
  const inputs = (writes || []).map((write) => write.input)
  const named = stringsIn(inputs)
  const objects = {}
  const ids = new Set()
  for (const node of board?.nodes || []) {
    const id = node?.options?.id
    if (!id || !(named.has(id) || (node.options.text && named.has(plain(node.options.text))))) continue
    ids.add(id)
    objects['note:' + id] = digest(node.options)
  }
  for (const node of board?.nodes || [])
    for (const line of node?.relationships?.associations || [])
      if (ids.has(line?.parentId) || ids.has(line?.childId)) objects['line:' + (line.id ?? `${line.parentId}->${line.childId}`)] = digest(line)
  if (mentionsWorkshop(inputs)) objects.workshop = digest(board?.creative ?? null)
  return { revision: board?.revision ?? 0, objects }
}

/** The touched objects that are different now (missing, edited, moved), as plain names. */
export function changedSince(board, touched) {
  if (!touched?.objects) return ['the slate']
  const now = new Map()
  for (const node of board?.nodes || []) {
    const id = node?.options?.id
    if (id) now.set('note:' + id, { hash: digest(node.options), name: `the note "${plain(node.options.text).slice(0, 40) || id}"` })
    for (const line of node?.relationships?.associations || [])
      now.set('line:' + (line.id ?? `${line.parentId}->${line.childId}`), { hash: digest(line), name: 'a line' })
  }
  now.set('workshop', { hash: digest(board?.creative ?? null), name: 'the workshop' })
  const changed = []
  for (const [key, hash] of Object.entries(touched.objects)) {
    const found = now.get(key)
    if (!found) changed.push(key.startsWith('note:') ? 'a note it changes (since removed)' : key.startsWith('line:') ? 'a line (since removed)' : 'the workshop')
    else if (found.hash !== hash) changed.push(found.name)
  }
  return [...new Set(changed)]
}

// A request id as the conversation takes one: 17 letters and digits.
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export const requestId = () => [...randomBytes(17)].map((byte) => ALNUM[byte % ALNUM.length]).join('')

const plain = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** What a held preview would do, in plain words, from the writes themselves. */
export function heldSummary(preview) {
  const parts = []
  if (preview.removed?.length) parts.push(`remove ${plural(preview.removed.length, 'note', 'notes')} (${preview.removed.map((r) => `"${String(r.text).slice(0, 40)}"`).join(', ')})`)
  const rules = [...new Set((preview.warnings || []).map((w) => w.rule))].filter((rule) => rule !== 'removes')
  if (rules.length) parts.push(`go ahead past ${rules.join(', ')}`)
  return parts.join(' and ') || 'make this change'
}

/** What a saved preview did, in plain words. */
export function doneSummary(preview) {
  const parts = [...(preview.labels || [])]
  if (preview.links) parts.push(`Connects ${plural(preview.links, 'line', 'lines')}`)
  for (const change of preview.changes || []) parts.push(`Rewrites "${String(change.before).slice(0, 30)}"`)
  return parts.length ? parts.join('; ').slice(0, 400) : 'Done; nothing on the slate needed to change.'
}

/**
 * tasks: the agentTasks store. registry: a registry that authorizes the principal by its
 * account's session rule. conversation: { preview } (exec/conversation.mjs). resolveBoard(shareId,
 * userId): the slate if that account may edit it, else null. draft({ userId, shareId, text }, fn):
 * runs fn({ useAI, model }) inside the meter when the account may draft, else fn({ useAI: false }).
 * reply({ task, text }) answers where the task was asked; notify({ task, text }) tells the asker.
 */
export function createTeammate({
  tasks,
  registry,
  conversation,
  resolveBoard,
  draft = (_who, fn) => fn({ useAI: false, model: null }),
  presence = null,
  reply = async () => {},
  notify = async () => {},
  // admit(task): null to go ahead, or the sentence that says why this run will not start (the
  // person's daily cap on Slatebox Cloud).
  admit = async () => null,
  newExecId = defaultExecId,
  log = (line) => console.error(line),
}) {
  const running = new Set()

  async function step(principal, shareId, index, status) {
    await registry.run(principal, 'presence.step', { shareId, index, status }).catch(() => {})
  }

  async function report(task, text) {
    await reply({ task, text }).catch((error) => log('[teammate] reply: ' + error?.message))
    await notify({ task, text }).catch((error) => log('[teammate] notify: ' + error?.message))
  }

  // Saves the previewed writes as this run, in order; a retry with the same keys replays.
  async function save(principal, writes, execId) {
    const subject = principal.tokenId
    for (const write of writes)
      await registry.run(principal, write.method, { ...write.input, mode: 'save' }, { idempotencyKey: deriveKey(subject, execId, write.n) })
  }

  const failText = (error) =>
    ['slate_changed', 'no_match', 'id_taken'].includes(error?.code)
      ? 'The slate changed while I worked. Ask again and I will start from what is there now.'
      : String(error?.reason || error?.message || 'Something went wrong.').slice(0, 300)

  async function finishFailed(task, text) {
    const done = await tasks.finish(task.slateId, task._id, CLAIMANT, 'failed', text).catch(() => null)
    await report(done || task, `I could not finish "${task.text.slice(0, 60)}": ${text}`)
  }

  /** Works one task assigned to the Slatebox agent. Resolves when it is done or waiting. */
  async function run(task) {
    if (running.has(task._id)) return null
    running.add(task._id)
    let claimed
    try {
      claimed = await tasks.claim(task.slateId, task._id, CLAIMANT)
    } catch (error) {
      running.delete(task._id)
      log('[teammate] not claimed: ' + error?.code)
      return null
    }
    const runId = newExecId()
    const principal = teammatePrincipal(claimed, runId)
    const shareId = claimed.shareId
    let outcome = 'stopped'
    // A person may cancel while it works: before anything is saved, the task must still be its.
    const mine = () => tasks.stillHolds ? tasks.stillHolds(claimed.slateId, claimed._id, CLAIMANT) : true
    try {
      const refused = await admit(claimed)
      if (refused) {
        await finishFailed(claimed, refused)
        return tasks.load(claimed.slateId, claimed._id)
      }
      const board = await resolveBoard(shareId, claimed.assignedBy)
      if (!board) {
        await finishFailed(claimed, 'The person who asked can no longer edit this slate.')
        return tasks.load(claimed.slateId, claimed._id)
      }
      await registry.run(principal, 'presence.plan', { shareId, steps: [...TEAMMATE_PLAN] }).catch((error) => log('[teammate] plan: ' + error?.code))
      let preview
      try {
        preview = await draft({ userId: claimed.assignedBy, shareId, text: claimed.text, board }, ({ useAI, model }) =>
          conversation.preview({ principal, shareId, board, message: requestText(claimed, useAI), useAI, model, id: requestId() }))
      } catch (error) {
        await finishFailed(claimed, failText(error))
        return tasks.load(claimed.slateId, claimed._id)
      }
      if (!(await mine())) return tasks.load(claimed.slateId, claimed._id)
      await tasks.renew?.(claimed.slateId, claimed._id, CLAIMANT).catch(() => null)
      await step(principal, shareId, 0, 'done')
      if (preview.reply) {
        // The model answered in words and changed nothing.
        const done = await tasks.finish(claimed.slateId, claimed._id, CLAIMANT, 'completed', String(preview.reply).slice(0, 400))
        await report(done, preview.reply)
        outcome = 'done'
        return done
      }
      if (preview.removed?.length || preview.warnings?.length) {
        const summary = heldSummary(preview)
        const waiting = await tasks.hold(claimed.slateId, claimed._id, CLAIMANT, {
          summary: `I would ${summary}.`,
          held: { writes: preview.writes, execId: preview.execId, removed: (preview.removed || []).map(({ id, text }) => ({ id, text })), touched: touchedState(board, preview.writes) },
        })
        await step(principal, shareId, 1, 'skipped')
        await report(waiting, `Before I go on: I would ${summary}. Approve or cancel it in Agent tasks.`)
        outcome = 'done'
        return waiting
      }
      if (!(await mine())) return tasks.load(claimed.slateId, claimed._id)
      try {
        await save(principal, preview.writes, preview.execId)
      } catch (error) {
        await finishFailed(claimed, failText(error))
        return tasks.load(claimed.slateId, claimed._id)
      }
      await step(principal, shareId, 1, 'done')
      const summary = doneSummary(preview)
      const done = await tasks.finish(claimed.slateId, claimed._id, CLAIMANT, 'completed', summary)
      await step(principal, shareId, 2, 'done')
      await report(done, `Done: ${summary}`)
      outcome = 'done'
      return done
    } catch (error) {
      log('[teammate] ' + (error?.code || error?.message))
      await finishFailed(claimed, failText(error))
      return null
    } finally {
      await presence?.end(runId, outcome).catch(() => {})
      running.delete(task._id)
    }
  }

  /** A person approved what a task held: save exactly those writes, as the approving person. */
  async function resume({ task, held }) {
    const runId = newExecId()
    const principal = teammatePrincipal(task, runId)
    let outcome = 'stopped'
    try {
      if (!held?.writes?.length || !held.execId) {
        await finishFailed(task, 'There was nothing left to approve. Ask again.')
        return null
      }
      // What was approved is what is saved, and only onto what the person saw: every object the
      // held writes act on must be as it was at the hold (touchedState). Anything else on the slate
      // may have moved on; then the writes go at today's revision.
      const board = await resolveBoard(task.shareId, task.assignedBy)
      if (!board) {
        await finishFailed(task, 'The person who approved can no longer edit this slate.')
        return null
      }
      const legacy = !held.touched && (held.removed || []).some(({ id, text }) => !(board.nodes || []).some((node) => node.options?.id === id && plain(node.options?.text) === plain(text)))
      const changed = held.touched ? changedSince(board, held.touched) : legacy ? ['the notes it would remove'] : []
      if (changed.length) {
        const what = changed.slice(0, 3).join(', ')
        const text = `Nothing was saved: ${what} changed after I planned it, so the change you approved no longer matches the slate. Ask me again and I will plan again from what is there now.`
        const done = await tasks.finish(task.slateId, task._id, CLAIMANT, 'failed', text).catch(() => null)
        await report(done || task, `I did not make the change you approved: ${what} changed after I planned it. Ask me again (or use Plan again in Agent tasks) and I will plan again from what is there now.`)
        return null
      }
      if (tasks.stillHolds && !(await tasks.stillHolds(task.slateId, task._id, CLAIMANT))) return null
      const writes = held.writes.map((write) =>
        write.input && Object.hasOwn(write.input, 'expectedRevision') ? { ...write, input: { ...write.input, expectedRevision: board.revision ?? 0 } } : write)
      await registry.run(principal, 'presence.plan', { shareId: task.shareId, steps: ['Make the approved change', 'Report back'] }).catch(() => {})
      try {
        // The original preview's keys (a key does not cover expectedRevision): approving twice
        // replays instead of saving twice.
        await save(principal, writes, held.execId)
      } catch (error) {
        await finishFailed(task, failText(error))
        return null
      }
      await step(principal, task.shareId, 0, 'done')
      const done = await tasks.finish(task.slateId, task._id, CLAIMANT, 'completed', 'Made the approved change.')
      await step(principal, task.shareId, 1, 'done')
      await report(done, 'Done: made the change you approved.')
      outcome = 'done'
      return done
    } finally {
      await presence?.end(runId, outcome).catch(() => {})
    }
  }

  return { run, resume, running: () => running.size }
}
