// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Items as slates. An org chart is a tree (a note per person, a connector from each manager, a frame
// per department); the other templates are their smart component, a card per row, lanes from the
// status or stage column in the sheet's own order. Past 24 cards a slate holds boards grouped by a
// column (or in runs of 24), 8 boards a slate, then a second slate.
import { normalKey, plain } from '../_shared/text.mjs'
import { SHEET_TEMPLATES } from './manifest.mjs'
import { sheetDay } from './map.mjs'

export const BOARD_LIMITS = Object.freeze({ cards: 24, boardsPerSlate: 8, lanes: 8 })

const LABEL = { kanban: 'title', 'hiring-plan': 'role', pipeline: 'deal', timeline: 'task' }
const LANE = { kanban: 'status', 'hiring-plan': 'stage', pipeline: 'stage', timeline: null }
const DUE = { kanban: 'due', 'hiring-plan': 'start', pipeline: 'close', timeline: 'end' }

export const laneKey = (value) => normalKey(value).replace(/ /g, '-') || 'none'

export function orgChart(items) {
  const byName = new Map(items.map((i) => [normalKey(i.cells.name), i]))
  const byId = new Map(items.filter((i) => i.cells.id).map((i) => [normalKey(i.cells.id), i]))
  const nodes = items.map((i) => ({ key: 'p:' + i.key, text: plain([i.cells.name, i.cells.title].filter(Boolean).join('\n'), 200, { lines: true }) }))
  const edges = []
  for (const i of items) {
    const boss = i.cells.manager && (byName.get(normalKey(i.cells.manager)) || byId.get(normalKey(i.cells.manager)))
    if (boss && boss !== i) edges.push({ from: 'p:' + boss.key, to: 'p:' + i.key })
  }
  const departments = new Map()
  for (const i of items) if (i.cells.department) {
    if (!departments.has(i.cells.department)) departments.set(i.cells.department, [])
    departments.get(i.cells.department).push('p:' + i.key)
  }
  const frames = [...departments].map(([text, members]) => ({ key: 'dept:' + normalKey(text), text: plain(text, 80), members }))
  return { nodes, edges, frames, layout: 'tree' }
}

/** Lanes from the column's values, in the order the sheet first uses them (8 at most, the rest "Other"). */
export function lanesOf(items, column) {
  if (!column) return [{ key: 'plan', label: 'Plan' }]
  const lanes = []
  for (const i of items) {
    const value = i.cells[column] || 'No status'
    if (!lanes.some((l) => l.label === value)) lanes.push({ key: laneKey(value), label: plain(value, 40) })
  }
  return lanes.length > BOARD_LIMITS.lanes ? [...lanes.slice(0, BOARD_LIMITS.lanes - 1), { key: 'other', label: 'Other' }] : lanes
}

export function cardOf(item, template, lanes, { changed = false, winner = 'sheet', byTask = new Map() } = {}) {
  const laneColumn = LANE[template]
  const value = laneColumn ? item.cells[laneColumn] || 'No status' : null
  const lane = laneColumn ? (lanes.find((l) => l.label === value) || lanes[lanes.length - 1]).key : lanes[0].key
  const due = sheetDay(item.cells[DUE[template]])
  const skip = new Set([LABEL[template], laneColumn, DUE[template], 'id', 'owner', 'dependsOn', 'group'])
  const fields = Object.fromEntries(Object.entries(item.cells).filter(([k, v]) => v && !skip.has(k)).map(([k, v]) => [k, plain(v, 120)]))
  const dependsOn = template === 'timeline' && item.cells.dependsOn ? item.cells.dependsOn.split(/[,;]/).map((t) => byTask.get(normalKey(t))).filter(Boolean).map((i) => 'r:' + i.key) : []
  return {
    key: 'r:' + item.key,
    label: plain(item.cells[LABEL[template]] || item.key, 90),
    lane,
    ...(due && { due }),
    ...(item.cells.owner && { owner: plain(item.cells.owner, 60) }),
    ...(dependsOn.length && { dependsOn }),
    fields: { ...fields, row: String(item.row), ...(changed && { note: 'changed in sheet' }) },
    // The sheet changed this row since the last run: with the sheet winning, the card follows it again even if a person moved it.
    ...(changed && winner === 'sheet' && { reclaim: true }),
  }
}

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size))

/** → slates for one tab. base: { fileId, tab, name }. changedKeys: rows whose values changed since the last run. */
export function boardSlates(items, { template, base, groupBy = null, changedKeys = new Set(), winner = 'sheet' }) {
  const key = `${base.fileId}/${normalKey(base.tab) || 'tab'}`
  if (template === 'org-chart') return [{ role: 'board', key, name: base.name, graph: orgChart(items), notes: [{ key: 'legend', anchor: 'legend', text: base.legend }] }]
  const spec = SHEET_TEMPLATES[template]
  const lanes = lanesOf(items, LANE[template])
  const byTask = new Map(items.map((i) => [normalKey(i.cells.task || ''), i]))
  const cards = items.map((i) => cardOf(i, template, lanes, { changed: changedKeys.has(i.key), winner, byTask }))
  let groups
  if (cards.length <= BOARD_LIMITS.cards) groups = [{ title: base.tab, cards }]
  else if (groupBy) {
    const by = new Map()
    items.forEach((item, n) => {
      const g = plain(item.cells.group || 'Other', 60)
      if (!by.has(g)) by.set(g, [])
      by.get(g).push(cards[n])
    })
    groups = [...by].flatMap(([title, list]) => chunk(list, BOARD_LIMITS.cards).map((part, i, all) => ({ title: all.length > 1 ? `${title} (${i + 1})` : title, cards: part })))
  } else groups = chunk(cards, BOARD_LIMITS.cards).map((part, i) => ({ title: `${base.tab} (${i + 1})`, cards: part }))
  return chunk(groups, BOARD_LIMITS.boardsPerSlate).map((set, s) => ({
    role: 'board',
    key: s ? `${key}/${s + 1}` : key,
    name: s ? `${base.name} (${s + 1})` : base.name,
    boards: set.map((g) => ({ key: 'b:' + normalKey(g.title), component: spec.component, title: plain(g.title, 80), lanes: lanes.map((l) => ({ ...l })), cards: g.cards })),
    notes: [{ key: 'legend', anchor: 'legend', text: base.legend }],
  }))
}
