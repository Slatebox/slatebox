import { applyWorkshopEdits, businessKind, checkWorkshopReplacement, rulebook, validateWorkshop } from 'slateboxjs/workshops/model'
// A launch plan's, pipeline's or budget's rules, and a rulebook's whole-save helpers (a rule change
// said as its rule edits, an earlier board put back); the edits between two business boards.
import { behaviourEditsBetween, restoreWorkshop } from 'slateboxjs/workshops/rules'
import { kitFor, workshopEditsBetween } from 'slateboxjs/boards'
// The nested boards' kit is its own chunk: loading it gives kitFor('nest') its kit.
import 'slateboxjs/boards/nest'

// The edits between two boards of a business kind, said by its kit (a nested board's say nest_card,
// merge_cards, set_field…; the others the shared ones).
const editsBetween = (before, after) => kitFor(before.kind).editsBetween?.(before, after) ?? workshopEditsBetween(before, after)

// A whole workshop sent to replace the saved one (creativeSlates.save: a kept proposal, a card the
// author removes, an Undo). Every workshop keeps its kind and what its kind keeps
// (checkWorkshopReplacement). A launch plan, pipeline or budget has rules only its edits enforce (a
// deal moves one stage at a time, a won deal stays won, a new deal starts open), so a whole board
// for one is either the Undo the server recorded for this person's own last change, or it is made
// again here as the edits it amounts to, by the reducer every surface uses, on the board as saved.
//
// A board's rulebook (lane boards and pipelines) is written only here: a save that changes no rule
// keeps the rules as stored, audit lines included; a save that changes the rules changes nothing
// else, and its rule edits are made again by the reducer with the saver's own audit line.

export const notTheBoards = 'That change is not one the board makes. Make it on the board.'

/** JSON with every object's keys in order, so two equal boards read the same whatever their key order. */
function canonical(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
}
// A nested board's cards keep their places by keys made between their neighbours: two boards with the
// same cards in the same order are the same board whatever keys each made, so a card's key is read as its
// place among its siblings.
const places = cards => {
  const groups = new Map()
  for (const card of cards) if (card.order !== undefined) {
    const key = card.parentId ? 'u:' + card.parentId : 'l:' + card.laneId
    groups.set(key, [...(groups.get(key) ?? []), card])
  }
  const at = new Map()
  for (const group of groups.values()) {
    group.sort((x, y) => x.order < y.order ? -1 : x.order > y.order ? 1 : x.id < y.id ? -1 : 1).forEach((card, i) => at.set(card.id, i))
  }
  return cards.map(card => at.has(card.id) ? { ...card, order: at.get(card.id) } : card)
}
const sameBoard = (a, b) => canonical({ ...a, cards: places(a.cards).sort((x, y) => x.id < y.id ? -1 : 1) }) ===
  canonical({ ...b, cards: places(b.cards).sort((x, y) => x.id < y.id ? -1 : 1) })
// What the rules say, without who set them or the revision: what a page may propose.
const said = behaviour => canonical((behaviour?.rules ?? []).map(({ set: _set, ...rule }) => rule).sort((a, b) => a.id < b.id ? -1 : 1))
const withoutRules = board => { const { behaviour: _behaviour, ...rest } = board; return rest }

/** The stored rulebook once the lanes `next` removed have taken their rules with them. */
function rulesKept(stored, next) {
  let behaviour = stored.behaviour
  if (!behaviour) return undefined
  for (const lane of stored.lanes) if (!next.lanes.some(item => item.id === lane.id)) behaviour = rulebook().dropLane(behaviour, lane.id)
  return behaviour
}

/**
 * What a whole save of `next` over the saved workshop `stored` keeps: `{ workshop }` to store (with
 * `undone` when it is the recorded Undo), `{ stale: true }` when it was made on an older revision
 * than `current`, or `{ refused: { reason, laneId?, limits? } }`. `undo` is the slate's recorded Undo
 * ({ revision, by, workshop }) or null; `revision` is the revision the save is made on, `userId` who
 * makes it and `actor` ({ by }) the name a rule they change is stamped with.
 */
