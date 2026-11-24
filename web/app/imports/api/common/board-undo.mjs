// One person's undo and redo of a change they made to a board (a card moved, a lane renamed, a rule
// overridden, a Keep from the board's chat), on the board as it stands now.
//
// A board lives on the server and other people change it too. Going back to the whole board as it was
// before the change would take their later changes away with it. The step is therefore rebased: what
// the person's change did (from `from` to `to`, reversed for an undo) is made again on the board as it
// is now (`current`), part by part: each card, lane, line and setting by itself. A part someone else
// has changed since is left as they left it, and the person is told.

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const keyed = (list) => Array.isArray(list) && list.length > 0 && list.every((item) => isObject(item) && typeof item.id === 'string')
const ABSENT = undefined

/**
 * The board after the person's step is made again on `current`: `from` is the board as the step found
 * it, `to` the board it left (for an undo: `from` is the board after the change, `to` the board before).
 * Returns { board, changed, conflicts }: `board` is the rebased board, `changed` whether it differs from
 * `current`, and `conflicts` how many parts someone else had changed since (left as they are).
 */
export function rebaseBoardStep({ from, to, current }) {
  const conflicts = { count: 0 }
  const board = merge(from, to, current, conflicts)
  return { board, changed: !same(board, current), conflicts: conflicts.count }
}

function merge(base, target, current, conflicts) {
  // The step left this part as it found it: it is as it is now.
  if (same(base, target)) return current
  // Nobody changed it since: the step is made on it.
  if (same(current, base)) return target
  // Someone changed it to what the step would make it: nothing to do.
  if (same(current, target)) return current
  // Changed by the step and by someone else: look inside it, part by part.
  if ((keyed(base) || keyed(target) || keyed(current)) && [base, target, current].every((v) => v === ABSENT || Array.isArray(v)))
    return mergeKeyed(base ?? [], target ?? [], current ?? [], conflicts)
  if (isObject(base) && isObject(target) && isObject(current)) {
    const out = {}
    for (const key of new Set([...Object.keys(current), ...Object.keys(base), ...Object.keys(target)])) {
      const value = merge(base[key], target[key], current[key], conflicts)
      if (value !== ABSENT) out[key] = value
    }
    return out
  }
  // Someone else's change wins: the person's step leaves it alone.
  conflicts.count += 1
  return current
}

function mergeKeyed(base, target, current, conflicts) {
  const byId = (list) => new Map(list.filter(isObject).map((item) => [item.id, item]))
  const b = byId(base), t = byId(target), c = byId(current)
  const ids = new Set([...c.keys(), ...t.keys(), ...b.keys()])
  const merged = new Map()
  for (const id of ids) {
    const value = merge(b.get(id), t.get(id), c.get(id), conflicts)
    if (value !== ABSENT) merged.set(id, value)
  }
  const order = (list) => list.filter(isObject).map((item) => item.id)
  let sequence
  // Nobody reordered since when what the step found and what is there now are in the same order
  // (cards others added or took away since do not count as a reorder).
  const unmoved = same(order(current).filter((id) => b.has(id)), order(base).filter((id) => c.has(id)))
  if (unmoved) {
    // Nobody reordered since: the step's order, with anything others added kept where it was.
    sequence = order(target).filter((id) => merged.has(id))
    for (const [at, id] of order(current).entries()) {
      if (!sequence.includes(id) && merged.has(id)) sequence.splice(Math.min(at, sequence.length), 0, id)
    }
  } else {
    // Someone reordered since: their order, with what the step brings back where the step had it.
    sequence = order(current).filter((id) => merged.has(id))
    for (const [at, id] of order(target).entries()) {
      if (!sequence.includes(id) && merged.has(id)) sequence.splice(Math.min(at, sequence.length), 0, id)
    }
  }
  for (const id of merged.keys()) if (!sequence.includes(id)) sequence.push(id)
  return sequence.map((id) => merged.get(id))
}

