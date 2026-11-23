// One save path for a slate's content. Every writer calls it: the browser's autosave
// (slates.update), the operations action, a kept conversation turn (nativeCanvas.keep), the
// workshop saves (creativeSlates.save and play, the workshop operations core), and every way a
// slate is created (the browser's first save, creativeSlates.create, workshops.saveCanvas, the
// create action, a copy).
//
// For each save the core:
// - raises slate.revision by one: the monotonic sequence of the slate's event log;
// - diffs the stored slate against the result, on the server, and records the notes and settings
//   the save touched;
// - refuses a writer that names the revision it read (expectedRevision) only when a note or
//   setting it changes was changed after that revision (scoped conflict). Saves that add notes,
//   or change notes nobody else touched, go through;
// - builds the search fields from what it stores;
// - appends one row to the event log (with the board's card moves, when it moved any: the move
//   log, workshop-move-log.mjs).
//
// A workshop keeps its own counter (creative.revision): the workshop's callers pass it in
// `conditions` and `inc`, as before. slate.revision counts every save, workshop saves included.
//
// The write is one conditional update on the revision the core read, so the touch record and
// the content change together; a concurrent save makes the core read again and rebuild.
import { SEARCH_FIELDS, searchDescription, searchFieldsOf, searchName, searchText } from './slate-search-fields.mjs'
import { moveAnnotation } from './workshop-move-log.mjs'

// How many saves the slate document remembers the touches of. A caller whose revision is older
// than that is refused: nothing can show its notes are untouched.
export const TOUCH_WINDOW = 64
// The most note properties one remembered touch lists. A bigger save (a first save that fills in
// every note's defaults, a whole-board layout) is remembered by note, and past this many notes as
// "everything": a writer whose revision is older is then refused, as it would be for a gap.
export const TOUCH_LIMIT = 256

function compactTouch(revision, properties, fields) {
  if (properties.length <= TOUCH_LIMIT) return { revision, properties, fields }
  const notes = [...new Set(properties.map(([id]) => id))]
  if (notes.length <= TOUCH_LIMIT) return { revision, properties: notes.map((id) => [id, '*']), fields }
  return { revision, all: true, properties: [], fields }
}
const ATTEMPTS = 5

export class SlateSaveConflict extends Error {
  constructor(message, details) {
    super(message)
    this.status = 409
    this.code = 'slate_changed'
    this.details = details
  }
}

export class SlateSaveRefused extends Error {
  constructor() {
    super('The slate was not saved: it changed in a way this save does not allow.')
    this.code = 'save_refused'
  }
}

// Key order is not content: a browser that re-exports a note in another key order changed nothing.
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}
const json = (value) => JSON.stringify(canonical(value ?? null))
// Equal content. The browser re-exports a note in the key order it was stored in, so the plain
// serialization (native, fast) settles almost every note; only a note whose plain form differs is
// compared in key order. An autosave of a large slate then costs one native pass, not a sort of
// every key of every note.
const same = (x, y) => x === y || JSON.stringify(x ?? null) === JSON.stringify(y ?? null) || json(x) === json(y)
const noteId = (node) => (typeof node?.options?.id === 'string' ? node.options.id : null)
const itemId = (item) => (typeof item?.id === 'string' ? item.id : noteId(item))

function byId(items) {
  const map = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const id = itemId(item)
    if (id !== null) map.set(id, item)
  }
  return map
}

// A change the ids cannot name: another order, another count, or a note without an id (or one
// sharing an id with another) that differs.
function unnamedChange(before, after) {
  const x = Array.isArray(before) ? before : []
  const y = Array.isArray(after) ? after : []
  if (x.length !== y.length || !Array.isArray(before) !== !Array.isArray(after)) return !same(before, after)
  const a = byId(x)
  for (let i = 0; i < x.length; i += 1) {
    const id = itemId(x[i])
    if (id !== itemId(y[i])) return true
    if ((id === null || a.get(id) !== x[i]) && !same(x[i], y[i])) return true
  }
  return false
}

