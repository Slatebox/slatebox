import assert from 'node:assert/strict'
import test from 'node:test'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { drawingAfter, playWorkshopChanges, readWorkshopChanges, tradeKey, tradesAfter } from '../web/app/server/methods/workshop-play.mjs'
import { storeTradePictures } from '../web/app/server/methods/workshop-pictures.mjs'
import { readWorkshop } from '../web/app/server/workshop-read.mjs'

// Content never refuses a trade (coordinator decisions, 2026-11-21).

const board = () => validateWorkshop({ version: 1, title: 'Plan', lanes: [{ id: 'now', label: 'Now' }, { id: 'later', label: 'Later' }],
  cards: [{ id: 'alpha', label: 'Alpha', laneId: 'now' }] })

test('an old note id the card cannot have: the card gets a fresh id, and the trade back returns the note under its own id', () => {
  const noteId = 'old.note id'
  const drawn = [{ options: { id: noteId, text: 'Old' }, relationships: { associations: [] } }]
  const toCard = playWorkshopChanges(board(), readWorkshopChanges([{ cardId: 'card-1', laneId: 'now', noteToCard: { noteId, label: 'Old' } }]), [noteId], {})
  assert.equal(toCard.refused, undefined)
  const card = toCard.workshop.cards.at(-1)
  assert.deepEqual([card.id, card.noteId], ['card-1', noteId])
  assert.deepEqual(drawingAfter(drawn, toCard.drawing), [])
  // The record is kept under a key the store can use, and names the note.
  const trades = tradesAfter({}, toCard.drawing, 4)
  assert.ok(/^[A-Za-z0-9_-]+$/.test(tradeKey(noteId)))
  assert.deepEqual(trades[tradeKey(noteId)], { r: 4, as: 'card', id: noteId })
  const back = playWorkshopChanges(toCard.workshop, readWorkshopChanges([{ cardId: 'card-1', cardToNote: { noteId, note: { options: { id: noteId, text: 'Old' } } } }]), [], trades)
  assert.equal(back.refused, undefined)
  assert.deepEqual(drawingAfter([], back.drawing).map(node => node.options.id), [noteId])
})

test('a card that becomes a note: the trade record carries its lines, for screens the trading page never told', () => {
  const start = validateWorkshop({ ...board(), lines: [{ id: 'sing->alpha', parentId: 'sing', childId: 'alpha' }] })
  const played = playWorkshopChanges(start, readWorkshopChanges([{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: { options: { id: 'alpha', text: 'Alpha' } } } }]), ['sing'], {})
  assert.deepEqual(tradesAfter({}, played.drawing, 7).alpha, { r: 7, as: 'note', note: { options: { id: 'alpha', text: 'Alpha' } },
    lines: [{ id: 'sing->alpha', parentId: 'sing', childId: 'alpha' }] })
})

test('a picture held in the page is stored with the slate\'s pictures and the card keeps its address; with no store it stays a note, and says why', async () => {
  const src = 'data:image/png;base64,iVBORw0KGgo='
  const changes = readWorkshopChanges([{ cardId: 'pic', laneId: 'now', noteToCard: { noteId: 'pic', label: 'Pic', asNote: { image: { src, width: 4, height: 4 } } } }])
  const stored = []
  const store = async ({ body, contentType, key }) => { stored.push({ size: body.length, contentType, key }); return 'https://files.example.org/' + key }
  const kept = await storeTradePictures(changes, { slateId: 'slate1', store })
  assert.match(kept[0].noteToCard.asNote.image.src, /^https:\/\/files\.example\.org\/.+\.png$/)
  assert.deepEqual(kept[0].noteToCard.asNote.image.width, 4)
  assert.equal(stored[0].contentType, 'image/png')
  const played = playWorkshopChanges(board(), kept, ['pic'], {})
  assert.match(played.workshop.cards.at(-1).asNote.image.src, /^https:/)
  await assert.rejects(storeTradePictures(changes, { slateId: 'slate1', store: null }), error =>
    error.refused?.reason === 'This slate has nowhere to keep a picture held in the page, so the note stays a note.')
})

test('words with markup are kept verbatim and read back as data, never as markup', () => {
  const words = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>'
  const played = playWorkshopChanges(board(), readWorkshopChanges([{ cardId: 'mk', laneId: 'now', noteToCard: { noteId: 'mk', label: words } }]), ['mk'], {})
  assert.equal(played.workshop.cards.at(-1).label, words)
  const read = readWorkshop(played.workshop, { creative: { revision: 2 } }, {})
  assert.equal(read.cards.at(-1).label, words)
  assert.equal(JSON.parse(JSON.stringify(read)).cards.at(-1).label, words)
})
