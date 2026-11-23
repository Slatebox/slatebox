// A board in focus (Boards S2a, plan 2026-11-22): the gear's "Change this board" puts one board in
// focus for the chat. What the chat then shows and sends: the "Editing:" chip, the context ("this"
// is the board, or a lane or card selected on it), the board's own suggestions and the placeholder,
// each checked against the grammar the chat already reads. No catalogue or library code here: the
// gear, the bar and the chat's first paint never load the library chunk.
import { proposeLaneReply } from './lane-conversation.mjs'
import { proposeDirectMapEdit } from './map-direct-edits.mjs'

/** The board a slate keeps today (creative + options.workshopOrigin): one per slate until many boards ship. */
export const MAIN_BOARD = 'main'

const starter = (text, part) => {
  const from = part ? text.lastIndexOf(part) : -1
  return from < 0 ? { text } : { text, select: [from, from + part.length] }
}
const map = model => Boolean(model.lanes[0]?.station)
const parses = (model, text, actor) => {
  try {
    if (map(model)) proposeDirectMapEdit(model, text)
    else proposeLaneReply(model, text, { kind: 'board', id: MAIN_BOARD }, actor)
    return true
  } catch { return false }
}

/** "Editing: Retro", or with a lane or card of it selected "Editing: Retro › Went well". */
export function editingLabel(model, selection = null) {
  const picked = selection && (selection.kind === 'lane' ? model.lanes : selection.kind === 'card' ? model.cards : []).find(item => item.id === selection.id)
  return 'Editing: ' + model.title + (picked ? ' › ' + picked.label : '')
}

/** What "this" means to the chat: the lane or card selected on the focused board, else the board itself; null with no focus. */
export function focusContext(model, focus, selection) {
  if (!focus) return null
  const picked = selection && (selection.kind === 'lane' ? model.lanes : selection.kind === 'card' ? model.cards : []).find(item => item.id === selection.id)
  return picked ? { kind: selection.kind, id: picked.id } : { kind: 'board', id: focus }
}

/** "What else can this board do?" and the ways people ask it. */
export const asksWhatElse = message => /^what\s+(?:else\s+)?can\s+(?:this|it|the)(?:\s+board)?\s+do\??$/i.test(String(message ?? '').trim())

// The capacity a lane has, as a lane field or a rule of the board.
const limited = (model, lane) => lane.capacity !== undefined ||
  (model.behaviour?.rules ?? []).some(rule => rule.kind === 'capacity' && rule.where === lane.id)

/**
 * Up to four things to say to the board in focus, each checked against the grammar on the board as it
 * stands: a column it hasn't got (below five), a limit on its busiest lane without one, a new name, and
 * "What else can this board do?" (answered from the library, in plain words).
 */
export function boardSuggestions(model, actor = null) {
  const offered = []
  if (!map(model)) {
    const fresh = ['Blocked', 'Review', 'Later', 'Parked', 'Next'].find(name => !model.lanes.some(lane => lane.label.toLowerCase() === name.toLowerCase()))
    const column = fresh && starter('Add a column called ' + fresh, fresh)
    if (column && model.lanes.length < 5 && parses(model, column.text, actor)) offered.push(column)
    const held = lane => model.cards.filter(card => card.laneId === lane.id).length
    const busiest = model.lanes.filter(lane => !lane.role && !limited(model, lane) && held(lane) > 0).sort((a, b) => held(b) - held(a))[0]
    const limit = busiest && starter('Limit ' + busiest.label + ' to 3 cards')
    if (limit && parses(model, limit.text, actor)) offered.push(limit)
    // A dated plan in focus: its span in words (boards S2b), a week longer than it runs now.
    if ((model.kind === 'launch-plan' || model.kind === 'hiring-plan') && model.clock) {
      const weeks = model.kind === 'hiring-plan' ? model.hiring.weeks + 4 : Math.floor(model.launch.day / 7) + 2
      const span = starter('Make this a ' + weeks + '-week plan', String(weeks))
      if (parses(model, span.text, actor)) offered.push(span)
    }
    const rename = starter('Rename this board to ' + model.title.slice(0, 100) + ' 2', model.title.slice(0, 100) + ' 2')
    if (parses(model, rename.text, actor)) offered.push(rename)
  }
  else {
    // A map in focus: its paths are changed on purpose (boards S2b). Connect two steps that aren't joined, take
    // away a step's one path, and add a step after the last one.
    const joined = (a, b) => a.station.next.includes(b.id) || b.station.next.includes(a.id)
    const pair = model.lanes.flatMap(a => model.lanes.filter(b => b !== a && !joined(a, b)).map(b => [a, b]))
      .sort(([a, b], [c, d]) => (b.station.next.length - d.station.next.length) || 0)[0]
    const connect = pair && starter('Connect ' + pair[0].label + ' to ' + pair[1].label)
    if (connect && parses(model, connect.text, actor)) offered.push(connect)
    const single = model.lanes.find(lane => lane.station.next.length === 1)
    const remove = single && starter('Remove the path from ' + single.label)
    if (remove && parses(model, remove.text, actor)) offered.push(remove)
    const last = model.lanes.find(lane => !lane.station.next.length) ?? model.lanes.at(-1)
    const step = model.lanes.length < 5 && starter('Add Follow-up after ' + last.label, 'Follow-up')
    if (step && parses(model, step.text, actor)) offered.push(step)
  }
  offered.push({ text: 'What else can this board do?' })
  return offered.slice(0, 4)
}

/** The message box's example with the board in focus: something concrete it takes. */
export function focusPlaceholder(model, actor = null) {
  return boardSuggestions(model, actor).find(item => !asksWhatElse(item.text))?.text ?? 'What else can this board do?'
}