// The properties of one note (or workshop item) whose value differs: each key of its options,
// and each other top-level key, as [id, "options.text"], [id, "relationships"] ...
function changedProperties(id, before, after) {
  const out = []
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  for (const key of keys) {
    const x = before?.[key]
    const y = after?.[key]
    if (key === 'options' && x && y && typeof x === 'object' && typeof y === 'object') {
      for (const name of new Set([...Object.keys(x), ...Object.keys(y)]))
        if (!same(x[name], y[name])) out.push([id, `options.${name}`])
    } else if (!same(x, y)) out.push([id, key])
  }
  return out
}

// Ids present before and after that differ, ids only on one side, and the properties touched:
// [id, "*"] for a note added or removed, [id, property] for each property changed.
function diffItems(before, after) {
  const a = byId(before)
  const b = byId(after)
  const changed = []
  const added = []
  const properties = []
  for (const [id, item] of b) {
    if (!a.has(id)) {
      added.push(id)
      properties.push([id, '*'])
      continue
    }
    if (same(a.get(id), item)) continue
    const touched = changedProperties(id, a.get(id), item)
    if (touched.length) {
      changed.push(id)
      properties.push(...touched)
    }
  }
  const removed = [...a.keys()].filter((id) => !b.has(id))
  properties.push(...removed.map((id) => [id, '*']))
  return { changed, added, removed, properties }
}

function read(doc, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc)
}

// The workshop's lanes, cards and signals are its notes; its other keys are settings.
function workshopOf(model) {
  return model && typeof model === 'object' && model.workshop && typeof model.workshop === 'object' ? model.workshop : null
}

/**
 * What a change does to a slate: the note (and workshop item) ids it adds, changes and removes,
 * and the settings paths whose value it changes. `set` is the update's $set; `nodes` and
 * `creative.model` / `creative.model.workshop` are compared item by item, anything else by value.
 */
export function diffSlate(current, set) {
  const added = []
  const changed = []
  const removed = []
  const properties = []
  const fields = []
  const take = (diff) => {
    added.push(...diff.added)
    changed.push(...diff.changed)
    removed.push(...diff.removed)
    properties.push(...diff.properties)
  }
  for (const [path, value] of Object.entries(set)) {
    if (path === 'lastSaved' || path === 'revision' || path === 'recentTouches') continue
    if (path === 'nodes') {
      const diff = diffItems(current?.nodes, value)
      take(diff)
      // A change the ids cannot name (notes without an id, a new order) still changes the notes.
      if (!diff.added.length && !diff.changed.length && !diff.removed.length && unnamedChange(current?.nodes, value))
        fields.push('nodes')
      continue
    }
    const modelPath = path === 'creative.model' || path === 'creative.model.workshop'
    const beforeWorkshop = modelPath ? workshopOf(current?.creative?.model) : undefined
    let afterWorkshop
    if (path === 'creative.model') afterWorkshop = workshopOf(value)
    else if (path === 'creative.model.workshop') afterWorkshop = value
    if (afterWorkshop && beforeWorkshop !== undefined) {
      const before = beforeWorkshop || {}
      for (const key of ['lanes', 'cards', 'signals']) take(diffItems(before[key], afterWorkshop[key]))
      const keys = new Set([...Object.keys(before), ...Object.keys(afterWorkshop)])
      for (const key of keys) {
        if (['lanes', 'cards', 'signals'].includes(key)) continue
        if (!same(before[key], afterWorkshop[key])) fields.push(`workshop.${key}`)
      }
      if (path === 'creative.model') {
        const { workshop: _a, ...restBefore } = current?.creative?.model || {}
        const { workshop: _b, ...restAfter } = value || {}
        if (!same(restBefore, restAfter)) fields.push('creative.model')
      }
      continue
    }
    if (!same(read(current, path), value)) fields.push(path)
  }
  return { added, changed, removed, properties, fields }
}

