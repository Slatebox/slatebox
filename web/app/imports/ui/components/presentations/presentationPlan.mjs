// A presentation plan: an overview of the whole slate, then segments that each frame a group of
// related notes, then a closing overview. Pure, shared by the presenter (the local plan it
// shows at once) and the server (the AI's plan, checked before it is saved).
import { layoutNotes, rotatedBounds } from './presentationFraming.mjs'
import { presentationNodeParts } from './presentationRuntime.mjs'

/**
 * Decks planned by this planner. An older deck is planned again: one note per step (1), an AI
 * plan whose workshop lanes were placed and named as the AI liked (2), or a deck with no style and
 * no art direction, played as grey notes under one caption bar (3).
 */
export const PLAN_VERSION = 4

/** The most notes one segment frames; a larger group is split into its branches. */
export const MAX_SEGMENT = 6

/**
 * The most segments a presentation has between its overviews. A slate with more groups than
 * this (a very large one) has neighbouring groups, in reading order, shown together.
 */
export const MAX_PLAN_SEGMENTS = 24

const MIN_DURATION = 1500
const MAX_DURATION = 10000

function coveredBox(note) {
  const bbox = note?.metrics?.bbox
  if (!bbox || ![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)) return { x: 0, y: 0, width: 0, height: 0 }
  return rotatedBounds(bbox, Number(note.metrics.rotation) || 0)
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const gapBetween = (a, b) => {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width))
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height))
  return Math.hypot(dx, dy)
}

const unionBox = (boxes) => {
  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  return {
    x: minX, y: minY,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - minX,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - minY,
  }
}

/** Order boxes as a page is read: rows from the top, each row from the left. */
function readingOrder(items, boxOf) {
  const byTop = [...items].sort((a, b) => boxOf(a).y - boxOf(b).y || boxOf(a).x - boxOf(b).x)
  const rows = []
  byTop.forEach((item) => {
    const box = boxOf(item)
    const row = rows.at(-1)
    // Same row when it starts above the middle of the row's first item.
    if (row && box.y < row.top + row.height / 2) row.items.push(item)
    else rows.push({ top: box.y, height: Math.max(box.height, 1), items: [item] })
  })
  return rows.flatMap((row) => row.items.sort((a, b) => boxOf(a).x - boxOf(b).x))
}

/**
 * The slate's notes as a graph: connections (the layout's parent → child pairs) and nearness
 * (notes closer to each other than a typical note's size). `near` holds both, found once with a
 * sweep along x, so grouping a large slate stays quick.
 */
function noteGraph(layout, include) {
  const notes = new Map()
  const edges = new Map()
  const children = new Set()
  const link = (a, b) => {
    children.add(b)
    if (!edges.has(a)) edges.set(a, new Set())
    if (!edges.has(b)) edges.set(b, new Set())
    edges.get(a).add(b)
    edges.get(b).add(a)
  }
  // Walked with a stack, not recursion: a long chain of notes is a deep tree.
  const stack = [...(layout?.nodes || [])].reverse().map((node) => ({ node, parent: null }))
  const seen = new Set()
  while (stack.length) {
    const { node, parent } = stack.pop()
    if (node?.nodeId == null) continue
    const id = String(node.nodeId)
    if (include(id)) {
      if (!notes.has(id)) notes.set(id, { id, box: coveredBox(node), text: String(node.description || '').trim() })
      if (parent && include(parent) && parent !== id) link(parent, id)
    }
    if (seen.has(node)) continue
    seen.add(node)
    const kids = node.childrenNodes || []
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push({ node: kids[i], parent: id })
  }
  const distance = Math.min(400, Math.max(40, median([...notes.values()].map(({ box }) => Math.max(box.width, box.height)))))
  const near = new Map([...notes.keys()].map((id) => [id, new Set(edges.get(id) || [])]))
  const byX = [...notes.values()].sort((a, b) => a.box.x - b.box.x)
  for (let i = 0; i < byX.length; i += 1) {
    const a = byX[i]
    const right = a.box.x + a.box.width
    for (let j = i + 1; j < byX.length && byX[j].box.x - right <= distance; j += 1) {
      const b = byX[j]
      if (gapBetween(a.box, b.box) <= distance) {
        near.get(a.id).add(b.id)
        near.get(b.id).add(a.id)
      }
    }
  }
  return { notes, edges, children, near, distance }
}

