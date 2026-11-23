import assert from 'node:assert/strict'
import test from 'node:test'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { drawingAfter, playWorkshopChanges, readWorkshopChanges, tradesAfter } from '../web/app/server/methods/workshop-play.mjs'

// Next holds one card, and Gamma may only be in Now.
const ruled = () => validateWorkshop({
  version: 1, title: 'Plan',
  lanes: [{ id: 'now', label: 'Now' }, { id: 'next', label: 'Next', capacity: 1 }, { id: 'later', label: 'Later' }],
  cards: [
    { id: 'alpha', label: 'Alpha', laneId: 'now' }, { id: 'beta', label: 'Beta', laneId: 'now' },
    { id: 'gamma', label: 'Gamma', laneId: 'now', allowedLaneIds: ['now'] }, { id: 'delta', label: 'Delta', laneId: 'now' },
  ],
})
const lanes = workshop => Object.fromEntries(workshop.cards.map(card => [card.id, card.laneId]))

test('two people who move different cards at once both keep their move', () => {
  // Both made their move on the same board. The first is saved; the second is made on what the first saved.
  const first = playWorkshopChanges(ruled(), [{ cardId: 'alpha', laneId: 'later' }]).workshop
  const second = playWorkshopChanges(first, [{ cardId: 'delta', laneId: 'later' }]).workshop
  assert.deepEqual(lanes(second), { alpha: 'later', beta: 'now', gamma: 'now', delta: 'later' })
})

test('a move is refused only when the workshop’s rule refuses it on the latest board, with the rule’s reason and lane', () => {
  // Two people each carry a card to the last free slot in Next. The first takes it.
  const first = playWorkshopChanges(ruled(), [{ cardId: 'alpha', laneId: 'next' }]).workshop
  const lost = playWorkshopChanges(first, [{ cardId: 'beta', laneId: 'next' }])
  assert.equal(lost.workshop, undefined)
  assert.equal(lost.refused.laneId, 'next')
  // The sentence the lane shows under its name on the canvas.
  assert.equal(lost.refused.reason, 'It already holds 1 of 1 card.')
  // A card that may never enter a lane is refused whoever asks and whenever.
  const forbidden = playWorkshopChanges(ruled(), [{ cardId: 'gamma', laneId: 'later' }])
  assert.equal(forbidden.refused.laneId, 'later')
  assert.ok(forbidden.refused.reason.length > 0)
})

test('changes are made in order, all or none', () => {
  const played = playWorkshopChanges(ruled(), [{ cardId: 'alpha', laneId: 'next' }, { cardId: 'alpha', laneId: 'later' }, { cardId: 'beta', laneId: 'next' }])
  assert.deepEqual(lanes(played.workshop), { alpha: 'later', beta: 'next', gamma: 'now', delta: 'now' })
  // The second change is refused, so nothing of the request is returned as a board to save.
  const partly = playWorkshopChanges(ruled(), [{ cardId: 'alpha', laneId: 'next' }, { cardId: 'beta', laneId: 'next' }])
  assert.equal(partly.workshop, undefined)
  assert.equal(partly.refused.laneId, 'next')
})

test('a move to the lane a card is already in changes nothing, so a request delivered twice does no harm', () => {
  const once = playWorkshopChanges(ruled(), [{ cardId: 'alpha', laneId: 'later' }]).workshop
  const twice = playWorkshopChanges(once, [{ cardId: 'alpha', laneId: 'later' }]).workshop
  assert.deepEqual(twice, once)
})

test('renames of a lane, a card and the workshop are made beside someone else’s move', () => {
  const moved = playWorkshopChanges(ruled(), [{ cardId: 'alpha', laneId: 'later' }]).workshop
  const renamed = playWorkshopChanges(moved, [
    { rename: { cardId: 'beta', label: 'Beta two' } }, { rename: { laneId: 'now', label: 'This week' } }, { rename: { title: 'Sprint plan' } },
  ]).workshop
  assert.equal(renamed.title, 'Sprint plan')
  assert.equal(renamed.lanes[0].label, 'This week')
  assert.equal(renamed.cards.find(card => card.id === 'beta').label, 'Beta two')
  assert.equal(lanes(renamed).alpha, 'later')
})

