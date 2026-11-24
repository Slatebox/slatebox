// What agents suggest, live on the slate. An agent's canvas edit (slates.applyOperations, from
// Claude, ChatGPT or a command line through Slatebox's MCP server, the API or exec, and later an
// invited agent) is not saved: it becomes one suggestion action, a list of items (add a note,
// change a note, remove a note, draw a line, remove a line) that every screen on the slate draws
// in place as ghosts (the engine's createAgentSuggestions). People who may edit the slate keep or
// discard each item right on its ghost, or all of an agent's at once from its chip.
//
// Keeping saves through the same path an edit takes (applyToCanvas: the save core, a run every
// open canvas draws), as engine operations built here from the item, so a kept item lands the
// same on every screen. Each kept item carries the operations that undo it, read from the slate
// as it was just before; undoing an action undoes only its own items, and only what nobody has
// changed since, so one agent's undo never undoes another agent's work or a person's.
//
// An agent a person lets edit directly (agents.control mode "direct", behind
// settings.public.agents.editDirectly) saves at once; its save is still filed as one action here
// (items "applied"), so it is one undo in the agent's activity list.
//
// No Meteor here: the store takes a MongoDB driver collection (server/agents/suggestions-meteor.js).
import { createHash } from 'node:crypto'
import { CONNECTOR_STYLE_KEYS, NODE_KEYS, readConnector, readNote } from 'slateboxjs/operations'
import { problem } from '../actions/errors.mjs'
import { cleanStepText } from '../../imports/api/common/agent-label.mjs'

export const SUGGESTION_LIMITS = Object.freeze({
  itemsPerAction: 120,
  pendingPerSlate: 400, // waiting items on one slate, across agents
  keepDays: 7, // an action (and its undo) is kept this long, then deleted
  activity: 20, // actions per agent in its activity list
})
export const ITEM_KINDS = Object.freeze(['add', 'update', 'remove', 'link', 'unlink'])
export const ITEM_STATES = Object.freeze(['pending', 'kept', 'discarded', 'applied', 'undone', 'refused'])
export const GHOST_PREFIX = 'ghost-'
export const ghostIdOf = (nodeId) => GHOST_PREFIX + nodeId

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const nodeIdOf = (node) => node?.options?.id
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

// ---- reading a stored slate ------------------------------------------------------------------

function nodesById(nodes) {
  const map = new Map()
  for (const node of nodes || []) if (typeof nodeIdOf(node) === 'string') map.set(nodeIdOf(node), node)
  return map
}

// Every line on the slate, by id, each with the note that holds it.
function linesById(nodes) {
  const map = new Map()
  for (const node of nodes || [])
    for (const association of node?.relationships?.associations || [])
      if (association?.id) map.set(association.id, { ...association, parentId: association.parentId ?? nodeIdOf(node) })
  return map
}

const linesTouching = (nodes, nodeId) => [...linesById(nodes).values()].filter((line) => line.parentId === nodeId || line.childId === nodeId)

// ---- engine operations for an item -----------------------------------------------------------
// A kept item is saved as engine operations (slateboxjs/operations), so the save and every open
// canvas's replay of it agree. NODE_KEYS read the stored note; the rest are written as a change.

const PLACED_KEYS = new Set(['text', 'shape', 'x', 'y', 'width', 'height'])
// The fields add_nodes takes for a video note (slateboxjs/operations readMediaValue).
const MEDIA_KEYS = ['url', 'provider', 'id', 'hash', 'start', 'title', 'author', 'poster', 'posterWidth', 'posterHeight']

/** The operations that put this stored note on a slate, as it is (with its own id). */
export function addNoteOps(node) {
  const note = readNote(node)
  const add = { kind: 'add_nodes', count: 1, ids: [note.id], text: note.text ?? '' }
  for (const key of ['shape', 'x', 'y', 'width', 'height']) if (note[key] !== null && note[key] !== undefined) add[key] = note[key]
  // A video note is added as its video (add_nodes media), which draws its poster and play button.
  const media = node?.options?.media
  if (media && typeof media === 'object' && typeof media.url === 'string') {
    add.media = Object.fromEntries(Object.entries(media).filter(([key, value]) => MEDIA_KEYS.includes(key) && value !== null && value !== undefined))
    // its caption is the video's title and its shape the player's frame: add_nodes takes neither
    delete add.text
    delete add.shape
  }
  const changes = {}
  for (const key of Object.keys(NODE_KEYS)) {
    if (PLACED_KEYS.has(key)) continue
    const value = note[key]
    if (value !== null && value !== undefined && value !== '') changes[key] = value
  }
  return Object.keys(changes).length ? [add, { kind: 'update_nodes', target: { ids: [note.id] }, changes }] : [add]
}

