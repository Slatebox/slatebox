import { validateWorkshop } from 'slateboxjs/workshops/model'

export const constraintRules = {
  map: ['open-path', 'close-path', 'arrival-outcome', 'station-capacity'],
  'release-plan': ['point-budget', 'effort', 'require-feature', 'remove-prerequisite'],
}

function field(model, operation) {
  const { rule, subject, value } = operation
  const map = Boolean(model.lanes[0].station)
  if (!constraintRules[map ? 'map' : model.kind]?.includes(rule)) throw new Error('Choose a rule for this workshop format.')
  if (typeof value !== 'string' || value.length > 160) throw new Error('Provide the requested rule value as a short string.')
  const targetsCard = ['effort', 'require-feature', 'remove-prerequisite'].includes(rule)
  const collection = targetsCard ? model.cards : model.lanes
  const item = collection.find(entry => entry.id === subject)
  if (!item) throw new Error('Choose an existing station, window or feature ID.')
  const object = targetsCard ? 'cards' : 'lanes'
  function result(property, before, after, title, display = String, edge) {
    return { object, subject, property, before, after, edge, title,
      from: display(before), to: display(after) }
  }
  if (['open-path', 'close-path', 'require-feature', 'remove-prerequisite'].includes(rule)) {
    const target = collection.find(entry => entry.id === value)
    if (!target || target.id === item.id) throw new Error('Point this rule at a different existing item.')
    const property = map ? 'next' : 'dependsOn'
    const links = map ? item.station.next : item.dependsOn || []
    const include = rule === 'open-path' || rule === 'require-feature'
    const title = map ? item.label + ' → ' + target.label : item.label + ' requires ' + target.label
    return result(property, links.includes(target.id), include, title,
      present => map ? (present ? 'Open' : 'Closed') : (present ? 'Required' : 'Optional'), target.id)
  }
  if (rule === 'arrival-outcome') {
    if (!value.trim() || /[<>\u0000-\u001f]/.test(value)) throw new Error('Give the station a short plain-text consequence.')
    return result('outcome', item.station.outcome, value.trim(), 'Arrival at ' + item.label)
  }
  const isEffort = rule === 'effort'
  const limit = rule === 'point-budget' ? 576 : 24
  const unlimited = !isEffort && value === 'unlimited'
  if (!unlimited && (!/^[1-9][0-9]*$/.test(value) || Number(value) > limit)) throw new Error('Use a positive whole number within the allowed budget.')
  const property = isEffort ? 'points' : 'capacity'
  const title = item.label + (isEffort ? ' effort' : map ? ' capacity' : ' budget')
  return result(property, item[property] ?? null, unlimited ? null : Number(value), title,
    n => n === null ? 'Unlimited' : n + (map ? ' token' : ' point') + (n === 1 ? '' : 's'))
}

function describe(model, operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 8) throw new Error('Suggest one to eight specific rule changes.')
  const keys = new Set()
  return operations.map(op => {
    if (!op || typeof op !== 'object' || typeof op.subject !== 'string' || Object.keys(op).some(k => !['rule', 'subject', 'value'].includes(k))) throw new Error('Identify the existing subject of each rule.')
    const descriptor = field(model, op)
    const key = JSON.stringify([descriptor.object, descriptor.subject, descriptor.property, descriptor.edge])
    if (keys.has(key)) throw new Error('Include each rule only once.')
    keys.add(key)
    return descriptor
  })
}

function apply(model, changes) {
  const updated = structuredClone(model)
  for (const change of changes) {
    const item = updated[change.object].find(entry => entry.id === change.subject)
    const container = ['next', 'outcome'].includes(change.property) ? item.station : item
    if (change.edge) {
      const links = container[change.property] || []
      container[change.property] = change.after ? [...links, change.edge] : links.filter(id => id !== change.edge)
    } else if (change.after === null) delete container[change.property]
    else container[change.property] = change.after
  }
  return validateWorkshop(updated)
}

export function prepareConstraintProposal(base, response) {
  const model = validateWorkshop(base)
  const operations = response?.changes
  const changes = describe(model, operations)
  if (changes.some(change => change.before === change.after)) throw new Error('Suggest only rules whose current value would change.')
  apply(model, changes)
  return { operations: operations.map(({ rule, subject, value }) => ({ rule, subject, value })),
    before: changes.map(change => change.before), rows: changes.map(({ title, from, to }) => ({ title, from, to })) }
}

export function acceptConstraintProposal(current, proposal) {
  const model = validateWorkshop(current)
  const changes = describe(model, proposal.operations)
  if (changes.some((change, i) => change.before !== proposal.before[i])) {
    throw new Error('A rule in this proposal was edited. Discard it and request a revision using your latest changes.')
  }
  return apply(model, changes)
}