// The search fields a change needs, from what will be stored.
function searchFieldsFor(current, set) {
  const out = {}
  if ('nodes' in set) out['options.searchText'] = searchText(set.nodes)
  if ('options.name' in set) out['options.searchName'] = searchName(set['options.name'])
  if ('options.description' in set) out['options.searchDescription'] = searchDescription(set['options.description'])
  // A slate saved before the server built them gets each one it lacks.
  if (current) {
    const missing = (field) => read(current, `options.${field}`) === undefined && !(`options.${field}` in out)
    if (missing('searchText')) out['options.searchText'] = searchText(current.nodes)
    if (missing('searchName')) out['options.searchName'] = searchName(current.options?.name)
    if (missing('searchDescription')) out['options.searchDescription'] = searchDescription(current.options?.description)
  }
  return out
}

const stripSearch = (set) =>
  Object.fromEntries(Object.entries(set).filter(([path]) => !SEARCH_FIELDS.some((f) => path === `options.${f}`)))

function checkConflict(current, expected, diff) {
  const revision = current.revision ?? 0
  if (expected > revision)
    throw new SlateSaveConflict(`That revision is newer than the slate's (${revision}). Read the slate again.`, { revision })
  if (expected === revision) return
  const later = (current.recentTouches || []).filter((touch) => touch.revision > expected)
  const details = (notes, fields) => ({ revision, notes, fields })
  if (later.length !== revision - expected || later.some((touch) => touch.all))
    throw new SlateSaveConflict('The slate has changed a lot since that revision. Read it again and retry.', details([], []))
  // Only what this save changes or removes can conflict; an added note never does. A property
  // conflicts with a later change of the same property of the same note, or with that note being
  // added or removed; removing a note conflicts with any later change to it.
  const added = new Set(diff.added)
  const mine = diff.properties.filter(([id]) => !added.has(id))
  const theirs = later.flatMap((touch) => touch.properties || [])
  const clash = ([id, a], [other, b]) => id === other && (a === b || a === '*' || b === '*')
  const notes = [...new Set(mine.filter((p) => theirs.some((t) => clash(p, t))).map(([id]) => id))]
  const fields = new Set(diff.fields)
  const settings = [...new Set(later.flatMap((touch) => touch.fields || []).filter((path) => fields.has(path)))]
  if (notes.length || settings.length)
    throw new SlateSaveConflict(
      `Someone changed ${notes.length ? 'these notes' : 'these settings'} after the revision you read. Read the slate again and retry.`,
      details(notes, settings)
    )
}

function actorRow(actor = {}) {
  const row = { kind: actor.kind ?? 'person', userId: actor.userId ?? null }
  if (actor.tokenId) row.tokenId = actor.tokenId
  if (actor.tokenName) row.tokenName = actor.tokenName
  if (actor.visitor) row.visitor = actor.visitor
  return row
}

/**
 * @param {object} stores
 * @param stores.slates  the slates collection (findOne, updateOne, insertOne; MongoDB driver API)
 * @param stores.events  the event log collection (insertOne)
 * @param stores.now     the clock
 * @param stores.onEventError  told when an event row could not be written (the content is saved)
 */