/** The note's keys that differ between two stored versions of it: { changes, previous } in engine keys. */
export function noteChanges(before, after) {
  const a = readNote(before)
  const b = readNote(after)
  const changes = {}
  const previous = {}
  for (const key of Object.keys(NODE_KEYS)) {
    if (same(a[key], b[key]) || b[key] === null || b[key] === undefined) continue
    changes[key] = b[key]
    previous[key] = a[key]
  }
  return { changes, previous }
}

const updateOps = (nodeId, changes) => (Object.keys(changes).length ? [{ kind: 'update_nodes', target: { ids: [nodeId] }, changes }] : [])

/** The operation that draws this stored line, with its own id and style. */
export function lineOps(line) {
  const read = readConnector(line)
  const style = {}
  for (const key of CONNECTOR_STYLE_KEYS) if (read[key] !== null && read[key] !== undefined) style[key] = read[key]
  return [{ kind: 'connect_nodes', from: { ids: [line.parentId] }, to: { ids: [line.childId] }, ids: [line.id], ...(Object.keys(style).length && { style }) }]
}
const unlinkOps = (lineId) => [{ kind: 'disconnect_nodes', connectionIds: [lineId] }]
const removeOps = (nodeId) => [{ kind: 'delete_nodes', target: { ids: [nodeId] } }]

// ---- what an edit changes, as items ----------------------------------------------------------

/**
 * The items one edit makes: before and after are stored slates (or their nodes). A line that goes
 * with a removed note is not an item of its own (removing the note removes it). A line to or from
 * a note the edit adds is an item of its own, drawn dashed to the note's ghost.
 */
export function diffItems(before, after, newId) {
  const was = nodesById(before?.nodes ?? before)
  const now = nodesById(after?.nodes ?? after)
  const items = []
  for (const [id, node] of now) {
    if (was.has(id)) continue
    const stored = { options: clone(node.options), relationships: { associations: [] } }
    items.push({ id: newId(), kind: 'add', state: 'pending', nodeId: id, node: stored })
  }
  for (const [id, node] of now) {
    if (!was.has(id)) continue
    const { changes, previous } = noteChanges(was.get(id), node)
    if (Object.keys(changes).length) items.push({ id: newId(), kind: 'update', state: 'pending', nodeId: id, changes, previous })
  }
  const linesWere = linesById(before?.nodes ?? before)
  const linesNow = linesById(after?.nodes ?? after)
  for (const [id, line] of linesNow) {
    const old = linesWere.get(id)
    if (old && same(readConnector(old), readConnector(line))) continue
    if (old) items.push({ id: newId(), kind: 'unlink', state: 'pending', parentId: old.parentId, association: clone(old) })
    items.push({ id: newId(), kind: 'link', state: 'pending', parentId: line.parentId, association: clone(line) })
  }
  for (const [id, line] of linesWere) {
    if (linesNow.has(id) || !now.has(line.parentId) || !now.has(line.childId)) continue
    items.push({ id: newId(), kind: 'unlink', state: 'pending', parentId: line.parentId, association: clone(line) })
  }
  for (const [id, node] of was)
    if (!now.has(id)) items.push({ id: newId(), kind: 'remove', state: 'pending', nodeId: id, node: { options: clone(node.options), relationships: clone(node.relationships) ?? { associations: [] } } })
  return items
}

/** "3 notes, 1 change and 2 lines": what an action suggests, in plain words. */
export function summarize(items) {
  const count = (kind) => items.filter((item) => item.kind === kind).length
  const parts = []
  if (count('add')) parts.push(plural(count('add'), 'new note'))
  if (count('update')) parts.push(plural(count('update'), 'change'))
  if (count('remove')) parts.push(plural(count('remove'), 'removal'))
  if (count('link')) parts.push(plural(count('link'), 'line'))
  if (count('unlink')) parts.push(plural(count('unlink'), 'line removed', 'lines removed'))
  if (!parts.length) return 'nothing'
  return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1)
}