test('a name the workshop cannot take, and a card or lane that has gone, are refused with a reason', () => {
  const long = playWorkshopChanges(ruled(), [{ rename: { title: 'x'.repeat(121) } }])
  assert.match(long.refused.reason, /120/)
  // (Restated 2026-11-21, coordinator: a card's words are kept verbatim, markup included; a lane's name is still plain.)
  assert.equal(playWorkshopChanges(ruled(), [{ rename: { cardId: 'alpha', label: '<b>Alpha</b>' } }]).workshop.cards[0].label, '<b>Alpha</b>')
  const markup = playWorkshopChanges(ruled(), [{ rename: { laneId: 'now', label: '<b>Now</b>' } }])
  assert.match(markup.refused.reason, /plain text/i)
  assert.equal(markup.refused.laneId, 'now')
  assert.match(playWorkshopChanges(ruled(), [{ cardId: 'zeta', laneId: 'later' }]).refused.reason, /card is no longer/)
  assert.match(playWorkshopChanges(ruled(), [{ cardId: 'alpha', laneId: 'someday' }]).refused.reason, /lane is no longer/)
  assert.match(playWorkshopChanges(ruled(), [{ rename: { cardId: 'zeta', label: 'Zeta' } }]).refused.reason, /card is no longer/)
  assert.match(playWorkshopChanges(ruled(), [{ rename: { laneId: 'someday', label: 'Someday' } }]).refused.reason, /lane is no longer/)
})

test('a request is a short list of moves and renames and nothing else', () => {
  assert.deepEqual(readWorkshopChanges([{ cardId: 'alpha', laneId: 'later', extra: 1 }, { rename: { cardId: 'beta', label: 'B', junk: {} } }, { rename: { title: 'T' } }]),
    [{ cardId: 'alpha', laneId: 'later' }, { rename: { cardId: 'beta', label: 'B' } }, { rename: { title: 'T' } }])
  for (const input of [
    undefined, null, {}, [], 'x', [null], [{}], [{ cardId: 'alpha' }], [{ cardId: { $gt: '' }, laneId: 'later' }], [{ cardId: 'alpha', laneId: 'a.b' }],
    [{ rename: {} }], [{ rename: { cardId: 'alpha' } }], [{ rename: { cardId: 'alpha', label: 5 } }], [{ rename: { title: 'x'.repeat(201) } }],
    [{ rename: 'x', cardId: 'alpha', laneId: 'later' }], Array.from({ length: 51 }, () => ({ cardId: 'alpha', laneId: 'later' })),
  ]) assert.throws(() => readWorkshopChanges(input), undefined, JSON.stringify(input)?.slice(0, 80))
})

test('a note dropped on a lane is a card there, under the lane’s rule on the latest board', () => {
  const look = { backgroundColor: '#f0d399', textColor: '#24372d', fontSize: 16 }
  const added = playWorkshopChanges(ruled(), [{ cardId: 'node_k2j_1700', laneId: 'later', noteToCard: { noteId: 'node_k2j_1700', label: 'Call Sam', look } }]).workshop
  assert.deepEqual(added.cards.at(-1), { id: 'node_k2j_1700', label: 'Call Sam', laneId: 'later', look })
  // Someone else filled Next first: the lane refuses the note with the sentence a refused card gets.
  const full = playWorkshopChanges(ruled(), [{ cardId: 'alpha', laneId: 'next' }]).workshop
  const lost = playWorkshopChanges(full, [{ cardId: 'n1', laneId: 'next', noteToCard: { noteId: 'n1', label: 'Late' } }])
  assert.deepEqual(lost.refused, { reason: 'It already holds 1 of 1 card.', laneId: 'next' })
  // The card keeps the id the canvas gave it; one that is already on the board is refused, not renamed.
  assert.match(playWorkshopChanges(ruled(), [{ cardId: 'alpha', laneId: 'later', noteToCard: { noteId: 'alpha', label: 'Again' } }]).refused.reason, /already on the board/)
  // Delivered twice, it is made once.
  const twice = playWorkshopChanges(added, [{ cardId: 'node_k2j_1700', laneId: 'later', noteToCard: { noteId: 'node_k2j_1700', label: 'Call Sam', look } }])
  assert.deepEqual(twice.workshop, added)
})