function components(ids, connected) {
  const left = new Set(ids)
  const out = []
  for (const start of ids) {
    if (!left.has(start)) continue
    left.delete(start)
    const group = [start]
    for (let i = 0; i < group.length; i += 1) {
      connected(group[i]).forEach((next) => {
        if (left.has(next)) {
          left.delete(next)
          group.push(next)
        }
      })
    }
    out.push(group)
  }
  return out
}

/**
 * A group larger than `max`: the note most connected, with its connected neighbours; then what
 * is left, branch by branch (connected or near). A wall of unconnected notes goes in rows.
 */
function splitGroup(group, graph, max = MAX_SEGMENT) {
  const boxOf = (id) => graph.notes.get(id).box
  const out = []
  const work = [group]
  while (work.length) {
    const current = work.pop()
    if (current.length <= max) {
      out.push(current)
      continue
    }
    const inGroup = new Set(current)
    const linked = (id) => [...(graph.edges.get(id) || [])].filter((other) => inGroup.has(other))
    let hub = current[0]
    let most = -1
    current.forEach((id) => {
      const count = linked(id).length
      if (count > most) {
        most = count
        hub = id
      }
    })
    if (!most) {
      const ordered = readingOrder(current, boxOf)
      for (let i = 0; i < ordered.length; i += max) out.push(ordered.slice(i, i + max))
      continue
    }
    const first = [hub, ...readingOrder(linked(hub), boxOf)].slice(0, max)
    out.push(first)
    const taken = new Set(first)
    const rest = current.filter((id) => !taken.has(id))
    const restSet = new Set(rest)
    work.push(...components(rest, (id) => [...graph.near.get(id)].filter((other) => restSet.has(other))))
  }
  return out
}

/**
 * The slate's notes in groups that belong together: notes joined by connections or close to each
 * other, a large group split into its hub (with its neighbours) and its branches. Groups come in
 * reading order. `exclude`: notes presented elsewhere (a workshop's lanes); `only`: group just
 * these notes; `max`: the most notes in one group.
 */
export function groupNotes(layout, { exclude = new Set(), only = null, max = MAX_SEGMENT } = {}) {
  const include = (id) => !exclude.has(id) && (!only || only.has(id))
  const graph = noteGraph(layout, include)
  const ids = [...graph.notes.keys()]
  const boxOf = (id) => graph.notes.get(id).box
  const groups = components(ids, (id) => graph.near.get(id))
    .flatMap((group) => splitGroup(group, graph, max))
    .map((group) => readingOrder(group, boxOf))
  return readingOrder(groups, (group) => unionBox(group.map(boxOf)))
}

/** At most `cap` groups: groups next to each other in reading order are joined until it fits. */
function capGroups(groups, cap = MAX_PLAN_SEGMENTS) {
  if (groups.length <= cap) return groups
  const size = Math.ceil(groups.length / cap)
  const out = []
  for (let i = 0; i < groups.length; i += size) out.push(groups.slice(i, i + size).flat())
  return out
}

/** The groups the AI is offered as a starting point. */
export const planHints = (layout, options) => capGroups(groupNotes(layout, options))

const firstLine = (text) => String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || ''
const shorten = (text, length = 80) => (text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text)

/**
 * A segment's narrative, from its notes: the leading note (the top of its branch, the one with
 * the most connections) and how many go with it.
 */
function groupNarrative(group, graph) {
  const linked = (id) => (graph.edges.get(id)?.size || 0)
  const tops = group.filter((id) => !graph.children.has(id))
  const lead = [...(tops.length ? tops : group)].sort((a, b) => linked(b) - linked(a))[0]
  const words = [lead, ...group].map((id) => shorten(firstLine(graph.notes.get(id)?.text))).find(Boolean)
  const others = group.length - 1
  if (!words) return others ? `These ${group.length} notes together` : 'A note on its own'
  return others ? `${words} — with ${others} related note${others === 1 ? '' : 's'}` : words
}

const overviewNarrative = (name) => (name ? `${name}: the whole slate` : 'The whole slate')
const CLOSING = 'Back to the whole picture'