// Where an agent's pointer goes for these items: each new note's ghost, each changed note, and
// the first new note's centre as the spot it visits first.
export function choreography(items) {
  const targets = []
  let point = null
  for (const item of items) {
    if (item.kind === 'add') {
      targets.push(ghostIdOf(item.nodeId))
      const o = item.node?.options || {}
      if (!point && Number.isFinite(Number(o.xPos)) && Number.isFinite(Number(o.yPos)))
        point = { x: Number(o.xPos) + (Number(o.width) || 0) / 2, y: Number(o.yPos) + (Number(o.height) || 0) / 2 }
    } else if (item.kind === 'update' || item.kind === 'remove') targets.push(item.nodeId)
    else if (item.parentId) targets.push(item.parentId)
  }
  return { targets: [...new Set(targets)], point }
}

// ---- applying items to a stored slate in memory (an agent building on its own suggestions) -----

/** The slate as the agent sees it: as stored, with its own waiting new notes and lines in it. */
export function withOwnGhosts(slate, actions) {
  const out = { ...slate, nodes: clone(slate.nodes || []) }
  const ids = nodesById(out.nodes)
  for (const action of actions)
    for (const item of action.items)
      if (item.state === 'pending' && item.kind === 'add' && !ids.has(item.nodeId)) {
        const node = clone(item.node)
        out.nodes.push(node)
        ids.set(item.nodeId, node)
      }
  for (const action of actions)
    for (const item of action.items) {
      if (item.state !== 'pending' || item.kind !== 'link') continue
      const holder = ids.get(item.parentId)
      if (!holder || !ids.has(item.association?.childId)) continue
      holder.relationships ??= { associations: [] }
      holder.relationships.associations ??= []
      if (!holder.relationships.associations.some((line) => line.id === item.association.id)) holder.relationships.associations.push(clone(item.association))
    }
  return out
}

// ---- the store -------------------------------------------------------------------------------

const PUBLIC_ITEM_FIELDS = ['id', 'kind', 'state', 'nodeId', 'node', 'changes', 'previous', 'parentId', 'association', 'reason', 'decidedBy']

/** An action as a screen and an agent receive it: no account, token or run ids. */
export function publicAction(doc) {
  return {
    actionId: doc._id,
    agentId: doc.agentId,
    label: doc.label,
    initial: doc.initial,
    colorIndex: doc.colorIndex,
    origin: doc.origin ?? null,
    via: doc.via ?? null,
    invitedBy: doc.invitedBy ?? null,
    iconUrl: doc.iconUrl ?? null,
    message: doc.message || null,
    summary: doc.summary,
    mode: doc.mode,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    undoable: doc.items.some((item) => (item.state === 'kept' || item.state === 'applied') && item.undo?.length),
    undone: Boolean(doc.undoneAt),
    items: doc.items.map((item) => {
      const out = {}
      for (const field of PUBLIC_ITEM_FIELDS) if (item[field] !== undefined) out[field] = item[field]
      // A note's full stored form is only needed while its ghost is drawn (or to show what went).
      if (item.state !== 'pending' && item.kind === 'add') delete out.node
      return out
    }),
  }
}

/**
 * The suggestion store. collection: actions (MongoDB driver). controls: one row per slate
 * ({ paused, modes: { agentId: 'direct' } }). identify(principal, slate): the agent's name on the
 * slate (presence.identify). applyPlan(principal, slate, plan, message, attribution): saves engine
 * operations through the edit path and answers { revision }. findName(userId): a person's first name.
 */