test('a card dropped on the canvas leaves the board, unless something on the board depends on it', () => {
  const left = playWorkshopChanges(ruled(), [{ cardId: 'beta', cardToNote: { noteId: 'beta' } }]).workshop
  assert.deepEqual(left.cards.map(card => card.id), ['alpha', 'gamma', 'delta'])
  // Delivered twice, or after it has gone: nothing more happens.
  assert.deepEqual(playWorkshopChanges(left, [{ cardId: 'beta', cardToNote: { noteId: 'beta' } }]).workshop, left)
  const kept = playWorkshopChanges(ruled(), [{ cardId: 'gamma', cardToNote: { noteId: 'gamma' } }])
  assert.deepEqual(kept.refused, { reason: 'Gamma may only be in Now, so it stays a card.', laneId: 'now' })
})

test('a request reads note and card trades exactly, and nothing else', () => {
  assert.deepEqual(readWorkshopChanges([
    { cardId: 'n1', laneId: 'now', noteToCard: { noteId: 'n1', label: 'Hi', look: { backgroundColor: '#fff', junk: 1 }, extra: 2 } },
    { cardId: 'alpha', cardToNote: { noteId: 'alpha', x: 1 } },
  ]), [
    { cardId: 'n1', laneId: 'now', noteToCard: { noteId: 'n1', label: 'Hi', look: { backgroundColor: '#fff', junk: 1 } } },
    { cardId: 'alpha', cardToNote: { noteId: 'alpha' } },
  ])
  for (const input of [
    [{ cardId: 'n1', laneId: 'now', noteToCard: { noteId: 'n1' } }], [{ cardId: 'n1', laneId: 'now', noteToCard: { noteId: { $gt: '' }, label: 'x' } }],
    [{ cardId: 'n1', noteToCard: { noteId: 'n1', label: 'x' } }], [{ cardId: 'alpha', cardToNote: {} }], [{ cardToNote: { noteId: 'alpha' } }],
    [{ cardId: 'n1', laneId: 'now', noteToCard: { noteId: 'n1', label: 'x', look: 'red' } }],
  ]) assert.throws(() => readWorkshopChanges(input), undefined, JSON.stringify(input))
})

// cards-fix (2026-11-19): a trade is one save, and two people making the same trade end with one note or one card.
const stored = (id, text) => ({ options: { id, text, xPos: 10, yPos: 20, width: 228, height: 76 }, relationships: { associations: [] } })

test('a trade carries its drawing half, so the board and the drawing are saved together', () => {
  const made = playWorkshopChanges(ruled(), [{ cardId: 'n1', laneId: 'later', noteToCard: { noteId: 'n1', label: 'Call Sam' } }], ['n1', 'other'])
  assert.deepEqual(made.drawing, { remove: ['n1'], add: [] })
  const note = stored('beta', 'Beta')
  const left = playWorkshopChanges(ruled(), [{ cardId: 'beta', cardToNote: { noteId: 'beta', note } }], ['other'])
  assert.deepEqual(left.drawing, { remove: [], add: [note] })
  // The drawing as it is saved: the note that became a card is gone, the card that left is a note.
  assert.deepEqual(drawingAfter([stored('n1', 'Call Sam'), stored('other', 'Other')], made.drawing).map(n => n.options.id), ['other'])
  assert.deepEqual(drawingAfter([stored('other', 'Other')], left.drawing).map(n => n.options.id), ['other', 'beta'])
  // There and back in one request: the note is in the drawing once.
  const both = playWorkshopChanges(ruled(), [
    { cardId: 'n1', laneId: 'later', noteToCard: { noteId: 'n1', label: 'Call Sam' } },
    { cardId: 'n1', cardToNote: { noteId: 'n1', note: stored('n1', 'Call Sam') } },
  ], ['n1'])
  assert.deepEqual(drawingAfter([stored('n1', 'Call Sam')], both.drawing).map(n => n.options.id), ['n1'])
})

