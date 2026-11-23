import { validateWorkshop } from 'slateboxjs/workshops/model'
import { readNoteNumbers, sampleBudget } from 'slateboxjs/workshops/rules'

// “Split a 1.2M budget across Product, Sales and Marketing; Product at least 400k”. The total,
// two to five teams, then optional clauses after semicolons: “T at least|at most Y” (a floor or
// a cap) and “with Contractor 45k in Product, Ads 20k in Marketing” (line items). Allocations
// start equal, rounded to the step ($5k), the remainder to the first team, then move just enough
// to meet each floor and cap. “Make a budget” alone opens the sample budget. Server only: it
// brings the budget's rules.

export const budgetOpener = /^(?:split\s+(?:a\s+|the\s+)?\S+\s+budget\b|make\s+a\s+budget\b)/i
const instructions = 'Say the total and the teams, like “Split a 1.2M budget across Product, Sales and Marketing; Product at least 400k”.'
const step = 5000

const slug = (label, used) => {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team'
  let id = /^[a-z0-9]/.test(base) ? base : 't-' + base
  for (let n = 2; used.has(id); n++) id = base + '-' + n
  used.add(id)
  return id
}
const money = words => {
  const read = readNoteNumbers(words)
  if (read.amount === undefined || read.label) throw new Error(instructions)
  return read
}

export function budgetFromBrief(text) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/[.!]$/, '')
  if (/^make\s+a\s+budget$/i.test(words)) return validateWorkshop(sampleBudget())
  const match = /^split\s+(?:a\s+|the\s+)?(\S+)\s+budget\s+(?:across|between|among)\s+([^;]+?)(?:\s*;\s*(.*))?$/i.exec(words)
  if (!match) throw new Error(instructions)
  const total = money(match[1])
  const names = match[2].split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).map(name => name.trim()).filter(Boolean)
  if (names.length < 2 || names.length > 5) throw new Error('Split a budget across two to five teams.')
  const ids = new Set()
  const lanes = names.map(label => ({ id: slug(label, ids), label }))
  const teamCalled = name => {
    const lane = lanes.find(item => item.label.toLowerCase() === name.trim().toLowerCase())
    if (!lane) throw new Error(`There is no team called “${name.trim()}” in this budget.`)
    return lane
  }
  const cards = []
  for (const clause of (match[3] ?? '').split(/\s*;\s*/).filter(Boolean)) {
    const bound = /^(.+?)\s+(?:gets\s+|has\s+)?at\s+(least|most)\s+(.+)$/i.exec(clause)
    if (bound) { teamCalled(bound[1])[bound[2].toLowerCase() === 'least' ? 'floor' : 'cap'] = money(bound[3]).amount; continue }
    const items = /^with\s+(.+)$/i.exec(clause)
    if (!items) throw new Error(instructions)
    for (const item of items[1].split(/\s*,\s*/)) {
      const placed = /^(.+?)\s+in\s+(.+)$/i.exec(item)
      if (!placed) throw new Error('Say which team each line item is in, like “with Contractor 45k in Product”.')
      const read = readNoteNumbers(placed[1])
      if (!read.label || read.amount === undefined) throw new Error('Write the cost on each line item, like “Contractor 45k”.')
      cards.push({ id: slug(read.label, ids), label: read.label, laneId: teamCalled(placed[2]).id, amount: read.amount })
    }
  }
  // Equal shares in whole steps, the remainder to the first team.
  const share = Math.floor(total.amount / lanes.length / step) * step
  lanes.forEach((lane, index) => { lane.allocation = index ? share : total.amount - share * (lanes.length - 1) })
  // Then just enough moves to meet each team's floor (and what its line items commit) and cap.
  const least = lane => Math.max(lane.floor ?? 0, cards.reduce((sum, card) => sum + (card.laneId === lane.id ? card.amount : 0), 0))
  for (const lane of lanes) {
    let short = least(lane) - lane.allocation
    for (const other of lanes) {
      if (short <= 0) break
      if (other === lane) continue
      const spare = Math.max(0, other.allocation - least(other))
      const moved = Math.min(spare, short)
      other.allocation -= moved; lane.allocation += moved; short -= moved
    }
    let over = lane.allocation - (lane.cap ?? Infinity)
    for (const other of lanes) {
      if (over <= 0) break
      if (other === lane) continue
      const room = (other.cap ?? Infinity) - other.allocation
      const moved = Math.min(room, over)
      other.allocation += moved; lane.allocation -= moved; over -= moved
    }
  }
  return validateWorkshop({
    version: 1, kind: 'budget', title: (total.currency ?? '$') + (total.amount >= 1e6 ? total.amount / 1e6 + 'M' : total.amount / 1e3 + 'k') + ' budget',
    budget: { total: total.amount, currency: total.currency ?? '$', step }, lanes, cards,
  })
}