export function replaceWorkshop(stored, next, { undo = null, revision, current = revision, userId, actor = null } = {}) {
  if (revision !== current) return { stale: true }
  // The Undo of this person's last change, while nothing has changed since: the board as it was
  // (the one the server recorded, not the page's copy: the same kind, rules and audit lines), its
  // rules under a newer revision so a drop made under the undone rules is checked again.
  if (undo && undo.by === userId && undo.revision === revision && undo.workshop) {
    const recorded = validateWorkshop(undo.workshop)
    let sent = null
    try { sent = validateWorkshop(next) } catch { /* not the Undo */ }
    if (sent && sameBoard(withoutRules(recorded), withoutRules(sent)) && said(recorded.behaviour) === said(sent.behaviour)) {
      return { workshop: validateWorkshop(restoreWorkshop(stored, recorded)), undone: true }
    }
  }
  const saved = validateWorkshop(stored)
  let board
  try { board = validateWorkshop(next) } catch {
    const kept = checkWorkshopReplacement(stored, next)
    return { refused: { reason: kept ?? notTheBoards } }
  }
  const rules = rulesKept(saved, board)
  if (said(rules) !== said(board.behaviour)) return changeRules(saved, board, actor)
  // No rule changed: the rules are the stored ones (a lane removed takes its own).
  if (rules) board = { ...board, behaviour: rules }
  else delete board.behaviour
  return changeBoard(saved, board)
}

/** A save that changes no rule: held to what the kind keeps, and on a business board made again as its edits. */
function changeBoard(saved, board) {
  const kept = checkWorkshopReplacement(saved, board)
  if (kept) return { refused: { reason: kept } }
  if (!businessKind(saved)) return { workshop: board }
  const edits = editsBetween(saved, board)
  if (!edits.length) return sameBoard(saved, board) ? { workshop: board } : { refused: { reason: notTheBoards } }
  const made = applyWorkshopEdits(saved, edits)
  if ('refused' in made) {
    const { reason, laneId, cardId, limits } = made.refused
    return { refused: { reason, laneId: laneId ?? saved.cards.find(card => card.id === cardId)?.laneId ?? null, ...(limits && { limits }) } }
  }
  // A card the reducer added has an id of its own; it takes the one the page gave it.
  const added = board.cards.filter(card => !saved.cards.some(item => item.id === card.id)).map(card => card.id)
  const named = new Map(made.report.edits.filter(edit => edit.kind === 'add_card' && edit.cardId).map((edit, at) => [edit.cardId, added[at]]))
  const rename = id => named.get(id) ?? id
  const result = { ...made.workshop, cards: made.workshop.cards.map(card => ({ ...card, id: rename(card.id),
    ...(card.dependsOn && { dependsOn: card.dependsOn.map(rename) }) })) }
  // Only what the edits made is kept: anything else in the board sent (a stage's chance, a card's
  // look, a link to a card the same save adds) is not a change the board makes.
  return sameBoard(result, board) ? { workshop: board } : { refused: { reason: notTheBoards } }
}

/**
 * A save that changes the rules: it changes nothing else, and is made again as its rule edits, by
 * the reducer, with this person's audit line (whatever the page sent as `set`).
 */
function changeRules(saved, board, actor) {
  // A nested board's chat changes a rule and the cards in one sentence ("Group Pricing and Billing into Money"
  // raises the depth rule, then nests the piles): the rules are made first, then the cards, each by the
  // reducer, the cards held to the rules as they now stand.
  const reshapes = saved.kind === 'nest'
  if (!reshapes && !sameBoard(withoutRules(saved), withoutRules(board))) {
    const moved = saved.cards.length !== board.cards.length || board.cards.some(card => saved.cards.find(item => item.id === card.id)?.laneId !== card.laneId)
    return { refused: { reason: moved ? 'Change the rules on their own, then move cards.' : notTheBoards } }
  }
  const edits = behaviourEditsBetween(saved, board)
  if (!edits?.length) return { refused: { reason: notTheBoards } }
  const made = applyWorkshopEdits(saved, edits, { actor: { by: actor?.by || 'Someone', via: 'chat' } })
  if ('refused' in made) return { refused: { reason: made.refused.reason, laneId: made.refused.laneId ?? null } }
  if (said(made.workshop.behaviour) !== said(board.behaviour)) return { refused: { reason: notTheBoards } }
  if (sameBoard(withoutRules(saved), withoutRules(board))) return { workshop: made.workshop }
  return changeBoard(made.workshop, { ...board, behaviour: made.workshop.behaviour })
}

/**
 * The Undo a change records: the board it replaced, for the person who made it, at the revision it
 * saved. A launch plan, pipeline or budget (whose whole saves are held to its edits) and a board with
 * rules (a rule edit is one undo step) record one.
 */
export function recordedUndo(before, revision, userId) {
  return businessKind(before ?? {}) || before?.behaviour ? { revision, by: userId, workshop: before } : null
}
