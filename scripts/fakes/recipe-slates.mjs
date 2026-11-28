// The app side the recipes runner writes through (enterprise/server/recipes/meteor.js builds the
// real one on slates.applyOperations, the suggestion store and the event log), in memory, with the
// real engine applying every plan (slateboxjs/operations). MIT, test support.
//   read(slateId)  events(slateId, since)  waiting(slateId)  apply(principal, slateId, plan, expectedRevision)
//   applyPreview(slate, plan)  comment(principal, slateId, noteId, text)  paused(slateId)
//   board / addBoard / boardEdits   a small lanes board
//   mermaidHash(slateId)
// Test helpers: personEdit(slateId, ops) (a person's save), keepAll(slateId), discardAll(slateId), pause(slateId)
// onSave({ slateId, shareId, actor }) is told of every save, as the app's save core tells recipes
// (web/app/server/recipes-hooks.mjs slateSaved).
import { applyPlanToJSON } from 'slateboxjs/operations'
import { createHash } from 'node:crypto'

const idOf = (node) => node?.options?.id
function diff(before, after) {
  const a = new Map((before || []).map((n) => [idOf(n), n]))
  const b = new Map((after || []).map((n) => [idOf(n), n]))
  const properties = []
  for (const [id, node] of b) {
    if (!a.has(id)) {
      properties.push([id, '*'])
      continue
    }
    const was = a.get(id).options || {}
    for (const key of new Set([...Object.keys(was), ...Object.keys(node.options || {})])) if (JSON.stringify(was[key]) !== JSON.stringify(node.options?.[key])) properties.push([id, key])
    if (JSON.stringify(a.get(id).relationships) !== JSON.stringify(node.relationships)) properties.push([id, 'relationships'])
  }
  for (const id of a.keys()) if (!b.has(id)) properties.push([id, '*'])
  return properties
}