test('two people drop the same note on two lanes at once: the second is told someone else put it on the board first', () => {
  const first = playWorkshopChanges(ruled(), [{ cardId: 'n1', laneId: 'later', noteToCard: { noteId: 'n1', label: 'Call  Sam' } }], ['n1']).workshop
  const second = playWorkshopChanges(first, [{ cardId: 'n1', laneId: 'now', noteToCard: { noteId: 'n1', label: 'Call Sam' } }], [])
  assert.equal(second.taken, true)
  assert.equal(second.at, 0)
  assert.equal(second.refused.laneId, 'later')
  assert.match(second.refused.reason, /Someone else put Call Sam on the board first/)
})

test('two people drop the same card on the canvas at once: the second is told someone else took it, unless it is the same request again', () => {
  const first = playWorkshopChanges(ruled(), [{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: stored('alpha', 'Alpha') } }], [])
  const after = drawingAfter([], first.drawing).map(n => n.options.id)
  // The second person's note has an id of its own: it is not kept.
  const second = playWorkshopChanges(first.workshop, [{ cardId: 'beta', laneId: 'later' }, { cardId: 'alpha', cardToNote: { noteId: 'node_x', note: stored('node_x', 'Alpha') } }], after)
  assert.equal(second.taken, true)
  assert.equal(second.at, 1)
  assert.match(second.refused.reason, /Someone else took Alpha off the lanes first/)
  // The same request delivered again finds its note in the drawing: nothing more happens.
  const again = playWorkshopChanges(first.workshop, [{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: stored('alpha', 'Alpha') } }], after)
  assert.deepEqual(again.workshop, first.workshop)
  assert.deepEqual(again.drawing, { remove: [], add: [] })
})

// staging-2 (2026-11-20): A and B take the same card off at once. Both notes have the card's id, so
// B's request looked like A's delivered again: B was told it was saved, and told the room of B's
// note while the server kept A's. A request is the same one again only when its note is the note
// the stored trade saved; another person's note is told someone else took the card first.
test('two people take the same card off at once with the same note id: the second is told someone else took it; the same request again is not', () => {
  const mine = { options: { id: 'alpha', text: 'Alpha', xPos: -255, yPos: 260, width: 228, height: 76 }, relationships: { associations: [] } }
  const theirs = { options: { id: 'alpha', text: 'Alpha', xPos: -242, yPos: 120, width: 228, height: 76 }, relationships: { associations: [] } }
  const first = playWorkshopChanges(ruled(), [{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: mine } }], [], {})
  const trades = tradesAfter({}, first.drawing, 1)
  const after = drawingAfter([], first.drawing).map(n => n.options.id)
  const second = playWorkshopChanges(first.workshop, [{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: theirs } }], after, trades)
  assert.equal(second.taken, true)
  assert.equal(second.at, 0)
  assert.match(second.refused.reason, /Someone else took Alpha off the lanes first/)
  // The first request delivered again (the same note, key order and all, or not): nothing more happens.
  const again = playWorkshopChanges(first.workshop, [{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: { relationships: { associations: [] }, options: { ...mine.options } } } }], after, trades)
  assert.deepEqual(again.workshop, first.workshop)
  assert.deepEqual(again.drawing, { remove: [], add: [] })
  // A stored trade with no saved note (older records), or a caller that sends no trades: as before.
  assert.equal(playWorkshopChanges(first.workshop, [{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: theirs } }], after, { alpha: { r: 1, as: 'note' } }).refused, undefined)
  assert.equal(playWorkshopChanges(first.workshop, [{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: theirs } }], after).refused, undefined)
})

