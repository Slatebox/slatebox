// The library as the chat and the panel use it (library final.md §2.2–2.6): a catalogue turn for
// "what can I add?" (answered here, with no AI call), the samples the listing gate runs on, and the
// phrases a board offers ("Say it like this", chips, "What can this do?"), each filled from the live
// board and checked against the parser before it is offered. Loaded on demand in the browser (the
// library chunk); the server imports it to read an add request.
import { catalog, catalogAddRequest, catalogEntry, catalogGroups, catalogMatch, catalogPreset } from 'slateboxjs/catalog'
import { businessKind, validateWorkshop, workshopBoardKind, workshopCandidate, workshopRules, workshopRulesLoaded } from 'slateboxjs/workshops/model'
import { proposeLaneReply } from './lane-conversation.mjs'
import './board-chat.mjs'
import { proposeDirectMapEdit } from './map-direct-edits.mjs'
import { useLibrary } from './native-canvas-conversation.mjs'

// A catalogue add is read locally wherever this module has loaded.
useLibrary({ catalogAddRequest, catalogPreset })

/**
 * The entries the library lists: every catalogue entry (each passes the listing gate, scripts/library-rulebook.test.mjs),
 * then the published community components (approved through the review queue, whose approve runs the same gate),
 * after the built-ins. The person's own items are listed apart, under "Yours" (ownEntries).
 */
export function listedEntries() {
  return [...catalog, ...libraryItems.community]
}

// The shared library's items, as the browser last read them (library.list and library.mine, once a session):
// published community components, and the person's own (drafts and items waiting included).
const libraryItems = { community: [], own: [] }

/**
 * A library item as an entry of the panel (library spec §4.5): its name and line, its category as its group, its
 * search words, and the plain words that add it ("Add <title>"). An item entry has no looping picture and no
 * catalogue phrases: it is added through library.fork (preview, then Keep), never by a chat message.
 */
export function entryOfItem(item, { own = false } = {}) {
  const name = String(item?.title ?? '').trim() || 'Untitled'
  return {
    id: 'item:' + item.id, itemId: item.id, slug: item.slug, item: true, own,
    name, line: String(item.summary ?? ''), group: item.category ?? null, synonyms: Array.isArray(item.synonyms) ? item.synonyms : [],
    addSay: ['Add ' + name], authorName: item.authorName ?? '', status: item.reviewStatus || item.status || 'published',
    preview: item.preview ?? null, branchedFrom: item.provenance?.branchedFrom?.title ?? null,
    build: item.preview?.boardKind ? { kind: item.preview.boardKind } : undefined,
  }
}

/** Keep the items the browser read: community components (published, by others) and the person's own. */
export function setLibraryItems({ community = [], own = [] } = {}) {
  const ownIds = new Set(own.map(item => item.id))
  libraryItems.own = own.filter(item => item.kind === 'component').map(item => entryOfItem(item, { own: true }))
  libraryItems.community = community.filter(item => item.kind === 'component' && item.origin !== 'builtin' && !ownIds.has(item.id)).map(item => entryOfItem(item))
}

/** The person's own components ("Yours"): drafts first saved a moment ago included, newest first. */
export function ownEntries(group = 'all') {
  return libraryItems.own.filter(entry => inGroup(entry, group))
}