const segmentDuration = (count) => Math.min(6000, 2600 + count * 400)

/**
 * A slate of at most this many notes is presented as its overview alone: there is nothing to
 * plan, so the AI is not asked (see planWithAI) and the presenter shows no planning.
 */
export const TRIVIAL_NOTES = 2

/** Whether a slate is too small to plan: its overview is the whole presentation. */
export const isTrivialLayout = (layout) => layoutNotes(layout).size <= TRIVIAL_NOTES

/**
 * The groups a plan's segments show: the notes' groups, and when the slate (its notes outside
 * the lanes) is one group, its branches, so a plan of three notes or more always has segments
 * and none of them is the whole slate again.
 */
function segmentGroups(layout, { exclude = new Set(), only = null, lanes = 0 } = {}) {
  const groups = groupNotes(layout, { exclude, only })
  if (lanes || groups.length !== 1 || groups[0].length < 3) return groups
  return groupNotes(layout, { exclude, only, max: Math.min(3, groups[0].length - 1) })
}

/**
 * The local plan (see buildFallbackPresentation): overview, the workshop's lanes (scenes), the
 * groups of the other notes, closing overview. A slate of one or two notes, or of one group of
 * up to three, is one overview.
 */
export function localPlan(layout, name, { scenes = [] } = {}) {
  const notes = layoutNotes(layout)
  const all = [...notes.keys()]
  if (!all.length) return []
  const lanes = scenes
    .filter((scene) => notes.has(String(scene.nodeIds?.[0])))
    .map((scene) => ({
      nodeIds: scene.nodeIds.map(String).filter((id) => notes.has(id)),
      narrative: scene.narrative,
      duration: 3000,
    }))
  const exclude = new Set(lanes.flatMap((lane) => lane.nodeIds.flatMap(presentationNodeParts)))
  const graph = noteGraph(layout, (id) => !exclude.has(id))
  const groups = capGroups(segmentGroups(layout, { exclude, lanes: lanes.length }), Math.max(1, MAX_PLAN_SEGMENTS - lanes.length))
  const overview = { nodeIds: all, narrative: overviewNarrative(name), duration: 3500 }
  if (isTrivialLayout(layout)) return [overview]
  return [
    overview,
    ...lanes,
    ...groups.map((group) => ({ nodeIds: group, narrative: groupNarrative(group, graph), duration: segmentDuration(group.length) })),
    { nodeIds: all, narrative: CLOSING, duration: 3000 },
  ]
}

const clampDuration = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(Math.min(MAX_DURATION, Math.max(MIN_DURATION, number))) : 3000
}

/**
 * The AI's plan, made safe to play and save: notes that are not on the slate and repeated notes
 * are dropped, a viewpoint left empty goes, an overview opens and closes it, and notes the AI
 * left out are added as groups before the close. A well-formed plan comes back as it was.
 * Returns { name, description, viewpoints }.
 */
