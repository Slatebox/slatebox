// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What a run wants a slate to hold, turned into the canvas operations that get it there without
// losing what people did. The rules (catalog R1–R9):
//   R1 ids     every recipe note and line id comes from its key (noteId, connectorId), so a run
//              finds its notes again however they moved; recipeNotes maps an id back to its key.
//   R2 places  a note the recipe already placed is never moved or resized; new notes are laid out
//              beside the notes they belong with, clear of every note on the slate.
//   R3 edits   a note a person changed (text, shape, colors, link) or deleted is theirs from then
//              on (ownership.mjs); the recipe never changes or deletes it again.
//   R4 locks   a locked note is pinned: never changed (counted as kept by a person).
//   R5 gone    an item the source dropped: the recipe's own note is deleted; a person's note is
//              left and gets one comment saying so (marked gone).
//   R6 scope   notes people added are invisible to the recipe: every selector is a list of ids
//              from recipeNotes, never text or "all".
//   R7         conflicts are the runner's (expectedRevision, one re-read and retry).
//   R8, R9     receipts and approvals are the runner's.
// Pure: no Meteor, no engine. Plans keep to the public limit of 50 operations each.
import { createHash } from 'node:crypto'
import { flipTouched } from './ownership.mjs'

export const OPS_PER_PLAN = 50
export const NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const FRAME_STYLE = Object.freeze({ backgroundColor: '#f3f6fa', borderColor: '#9aa8ba', borderWidth: 1, borderStyle: 'dashed', foregroundColor: '#2c3a4b', textXAlign: 'left', textYAlign: 'top', fontSize: 16 })
export const LEGEND_STYLE = Object.freeze({ backgroundColor: '#fff8db', borderColor: '#e0c35a', foregroundColor: '#3d3418', fontSize: 13 })
export const NOTE_STYLE = Object.freeze({ backgroundColor: '#23aad6', foregroundColor: '#000000' })
const LAYOUT = Object.freeze({ gapX: 70, gapY: 90, noteHeight: 70, minWidth: 140, maxWidth: 320, charWidth: 7.5, margin: 40, frameTitle: 36 })
const STYLE_KEYS = ['backgroundColor', 'foregroundColor', 'borderColor', 'borderWidth', 'borderStyle', 'fontSize', 'opacity']
const SHAPES = new Set(['rectangle', 'roundedrectangle', 'ellipse', 'circle', 'diamond', 'hexagon', 'parallelogram', 'triangle', 'star', 'trapezium', 'rarrow', 'larrow'])

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'
function base32(buffer) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out
}

/** A note's id from its key: `${prefix}_` and 12 base32 characters of sha1(key). */
export const noteId = (prefix, key) => `${prefix}_${base32(createHash('sha1').update(String(key)).digest()).slice(0, 12)}`
/** A line's id from its two notes. */
export const connectorId = (fromId, toId) => `${fromId}->${toId}`
export const contentHash = (value) => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16)

const optionOf = (node, key) => node?.options?.[key] ?? node?.[key]
const idOf = (node) => optionOf(node, 'id')

/** The slate as reconcile reads it: notes by id (with geometry) and lines by id. */
export function readSlate(slate) {
  const notes = new Map()
  const lines = new Map()
  for (const node of slate?.nodes || []) {
    const id = idOf(node)
    if (!id) continue
    notes.set(id, {
      id, text: String(optionOf(node, 'text') ?? ''), shape: optionOf(node, 'shape') || optionOf(node, 'vectorPath') || 'rectangle',
      x: Number(optionOf(node, 'xPos') ?? optionOf(node, 'x') ?? 0), y: Number(optionOf(node, 'yPos') ?? optionOf(node, 'y') ?? 0),
      width: Number(optionOf(node, 'width') ?? 120), height: Number(optionOf(node, 'height') ?? 80),
      locked: Boolean(optionOf(node, 'locked') || optionOf(node, 'isLocked')),
      style: Object.fromEntries(STYLE_KEYS.map((k) => [k, optionOf(node, k)]).filter(([, v]) => v !== undefined)),
      link: optionOf(node, 'link') ?? null,
    })
    for (const association of node?.relationships?.associations || []) {
      const from = association.parentId || id
      const to = association.childId
      if (!to) continue
      const lineId = association.id || connectorId(from, to)
      lines.set(lineId, { id: lineId, from, to, label: association.label || '' })
    }
  }
  return { notes, lines }
}

