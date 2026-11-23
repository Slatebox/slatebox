import assert from 'node:assert/strict'
import test from 'node:test'
import { createBudgetWorkshop, nightTransfer } from 'slateboxjs/workshops/model'
import { hasWorkshop, workshopNamesSlate } from '../web/app/imports/api/common/workshop-notes.mjs'
import { saveNativeSlate } from '../web/app/server/methods/native-slate-save.mjs'
import { createSlateSaveCore } from '../web/app/server/slate-save-core.mjs'

const creative = (workshop = createBudgetWorkshop()) => ({ revision: 3, model: { kind: 'workshop', version: 1, workshop } })
const note = (id, links = []) => ({ options: { id, text: id }, relationships: { associations: links } })

test('a workshop names its slate unless it was added to a drawing', () => {
  assert.equal(hasWorkshop({ creative: creative() }), true)
  assert.equal(workshopNamesSlate({ creative: creative() }), true)
  assert.equal(workshopNamesSlate({ creative: creative(), nativeCanvasDrawing: true }), false)
  assert.equal(workshopNamesSlate({ creative: { model: { kind: 'focus-darkroom' } } }), false)
  assert.equal(workshopNamesSlate({}), false)
})

// The canvas save, against a collection that holds one slate.
function harness(board) {
  const writes = []
  const match = (doc, selector) => Object.entries(selector).every(([key, value]) => {
    const stored = key.split('.').reduce((at, part) => at?.[part], doc)
    return (stored ?? null) === (value ?? null)
  })
  const slates = {
    async findOne(selector) { return match(board, selector) ? board : null },
    async updateOne(selector, modifier) { if (!match(board, selector)) return { matchedCount: 0 }; writes.push(modifier.$set); return { matchedCount: 1 } },
    async insertOne() { throw new Error('unexpected insert') },
  }
  const denied = () => new Error('denied')
  // Restated (P05a): the canvas save writes through the save core, over the same collection.
  const saveCore = createSlateSaveCore({ slates, events: { insertOne: async () => {} } })
  const save = (user, request) => saveNativeSlate({
    slates, saveCore, denied, access: { find: () => ({ toArray: async () => [{ slateId: board._id, type: 'unlisted', userId: null, accessKey: 'editkey', slateAccessPermissionId: 'EDIT' }] }) },
    guestViews: { findOne: async () => ({ _id: 'receipt' }) }, isTeamAdmin: async () => false,
    rememberInvitedEdit: async () => {}, recordGuestEdit: async () => false, now: 1700000000000,
  }, user, request)
  return { writes, save }
}
const owner = { _id: 'owner' }
const stored = extra => ({ _id: 'slate1', userId: 'owner', shareId: 'share1', options: { name: 'Stored title', isUnlisted: true }, ...extra })
const snapshot = nodes => ({ options: { id: 'slate1', name: 'The name this page loaded with', description: 'stale', workshopOrigin: { x: 40, y: 40 } }, nodes })

test('a canvas save on a workshop slate stores every note it is sent: they are the slate’s own, whatever they are called', async () => {
  // A slate that was a saved workshop drawing before it became interactive holds real notes
  // called lane-<id> and card-<id>. The engine keeps its own lane and card notes out of what the
  // canvas sends, so a note that arrives is the document's, and losing it would lose a person's work.
  const { writes, save } = harness(stored({ creative: creative() }))
  const sent = [note('own', [{ id: 'x', parentId: 'own', childId: 'card-fund-0' }]), note('card-fund-0'), note('lane-reserve'), note('image-logo')]
  await save(owner, { slate: snapshot(sent) })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].nodes, sent)
  assert.deepEqual(writes[0].nodes.map(n => n.options.id), ['own', 'card-fund-0', 'lane-reserve', 'image-logo'])
  assert.deepEqual(writes[0].nodes[0].relationships.associations, [{ id: 'x', parentId: 'own', childId: 'card-fund-0' }])
  // The workshop's title names the slate, so the page's stale name and description are not written.
  assert.equal('options.name' in writes[0], false)
  assert.equal('options.description' in writes[0], false)
  assert.deepEqual(writes[0]['options.workshopOrigin'], { x: 40, y: 40 })
  assert.equal(Object.keys(writes[0]).some(key => key === 'creative' || key.startsWith('creative.')), false, 'the canvas save never writes the model')
})

test('a stored model this build cannot draw costs the slate none of its notes', async () => {
  const { writes, save } = harness(stored({ creative: { revision: 0, model: { kind: 'workshop', version: 1, workshop: { version: 99, lanes: 'unreadable' } } } }))
  await save(owner, { slate: snapshot([note('plain'), note('card-x'), note('image-logo'), note('caption-1')]) })
  assert.deepEqual(writes[0].nodes.map(n => n.options.id), ['plain', 'card-x', 'image-logo', 'caption-1'])
})