// Words people search with for a kind of board that are no entry's own name or synonym: a map is
// a route or a flow, a nest is a tree, a launch plan is a timeline. Whole words only.
const KIND_WORDS = {
  map: ['map', 'maps', 'route', 'flow', 'flowchart', 'flow chart', 'path', 'journey', 'steps', 'process'],
  nest: ['tree', 'outline', 'hierarchy'],
  lanes: ['board', 'lanes', 'columns', 'cards', 'kanban'],
  'launch-plan': ['plan', 'timeline', 'schedule', 'roadmap', 'dates', 'gantt'],
  'hiring-plan': ['plan', 'timeline', 'headcount'],
  pipeline: ['board', 'stages', 'funnel'],
  budget: ['plan', 'money', 'split'],
}
// And for one entry: a tree that maps a problem or a choice is found as a map (and is under the
// Map chip, so the chip and a "map" search agree), and the everyday words for a to-do board, a
// brainstorm or a risk.
const ENTRY_WORDS = {
  'discovery-tree': ['map', 'mind map', 'brainstorm', 'ideas'],
  'break-down-problem': ['map', 'mind map', 'brainstorm'],
  'reorg-sandbox': ['org tree', 'org diagram'],
  'team-board': ['todo', 'to do', 'to do list', 'tasks', 'standup', 'stand up', 'sprint board'],
  triage: ['tasks'],
  'pros-cons': ['risk', 'swot', 'compare'],
  'impact-effort': ['risk'],
}
const GROUP_LABELS = Object.fromEntries(catalogGroups.map(group => [group.id, group.label.toLowerCase()]))
const plainWords = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}×&]+/gu, ' ').trim()
// A word's singular, for matching on both sides: "meetings" finds the Meetings group from "meeting"
// as well as the other way round ("process", "pros" and short words are left alone).
const singular = word => (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)
const singularWords = text => plainWords(text).split(' ').map(singular).join(' ')
const hasWord = (text, word) => ` ${plainWords(text)} `.includes(` ${word} `) || ` ${singularWords(text)} `.includes(` ${singular(word)} `)
const startsWord = (text, word) => ` ${plainWords(text)}`.includes(` ${word}`)
const isMap = entry => entry.build?.kind === 'map' || (ENTRY_WORDS[entry.id] ?? []).some(term => hasWord(term, 'map'))

/** Whether an entry belongs under a group chip. The Map chip holds the boards that are maps, and the trees that map a problem. */
export function inGroup(entry, group) {
  return group === 'all' || entry.group === group || (group === 'map' && isMap(entry))
}

// How well one searched word fits an entry: its name, then its group, then its synonyms and the words
// for its kind, then its line, then any part of a word. 0 when it does not fit at all.
function wordScore(entry, word) {
  const groups = [GROUP_LABELS[entry.group], ...(entry.build?.kind === 'map' ? ['map'] : [])]
  if (startsWord(entry.name, word)) return 8
  if (groups.some(label => hasWord(label, word))) return 6
  if (entry.synonyms.some(syn => hasWord(syn, word))) return 5
  if ([...(KIND_WORDS[entry.build?.kind] ?? []), ...(ENTRY_WORDS[entry.id] ?? [])].some(term => hasWord(term, word))) return 4
  if (hasWord(entry.line, word)) return 3
  return [entry.name, entry.line, ...entry.synonyms].some(text => plainWords(text).includes(word)) ? 1 : 0
}

/**
 * The library's search: every word must fit (a plural finds its singular: "maps", "plans"), and
 * entries are ranked by how they fit, a name above a group above a synonym, then in catalogue order.
 * No words lists the group as the catalogue orders it.
 */
export function searchEntries(query, group = 'all') {
  const words = plainWords(query).split(' ').filter(Boolean)
  const listed = listedEntries().filter(entry => inGroup(entry, group))
  if (!words.length) return listed
  return listed.map((entry, order) => {
    const scores = words.map(word => {
      const forms = [word, ...(word.length > 3 && word.endsWith('s') ? [word.slice(0, -1)] : [])]
      return Math.max(...forms.map(form => wordScore(entry, form)))
    })
    return scores.every(Boolean) ? { entry, total: scores.reduce((sum, score) => sum + score, 0), order } : null
  }).filter(Boolean).sort((a, b) => b.total - a.total || a.order - b.order).map(item => item.entry)
}

/** A question about what can be added: a catalogue turn `{ kind: 'catalog', all, entries }`, or null. */
export function libraryTurn(message) {
  const found = catalogMatch(String(message ?? ''))
  return found ? { kind: 'catalog', all: found.all, entries: found.entries } : null
}

// Example cards for the lane presets, so the listing gate and the loops have cards to move.
const exampleCards = {
  'now-next-later': ['Ship the pricing page', 'Interview three customers', 'Plan the offsite'],
  'pros-cons': ['Faster to launch', 'Costs more', 'Who owns support?'],
  'must-should-could': ['Sign-in', 'Exports', 'Dark mode'],
  retro: ['Shipped on time', 'Too many meetings', 'Pair on reviews'],
  triage: ['Login bug', 'Invoice question', 'Slow search'],
  'team-board': ['Billing', 'Search', 'Export', 'Auth'],
}