export function createFakeSlates({ slates: store = new Map(), onSave = () => {} } = {}) {
  const events = []
  const waitingBy = new Map() // slateId → [{ plan, principal }]
  const comments = []
  const paused = new Set()
  const boards = new Map() // `${slateId}:${key}` → { boardId, lanes, cards }
  const applied = []
  let n = 0
  const slateOf = (slateId) => {
    const s = store.get(slateId)
    if (!s) throw Object.assign(new Error('no slate'), { status: 404, code: 'not_found' })
    s.nodes ||= []
    s.revision ||= 0
    return s
  }
  function save(slateId, actor, next) {
    const s = slateOf(slateId)
    const properties = diff(s.nodes, next.nodes)
    s.nodes = next.nodes
    s.revision += 1
    events.push({ slateId, revision: s.revision, actor, properties })
    helpers.saves.push(Promise.resolve(onSave({ slateId, shareId: s.shareId, actor })))
    return s.revision
  }
  const adapter = {
    async read(slateId) {
      const s = store.get(slateId)
      return s ? { slate: { nodes: structuredClone(s.nodes || []) }, revision: s.revision || 0, shareId: s.shareId, name: s.name } : null
    },
    async events(slateId, since) {
      return events.filter((e) => e.slateId === slateId && e.revision > since)
    },
    async waiting(slateId) {
      const ids = new Set()
      for (const { plan } of waitingBy.get(slateId) || []) for (const op of plan.operations) for (const id of op.ids || []) ids.add(id)
      return ids
    },
    async apply(principal, slateId, plan, expectedRevision) {
      const s = slateOf(slateId)
      if (expectedRevision !== s.revision) throw Object.assign(new Error('The slate changed.'), { status: 409, code: 'slate_changed' })
      applied.push({ slateId, plan, direct: Boolean(principal.direct) })
      if (!principal.direct) {
        if (!waitingBy.has(slateId)) waitingBy.set(slateId, [])
        waitingBy.get(slateId).push({ plan, principal })
        return { outcome: 'suggested', revision: s.revision, actionId: `act${++n}` }
      }
      const result = applyPlanToJSON({ nodes: s.nodes }, plan, { requireMatches: false })
      const revision = save(slateId, { kind: 'agent', userId: principal.userId, tokenId: principal.tokenId }, result.slate)
      return { outcome: 'saved', revision, operationRunId: `op${++n}` }
    },
    applyPreview(slate, plan) {
      return applyPlanToJSON(slate, plan, { requireMatches: false }).slate
    },
    async comment(principal, slateId, noteId, text) {
      comments.push({ slateId, noteId, text, by: principal.tokenId })
    },
    async paused(slateId) {
      return paused.has(slateId)
    },
    async board(slateId, key) {
      const b = boards.get(`${slateId}:${key}`)
      return b ? structuredClone(b) : null
    },
    async addBoard(principal, slateId, { key, component, title }) {
      boards.set(`${slateId}:${key}`, { boardId: `b${++n}`, component, title, lanes: [], cards: [] })
    },
    async boardEdits(principal, slateId, boardId, edits) {
      const b = [...boards.entries()].find(([k, v]) => k.startsWith(`${slateId}:`) && v.boardId === boardId)?.[1]
      for (const edit of edits) {
        if (edit.kind === 'add_lane') b.lanes.push({ id: `l${++n}`, label: edit.label })
        else if (edit.kind === 'add_card') {
          const lane = b.lanes.find((l) => l.id === edit.lane || l.label === edit.lane)
          b.cards.push({ id: `c${++n}`, label: edit.label, laneId: lane?.id })
        } else if (edit.kind === 'rename_card') b.cards.find((c) => c.id === edit.card).label = edit.label
        else if (edit.kind === 'move_card') b.cards.find((c) => c.id === edit.card).laneId = edit.lane
        else if (edit.kind === 'remove_card') b.cards = b.cards.filter((c) => c.id !== edit.card)
      }
      const s = slateOf(slateId)
      s.revision += 1
      events.push({ slateId, revision: s.revision, actor: { kind: 'agent', userId: principal.userId, tokenId: principal.tokenId }, properties: edits.map((e) => [e.card || 'board', '*']) })
    },
    async mermaidHash(slateId) {
      const s = store.get(slateId)
      return s ? createHash('sha1').update(JSON.stringify((s.nodes || []).map((x) => [x.options.id, x.options.text]).sort())).digest('hex').slice(0, 12) : null
    },
  }
  const helpers = {
    saves: [],
    /** The save hooks told so far, done. */
    settle: () => Promise.all(helpers.saves.splice(0)),
    events,
    comments,
    applied,
    boards,
    /** A person's save: operations run as a person (their event row has no token id). */
    personEdit(slateId, operations, userId = 'person') {
      const s = slateOf(slateId)
      const result = applyPlanToJSON({ nodes: s.nodes }, { message: 'person', operations }, { requireMatches: false })
      return save(slateId, { kind: 'person', userId }, result.slate)
    },
    /** A person moves a card on a board. */
    personMoveCard(slateId, key, cardId, laneId) {
      const b = boards.get(`${slateId}:${key}`)
      b.cards.find((c) => c.id === cardId).laneId = laneId
      const s = slateOf(slateId)
      s.revision += 1
      events.push({ slateId, revision: s.revision, actor: { kind: 'person', userId: 'person' }, properties: [], moves: [{ cardId }] })
    },
    keepAll(slateId, userId = 'person') {
      for (const { plan } of waitingBy.get(slateId) || []) {
        const s = slateOf(slateId)
        const result = applyPlanToJSON({ nodes: s.nodes }, plan, { requireMatches: false })
        save(slateId, { kind: 'person', userId }, result.slate)
      }
      waitingBy.delete(slateId)
    },
    discardAll(slateId) {
      waitingBy.delete(slateId)
    },
    pause(slateId) {
      paused.add(slateId)
    },
    notesOf(slateId) {
      return (store.get(slateId)?.nodes || []).map((node) => ({ id: idOf(node), text: node.options.text, x: node.options.xPos, y: node.options.yPos, locked: node.options.locked }))
    },
  }
  return { adapter, ...helpers }
}
