// A canvas save says what this page changed, not what it holds.
//
// A page keeps the slate as the server held it when the page last knew (its save base: what it
// loaded, then what each save it made stored). Its autosave sends the difference between that base
// and the page now: the note properties it changed, the notes it added and removed, a new order of
// its notes, and the settings it changed. The server applies that patch to the slate as stored now
// (server/methods/native-slate-save.mjs), so a page that is behind (its relay connection dropped,
// or it never had one) changes only what its person changed and never writes back the older words,
// places or notes of everyone else.
//
// The properties are those the save core records and scopes conflicts by (slate-save-core.mjs):
// each key of a note's options ("options.text") and each other key of the note ("relationships").

export const PATCH_VERSION = 1
// What one patch may carry. A page that changed more than this sends its whole slate instead.
export const PATCH_LIMITS = Object.freeze({ notes: 5000, properties: 200, order: 20000 })

const noteIdOf = note => (typeof note?.options?.id === 'string' && note.options.id ? note.options.id : null)
const text = value => JSON.stringify(value ?? null)

function propertiesOf(note) {
  const out = {}
  for (const [key, value] of Object.entries(note || {})) {
    if (key === 'options' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [name, inner] of Object.entries(value)) out[`options.${name}`] = text(inner)
    } else out[key] = text(value)
  }
  return out
}

/**
 * The base a page keeps: each note's properties as text, the order of its notes and its settings.
 * `exported` is the slate as the page exports it (slate.exportJSON()).
 */
export function saveBaseOf(exported) {
  const notes = new Map()
  const order = []
  for (const note of Array.isArray(exported?.nodes) ? exported.nodes : []) {
    const id = noteIdOf(note)
    if (id === null || notes.has(id)) continue
    notes.set(id, propertiesOf(note))
    order.push(id)
  }
  const options = {}
  for (const [key, value] of Object.entries(exported?.options || {})) options[key] = text(value)
  return { notes, order, options }
}

/** A base with these notes taken as the server now holds them (a run the page drew, not made). */
export function foldIntoBase(base, notes) {
  if (!base) return base
  for (const note of notes) {
    const id = noteIdOf(note)
    if (id === null) continue
    if (!base.notes.has(id)) base.order.push(id)
    base.notes.set(id, propertiesOf(note))
  }
  return base
}

/**
 * What the page changed since its base: { v, changed: [{ id, paths, note }], added: [note],
 * removed: [id], order: [id] | null, options: { key: value } }, or null when the page's notes
 * cannot be named one by one (a note without an id, two notes with one id), so the caller sends
 * its whole slate as before. `changed[].note` is the whole note, kept by the server only when the
 * note is no longer stored (someone removed it after the page last knew).
 */
export function savePatch(base, exported) {
  if (!base || !Array.isArray(exported?.nodes)) return null
  const changed = []
  const added = []
  const seen = new Set()
  const order = []
  for (const note of exported.nodes) {
    const id = noteIdOf(note)
    if (id === null || seen.has(id)) return null
    seen.add(id)
    order.push(id)
    const before = base.notes.get(id)
    if (!before) {
      added.push(note)
      continue
    }
    const now = propertiesOf(note)
    const paths = []
    for (const path of new Set([...Object.keys(before), ...Object.keys(now)])) if (before[path] !== now[path]) paths.push(path)
    if (paths.length) {
      if (paths.length > PATCH_LIMITS.properties) return null
      changed.push({ id, paths, note })
    }
  }
  const removed = base.order.filter(id => !seen.has(id))
  if (changed.length + added.length + removed.length > PATCH_LIMITS.notes || order.length > PATCH_LIMITS.order) return null
  // A new order of the notes both hold (brought to front, sent back) is sent as the page's order.
  const kept = new Set(order)
  const was = base.order.filter(id => kept.has(id))
  const is = order.filter(id => base.notes.has(id))
  const reordered = was.length !== is.length || was.some((id, index) => id !== is[index])
  const options = {}
  for (const [key, value] of Object.entries(exported.options || {})) if (base.options[key] !== text(value)) options[key] = value
  // A setting the page no longer has (a style taken off, the original it kept used up) is stored as none.
  for (const key of Object.keys(base.options)) if (!Object.hasOwn(exported.options || {}, key) && base.options[key] !== text(null)) options[key] = null
  return { v: PATCH_VERSION, changed, added, removed, order: reordered ? order : null, options }
}