export const noteWidth = (text) => Math.round(Math.max(LAYOUT.minWidth, Math.min(LAYOUT.maxWidth, String(text || '').split('\n').reduce((m, l) => Math.max(m, l.length), 0) * LAYOUT.charWidth + 40)))
const noteHeight = (text) => Math.max(LAYOUT.noteHeight, Math.min(220, Math.ceil(String(text || '').length / 38) * 22 + 36))

/**
 * Positions for a graph's notes, relative to (0, 0): layered (and tree, mindmap) by longest path
 * from the roots, grid otherwise. Deterministic: same graph, same places.
 */
export function layoutGraph(graph) {
  const keys = graph.nodes.map((n) => n.key)
  const known = new Set(keys)
  const size = new Map(graph.nodes.map((n) => [n.key, { width: n.size?.width || noteWidth(n.text), height: n.size?.height || noteHeight(n.text) }]))
  const places = new Map()
  if (graph.layout === 'grid') {
    const columns = Math.max(1, Math.ceil(Math.sqrt(keys.length)))
    const width = Math.max(...[...size.values()].map((s) => s.width), LAYOUT.minWidth)
    keys.forEach((key, k) => places.set(key, { x: (k % columns) * (width + LAYOUT.gapX), y: Math.floor(k / columns) * (LAYOUT.noteHeight + LAYOUT.gapY), ...size.get(key) }))
    return places
  }
  const children = new Map(keys.map((k) => [k, []]))
  const indegree = new Map(keys.map((k) => [k, 0]))
  for (const e of graph.edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue
    children.get(e.from).push(e.to)
    indegree.set(e.to, indegree.get(e.to) + 1)
  }
  // longest-path layers (cycles broken by visiting order)
  const layer = new Map()
  const queue = keys.filter((k) => indegree.get(k) === 0)
  if (!queue.length && keys.length) queue.push(keys[0])
  for (const k of queue) layer.set(k, 0)
  const seen = new Set()
  while (queue.length) {
    const k = queue.shift()
    if (seen.has(k)) continue
    seen.add(k)
    for (const c of children.get(k)) {
      if (seen.has(c)) continue
      layer.set(c, Math.max(layer.get(c) ?? 0, layer.get(k) + 1))
      queue.push(c)
    }
  }
  for (const k of keys) if (!layer.has(k)) layer.set(k, 0)
  const rows = new Map()
  for (const k of keys) {
    const l = layer.get(k)
    if (!rows.has(l)) rows.set(l, [])
    rows.get(l).push(k)
  }
  const horizontal = graph.layout === 'mindmap'
  let offset = 0
  for (const l of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(l)
    let along = 0
    let thickness = 0
    for (const k of row) {
      const s = size.get(k)
      if (horizontal) {
        places.set(k, { x: offset, y: along, ...s })
        along += s.height + LAYOUT.gapY / 2
        thickness = Math.max(thickness, s.width)
      } else {
        places.set(k, { x: along, y: offset, ...s })
        along += s.width + LAYOUT.gapX
        thickness = Math.max(thickness, s.height)
      }
    }
    offset += thickness + (horizontal ? LAYOUT.gapX : LAYOUT.gapY)
  }
  return places
}

const overlaps = (a, b, pad = 20) => a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad
const boxOf = (items) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const i of items) {
    minX = Math.min(minX, i.x)
    minY = Math.min(minY, i.y)
    maxX = Math.max(maxX, i.x + i.width)
    maxY = Math.max(maxY, i.y + i.height)
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null
}

