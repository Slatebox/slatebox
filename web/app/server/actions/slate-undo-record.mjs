// What a saved canvas plan changed (its run receipt's `undoable`), and the plan that undoes or redoes it
// on the slate as it stands (slate-undo.mjs). slates.undo and slates.redo: the caller's own canvas edits, taken back and made again, with the rule
// a person's Undo keeps on the canvas: only the caller's own edits, and never what someone else changed
// since. A saved canvas plan keeps, in its run receipt, each note, line and setting it changed as they
// were before and after (`undoable`, read through the operation contract's own keys). An undo is the
// plan that puts back the "before" of each of those that still holds the "after"; a part someone else
// has changed since is left as it is and listed in `left`. It is saved as any canvas plan is (the save
// core, a receipt, drawn live on every open canvas), so a person watching sees it happen.
import { NODE_KEYS, NODE_STYLE_KEYS, CONNECTOR_STYLE_KEYS, SLATE_KEYS, readConnector, readNote } from 'slateboxjs/operations'

const same = (a, b) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const nodesOf = (slate) => (Array.isArray(slate?.nodes) ? slate.nodes : [])
const idOf = (node) => node?.options?.id

function notesById(slate) {
  return new Map(nodesOf(slate).filter((node) => typeof idOf(node) === 'string').map((node) => [idOf(node), node]))
}

function connectorsById(slate) {
  const out = new Map()
  for (const node of nodesOf(slate)) {
    for (const link of node?.relationships?.associations ?? []) {
      if (!link || link.parentId !== idOf(node)) continue
      const id = link.id != null && link.id !== '' ? String(link.id) : `${link.parentId}->${link.childId}`
      out.set(id, { ...link, id })
    }
  }
  return out
}

/** A setting as the contract reads it, or undefined when the key cannot be read back. */
function readSetting(slate, key) {
  const spec = SLATE_KEYS[key]
  try {
    if (typeof spec?.read === 'function') return spec.read(slate)
  } catch { /* unreadable: treated as unchanged */ }
  return undefined
}

/**
 * What a saved canvas plan changed, from the slate as it found it (`before`) to the slate it stored
 * (`after`): each note, line and setting it changed, before and after, as the contract reads them.
 * Null when it changed nothing.
 */
export function undoRecord(before, after, settingKeys = []) {
  const record = { notes: {}, connectors: {}, settings: {} }
  const was = notesById(before), now = notesById(after)
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id), b = now.get(id)
    const ra = a ? readNote(a) : null, rb = b ? readNote(b) : null
    if (!same(ra, rb)) record.notes[id] = { before: ra, after: rb }
  }
  const linksWere = connectorsById(before), linksNow = connectorsById(after)
  for (const id of new Set([...linksWere.keys(), ...linksNow.keys()])) {
    const a = linksWere.get(id), b = linksNow.get(id)
    const ra = a ? readConnector(a) : null, rb = b ? readConnector(b) : null
    if (!same(ra, rb)) record.connectors[id] = { before: ra, after: rb }
  }
  for (const key of settingKeys) {
    const a = readSetting(before, key), b = readSetting(after, key)
    if (a !== undefined && b !== undefined && !same(a, b)) record.settings[key] = { before: a, after: b }
  }
  const empty = !Object.keys(record.notes).length && !Object.keys(record.connectors).length && !Object.keys(record.settings).length
  return empty ? null : record
}

const pick = (values, keys) => Object.fromEntries(keys.filter((key) => values[key] !== null && values[key] !== undefined).map((key) => [key, values[key]]))
const ADD_KEYS = ['text', 'shape', 'x', 'y', 'width', 'height']

/**
 * The plan that takes the slate as it stands (`current`) from each part's `from` to its `to` (an undo:
 * after to before; a redo: before to after), only for the parts that are still as `from` has them.
 * Answers { operations, left }: `left` names each part someone else changed since, left as it is.
 */
