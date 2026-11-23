import { validateWorkshop } from 'slateboxjs/workshops/model'
import { readNoteNumbers, sampleLaunchPlan } from 'slateboxjs/workshops/rules'

// “Plan a launch for day 30: Design 5 days, Build 8 days after Design, Docs 3 days after Build”.
// The opener, an optional launch day, then tasks separated by commas: a name, its days, what it
// waits on (“after A and B”) and its team (“on Marketing”). “Make a launch plan” alone opens the
// sample plan. Only what the person wrote is read; the board passes the same gate as any save.
// Server only: it brings the launch plan's rules.

export const launchPlanOpener = /^(?:plan\s+a\s+launch|make\s+a\s+launch\s+plan)\b/i
const instructions = 'Name the tasks with their days, like “Plan a launch for day 30: Design 5 days, Build 8 days after Design”.'

const slug = (label, used) => {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task'
  let id = /^[a-z0-9]/.test(base) ? base : 't-' + base
  for (let n = 2; used.has(id); n++) id = base + '-' + n
  used.add(id)
  return id
}

export function launchPlanFromBrief(text) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/[.!]$/, '')
  if (!launchPlanOpener.test(words)) throw new Error(instructions)
  const match = /^(?:plan a launch|make a launch plan)(?:\s+(?:for\s+day\s+(\d{1,3})|in\s+(\d{1,3})\s+days?))?\s*(?::\s*(.*))?$/i.exec(words)
  if (!match) throw new Error(instructions)
  const day = match[1] ?? match[2]
  const items = match[3]?.trim()
  if (!items) {
    const sample = sampleLaunchPlan()
    if (day) sample.launch = { day: Number(day) }
    return validateWorkshop(sample)
  }
  const teams = [], tasks = [], ids = new Set()
  const teamOf = label => {
    const found = teams.find(team => team.label.toLowerCase() === label.toLowerCase())
    if (found) return found.id
    const team = { id: slug(label, ids), label }
    teams.push(team)
    return team.id
  }
  const written = items.split(/\s*[,;]\s*/).filter(Boolean)
  for (const [index, item] of written.entries()) {
    // “… on Marketing” sets the team and “… after A and B” what it waits on, in either order.
    const parts = item.split(/\s+(on|after)\s+/i)
    const rest = parts[0]
    let team = null, after = []
    for (let at = 1; at < parts.length; at += 2) {
      if (parts[at].toLowerCase() === 'on') team = parts[at + 1].replace(/^the\s+|\s+team$/gi, '').trim()
      else after = parts[at + 1].split(/\s*(?:,|\band\b|&)\s*/i).map(name => name.trim()).filter(Boolean)
    }
    const read = readNoteNumbers(rest)
    if (!read.label) throw new Error(instructions)
    tasks.push({ label: read.label, days: read.days ?? 2, after, team: team ?? (index % 2 ? 'Engineering' : 'Product') })
  }
  // A task with no team named takes turns between Product and Engineering.
  const cards = tasks.map(task => ({ id: slug(task.label, ids), label: task.label, laneId: teamOf(task.team), duration: task.days }))
  for (const [index, task] of tasks.entries()) {
    const waitsOn = task.after.map(name => {
      const found = cards.slice(0, index).find(card => card.label.toLowerCase() === name.toLowerCase())
      if (!found) throw new Error(`There is no task called “${name}” in this plan. Name it before the tasks that wait on it.`)
      return found.id
    })
    if (waitsOn.length) cards[index].dependsOn = [...new Set(waitsOn)]
  }
  if (teams.length < 2) teamOf(teams[0]?.label === 'Engineering' ? 'Product' : 'Engineering')
  const draft = { version: 1, kind: 'launch-plan', title: 'Launch plan', lanes: teams, cards, launch: { day: 14 } }
  // No launch day written: the plan's own finish, and never before day 14.
  if (day) draft.launch.day = Number(day)
  else {
    const end = new Map()
    const finish = card => end.get(card.id) ?? (end.set(card.id, Math.max(0, ...(card.dependsOn ?? []).map(id => finish(cards.find(other => other.id === id)))) + card.duration), end.get(card.id))
    draft.launch.day = Math.min(120, Math.max(14, ...cards.map(finish)))
  }
  return validateWorkshop(draft)
}