/** The board an entry's phrases are checked on: its preset, with example cards in the first lanes. */
export function catalogSample(id, samples = {}) {
  const preset = catalogPreset(id, undefined, samples)
  const labels = exampleCards[id]
  if (!labels) return validateWorkshop(preset)
  const cards = labels.map((label, index) => ({ id: 'example-' + (index + 1), label, laneId: preset.lanes[Math.min(index < 2 ? 0 : 1, preset.lanes.length - 1)].id }))
  return validateWorkshop({ ...preset, cards })
}

/** Whether a board drags differently from another: some card (or a new card, as a dropped note would be) may go somewhere it couldn't, or not. */
export function dragsDiffer(before, after) {
  // A plan drags along its rows: it drags differently when some task's legal starts or lengths differ.
  const kind = businessKind(before)
  const drags = kind && workshopRulesLoaded(kind) ? workshopRules(kind).drags : null
  if (drags) return drags(before) !== drags(after)
  const fresh = board => {
    const open = board.lanes.find(lane => !lane.role) ?? board.lanes[0]
    return { ...board, cards: [...board.cards, { id: 'fresh-card', label: 'New card', laneId: open.id }] }
  }
  const verdicts = board => [board, fresh(board)].flatMap(item => item.cards.flatMap(card => item.lanes.map(lane => {
    try { return workshopCandidate(item, card.id, lane.id) !== null } catch { return null }
  })))
  return JSON.stringify(verdicts(before)) !== JSON.stringify(verdicts(after))
}

const tryPhrase = (board, text, selection, actor) => board.lanes[0]?.station
  ? proposeDirectMapEdit(board, text, selection ?? undefined)
  : proposeLaneReply(board, text, selection, actor)

/**
 * A slate holds up to 8 boards side by side (boards S4a). An entry added on a slate that holds that
 * many opens on a new slate: the conversation asks first, with a button that opens it, instead of
 * leaving the slate on one tap.
 */
export function newSlateTurn(entry) {
  return { role: 'assistant', content: 'This slate holds 8 boards, the most for now. Add ' + articled(entry.name) + ' on a new slate?', opens: entry.addSay[0] }
}

