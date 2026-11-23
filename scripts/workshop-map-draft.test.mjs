import assert from 'node:assert/strict'
import test from 'node:test'
import { conceptMapFromDraft } from '../web/app/server/methods/workshop-map-draft.mjs'

function sample() {
  return {
    title: 'Inspect the kiln', token: 'Technician', start: 'Inspect',
    stations: [
      { name: 'Inspect', outcome: 'A split runs along the shelf.', next: ['Replace', 'Repair'] },
      { name: 'Replace', outcome: 'A new shelf is in service.', next: [] },
      { name: 'Repair', outcome: 'The shelf goes to the repair bench.', next: ['Inspect'] },
    ],
  }
}

test('preserves choices and consequences with stable editable IDs and original starting position', () => {
  const source = sample()
  const board = conceptMapFromDraft(source)
  assert.deepEqual(board.cards, [{ id: 'token', label: 'Technician', laneId: 'station-1' }])
  assert.deepEqual(board.lanes[0].station.next, ['station-2', 'station-3'])
  assert.deepEqual(board.lanes.map(lane => lane.station.outcome), source.stations.map(stop => stop.outcome))
  assert.equal(new Set(board.lanes.map(lane => lane.station.row + ',' + lane.station.column)).size, 3)
  source.stations[1].name = 'Exchange'
  source.stations[0].next[0] = 'Exchange'
  const renamed = conceptMapFromDraft(source)
  assert.equal(renamed.lanes[1].label, 'Exchange')
  assert.deepEqual(renamed.lanes.map(lane => lane.id), board.lanes.map(lane => lane.id))
})

test('rejects seven stations before making a slate', () => {
  const draft = sample()
  draft.stations.push(...Array.from({ length: 4 }, (_, i) => ({ name: 'Review ' + i, outcome: 'Review queued.', next: [] })))
  assert.throws(() => conceptMapFromDraft(draft), /two to five/)
})

test('rejects an unknown destination', () => {
  const draft = sample()
  draft.stations[0].next.push('Nowhere')
  assert.throws(() => conceptMapFromDraft(draft), /existing station name/)
})

test('rejects an unreachable authored stop and a starting token with no moves', () => {
  const draft = sample()
  draft.stations[0].next = ['Replace']
  assert.throws(() => conceptMapFromDraft(draft), /directed path/)
  draft.start = 'Replace'
  assert.throws(() => conceptMapFromDraft(draft), /permitted onward move/)
})

test('attaches an authored placement outcome to the token and its named station', () => {
  const draft = sample()
  draft.signals = [{ station: 'Repair', label: 'Kiln readiness', whenPresent: 'Kiln cooling', whenAbsent: 'Ready for firing' }]
  assert.deepEqual(conceptMapFromDraft(draft).signals, [{
    id: 'signal-1', label: 'Kiln readiness', cardId: 'token', laneId: 'station-3',
    whenPresent: 'Kiln cooling', whenAbsent: 'Ready for firing',
  }])
  draft.signals[0].station = 'Missing'
  assert.throws(() => conceptMapFromDraft(draft), /existing station name/)
})