/** The nearest free spot to `want` (a spiral of steps), clear of every obstacle. */
function freeSpot(want, obstacles) {
  if (!obstacles.some((o) => overlaps(want, o))) return want
  const step = 60
  for (let ring = 1; ring < 60; ring += 1) {
    for (let k = 0; k < ring * 8; k += 1) {
      const angle = (k / (ring * 8)) * Math.PI * 2
      const candidate = { ...want, x: Math.round(want.x + Math.cos(angle) * ring * step), y: Math.round(want.y + Math.sin(angle) * ring * step) }
      if (!obstacles.some((o) => overlaps(candidate, o))) return candidate
    }
  }
  return { ...want, y: Math.round(boxOf(obstacles).y + boxOf(obstacles).height + LAYOUT.gapY) }
}

const cleanText = (text) => String(text ?? '').replace(/\u0000/g, '').slice(0, 10000)
const styleOf = (node) => {
  const style = { ...NOTE_STYLE }
  for (const key of STYLE_KEYS) if (node.colors?.[key] !== undefined) style[key] = node.colors[key]
  return style
}

/**
 * One slate's plans.
 *   desired   a DesiredSet slate entry { role, key, name, graph?, notes? }
 *   current   the slate (JSON) as saved
 *   owned     Map<noteId, RecipeNote> for this instance and slate
 *   touched   Map<noteId, Set<prop>> people's changes since the last run (ownership.touchedSince)
 *   waiting   Set<noteId> the recipe's own suggestions still waiting on the slate
 *   gone      keys the source removed this run (incremental runs); without it, the desired set is
 *             the whole truth and any recipe note not in it is removed
 *   prefix    the recipe's id prefix (R1)
 *   source    a short "where from" for the removal comment ("acme/api @ abc1234")
 * → { plans, ownedUpdates, ownedRemovals, comments: [{ noteId, text }], stats }
 */