// "a retro", "an impact × effort", "pros and cons": an entry's name in a sentence.
function articled(entryName) {
  const name = /^[A-Z][a-z]/.test(entryName) && !/ \/ /.test(entryName) ? entryName.toLowerCase() : entryName
  const article = /^pros/i.test(name) ? '' : /^[aeiou]/i.test(name) ? 'an ' : 'a '
  return article + name
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The ways to fill a phrase's slots on this board, the selection first. */
function fillings(say, board, selection) {
  const pick = (items, id) => id ? [...items.filter(item => item.id === id), ...items.filter(item => item.id !== id)] : items
  const cards = pick(board.cards, selection?.kind === 'card' ? selection.id : null)
  const lanes = pick(board.lanes, selection?.kind === 'lane' ? selection.id : null)
  const busy = lanes.filter(lane => board.cards.some(card => card.laneId === lane.id))
  const ruled = lanes.filter(lane => (board.behaviour?.rules ?? []).some(rule => rule.kind === 'capacity' && rule.where === lane.id))
  const out = []
  const slots = [...say.matchAll(/\{(card|other card|lane|other|busy|ruled|dates|later|month|band|pile|other pile|item|parent|opportunity|scored|waiting|person|manager|other manager|open|kr|owner)\}/g)].map(match => match[1])
  // A plan's dates, in words its chat reads back: a few days inside it, a day after its line, months ahead.
  const plan = businessKind(board) && workshopRulesLoaded(board.kind) ? workshopRules(board.kind).words : null
  const short = day => { const iso = plan.iso(board, day); return months[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8)) }
  const dated = Boolean(plan && board.clock)
  const values = {
    dates: dated ? [3, 8, 14].map(day => ({ label: short(day) + ' to ' + short(day + 1) })) : [],
    later: board.launch ? [{ label: dated ? plan.name(board, board.launch.day + 7) : 'day ' + Math.min(120, board.launch.day + 7) }] : [],
    month: dated ? [150, 120, 200].map(day => ({ label: months[Number(plan.iso(board, day).slice(5, 7)) - 1] })) : [],
    band: (board.hiring?.bands ?? []).map(band => ({ label: band.label })),
    // A nested board: the cards at the top of its first area, the cards with nothing under them, the cards with some, its opportunities.
    ...(board.kind === 'nest' && (() => {
      const placed = pick(board.cards.filter(card => card.laneId === board.lanes[0].id), selection?.kind === 'card' ? selection.id : null)
      const parents = new Set(board.cards.flatMap(card => card.parentId ? [card.parentId] : []))
      return { pile: placed.filter(card => !card.parentId), item: placed.filter(card => card.parentId && !parents.has(card.id)),
        parent: placed.filter(card => parents.has(card.id)), opportunity: placed.filter(card => card.role === 'opportunity'),
        // A 2 by 2: the cards on the square, the cards waiting to be scored. An org chart: people, managers, open roles. Goals: key results.
        scored: board.nest?.layout === 'matrix' ? placed : [], waiting: board.cards.filter(card => card.laneId === board.lanes[1].id),
        person: placed.filter(card => card.role && !['manager', 'open role'].includes(card.role) && !parents.has(card.id)), manager: placed.filter(card => card.role === 'manager' && card.parentId),
        open: board.cards.filter(card => card.role === 'open role'), kr: placed.filter(card => card.role === 'key result') }
    })()),
  }
  const each = (text, index, used) => {
    if (out.length >= 24) return
    if (index === slots.length) { out.push(text); return }
    const slot = slots[index]
    const card = used.card
    const options = slot === 'parent' ? values.parent.filter(item => ![used.item?.parentId, used.kr?.parentId, used.kr?.id].includes(item.id))
      : slot === 'owner' ? (board.nest?.owners ?? []).filter(owner => owner.id !== used.kr?.owner)
      : slot === 'other manager' ? values.manager.filter(item => item !== used.manager && item.id !== used.manager?.parentId)
      : values[slot] ?? (slot === 'other pile' ? values.pile.filter(item => item !== used.pile) : slot === 'card' ? cards : slot === 'other card' ? cards.filter(item => item !== card)
      : slot === 'busy' ? busy : slot === 'ruled' ? ruled
      : slot === 'other' ? lanes.filter(item => item.id !== (card?.laneId ?? used.lane?.id)) : lanes)
    for (const item of options.slice(0, 5)) each(text.replace('{' + slot + '}', item.label), index + 1, { ...used, [slot === 'card' ? 'card' : slot === 'other card' ? 'other' : values[slot] ? slot : 'lane']: item })
  }
  each(say, 0, {})
  return out
}

/** The catalogue entry a board on the canvas is (its kind, or for lanes the preset whose lanes it has). */
export function entryOfBoard(board) {
  const kind = workshopBoardKind(board)
  if (kind === 'map') return catalogEntry('decision-path')
  if (kind === 'pipeline') return catalogEntry('sales-pipeline')
  if (kind === 'launch-plan' && board.launch?.name === 'go-live') return catalogEntry('customer-go-live')
  // A nested board: piles sort evidence; a tree with opportunities is a discovery tree; any other tree breaks a problem down.
  if (kind === 'nest' && board.nest?.layout === 'matrix') return catalogEntry('impact-effort')
  if (kind === 'nest' && board.nest?.owners?.length) return catalogEntry('goals-owners')
  if (kind === 'nest' && board.nest?.layout === 'tree' && board.cards.some(card => card.role === 'manager' || card.role === 'open role')) return catalogEntry('reorg-sandbox')
  if (kind === 'nest') return catalogEntry(board.nest?.layout === 'clusters' ? 'sort-evidence' : board.cards.some(card => card.role === 'opportunity' || card.role === 'outcome')
    ? 'discovery-tree' : /incident|outage/i.test(board.title) ? 'incident-review' : 'break-down-problem')
  if (kind !== 'lanes') return catalog.find(entry => entry.build.kind === kind) ?? null
  const labels = board.lanes.map(lane => lane.label.toLowerCase()).join('|')
  return catalog.find(entry => entry.build.kind === 'lanes' && catalogPreset(entry.id).lanes.map(lane => lane.label.toLowerCase()).join('|') === labels)
    ?? catalogEntry('team-board')
}

/**
 * The phrases an entry offers on a live board, filled from it and checked: each `{ text, words, edit, rule? }`
 * parses as it stands. Three at most unless `all`; a rule phrase carries `changes(before, after)`, true
 * when it changes the next drag (the listing gate's second test).
 */