export function normalizePresentationPlan(plan, layout, { name = '', scenes = [] } = {}) {
  const notes = layoutNotes(layout)
  const all = [...notes.keys()]
  let viewpoints = (Array.isArray(plan?.viewpoints) ? plan.viewpoints : [])
    .map((viewpoint) => {
      const raw = [viewpoint?.nodeIds ?? []].flat()
      return {
        nodeIds: [...new Set(raw.map(String))].filter((id) => notes.has(id)),
        narrative: shorten(String(viewpoint?.narrative ?? '').trim(), 200),
        duration: clampDuration(viewpoint?.duration),
      }
    })
    .filter((viewpoint) => viewpoint.nodeIds.length)
  const out = { name: String(plan?.name || '').trim(), description: String(plan?.description || '').trim() }
  if (!all.length) return { ...out, viewpoints: [] }
  const isOverview = (viewpoint) => viewpoint && all.every((id) => viewpoint.nodeIds.includes(id))
  if (isTrivialLayout(layout)) {
    return { ...out, viewpoints: [{ nodeIds: all, narrative: viewpoints[0]?.narrative || overviewNarrative(name), duration: viewpoints[0]?.duration || 3500 }] }
  }
  const opened = isOverview(viewpoints[0]) ? viewpoints.shift() : null
  const closed = viewpoints.length && isOverview(viewpoints.at(-1)) ? viewpoints.pop() : null
  // The overviews show every note; an overview the AI gave no words says what the local plan says.
  const opening = { nodeIds: all, duration: 3500, ...opened, narrative: opened?.narrative || overviewNarrative(name) }
  const closing = { nodeIds: all, duration: 3000, ...closed, narrative: closed?.narrative || CLOSING }
  const laneIds = new Set(scenes.map((scene) => String(scene.nodeIds?.[0])))
  // A workshop's lanes are its segments: one per lane, in the authored order, right after the
  // opening, then the segments of the other notes.
  // A viewpoint of the whole slate between the overviews is not a segment.
  viewpoints = viewpoints.filter((viewpoint) => !isOverview(viewpoint))
  if (scenes.length) viewpoints = laneSegments(viewpoints, scenes, notes)
  const isLane = (viewpoint) => viewpoint.nodeIds.some((id) => laneIds.has(id))
  const segments = viewpoints.filter((viewpoint) => !isLane(viewpoint))
  const singles = segments.filter((viewpoint) => viewpoint.nodeIds.length === 1).length
  if (segments.length > MAX_PLAN_SEGMENTS || (segments.length >= 3 && singles * 2 > segments.length)) {
    // One note per step (or more steps than a presentation holds): the notes are shown in the
    // groups they belong to, in the AI's order and with the AI's words.
    viewpoints = regroup(viewpoints, layout, { isLane, scenes, cap: Math.max(1, MAX_PLAN_SEGMENTS - (viewpoints.length - segments.length)) })
  }
  const covered = new Set(viewpoints.flatMap((viewpoint) => viewpoint.nodeIds))
  // A lane the AI framed brings its column, caption, picture and cards.
  scenes.forEach((scene) => {
    if (covered.has(String(scene.nodeIds?.[0]))) scene.nodeIds.forEach((id) => presentationNodeParts(id).forEach((part) => covered.add(String(part))))
  })
  const missing = new Set(all.filter((id) => !covered.has(id)))
  const graph = noteGraph(layout, (id) => missing.has(id))
  // Notes the AI left out are shown in their groups. A plan the AI gave no segment at all (only
  // overviews) gets the local plan's segments: a plan never goes from overview to overview.
  const groups = viewpoints.length ? groupNotes(layout, { only: missing }) : segmentGroups(layout, { only: missing })
  const added = missing.size ? capGroups(groups, Math.max(1, MAX_PLAN_SEGMENTS - viewpoints.length)).map((group) => ({
    nodeIds: group, narrative: groupNarrative(group, graph), duration: segmentDuration(group.length),
  })) : []
  return { ...out, viewpoints: [opening, ...viewpoints, ...added, closing] }
}

/**
 * What the AI said about a lane, after the lane's own words: its name and outcome are not said
 * twice. → '' when it said nothing more.
 */
function laneWords(scene, words) {
  const said = String(words || '').trim()
  if (!said) return ''
  const label = String(scene.label ?? '').trim()
  const own = String(scene.narrative ?? label).trim()
  const lower = said.toLowerCase()
  if (own && own.toLowerCase().includes(lower)) return ''
  let rest = said
  for (const lead of [own, label]) {
    if (lead && lower.startsWith(lead.toLowerCase())) {
      rest = said.slice(lead.length)
      break
    }
  }
  return rest.replace(/^[\s—–:·,.-]+/, '').trim()
}

/**
 * The lane's narrative: its name (and outcome), then the AI's words for it. A lane's viewpoint
 * always starts with the lane's name, so viewers know where they are.
 */
function laneNarrative(scene, words) {
  const own = String(scene.narrative ?? scene.label ?? '').trim()
  const more = laneWords(scene, words)
  if (!more) return own
  const outcome = own !== String(scene.label ?? '').trim()
  const joined = outcome ? `${own}${/[.!?]$/.test(own) ? '' : '.'} ${more[0].toUpperCase()}${more.slice(1)}` : `${own} — ${more}`
  return shorten(joined, 200)
}

/**
 * The AI's viewpoints with a workshop's lanes as segments: one viewpoint per drawn lane (the lane,
 * its picture and its cards), in the authored order, each named by its lane with the AI's words
 * for it (from the first viewpoint that framed that lane alone) and its duration. Then the AI's
 * other viewpoints, without the lanes' notes; one left with no note goes.
 */