export function createSuggestionStore({
  collection,
  controls,
  identify,
  applyPlan,
  findName = async () => 'Someone',
  now = () => new Date(),
  newId = () => createHash('sha256').update(String(Math.random()) + String(process.hrtime.bigint())).digest('hex').slice(0, 17),
}) {
  const at = () => now()
  // Actions are listed in the order they were made: two in one millisecond still get two times.
  let last = 0
  const stamp = () => {
    const t = Math.max(at().getTime(), last + 1)
    last = t
    return new Date(t)
  }
  const expiry = () => new Date(at().getTime() + SUGGESTION_LIMITS.keepDays * 86400000)

  const forSlate = (slateId) => collection.find({ slateId }, { sort: { createdAt: 1 } }).toArray()
  const pendingOf = (actions) => actions.flatMap((action) => action.items.filter((item) => item.state === 'pending').map((item) => ({ action, item })))

  async function controlsOf(slateId) {
    const row = await controls.findOne({ _id: slateId })
    return { paused: Boolean(row?.paused), pausedBy: row?.pausedBy ?? null, modes: { ...(row?.modes || {}) } }
  }

  /** How this agent's edits land on this slate: 'suggest' (ghosts) or 'direct' (saved at once). */
  async function modeOf(slateId, agentId, editDirectly) {
    if (!editDirectly) return 'suggest'
    return (await controlsOf(slateId)).modes[agentId] === 'direct' ? 'direct' : 'suggest'
  }

  /**
   * An agent's edit, as suggestions. base: the slate the plan was applied to (the stored slate with
   * the agent's own waiting notes, withOwnGhosts); after: the slate as the plan leaves it.
   * A change to one of the agent's own waiting notes changes that suggestion; removing one takes it back.
   */
  async function suggest(principal, slate, { base, after, message, identity }) {
    const who = identity || (await identify(principal, slate))
    const actions = await forSlate(slate._id)
    const own = actions.filter((action) => action.agentId === who.agentId)
    const ownAdds = new Map(pendingOf(own).filter(({ item }) => item.kind === 'add').map((entry) => [entry.item.nodeId, entry]))
    const touched = new Map() // action id -> action, the agent's earlier actions this edit changed
    const items = []
    for (const item of diffItems(base, after, newId)) {
      const earlier = item.nodeId && ownAdds.get(item.nodeId)
      if (earlier && item.kind === 'update') {
        const node = (after.nodes || []).find((n) => nodeIdOf(n) === item.nodeId)
        earlier.item.node = { options: clone(node.options), relationships: { associations: [] } }
        touched.set(earlier.action._id, earlier.action)
        continue
      }
      if (earlier && item.kind === 'remove') {
        Object.assign(earlier.item, { state: 'discarded', reason: 'withdrawn', decidedAt: at() })
        for (const { item: line } of pendingOf(own))
          if (line.kind === 'link' && (line.parentId === item.nodeId || line.association?.childId === item.nodeId))
            Object.assign(line, { state: 'discarded', reason: 'withdrawn', decidedAt: at() })
        touched.set(earlier.action._id, earlier.action)
        continue
      }
      items.push(item)
    }
    if (items.length > SUGGESTION_LIMITS.itemsPerAction)
      throw problem(413, 'too_many_suggestions', `One edit suggests at most ${SUGGESTION_LIMITS.itemsPerAction} changes. Split it into smaller edits.`)
    if (pendingOf(actions).length + items.length > SUGGESTION_LIMITS.pendingPerSlate)
      throw problem(429, 'suggestions_waiting', 'This slate has too many suggestions waiting. Ask someone on it to keep or discard some first.')
    for (const action of touched.values())
      await collection.updateOne({ _id: action._id }, { $set: { items: action.items, updatedAt: at() } })
    if (!items.length) return { action: null, items: [], changedEarlier: touched.size > 0 }
    const doc = {
      _id: newId(),
      slateId: slate._id,
      shareId: slate.shareId,
      agentId: who.agentId,
      ownerId: principal.userId,
      runId: principal.runId || null,
      label: who.label,
      initial: who.initial,
      colorIndex: who.colorIndex,
      origin: who.origin ?? null,
      via: who.via ?? null,
      invitedBy: who.invitedBy ?? null,
      iconUrl: who.iconUrl ?? null,
      message: cleanStepText(message) || null,
      summary: summarize(items),
      mode: 'suggest',
      items,
      createdAt: stamp(),
      updatedAt: at(),
      expiresAt: expiry(),
    }
    await collection.insertOne(doc)
    return { action: doc, items, changedEarlier: touched.size > 0 }
  }

  /** An agent allowed to edit directly saved: its save, filed as one action (one undo). */
  async function applied(principal, slate, { before, after, message, revision, identity }) {
    const who = identity || (await identify(principal, slate))
    const items = diffItems(before, after, newId).map((item) => ({
      ...item,
      state: 'applied',
      decidedAt: at(),
      revision,
      undo: undoOps(item, before.nodes || []),
    }))
    if (!items.length) return null
    const doc = {
      _id: newId(), slateId: slate._id, shareId: slate.shareId, agentId: who.agentId, ownerId: principal.userId, runId: principal.runId || null,
      label: who.label, initial: who.initial, colorIndex: who.colorIndex, origin: who.origin ?? null, via: who.via ?? null,
      invitedBy: who.invitedBy ?? null, iconUrl: who.iconUrl ?? null,
      message: cleanStepText(message) || null, summary: summarize(items), mode: 'direct', items,
      createdAt: stamp(), updatedAt: at(), expiresAt: expiry(),
    }
    await collection.insertOne(doc)
    return doc
  }

  // The operations that undo an item, read from the slate as it is just before the item lands.
  function undoOps(item, nodes) {
    const notes = nodesById(nodes)
    switch (item.kind) {
      case 'add':
        return removeOps(item.nodeId)
      case 'update': {
        const note = notes.get(item.nodeId)
        if (!note) return []
        const current = readNote(note)
        return updateOps(item.nodeId, Object.fromEntries(Object.keys(item.changes).map((key) => [key, current[key]]).filter(([, value]) => value !== null && value !== undefined)))
      }
      case 'remove': {
        const note = notes.get(item.nodeId)
        if (!note) return []
        return [...addNoteOps(note), ...linesTouching(nodes, item.nodeId).flatMap(lineOps)]
      }
      case 'link':
        return unlinkOps(item.association.id)
      case 'unlink': {
        const line = linesById(nodes).get(item.association.id)
        return line ? lineOps(line) : []
      }
      default:
        return []
    }
  }

  // Whether an item can still land on the slate as it is now, and why not.
  function refusal(item, nodes, adding) {
    const notes = nodesById(nodes)
    const has = (id) => notes.has(id) || adding.has(id)
    switch (item.kind) {
      case 'add':
        return notes.has(item.nodeId) ? 'A note with this id is already on the slate.' : null
      case 'update':
      case 'remove':
        return notes.has(item.nodeId) ? null : 'The note is no longer on the slate.'
      case 'link':
        if (linesById(nodes).has(item.association.id)) return 'The line is already on the slate.'
        return has(item.association.parentId ?? item.parentId) && has(item.association.childId) ? null : 'A note at one end of the line is no longer on the slate.'
      case 'unlink':
        return linesById(nodes).has(item.association.id) ? null : 'The line is no longer on the slate.'
      default:
        return 'Unknown suggestion.'
    }
  }

  const ORDER = { add: 0, update: 1, link: 2, unlink: 3, remove: 4 }
  function forwardOps(item) {
    switch (item.kind) {
      case 'add': return addNoteOps(item.node)
      case 'update': return updateOps(item.nodeId, item.changes)
      case 'remove': return removeOps(item.nodeId)
      case 'link': return lineOps(item.association)
      case 'unlink': return unlinkOps(item.association.id)
      default: return []
    }
  }

  // The waiting items a choice names: one action's (or some of its items), or every waiting item of
  // one agent. A line also takes the waiting new notes at its ends.
  function chosen(actions, { actionId, itemIds, agentId }) {
    let picked
    if (agentId) picked = pendingOf(actions.filter((action) => action.agentId === agentId))
    else {
      const action = actions.find((a) => a._id === actionId)
      if (!action) throw problem(404, 'not_found', 'There is no such suggestion on this slate.')
      picked = pendingOf([action]).filter(({ item }) => !itemIds?.length || itemIds.includes(item.id))
    }
    return picked
  }

  const decider = async (principal) => ({ userId: principal.userId, name: await findName(principal.userId).catch(() => 'Someone'), kind: principal.kind })

  /**
   * Keep waiting items: saved through the edit path as one change by whoever keeps them. Items that
   * can no longer land (their note is gone) are refused and say why; the rest are kept.
   */
  async function keep(principal, slate, choice, apply = applyPlan) {
    const actions = await forSlate(slate._id)
    let picked = chosen(actions, choice)
    // A kept line brings the waiting new notes at its ends (of any action of the same agent).
    const pendingAdds = new Map(pendingOf(actions).filter(({ item }) => item.kind === 'add').map((entry) => [entry.item.nodeId, entry]))
    const ids = new Set(picked.map(({ item }) => item.id))
    for (const { action, item } of [...picked]) {
      if (item.kind !== 'link') continue
      for (const end of [item.association.parentId ?? item.parentId, item.association.childId]) {
        const add = pendingAdds.get(end)
        if (add && add.action.agentId === action.agentId && !ids.has(add.item.id)) {
          picked.push(add)
          ids.add(add.item.id)
        }
      }
    }
    if (principal.kind === 'agent') {
      const self = await identify(principal, slate)
      if (picked.some(({ action }) => action.agentId === self.agentId))
        throw problem(403, 'own_suggestion', 'An agent cannot keep its own suggestions: a person on the slate keeps them (or lets the agent edit directly).')
    }
    if (!picked.length) return { kept: [], refused: [], revision: slate.revision ?? 0 }
    picked = picked.sort((a, b) => ORDER[a.item.kind] - ORDER[b.item.kind])
    const nodes = slate.nodes || []
    const adding = new Set(picked.filter(({ item }) => item.kind === 'add').map(({ item }) => item.nodeId))
    const refused = []
    const landing = []
    for (const entry of picked) {
      const why = refusal(entry.item, nodes, adding)
      if (why) {
        refused.push(entry)
        if (entry.item.kind === 'add') adding.delete(entry.item.nodeId)
        Object.assign(entry.item, { state: 'refused', reason: why, decidedAt: at() })
      } else landing.push(entry)
    }
    let revision = slate.revision ?? 0
    const by = await decider(principal)
    if (landing.length) {
      for (const { item } of landing) item.undo = undoOps(item, nodes)
      const operations = landing.flatMap(({ item }) => forwardOps(item))
      const first = landing[0].action
      const saved = await apply(principal, slate, { message: `Kept ${summarize(landing.map(({ item }) => item))} from ${first.label}`, operations }, {
        agentId: first.agentId, label: first.label, origin: first.origin, via: first.via, invitedBy: first.invitedBy, kept: true,
      })
      revision = saved.revision
      for (const { item } of landing) Object.assign(item, { state: 'kept', decidedAt: at(), decidedBy: by.name, revision })
    }
    await saveActions(new Set([...landing, ...refused].map(({ action }) => action)))
    return { kept: landing.map(({ action, item }) => ({ actionId: action._id, itemId: item.id })), refused: refused.map(({ action, item }) => ({ actionId: action._id, itemId: item.id, reason: item.reason })), revision }
  }

  async function saveActions(actions) {
    for (const action of actions) await collection.updateOne({ _id: action._id }, { $set: { items: action.items, updatedAt: at() } })
  }

  /** Discard waiting items: nothing is saved; their ghosts go. A line to a discarded new note goes too. */
  async function discard(principal, slate, choice) {
    const actions = await forSlate(slate._id)
    const picked = chosen(actions, choice)
    const gone = new Set(picked.filter(({ item }) => item.kind === 'add').map(({ item }) => item.nodeId))
    const ids = new Set(picked.map(({ item }) => item.id))
    for (const entry of pendingOf(actions))
      if (entry.item.kind === 'link' && !ids.has(entry.item.id) && (gone.has(entry.item.association.parentId ?? entry.item.parentId) || gone.has(entry.item.association.childId))) {
        picked.push(entry)
        ids.add(entry.item.id)
      }
    const by = await decider(principal)
    for (const { item } of picked) Object.assign(item, { state: 'discarded', decidedAt: at(), decidedBy: by.name })
    await saveActions(new Set(picked.map(({ action }) => action)))
    return { discarded: picked.map(({ action, item }) => ({ actionId: action._id, itemId: item.id })) }
  }

  /**
   * Undo one action: its kept (or directly applied) items, each only as far as nobody changed it
   * since. Saved as one change. Answers what was undone and what was left, and why.
   */
  async function undo(principal, slate, { actionId }, apply = applyPlan) {
    const action = await collection.findOne({ _id: actionId, slateId: slate._id })
    if (!action) throw problem(404, 'not_found', 'There is no such agent action on this slate.')
    const items = action.items.filter((item) => (item.state === 'kept' || item.state === 'applied') && Array.isArray(item.undo))
    if (!items.length) throw problem(409, 'nothing_to_undo', 'Nothing of this action is on the slate to undo.')
    const nodes = slate.nodes || []
    const notes = nodesById(nodes)
    const lines = linesById(nodes)
    const operations = []
    const undone = []
    const left = []
    // Last kept first: a line goes before the note it ends at.
    for (const item of [...items].reverse()) {
      let ops = item.undo
      let why = null
      if (item.kind === 'add' && !notes.has(item.nodeId)) why = 'The note is no longer on the slate.'
      if (item.kind === 'update') {
        const note = notes.get(item.nodeId)
        if (!note) why = 'The note is no longer on the slate.'
        else {
          // Only the keys still as the agent left them go back; a key someone changed since stays.
          const current = readNote(note)
          const back = { ...(ops[0]?.changes || {}) }
          for (const key of Object.keys(back)) if (!same(current[key], item.changes[key])) delete back[key]
          ops = updateOps(item.nodeId, back)
          if (!ops.length) why = 'Someone changed the note since.'
        }
      }
      if (item.kind === 'remove' && notes.has(item.nodeId)) why = 'A note with this id is on the slate again.'
      if (item.kind === 'link' && !lines.has(item.association.id)) why = 'The line is no longer on the slate.'
      if (item.kind === 'unlink' && (lines.has(item.association.id) || !notes.has(item.association.parentId ?? item.parentId) || !notes.has(item.association.childId)))
        why = 'The line or a note at its end changed since.'
      if (why || !ops.length) {
        left.push({ itemId: item.id, reason: why || 'Nothing to undo.' })
        continue
      }
      operations.push(...ops)
      undone.push(item)
    }
    let revision = slate.revision ?? 0
    if (operations.length) {
      const saved = await apply(principal, slate, { message: `Undid ${action.label}: ${summarize(undone)}`, operations }, {
        agentId: action.agentId, label: action.label, origin: action.origin, undo: true,
      })
      revision = saved.revision
      const by = await decider(principal)
      for (const item of undone) Object.assign(item, { state: 'undone', undoneBy: by.name, revision })
      await collection.updateOne({ _id: action._id }, { $set: { items: action.items, updatedAt: at(), undoneAt: at(), undoneBy: by.name } })
    }
    return { actionId, undone: undone.map((item) => item.id), left, revision }
  }

  /** The actions on a slate, newest last: everything waiting, and each agent's recent activity. */
  async function list(slateId) {
    const actions = await forSlate(slateId)
    const perAgent = new Map()
    const shown = new Set()
    for (const action of [...actions].reverse()) {
      const n = perAgent.get(action.agentId) || 0
      const waiting = action.items.some((item) => item.state === 'pending')
      if (n >= SUGGESTION_LIMITS.activity && !waiting) continue
      perAgent.set(action.agentId, n + 1)
      shown.add(action._id)
    }
    return actions.filter((action) => shown.has(action._id))
  }

  /** The ghost ids an agent's pointer may point at on this slate (its waiting new notes). */
  async function ghostIds(slateId) {
    return pendingOf(await forSlate(slateId)).filter(({ item }) => item.kind === 'add').map(({ item }) => ghostIdOf(item.nodeId))
  }

  async function pause(slateId, paused, principal) {
    const by = await decider(principal)
    await controls.findOneAndUpdate({ _id: slateId }, { $set: { paused: Boolean(paused), pausedBy: paused ? by.name : null, pausedAt: paused ? at() : null } }, { upsert: true })
    return controlsOf(slateId)
  }

  async function setMode(slateId, agentId, mode) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(agentId))) throw problem(400, 'invalid_request', 'agentId is the id list_suggestions gives.')
    await controls.findOneAndUpdate({ _id: slateId }, mode === 'direct' ? { $set: { ['modes.' + agentId]: 'direct' } } : { $unset: { ['modes.' + agentId]: '' } }, { upsert: true })
    return controlsOf(slateId)
  }

  async function ensureIndexes() {
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 60 })
    await collection.createIndex({ slateId: 1, createdAt: 1 })
  }

  return { suggest, applied, keep, discard, undo, list, ghostIds, controlsOf, modeOf, pause, setMode, ensureIndexes, withOwnGhosts }
}