test('where the workshop sits is stored only as two finite numbers', async () => {
  for (const [sent, kept] of [
    [{ x: 12, y: -40.5, junk: 'x' }, { x: 12, y: -40.5 }], [{ x: 'NaN', y: { $gt: 1 } }, undefined], [{ x: 1 }, undefined],
    [null, undefined], ['40,40', undefined], [{ x: Infinity, y: 0 }, undefined],
  ]) {
    const { writes, save } = harness(stored({ creative: creative() }))
    await save(owner, { slate: { options: { id: 'slate1', workshopOrigin: sent }, nodes: [] } })
    assert.deepEqual(writes[0]['options.workshopOrigin'], kept, JSON.stringify(sent))
  }
})

test('a drawing that gained a workshop keeps its own name through a canvas save; an ordinary slate is saved as before', async () => {
  const both = harness(stored({ creative: creative(nightTransfer), nativeCanvasDrawing: true }))
  await both.save(owner, { slate: snapshot([note('own'), note('card-rider')]) })
  assert.deepEqual(both.writes[0].nodes.map(n => n.options.id), ['own', 'card-rider'])
  assert.equal(both.writes[0]['options.name'], 'The name this page loaded with')

  const ordinary = harness(stored({}))
  const notes = [note('own'), note('card-fund-0'), note('lane-anything')]
  await ordinary.save(owner, { slate: snapshot(notes) })
  assert.equal(ordinary.writes[0].nodes, notes, 'no workshop: every note is the slate’s own')
  assert.equal(ordinary.writes[0]['options.name'], 'The name this page loaded with')
})

test('a visitor who has not joined cannot save to a workshop slate, though the same visitor may edit an ordinary one', async () => {
  const guestRequest = { slate: snapshot([note('own')]), guestCollaboratorId: 'visitor', routeKey: 'editkey' }
  const workshop = harness(stored({ creative: creative() }))
  await assert.rejects(workshop.save(null, guestRequest), /denied/)
  assert.equal(workshop.writes.length, 0)
  const ordinary = harness(stored({}))
  await ordinary.save(null, guestRequest)
  assert.equal(ordinary.writes.length, 1)
  // The other creative kinds keep the rule they had.
  const gallery = harness(stored({ creative: { revision: 0, model: { kind: 'moon-gallery' } } }))
  await gallery.save(null, guestRequest)
  assert.equal(gallery.writes.length, 1)
})

// A note and a card trading places is saved by the server with the board (creativeSlates.play),
// which records the trade in creative.trades with the revision that made it. A canvas save from a
// screen that has not drawn that trade yet (it says which revision it has drawn trades through)
// must not store the old note again, nor lose the new one.
const traded = (extra = {}) => stored({
  creative: { ...creative(), revision: 5, trades: { gone: { r: 5, as: 'card' }, back: { r: 5, as: 'note', note: note('back') }, old: { r: 2, as: 'note', note: note('old') } } },
  nodes: [note('own'), note('back'), note('old')], ...extra,
})

test('a canvas save from a screen that had not drawn a trade yet stores the trade, not that screen', async () => {
  const { writes, save } = harness(traded())
  // This screen drew trades through revision 4: it still shows the note that became a card, does
  // not show the card that became a note, and its person deleted an older traded note themselves.
  await save(owner, { slate: snapshot([note('own'), note('gone')]), tradesThrough: 4 })
  assert.deepEqual(writes[0].nodes.map(n => n.options.id), ['own', 'back'])
})

test('a canvas save from a screen that has drawn every trade is stored as sent, less a note that is a card now', async () => {
  const { writes, save } = harness(traded())
  const sent = [note('own')]
  await save(owner, { slate: snapshot(sent), tradesThrough: 5 })
  // Its person deleted 'back' after it arrived: that stays deleted.
  assert.equal(writes[0].nodes, sent)
  // A note that is a card now is never stored, whatever the screen has drawn (or an older page that does not say).
  // trade-close: an older page that does not say what it has drawn cannot have drawn the notes cards
  // became either (it still shows 'gone'), so their stored copies stay (trade-attack F3; was ['own'],
  // which lost 'back' and 'old', notes that page never had a chance to draw or delete).
  await save(owner, { slate: snapshot([note('own'), note('gone')]) })
  assert.deepEqual(writes[1].nodes.map(n => n.options.id), ['own', 'back', 'old'])
})

