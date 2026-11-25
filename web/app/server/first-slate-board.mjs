// The first run's board, built from its plan (imports/api/common/first-slate.mjs) with no agent call:
// a business brief read by the same readers as Ask Slatebox, a library preset or sample with its cards,
// lanes, or typed steps. Beside it, one real note, "How this board works". Server only: it brings the
// boards' rules. Pure apart from `today`, which dates a plan from the next Monday.
import 'slateboxjs/workshops/behaviour'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { catalogPreset } from 'slateboxjs/catalog'
import { isoAt, nextMonday, planSamples, presetRules, scheduleLaunch, weekendAt } from 'slateboxjs/workshops/rules'
import { catalogSamples } from 'slateboxjs/workshops/samples'
import { businessBoardFromBrief } from '../imports/api/common/business-board-brief.mjs'
import { workshopFromLaneBrief } from '../imports/api/common/native-lane-brief.mjs'
import { nativeSlateFromBrief } from '../imports/api/common/native-diagram-brief.mjs'
import { componentSet } from '../imports/api/common/component-add.mjs'
import { FIRST_SLATE_VERSION, launchNote } from '../imports/api/common/first-slate.mjs'

// The plan samples take the day they count from; the nested boards are not dated.
const dated = { 'launch-plan': true, 'go-live': true, 'hiring-plan': true }
const sampleOf = (name, today) => dated[name] ? clearOfHolidays(planSamples[name](today)) : catalogSamples[name]()

// A launch day on a weekend or between Dec 24 and Jan 1 is no launch day: it moves to the last workday
// before, while the work still fits by then, else to the first workday after.
const offDay = (origin, day) => { const md = isoAt(origin, day).slice(5); return md >= '12-24' || md <= '01-01' || weekendAt(origin, day) }
export function clearOfHolidays(board) {
  const origin = board?.clock?.origin, day = board?.launch?.day
  if (board?.kind !== 'launch-plan' || !origin || !Number.isFinite(day) || !offDay(origin, day)) return board
  const done = Math.max(0, ...[...scheduleLaunch(board).values()].map(task => task.to))
  const at = day => ({ ...board, launch: { ...board.launch, day } })
  for (let earlier = day - 1; earlier >= done; earlier--) if (!offDay(origin, earlier)) return at(earlier)
  for (let later = day + 1; later <= day + 21; later++) if (!offDay(origin, later)) return at(later)
  return board
}

const slug = (label, used) => {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'card'
  let id = /^[a-z0-9]/.test(base) ? base : 'c-' + base
  for (let n = 2; used.has(id); n++) id = base + '-' + n
  used.add(id)
  return id
}

/** A library preset with its lanes renamed or dropped, a lane's limit changed, and the plan's cards. */
function presetBoard({ preset, lanes, capacity = {}, cards = [] }) {
  const board = catalogPreset(preset)
  if (lanes) board.lanes = lanes.map(([id, label]) => ({ id, label }))
  const kept = new Set(board.lanes.map(lane => lane.id))
  board.behaviour.rules = board.behaviour.rules
    .filter(rule => (rule.where === undefined || kept.has(rule.where)) && (rule.lane === undefined || kept.has(rule.lane)))
    .map(rule => rule.kind === 'capacity' && capacity[rule.where] ? { ...rule, max: capacity[rule.where] } : rule)
  const used = new Set(board.lanes.map(lane => lane.id))
  board.cards = cards.map(({ lane, label }) => {
    if (!kept.has(lane)) throw new Error('No lane ' + lane + ' on ' + preset)
    return { id: slug(label, used), label, laneId: lane }
  })
  return board
}

/** A library sample with cards renamed, moved under another card, or taken away (with what sits under them), and its quotes' customers renamed. */
function sampleBoard({ sample, relabel = {}, reparent = {}, remove = [], sources = {} }, today) {
  const board = sampleOf(sample, today)
  const gone = new Set(remove)
  for (let grew = true; grew;) {
    grew = false
    for (const card of board.cards) if (card.parentId && gone.has(card.parentId) && !gone.has(card.id) && !reparent[card.id]) { gone.add(card.id); grew = true }
  }
  board.cards = board.cards.filter(card => !gone.has(card.id)).map(card => ({
    ...card, ...(relabel[card.id] && { label: relabel[card.id] }), ...(reparent[card.id] && { parentId: reparent[card.id] }),
    ...(card.source && sources[card.source] && { source: sources[card.source] }),
  }))
  return board
}

/** A launch plan read from a brief, dated from the next Monday and given the library plan's rules. */
function datedPlan(board, today) {
  if (board.kind !== 'launch-plan') return board
  return clearOfHolidays({ ...board, clock: { origin: nextMonday(today) },
    behaviour: presetRules([{ kind: 'workdays' }, { kind: 'deadline', at: 'launch' }, { kind: 'cascade', onConflict: 'push' }]) })
}

/** The plan's board as a workshop (validated), or null for typed steps (a drawing, no board). Throws when it can't be built. */
export function firstWorkshop(plan, { today } = {}) {
  const spec = plan.board
  let board
  if (spec.kind === 'brief') {
    board = businessBoardFromBrief(spec.brief)
    if (!board) throw new Error('That brief opens no board.')
    if (spec.dated) board = datedPlan(board, today)
  } else if (spec.kind === 'preset') board = presetBoard(spec)
  else if (spec.kind === 'sample') board = sampleBoard(spec, today)
  else if (spec.kind === 'lanes') board = workshopFromLaneBrief(spec.brief)
  else if (spec.kind === 'steps') return null
  else throw new Error('Unknown board kind ' + spec.kind)
  return validateWorkshop(plan.title ? { ...board, title: plan.title } : board)
}