export function stepPlan(record, current, direction) {
  const [fromKey, toKey] = direction === 'undo' ? ['after', 'before'] : ['before', 'after']
  const notes = notesById(current), links = connectorsById(current)
  const adds = [], connects = [], updates = [], lineUpdates = [], disconnects = [], deletes = [], left = []
  const changedSince = (kind, id, key) => left.push({ kind, id, ...(key ? { key } : {}), reason: 'changed since by someone else' })

  for (const [id, part] of Object.entries(record?.notes ?? {})) {
    const from = part[fromKey], to = part[toKey]
    const node = notes.get(id)
    const now = node ? readNote(node) : null
    if (!from && to) {
      // The step took this note away: it comes back, unless a note by this id is there again.
      if (now) { if (!same(now, to)) changedSince('note', id); continue }
      adds.push({ kind: 'add_nodes', count: 1, ids: [id], ...pick(to, ADD_KEYS), style: pick(to, NODE_STYLE_KEYS) })
    } else if (from && !to) {
      // The step made this note: it goes, unless someone else has changed it since.
      if (!now) continue
      if (same(now, from)) deletes.push(id)
      else changedSince('note', id)
    } else if (from && to) {
      if (!now) { changedSince('note', id); continue }
      const changes = {}
      for (const key of Object.keys(NODE_KEYS)) {
        if (same(from[key], to[key])) continue
        if (!same(now[key], from[key])) { if (!same(now[key], to[key])) changedSince('note', id, key); continue }
        // A value the note did not have before cannot be taken away by a plan: said, and left as it is.
        if (to[key] === null || to[key] === undefined) left.push({ kind: 'note', id, key, reason: 'had no value of its own to put back' })
        else changes[key] = to[key]
      }
      if (Object.keys(changes).length) updates.push({ kind: 'update_nodes', target: { ids: [id] }, changes })
    }
  }

  for (const [id, part] of Object.entries(record?.connectors ?? {})) {
    const from = part[fromKey], to = part[toKey]
    const link = links.get(id)
    const now = link ? readConnector(link) : null
    if (!from && to) {
      if (now) { if (!same(now, to)) changedSince('connection', id); continue }
      if (!to.to) { changedSince('connection', id); continue }
      connects.push({ kind: 'connect_nodes', from: { ids: [to.from] }, to: { ids: [to.to] }, ids: [id], style: pick(to, CONNECTOR_STYLE_KEYS) })
    } else if (from && !to) {
      if (!now) continue
      if (same(now, from)) disconnects.push(id)
      else changedSince('connection', id)
    } else if (from && to) {
      if (!now) { changedSince('connection', id); continue }
      const changes = {}
      for (const key of CONNECTOR_STYLE_KEYS) {
        if (same(from[key], to[key])) continue
        if (!same(now[key], from[key])) { if (!same(now[key], to[key])) changedSince('connection', id, key); continue }
        if (to[key] === null || to[key] === undefined) left.push({ kind: 'connection', id, key, reason: 'had no value of its own to put back' })
        else changes[key] = to[key]
      }
      if (Object.keys(changes).length) lineUpdates.push({ kind: 'update_connections', connectionIds: [id], changes })
    }
  }

  const settings = {}
  for (const [key, part] of Object.entries(record?.settings ?? {})) {
    const now = readSetting(current, key)
    if (same(now, part[fromKey])) settings[key] = part[toKey]
    else if (!same(now, part[toKey])) changedSince('setting', key)
  }

  const operations = [
    ...adds,
    ...connects,
    ...updates,
    ...lineUpdates,
    ...(disconnects.length ? [{ kind: 'disconnect_nodes', connectionIds: disconnects }] : []),
    ...(deletes.length ? [{ kind: 'delete_nodes', target: { ids: deletes } }] : []),
    ...(Object.keys(settings).length ? [{ kind: 'update_slate', changes: settings }] : []),
  ]
  return { operations, left }
}