const SAFE_KEY = key => typeof key === 'string' && key.length > 0 && key.length <= 200 && !key.includes('.') &&
  !key.startsWith('$') && !key.includes('\0') && !['__proto__', 'constructor', 'prototype'].includes(key)
const SAFE_PATH = path => typeof path === 'string' &&
  (path.startsWith('options.') ? SAFE_KEY(path.slice('options.'.length)) : SAFE_KEY(path))
const isNote = note => note && typeof note === 'object' && !Array.isArray(note) && noteIdOf(note) !== null
const ids = list => Array.isArray(list) && list.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200)

/** Whether a patch from a browser has the shape savePatch makes, within its limits. */
export function validSavePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || patch.v !== PATCH_VERSION) return false
  const { changed, added, removed, order, options } = patch
  if (!Array.isArray(changed) || !Array.isArray(added) || !ids(removed)) return false
  if (changed.length + added.length + removed.length > PATCH_LIMITS.notes) return false
  if (order !== null && (!ids(order) || order.length > PATCH_LIMITS.order)) return false
  if (!options || typeof options !== 'object' || Array.isArray(options) || !Object.keys(options).every(SAFE_KEY)) return false
  if (!added.every(isNote)) return false
  return changed.every(entry => entry && typeof entry === 'object' && typeof entry.id === 'string' && isNote(entry.note) &&
    noteIdOf(entry.note) === entry.id && Array.isArray(entry.paths) && entry.paths.length > 0 &&
    entry.paths.length <= PATCH_LIMITS.properties && entry.paths.every(SAFE_PATH))
}

function readPath(note, path) {
  if (path.startsWith('options.')) return [note.options && Object.hasOwn(note.options, path.slice(8)), note.options?.[path.slice(8)]]
  return [Object.hasOwn(note, path), note[path]]
}

function writePath(note, path, [present, value]) {
  if (path.startsWith('options.')) {
    const key = path.slice(8)
    note.options = { ...(note.options || {}) }
    if (present) note.options[key] = value
    else delete note.options[key]
    return
  }
  if (present) note[path] = value
  else delete note[path]
}

/**
 * The notes to store: the stored notes with the page's patch applied. A property the page changed
 * takes the page's value; every other property, and every note the page did not change, stays as
 * stored. A note the page added is stored as the page has it. A note the page removed is removed.
 * A note the page changed that is no longer stored is kept as the page has it (nothing anyone wrote
 * is lost). A new order puts the notes it names in its order, then the notes it does not name (added
 * by others since) as they were stored.
 */
export function applySavePatch(stored, patch) {
  const notes = (Array.isArray(stored) ? stored : []).map(note => note)
  const at = new Map()
  notes.forEach((note, index) => { const id = noteIdOf(note); if (id !== null && !at.has(id)) at.set(id, index) })
  for (const { id, paths, note } of patch.changed) {
    const index = at.get(id)
    if (index === undefined) {
      at.set(id, notes.length)
      notes.push(note)
      continue
    }
    const next = { ...notes[index] }
    for (const path of paths) writePath(next, path, readPath(note, path))
    notes[index] = next
  }
  for (const note of patch.added) {
    const id = noteIdOf(note)
    if (at.has(id)) notes[at.get(id)] = note
    else { at.set(id, notes.length); notes.push(note) }
  }
  const gone = new Set(patch.removed)
  let result = gone.size ? notes.filter(note => !gone.has(noteIdOf(note))) : notes
  if (patch.order) {
    const rank = new Map(patch.order.map((id, index) => [id, index]))
    const named = result.filter(note => rank.has(noteIdOf(note))).sort((a, b) => rank.get(noteIdOf(a)) - rank.get(noteIdOf(b)))
    result = [...named, ...result.filter(note => !rank.has(noteIdOf(note)))]
  }
  return result
}