test('an undone trade puts the card back in front of the card it was in front of', () => {
  const left = playWorkshopChanges(ruled(), [{ cardId: 'beta', cardToNote: { noteId: 'beta' } }]).workshop
  const back = playWorkshopChanges(left, [{ cardId: 'beta', laneId: 'now', noteToCard: { noteId: 'beta', label: 'Beta', before: 'gamma' } }]).workshop
  assert.deepEqual(back.cards.map(card => card.id), ['alpha', 'beta', 'gamma', 'delta'])
})

test('a request reads what a note keeps, where a card goes back, and the note a card becomes, and nothing else', () => {
  const note = stored('alpha', 'Alpha')
  assert.deepEqual(readWorkshopChanges([
    { cardId: 'n1', laneId: 'now', noteToCard: { noteId: 'n1', label: 'Hi', asNote: { shape: 'ellipse' }, before: 'beta' } },
    { cardId: 'alpha', cardToNote: { noteId: 'alpha', note } },
  ]), [
    { cardId: 'n1', laneId: 'now', noteToCard: { noteId: 'n1', label: 'Hi', asNote: { shape: 'ellipse' }, before: 'beta' } },
    { cardId: 'alpha', cardToNote: { noteId: 'alpha', note } },
  ])
  for (const input of [
    [{ cardId: 'n1', laneId: 'now', noteToCard: { noteId: 'n1', label: 'x', before: 'a.b' } }],
    [{ cardId: 'n1', laneId: 'now', noteToCard: { noteId: 'n1', label: 'x', asNote: 'big' } }],
    [{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: stored('other', 'Other') } }],
    [{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: { options: { id: 'alpha', $where: 1 } } } }],
    [{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: { options: { id: 'alpha', text: 'x'.repeat(40000) } } } }],
  ]) assert.throws(() => readWorkshopChanges(input), undefined, JSON.stringify(input).slice(0, 120))
})

test('the server records each note’s newest trade, with the revision that made it, for every screen and the room to follow', () => {
  // Note n1 became a card at revision 4.
  const made = playWorkshopChanges(ruled(), [{ cardId: 'n1', laneId: 'later', noteToCard: { noteId: 'n1', label: 'Call Sam' } }], ['n1'])
  assert.deepEqual(tradesAfter(undefined, made.drawing, 4), { n1: { r: 4, as: 'card' } })
  // Card Beta became a note at revision 5: the note as saved goes with it, and n1's trade stays.
  const note = stored('beta', 'Beta')
  const left = playWorkshopChanges(ruled(), [{ cardId: 'beta', cardToNote: { noteId: 'beta', note } }], ['other'])
  assert.deepEqual(tradesAfter({ n1: { r: 4, as: 'card' } }, left.drawing, 5), { n1: { r: 4, as: 'card' }, beta: { r: 5, as: 'note', note } })
  // A later trade of the same note replaces its record.
  const back = playWorkshopChanges(made.workshop, [{ cardId: 'n1', cardToNote: { noteId: 'n1', note: stored('n1', 'Call Sam') } }], [])
  assert.deepEqual(tradesAfter({ n1: { r: 4, as: 'card' } }, back.drawing, 6), { n1: { r: 6, as: 'note', note: stored('n1', 'Call Sam') } })
  // There and back in one request: the note is what is left.
  const both = playWorkshopChanges(ruled(), [
    { cardId: 'n1', laneId: 'later', noteToCard: { noteId: 'n1', label: 'Call Sam' } },
    { cardId: 'n1', cardToNote: { noteId: 'n1', note: stored('n1', 'Call Sam') } },
  ], ['n1'])
  assert.deepEqual(Object.keys(tradesAfter({}, both.drawing, 7)), ['n1'])
  assert.equal(tradesAfter({}, both.drawing, 7).n1.as, 'note')
  // Moves and renames record nothing.
  assert.deepEqual(tradesAfter({ n1: { r: 4, as: 'card' } }, playWorkshopChanges(ruled(), [{ cardId: 'alpha', laneId: 'later' }]).drawing, 8), { n1: { r: 4, as: 'card' } })
})
