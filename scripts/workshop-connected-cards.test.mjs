import assert from 'node:assert/strict'
import test from 'node:test'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { drawingAfter, playWorkshopChanges, readWorkshopChanges, tradesAfter } from '../web/app/server/methods/workshop-play.mjs'
import { proposeLaneReply } from '../web/app/imports/api/common/lane-conversation.mjs'
import { createWorkshopOperations as workshopOperations, summarizeWorkshop } from '../web/app/server/workshop-operation-api.mjs'
import { createSlateSaveCore } from '../web/app/server/slate-save-core.mjs'
import { readWorkshop } from '../web/app/server/workshop-read.mjs'

// Connected cards (owner decision 2026-11-21): a note joined to other notes by lines becomes a card
// and keeps them, a card becomes a note with them, and lines join cards to notes and to each other.
// The server makes the trade on the board and the drawing in one write, so a reload, a second
// screen and an agent all see the same lines.

const board = () => validateWorkshop({
  version: 1, title: 'Plan',
  lanes: [{ id: 'now', label: 'Now' }, { id: 'later', label: 'Later' }],
  cards: [{ id: 'alpha', label: 'Alpha', laneId: 'now' }, { id: 'beta', label: 'Beta', laneId: 'now' }],
})
const note = (id, text, associations = []) => ({ options: { id, text, xPos: 0, yPos: 0 }, relationships: { associations } })
const link = (id, parentId, childId) => ({ id, parentId, childId, lineColor: '#666666', showChildArrow: true })
const ids = nodes => nodes.map(n => n.options.id + ':' + n.relationships.associations.map(a => a.parentId + '>' + a.childId).join(','))

test('a note with lines dropped on a lane is a card with those lines, and the drawing loses the note and its lines', () => {
  // sing -> plain and plain -> other, in the drawing. plain becomes a card.
  const drawn = [note('sing', 'Sing', [link('sing->plain', 'sing', 'plain')]), note('plain', 'Plain', [link('plain->other', 'plain', 'other')]), note('other', 'Other')]
  const changes = readWorkshopChanges([{ cardId: 'plain', laneId: 'later', noteToCard: { noteId: 'plain', label: 'Plain',
    lines: [link('sing->plain', 'sing', 'plain'), link('plain->other', 'plain', 'other')] } }])
  assert.equal(changes[0].noteToCard.lines.length, 2)
  const played = playWorkshopChanges(board(), changes, drawn.map(n => n.options.id), {})
  assert.deepEqual(played.workshop.cards.map(card => card.id + '@' + card.laneId), ['alpha@now', 'beta@now', 'plain@later'])
  assert.deepEqual(played.workshop.lines.map(line => line.parentId + '>' + line.childId), ['sing>plain', 'plain>other'])
  // The note and every line to it leave the drawing.
  assert.deepEqual(ids(drawingAfter(drawn, played.drawing)), ['sing:', 'other:'])
  assert.deepEqual(tradesAfter({}, played.drawing, 4), { plain: { r: 4, as: 'card' } })
})

test('a card with lines dropped on the canvas is a note: its lines to notes join the drawing, its lines to cards stay on the board', () => {
  const start = validateWorkshop({ ...board(), lines: [link('sing->alpha', 'sing', 'alpha'), link('alpha->other', 'alpha', 'other'), link('alpha->beta', 'alpha', 'beta')] })
  const drawn = [note('sing', 'Sing'), note('other', 'Other')]
  const saved = note('alpha', 'Alpha')
  const played = playWorkshopChanges(start, readWorkshopChanges([{ cardId: 'alpha', cardToNote: { noteId: 'alpha', note: saved } }]), drawn.map(n => n.options.id), {})
  assert.deepEqual(played.workshop.cards.map(card => card.id), ['beta'])
  assert.deepEqual(played.workshop.lines.map(line => line.parentId + '>' + line.childId), ['alpha>beta'])
  // Each line is saved on the note it starts from, the new note included, and once only.
  assert.deepEqual(ids(drawingAfter(drawn, played.drawing)), ['sing:sing>alpha', 'other:', 'alpha:alpha>other'])
  const again = drawingAfter(drawingAfter(drawn, played.drawing), played.drawing)
  assert.deepEqual(ids(again), ['sing:sing>alpha', 'other:', 'alpha:alpha>other'])
})

test('a card that became a note under another id keeps its lines under that id', () => {
  const start = validateWorkshop({ ...board(), lines: [link('sing->alpha', 'sing', 'alpha')] })
  const drawn = [note('sing', 'Sing'), note('alpha', 'Someone else’s note called alpha')]
  const played = playWorkshopChanges(start, readWorkshopChanges([{ cardId: 'alpha', cardToNote: { noteId: 'node_x1', note: note('node_x1', 'Alpha') } }]), drawn.map(n => n.options.id), {})
  assert.deepEqual(ids(drawingAfter(drawn, played.drawing)), ['sing:sing>node_x1', 'alpha:', 'node_x1:'])
})

