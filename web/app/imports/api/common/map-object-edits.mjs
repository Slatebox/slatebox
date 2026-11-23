import { addWorkshopBranch, moveWorkshopCard, validateWorkshop } from 'slateboxjs/workshops/model'

/** Only an object identity travels with a turn. Labels and rules come from the current board. */
export function mapObjectSelection(map, selection) {
  if (selection == null) return null
  if (!map.lanes[0]?.station || !['lane', 'card'].includes(selection.kind) ||
      Object.keys(selection).some(key => key !== 'kind' && key !== 'id') ||
      !(selection.kind === 'lane' ? map.lanes : map.cards).some(item => item.id === selection.id)) {
    throw new Error('Select a station or token that is still on this map.')
  }
  return {kind: selection.kind, id: selection.id}
}

function stationId(map, name) {
  const matches = map.lanes.filter(lane => lane.label.toLowerCase() === name.trim().toLowerCase())
  const exact = map.lanes.find(lane => lane.id === name.trim())
  if (exact) return exact.id
  if (matches.length !== 1) throw new Error('Use the name or ID of one station on this map.')
  return matches[0].id
}

export function addMapToken(workshop, laneId, label) {
  const map = validateWorkshop(workshop)
  if (!map.lanes.find(lane => lane.id === laneId)?.station) throw new Error('Choose a station on this map.')
  const ids = new Set([...map.lanes, ...map.cards].map(item => item.id))
  let n = 1
  while (ids.has('token-' + n)) n++
  map.cards.push({id:'token-' + n, label, laneId})
  return validateWorkshop(map)
}

export function applyMapObjectEdit(workshop, selection, edit) {
  const map = validateWorkshop(workshop)
  const selected = mapObjectSelection(map, selection)
  if (!selected) throw new Error('Select a station or token first.')
  if (selected.kind === 'card') {
    if (edit.type === 'moveToken') return validateWorkshop(moveWorkshopCard(map, selected.id, edit.to))
    if (edit.type !== 'rename') throw new Error('Select a station to change that setting.')
    map.cards.find(card => card.id === selected.id).label = edit.text
  } else {
    const lane = map.lanes.find(item => item.id === selected.id)
    switch (edit.type) {
      case 'rename': lane.label = edit.text; break
      case 'outcome': lane.station.outcome = edit.text; break
      case 'addBranch': return addWorkshopBranch(map, lane.id, {label: edit.label, outcome: edit.outcome})
      case 'connect':
        if (!lane.station.next.includes(edit.to)) lane.station.next.push(edit.to)
        break
      case 'disconnect':
        if (!lane.station.next.includes(edit.to)) throw new Error('There is no route to that station.')
        lane.station.next = lane.station.next.filter(id => id !== edit.to)
        break
      case 'position': Object.assign(lane.station, {row: edit.row, column: edit.column}); break
      case 'capacity':
        if (!Number.isInteger(edit.capacity)) throw new Error('Set a whole-number capacity or remove the limit.')
        lane.capacity = edit.capacity
        break
      case 'clearCapacity': delete lane.capacity; break
      case 'image': lane.station.image = {src: edit.src, alt: edit.alt}; break
      case 'clearImage': delete lane.station.image; break
      case 'imageDescription':
        if (!lane.station.image) throw new Error('Add a station image before changing its description.')
        lane.station.image.alt = edit.text
        break
      default: throw new Error('Choose an edit supported by this station.')
    }
  }
  return validateWorkshop(map)
}

/** Return null for a whole-map request so existing map conversation still handles it. */
export function proposeMapObjectEdit(map, message, selection) {
  const selected = mapObjectSelection(map, selection)
  if (!selected) return null
  const item = (selected.kind === 'card' ? map.cards : map.lanes).find(item => item.id === selected.id)
  const proposal = (edit, reply) => ({workshop: applyMapObjectEdit(map, selected, edit), reply})
  let match = /^rename (?:it|this(?: station| step| token)?) to (.+)$/i.exec(message)
  if (match) return proposal({type:'rename', text:match[1]}, 'Renamed “' + item.label + '” to “' + match[1] + '”.')
  match = /^on arrival\s*[:,]?\s+(.+)$/i.exec(message)
  if (match) return proposal({type:'outcome', text:match[1]}, 'Updated the arrival at “' + item.label + '”.')
  match = /^add a branch to (.+)$/i.exec(message)
  if (match) return proposal({type:'addBranch', label:match[1], outcome:match[1]}, 'Added a branch to “' + match[1] + '”.')
  match = /^(connect to|disconnect from) (.+)$/i.exec(message)
  if (match) {
    const connect = /^connect/i.test(match[1])
    return proposal({type:connect ? 'connect' : 'disconnect', to:stationId(map, match[2])}, (connect ? 'Connected' : 'Disconnected') + ' the route to “' + match[2] + '”.')
  }
  match = /^move to column (\d+),? row (\d+)$/i.exec(message)
  if (match) return proposal({type:'position', column:Number(match[1])-1, row:Number(match[2])-1}, 'Moved “' + item.label + '” to column ' + match[1] + ', row ' + match[2] + '.')
  match = /^move to (.+)$/i.exec(message)
  if (match && selected.kind === 'card') return proposal({type:'moveToken', to:stationId(map, match[1])}, 'Moved “' + item.label + '” to “' + match[1] + '”.')
  match = /^set capacity to (\d+)$/i.exec(message)
  if (match) return proposal({type:'capacity', capacity:Number(match[1])}, 'Set capacity at “' + item.label + '” to ' + match[1] + '.')
  if (/^remove capacity$/i.test(message)) return proposal({type:'clearCapacity'}, 'Removed the capacity limit at “' + item.label + '”.')
  match = /^set image (\S+) with description (.+)$/i.exec(message)
  if (match) return proposal({type:'image', src:match[1], alt:match[2]}, 'Updated the image at “' + item.label + '”.')
  match = /^(?:set|change) image description to (.+)$/i.exec(message)
  if (match) return proposal({type:'imageDescription', text:match[1]}, 'Updated the image description at “' + item.label + '”.')
  if (/^remove image$/i.test(message)) return proposal({type:'clearImage'}, 'Removed the image at “' + item.label + '”.')
  return null
}