export function startersFor(entry, board, selection = null, { all = false, chain = all, actor = null } = {}) {
  const offered = []
  // With `all`, a phrase that needs a rule (warn, remove) is said on the board after the limit phrase made one,
  // as a person would say them in turn; `on` is the board it was checked on.
  let current = board
  for (const item of entry.moves) {
    for (const text of fillings(item.say, current, selection)) {
      let proposal
      try { proposal = tryPhrase(current, text, selection, actor) } catch { continue }
      if (item.rule && proposal.workshop && !dragsDiffer(current, proposal.workshop)) continue
      offered.push({ text, words: item.words, edit: item.edit, ...(current !== board && { on: current }), ...(item.rule && { rule: item.rule, changes: dragsDiffer }) })
      if (chain && item.rule === 'capacity' && proposal.workshop) current = proposal.workshop
      break
    }
    if (!all && offered.length >= 3) break
  }
  return offered
}

/** "What can this do?" for a board on the canvas: what it does, each with the phrase that does it, and its rules. */
export function boardMoves(board, actor = null) {
  const entry = entryOfBoard(board)
  if (!entry) return []
  return startersFor(entry, board, null, { all: true, chain: false, actor }).map(({ words, text }) => ({ words, text }))
}

/**
 * exec's workshop.can (slates.get): what this board takes, in plain words, each with a phrase the chat
 * reads on it as it stands (the gear's "What else can this board do?" answer).
 */
export function boardCan(board) {
  return boardMoves(board).map(({ words, text }) => ({ words, say: text }))
}

// The words of a request, each as people write it and without a plural s.
const stems = text => String(text ?? '').toLowerCase().match(/[a-z0-9-]+/g)?.map(word => word.length > 3 ? word.replace(/(?:ies)$/, 'y').replace(/s$/, '') : word) ?? []

// A question, or a request to read the board back ("why is Doing so full?", "explain the flow",
// "list the costs"): it is about this board, and goes to the AI turn, never to a recommendation.
const QUESTION = /\?\s*$|^(?:(?:so|and|but|ok(?:ay)?|hey|please)[\s,]+)*(?:who|whom|whose|what|what's|whats|why|how|when|where|which|is|are|am|was|were|do|does|did|can|could|should|shall|would|will|may|might|must|has|have|had|isn't|aren't|don't|doesn't|explain|summari[sz]e|sum up|list|show|tell|describe|count|compare|review|analy[sz]e|find|give me|help me understand|walk me through)\b/i

/**
 * A request the board in focus can't do, that another catalogue entry does (Boards S2a, the request
 * ladder's second step): the entry whose names and synonyms the request uses most, never the board's
 * own kind, and none when the board's own entry is named as much. Only catalogue entries come back.
 * Only a request to do something (the board's grammar has refused it already) is matched: a question
 * or a request to read the board back is about this board, and is the AI turn's.
 */
export function catalogSuggest(message, board) {
  if (QUESTION.test(String(message ?? '').trim())) return null
  const words = new Set(stems(message))
  if (!words.size) return null
  const own = board ? entryOfBoard(board) : null
  const score = entry => [entry.name, ...entry.synonyms].filter(phrase => {
    const parts = stems(phrase)
    return parts.length && parts.every(part => words.has(part))
  }).length
  const ranked = catalog.filter(entry => entry !== own && entry.build.kind !== own?.build.kind).map(entry => [score(entry), entry]).filter(([n]) => n > 0)
    .sort(([a], [b]) => b - a)
  if (!ranked.length || (own && score(own) >= ranked[0][0])) return null
  return ranked[0][1]
}

/** The recommendation as a turn of the chat: "Retro can't do that. A Sales pipeline does: …" with its card and the way to add it beside the board. */
export function recommendTurn(board, entry) {
  const { name } = entry
  const article = /^pros/i.test(name) ? '' : /^[aeiou]/i.test(name) ? 'An ' : 'A '
  const line = entry.line.charAt(0).toLowerCase() + entry.line.slice(1)
  return { role: 'assistant', content: '“' + board.title + '” can’t do that. ' + article + name + ' does: ' + line + '. Add it beside this board?', catalog: [entry.id], adds: entry.addSay[0] }
}

export { catalog, catalogAddRequest, catalogEntry, catalogPreset }