test('a line drawn to or from a card is saved on the board; one taken away leaves it; a line whose card has gone is refused', () => {
  const line = { id: 'plain->alpha', parentId: 'plain', childId: 'alpha', showChildArrow: true, label: 'needs' }
  const drawn = playWorkshopChanges(board(), readWorkshopChanges([{ line: { set: line } }]))
  assert.deepEqual(drawn.workshop.lines, [line])
  // Delivered twice, or restyled: one line.
  const restyled = playWorkshopChanges(drawn.workshop, readWorkshopChanges([{ line: { set: { ...line, lineColor: '#c2410c' } } }]))
  assert.deepEqual(restyled.workshop.lines, [{ ...line, lineColor: '#c2410c' }])
  const taken = playWorkshopChanges(restyled.workshop, readWorkshopChanges([{ line: { remove: 'plain->alpha' } }]))
  assert.equal(taken.workshop.lines, undefined)
  // Taken away twice: nothing more happens.
  assert.equal(playWorkshopChanges(taken.workshop, readWorkshopChanges([{ line: { remove: 'plain->alpha' } }])).workshop.lines, undefined)
  const gone = playWorkshopChanges(board(), readWorkshopChanges([{ line: { set: { id: 'x', parentId: 'plain', childId: 'zeta' } } }]))
  assert.equal(gone.refused.reason, 'That card is no longer on the board.')
  assert.throws(() => readWorkshopChanges([{ line: { set: 'plain->alpha' } }]))
  assert.throws(() => readWorkshopChanges([{ line: { remove: '<b>' } }]))
  assert.throws(() => readWorkshopChanges([{ cardId: 'plain', laneId: 'now', noteToCard: { noteId: 'plain', label: 'Plain', lines: 'all' } }]))
})

// Owner's bug (2026-11-22): "hey", joined to the Welcome! card and with an elbow line whose end was free
// on the canvas, was refused by a Pros and cons lane. Any note becomes a card with every line it has.
test('a note with a free-ended line and a line to a card is a card with both; back on the canvas the free line is the drawing\'s at its point', () => {
  const pros = validateWorkshop({
    version: 1, title: 'Pros and cons',
    lanes: [{ id: 'pros', label: 'Pros' }, { id: 'cons', label: 'Cons' }, { id: 'questions', label: 'Questions' }],
    cards: [{ id: 'welcome', label: 'Welcome!', laneId: 'questions' }],
  })
  const free = { id: 'hey->__free_ab12cd34', parentId: 'hey', childId: '__free_ab12cd34', targetPoint: { x: 640, y: -120 }, lineType: 'elbow', showChildArrow: true }
  const toWelcome = link('hey->welcome', 'hey', 'welcome')
  const drawn = [note('hey', 'hey', [free]), note('other', 'Other')]
  const changes = readWorkshopChanges([{ cardId: 'hey', laneId: 'pros', noteToCard: { noteId: 'hey', label: 'hey', lines: [toWelcome, free] } }])
  const played = playWorkshopChanges(pros, changes, drawn.map(n => n.options.id), {})
  assert.equal(played.refused, undefined)
  assert.deepEqual(played.workshop.cards.map(card => card.id + '@' + card.laneId), ['welcome@questions', 'hey@pros'])
  assert.deepEqual(played.workshop.lines, [toWelcome, free])
  assert.deepEqual(ids(drawingAfter(drawn, played.drawing)), ['other:'])

  // Its free end moved on the board: one line change, kept with its new point.
  const moved = playWorkshopChanges(played.workshop, readWorkshopChanges([{ line: { set: { ...free, targetPoint: { x: 10, y: 20 } } } }]))
  assert.deepEqual(moved.workshop.lines.find(line => line.id === free.id).targetPoint, { x: 10, y: 20 })

  // Back on the canvas: the line to Welcome! stays on the board, the free one is saved on the note with its point.
  const back = playWorkshopChanges(played.workshop, readWorkshopChanges([{ cardId: 'hey', cardToNote: { noteId: 'hey', note: note('hey', 'hey') } }]),
    ['other'], {})
  assert.deepEqual(back.workshop.lines, [toWelcome])
  const after = drawingAfter([note('other', 'Other')], back.drawing)
  assert.deepEqual(ids(after), ['other:', 'hey:hey>__free_ab12cd34'])
  assert.deepEqual(after[1].relationships.associations[0], free)
  // Saved again: still once.
  assert.deepEqual(ids(drawingAfter(after, back.drawing)), ['other:', 'hey:hey>__free_ab12cd34'])
  // A screen that hears of the trade only from the record draws the free line too.
  assert.deepEqual(tradesAfter({}, back.drawing, 5).hey.lines, [free])
  // An agent reads the free line as a line to a point on the canvas, not to a note.
  const slate = { _id: 'board', shareId: 'example', userId: 'owner', options: {}, nodes: [], creative: { revision: 3, model: { version: 1, kind: 'workshop', workshop: played.workshop } } }
  assert.deepEqual(readWorkshop(played.workshop, slate).lines, [{ id: 'hey->welcome', fromId: 'hey', toId: 'welcome' },
    { id: 'hey->__free_ab12cd34', fromId: 'hey', toPoint: { x: 640, y: -120 } }])
})

