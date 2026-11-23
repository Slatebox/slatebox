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

// (Restated 2026-11-23, owner decision: an empty note becomes a card named with the board's word for a new
// item, “New card” on lanes, and leaves the board as an empty note again.)
test('an empty note dropped on a lane is saved as “New card”, and leaves the drawing', () => {
  const drawn = [{ options: { id: 'blank', text: '' }, relationships: { associations: [] } }]
  const played = playWorkshopChanges(board(), readWorkshopChanges([{ cardId: 'blank', laneId: 'now', noteToCard: { noteId: 'blank', label: '' } }]), ['blank'], {})
  assert.equal(played.refused, undefined)
  assert.deepEqual(played.workshop.cards.at(-1), { id: 'blank', label: 'New card', laneId: 'now', asNote: { text: '' } })
  // The canvas sends the card's name and that the note had no words: the server makes the same card.
  const sent = playWorkshopChanges(board(), readWorkshopChanges([{ cardId: 'blank', laneId: 'now', noteToCard: { noteId: 'blank', label: 'New card', asNote: { text: '' } } }]), ['blank'], {})
  assert.deepEqual(sent.workshop.cards.at(-1), played.workshop.cards.at(-1))
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

test('an empty note on a hiring plan or a launch plan is saved as “New hire” or “New task”, never refused', async () => {
  await import('slateboxjs/workshops/behaviour')
  const { hiringPlanSample, launchPlanSample } = await import('slateboxjs/workshops/rules')
  for (const [make, name] of [[hiringPlanSample, 'New hire'], [launchPlanSample, 'New task']]) {
    const plan = validateWorkshop(make())
    const laneId = plan.lanes[0].id
    for (const label of ['', name]) {
      const played = playWorkshopChanges(plan, readWorkshopChanges([{ cardId: 'node_blank', laneId, noteToCard: { noteId: 'node_blank', label, asNote: { text: '' } } }]), ['node_blank'], {})
      assert.equal(played.refused, undefined, JSON.stringify(played.refused))
      assert.equal(played.workshop.cards.find(card => card.id === 'node_blank').label, name)
    }
  }
})
