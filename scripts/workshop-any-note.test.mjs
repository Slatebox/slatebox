import assert from 'node:assert/strict'
import test from 'node:test'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { drawingAfter, playWorkshopChanges, readWorkshopChanges } from '../web/app/server/methods/workshop-play.mjs'

// Any note becomes a card (owner decision 2026-11-21): the server takes an empty note, long words,
// a picture and a link as the canvas does, and gives them back when the card is a note again. Only
// the board's own rules (a full lane, a full board, a board that keeps its cards) or someone else's
// change refuse a trade.

const board = () => validateWorkshop({
  version: 1, title: 'Plan', lanes: [{ id: 'now', label: 'Now' }, { id: 'later', label: 'Later', capacity: 1 }],
  cards: [{ id: 'alpha', label: 'Alpha', laneId: 'now' }],
})

test('an empty note dropped on a lane is saved as an empty card, and leaves the drawing', () => {
  const drawn = [{ options: { id: 'blank', text: '' }, relationships: { associations: [] } }]
  const played = playWorkshopChanges(board(), readWorkshopChanges([{ cardId: 'blank', laneId: 'now', noteToCard: { noteId: 'blank', label: '' } }]), ['blank'], {})
  assert.equal(played.refused, undefined)
  assert.deepEqual(played.workshop.cards.at(-1), { id: 'blank', label: '', laneId: 'now' })
  assert.deepEqual(drawingAfter(drawn, played.drawing), [])
  // And back off the lanes as an empty note.
  const back = playWorkshopChanges(played.workshop, readWorkshopChanges([{ cardId: 'blank', cardToNote: { noteId: 'blank', note: { options: { id: 'blank', text: '' } } } }]), [], {})
  assert.deepEqual(back.workshop.cards.map(card => card.id), ['alpha'])
  // A card renamed to nothing is saved as an empty card.
  assert.equal(playWorkshopChanges(board(), readWorkshopChanges([{ rename: { cardId: 'alpha', label: '' } }])).workshop.cards[0].label, '')
})

test('long words, a picture and a link are a card too, keeping what the note had', () => {
  const words = 'word '.repeat(30).trim()
  const asNote = { image: { src: 'https://cdn.example.org/a.png', width: 640, height: 480 }, link: { type: 'externalUrl', data: { url: 'https://example.org/x' }, show: true } }
  const played = playWorkshopChanges(board(), readWorkshopChanges([{ cardId: 'long', laneId: 'now', noteToCard: { noteId: 'long', label: words, asNote } }]), ['long'], {})
  const card = played.workshop.cards.at(-1)
  assert.ok(card.label.length <= 80)
  assert.deepEqual(card.asNote, { ...asNote, text: words })
})

test('the board\'s own rules still refuse: a full lane', () => {
  const full = playWorkshopChanges(board(), readWorkshopChanges([{ cardId: 'one', laneId: 'later', noteToCard: { noteId: 'one', label: '' } }]), ['one'], {}).workshop
  const refused = playWorkshopChanges(full, readWorkshopChanges([{ cardId: 'two', laneId: 'later', noteToCard: { noteId: 'two', label: 'Two' } }]), ['two'], {})
  assert.equal(refused.refused.reason, 'It already holds 1 of 1 card.')
})