const NOTE_WIDTH = 280
export const HOW_NOTE_ID = 'first-run-how'
/** The note's text and the height it needs for it. */
export function howItWorksText(lines) {
  const text = ['How this board works', ...lines].join('\n')
  const perLine = Math.floor((NOTE_WIDTH - 32) / (16 * 0.55))
  const rows = text.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / perLine)), 0)
  return { text, height: Math.round(rows * 16 * 1.45 + 32) }
}
/** The "How this board works" note: a real note, beside the board, that can be moved or deleted. */
export function howItWorksNote(lines, at = { x: 40, y: 40 }) {
  const { text, height } = howItWorksText(lines)
  return { options: { id: HOW_NOTE_ID, name: 'How this board works', text, xPos: at.x, yPos: at.y, width: NOTE_WIDTH,
    height, shapeHint: 'rectangle', backgroundColor: '#f4f1e8', foregroundColor: '#243b32',
    borderColor: '#b8b2a0', borderWidth: 1, borderStyle: 'dashed', fontSize: 16 }, relationships: { associations: [] } }
}

/**
 * The slate a first-run plan makes: its name, the note, the board (beside the note) or the typed steps,
 * and options.firstRun (the job, the starters Ask Slatebox opens with, who Share invites).
 */
export function firstSlateContent(plan, { today } = {}) {
  const firstRun = { key: plan.key, job: plan.job ?? null, with: plan.with ?? null, starters: plan.starters, share: plan.share ?? null, v: FIRST_SLATE_VERSION }
  const note = howItWorksNote(plan.note)
  const brief = plan.creationBrief ? { creationBrief: plan.creationBrief } : {}
  const workshop = firstWorkshop(plan, { today })
  if (!workshop) {
    // Typed steps: the drawing as they wrote it, a note per step, to the right of the note.
    const drawing = nativeSlateFromBrief(plan.board.brief)
    const right = NOTE_WIDTH + 80
    const nodes = drawing.nodes.map(node => ({ ...node, options: { ...node.options, xPos: (Number(node.options?.xPos) || 0) + right } }))
    return { options: { ...drawing.options, ...brief, name: plan.title || drawing.options.name, firstRun }, nodes: [note, ...nodes] }
  }
  const origin = { x: 40 + NOTE_WIDTH + 80, y: 40 }
  const set = componentSet(workshop, origin)
  return {
    options: { name: workshop.title, ...brief, firstRun, workshopOrigin: set['options.workshopOrigin'] },
    nodes: [note], nativeCanvasDrawing: true, creative: set.creative,
  }
}

/**
 * "Make it yours": a board brief sent on a first-run slate whose only board is still as it was made
 * (revision 0) rebuilds that board in place, when it is the same kind, keeping its title, and a launch
 * plan its dates and rules. The board to store, or null (anything else is added beside, as before).
 */
export function firstRunReplace(slate, workshop) {
  const current = slate?.creative?.model?.kind === 'workshop' ? slate.creative.model.workshop : null
  if (!slate?.options?.firstRun || !current || slate.creative.revision !== 0 || !workshop?.kind || current.kind !== workshop.kind) return null
  if (slate.boards && Object.keys(slate.boards).length) return null
  const kept = clearOfHolidays({ ...workshop, title: current.title,
    ...(workshop.kind === 'launch-plan' && current.clock && { clock: current.clock, ...(current.behaviour && { behaviour: current.behaviour }) }) })
  try { return validateWorkshop(kept) } catch { try { return validateWorkshop({ ...workshop, title: current.title }) } catch { return null } }
}

const listed = names => names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1)
const money = value => (value >= 1e6 ? +(value / 1e6).toFixed(2) + 'M' : value >= 1e3 ? +(value / 1e3).toFixed(1) + 'k' : String(value))
/**
 * The "How this board works" lines for a board rebuilt in place: about the board as it is now, never naming
 * a task, a deal or a floor the rebuild took away.
 */
export function rebuiltNoteLines(workshop) {
  if (workshop.kind === 'launch-plan') {
    // The first task that others wait on, and everything that waits on it, directly or not.
    const waits = id => workshop.cards.filter(card => card.dependsOn?.includes(id))
    const first = workshop.cards.find(card => waits(card.id).length)
    if (!first) return ['Drag a task later and anything waiting on it moves too.', 'The red line is launch day; nothing may cross it.']
    const after = [], seen = new Set([first.id])
    for (let queue = waits(first.id); queue.length;) {
      const card = queue.shift()
      if (seen.has(card.id)) continue
      seen.add(card.id); after.push(card.label); queue.push(...waits(card.id))
    }
    return launchNote(first.label, listed(after))
  }
  if (workshop.kind === 'pipeline') return ['The forecast is each deal times its stage’s odds.', 'Deals move one stage at a time; drag one across, or ask Slatebox to move it.']
  if (workshop.kind === 'budget') {
    const floors = workshop.lanes.filter(lane => Number.isFinite(lane.floor) && lane.floor > 0)
    return ['The total stays fixed: give one line more and the rest give way.',
      floors.length ? floors.map(lane => lane.label + ' can’t drop below ' + money(lane.floor) + '.').join(' ') : 'Ask Slatebox to move money from one line to another.']
  }
  return ['Drag a card across, or ask Slatebox to change one.', 'Rename anything by typing on it.']
}