function laneSegments(viewpoints, scenes, notes) {
  const drawn = scenes.filter((scene) => notes.has(String(scene.nodeIds?.[0])))
  const laneIds = new Set(drawn.map((scene) => String(scene.nodeIds[0])))
  const own = new Map()
  viewpoints.forEach((viewpoint) => {
    const lanes = viewpoint.nodeIds.filter((id) => laneIds.has(id))
    if (lanes.length === 1 && !own.has(lanes[0])) own.set(lanes[0], viewpoint)
  })
  const lanes = drawn.map((scene) => {
    const said = own.get(String(scene.nodeIds[0]))
    return {
      nodeIds: scene.nodeIds.map(String).filter((id) => notes.has(id)),
      narrative: laneNarrative(scene, said?.narrative),
      duration: said?.duration ?? 3000,
    }
  })
  const lanePart = new Set(drawn.flatMap((scene) => scene.nodeIds.flatMap(presentationNodeParts).map(String)))
  const rest = viewpoints
    .map((viewpoint) => ({ ...viewpoint, nodeIds: viewpoint.nodeIds.filter((id) => !lanePart.has(id)) }))
    .filter((viewpoint) => viewpoint.nodeIds.length)
  return [...lanes, ...rest]
}

/**
 * The AI's steps replaced by the local groups of the same notes: each group where the AI first
 * showed one of its notes, with the narrative the AI gave there. Lanes stay as the AI placed them.
 */
function regroup(viewpoints, layout, { isLane, scenes, cap }) {
  const lanes = viewpoints.filter(isLane)
  const exclude = new Set(lanes.flatMap((viewpoint) => viewpoint.nodeIds.flatMap(presentationNodeParts).map(String)))
  scenes.forEach((scene) => {
    if (lanes.some((viewpoint) => viewpoint.nodeIds.includes(String(scene.nodeIds?.[0])))) scene.nodeIds.forEach((id) => presentationNodeParts(id).forEach((part) => exclude.add(String(part))))
  })
  const shown = new Set(viewpoints.filter((viewpoint) => !isLane(viewpoint)).flatMap((viewpoint) => viewpoint.nodeIds))
  const only = new Set([...shown].filter((id) => !exclude.has(id)))
  const firstSeen = new Map()
  viewpoints.forEach((viewpoint, index) => viewpoint.nodeIds.forEach((id) => { if (!firstSeen.has(id)) firstSeen.set(id, index) }))
  const at = (group) => Math.min(...group.map((id) => firstSeen.get(id) ?? Infinity))
  const groups = capGroups(groupNotes(layout, { only }).sort((a, b) => at(a) - at(b)), cap)
  const graph = noteGraph(layout, (id) => only.has(id))
  const used = new Set()
  const segments = groups.map((group) => {
    const index = at(group)
    const words = Number.isFinite(index) && !used.has(index) ? viewpoints[index].narrative : ''
    if (words) used.add(index)
    return { nodeIds: group, narrative: words || groupNarrative(group, graph), duration: segmentDuration(group.length), at: index }
  })
  // Lanes keep their places among the segments.
  return [...lanes.map((viewpoint) => ({ ...viewpoint, at: viewpoints.indexOf(viewpoint) })), ...segments]
    .sort((a, b) => a.at - b.at)
    .map(({ at: _at, ...viewpoint }) => viewpoint)
}

const changedByHand = (deck) => Boolean(deck?.viewpointsManuallyChanged?.updated?.length || deck?.viewpointsManuallyChanged?.deleted?.length)

/** Every note a deck shows (a lane brings its column, caption and picture). */
const deckNotes = (deck) => new Set((deck?.viewpoints || []).flatMap((viewpoint) => (viewpoint?.nodeIds || []).flatMap(presentationNodeParts).map(String)))

/**
 * Whether the slate moved on from a deck: it has notes the deck never shows, or most of the
 * deck's notes are gone.
 */
export function slateMovedOn(deck, layout) {
  const now = layoutNotes(layout)
  if (!now.size) return false
  const shown = deckNotes(deck)
  if ([...now.keys()].some((id) => !shown.has(id))) return true
  const kept = [...shown].filter((id) => now.has(id)).length
  return kept * 2 < shown.size
}