test('the conversation connects two cards, and takes the line away again', () => {
  const joined = proposeLaneReply(board(), 'Connect Alpha to Beta')
  assert.deepEqual(joined.workshop.lines.map(line => line.parentId + '>' + line.childId), ['alpha>beta'])
  assert.match(joined.reply, /Alpha/)
  const parted = proposeLaneReply(joined.workshop, 'Disconnect Alpha from Beta')
  assert.equal(parted.workshop.lines, undefined)
})

test('an agent connects a card to a note of the slate, or to another card, and disconnects it', async () => {
  const slate = {
    _id: 'board', shareId: 'example', userId: 'owner', options: { isPrivate: true },
    nodes: [note('plain', 'Plain')],
    creative: { revision: 3, model: { version: 1, kind: 'workshop', workshop: board() } },
  }
  // (Restated 2026-11-22, library merged: every board also takes the library's workshop_edits and undo_workshop_edit.)
  assert.deepEqual(summarizeWorkshop(slate).operations, ['workshop_edits', 'undo_workshop_edit', 'move_workshop_card', 'set_presentation_order', 'connect_workshop_card', 'disconnect_workshop_card'])
  const run = workshopOperations({ saveCore: createSlateSaveCore({ slates: { updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }), findOne: async () => slate }, events: { insertOne: async () => {} } }) })
  const plan = (kind, toId) => ({ message: 'Join', operations: [{ kind, cardId: 'alpha', toId, expectedRevision: 3 }] })
  const { body } = await run({ slate, token: { _id: 'credential', userId: 'owner' }, plan: plan('connect_workshop_card', 'plain'), dryRun: true })
  assert.deepEqual(body.workshop.lines, [{ id: 'alpha->plain', fromId: 'alpha', toId: 'plain' }])
  const toCard = await run({ slate, token: { _id: 'credential', userId: 'owner' }, plan: plan('connect_workshop_card', 'beta'), dryRun: true })
  assert.deepEqual(toCard.body.workshop.lines, [{ id: 'alpha->beta', fromId: 'alpha', toId: 'beta' }])
  await assert.rejects(run({ slate, token: { _id: 'credential', userId: 'owner' }, plan: plan('connect_workshop_card', 'nowhere'), dryRun: true }),
    error => error.code === 'invalid_operation_plan' && /not on this slate/.test(error.message))
  const joined = { ...slate, creative: { ...slate.creative, model: { ...slate.creative.model, workshop: validateWorkshop({ ...board(), lines: [link('alpha->plain', 'alpha', 'plain')] }) } } }
  const parted = await run({ slate: joined, token: { _id: 'credential', userId: 'owner' }, plan: plan('disconnect_workshop_card', 'plain'), dryRun: true })
  assert.deepEqual(parted.body.workshop.lines, [])
})

// Finding (2026-11-22): the read gives a free-ended line only its id and toPoint, so an agent takes it
// away by that id. The line to the note stays; a line id that is not the card's is refused.
test('an agent takes away a card\'s free-ended line by its id', async () => {
  const free = { id: 'alpha->__free_ab', parentId: 'alpha', childId: '__free_ab', targetPoint: { x: 40, y: -20 }, lineType: 'elbow', showChildArrow: true }
  const slate = {
    _id: 'board', shareId: 'example', userId: 'owner', options: { isPrivate: true },
    nodes: [note('plain', 'Plain')],
    creative: { revision: 3, model: { version: 1, kind: 'workshop', workshop: validateWorkshop({ ...board(), lines: [link('alpha->plain', 'alpha', 'plain'), free] }) } },
  }
  assert.deepEqual(summarizeWorkshop(slate).lines.find(line => line.id === free.id), { id: free.id, fromId: 'alpha', toPoint: { x: 40, y: -20 } })
  const run = workshopOperations({ saveCore: createSlateSaveCore({ slates: { updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }), findOne: async () => slate }, events: { insertOne: async () => {} } }) })
  const plan = (cardId, toId) => ({ message: 'Part', operations: [{ kind: 'disconnect_workshop_card', cardId, toId, expectedRevision: 3 }] })
  const parted = await run({ slate, token: { _id: 'credential', userId: 'owner' }, plan: plan('alpha', free.id), dryRun: true })
  assert.deepEqual(parted.body.workshop.lines, [{ id: 'alpha->plain', fromId: 'alpha', toId: 'plain' }])
  // The free end's own id names the same line.
  const byEnd = await run({ slate, token: { _id: 'credential', userId: 'owner' }, plan: plan('alpha', '__free_ab'), dryRun: true })
  assert.deepEqual(byEnd.body.workshop.lines, [{ id: 'alpha->plain', fromId: 'alpha', toId: 'plain' }])
  // Beta does not hold that line.
  await assert.rejects(run({ slate, token: { _id: 'credential', userId: 'owner' }, plan: plan('beta', free.id), dryRun: true }),
    error => error.code === 'invalid_operation_plan' && /not on this slate/.test(error.message))
})