export function reconcileSlate({ desired, current, owned = new Map(), touched = new Map(), waiting = new Set(), gone = null, prefix, instanceId, slateId, source = '', now = new Date() }) {
  const { notes: onSlate, lines: linesOnSlate } = readSlate(current)
  const present = new Set(onSlate.keys())
  const { changed: flipped, dropped } = flipTouched(owned, touched, present, now, waiting)
  const ops = { add: [], update: [], connect: [], relabel: [], disconnect: [], remove: [] }
  const ownedUpdates = [...flipped]
  const ownedRemovals = [...dropped]
  const comments = []
  const stats = { added: 0, updated: 0, removed: 0, keptByPerson: 0, unchanged: 0 }
  const row = (id, key, kind, hash, extra = {}) => ({ _id: `${instanceId}:${slateId}:${id}`, instanceId, slateId, noteId: id, key, kind, owner: 'recipe', personProps: [], hash, gone: false, pending: false, updated: now, ...extra })
  const isPersons = (id) => owned.get(id)?.owner === 'person'
  const exists = (id) => present.has(id) || waiting.has(id)

  // Desired items, keyed. Frames are notes too (`frame:` keys), and so are legend notes (`note:`).
  const graph = desired.graph || { nodes: [], edges: [], frames: [], layout: 'layered' }
  const items = new Map()
  for (const n of graph.nodes) items.set(`node:${n.key}`, { kind: 'note', key: `node:${n.key}`, graphKey: n.key, text: cleanText(n.text), shape: SHAPES.has(n.shape) ? n.shape : 'rectangle', style: styleOf(n), link: n.link || null })
  for (const f of graph.frames || []) items.set(`frame:${f.key}`, { kind: 'note', frame: true, key: `frame:${f.key}`, text: cleanText(f.text), shape: 'rectangle', style: { ...FRAME_STYLE }, members: f.members, link: null })
  for (const n of desired.notes || []) items.set(`note:${n.key}`, { kind: 'note', legend: true, key: `note:${n.key}`, text: cleanText(n.text), shape: 'rectangle', style: { ...LEGEND_STYLE }, link: n.link || null, anchor: n.anchor || 'legend' })
  const idFor = (key) => noteId(prefix, key)

  // Places for new notes: the layout, moved to sit with the recipe's notes already on the slate
  // (the median shift of the ones placed), else to the right of everything on the slate.
  const layout = layoutGraph(graph)
  const obstacles = [...onSlate.values()]
  const shifts = []
  for (const [key, place] of layout) {
    const at = onSlate.get(idFor(`node:${key}`))
    if (at && owned.has(at.id)) shifts.push({ dx: at.x - place.x, dy: at.y - place.y })
  }
  let shift
  if (shifts.length) {
    const median = (list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)]
    shift = { dx: median(shifts.map((s) => s.dx)), dy: median(shifts.map((s) => s.dy)) }
  } else {
    const box = boxOf(obstacles)
    shift = box ? { dx: box.x + box.width + LAYOUT.gapX * 2, dy: box.y + LAYOUT.frameTitle + 60 } : { dx: LAYOUT.margin, dy: LAYOUT.margin + LAYOUT.frameTitle + 60 }
  }
  const placed = new Map() // key → box of new notes this run
  const placeNew = (item) => {
    let want
    if (item.graphKey && layout.has(item.graphKey)) {
      const p = layout.get(item.graphKey)
      want = { x: Math.round(p.x + shift.dx), y: Math.round(p.y + shift.dy), width: p.width, height: p.height }
    } else {
      want = { x: Math.round(shift.dx), y: Math.round(shift.dy - LAYOUT.frameTitle - 60), width: noteWidth(item.text), height: noteHeight(item.text) }
    }
    const spot = freeSpot(want, [...obstacles, ...placed.values()])
    placed.set(item.key, spot)
    return spot
  }

  // Notes: add new ones (frames last, sized around their members), update the recipe's own.
  const order = [...items.values()].sort((a, b) => Number(Boolean(a.frame)) - Number(Boolean(b.frame)))
  for (const item of order) {
    const id = idFor(item.key)
    const hash = contentHash([item.text, item.shape, item.style, item.link])
    const mine = owned.get(id)
    if (isPersons(id)) {
      stats.keptByPerson += 1
      continue
    }
    if (!exists(id)) {
      if (mine && !mine.pending && !waiting.has(id)) continue // deleted by a person: flipped above
      let box
      if (item.frame) {
        const members = (item.members || []).map((m) => placed.get(`node:${m}`) || onSlate.get(idFor(`node:${m}`))).filter(Boolean)
        const around = boxOf(members)
        if (!around) continue
        box = { x: around.x - 24, y: around.y - LAYOUT.frameTitle - 16, width: around.width + 48, height: around.height + LAYOUT.frameTitle + 40 }
        placed.set(item.key, box)
      } else box = placeNew(item)
      ops.add.push({
        kind: 'add_nodes', count: 1, ids: [id], shape: item.shape, text: item.text,
        x: box.x, y: box.y, width: Math.round(Math.min(5000, box.width)), height: Math.round(Math.min(5000, box.height)),
        style: { ...item.style, ...(item.link && { link: item.link }) },
      })
      ownedUpdates.push(row(id, item.key, 'note', hash))
      stats.added += 1
      continue
    }
    if (waiting.has(id) && !present.has(id)) continue // its suggestion still waits
    const note = onSlate.get(id)
    if (!mine) {
      // a note with the recipe's id the recipe has no record of: someone else's, left alone
      stats.keptByPerson += 1
      continue
    }
    if (note.locked) {
      stats.keptByPerson += 1
      continue
    }
    if (mine.hash === hash) {
      stats.unchanged += 1
      continue
    }
    const changes = {}
    if (note.text !== item.text) changes.text = item.text
    if (!item.frame && note.shape !== item.shape) changes.shape = item.shape
    for (const key of ['backgroundColor', 'foregroundColor', 'borderColor']) if (item.style[key] !== undefined && note.style[key] !== item.style[key]) changes[key] = item.style[key]
    if (Object.keys(changes).length) {
      ops.update.push({ kind: 'update_nodes', target: { ids: [id] }, changes })
      stats.updated += 1
    } else stats.unchanged += 1
    ownedUpdates.push({ ...mine, hash, updated: now })
  }

  // Lines between the recipe's notes.
  const wantedLines = new Map()
  for (const e of graph.edges) {
    const from = idFor(`node:${e.from}`)
    const to = idFor(`node:${e.to}`)
    if (from === to || !items.has(`node:${e.from}`) || !items.has(`node:${e.to}`)) continue
    wantedLines.set(connectorId(from, to), { from, to, ends: [`node:${e.from}`, `node:${e.to}`], label: String(e.label || '').slice(0, 500), style: e.style || null })
  }
  const endsReady = (id) => exists(id) || ops.add.some((op) => op.ids[0] === id)
  for (const [lineId, line] of wantedLines) {
    const mine = owned.get(lineId)
    if (mine?.owner === 'person') {
      stats.keptByPerson += 1
      continue
    }
    const there = linesOnSlate.get(lineId)
    const hash = contentHash([line.label, line.style])
    if (!there) {
      if (mine && !mine.pending) continue // a person removed it
      if (waiting.has(lineId)) continue
      if (!endsReady(line.from) || !endsReady(line.to)) continue
      const style = { showChildArrow: true, ...(line.label && { label: line.label }), ...(line.style === 'dashed' && { lineType: 'dashed' }) }
      ops.connect.push({ kind: 'connect_nodes', from: { ids: [line.from] }, to: { ids: [line.to] }, ids: [lineId], style })
      ownedUpdates.push(row(lineId, `line:${line.ends[0]}>${line.ends[1]}`, 'connector', hash, { ends: line.ends }))
      continue
    }
    if (mine && mine.hash !== hash && there.label !== line.label) {
      ops.relabel.push({ kind: 'update_connections', connectionIds: [lineId], changes: { label: line.label } })
      ownedUpdates.push({ ...mine, hash, updated: now })
    }
  }

  // What the source no longer has.
  const goneKeys = gone ? new Set(gone.map((k) => (String(k).includes(':') ? k : `node:${k}`))) : null
  for (const [id, mine] of owned) {
    if (mine.gone) continue
    const stillWanted = mine.kind === 'connector' ? wantedLines.has(id) : items.has(mine.key)
    // incremental: only what the source said is gone (a line goes with either end, or by its own key)
    const removed = goneKeys
      ? (mine.kind === 'connector' ? !stillWanted && (goneKeys.has(mine.key) || (mine.ends || []).some((k) => goneKeys.has(k))) : goneKeys.has(mine.key))
      : !stillWanted
    if (!removed) continue
    if (mine.owner === 'person') {
      if (mine.kind === 'note' && present.has(id)) {
        comments.push({ noteId: id, text: `Removed from ${source || 'the source'}.` })
        ownedUpdates.push({ ...mine, gone: true, updated: now })
      }
      continue
    }
    if (mine.kind === 'connector') {
      const there = linesOnSlate.get(id)
      if (there && !ops.remove.some((op) => op.target.ids.includes(there.from) || op.target.ids.includes(there.to))) ops.disconnect.push({ kind: 'disconnect_nodes', from: { ids: [there.from] }, to: { ids: [there.to] } })
      ownedRemovals.push(id)
      continue
    }
    if (present.has(id)) {
      const note = onSlate.get(id)
      if (note.locked) {
        stats.keptByPerson += 1
        continue
      }
      ops.remove.push({ kind: 'delete_nodes', target: { ids: [id] } })
      stats.removed += 1
    }
    ownedRemovals.push(id)
  }

  const operations = [...ops.add, ...ops.update, ...ops.connect, ...ops.relabel, ...ops.disconnect, ...ops.remove]
  // one delete_nodes for many notes
  const plans = []
  for (let start = 0; start < operations.length; start += OPS_PER_PLAN) {
    plans.push({ message: planMessage(stats, desired.name), operations: operations.slice(start, start + OPS_PER_PLAN) })
  }
  return { plans, ownedUpdates, ownedRemovals: [...new Set(ownedRemovals)], comments, stats, ops: operations.length }
}

