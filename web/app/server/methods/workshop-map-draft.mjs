import { validateWorkshop, availableLanes } from 'slateboxjs/workshops/model'

const name = { type: 'string', minLength: 1, maxLength: 80 }
export const mapTool = {
  name: 'draft_concept_map',
  description: 'Create an editable simulation of a decision. Name each station, the consequence of arriving there, and the stations it leads to.',
  parameters: {
    type: 'object', additionalProperties: false, required: ['title', 'stations', 'token', 'start'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      stations: { type: 'array', minItems: 2, maxItems: 5, items: {
        type: 'object', additionalProperties: false, required: ['name', 'outcome', 'next'],
        properties: { name, outcome: { type: 'string', minLength: 1, maxLength: 160 },
          next: { type: 'array', maxItems: 4, items: name, description: 'Exact names of other stations reachable from here. An empty array ends the path.' } },
      } },
      signals: { type: 'array', maxItems: 24, items: {
        type: 'object', additionalProperties: false, required: ['label', 'station', 'whenPresent', 'whenAbsent'],
        properties: { label: { ...name, description: 'Name of the outcome. Preserve the name given in the brief.' }, station: { ...name, description: 'Exact target station name.' },
          whenPresent: { type: 'string', minLength: 1, maxLength: 160 },
          whenAbsent: { type: 'string', minLength: 1, maxLength: 160 } },
      } },
      token: { ...name, description: 'Name the person or object moving through the map.' },
      start: { ...name, description: 'Exact name of the station where the token begins. It must lead to another station.' },
    },
  },
}
export const mapInstructions = 'Build a playable concept map tailored to the supplied situation. Use the draft_concept_map tool. Use two to five stations total. Use four when the brief leaves the size open. Give each station a distinctive short name and a concrete consequence. Use those station names exactly in next and start. Model different choices when the brief asks for them. Start the token at a station with an onward path. Every station must be reachable from that starting station. If the brief names a change that depends on the token being at one station, include a signal with both the present and absent messages. Preserve any outcome name and quoted messages supplied in the brief. Return only the requested tool arguments.'

export function conceptMapFromDraft(input) {
  if (!Array.isArray(input?.stations) || input.stations.length < 2 || input.stations.length > 5) {
    throw new Error('Supply a stations array with two to five entries.')
  }
  const key = text => typeof text === 'string' ? text.trim().toLowerCase() : ''
  const ids = new Map()
  input.stations.forEach((station, index) => {
    const stationName = key(station?.name)
    if (!stationName || ids.has(stationName)) throw new Error('Give each station a unique name.')
    ids.set(stationName, 'station-' + (index + 1))
  })
  function stationId(reference) {
    const id = ids.get(key(reference))
    if (!id) throw new Error('Use an existing station name for the start, paths and outcomes.')
    return id
  }
  const lanes = input.stations.map((station, index) => {
    if (!Array.isArray(station.next)) throw new Error('Provide an array of onward station names for each station.')
    return { id: stationId(station.name), label: station.name, station: {
      column: index % 3, row: Math.floor(index / 3),
      next: station.next.map(stationId), outcome: station.outcome,
    } }
  })
  const board = validateWorkshop({ version: 1, title: input.title, lanes,
    ...(input.signals === undefined ? {} : { signals: input.signals.map((signal, index) => ({
      id: 'signal-' + (index + 1), label: signal.label, cardId: 'token', laneId: stationId(signal.station),
      whenPresent: signal.whenPresent, whenAbsent: signal.whenAbsent,
    })) }),
    cards: [{ id: 'token', label: input.token, laneId: stationId(input.start) }] })
  if (availableLanes(board, board.cards[0]).length < 2) {
    throw new Error('The starting station must have at least one permitted onward move.')
  }
  const reachable = new Set([board.cards[0].laneId])
  for (const id of reachable) {
    const stop = board.lanes.find(lane => lane.id === id)
    for (const destination of stop.station.next) reachable.add(destination)
  }
  if (reachable.size !== board.lanes.length) throw new Error('Connect every station to a directed path from the starting station.')
  return board
}