/**
 * One side of a step (`to`, reached from `from`) as the server stored it (`saved`), after the page sent `sent`
 * (the board an undo or redo saved). The server stamps some of what a step makes itself (who moved a card anyway,
 * and when), so the next undo or redo of the step starts from what is stored, not from what the page sent. Only a
 * part the page sent as the step has it takes the server's form: a part left as someone else had it (a conflict)
 * keeps the step's own value, so the next redo or undo still finds it changed by someone else and leaves it. A
 * part the step takes away stays away. `sent` left out: the page sent the step's side itself.
 */
export function settleBoardSide({ from, to, saved, sent = to }) {
  return settle(from, to, saved, sent)
}

function settle(base, target, saved, sent) {
  if (same(base, target) || target === ABSENT || saved === ABSENT) return target
  if (keyed(target) && Array.isArray(saved)) {
    const byId = (list) => new Map((Array.isArray(list) ? list : []).filter(isObject).map((item) => [item.id, item]))
    const b = byId(base), s = byId(saved), p = byId(sent)
    return target.map((item) => settle(b.get(item.id), item, s.get(item.id), p.get(item.id)))
  }
  if (isObject(target) && isObject(saved)) {
    const from = isObject(base) ? base : {}
    const given = isObject(sent) ? sent : {}
    const out = {}
    for (const key of new Set([...Object.keys(target), ...Object.keys(saved)])) {
      if (!(key in target)) {
        // Taken away by the step: it stays away. Never in the step nor in what the page sent: what the
        // server added (a stamp).
        if (!(key in from) && !(key in given)) out[key] = saved[key]
        continue
      }
      const value = settle(from[key], target[key], saved[key], given[key])
      if (value !== ABSENT) out[key] = value
    }
    return out
  }
  // A value the page sent as someone else left it is not the step's: the step keeps its own.
  return same(sent, target) ? saved : target
}

/** What the person is told when their board step could not be undone or redone, or only in part. */
export const BOARD_STEP_SAID = Object.freeze({
  overwritten: 'Someone else changed that on the board since, so there was nothing of yours to take back there.',
  partly: 'Someone else changed part of that on the board since; the rest of your change was taken back.',
  gone: 'That board is no longer on this slate.',
})

// The edits a rule control on the board makes (server/methods/workshop-play.mjs CANVAS_RULE_EDITS).
const RULE_CONTROL_KINDS = ['add_rule', 'set_rule', 'remove_rule', 'set_lane_capacity', 'add_lane']

/** A short name for a board change, for the Undo and Redo controls' tooltips. */
export function boardStepLabel(changes, workshop) {
  const list = Array.isArray(changes) ? changes : []
  const card = (id) => workshop?.cards?.find((item) => item.id === id)?.label
  const lane = (id) => workshop?.lanes?.find((item) => item.id === id)?.label
  if (list.length === 1) {
    const change = list[0] || {}
    if (change.rename?.laneId) return `Rename ${lane(change.rename.laneId) ?? 'a lane'}`
    if (change.rename?.title !== undefined) return 'Rename the board'
    // `to`: where a move made anyway took the card in the words it was asked in ("to start day 21"), else the lane.
    if (change.cardId && (change.laneId || change.to)) {
      const where = typeof change.to === 'string' && change.to ? ' ' + change.to : lane(change.laneId) ? ' to ' + lane(change.laneId) : ''
      return `Move ${card(change.cardId) ?? 'a card'}${where}${change.override ? ' anyway' : ''}`
    }
    // A rule control's change (library spec §4.3): its rule edits alone.
    if (Array.isArray(change.edits) && change.edits.length && change.edits.every((edit) => RULE_CONTROL_KINDS.includes(edit?.kind))) return 'Change the rules'
  }
  return 'Board change'
}

/**
 * Whether a board change is put back by the drawing's own undo history instead (the engine records it
 * with the drawing: a note and a card trading places, a card's line, a card's rename), or is itself an
 * undo the engine made.
 */
export function drawingOwnsBoardChange(change) {
  return Boolean(change && (change.noteToCard || change.cardToNote || change.line || change.rename?.cardId || change.via === 'undo'))
}