const planMessage = (stats, name) => {
  const parts = []
  if (stats.added) parts.push(`${stats.added} added`)
  if (stats.updated) parts.push(`${stats.updated} updated`)
  if (stats.removed) parts.push(`${stats.removed} removed`)
  return `Kept ${String(name || 'this slate').slice(0, 60)} up to date${parts.length ? ': ' + parts.join(', ') : ''}`
}

/**
 * A board's edits (workshop_edits) toward the cards a run wants.
 *   desired   { key, component, title, lanes: [{ key, label }], cards: [{ key, label, lane, reclaim? }], keepRules? }
 *   current   { lanes: [{ id, label }], cards: [{ id, label, laneId }], rules?: [{ id, kind }] } as the board stands, or null
 *   owned     Map<cardId, RecipeNote> (kind card/lane), keyed by the board item id
 *   touched   Map<itemId, Set<prop>> (a person moved, renamed or removed a card)
 * Cards are found by their recipe key through owned (row.key); new cards are matched back to keys
 * after they are made (the runner reads the board again: matchNewCards).
 * A board the recipe just added drops its component's own working rules (a team board's three-card
 * limit on Doing, its no-skipping path), unless desired.keepRules: the board follows a source outside
 * Slatebox, whose items are where they are; a rule a person adds later is theirs and stays.
 * A card a person only moved (lane, nothing else) is theirs until the source changes that item
 * again: card.reclaim says it did, and the card follows the source once more (the sheet's and
 * Linear's "the source wins" rule).
 * → { edits, lanesToAdd, stats, ownedUpdates, ownedRemovals }
 */