test('a canvas save that a trade lands in the middle of is made again on the slate the trade left', async () => {
  const board = traded()
  const { writes, save } = harness(board)
  const { slates } = harness(board)
  let first = true
  const racing = {
    ...slates,
    findOne: async () => structuredClone(board),
    async updateOne(selector, modifier) {
      if (first) {
        first = false
        // The trade is saved between this save's read and its write: card 'late' became a note.
        board.creative = { ...board.creative, revision: 6, trades: { ...board.creative.trades, late: { r: 6, as: 'note', note: note('late') } } }
        board.nodes = [...board.nodes, note('late')]
      }
      const matches = Object.entries(selector).every(([key, value]) => (key.split('.').reduce((at, part) => at?.[part], board) ?? null) === (value ?? null))
      if (!matches) return { matchedCount: 0 }
      writes.push(modifier.$set)
      return { matchedCount: 1 }
    },
  }
  // Restated (P05a), as harness() is: the canvas save writes through the save core, here over the
  // racing collection, so the trade still lands between the save's read and its write.
  const saveCore = createSlateSaveCore({ slates: racing, events: { insertOne: async () => {} } })
  await saveNativeSlate({
    slates: racing, saveCore, denied: () => new Error('denied'), access: { find: () => ({ toArray: async () => [] }) },
    guestViews: { findOne: async () => null }, isTeamAdmin: async () => false, rememberInvitedEdit: async () => {}, recordGuestEdit: async () => false, now: 1,
  }, owner, { slate: snapshot([note('own'), note('back')]), tradesThrough: 5 })
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].nodes.map(n => n.options.id), ['own', 'back', 'late'])
})

// ─── trade-attack (2026-11-20) ───────────────────────────────────────────────────────────────────
test('trade-attack: a note a previous-release server traded back (no trade record) survives a canvas save', async () => {
  // r=2: this release made 'delta' a card (recorded). r=3: a previous-release pod (rolling deploy)
  // made the card a note again: it wrote the board and the drawing, but not creative.trades.
  const { writes, save } = harness(stored({
    creative: { ...creative(), revision: 3, trades: { delta: { r: 2, as: 'card' } } },
    nodes: [note('own'), note('delta')],
  }))
  // A screen on this release that draws everything (the note included) saves.
  await save(owner, { slate: snapshot([note('own'), note('delta')]), tradesThrough: 3 })
  assert.deepEqual(writes[0].nodes.map(n => n.options.id), ['own', 'delta'])
})

test('trade-attack: a save from a page that does not say what it has drawn (previous engine) does not lose a note a card became', async () => {
  const { writes, save } = harness(stored({
    creative: { ...creative(), revision: 5, trades: { back: { r: 5, as: 'note', note: note('back') } } },
    nodes: [note('own'), note('back')],
  }))
  // The previous release's page never drew 'back' (its trader closed before telling the room).
  await save(owner, { slate: snapshot([note('own')]) })
  assert.deepEqual(writes[0].nodes.map(n => n.options.id), ['own', 'back'])
})

// ─── trade-close (2026-11-20) ────────────────────────────────────────────────────────────────────
test('trade-close: a canvas save that holds no undo marker clears the stored one (a save made before its screen saw someone\'s undo)', async () => {
  // B's undo was stored with its marker (the replacement it holds). A's save, made before A's screen
  // saw that undo, holds A's notes without it: the stored slate must not go on claiming the undo, or
  // the next to load keeps A's notes and never replays the room's undo (trade-attack F4).
  const marked = { id: 'slate1', t: 5, c: 2, k: 'onSlateReplaced_5_b' }
  const { writes, save } = harness(stored({ creative: creative(), options: { name: 'Stored title', isUnlisted: true, collabBaseline: marked } }))
  await save(owner, { slate: snapshot([note('own')]), tradesThrough: 3 })
  assert.equal('options.collabBaseline' in writes[0], true)
  assert.equal(writes[0]['options.collabBaseline'], null)
  // A save that holds its own marker stores it.
  const own = { id: 'slate1', t: 6, c: 1, k: 'onSlateReplaced_6_a' }
  await save(owner, { slate: { ...snapshot([note('own')]), options: { ...snapshot([]).options, collabBaseline: own } }, tradesThrough: 3 })
  assert.deepEqual(writes[1]['options.collabBaseline'], own)
  // The same on an ordinary slate.
  const ordinary = harness(stored({ options: { name: 'Stored title', isUnlisted: true, collabBaseline: marked } }))
  await ordinary.save(owner, { slate: snapshot([note('own')]) })
  assert.equal(ordinary.writes[0]['options.collabBaseline'], null)
})