export function createSlateSaveCore({ slates, events, now = Date.now, onEventError = () => {} }) {
  async function append(row, session) {
    try {
      await events.insertOne(row, session ? { session } : undefined)
    } catch (error) {
      if (session) throw error
      onEventError(error, row)
    }
  }

  /**
   * Save a change to an existing slate.
   *
   * @param {object} request
   * @param request.slateId
   * @param request.actor   who saves: { kind: person | guest | agent, userId, tokenId?, tokenName?, visitor? }
   * @param request.source  which writer: autosave, operations, conversation, workshop, settings ...
   * @param request.conditions  selector fields the caller's authorization depends on
   * @param request.build   (current) => { set, inc } | null. Called on each attempt with the stored slate.
   * @param request.expectedRevision  the slate.revision the caller read, when it names one
   * @param request.session  a MongoDB session when the caller writes other rows in one transaction
   * @returns {{ revision, saved, notes, fields, slate }} `saved` is false when nothing changed
   * @throws SlateSaveConflict (409 slate_changed) and SlateSaveRefused (conditions no longer hold)
   */
  async function save({ slateId, actor, source, conditions = {}, build, expectedRevision, session }) {
    const options = session ? { session } : undefined
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0))
      throw new TypeError('expectedRevision must be a whole number of 0 or more')
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const current = await slates.findOne({ _id: slateId, ...conditions }, options)
      if (!current) throw new SlateSaveRefused()
      const revision = current.revision ?? 0
      const change = await build(current)
      if (!change) return { revision, saved: false, notes: [], fields: [], slate: current }
      const set = stripSearch(change.set || {})
      const inc = change.inc || {}
      const diff = diffSlate(current, set)
      const notes = [...diff.added, ...diff.changed, ...diff.removed]
      const touchedSomething = notes.length > 0 || diff.fields.length > 0
      if (!touchedSomething && !Object.keys(inc).length) {
        // Nothing to log or count. The caller's conditions are still checked, atomically, by the
        // one field such a save has always written: it is refused if they stopped holding.
        const held = await slates.updateOne({ _id: slateId, ...conditions }, { $set: { lastSaved: now() } }, options)
        if (!held.matchedCount) throw new SlateSaveRefused()
        return { revision, saved: false, notes: [], fields: [], slate: current }
      }

      if (expectedRevision !== undefined) checkConflict(current, expectedRevision, diff)

      const next = revision + 1
      const at = now()
      const touch = compactTouch(next, diff.properties, diff.fields)
      const update = {
        $set: { ...set, ...searchFieldsFor(current, set), lastSaved: at },
        $inc: { ...inc, revision: 1 },
        $push: { recentTouches: { $each: [touch], $slice: -TOUCH_WINDOW } },
      }
      const written = await slates.updateOne(
        { _id: slateId, ...conditions, revision: current.revision ?? null },
        update,
        options
      )
      if (written.matchedCount) {
        // The cards this save moved between lanes, with the row's time. A board it can't read logs none.
        let moved = {}
        try { moved = moveAnnotation(current, set) } catch { /* Not a board the log can read. */ }
        await append(
          { _id: `${slateId}:${next}`, slateId, revision: next, at, source, actor: actorRow(actor), notes, properties: diff.properties, fields: diff.fields, ...moved },
          session
        )
        return { revision: next, saved: true, notes, fields: diff.fields, slate: current }
      }
      // Either another save landed (the revision moved: build again on it), or the caller's
      // conditions no longer hold.
      const latest = await slates.findOne({ _id: slateId }, { ...options, projection: { revision: 1 } })
      if (!latest || (latest.revision ?? 0) === revision) throw new SlateSaveRefused()
    }
    throw new SlateSaveConflict('The slate is changing too quickly to save. Retry.', {})
  }

  /**
   * Store a new slate at revision 1, with its search fields, and log its creation. Returns
   * { created: false } when a slate with that id already exists (a retried create), except
   * inside a caller's transaction, where the duplicate error is the caller's to handle.
   */
  async function create({ row, actor, source, session }) {
    const at = row.lastSaved ?? now()
    const doc = {
      ...row,
      revision: 1,
      recentTouches: [],
      options: { ...row.options, ...searchFieldsOf(row) },
    }
    try {
      await slates.insertOne(doc, session ? { session } : undefined)
    } catch (error) {
      if (error?.code === 11000 && !session) return { created: false, revision: null, slate: null }
      throw error
    }
    await append(
      {
        _id: `${doc._id}:1`, slateId: doc._id, revision: 1, at, source, actor: actorRow(actor),
        notes: [...byId(doc.nodes).keys()], fields: [],
      },
      session
    )
    return { created: true, revision: 1, slate: doc }
  }

  /**
   * The conflict a save of `set` on `current` would meet with expectedRevision, without saving:
   * a preview reports what its save would be told. Throws SlateSaveConflict.
   */
  function check({ current, set, expectedRevision }) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new TypeError('expectedRevision must be a whole number of 0 or more')
    checkConflict(current, expectedRevision, diffSlate(current, stripSearch(set)))
  }

  return { save, create, check }
}