/**
 * The slate as a plan sees it, as a short key: its notes, their words, their connections and
 * where they are (to 10 units, so drawing the same slate again gives the same key). A plan is
 * kept for the slate it was made for: Present on an unchanged slate opens it at once.
 */
export function planKey(layout) {
  const parts = []
  const visit = (nodes, parent) => (nodes || []).forEach((node) => {
    if (node?.nodeId == null) return
    const box = node.metrics?.bbox || {}
    parts.push([String(node.nodeId), parent, String(node.description || ''), ...[box.x, box.y, box.width, box.height].map((value) => Math.round((Number(value) || 0) / 10)), Math.round(Number(node.metrics?.rotation) || 0)].join('\u0001'))
    visit(node.childrenNodes, String(node.nodeId))
  })
  visit(layout?.nodes, '')
  // A 47-bit polynomial hash (exact in a double): a key, not a secret.
  const text = parts.sort().join('\u0002')
  const hash = Array.from(text).reduce((value, char) => (value * 33 + char.codePointAt(0)) % 2 ** 47, 5381)
  return `${hash.toString(36)}.${parts.length}`
}

/**
 * Whether Present plans this deck (the person's latest) again: a missing deck, an automatic one
 * (made while the AI was unavailable), one from the old one-note-per-step planner and a current
 * plan the slate has moved on from (`layout`: the slate as it is drawn now) are; a published deck
 * and one a person edited are kept (completeDeck brings them up to date when they are played).
 */
export function needsPlan(deck, layout = null) {
  if (!deck?.viewpoints?.length) return true
  if (deck.automatic) return true
  if (deck.isPublished || changedByHand(deck)) return false
  if (deck.planVersion !== PLAN_VERSION) return true
  // A plan made for this very slate is kept; the slate changed since, it is planned again.
  if (deck.layoutKey && layout) return deck.layoutKey !== planKey(layout)
  return Boolean(layout) && slateMovedOn(deck, layout)
}

/**
 * A kept deck (published, or edited by hand) played over the slate as it is now: its overviews
 * frame every note, and notes added since it was made are shown in their groups before it closes.
 * `viewpoints` are already reconciled (see reconcileViewpoints): notes that are gone are out.
 */
export function completeDeck(viewpoints, layout) {
  const notes = layoutNotes(layout)
  const all = [...notes.keys()]
  if (!viewpoints?.length || !all.length) return viewpoints || []
  const shown = deckNotes({ viewpoints })
  const fresh = all.filter((id) => !shown.has(id))
  if (!fresh.length) return viewpoints
  // An overview shows every note the deck shows.
  const everything = new Set(viewpoints.flatMap((viewpoint) => viewpoint.nodeIds.map(String)))
  const isOverview = (viewpoint) => everything.size > 1 && viewpoint.nodeIds.length === everything.size
  const opened = viewpoints.map((viewpoint) => (isOverview(viewpoint) ? { ...viewpoint, nodeIds: all } : viewpoint))
  const only = new Set(fresh)
  const graph = noteGraph(layout, (id) => only.has(id))
  const added = capGroups(groupNotes(layout, { only }), Math.max(1, MAX_PLAN_SEGMENTS - viewpoints.length)).map((group) => ({
    nodeIds: group, narrative: groupNarrative(group, graph), duration: segmentDuration(group.length),
  }))
  const closes = isOverview(viewpoints.at(-1)) && viewpoints.length > 1
  return closes ? [...opened.slice(0, -1), ...added, opened.at(-1)] : [...opened, ...added]
}

/** Why Slatebox could not plan, in words for the presenter. */
export function planFailureReason(failure) {
  const message = String(failure?.reason || failure?.abortMessage || failure?.message || '').trim()
  if (!message) return 'Slatebox did not answer.'
  if (/is not configured/i.test(message)) return 'Slatebox\'s planner is not set up on this server.'
  if (/returned no (viewpoints|presentation)/i.test(message)) return 'Slatebox returned no plan.'
  return message.replace(/^Sorry, I ran into a problem\.\s*/i, '') || 'Slatebox did not answer.'
}