export function reconcileBoard({ desired, current, owned = new Map(), touched = new Map(), instanceId, slateId, now = new Date() }) {
  const cur = current || { lanes: [], cards: [] }
  const present = new Set([...cur.cards.map((c) => c.id), ...cur.lanes.map((l) => l.id)])
  const { changed: flipped, dropped } = flipTouched(owned, touched, present, now)
  const stats = { added: 0, updated: 0, removed: 0, keptByPerson: 0, unchanged: 0 }
  const ownedUpdates = [...flipped]
  const ownedRemovals = [...dropped]
  const edits = []
  const byKey = new Map([...owned.values()].map((r) => [r.key, r]))
  const laneId = new Map()
  // A board the recipe just added holds its component's own empty lanes (a team board's To do,
  // Doing, Review, Done, Won't do), and a board holds at most five: those lanes are renamed to the
  // recipe's, and any left over removed. Only while the board is untouched: no cards, and no lane
  // the recipe already keeps (after that, a lane someone adds is theirs).
  const fresh = cur.cards.length === 0 && ![...owned.values()].some((r) => r.kind === 'lane')
  // On a fresh board the component's lanes are taken in their order (renamed where the words differ),
  // so the board's lanes stand in the recipe's order.
  const spare = fresh ? [...cur.lanes] : []
  const laneEdits = fresh && !desired.keepRules ? (cur.rules || []).filter((r) => typeof r?.id === 'string').map((r) => ({ kind: 'remove_rule', rule: r.id, key: `rule:${r.id}` })) : []
  for (const lane of desired.lanes || []) {
    const rowFor = byKey.get(`lane:${lane.key}`)
    const there = rowFor && cur.lanes.find((l) => l.id === rowFor.noteId)
    const byLabel = cur.lanes.find((l) => l.label.trim().toLowerCase() === lane.label.trim().toLowerCase())
    const found = there || (!fresh && byLabel)
    if (found) {
      laneId.set(lane.key, found.id)
      if (!rowFor) ownedUpdates.push({ _id: `${instanceId}:${slateId}:${found.id}`, instanceId, slateId, noteId: found.id, key: `lane:${lane.key}`, kind: 'lane', owner: byLabel && !there ? 'person' : 'recipe', personProps: [], hash: contentHash(lane.label), gone: false, updated: now })
    } else if (spare.length) {
      const reuse = spare.shift()
      if (reuse.label !== lane.label.slice(0, 80)) laneEdits.push({ kind: 'rename_lane', lane: reuse.id, label: lane.label.slice(0, 80), key: `lane:${lane.key}` })
      laneId.set(lane.key, reuse.id)
      ownedUpdates.push({ _id: `${instanceId}:${slateId}:${reuse.id}`, instanceId, slateId, noteId: reuse.id, key: `lane:${lane.key}`, kind: 'lane', owner: 'recipe', personProps: [], hash: contentHash(lane.label), gone: false, updated: now })
    } else {
      laneEdits.push({ kind: 'add_lane', label: lane.label.slice(0, 80), key: `lane:${lane.key}` })
      laneId.set(lane.key, lane.label)
    }
  }
  if ((desired.lanes || []).length >= 2) for (const left of spare) laneEdits.push({ kind: 'remove_lane', lane: left.id, key: `lane-default:${left.id}` })
  edits.push(...laneEdits)
  const wanted = new Set()
  for (const card of desired.cards || []) {
    const key = `card:${card.key}`
    wanted.add(key)
    let mine = byKey.get(key)
    const lane = laneId.get(card.lane) || card.lane
    if (mine?.owner === 'person') {
      const onlyMoved = (mine.personProps || []).length > 0 && mine.personProps.every((p) => p === 'lane' || p === 'laneId')
      if (!card.reclaim || !onlyMoved) {
        stats.keptByPerson += 1
        continue
      }
      // the source changed this item again: the card is the recipe's once more, and follows it
      mine = { ...mine, owner: 'recipe', personProps: [], hash: null, updated: now }
      byKey.set(key, mine)
      ownedUpdates.push(mine)
    }
    const there = mine && cur.cards.find((c) => c.id === mine.noteId)
    if (!there) {
      if (mine && !mine.pending) continue // a person removed it
      edits.push({ kind: 'add_card', lane, label: String(card.label).slice(0, 200), key })
      stats.added += 1
      continue
    }
    const hash = contentHash([card.label, card.lane])
    if (mine.hash === hash) {
      stats.unchanged += 1
      continue
    }
    if (there.label !== card.label) edits.push({ kind: 'rename_card', card: there.id, label: String(card.label).slice(0, 200) })
    if (laneId.get(card.lane) && there.laneId !== laneId.get(card.lane)) edits.push({ kind: 'move_card', card: there.id, lane: laneId.get(card.lane) })
    stats.updated += 1
    ownedUpdates.push({ ...mine, hash, updated: now })
  }
  for (const mine of owned.values()) {
    if (mine.kind !== 'card' || wanted.has(mine.key) || mine.gone) continue
    if (mine.owner === 'person') continue
    if (cur.cards.some((c) => c.id === mine.noteId)) {
      edits.push({ kind: 'remove_card', card: mine.noteId })
      stats.removed += 1
    }
    ownedRemovals.push(mine.noteId)
  }
  return { edits, stats, ownedUpdates, ownedRemovals }
}

/** After add_card and add_lane edits: the new items' ids matched back to their keys, by label and lane. */
export function matchNewItems(edits, before, after) {
  const known = new Set([...(before?.cards || []).map((c) => c.id), ...(before?.lanes || []).map((l) => l.id)])
  const out = []
  for (const edit of edits) {
    if (edit.kind === 'add_lane') {
      const lane = after.lanes.find((l) => !known.has(l.id) && l.label === edit.label)
      if (lane) {
        known.add(lane.id)
        out.push({ key: edit.key, id: lane.id, kind: 'lane' })
      }
    } else if (edit.kind === 'add_card') {
      const card = after.cards.find((c) => !known.has(c.id) && c.label === edit.label)
      if (card) {
        known.add(card.id)
        out.push({ key: edit.key, id: card.id, kind: 'card' })
      }
    }
  }
  return out
}
